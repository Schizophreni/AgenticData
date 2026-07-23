"""The per-document Agentic Self-Instruct loop (paper §3.1/§3.2)."""
from __future__ import annotations

import asyncio
import re

from .. import db, events
from ..agents.challenger import run_challenger
from ..agents.judge import run_judge, run_quality_verifier
from ..agents.solver import run_solver
from ..models import GapConfig
from ..providers.base import LLMClient
from . import gap


def _emit(run_id, example_id, agent, status, payload=None):
    events.publish(run_id, "agent", {"example_id": example_id, "agent": agent,
                                      "status": status, **(payload or {})})


async def _score_rollouts(judge: LLMClient, question, images, rubric, role,
                          answers, run_id, example_id):
    async def one(idx, ans):
        _emit(run_id, example_id, judge_name := f"judge:{role}", "running", {"idx": idx})
        jr = await run_judge(judge, question, images, rubric, ans["answer"])
        _emit(run_id, example_id, judge_name, "done", {"idx": idx, "score": jr.get("overall")})
        return jr
    results = await asyncio.gather(*[one(i, a) for i, a in enumerate(answers)])
    scores = [float(r.get("overall", 0.0)) for r in results]
    return scores, results


def _extract_mcq_letter(answer: str) -> str | None:
    """Extract a solver's final A-E choice without treating reasoning prose as a vote."""
    text = str(answer or "").strip()
    patterns = (
        r"(?im)^\s*final\s+answer\s*:\s*[\(\[]?([A-E])\b",
        r"(?im)^\s*(?:answer|option|choice)\s*(?:is|:)\s*[\(\[]?([A-E])\b",
        r"(?im)^\s*[\(\[]?([A-E])[\)\].]?\s*$",
    )
    for pattern in patterns:
        matches = re.findall(pattern, text)
        if matches:
            return str(matches[-1]).upper()
    return None


async def _score_mcq_or_judge(judge: LLMClient, cand: dict, images, role,
                               answers, run_id, example_id):
    """Mechanically score parseable MCQ choices; use the VLM judge only as fallback."""
    key = str(cand.get("correct_answer", "")).strip().upper()[:1]
    options = cand.get("options") or []
    option_count = len(options)
    valid_letters = "ABCDE"[:option_count]
    if option_count not in (3, 4, 5) or key not in valid_letters:
        return await _score_rollouts(
            judge, cand["question"], images, cand.get("rubric", []), role,
            answers, run_id, example_id)

    async def one(idx, ans):
        letter = _extract_mcq_letter(ans.get("answer", ""))
        if letter is not None:
            score = 1.0 if letter == key else 0.0
            _emit(run_id, example_id, f"judge:{role}", "done",
                  {"idx": idx, "score": score, "scorer": "exact_match"})
            return {"overall": score, "parsed_answer": letter,
                    "correct_answer": key, "scorer": "exact_match"}
        _emit(run_id, example_id, f"judge:{role}", "running",
              {"idx": idx, "scorer": "judge_fallback"})
        result = await run_judge(
            judge, cand["question"], images, cand.get("rubric", []),
            ans.get("answer", ""))
        result["scorer"] = "judge_fallback"
        _emit(run_id, example_id, f"judge:{role}", "done",
              {"idx": idx, "score": result.get("overall"),
               "scorer": "judge_fallback"})
        return result

    results = await asyncio.gather(*(one(i, ans) for i, ans in enumerate(answers)))
    return [float(r.get("overall", 0.0)) for r in results], results


async def run_doc_loop(run_id: str, example_id: str, doc: dict, recipe: dict,
                       clients: dict[str, LLMClient], cfg: GapConfig) -> dict:
    """Run one grounding doc through the loop; persist + emit; return outcome."""
    images = doc.get("images", [])
    feedback = None
    last = {}
    last_cand: dict = {"images": images}

    for rnd in range(1, cfg.step_budget + 1):
        round_id = db.new_id("rnd")
        _emit(run_id, example_id, "challenger", "running", {"round": rnd})

        # 1. challenger --------------------------------------------------------
        try:
            cand = await run_challenger(clients["challenger"], doc,
                                        recipe.get("gen_rubric", ""), feedback)
        except Exception as e:                       # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            _emit(run_id, example_id, "challenger", "failed", {"error": err})
            _persist_round(round_id, example_id, rnd, {"error": err}, {}, {},
                           "challenger_error", err)
            feedback = f"previous generation errored: {e}"
            continue
        rubric = cand.get("rubric", [])
        last_cand = cand
        _emit(run_id, example_id, "challenger", "done",
              {"round": rnd, "question": cand.get("question", "")})

        # 2. quality verifier --------------------------------------------------
        _emit(run_id, example_id, "verifier", "running", {"round": rnd})
        qv = await run_quality_verifier(clients["judge"], cand, images)
        if str(qv.get("overall", "")).upper() != "PASS":
            _emit(run_id, example_id, "verifier", "done", {"round": rnd, "verdict": "FAIL"})
            feedback = "QV failed: " + qv.get("feedback", "improve question quality")
            _persist_round(round_id, example_id, rnd, cand, qv, {}, "qv_fail", feedback)
            continue
        _emit(run_id, example_id, "verifier", "done", {"round": rnd, "verdict": "PASS"})

        # 3. weak solver rollouts ---------------------------------------------
        _emit(run_id, example_id, "weak", "running", {"round": rnd, "k": cfg.k_weak})
        is_mcq = len(cand.get("options") or []) in (3, 4, 5)
        weak_ans = await asyncio.gather(*[
            run_solver(clients["weak"], cand["question"], images, is_mcq=is_mcq)
            for _ in range(cfg.k_weak)])
        weak_scores, weak_j = await _score_mcq_or_judge(
            clients["judge"], cand, images, "weak", weak_ans, run_id, example_id)
        weak_avg = sum(weak_scores) / len(weak_scores) if weak_scores else 0.0
        _emit(run_id, example_id, "weak", "done", {"round": rnd, "avg": weak_avg,
                                                   "scores": weak_scores})

        weak_ok, weak_reason = gap.weak_gate(cfg, weak_scores)
        if not weak_ok:                              # compute-saver: skip strong
            rejected_stem = str(cand.get("question", "")).strip()
            feedback = (
                f"Too easy for Weak: {weak_reason}. Regenerate a materially different "
                "question from a deeper cross-image reasoning angle. The rejected question "
                f"was:\n{rejected_stem}\n\n"
                "Do not preserve its target object, decisive attribute, relation structure, "
                "or answer layout. Merely paraphrasing it or shuffling its options is another "
                "failure. Require a new two-step elimination, conjunction, ordering, or "
                "pair/set comparison that combines evidence from at least two images. Keep "
                "every distractor visibly checkable; difficulty must come from reasoning, "
                "not obscure details."
            )
            _persist_round(round_id, example_id, rnd, cand,
                           qv, {"weak_avg": weak_avg}, "too_easy", feedback)
            _emit(run_id, example_id, "round", "improve", {"round": rnd, "reason": "too_easy"})
            continue

        # 4. strong solver rollouts -------------------------------------------
        _emit(run_id, example_id, "strong", "running", {"round": rnd, "k": cfg.k_strong})
        strong_ans = await asyncio.gather(*[
            run_solver(clients["strong"], cand["question"], images, is_mcq=is_mcq)
            for _ in range(cfg.k_strong)])
        strong_scores, strong_j = await _score_mcq_or_judge(
            clients["judge"], cand, images, "strong", strong_ans, run_id, example_id)
        strong_avg = sum(strong_scores) / len(strong_scores) if strong_scores else 0.0
        _emit(run_id, example_id, "strong", "done", {"round": rnd, "avg": strong_avg,
                                                     "scores": strong_scores})

        # 5. decision ----------------------------------------------------------
        judge_verdict = strong_j[0] if strong_j else {}
        decision = gap.decide(cfg, weak_scores, strong_scores, judge_verdict)
        last = {"weak_avg": weak_avg, "strong_avg": strong_avg,
                "gap": strong_avg - weak_avg, "reason": decision.reason}

        _persist_rollouts(round_id, "weak", weak_ans, weak_scores)
        _persist_rollouts(round_id, "strong", strong_ans, strong_scores)

        if decision.accept:
            _persist_round(round_id, example_id, rnd, cand, qv, judge_verdict,
                           "accept", decision.reason)
            _finalize_example(example_id, cand, weak_avg, strong_avg, rnd, decision.reason,
                              "accepted")
            _emit(run_id, example_id, "round", "accepted",
                  {"round": rnd, **last})
            return {"status": "accepted", "rounds": rnd, **last}

        feedback = decision.suggestion or decision.reason
        _persist_round(round_id, example_id, rnd, cand, qv, judge_verdict,
                       "improve", feedback)
        _emit(run_id, example_id, "round", "improve", {"round": rnd, "reason": decision.reason})

    # step budget exhausted
    _finalize_example(example_id, last_cand, last.get("weak_avg"),
                      last.get("strong_avg"), cfg.step_budget,
                      "step budget exhausted", "rejected")
    _emit(run_id, example_id, "round", "rejected", {"reason": "budget_exhausted"})
    return {"status": "rejected", "rounds": cfg.step_budget}


# ------------------------------------------------------------- persistence ---
def _persist_round(round_id, example_id, n, cand, qv, judge, decision, feedback):
    db.execute(
        "INSERT INTO rounds(id, example_id, n, challenger_json, qv_json, judge_json,"
        " decision, feedback, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (round_id, example_id, n, db.j(cand), db.j(qv), db.j(judge),
         decision, feedback, db.now()))


def _persist_rollouts(round_id, role, answers, scores):
    for i, (a, s) in enumerate(zip(answers, scores)):
        db.execute(
            "INSERT INTO rollouts(id, round_id, role, idx, answer, score, created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (db.new_id("roll"), round_id, role, i, a.get("answer", ""), s, db.now()))


def _finalize_example(example_id, cand, weak_avg, strong_avg, rounds, reason, status):
    gap_val = None
    if weak_avg is not None and strong_avg is not None:
        gap_val = strong_avg - weak_avg
    db.execute(
        "UPDATE examples SET status=?, question=?, images_json=?, reference=?,"
        " rubric_json=?, weak_avg=?, strong_avg=?, gap=?, accept_reason=?, rounds=?"
        " WHERE id=?",
        (status, cand.get("question", ""), db.j(cand.get("images", [])),
         cand.get("reference_answer", ""), db.j(cand.get("rubric", [])),
         weak_avg, strong_avg, gap_val, reason, rounds, example_id))
