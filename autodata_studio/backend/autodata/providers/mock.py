"""Deterministic-ish mock provider so the full loop + UI run with no real models.

It inspects the system prompt for a role marker (CHALLENGER / QUALITY VERIFIER /
SOLVER / JUDGE) and returns appropriately-shaped output. Solvers emit a hidden
latent-quality tag ``[[q=0.xx]]`` that the mock judge reads back, so a realistic
weak-vs-strong gap emerges and the acceptance logic exercises multi-round loops.
"""
from __future__ import annotations

import json
import random
import re
import time

from .base import ChatMessage, Completion, LLMClient

_QTAG = re.compile(r"\[\[q=([0-9.]+)\]\]")
_counter = 0


def _rng(*parts) -> random.Random:
    global _counter
    _counter += 1
    return random.Random(hash((_counter, *parts)) & 0xFFFFFFFF)


class MockClient(LLMClient):
    def _role(self, messages: list[ChatMessage]) -> str:
        sys = " ".join(m.content for m in messages if m.role == "system").upper()
        # Match unique opening phrases so mentions like "suggestion_for_challenger"
        # inside the judge prompt don't cause misclassification.
        markers = {
            "YOU ARE THE CHALLENGER": "CHALLENGER",
            "YOU ARE THE QUALITY VERIFIER": "QUALITY VERIFIER",
            "YOU ARE THE JUDGE": "JUDGE",
            "YOU ARE A SOLVER": "SOLVER",
        }
        for phrase, role in markers.items():
            if phrase in sys:
                return role
        return "SOLVER"

    def _last_user(self, messages: list[ChatMessage]) -> ChatMessage:
        for m in reversed(messages):
            if m.role == "user":
                return m
        return messages[-1]

    async def chat(self, messages, temperature=None, max_tokens=None) -> Completion:
        role = self._role(messages)
        rng = _rng(role, self.model, self._last_user(messages).content[:80])
        if role == "CHALLENGER":
            text = self._challenger(rng)
        elif role == "QUALITY VERIFIER":
            text = self._verifier(rng)
        elif role == "JUDGE":
            text = self._judge(rng, self._last_user(messages).content)
        else:
            text = self._solver(rng)
        return Completion(text=text, prompt_tokens=200, completion_tokens=len(text) // 4,
                          latency_ms=rng.uniform(120, 480), model=self.model)

    # -- per-role synthetic outputs ------------------------------------------
    def _challenger(self, rng: random.Random) -> str:
        angles = ["cross-figure comparison", "temporal change across images",
                  "spot-the-difference", "multi-step visual reasoning",
                  "quantitative reading across panels"]
        angle = rng.choice(angles)
        n = rng.randint(10, 14)
        rubric = [{"number": i + 1,
                   "criterion": f"Correctly {('identifies' if i % 2 else 'compares')} "
                                f"visual detail #{i+1} across the referenced images",
                   "category": "positive" if i < n - 3 else "negative",
                   "capability": rng.choice(["cross_image", "counting", "ocr", "reasoning"]),
                   "weight": rng.randint(1, 7) * (1 if i < n - 3 else -1)}
                  for i in range(n)]
        obj = {
            "question_type": angle,
            "context": "The user is looking at a technical answer with several figures.",
            "question": f"Looking at the first and third images, {angle}: what changed "
                        f"and why does it matter for the described method?",
            "reference_answer": "The reference synthesizes evidence spanning at least two "
                                "images, noting the transition shown between them.",
            "rubric": rubric,
        }
        return json.dumps(obj, ensure_ascii=False)

    def _verifier(self, rng: random.Random) -> str:
        # Occasionally fail QV to exercise that branch.
        ok = rng.random() > 0.12
        return json.dumps({
            "check_1_leakage": "NO_LEAKAGE" if ok else "LEAKS_ANSWER",
            "check_2_question": "GOOD" if ok else "TOO_EASY",
            "check_3_rubric": "PASS" if ok else "FAIL",
            "check_multi_image": "REQUIRES_MULTI" if ok else "SINGLE_IMAGE_SOLVABLE",
            "overall": "PASS" if ok else "FAIL",
            "feedback": "" if ok else "Question answerable from a single image; require ≥2.",
        }, ensure_ascii=False)

    def _solver(self, rng: random.Random) -> str:
        weak = "weak" in self.model.lower()
        if weak:
            q = max(0.05, min(0.95, rng.gauss(0.42, 0.16)))
        else:
            q = max(0.05, min(0.98, rng.gauss(0.80, 0.10)))
        depth = "a brief" if weak else "a detailed multi-image"
        return f"[[q={q:.2f}]] Based on the images, {depth} answer comparing the panels."

    def _judge(self, rng: random.Random, user_text: str) -> str:
        m = _QTAG.search(user_text)
        base = float(m.group(1)) if m else rng.uniform(0.3, 0.7)
        # per-criterion binary-ish scores centered on the latent quality
        crits = []
        total = 0
        for i in range(rng.randint(10, 13)):
            hit = 1 if rng.random() < base else 0
            total += hit
            crits.append({"number": i + 1, "score": hit})
        overall = total / max(1, len(crits))
        return json.dumps({
            "criteria": crits,
            "overall": round(overall, 3),
            "weak_pattern": "recites boilerplate" if base < 0.5 else "partial reasoning",
            "strong_pattern": "multi-step visual synthesis",
            "grpo_suitability": "high" if 0.3 < base < 0.75 else "medium",
            "gap_interpretation": "fertile ground for RL" if base < 0.6 else "may be saturated",
            "rubric_concerns": [],
            "verdict": "accept",
        }, ensure_ascii=False)
