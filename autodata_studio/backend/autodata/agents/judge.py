"""Judge agent: quality verification + rubric scoring of a solver answer."""
from __future__ import annotations

from ..providers.base import ChatMessage, LLMClient
from . import prompts
from .parsing import extract_json


def _as_dict(obj, fallback: dict) -> dict:
    """Models sometimes wrap the verdict in an array; unwrap rather than crash the example."""
    if isinstance(obj, list):
        obj = next((x for x in obj if isinstance(x, dict)), None)
    return obj if isinstance(obj, dict) else fallback


async def run_quality_verifier(client: LLMClient, cand: dict, images: list[str]) -> dict:
    mcq = ""
    if cand.get("options") is not None:
        mcq = (f"options: {cand.get('options')}\n"
               f"correct_answer: {cand.get('correct_answer','')}\n"
               f"answerable: {cand.get('answerable', True)}\n")
        mcq += f"answer_type: {cand.get('answer_type', '')}\n"
        if cand.get("relation_map"):
            mcq += f"relation_map: {cand.get('relation_map')}\n"
    user = ChatMessage(
        role="user",
        content=(f"You received {len(images)} source-image attachments. Attachment 1 is "
                 f"Image 1, attachment 2 is Image 2, continuing through Image {len(images)}.\n"
                 "Candidate example:\n"
                 f"question: {cand.get('question','')}\n"
                 f"reference_answer: {cand.get('reference_answer','')}\n"
                 + mcq +
                 f"rubric: {cand.get('rubric', [])}\n\nVerify it."),
        images=images,
    )
    verifier_prompt = (prompts.MCQ_QUALITY_VERIFIER if cand.get("options") is not None
                       else prompts.QUALITY_VERIFIER)
    comp = await client.chat([ChatMessage("system", verifier_prompt), user])
    try:
        obj = extract_json(comp.text)
    except ValueError:
        # No JSON, but the verdict is usually still legible in the prose. Only fail the
        # candidate when the text actually reads as a rejection; a malformed PASS should
        # not cost the example a round.
        low = comp.text.lower()
        failed = "fail" in low and "pass" not in low.split("fail")[0][-40:]
        obj = {"overall": "FAIL" if failed else "PASS",
               "feedback": f"verifier returned no JSON; text: {comp.text[:200]}"}
    obj = _as_dict(obj, {"overall": "PASS", "feedback": "verifier returned a non-object"})
    if cand.get("relation_map"):
        checks = obj.get("checks") if isinstance(obj.get("checks"), dict) else {}
        required = ("reasoning", "grounding", "world_knowledge", "all_images_relevant")
        failed = [name for name in required if str(checks.get(name, "")).upper() != "PASS"]
        if failed:
            obj["overall"] = "FAIL"
            prior = str(obj.get("feedback") or "").strip()
            obj["feedback"] = ((prior + " ") if prior else "") + \
                "Required relation validation failed or was omitted: " + ", ".join(failed)
        truth = obj.get("option_truth_table")
        letters = "ABCD"
        allowed = {"supported", "contradicted", "unknown"}
        normalized = ({letter: str(truth.get(letter, "")).strip().lower() for letter in letters}
                      if isinstance(truth, dict) else {})
        correct = str(cand.get("correct_answer", "")).strip().upper()[:1]
        answer_type = str(cand.get("answer_type", "standard"))
        if set(normalized) != set(letters) or any(v not in allowed for v in normalized.values()):
            truth_error = "option truth table missing or invalid"
        elif answer_type == "none_of_above":
            truth_error = ("none_of_above requires A-D all contradicted"
                           if any(v != "contradicted" for v in normalized.values()) else "")
        else:
            truth_error = ("standard MCQ requires only the annotated A-D answer supported and "
                           "all distractors contradicted"
                           if correct not in letters or any(
                               normalized[l] != ("supported" if l == correct else "contradicted")
                               for l in letters) else "")
        if truth_error:
            obj["overall"] = "FAIL"
            prior = str(obj.get("feedback") or "").strip()
            obj["feedback"] = ((prior + " ") if prior else "") + truth_error
    obj["_latency_ms"] = comp.latency_ms
    return obj


def _weighted_overall(criteria: list[dict], rubric: list[dict]) -> float:
    """Combine per-criterion binary scores with rubric weights (negatives penalize)."""
    by_num = {int(r.get("number", i + 1)): r for i, r in enumerate(rubric)}
    got = 0.0
    pos_total = 0.0
    for c in criteria:
        num = int(c.get("number", 0))
        r = by_num.get(num, {})
        w = int(r.get("weight", 1))
        score = float(c.get("score", 0))
        if w >= 0:
            pos_total += w
            got += w * score
        else:                                   # negative criterion: subtract when it fired
            got += w * score
    return max(0.0, got / pos_total) if pos_total else 0.0


async def run_judge(client: LLMClient, question: str, images: list[str],
                    rubric: list[dict], answer: str) -> dict:
    user = ChatMessage(
        role="user",
        content=(f"Question: {question}\nRubric: {rubric}\n\nSolver answer:\n{answer}\n\n"
                 "Score per criterion and return strict JSON."),
        images=images,
    )
    comp = await client.chat([ChatMessage("system", prompts.JUDGE), user])
    _dud = {"criteria": [], "overall": 0.0, "verdict": "improve",
            "suggestion_for_challenger": "unparseable judge output"}
    try:
        obj = extract_json(comp.text)
    except ValueError:
        obj = dict(_dud)
    obj = _as_dict(obj, dict(_dud))
    if "overall" not in obj and obj.get("criteria"):
        obj["overall"] = _weighted_overall(obj["criteria"], rubric)
    obj["_latency_ms"] = comp.latency_ms
    return obj
