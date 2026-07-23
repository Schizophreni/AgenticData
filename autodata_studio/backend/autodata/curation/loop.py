"""The per-document Agentic Self-Instruct loop (paper §3.1/§3.2)."""
from __future__ import annotations

import asyncio
import difflib
import re

from .. import db, events
from ..agents.challenger import run_challenger
from ..agents.judge import run_judge, run_quality_verifier
from ..agents.solver import run_solver
from ..models import GapConfig
from ..prompt_pool import select_prompt
from ..providers.base import LLMClient
from . import gap
from .content_gates import fraction_shortcut_reason, partition_shortcut_reason


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


def _normalized_mcq_stem(question: str) -> str:
    """Normalize only the stem so option shuffling cannot masquerade as novelty."""
    stem = re.split(r"\n\s*\n\s*[A-E][\.\)]\s*", str(question or ""), maxsplit=1)[0]
    return "".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", stem.lower()))


def _stem_similarity(left: str, right: str) -> float:
    left_norm = _normalized_mcq_stem(left)
    right_norm = _normalized_mcq_stem(right)
    if not left_norm or not right_norm:
        return 0.0
    return difflib.SequenceMatcher(None, left_norm, right_norm, autojunk=False).ratio()


def _semantic_repeat_feedback(cand: dict, prior_question: str, similarity: float) -> str:
    feedback = (
        f"Semantic-repeat gate failed (stem similarity={similarity:.3f}). "
        "The new question preserves the same visual decision as this earlier one:\n"
        f"{prior_question}\n\n"
        "Choose a genuinely different relation family and target evidence. Do not "
        "repair this by shuffling options, changing the answer letter, adding an "
        "adjective, or restating the same equality/count/orientation test."
    )
    if cand.get("prompt_pool_id") == "iconqa.diagram.partition.v1":
        prior_stem = re.split(
            r"\n\s*\n\s*[A-E][\.\)]\s*", str(prior_question or ""), maxsplit=1
        )[0]
        pair_stem = bool(re.search(
            r"\b(?:which|what)\s+(?:pair|two)\b|哪一对|哪两个|哪组",
            prior_stem,
            re.IGNORECASE,
        ))
        if pair_stem:
            feedback += (
                "\nMANDATORY STRUCTURE SWITCH: the rejected stem is pair-selection. "
                "The replacement stem must begin with 'Which cross-image comparison "
                "statement' (English) or '以下哪项跨图比较陈述' (Chinese), and every "
                "substantive option must be a complete claim comparing at least two "
                "named images. Do not use 'Which pair', 'which two', '哪一对', "
                "'哪两个', or '哪组' anywhere in the new stem. Returning another "
                "pair-selection question is not a valid retry."
            )
        else:
            feedback += (
                "\nMANDATORY STRUCTURE SWITCH: the rejected stem uses comparison "
                "statements. Replace it with pair-selection: every substantive option "
                "must name exactly two images, while the stem asks which pair shares "
                "one visibly checkable partition property."
            )
        feedback += (
            "\nAlso change the visible predicate, choosing only what the pixels "
            "support (for example exact region count, equal-area evidence, congruent "
            "region shape, or divider-line number/orientation). Do not reuse the "
            "previous predicate with synonyms."
        )
    elif cand.get("prompt_pool_id") == "iconqa.diagram.fraction.v1":
        feedback += (
            "\nFor this fraction task, change the ratio operation and stem structure. "
            "If the previous stem asks which statement compares fractions, ask for "
            "an ordering of all named image ratios; if it asks for an ordering, use "
            "cross-image pairwise greater-than/less-than statements. Change the "
            "comparison direction or named image subset only when the pixels support "
            "it. Every substantive option must still compare at least two derived "
            "shaded-part/whole ratios. Do not reuse the generic 'Which statement "
            "correctly compares...' stem or merely paraphrase it."
        )
    return feedback


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
    relation_map = doc.get("_relation_map") or doc.get("relation_map") or {}
    source_metadata = doc.get("_source_metadata") or doc.get("source_metadata")
    prompt_spec = select_prompt(relation_map, source_metadata)
    type_rubric = (
        "\n\n=== TYPE-SPECIFIC SYNTHESIS INSTRUCTIONS ===\n"
        f"Prompt pool route: {prompt_spec.id}\n"
        f"{prompt_spec.instruction}\n"
        "These instructions refine but never override grounding, output schema, language, "
        "option-count, answer-mode, or quality-verification requirements."
    )
    generation_rubric = (recipe.get("gen_rubric", "") + type_rubric).strip()
    feedback = None
    last = {}
    last_cand: dict = {"images": images}
    prior_questions: list[str] = []

    for rnd in range(1, cfg.step_budget + 1):
        round_id = db.new_id("rnd")
        _emit(run_id, example_id, "challenger", "running", {"round": rnd})

        # 1. challenger --------------------------------------------------------
        try:
            cand = await run_challenger(clients["challenger"], doc,
                                        generation_rubric, feedback)
        except Exception as e:                       # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            _emit(run_id, example_id, "challenger", "failed", {"error": err})
            _persist_round(round_id, example_id, rnd, {"error": err}, {}, {},
                           "challenger_error", err)
            feedback = f"previous generation errored: {e}"
            continue
        cand["prompt_pool_id"] = prompt_spec.id
        cand["prompt_pool_task_type"] = prompt_spec.task_type
        rubric = cand.get("rubric", [])
        last_cand = cand
        _emit(run_id, example_id, "challenger", "done",
              {"round": rnd, "question": cand.get("question", "")})

        # Reject same-question rewrites before spending QV or rollout calls. Prompt-only
        # instructions are insufficient: challengers often shuffle options or add one
        # adjective while preserving the same decisive visual relation.
        question = str(cand.get("question", "")).strip()
        prior_match = max(
            ((prior, _stem_similarity(question, prior)) for prior in prior_questions),
            key=lambda item: item[1],
            default=("", 0.0),
        )
        prior_questions.append(question)
        if prior_match[1] >= 0.82:
            feedback = _semantic_repeat_feedback(cand, prior_match[0], prior_match[1])
            _persist_round(
                round_id, example_id, rnd, cand, {},
                {"semantic_similarity": prior_match[1]},
                "semantic_repeat", feedback,
            )
            _emit(run_id, example_id, "round", "improve",
                  {"round": rnd, "reason": "semantic_repeat"})
            continue

        fraction_shortcut = fraction_shortcut_reason(cand)
        partition_shortcut = partition_shortcut_reason(cand)
        shortcut = fraction_shortcut or partition_shortcut
        if shortcut:
            if partition_shortcut:
                gate = "partition_shortcut"
                feedback = (
                    f"Type-specific deterministic gate failed: {partition_shortcut}. "
                    "Keep this as partition geometry, without shading, fractions, "
                    "numerators, or denominators. Ask which pair shares a visible "
                    "division property, which image is the outlier relative to two "
                    "others, or which cross-image statement is true. The answer must "
                    "require checking at least two named images; do not ask which one "
                    "image merely shows equal parts."
                )
            else:
                gate = "fraction_shortcut"
                feedback = (
                    f"Type-specific deterministic gate failed: {fraction_shortcut}. "
                    "Use both shaded numerator and total-part denominator for at least "
                    "two images, then ask for a derived ratio comparison. Use one of "
                    "these structures: 'Which statement correctly compares the shaded "
                    "fractions of Image 1, Image 2, and Image 3?' or 'Which ordering of "
                    "the named image ratios is correct?'. Every substantive option must "
                    "make a cross-image ratio comparison. Never ask which image or pair "
                    "represents one stated fraction, has N shaded parts, or has N total "
                    "parts. Do not repair this by restating most/fewest partitions or "
                    "all-parts-shaded retrieval."
                )
            _persist_round(
                round_id, example_id, rnd, cand, {},
                {"gate": gate, "reason": shortcut},
                "type_gate_fail", feedback,
            )
            _emit(run_id, example_id, "round", "improve",
                  {"round": rnd, "reason": gate})
            continue

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
