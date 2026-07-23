-- AutoData Studio storage schema (SQLite)
CREATE TABLE IF NOT EXISTS recipes (
    id                TEXT PRIMARY KEY,
    task              TEXT NOT NULL,
    data_path         TEXT NOT NULL,
    modality          TEXT NOT NULL,
    brief_json        TEXT NOT NULL DEFAULT '[]',
    pipeline_json     TEXT NOT NULL DEFAULT '[]',
    gen_rubric        TEXT NOT NULL DEFAULT '',
    quality_rubric    TEXT NOT NULL DEFAULT '[]',
    version           INTEGER NOT NULL DEFAULT 1,
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id                TEXT PRIMARY KEY,
    recipe_id         TEXT NOT NULL,
    role_cfg_json     TEXT NOT NULL,
    gap_cfg_json      TEXT NOT NULL,
    target_n          INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    accepted          INTEGER NOT NULL DEFAULT 0,
    rejected          INTEGER NOT NULL DEFAULT 0,
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS examples (
    id                TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL,
    doc_id            TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress|accepted|rejected
    question          TEXT NOT NULL DEFAULT '',
    images_json       TEXT NOT NULL DEFAULT '[]',
    reference         TEXT NOT NULL DEFAULT '',
    rubric_json       TEXT NOT NULL DEFAULT '[]',
    weak_avg          REAL,
    strong_avg        REAL,
    gap               REAL,
    accept_reason     TEXT NOT NULL DEFAULT '',
    rounds            INTEGER NOT NULL DEFAULT 0,
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
    id                TEXT PRIMARY KEY,
    example_id        TEXT NOT NULL,
    n                 INTEGER NOT NULL,
    challenger_json   TEXT NOT NULL DEFAULT '{}',
    qv_json           TEXT NOT NULL DEFAULT '{}',
    judge_json        TEXT NOT NULL DEFAULT '{}',
    decision          TEXT NOT NULL DEFAULT '',
    feedback          TEXT NOT NULL DEFAULT '',
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rollouts (
    id                TEXT PRIMARY KEY,
    round_id          TEXT NOT NULL,
    role              TEXT NOT NULL,      -- weak|strong
    idx               INTEGER NOT NULL,
    answer            TEXT NOT NULL DEFAULT '',
    score             REAL,
    scores_json       TEXT NOT NULL DEFAULT '{}',
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id                TEXT PRIMARY KEY,
    example_id        TEXT NOT NULL,
    comment           TEXT NOT NULL,
    ratings_json      TEXT NOT NULL DEFAULT '{}',
    applied           INTEGER NOT NULL DEFAULT 0,
    created_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id                TEXT PRIMARY KEY,
    recipe_id         TEXT NOT NULL,
    version           INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'proposed', -- proposed|active|superseded
    base_prompt       TEXT NOT NULL,
    evolved_prompt    TEXT NOT NULL,
    metrics_json      TEXT NOT NULL DEFAULT '{}',
    changes_json      TEXT NOT NULL DEFAULT '[]',
    created_at        REAL NOT NULL,
    activated_at      REAL
);

CREATE INDEX IF NOT EXISTS idx_examples_run ON examples(run_id);
CREATE INDEX IF NOT EXISTS idx_rounds_example ON rounds(example_id);
CREATE INDEX IF NOT EXISTS idx_rollouts_round ON rollouts(round_id);
CREATE INDEX IF NOT EXISTS idx_feedback_example ON feedback(example_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_recipe ON prompt_versions(recipe_id, version);
