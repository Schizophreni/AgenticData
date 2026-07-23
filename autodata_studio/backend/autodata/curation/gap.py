"""Acceptance modes — the weak-vs-strong gap decision (Autodata core signal).

Three modes, all configurable, matching the paper:
  - verifiable       (Scientific, Fig 15): weak <= W correct, strong >= S correct.
  - rubric_threshold (CS, §3.1):  strong_avg>=floor, weak_avg<ceiling, gap>=min_gap.
  - flexible_judge   (Legal, §3.2): defer to judge's accept/improve verdict.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..models import GapConfig


@dataclass
class Decision:
    accept: bool
    weak_pass: bool           # did weak clear its bar (gate before running strong)?
    reason: str
    suggestion: str = ""


def weak_gate(cfg: GapConfig, weak_scores: list[float]) -> tuple[bool, str]:
    """Compute-saver gate (paper §3.1): only run the strong solver if weak passes."""
    if not weak_scores:
        return False, "no weak rollouts"
    if cfg.mode == "verifiable":
        n_correct = sum(1 for s in weak_scores if s >= 0.5)
        ok = n_correct <= cfg.weak_max_correct
        return ok, f"weak correct={n_correct} (max {cfg.weak_max_correct})"
    if cfg.mode == "rubric_threshold":
        avg = sum(weak_scores) / len(weak_scores)
        ok = avg < cfg.weak_ceiling
        return ok, f"weak_avg={avg:.3f} (ceiling {cfg.weak_ceiling})"
    return True, "flexible: defer to judge"   # flexible mode always runs strong


def decide(cfg: GapConfig, weak_scores: list[float], strong_scores: list[float],
           judge_verdict: dict) -> Decision:
    weak_avg = sum(weak_scores) / len(weak_scores) if weak_scores else 0.0
    strong_avg = sum(strong_scores) / len(strong_scores) if strong_scores else 0.0

    if cfg.mode == "verifiable":
        wc = sum(1 for s in weak_scores if s >= 0.5)
        sc = sum(1 for s in strong_scores if s >= 0.5)
        score_gap = strong_avg - weak_avg
        gap_ok = score_gap + 1e-9 >= cfg.min_gap
        ok = (wc <= cfg.weak_max_correct and sc >= cfg.strong_min_correct and gap_ok)
        reason = (f"weak {wc}≤{cfg.weak_max_correct} & strong {sc}≥{cfg.strong_min_correct} "
                  f"& gap {score_gap:.3f}≥{cfg.min_gap:.3f}")
        suggestion = ""
        if not ok:
            if sc < cfg.strong_min_correct:
                suggestion = (
                    f"Validation scores: Weak solved {wc}/{len(weak_scores)} and Strong solved "
                    f"only {sc}/{len(strong_scores)} (need at least {cfg.strong_min_correct}). "
                    "Regenerate a materially different question whose keyed answer is "
                    "unambiguous from at least two images. Shorten the inference chain, avoid "
                    "speculative narrative, and make every distractor visually refutable. "
                    "Do not merely paraphrase the previous question."
                )
            elif wc > cfg.weak_max_correct:
                suggestion = (
                    f"Validation scores: Weak solved {wc}/{len(weak_scores)} (maximum "
                    f"{cfg.weak_max_correct}). Regenerate from a deeper cross-image reasoning "
                    "angle; do not merely paraphrase the previous question."
                )
            else:
                suggestion = (
                    f"Validation scores meet the individual bars but the gap is only "
                    f"{score_gap:.3f} (need {cfg.min_gap:.3f}). Regenerate a materially "
                    "different question that increases discrimination between Weak and Strong."
                )
        return Decision(ok, wc <= cfg.weak_max_correct, reason, suggestion)

    if cfg.mode == "rubric_threshold":
        gap = strong_avg - weak_avg
        ok = (strong_avg >= cfg.strong_floor and weak_avg < cfg.weak_ceiling
              and gap >= cfg.min_gap)
        reason = (f"strong_avg={strong_avg:.3f}≥{cfg.strong_floor}, "
                  f"weak_avg={weak_avg:.3f}<{cfg.weak_ceiling}, gap={gap:.3f}≥{cfg.min_gap}")
        sug = ""
        if not ok:
            if weak_avg >= cfg.weak_ceiling:
                sug = "too easy for weak — new question from a deeper reasoning angle"
            elif strong_avg < cfg.strong_floor:
                sug = "strong also fails — make it more tractable for a careful reasoner"
            else:
                sug = "insufficient gap — increase discrimination between solvers"
        return Decision(ok, weak_avg < cfg.weak_ceiling, reason, sug)

    # flexible_judge: trust the judge's verdict (default improve when uncertain)
    verdict = str(judge_verdict.get("verdict", "improve")).lower()
    ok = verdict == "accept"
    reason = (f"judge={verdict}; grpo_suitability={judge_verdict.get('grpo_suitability','?')}; "
              f"strong_avg={strong_avg:.3f} weak_avg={weak_avg:.3f}")
    return Decision(ok, True, reason,
                    "" if ok else judge_verdict.get("suggestion_for_challenger",
                                                     "improve discrimination"))
