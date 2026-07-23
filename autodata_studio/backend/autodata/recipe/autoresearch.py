"""Feature 1 — autoresearch: derive a quality-standards brief for the task.

Uses the configured "main" agent to synthesize standards from public papers/reports.
A `search_fn` hook can be injected to ground on live web results (v1.1); without it
the agent reasons from its own knowledge. The mock provider returns a curated brief
of the multi-image-data standards (OBELICS / CoMM / MMDU / Mantis) so demos are real.
"""
from __future__ import annotations

from typing import Awaitable, Callable, Optional

from ..agents.parsing import extract_json
from ..providers.base import ChatMessage, LLMClient

SearchFn = Callable[[str], Awaitable[str]]

_CURATED_MULTIIMAGE = [
    {"claim": "Multi-image QA must require reasoning across >=2 images with explicit "
              "image references (cross-image dependency).", "source": "MMDU / Mantis",
     "confidence": "high"},
    {"claim": "Interleaved image-text corpora (OBELICS/OmniCorpus) skip CLIP filtering; "
              "publish similarity as metadata, optionally gate a high-quality core split.",
     "source": "OBELICS / OmniCorpus", "confidence": "high"},
    {"claim": "The decisive quality step in 2024+ datasets is LLM/VLM coherence review "
              "(CoMM scores Development / Completeness / Image-Text-Interleaving 0-10, keep>=4).",
     "source": "CoMM", "confidence": "high"},
    {"claim": "Hard image rules: short side >=150px, aspect ratio in [0.5,2], format allow-list; "
              "drop images that recur corpus-wide (ads/watermarks).", "source": "OBELICS",
     "confidence": "medium"},
    {"claim": "Deduplicate near-duplicate documents (MinHash); the same question can have "
              "many near-duplicate answers.", "source": "OmniCorpus-CW", "confidence": "medium"},
]

_RESEARCH_SYS = """You research what constitutes HIGH-QUALITY training data for a given
task by recalling public papers, benchmarks and technical reports. Output STRICT JSON:
an array of objects {claim, source, confidence:"high"|"medium"|"low"} — 5 to 8 concrete,
actionable standards specific to the task (not generic advice)."""


async def autoresearch(client: LLMClient, task: str,
                       search_fn: Optional[SearchFn] = None) -> list[dict]:
    context = ""
    if search_fn is not None:
        try:
            context = await search_fn(task)
        except Exception:                        # noqa: BLE001
            context = ""
    user = ChatMessage(role="user",
                       content=f"Task: {task}\n\nWeb findings (may be empty):\n{context}\n\n"
                               "Return the standards JSON.")
    try:
        comp = await client.chat([ChatMessage("system", _RESEARCH_SYS), user])
        obj = extract_json(comp.text)
        if isinstance(obj, list) and obj and isinstance(obj[0], dict):
            return obj
    except Exception:                            # noqa: BLE001
        pass
    return _CURATED_MULTIIMAGE
