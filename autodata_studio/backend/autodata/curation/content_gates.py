"""Deterministic content gates for failure modes that prompts alone cannot enforce."""
from __future__ import annotations

import re
from typing import Any


_CLOCK_TERMS = re.compile(
    r"\b(?:clock|clocks|hour|hours|minute hand|hour hand|o['’]?clock|what time)\b"
    r"|时钟|钟面|表盘|时针|分针|小时|点钟|几点"
)


def has_unverified_iconqa_clock_reasoning(
    text: str,
    relation_map: dict[str, Any] | None,
) -> bool:
    """Return true when an IconQA clock claim lacks enumerated pixel values.

    IconQA's ``source_answer_index`` labels the hidden original task. It cannot
    verify a newly invented before/after or clock-comparison question. Such
    questions are allowed only when the relation extractor has explicitly
    recorded per-image numeric values for deterministic checking.
    """
    relation_map = relation_map or {}
    if str(relation_map.get("source", "")).casefold() != "iconqa":
        return False
    if relation_map.get("numeric_values"):
        return False
    return bool(_CLOCK_TERMS.search(str(text)))
