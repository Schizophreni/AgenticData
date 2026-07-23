"""Feature 3 — human feedback ingestion + co-improvement.

Storing feedback always records the comment. When `apply=True`, the human note is
folded back into the recipe's generation rubric (a new recipe version), so the main
agent / challenger incorporate it on subsequent generations — the paper's
co-improvement direction (§6).
"""
from __future__ import annotations

from . import db, events
from .models import FeedbackRequest


def submit_feedback(example_id: str, req: FeedbackRequest) -> dict:
    fid = db.new_id("fb")
    db.execute(
        "INSERT INTO feedback(id, example_id, comment, ratings_json, applied, created_at)"
        " VALUES (?,?,?,?,?,?)",
        (fid, example_id, req.comment, db.j(req.ratings), int(req.apply), db.now()))

    applied_to = None
    if req.apply:
        ex = db.query_one("SELECT run_id FROM examples WHERE id=?", (example_id,))
        if ex:
            run = db.query_one("SELECT recipe_id FROM runs WHERE id=?", (ex["run_id"],))
            if run:
                applied_to = _fold_into_recipe(run["recipe_id"], req.comment)
                events.publish(ex["run_id"], "feedback.applied",
                               {"example_id": example_id, "recipe_id": run["recipe_id"],
                                "comment": req.comment})
    return {"id": fid, "applied": bool(applied_to), "recipe_id": applied_to}


def _fold_into_recipe(recipe_id: str, comment: str) -> str | None:
    row = db.query_one("SELECT gen_rubric, version FROM recipes WHERE id=?", (recipe_id,))
    if not row:
        return None
    new_rubric = (row["gen_rubric"] + "\n\n[Human feedback — apply on future generations]: "
                  + comment.strip())
    db.execute("UPDATE recipes SET gen_rubric=?, version=? WHERE id=?",
               (new_rubric, (row["version"] or 1) + 1, recipe_id))
    return recipe_id


def list_feedback(example_id: str) -> list[dict]:
    return db.query("SELECT * FROM feedback WHERE example_id=? ORDER BY created_at",
                    (example_id,))
