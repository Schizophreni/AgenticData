"""Type-routed Challenger prompt pool for multi-image MCQ synthesis."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Any

from .muirbench_taxonomy import TASK_TYPES


@dataclass(frozen=True)
class PromptSpec:
    id: str
    task_type: str
    instruction: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


TASK_PROMPTS: dict[str, PromptSpec] = {
    "Image-Text Matching": PromptSpec(
        "muir.image_text_matching.v1", "Image-Text Matching",
        "Match visible text or labels to the correct image only after comparing at least two "
        "attachments. Use exact readable evidence; never reconstruct hidden source prose.",
    ),
    "Diagram Understanding": PromptSpec(
        "muir.diagram.generic.v1", "Diagram Understanding",
        "Compare two directly visible diagram attributes across multiple images. Prefer a "
        "conjunction, ranking, or elimination chain; do not reuse an original answer position.",
    ),
    "Difference Spotting": PromptSpec(
        "muir.difference_spotting.v1", "Difference Spotting",
        "Ask about one precise, localized difference after first establishing a shared visual "
        "baseline. Distractors must reverse exactly one visible attribute or image assignment.",
    ),
    "Visual Retrieval": PromptSpec(
        "muir.visual_retrieval.v1", "Visual Retrieval",
        "Define a query by at least two visible attributes, then retrieve the unique matching "
        "view. Do not use filenames, source order, identity, or outside object knowledge.",
    ),
    "Counting": PromptSpec(
        "muir.counting.v1", "Counting",
        "Count the same clearly bounded visual unit in at least two images, then compare, sum, "
        "or take a visible difference. Avoid occluded, overlapping, or ambiguous instances.",
    ),
    "Attribute Similarity": PromptSpec(
        "muir.attribute_similarity.v1", "Attribute Similarity",
        "Compare a named visible attribute under a consistent reference frame and identify the "
        "unique pair or outlier. Require two attributes when one alone would be a shortcut.",
    ),
    "Scene Understanding": PromptSpec(
        "muir.scene_understanding.v1", "Scene Understanding",
        "Integrate complementary viewpoints using only visible scene layout and object position. "
        "Do not infer unseen identity, causality, intent, or events between views.",
    ),
    "Action Understanding": PromptSpec(
        "muir.action_understanding.v1", "Action Understanding",
        "Use only actions visibly demonstrated across temporal frames. Ask for a transition or "
        "state change supported by both endpoints; never invent an intervening event.",
    ),
    "Geographic Understanding": PromptSpec(
        "muir.geographic_understanding.v1", "Geographic Understanding",
        "Compare visible map or aerial structures with an explicit orientation and scale cue. "
        "Do not name a place unless its name is readable in an attachment.",
    ),
    "Visual Grounding": PromptSpec(
        "muir.visual_grounding.v1", "Visual Grounding",
        "Ground a two-attribute description to one unique region or image after contrasting it "
        "with another attachment. Every spatial term needs an explicit visual reference frame.",
    ),
    "Cartoon Understanding": PromptSpec(
        "muir.cartoon_understanding.v1", "Cartoon Understanding",
        "Use visible panel content, expressions, speech text, or repeated entities. Do not infer "
        "unstated motives; if ordering matters, require multiple explicit panel cues.",
    ),
    "Ordering": PromptSpec(
        "muir.ordering.v1", "Ordering",
        "Derive an order only from explicit visible sequence cues or state changes in multiple "
        "images. Reject chronology based solely on attachment order.",
    ),
}


ICONQA_PROMPTS: dict[str, PromptSpec] = {
    "counting": PromptSpec(
        "iconqa.diagram.counting.v1", "Diagram Understanding",
        "Count one clearly defined shape or mark in each candidate, then ask for a comparison or "
        "two-step difference. Internally recount every candidate; use no answer-position prior.",
    ),
    "fraction": PromptSpec(
        "iconqa.diagram.fraction.v1", "Diagram Understanding",
        "Read both the number of equal partitions and the number visibly shaded in each image. "
        "Compare ratios rather than raw shaded-piece counts; verify equality of partitions.",
    ),
    "geometry": PromptSpec(
        "iconqa.diagram.geometry.v1", "Diagram Understanding",
        "Compare at least two visible geometric properties such as shape, side count, line "
        "orientation, partition, or symmetry. Do not infer a property not drawn in the pixels.",
    ),
    "object_shape": PromptSpec(
        "iconqa.diagram.object_shape.v1", "Diagram Understanding",
        "Compare the visible silhouette and component geometry of real objects across all "
        "candidates. Describe cylindrical, spherical, conical, or box-like appearance only when "
        "visually clear; require elimination by two shape cues and do not count rounded edges as "
        "straight polygon sides.",
    ),
    "spatial": PromptSpec(
        "iconqa.diagram.spatial.v1", "Diagram Understanding",
        "Use an explicit frame to compare inside/outside, left/right, above/below, overlap, or "
        "relative position across images. Make exactly one relation differ in each distractor.",
    ),
    "pattern": PromptSpec(
        "iconqa.diagram.pattern.v1", "Diagram Understanding",
        "Identify a visibly repeated pattern or transformation across candidates, then test a "
        "two-step rule. Do not treat candidate order as temporal evidence.",
    ),
    "measurement": PromptSpec(
        "iconqa.diagram.measurement.v1", "Diagram Understanding",
        "Rank or compare visibly encoded length, area, height, or size. Use exact quantities only "
        "when tick marks or numeric labels are readable; otherwise ask ordinal comparisons.",
    ),
    "generic": TASK_PROMPTS["Diagram Understanding"],
}


_ICONQA_FAMILY_PATTERNS = (
    ("fraction", re.compile(
        r"\b(?:fraction|half|third|fourth|equal parts?|shaded|numerator|denominator)\b"
        r"|分数|几分之|平均分|涂色|阴影"
    )),
    ("counting", re.compile(
        r"\b(?:how many|count|number of|total number|fewer|more objects?)\b"
        r"|多少个|数一数|数量|总数"
    )),
    ("spatial", re.compile(
        r"\b(?:left|right|above|below|inside|outside|between|overlap|position)\b"
        r"|左边|右边|上方|下方|里面|外面|中间|重叠|位置"
    )),
    ("object_shape", re.compile(
        r"\b(?:object (?:is )?shaped like|shaped like|three-dimensional shape|3d shape|"
        r"cylinder|sphere|cone|cube|pyramid)\b"
        r"|物体.*形状|圆柱体|球体|圆锥体|立方体|棱锥"
    )),
    ("geometry", re.compile(
        r"\b(?:shape|triangle|rectangle|square|circle|polygon|side|corner|angle|symmetr)"
        r"|形状|三角形|长方形|正方形|圆形|多边形|边|角|对称"
    )),
    ("pattern", re.compile(
        r"\b(?:pattern|sequence|repeat|next|alternat)\b"
        r"|规律|序列|重复|下一个|交替"
    )),
    ("measurement", re.compile(
        r"\b(?:longer|shorter|taller|wider|heavier|lighter|area|perimeter|measure|size)\b"
        r"|更长|更短|更高|更宽|更重|更轻|面积|周长|测量|大小"
    )),
)


def classify_iconqa_family(source_metadata: dict[str, Any] | None) -> str:
    """Classify hidden IconQA metadata into a prompt family without exposing it."""
    question = str((source_metadata or {}).get("question", "")).casefold()
    for family, pattern in _ICONQA_FAMILY_PATTERNS:
        if pattern.search(question):
            return family
    return "generic"


def select_prompt(
    relation_map: dict[str, Any] | None,
    source_metadata: dict[str, Any] | None = None,
) -> PromptSpec:
    """Select exactly one auditable prompt using source and task taxonomy."""
    relation_map = relation_map or {}
    allowed = list(relation_map.get("allowed_tasks") or [])
    source = str(relation_map.get("source", "")).casefold()
    if source == "iconqa" and "Diagram Understanding" in allowed:
        return ICONQA_PROMPTS[classify_iconqa_family(source_metadata)]
    for task in allowed:
        if task in TASK_PROMPTS:
            return TASK_PROMPTS[task]
    return TASK_PROMPTS["Diagram Understanding"]


def prompt_pool_catalog() -> list[dict[str, str]]:
    """Return stable metadata for UI/docs without duplicate fallback entries."""
    specs = list(TASK_PROMPTS.values()) + [
        spec for key, spec in ICONQA_PROMPTS.items() if key != "generic"
    ]
    return [spec.as_dict() for spec in specs]


assert set(TASK_PROMPTS) == set(TASK_TYPES)
