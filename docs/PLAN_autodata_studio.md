# AutoData Studio — Detailed Build Plan

An agentic synthetic-data-curation product + frontend, built on **Autodata / Agentic
Self-Instruct** (Meta FAIR, arXiv 2606.25996v2, Jun 2026), adapted for **VLM multi-image**
data with the downloaded **Zhihu** corpus as the first grounding source.

> Paper location: `../Agentic_data/agent_data_pipeline.pdf`. Extracted text + all appendix
> system prompts captured during planning.

---

## 0. Decisions locked (2026-07-05)

| Decision | Choice |
|---|---|
| Model serving | **Pluggable provider layer** — OpenAI-compatible, Anthropic, local vLLM interchangeable; configured **per role** in the UI. |
| v1 scope | **Inner Agentic Self-Instruct loop + frontend only.** No RL/GRPO training, no meta-optimization outer loop (both deferred to v2). |
| Primary modality | **VLM multi-image.** Judge + solvers are VLMs; grounding = Zhihu answers + images; output = multi-image QA. Text-only is a degenerate case of the same engine. |
| Stack | **Python / FastAPI** backend, **React + TypeScript (Vite + Tailwind)** frontend, **SSE** for live loop streaming. |

---

## 1. What the paper actually gives us (faithful mapping)

**General Autodata loop:** Data Creation → Data Analysis → recipe update → repeat until
satisfied → emit final dataset. (§2)

**Agentic Self-Instruct** (the concrete impl we build): a **main orchestrator** driving four
subagents (§2.1, Fig. 2):

- **Challenger** — reads grounding material, emits `{context, question, reference_answer,
  weighted rubric}`.
- **Weak solver** — expected to struggle; run `k_weak` rollouts (paper: 3–5).
- **Strong solver** — expected to succeed; run `k_strong` rollouts (paper: 3). May use extra
  inference compute / scaffolding / privileged info; can be the *same* model in a stronger mode.
- **Judge / verifier** — (a) **quality verifier**: checks answer-leakage, recall-vs-reasoning,
  rubric well-formedness; (b) **rubric scorer**: scores each solver rollout per-criterion.

**The gap = the core keep/discard signal.** An example is kept only when the **strong solver
succeeds while the weak solver struggles**. Three acceptance modes appear in the paper — we
expose all three as configurable:

1. **Verifiable** (Scientific, Fig. 15): weak ≤1 correct of 4, strong ≥3 correct of 4.
2. **Rubric-threshold** (CS, §3.1): `strong_avg ≥ 0.65`, `weak_avg < 0.5`, `gap ≥ 0.20`.
   → This is the **"user inputs the gap"** knob (three sliders: strong-floor, weak-ceiling, gap).
3. **Flexible loop-judge** (Legal, §3.2): judge returns `accept | improve` + `grpo_suitability
   (high/med/low)` reasoning about rollout **variance** and gap, **no fixed thresholds**.

**The loop (per grounding document):** challenger → quality-verifier → (if pass) weak rollouts
→ (compute-saver: only if weak passes its bar) strong rollouts → judge scores → apply
acceptance mode → **accept** (write example) or **improve** (targeted feedback to challenger:
which questions were too easy, which failed the strong solver, QV rejections) → new round from a
*different reasoning angle*. Terminate on accept or **step budget** (paper caps 15 improve
rounds; mean 4.98–6.59 rounds/accept). (§3.1, §3.2, Figs. 7 & 10)

**We deliberately do NOT build (v1):** GRPO training, meta-optimization/evolution of the agent
prompts. The appendix system prompts (Figs. 7–15) are transcribed as our starting prompt
templates.

---

## 2. VLM multi-image adaptation (Zhihu)

The paper is text-only; we lift it to vision. Adaptations, grounded in the standards already
established in `docs/PLAN_zhihu_interleave_mmqa.md` and the master snapshot:

- **Grounding document** = one Zhihu answer = interleaved `{text, [image, image, ...]}` in exact
  reading order (parser already prototyped in `scripts/assemble_prototype.py`).
- **Challenger (VLM)** reads text + images, must produce a QA that **spans ≥2 images** with
  **explicit image references** ("in the first image…", "compared to the third figure…") — the
  MMDU/Mantis cross-image requirement. Rubric criteria must reference visual evidence.
- **Solvers (VLMs)** receive `question + image set` (NOT the source text) and answer.
- **Judge (VLM)** scores answers against the rubric with the images in-context.
- **Quality verifier (VLM)** adds vision-specific checks: (a) does answering truly require ≥2
  images (not solvable from one)? (b) no text-leakage of the reference answer; (c) images
  actually present/loadable; (d) rubric criteria are visually grounded, not generic.
- Reuses existing image resolution: `v2-<hash>` → `v2-<hash>_720w.<ext>` local lookup, SVG
  placeholder filtering, dedup (from prototype). Missing-image docs are skipped at grounding.

**Text-only tasks (CS/legal/math like the paper) remain fully supported** — same engine, the
image channel is just empty.

---

## 3. Architecture

```
autodata_studio/
├─ backend/  (FastAPI, async)
│  ├─ app/main.py                 # app, routers, SSE endpoints
│  ├─ providers/                  # PLUGGABLE model layer
│  │   ├─ base.py                 # LLMClient iface: chat(messages, images?) -> completion
│  │   ├─ openai_compat.py        # OpenAI + vLLM/SGLang (base_url override)
│  │   ├─ anthropic.py
│  │   └─ registry.py             # role -> provider+model binding, from run config
│  ├─ agents/
│  │   ├─ challenger.py  solver.py  judge.py  quality_verifier.py
│  │   ├─ orchestrator.py         # the per-doc loop
│  │   └─ prompts/                # editable templates (paper Figs 7-13, VLM-adapted)
│  ├─ recipe/                     # FEATURE 1
│  │   ├─ source_profiler.py      # scan path, detect modality, sample, stats
│  │   ├─ autoresearch.py         # web research -> quality-standards brief
│  │   ├─ recipe_builder.py       # -> pipeline spec + generation rubric + quality rubric
│  │   └─ grounding.py            # Zhihu adapter -> grounding docs
│  ├─ curation/                   # FEATURE 2
│  │   ├─ loop.py                 # acceptance modes + round engine
│  │   ├─ run_manager.py          # N-accepted target, concurrency, budget
│  │   └─ events.py               # per-agent event bus -> SSE
│  ├─ feedback/feedback.py        # FEATURE 3: human comment -> main agent
│  └─ storage/ (SQLite: runs, recipes, docs, examples, rounds, rollouts, scores, feedback)
└─ frontend/  (React + TS, Vite, Tailwind, zustand, SSE)
   └─ src/panels/{SourceAnalysis, CurationLoop, PreviewFeedback}.tsx + ProviderConfig
```

### 3.1 Pluggable provider layer

`LLMClient` interface: `async chat(system, messages, images=None, sampling) -> {text, tokens,
latency, raw}`. Implementations: `openai_compat` (covers OpenAI **and** local vLLM/SGLang via
`base_url`), `anthropic`. A **role registry** maps each of the four roles
(`main | challenger | weak | strong | judge`) to `{provider, model, base_url, api_key_ref,
sampling}` from the run config — so the same run can mix a hosted Kimi-class main agent, a local
vLLM Qwen-VL weak solver, and a large Qwen-VL/GPT strong solver. VLM support = images passed as
content parts (base64 data URIs or URLs) in the unified message schema.

---

## 4. Feature 1 — Local Source Data Analysis → Recipe

**Input:** data path + free-text task description ("build multi-image QA that tests cross-figure
reasoning over Zhihu technical answers").

**Pipeline (streamed to UI as steps):**

1. **Source profiling** (`source_profiler`): sample records at the path, detect format
   (JSONL/parquet/image dir), detect modality (text / images / interleaved), compute stats
   (imgs-per-doc distribution, text length, local-image coverage). Reuses Zhihu parsing.
2. **Autoresearch** (`autoresearch`): agent runs fan-out web search over public papers/technical
   reports for "what is high-quality data for THIS task", fetches + adversarially distills into a
   **quality-standards brief** (this is exactly how the master snapshot's OBELICS/CoMM/MMDU
   standards were derived — we productize that step). Cited, with confidence flags.
3. **Recipe builder** (`recipe_builder`): from profile + brief, emit a structured **Recipe**:
   - **Processing pipeline spec** — the funnel (hygiene → parse → rule-curation → VLM review).
   - **Generation rubric template** — how the challenger should build questions + weighted
     criteria for this task.
   - **Quality-assessment rubric** — weighted criteria to *score* any produced example
     (the same rubric the judge applies), so quality is measurable, not vibes.
4. Recipe is **editable in the UI** before a run and saved (versioned) for reuse.

**Output artifact:** `Recipe {task, data_path, modality, standards_brief[cited],
pipeline_spec, generation_rubric, quality_rubric}` → feeds Feature 2.

---

## 5. Feature 2 — Agentic Data Curation Loop

**Config panel (all user-set):**

- **Role bindings**: main agent, strong solver, weak solver, judge → each pick
  provider+model (LLM or VLM), sampling params. (uses §3.1 registry)
- **Gap config**: acceptance **mode** (verifiable / rubric-threshold / flexible-judge) +, for
  rubric-threshold, the three sliders **strong-floor / weak-ceiling / gap** (defaults 0.65 /
  0.50 / 0.20 from the paper). Rollout counts `k_weak` (3–5), `k_strong` (3). Step budget
  (default 15).
- **Quantity**: target **N accepted examples**; concurrency (docs in flight); optional token/$
  budget cap.

**Engine (`curation/loop.py`, faithful to paper §3.1/§3.2):**

```
for each grounding doc (until N accepted or corpus exhausted):
  round = 0; feedback = None
  while round < step_budget:
    round += 1
    cand = challenger(doc, recipe, feedback)                 # {ctx, Q, images, ref, rubric}
    qv   = quality_verifier(cand, doc)                        # leakage/recall/rubric/vision
    if qv.fail:  feedback = qv.issues;  continue
    weak = [solver(weak_cfg, cand) for _ in range(k_weak)]    # rollouts
    weak_pass = accept_mode.weak_ok(score(judge, weak, cand.rubric))
    if not weak_pass:                                         # compute-saver: skip strong
        feedback = build_feedback(cand, weak, reason="too_easy"); continue
    strong = [solver(strong_cfg, cand) for _ in range(k_strong)]
    verdict = accept_mode.decide(weak_scores, strong_scores, judge)  # accept | improve
    if verdict.accept:
        emit_example(cand, weak, strong, verdict); break
    feedback = verdict.suggestion_for_challenger              # per-mode targeted feedback
  # step-exhaustion -> record as rejected, keep trajectory
```

Every state transition (`challenger.running`, `weak.rollout[2].done`, `judge.scoring`,
`round.accepted`, …) is published on the **event bus** → **SSE** stream per run.

**Frontend viz (`CurationLoopPanel`):**

- A **multi-loop board**: one card per in-flight grounding doc, each showing its current round #,
  live status, and a mini agent-graph (Challenger → [Weak ▮▮▮ · Strong ▮▮▮] → Judge → decision).
- **Click any agent node** → side drawer with that agent's **status**, latest **input** (prompt +
  images), latest **output**, per-rollout scores, tokens, latency, and the round history.
- Global run header: accepted/target counter, rounds histogram, rejection-reason breakdown
  (mirrors paper's "80% too-easy / 13% strong-failed" analytics), spend.

---

## 6. Feature 3 — Preview & Human Feedback (co-improvement)

**`PreviewFeedbackPanel`:**

- **Preview**: rendered example — the image set (thumbnails + lightbox), question, reference
  answer, and the rubric. For multi-image, images numbered to match in-question references.
- **Scores**: side-by-side **weak / strong / judge** — per-rollout bars + per-criterion rubric
  table, the computed **gap**, and the accept reason. (Consistent dataviz styling, light/dark.)
- **Feedback area**: free-text comment + quick structured ratings (question quality, grounding,
  rubric fairness, difficulty-right).
- **"Send feedback to main agent"** button → `feedback/feedback.py` injects the human note into
  the loop as a first-class signal (the paper's **co-improvement** future direction, §6): it is
  appended to the challenger's feedback packet and/or patched into the Recipe's rubric, and the
  affected example is re-queued for a fresh round. This closes the human-in-the-loop.

---

## 7. Data model (SQLite)

`recipes(id, task, data_path, modality, brief_json, pipeline_json, gen_rubric_json,
quality_rubric_json, version)` · `runs(id, recipe_id, role_cfg_json, gap_cfg_json, target_n,
status)` · `docs(id, run_id, source_ref, text, images_json)` · `examples(id, run_id, doc_id,
status, question, images_json, reference, rubric_json, gap, accept_reason)` · `rounds(id,
example_id, n, challenger_json, qv_json, judge_json, decision, feedback)` ·
`rollouts(id, round_id, role, idx, answer, scores_json)` · `feedback(id, example_id, comment,
ratings_json, applied)`.

---

## 8. API surface (FastAPI)

`POST /recipes` (start Feature-1 analysis, SSE progress) · `GET/PUT /recipes/{id}` ·
`GET/PUT /providers` (role/provider config, key management) · `POST /runs` (start curation) ·
`GET /runs/{id}/events` (**SSE** loop stream) · `GET /runs/{id}` · `GET /runs/{id}/examples` ·
`GET /examples/{id}` · `POST /examples/{id}/feedback` (`?apply=true` → back to main agent) ·
`GET /export/{run_id}` (JSONL/parquet of accepted examples).

---

## 9. Build phasing → Conductor waves

| Wave | Branch | Deliverable |
|---|---|---|
| **W1-a** | `provider-layer` | `providers/*` + role registry + VLM message schema; unit-tested against one vLLM + one hosted model. **Foundation, unblocks all.** |
| **W1-b** | `storage-api-skeleton` | SQLite schema, FastAPI app, all endpoints stubbed, SSE event bus. |
| **W2-a** | `curation-engine` | `agents/*` (VLM-adapted prompts) + `curation/loop.py` with all 3 acceptance modes + Zhihu grounding. **Core of the paper.** Depends on W1-a/b. |
| **W2-b** | `recipe-feature1` | source profiler + autoresearch + recipe builder. Depends on W1-a. |
| **W3-a** | `frontend-shell` | React app, provider config, 3-panel layout, SSE client, dataviz theming. |
| **W3-b** | `frontend-loopviz` | multi-loop board + clickable agent drawers (Feature 2 UI). Depends on W2-a events + W3-a. |
| **W3-c** | `frontend-preview` | preview + scores + feedback UI + feedback wiring (Feature 3). Depends on W2-a + W3-a. |
| **W4** | `e2e-zhihu` | end-to-end run on Zhihu grounding, export, tune prompts/thresholds, demo. |

**Critical path:** W1-a → W2-a → W3-b/W3-c → W4. W2-b and the frontend shell parallelize early.

---

## 10. Risks & open items

1. **Cost/latency**: k_weak+k_strong rollouts × ~5 rounds × N examples = many VLM calls.
   Mitigate with the paper's compute-saver (skip strong if weak passes), concurrency caps, and a
   hard budget knob. Surface projected spend before a run.
2. **Reward/judge hacking** (paper §"Hacking"): agents telling the weak solver to be weak, or
   pinning rubrics to trivia. Mitigate with the quality-verifier gates + locked solver prompts +
   human feedback loop as backstop.
3. **VLM grounding faithfulness**: challenger must not leak the answer via the text it saw;
   solvers must get images only. Enforced in the QV.
4. **Image coverage** (from Zhihu work): ~81% local coverage; skip docs with missing images at
   grounding time; log drop counts (no silent truncation).
5. **Provider drift**: different providers' image/token semantics; the `base.py` contract
   normalizes this — keep provider-specific quirks isolated.

---

## 11. Explicitly deferred to v2

Meta-optimization outer loop (evolve agent prompts; paper §4), GRPO/RL training on the produced
data, dataset-level (vs example-level) analysis & diversity stats, CN-CLIP metadata scoring.
```