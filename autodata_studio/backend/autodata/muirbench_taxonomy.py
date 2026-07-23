"""MuirBench-aligned image/relation/task constraints for MCQ synthesis.

The benchmark labels are kept verbatim at the metadata boundary.  The generator may
render them as snake-case IDs, but selection is always made from this finite taxonomy.
"""
from __future__ import annotations

from collections.abc import Iterable


IMAGE_TYPES = (
    "Photography",
    "Graphics",
    "Slides",
    "Drone and Satellite",
    "Medical Image",
    "3D View",
    "Map",
    "Video",
    "Meme",
    "Animation",
    "Other",
    "Data Visualization",
)

RELATION_TYPES = (
    "Cropped/Zoomed",
    "Partial Similarity",
    "Ordered_Pages",
    "Object-Multiview",
    "Overall Similarity",
    "Independent",
    "Complementary",
    "Temporal",
    "Scene-Multiview",
    "Narrative",
)

TASK_TYPES = (
    "Image-Text Matching",
    "Diagram Understanding",
    "Difference Spotting",
    "Visual Retrieval",
    "Counting",
    "Attribute Similarity",
    "Scene Understanding",
    "Action Understanding",
    "Geographic Understanding",
    "Visual Grounding",
    "Cartoon Understanding",
    "Ordering",
)

# Exact task support observed in the local MuirBench release.  This is deliberately
# restrictive: a relation is classified before question generation, then limits the
# question family instead of letting Challenger force an attractive but unsupported task.
RELATION_TO_TASKS = {
    "Cropped/Zoomed": ("Diagram Understanding",),
    "Partial Similarity": ("Counting", "Attribute Similarity", "Image-Text Matching"),
    "Ordered_Pages": ("Image-Text Matching", "Difference Spotting", "Counting", "Ordering"),
    "Object-Multiview": ("Visual Retrieval",),
    "Overall Similarity": (
        "Attribute Similarity", "Geographic Understanding", "Difference Spotting"
    ),
    "Independent": ("Image-Text Matching",),
    "Complementary": ("Difference Spotting", "Visual Grounding"),
    "Temporal": ("Action Understanding", "Ordering"),
    "Scene-Multiview": ("Scene Understanding",),
    "Narrative": ("Cartoon Understanding",),
}

# Image-type compatibility is slightly broader than the exact local source/task matrix so
# Zhihu can contribute new examples, while still preventing nonsensical combinations.
IMAGE_TYPE_TO_TASKS = {
    "Photography": (
        "Image-Text Matching", "Difference Spotting", "Counting", "Attribute Similarity",
        "Action Understanding", "Visual Grounding", "Ordering",
    ),
    "Graphics": (
        "Diagram Understanding", "Image-Text Matching", "Difference Spotting", "Counting",
        "Visual Grounding",
    ),
    "Slides": ("Image-Text Matching", "Difference Spotting", "Counting", "Ordering"),
    "Drone and Satellite": (
        "Visual Retrieval", "Geographic Understanding", "Difference Spotting",
    ),
    "Medical Image": ("Image-Text Matching", "Difference Spotting", "Visual Grounding"),
    "3D View": ("Scene Understanding", "Visual Retrieval", "Difference Spotting"),
    "Map": ("Geographic Understanding", "Image-Text Matching", "Difference Spotting"),
    "Video": ("Action Understanding", "Ordering", "Difference Spotting"),
    "Meme": ("Cartoon Understanding", "Ordering", "Image-Text Matching"),
    "Animation": ("Cartoon Understanding", "Action Understanding", "Ordering"),
    "Other": ("Image-Text Matching", "Visual Grounding"),
    "Data Visualization": (
        "Image-Text Matching", "Difference Spotting", "Counting", "Visual Grounding",
    ),
}


def allowed_tasks(image_types: Iterable[str], relations: Iterable[str]) -> list[str]:
    """Return tasks supported by both at least one relation and every selected image type."""
    relation_set: set[str] = set()
    for relation in relations:
        relation_set.update(RELATION_TO_TASKS.get(relation, ()))
    if not relation_set:
        return []

    types = list(dict.fromkeys(image_types))
    if not types or any(image_type not in IMAGE_TYPES for image_type in types):
        return []
    compatible = set(TASK_TYPES)
    for image_type in types:
        compatible &= set(IMAGE_TYPE_TO_TASKS[image_type])
    return [task for task in TASK_TYPES if task in relation_set and task in compatible]

