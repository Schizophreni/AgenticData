"""Drives a full curation run: iterate grounding docs with bounded concurrency
until N examples are accepted or the corpus is exhausted."""
from __future__ import annotations

import asyncio

from .. import db, events
from ..models import GapConfig, RoleBinding
from ..providers import build_client
from ..recipe.grounding import load_grounding
from .loop import run_doc_loop

_RUNS: dict[str, "RunState"] = {}


class RunState:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.cancelled = False
        self.accepted = 0
        self.rejected = 0


def cancel(run_id: str) -> None:
    if run_id in _RUNS:
        _RUNS[run_id].cancelled = True


async def execute_run(run_id: str, recipe: dict, roles: dict[str, RoleBinding],
                      cfg: GapConfig, target_n: int, max_inflight: int) -> None:
    state = _RUNS[run_id] = RunState(run_id)
    clients = {r: build_client(b) for r, b in roles.items()}
    db.execute("UPDATE runs SET status='running' WHERE id=?", (run_id,))
    events.publish(run_id, "run.status", {"status": "running", "target": target_n})

    sem = asyncio.Semaphore(max_inflight)
    docs = load_grounding(recipe, limit=target_n * 6)   # headroom for rejects
    tasks: set[asyncio.Task] = set()

    async def process(doc: dict):
        async with sem:
            if state.cancelled or state.accepted >= target_n:
                return
            example_id = db.new_id("ex")
            db.execute(
                "INSERT INTO examples(id, run_id, doc_id, status, created_at)"
                " VALUES (?,?,?,?,?)",
                (example_id, run_id, doc["id"], "in_progress", db.now()))
            events.publish(run_id, "example.start",
                           {"example_id": example_id, "doc_id": doc["id"],
                            "n_images": len(doc.get("images", []))})
            try:
                outcome = await run_doc_loop(run_id, example_id, doc, recipe, clients, cfg)
            except Exception as e:                       # noqa: BLE001
                # Transport/runtime failures are not evidence that the generated
                # example is low quality.  Keep them separate from true curation
                # rejections so model-comparison acceptance rates stay valid.
                outcome = {"status": "error", "error": str(e)}
                db.execute("UPDATE examples SET status='error' WHERE id=?", (example_id,))
                events.publish(run_id, "example.error",
                               {"example_id": example_id,
                                "error": f"{type(e).__name__}: {e}"})
            if outcome["status"] == "accepted":
                state.accepted += 1
            elif outcome["status"] == "rejected":
                state.rejected += 1
            db.execute("UPDATE runs SET accepted=?, rejected=? WHERE id=?",
                       (state.accepted, state.rejected, run_id))
            events.publish(run_id, "example.done",
                           {"example_id": example_id, "status": outcome["status"],
                            "accepted": state.accepted, "rejected": state.rejected,
                            "target": target_n})

    for doc in docs:
        if state.cancelled or state.accepted >= target_n:
            break
        tasks.add(asyncio.create_task(process(doc)))
        # Maintain a sliding window.  The previous implementation queued 3x the
        # concurrency and then waited for the entire wave, leaving two model slots
        # idle whenever one tail example needed several evolution rounds.
        if len(tasks) >= max_inflight:
            done, tasks = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED)
            await asyncio.gather(*done)
    if tasks:
        await asyncio.gather(*tasks)

    status = "cancelled" if state.cancelled else "done"
    db.execute("UPDATE runs SET status=? WHERE id=?", (status, run_id))
    events.publish(run_id, "run.done",
                   {"status": status, "accepted": state.accepted, "rejected": state.rejected})
    for c in clients.values():
        await c.aclose()
