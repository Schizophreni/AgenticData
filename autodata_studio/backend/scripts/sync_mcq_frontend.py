#!/usr/bin/env python3
"""Build the frontend-facing MCQ run from the verified 18 + later accepted batches.

The generation jobs use an isolated scratch SQLite database.  This synchronizer
rebuilds one stable run in the Studio database, deduplicating by document/question.
It is safe to run repeatedly while a batch is still producing examples.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "var/autodata.sqlite3"
SCRATCH = Path(os.environ.get(
    "MCQ_SCRATCH",
    "/tmp/claude-0/-inspire-hdd-project-video-understanding-public-personal-wran-projects-Zhihu/"
    "8015243a-5b19-453d-b06c-99d1b532e25a/scratchpad",
))
BATCHES = [
    SCRATCH / "batch_mcq.sqlite3",
    SCRATCH / "batch_mcq_235b.sqlite3",
    ROOT.parent.parent / "datasets/batch_mcq_v2_auditfix.sqlite3",
]
MUIR_BATCHES = [ROOT.parent.parent / "datasets/batch_mcq_muirbench_v1.sqlite3"]
ICONQA_BATCHES = [
    ROOT.parent.parent / "datasets/batch_mcq_iconqa_pilot.sqlite3",
    ROOT.parent.parent / "datasets/batch_mcq_iconqa_v1.sqlite3",
]
EXTRA_JSONL = [SCRATCH / "archive/mcq_continue_start200_7_20260721.jsonl"]
BASE_RUN = "run_mcq18_import_b6ac83a8aefd"
MERGED_RUN = "run_mcq_live_merged"
MERGED_RECIPE = "rec_mcq_live_merged"
MUIR_RUN = "run_mcq_live_muir"
MUIR_RECIPE = "rec_mcq_live_muir"
ICONQA_RUN = "run_mcq_live_iconqa"
ICONQA_RECIPE = "rec_mcq_live_iconqa"
ICONQA_STATUS = ROOT / "var/iconqa_10k.status.json"

# Samples manually removed after review. Keep them out when the live view is
# rebuilt from the immutable base import.
EXCLUDED_DOC_IDS = {"zh_661403423"}


def stable(prefix: str, *parts: object) -> str:
    raw = "\0".join(map(str, parts)).encode()
    return f"{prefix}_{hashlib.sha1(raw).hexdigest()[:16]}"


def connect(path: Path) -> sqlite3.Connection:
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=30000")
    return c


def score_ticks(avg: float | None) -> list[float]:
    if avg is None:
        return []
    correct = max(0, min(3, round(float(avg) * 3)))
    return [1.0] * correct + [0.0] * (3 - correct)


def normalize_legacy_e(candidate: dict) -> dict:
    """Migrate legacy poisoned-option samples to honest none-of-the-above semantics."""
    if candidate.get("answerable") is not False or candidate.get("answer_type"):
        return candidate
    opts = list(candidate.get("options") or [])
    if len(opts) < 5:
        return candidate
    old = "E. Cannot be determined from the given images"
    new = "E. None of the above is correct"
    opts[4] = new
    candidate["options"] = opts
    candidate["question"] = str(candidate.get("question", "")).replace(old, new)
    candidate["correct_answer"] = "E"
    candidate["answerable"] = True
    candidate["answer_type"] = "none_of_above"
    candidate["reference_answer"] = "The correct answer is option E: none of A-D is correct."
    if "reference" in candidate:
        candidate["reference"] = candidate["reference_answer"]
    candidate["rubric"] = [{"number": 1, "criterion": "The final selected option is E",
                              "weight": 10, "category": "positive",
                              "capability": "visual_reasoning"}]
    return candidate


def sync_run(
    *,
    target_run: str,
    target_recipe: str,
    batch_paths: list[Path],
    include_base: bool,
    extra_jsonl_paths: list[Path],
    task_label: str,
    target_hint: int | None = None,
    include_source_rejected: bool = False,
    supervisor_status_path: Path | None = None,
) -> None:
    dst = connect(MAIN)
    src = connect(MAIN)
    batches = [connect(path) for path in batch_paths if path.exists()]
    now = time.time()

    dst.execute("BEGIN IMMEDIATE")
    try:
        dst.execute(
            "INSERT OR REPLACE INTO recipes(id,task,data_path,modality,brief_json,pipeline_json,"
            "gen_rubric,quality_rubric,version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (target_recipe, task_label, "Zhihu", "interleaved",
             "[]", "[]", "MCQ accepted-only live view", "[]", 1, now),
        )

        old_rounds = [r[0] for r in dst.execute(
            "SELECT r.id FROM rounds r JOIN examples e ON e.id=r.example_id WHERE e.run_id=?",
            (target_run,),
        )]
        if old_rounds:
            marks = ",".join("?" for _ in old_rounds)
            dst.execute(f"DELETE FROM rollouts WHERE round_id IN ({marks})", old_rounds)
        dst.execute("DELETE FROM rounds WHERE example_id IN (SELECT id FROM examples WHERE run_id=?)",
                    (target_run,))
        dst.execute("DELETE FROM feedback WHERE example_id IN (SELECT id FROM examples WHERE run_id=?)",
                    (target_run,))
        dst.execute("DELETE FROM examples WHERE run_id=?", (target_run,))

        seen: set[tuple[str, str]] = set()
        accepted = 0

        def add_relational(conn: sqlite3.Connection, run_id: str, source_name: str) -> None:
            nonlocal accepted
            rows = conn.execute(
                "SELECT * FROM examples WHERE run_id=? AND status='accepted' ORDER BY created_at", (run_id,)
            ).fetchall()
            for ex in rows:
                if ex["doc_id"] in EXCLUDED_DOC_IDS:
                    continue
                round_rows = conn.execute(
                    "SELECT * FROM rounds WHERE example_id=? ORDER BY n", (ex["id"],)
                ).fetchall()
                accept_candidate = None
                for rd in round_rows:
                    if rd["decision"] == "accept":
                        try:
                            accept_candidate = normalize_legacy_e(json.loads(rd["challenger_json"] or "{}"))
                        except (TypeError, json.JSONDecodeError):
                            pass
                question = (accept_candidate or {}).get("question", ex["question"])
                key = (ex["doc_id"], question)
                if key in seen:
                    continue
                seen.add(key)
                eid = stable("mcqex", source_name, *key)
                vals = dict(ex)
                vals.update(id=eid, run_id=target_run, status="accepted")
                if accept_candidate:
                    vals["question"] = accept_candidate.get("question", vals["question"])
                    vals["reference"] = accept_candidate.get("reference_answer", vals["reference"])
                    vals["rubric_json"] = json.dumps(accept_candidate.get("rubric", []), ensure_ascii=False)
                cols = ["id", "run_id", "doc_id", "status", "question", "images_json", "reference",
                        "rubric_json", "weak_avg", "strong_avg", "gap", "accept_reason", "rounds", "created_at"]
                dst.execute(f"INSERT INTO examples({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                            [vals.get(c) for c in cols])
                for rd in round_rows:
                    rid = stable("mcqrnd", eid, rd["n"])
                    challenger_json = rd["challenger_json"]
                    try:
                        cand = normalize_legacy_e(json.loads(challenger_json or "{}"))
                        challenger_json = json.dumps(cand, ensure_ascii=False)
                    except (TypeError, json.JSONDecodeError):
                        pass
                    dst.execute(
                        "INSERT INTO rounds(id,example_id,n,challenger_json,qv_json,judge_json,decision,feedback,created_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?)",
                        (rid, eid, rd["n"], challenger_json, rd["qv_json"], rd["judge_json"],
                         rd["decision"], rd["feedback"], rd["created_at"]),
                    )
                    for ro in conn.execute("SELECT * FROM rollouts WHERE round_id=?", (rd["id"],)):
                        dst.execute(
                            "INSERT INTO rollouts(id,round_id,role,idx,answer,score,scores_json,created_at) "
                            "VALUES (?,?,?,?,?,?,?,?)",
                            (stable("mcqroll", rid, ro["role"], ro["idx"]), rid, ro["role"], ro["idx"],
                             ro["answer"], ro["score"], ro["scores_json"], ro["created_at"]),
                        )
                accepted += 1

        if include_base:
            add_relational(src, BASE_RUN, "base18")

        for path in extra_jsonl_paths:
            if not path.exists():
                continue
            for line in path.read_text().splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                row = normalize_legacy_e(row)
                if str(row.get("doc_id", "")) in EXCLUDED_DOC_IDS:
                    continue
                key = (str(row.get("doc_id", "")), str(row.get("question", "")))
                if key in seen:
                    continue
                seen.add(key)
                eid = stable("mcqex", path.name, *key)
                weak, strong = row.get("weak_avg"), row.get("strong_avg")
                dst.execute(
                    "INSERT INTO examples(id,run_id,doc_id,status,question,images_json,reference,rubric_json,"
                    "weak_avg,strong_avg,gap,accept_reason,rounds,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (eid, target_run, key[0], "accepted", key[1], json.dumps(row.get("images", []), ensure_ascii=False),
                     row.get("reference", ""), json.dumps(row.get("rubric", []), ensure_ascii=False), weak, strong,
                     row.get("gap"), "imported accepted MCQ", row.get("rounds", 1), now),
                )
                rid = stable("mcqrnd", eid, 1)
                cand = {k: row.get(k) for k in
                        ("question", "options", "correct_answer", "answerable", "answer_type",
                         "task_type", "reference")}
                cand["reference_answer"] = row.get("reference", "")
                cand["rubric"] = row.get("rubric", [])
                cand["images"] = row.get("images", [])
                dst.execute("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?,?)",
                            (rid, eid, 1, json.dumps(cand, ensure_ascii=False), "{}", "{}", "accept", "", now))
                for role, avg in (("weak", weak), ("strong", strong)):
                    for idx, score in enumerate(score_ticks(avg)):
                        dst.execute("INSERT INTO rollouts VALUES (?,?,?,?,?,?,?,?)",
                                    (stable("mcqroll", rid, role, idx), rid, role, idx, "imported", score, "{}", now))
                accepted += 1

        for index, batch in enumerate(batches):
            # A resumed batch creates a new run in the same SQLite file.  Keep
            # accepted examples from all runs (the `seen` key deduplicates
            # retries) instead of dropping valid data from the interrupted run.
            for run in batch.execute("SELECT id FROM runs ORDER BY created_at"):
                add_relational(batch, run["id"], f"live_batch_{index}_{run['id']}")

        batch_run_count = sum(
            batch.execute("SELECT count(*) FROM runs").fetchone()[0] for batch in batches
        )
        live = any(batch.execute(
            "SELECT 1 FROM runs WHERE status='running' ORDER BY created_at DESC LIMIT 1").fetchone()
            for batch in batches)
        # A shard supervisor briefly has no running database row while it advances
        # the cursor and launches the next child. Preserve the live frontend state
        # across that intentional handoff.
        if supervisor_status_path and supervisor_status_path.exists():
            try:
                supervisor = json.loads(supervisor_status_path.read_text())
                live = live or (
                    supervisor.get("phase") in {
                        "running", "between_shards", "waiting_for_models", "retrying_shard",
                    }
                    and int(supervisor.get("accepted", 0))
                    < int(supervisor.get("target", target_hint or 0))
                )
            except (OSError, ValueError, TypeError):
                pass
        # The standalone generator performs Visual Gate before inserting its run row.
        # Keep the dedicated frontend task visibly running during that pre-run phase.
        if target_hint and batches and batch_run_count == 0:
            live = True
        recorded_targets = [
            int(row[0] or 0)
            for batch in batches
            for row in batch.execute("SELECT target_n FROM runs")
        ]
        target_n = max([accepted, target_hint or 0, *recorded_targets])
        rejected = (
            sum(
                int(row[0] or 0)
                for batch in batches
                for row in batch.execute("SELECT rejected FROM runs")
            )
            if include_source_rejected else 0
        )
        dst.execute(
            "INSERT OR REPLACE INTO runs(id,recipe_id,role_cfg_json,gap_cfg_json,target_n,status,accepted,rejected,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (target_run, target_recipe, "{}", json.dumps({"mode": "verifiable"}), target_n,
             "running" if live else "done", accepted, rejected, now),
        )
        dst.commit()
        print(f"synced {accepted} accepted MCQs into {target_run}; live={live}", flush=True)
    except Exception:
        dst.rollback()
        raise


def main() -> None:
    sync_run(
        target_run=MERGED_RUN,
        target_recipe=MERGED_RECIPE,
        batch_paths=BATCHES,
        include_base=True,
        extra_jsonl_paths=EXTRA_JSONL,
        task_label="Zhihu multi-image MCQ — live accepted dataset",
        target_hint=None,
        include_source_rejected=False,
    )
    sync_run(
        target_run=MUIR_RUN,
        target_recipe=MUIR_RECIPE,
        batch_paths=MUIR_BATCHES,
        include_base=False,
        extra_jsonl_paths=[],
        task_label="Zhihu multi-image MCQ — MuirBench taxonomy",
        target_hint=50,
        include_source_rejected=True,
    )
    sync_run(
        target_run=ICONQA_RUN,
        target_recipe=ICONQA_RECIPE,
        batch_paths=ICONQA_BATCHES,
        include_base=False,
        extra_jsonl_paths=[],
        task_label="IconQA multi-image MCQ — benchmark-aligned Diagram Understanding",
        target_hint=10000,
        include_source_rejected=True,
        supervisor_status_path=ICONQA_STATUS,
    )


if __name__ == "__main__":
    if "--watch" in sys.argv:
        while True:
            try:
                main()
            except Exception as exc:  # keep syncing after transient SQLite/WAL contention
                print(f"sync failed: {type(exc).__name__}: {exc}", flush=True)
            time.sleep(60)
    else:
        main()
