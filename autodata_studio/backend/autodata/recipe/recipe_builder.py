"""Feature 1 — recipe builder: profile + standards brief -> Recipe.

Produces the processing-pipeline spec, the generation-rubric (challenger instructions),
and the quality-assessment rubric (weighted criteria the judge applies)."""
from __future__ import annotations

from .. import db
from ..models import Recipe, RubricItem


def _pipeline_spec(profile: dict) -> list[str]:
    steps = [
        "Hygiene: drop records with <2 resolvable local images; filter SVG placeholders.",
        "Parse: recover interleaved text+image reading order; dedup images by content hash.",
        "Rule curation: image short-side>=150px, AR in [0.5,2], format allow-list; "
        "drop corpus-frequent images (>10 occurrences).",
        "MinHash document dedup (near-duplicate answers under the same question).",
        "VLM review (Agentic Self-Instruct loop): challenger -> QV -> weak/strong solvers "
        "-> judge; keep only weak-vs-strong-separating examples.",
        "Audit + export: JSONL/parquet with per-example scores, gap, and rubric.",
    ]
    if profile.get("modality") == "text":
        steps[0] = "Hygiene: drop empty/near-empty documents; language + length filters."
    return steps


def _generation_rubric(task: str, brief: list[dict]) -> str:
    top = "\n".join(f"- {b.get('claim','')} [{b.get('source','')}]" for b in brief[:6])
    return (f"Generate examples for: {task}\n"
            "Follow these task quality standards derived from the literature:\n" + top +
            "\nEach question must require cross-image reasoning with explicit references and "
            "must not be answerable from a single image or from text alone.")


def _quality_rubric() -> list[RubricItem]:
    items = [
        ("Answer requires synthesizing evidence from >=2 distinct images", "cross_image", 8, "positive"),
        ("Question uses explicit image references (first/second/third image)", "grounding", 5, "positive"),
        ("Reference answer is correct and complete w.r.t. the images", "correctness", 7, "positive"),
        ("Tests reasoning (compare/predict/explain) not recall", "reasoning", 6, "positive"),
        ("Rubric criteria are visually grounded and specific", "rubric_quality", 4, "positive"),
        ("Answer is reconstructable from a single image", "leakage", -6, "negative"),
        ("Answer leaked by the visible context/text", "leakage", -8, "negative"),
        ("Generic answer ignoring the specific images", "generic", -5, "negative"),
    ]
    return [RubricItem(number=i + 1, criterion=c, capability=cap, weight=w, category=cat)
            for i, (c, cap, w, cat) in enumerate(items)]


def build_recipe(task: str, data_path: str, profile: dict, brief: list[dict]) -> Recipe:
    return Recipe(
        task=task,
        data_path=data_path,
        modality=profile.get("modality", "interleaved"),
        brief=brief,
        pipeline_spec=_pipeline_spec(profile),
        generation_rubric=_generation_rubric(task, brief),
        quality_rubric=_quality_rubric(),
    )


def save_recipe(recipe: Recipe) -> str:
    rid = recipe.id or db.new_id("rec")
    recipe.id = rid
    db.execute(
        "INSERT OR REPLACE INTO recipes(id, task, data_path, modality, brief_json,"
        " pipeline_json, gen_rubric, quality_rubric, version, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (rid, recipe.task, recipe.data_path, recipe.modality,
         db.j([b.model_dump() if hasattr(b, "model_dump") else b for b in recipe.brief]),
         db.j(recipe.pipeline_spec), recipe.generation_rubric,
         db.j([r.model_dump() for r in recipe.quality_rubric]),
         recipe.version, db.now()))
    return rid


def load_recipe(rid: str) -> dict | None:
    row = db.query_one("SELECT * FROM recipes WHERE id=?", (rid,))
    if not row:
        return None
    return {
        "id": row["id"], "task": row["task"], "data_path": row["data_path"],
        "modality": row["modality"], "brief": db.unj(row["brief_json"], []),
        "pipeline_spec": db.unj(row["pipeline_json"], []),
        "gen_rubric": row["gen_rubric"],
        "quality_rubric": db.unj(row["quality_rubric"], []),
        "version": row["version"],
    }
