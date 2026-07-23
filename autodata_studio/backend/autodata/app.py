"""FastAPI application — the AutoData Studio backend API."""
from __future__ import annotations

import asyncio
import json
import socket
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from . import config, db, events, feedback, prompt_evolution
from .models import (FeedbackRequest, GapConfig, RecipeRequest, RoleBinding,
                     RunRequest)
from .providers import build_client
from .recipe import recipe_builder, source_profiler
from .recipe.autoresearch import autoresearch
from .curation import run_manager

app = FastAPI(title="AutoData Studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=[config.FRONTEND_ORIGIN, "http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

_bg_tasks: set[asyncio.Task] = set()


@app.on_event("startup")
def _startup() -> None:
    db.init()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": "0.1.0"}


@app.get("/api/pipeline-health")
def pipeline_health() -> dict:
    """Cheap local readiness check used by the persistent frontend alert."""
    models = {}
    for role, port in (("weak", 8004), ("strong", 8005), ("challenger_judge", 8007)):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.4):
                models[role] = {"ok": True, "port": port}
        except OSError:
            models[role] = {"ok": False, "port": port}
    status_path = config.DATA_DIR / "mcq_10k.status.json"
    try:
        pipeline = json.loads(status_path.read_text())
    except (OSError, ValueError):
        pipeline = {}
    down = [role for role, state in models.items() if not state["ok"]]
    return {"ok": not down, "down": down, "models": models, "pipeline": pipeline}


_IMG_ROOTS = [p.resolve() for p in config.ZHIHU_IMG_DIRS]


@app.get("/api/image")
def get_image(path: str) -> FileResponse:
    """Serve a grounding image file for browser preview, restricted to allowed roots."""
    try:
        p = Path(path).resolve()
    except (OSError, ValueError):
        raise HTTPException(400, "bad path")
    if not any(str(p).startswith(str(root)) for root in _IMG_ROOTS):
        raise HTTPException(403, "path outside allowed image roots")
    if not p.is_file():
        raise HTTPException(404, "image not found")
    return FileResponse(p)


# ------------------------------------------------------------------ recipes ---
@app.post("/api/recipes")
async def create_recipe(req: RecipeRequest) -> dict:
    profile = source_profiler.profile_source(req.data_path, req.sample_size)
    brief: list[dict] = []
    if req.do_autoresearch:
        main = build_client(req.main)
        brief = await autoresearch(main, req.task)
        await main.aclose()
    recipe = recipe_builder.build_recipe(req.task, req.data_path, profile, brief)
    rid = recipe_builder.save_recipe(recipe)
    return {"recipe": recipe_builder.load_recipe(rid), "profile": profile}


@app.get("/api/recipes")
def list_recipes() -> list[dict]:
    return db.query("SELECT id, task, data_path, modality, version, created_at "
                    "FROM recipes ORDER BY created_at DESC")


@app.get("/api/recipes/{rid}")
def get_recipe(rid: str) -> dict:
    r = recipe_builder.load_recipe(rid)
    if not r:
        raise HTTPException(404, "recipe not found")
    return r


# --------------------------------------------------------- prompt evolution ---
@app.get("/api/prompt-evolution")
def get_prompt_evolution(run_id: str = prompt_evolution.LIVE_RUN) -> dict:
    return prompt_evolution.state(run_id)


@app.post("/api/prompt-evolution/propose")
def propose_prompt_evolution(payload: dict[str, Any]) -> dict:
    try:
        return prompt_evolution.propose(payload.get("run_id") or prompt_evolution.LIVE_RUN)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/api/prompt-evolution/{prompt_id}/activate")
def activate_prompt_evolution(prompt_id: str) -> dict:
    try:
        return prompt_evolution.activate(prompt_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


# --------------------------------------------------------------------- runs ---
@app.get("/api/runs")
def list_runs() -> list[dict]:
    """List active curated datasets; older experiment runs stay archived in SQLite."""
    return db.query(
        "SELECT id, recipe_id, target_n, status, accepted, rejected, created_at "
        "FROM runs WHERE id IN "
        "('run_mcq_live_merged','run_mcq_live_muir','run_mcq_live_iconqa') "
        "ORDER BY created_at DESC"
    )


@app.post("/api/runs")
async def create_run(req: RunRequest) -> dict:
    recipe = recipe_builder.load_recipe(req.recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    run_id = db.new_id("run")
    roles = {k: (v if isinstance(v, RoleBinding) else RoleBinding(**v))
             for k, v in req.roles.items()}
    db.execute(
        "INSERT INTO runs(id, recipe_id, role_cfg_json, gap_cfg_json, target_n, status,"
        " created_at) VALUES (?,?,?,?,?,?,?)",
        (run_id, req.recipe_id, db.j({k: v.model_dump() for k, v in roles.items()}),
         db.j(req.gap.model_dump()), req.target_n, "pending", db.now()))

    task = asyncio.create_task(run_manager.execute_run(
        run_id, recipe, roles, req.gap, req.target_n,
        min(req.max_inflight, config.MAX_INFLIGHT_DOCS)))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return {"run_id": run_id}


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict:
    run_manager.cancel(run_id)
    return {"ok": True}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    row = db.query_one("SELECT * FROM runs WHERE id=?", (run_id,))
    if not row:
        raise HTTPException(404, "run not found")
    row["role_cfg"] = db.unj(row.pop("role_cfg_json"), {})
    row["gap_cfg"] = db.unj(row.pop("gap_cfg_json"), {})
    return row


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str) -> StreamingResponse:
    async def gen():
        async for evt in events.subscribe(run_id):
            yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.get("/api/runs/{run_id}/examples")
def run_examples(run_id: str) -> list[dict]:
    rows = db.query("SELECT id, doc_id, status, question, images_json, weak_avg, strong_avg,"
                    " gap, rounds, accept_reason FROM examples WHERE run_id=? ORDER BY created_at",
                    (run_id,))
    for row in rows:
        row["n_images"] = len(db.unj(row.pop("images_json"), []))
    return rows


# ----------------------------------------------------------------- examples ---
@app.get("/api/examples/{example_id}")
def get_example(example_id: str) -> dict:
    ex = db.query_one("SELECT * FROM examples WHERE id=?", (example_id,))
    if not ex:
        raise HTTPException(404, "example not found")
    ex["images"] = db.unj(ex.pop("images_json"), [])
    ex["rubric"] = db.unj(ex.pop("rubric_json"), [])
    rounds = db.query("SELECT * FROM rounds WHERE example_id=? ORDER BY n", (example_id,))
    for r in rounds:
        r["challenger"] = db.unj(r.pop("challenger_json"), {})
        r["qv"] = db.unj(r.pop("qv_json"), {})
        r["judge"] = db.unj(r.pop("judge_json"), {})
        r["rollouts"] = db.query(
            "SELECT role, idx, answer, score FROM rollouts WHERE round_id=? ORDER BY role, idx",
            (r["id"],))
    ex["rounds_detail"] = rounds
    ex["feedback"] = feedback.list_feedback(example_id)
    return ex


@app.post("/api/examples/{example_id}/feedback")
def post_feedback(example_id: str, req: FeedbackRequest) -> dict:
    if not db.query_one("SELECT id FROM examples WHERE id=?", (example_id,)):
        raise HTTPException(404, "example not found")
    return feedback.submit_feedback(example_id, req)


# ------------------------------------------------------------------- export ---
@app.get("/api/export/{run_id}")
def export_run(run_id: str) -> StreamingResponse:
    rows = db.query("SELECT * FROM examples WHERE run_id=? AND status='accepted'", (run_id,))

    def gen():
        for r in rows:
            yield json.dumps({
                "id": r["id"], "question": r["question"],
                "images": db.unj(r["images_json"], []),
                "reference_answer": r["reference"],
                "rubric": db.unj(r["rubric_json"], []),
                "weak_avg": r["weak_avg"], "strong_avg": r["strong_avg"],
                "gap": r["gap"], "rounds": r["rounds"],
            }, ensure_ascii=False) + "\n"
    return StreamingResponse(gen(), media_type="application/x-ndjson",
                             headers={"Content-Disposition":
                                      f"attachment; filename={run_id}.jsonl"})
