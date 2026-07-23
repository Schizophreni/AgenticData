"""Deterministic content gates for failure modes that prompts alone cannot enforce."""
from __future__ import annotations

import copy
import re
from typing import Any


_CLOCK_TERMS = re.compile(
    r"\b(?:clock|clocks|hour|hours|minute hand|hour hand|o['’]?clock|what time)\b"
    r"|时钟|钟面|表盘|时针|分针|小时|点钟|几点"
)
_FRACTION_REASONING_TERMS = re.compile(
    r"\b(?:fractions?|ratios?|proportions?|relative to|of the whole|"
    r"shaded (?:area|portion))\b"
    r"|比例|分数|几分之|占(?:整个|全体)|涂色部分"
)
_FRACTION_COMPARISON_TERMS = re.compile(
    r"\b(?:compare|same|equal fraction|equivalent|higher|lower|greater|smaller|"
    r"largest|smallest|difference|order(?:ing)?|median|middle|between|outlier|"
    r"closest)\b"
    r"|比较|相同|相等|等值|更高|更低|更大|更小|最大|最小|差|排序|中位|居中|"
    r"介于|异常|最接近"
)
_IMAGE_REFERENCE = re.compile(r"\bimage\s*(\d+)\b|图\s*(\d+)", re.IGNORECASE)
_PARTITION_STEM_SHORTCUT = re.compile(
    r"\b(?:(?:greatest|largest|most|fewest|least|smallest)\s+(?:number\s+of\s+)?"
    r"(?:equal\s+)?(?:parts?|partitions?)|"
    r"(?:divided\s+into|has|with)\s+exactly\s+(?:\d+|one|two|three|four|five|six)"
    r"\s+(?:equal\s+)?(?:parts?|partitions?))\b"
    r"|最多(?:的)?(?:等份|分区)|最少(?:的)?(?:等份|分区)|恰好(?:被)?分成\s*\d+\s*份"
)
_DIRECT_IMAGE_RETRIEVAL = re.compile(
    r"\bwhich\s+(?:of\s+the\s+(?:following|three|four)\s+)?images?\s+(?:shows?|has|is)\b"
    r"|哪(?:一(?:个|张|幅)?|个|张|幅)图(?:像)?(?:显示|具有|是)"
)
_PAIR_STEM = re.compile(
    r"\bwhich\s+pair\s+of\s+images?\b|哪(?:一)?对图(?:像)?"
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


def fraction_shortcut_reason(candidate: dict[str, Any] | None) -> str | None:
    """Explain a routed fraction shortcut that should be rejected pre-VLM."""
    candidate = candidate or {}
    if candidate.get("prompt_pool_id") != "iconqa.diagram.fraction.v1":
        return None
    text = "\n".join(
        [str(candidate.get("question") or "")]
        + [str(option) for option in (candidate.get("options") or [])]
    ).casefold()
    stem = re.split(
        r"\n\s*A\s*[.)、:：]",
        str(candidate.get("question") or ""),
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].casefold()
    refs = {
        int(left or right)
        for left, right in _IMAGE_REFERENCE.findall(text)
        if left or right
    }
    if len(refs) < 2:
        return "fraction task cites fewer than two distinct images"
    if _PARTITION_STEM_SHORTCUT.search(stem):
        return (
            "fraction stem asks for an exact or extreme partition count; adding a "
            "separate ratio clause does not remove this shortcut"
        )
    if not _FRACTION_REASONING_TERMS.search(text):
        return (
            "fraction task does not use a shaded-part/whole ratio; partition-count "
            "or all-shaded retrieval is a forbidden shortcut"
        )
    if not _FRACTION_COMPARISON_TERMS.search(text):
        return "fraction task does not compare derived ratios across images"
    return None


def partition_shortcut_reason(candidate: dict[str, Any] | None) -> str | None:
    """Reject partition questions whose answer is a direct single-image lookup."""
    candidate = candidate or {}
    if candidate.get("prompt_pool_id") != "iconqa.diagram.partition.v1":
        return None
    question = str(candidate.get("question") or "")
    question_parts = re.split(
        r"\n\s*A\s*[.)、:：]",
        question,
        maxsplit=1,
        flags=re.IGNORECASE,
    )
    stem = question_parts[0].casefold()
    if _DIRECT_IMAGE_RETRIEVAL.search(stem):
        return (
            "partition task is a direct single-image retrieval; require a pair/outlier "
            "or a cross-image statement whose truth depends on multiple images"
        )
    refs = {
        int(left or right)
        for left, right in _IMAGE_REFERENCE.findall(stem)
        if left or right
    }
    # Pair-selection and statement-selection stems can refer generically to a pair or
    # a cross-image claim while the concrete dependencies live in their options.
    # Accept either form when at least two alternatives each cite multiple images and
    # the alternatives collectively cover >=3 images.
    option_texts = [str(option) for option in (candidate.get("options") or [])]
    if not option_texts and len(question_parts) == 2:
        option_texts = re.split(
            r"\n\s*[B-E]\s*[.)、:：]",
            question_parts[1],
            flags=re.IGNORECASE,
        )
    option_ref_sets = [
        {
            int(left or right)
            for left, right in _IMAGE_REFERENCE.findall(option)
            if left or right
        }
        for option in option_texts
    ]
    pair_options = [option_refs for option_refs in option_ref_sets if len(option_refs) >= 2]
    pair_refs = set().union(*pair_options) if pair_options else set()
    if len(pair_options) >= 2 and len(pair_refs) >= 3:
        return None
    if len(refs) < 2:
        return "partition task does not explicitly depend on at least two images"
    return None


def sanitize_relation_map_for_generated_task(
    relation_map: dict[str, Any] | None,
) -> dict[str, Any]:
    """Remove hidden original-task labels before generation and verification.

    The source question and answer index are useful provenance, but exposing
    them anchors both Challenger and QV to an unrelated answer position after
    the pipeline writes a new question.
    """
    cleaned = copy.deepcopy(relation_map or {})
    cleaned.pop("source_question", None)
    cleaned.pop("source_answer_index", None)
    for relation in cleaned.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        relation["evidence"] = [
            item
            for item in (relation.get("evidence") or [])
            if "annotated correct candidate" not in str(item).casefold()
        ]
    return cleaned
