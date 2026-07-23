"""Standalone smoke test: build a recipe, run the curation loop with the mock
provider, and print outcomes + a sample example detail. No server needed."""
import asyncio
import os
import sys
import tempfile

os.environ["AUTODATA_DB"] = os.path.join(tempfile.mkdtemp(), "smoke.sqlite3")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from autodata import db                                           # noqa: E402
from autodata.models import GapConfig, RoleBinding, default_role_cfg  # noqa: E402
from autodata.recipe import recipe_builder, source_profiler       # noqa: E402
from autodata.recipe.autoresearch import autoresearch             # noqa: E402
from autodata.providers import build_client                       # noqa: E402
from autodata.curation import run_manager                         # noqa: E402
from autodata import events                                       # noqa: E402


async def main():
    db.init()
    # Feature 1
    profile = source_profiler.profile_source("/nonexistent/path", sample_size=8)
    print("PROFILE:", profile["modality"], "synthetic=", profile["using_synthetic_fallback"])
    main_client = build_client(RoleBinding())
    brief = await autoresearch(main_client, "multi-image QA over technical answers")
    await main_client.aclose()
    print("BRIEF items:", len(brief))
    recipe = recipe_builder.build_recipe("multi-image QA", "/nonexistent/path", profile, brief)
    rid = recipe_builder.save_recipe(recipe)
    print("RECIPE:", rid, "| pipeline steps:", len(recipe.pipeline_spec),
          "| quality rubric:", len(recipe.quality_rubric))

    # Feature 2 — run with distinct weak/strong mock models so a gap emerges
    roles = default_role_cfg()
    roles["weak"] = RoleBinding(model="mock-weak")
    roles["strong"] = RoleBinding(model="mock-strong")
    cfg = GapConfig(mode="rubric_threshold", k_weak=4, k_strong=3, step_budget=8)

    run_id = db.new_id("run")
    db.execute("INSERT INTO runs(id, recipe_id, role_cfg_json, gap_cfg_json, target_n,"
               " status, created_at) VALUES (?,?,?,?,?,?,?)",
               (run_id, rid, "{}", "{}", 3, "pending", db.now()))

    n_events = {"count": 0}

    async def watch():
        async for evt in events.subscribe(run_id):
            n_events["count"] += 1
            if evt["type"] in ("example.done", "run.done", "round"):
                p = evt["payload"]
                print("EVT", evt["type"], p.get("status", p.get("reason", "")))
            if evt["type"] == "run.done":
                break

    watcher = asyncio.create_task(watch())
    loaded = recipe_builder.load_recipe(rid)
    await run_manager.execute_run(run_id, loaded, roles, cfg, target_n=3, max_inflight=2)
    await watcher

    run = db.query_one("SELECT accepted, rejected, status FROM runs WHERE id=?", (run_id,))
    print("RUN RESULT:", run, "| events seen:", n_events["count"])
    exs = db.query("SELECT id, status, weak_avg, strong_avg, gap, rounds FROM examples"
                   " WHERE run_id=?", (run_id,))
    print("EXAMPLES:", len(exs))
    for e in exs[:5]:
        print("  ", e["status"], "weak=", e["weak_avg"], "strong=", e["strong_avg"],
              "gap=", e["gap"], "rounds=", e["rounds"])
    acc = [e for e in exs if e["status"] == "accepted"]
    assert acc, "expected at least one accepted example"
    print("SMOKE OK")


asyncio.run(main())
