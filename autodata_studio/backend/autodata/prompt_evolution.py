"""Rule-based Challenger prompt evolution from QV and weak/strong outcomes.

Evolution itself makes no VLM call: it turns aggregated failure signals into a
small, auditable prompt delta.  A proposed version must be explicitly activated.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from . import config, db

LIVE_RUN = "run_mcq_live_merged"
LIVE_RECIPE = "rec_mcq_live_merged"
BATCH_DB = Path(os.environ.get(
    "AUTODATA_MCQ_BATCH_DB",
    "/tmp/claude-0/-inspire-hdd-project-video-understanding-public-personal-wran-projects-Zhihu/"
    "8015243a-5b19-453d-b06c-99d1b532e25a/scratchpad/batch_mcq_235b.sqlite3",
))
OVERRIDE_PATH = config.DATA_DIR / "mcq_challenger_prompt_override.txt"


def _source(run_id: str) -> tuple[sqlite3.Connection, str, bool]:
    if run_id == LIVE_RUN and BATCH_DB.exists():
        conn = sqlite3.connect(BATCH_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT id FROM runs ORDER BY created_at DESC LIMIT 1").fetchone()
        return conn, row["id"] if row else run_id, True
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn, run_id, True


def analyze(run_id: str) -> dict:
    conn, source_run, close = _source(run_id)
    try:
        decisions = {r["decision"]: r["n"] for r in conn.execute(
            "SELECT rd.decision, COUNT(*) n FROM rounds rd JOIN examples e ON e.id=rd.example_id "
            "WHERE e.run_id=? GROUP BY rd.decision", (source_run,))}
        statuses = {r["status"]: r["n"] for r in conn.execute(
            "SELECT status, COUNT(*) n FROM examples WHERE run_id=? GROUP BY status", (source_run,))}
        scored = conn.execute(
            "SELECT AVG(weak_avg) weak_avg, AVG(strong_avg) strong_avg, AVG(gap) gap_avg, "
            "AVG(rounds) rounds_avg FROM examples WHERE run_id=? AND weak_avg IS NOT NULL",
            (source_run,)).fetchone()
        total_rounds = sum(decisions.values()) or 1
        settled = statuses.get("accepted", 0) + statuses.get("rejected", 0)
        return {
            "run_id": run_id,
            "source_run_id": source_run,
            "examples": statuses,
            "decisions": decisions,
            "qv_fail_rate": decisions.get("qv_fail", 0) / total_rounds,
            "too_easy_rate": decisions.get("too_easy", 0) / total_rounds,
            "strong_fail_rate": decisions.get("improve", 0) / total_rounds,
            "schema_error_rate": decisions.get("challenger_error", 0) / total_rounds,
            "accept_rate": statuses.get("accepted", 0) / settled if settled else 0.0,
            "weak_avg": scored["weak_avg"] if scored else None,
            "strong_avg": scored["strong_avg"] if scored else None,
            "gap_avg": scored["gap_avg"] if scored else None,
            "rounds_avg": scored["rounds_avg"] if scored else None,
        }
    finally:
        if close:
            conn.close()


RULES = {
    "grounding": (
        "QV failures dominate",
        "Before writing options, make an internal evidence table mapping every A-D claim to "
        "a visible fact and image number. Do not emit the table. If any option relies on source "
        "text or an unreadable detail, replace that option before returning JSON.",
    ),
    "difficulty": (
        "Weak solver succeeds too often",
        "Require a two-step evidence chain across at least two images. No option may be selected "
        "from a single salient clue. Make distractors differ from the correct answer by exactly "
        "one visually checkable relation, quantity, direction, or image assignment.",
    ),
    "solvability": (
        "Strong solver fails too often",
        "Prefer clearly legible evidence over obscure OCR. Verify the proposed answer against the "
        "images, eliminate ambiguity between A-D, and simplify the reasoning chain if a careful "
        "strong solver could reasonably choose two options.",
    ),
    "schema": (
        "Challenger schema errors are recurring",
        "Return one JSON object only. Count exactly four substantive A-D options plus E; include "
        "question, options, correct_answer, answerable, answer_type, task_type, reference_answer, "
        "and one letter-check rubric criterion.",
    ),
    "separation": (
        "Observed weak/strong separation is too small",
        "Target a measurable capability split: the question should be solvable by a strong VLM "
        "at least 2/3 times while a weak VLM succeeds at most 1/3 times. Change the reasoning angle "
        "instead of merely making OCR smaller or wording more obscure.",
    ),
}


def _changes(metrics: dict) -> list[dict]:
    selected: list[str] = []
    if metrics["qv_fail_rate"] >= 0.25:
        selected.append("grounding")
    if metrics["too_easy_rate"] >= 0.10:
        selected.append("difficulty")
    if metrics["strong_fail_rate"] >= 0.10:
        selected.append("solvability")
    if metrics["schema_error_rate"] >= 0.05:
        selected.append("schema")
    if metrics.get("gap_avg") is not None and metrics["gap_avg"] < 1 / 3:
        selected.append("separation")
    if not selected:
        selected.append("separation")
    return [{"key": key, "reason": RULES[key][0], "instruction": RULES[key][1]}
            for key in selected[:3]]


def _recipe_id(run_id: str) -> str:
    row = db.query_one("SELECT recipe_id FROM runs WHERE id=?", (run_id,))
    return row["recipe_id"] if row else LIVE_RECIPE


def _runtime_prompt() -> str | None:
    """Return the prompt actually saved by the latest production batch.

    The merged frontend recipe deliberately has only a short display rubric; it
    must never be used as the evolution baseline.
    """
    if not BATCH_DB.exists():
        return None
    conn = sqlite3.connect(BATCH_DB, timeout=10)
    try:
        row = conn.execute(
            "SELECT gen_rubric FROM recipes ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        return str(row[0]) if row and row[0] else None
    finally:
        conn.close()


def _canonical_base_prompt(runtime_prompt: str) -> str:
    """Remove the currently active model-facing evolution suffix, if present."""
    if not OVERRIDE_PATH.exists():
        return runtime_prompt.rstrip()
    active = OVERRIDE_PATH.read_text().strip()
    prompt = runtime_prompt.rstrip()
    if active and prompt.endswith(active):
        return prompt[:-len(active)].rstrip()
    return prompt


def _compose_model_prompt(base: str, changes: list[dict]) -> str:
    instructions = _instructions(changes).strip()
    return base.rstrip() + (("\n\n" + instructions) if instructions else "")


def _delta(version: int, changes: list[dict], *, active: bool = False) -> str:
    heading = "ACTIVE PROMPT EVOLUTION" if active else "PROMPT EVOLUTION"
    return "=== %s v%d ===\n" % (heading, version) + _instructions(changes)


def _instructions(changes: list[dict]) -> str:
    """Model-facing evolution text; version metadata stays out of the prompt."""
    return "\n".join(
        f"{i + 1}. {c['instruction']}" for i, c in enumerate(changes)
    )


def state(run_id: str) -> dict:
    recipe_id = _recipe_id(run_id)
    runtime_prompt = _runtime_prompt() if run_id == LIVE_RUN else None
    canonical_base = _canonical_base_prompt(runtime_prompt) if runtime_prompt else None
    rows = db.query(
        "SELECT id,recipe_id,version,status,base_prompt,evolved_prompt,metrics_json,changes_json,"
        "created_at,activated_at "
        "FROM prompt_versions WHERE recipe_id=? ORDER BY version DESC", (recipe_id,))
    for row in rows:
        row["metrics"] = db.unj(row.pop("metrics_json"), {})
        row["changes"] = db.unj(row.pop("changes_json"), [])
        # Evolution replaces the prior evolution suffix; it never appends a
        # second copy. Reconstruct old/new from the actual production prompt so
        # legacy proposals also render correctly without mutating audit rows.
        if runtime_prompt and canonical_base:
            row["base_prompt"] = canonical_base if row["status"] == "active" else runtime_prompt
            row["evolved_prompt"] = _compose_model_prompt(canonical_base, row["changes"])
    return {"recipe_id": recipe_id, "metrics": analyze(run_id), "versions": rows,
            "override_path": str(OVERRIDE_PATH)}


def propose(run_id: str) -> dict:
    recipe_id = _recipe_id(run_id)
    recipe = db.query_one("SELECT gen_rubric,version FROM recipes WHERE id=?", (recipe_id,))
    if not recipe:
        raise ValueError("recipe not found")
    current_prompt = (_runtime_prompt() if run_id == LIVE_RUN else None) or recipe["gen_rubric"]
    canonical_base = _canonical_base_prompt(current_prompt) if run_id == LIVE_RUN else current_prompt
    metrics = analyze(run_id)
    changes = _changes(metrics)
    current = db.query_one("SELECT MAX(version) v FROM prompt_versions WHERE recipe_id=?", (recipe_id,))
    version = max(int(recipe["version"]), int((current or {}).get("v") or 0)) + 1
    evolved = _compose_model_prompt(canonical_base, changes)
    pid = db.new_id("prompt")
    db.execute(
        "INSERT INTO prompt_versions(id,recipe_id,version,status,base_prompt,evolved_prompt,"
        "metrics_json,changes_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (pid, recipe_id, version, "proposed", current_prompt, evolved,
         db.j(metrics), db.j(changes), db.now()))
    return {"id": pid, "version": version, "status": "proposed",
            "metrics": metrics, "changes": changes}


def activate(prompt_id: str) -> dict:
    row = db.query_one("SELECT * FROM prompt_versions WHERE id=?", (prompt_id,))
    if not row:
        raise ValueError("prompt version not found")
    db.execute("UPDATE prompt_versions SET status='superseded' WHERE recipe_id=? AND status='active'",
               (row["recipe_id"],))
    db.execute("UPDATE prompt_versions SET status='active',activated_at=? WHERE id=?",
               (db.now(), prompt_id))
    db.execute("UPDATE recipes SET gen_rubric=?,version=? WHERE id=?",
               (row["evolved_prompt"], row["version"], row["recipe_id"]))
    # The scratch MCQ runner appends only the audited delta to its full MCQ base prompt
    # on its NEXT process start (never hot-swap a prompt inside an active batch).
    changes = db.unj(row["changes_json"], [])
    # Do not spend model context on audit metadata such as
    # "=== ACTIVE PROMPT EVOLUTION v9 ===". Version/status remain in SQLite.
    delta = _instructions(changes)
    OVERRIDE_PATH.write_text(delta)
    return {"id": prompt_id, "status": "active", "version": row["version"],
            "applies_to": "next run", "override_path": str(OVERRIDE_PATH)}
