# AutoData Studio

Agentic synthetic-data curation + frontend, built on **Autodata / Agentic Self-Instruct**
(Meta FAIR, arXiv 2606.25996v2), adapted for **VLM multi-image** data with the Zhihu corpus
as the first grounding source. See `../docs/PLAN_autodata_studio.md` for the full design.

## What it does

Three panels, mapped one-to-one to the paper:

1. **Source Analysis → Recipe** — profile a data path, autoresearch public quality standards,
   and generate a processing pipeline + generation rubric + quality-assessment rubric.
2. **Curation Loop** — configure the four roles (main / challenger / weak / strong / judge) on
   any provider, set the **gap** acceptance criteria + generation quantity, and watch the
   multi-loop board live. Click any agent node to inspect its inputs/outputs/scores per round.
3. **Preview & Feedback** — preview each generated example with weak/strong/judge scores and the
   gap, then send human feedback back to the main agent (co-improvement).

The **weak-vs-strong gap** is the core keep/discard signal: an example is accepted only when the
strong solver succeeds while the weak solver struggles (three configurable modes from the paper).

## Run it (mock provider — no model endpoints needed)

```bash
# backend
cd backend
pip install -e .            # or: pip install fastapi 'uvicorn[standard]' httpx 'pydantic>=2' python-multipart
python -m autodata          # serves http://localhost:8000

# frontend (separate shell)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :8000)
```

Open http://localhost:5173, click **Analyze source** (works even if the data path is absent —
it falls back to synthetic grounding), then **Start curation run**. The mock provider simulates
realistic weak/strong behavior so the whole loop, SSE stream, and UI run end-to-end.

## Wire real models

Open **⚙ Providers** and set each role:

- **OpenAI-compatible / local vLLM**: provider `openai_compat`, `base_url` e.g.
  `http://localhost:8001/v1`, `model` e.g. `Qwen3.5-VL-7B`, `api_key_env` if needed.
- **Anthropic**: provider `anthropic`, `model` e.g. `claude-...`, `api_key_env=ANTHROPIC_API_KEY`.

Set `is_vlm` on for vision roles. Keys are read from the backend process environment via the
named env var (see `backend/.env.example`).

## Smoke test (engine only, no server)

```bash
cd backend && python tests/smoke.py
```

## Scope (v1)

Inner Agentic Self-Instruct loop + frontend. Deferred to v2: meta-optimization of the agent
prompts, GRPO/RL training on the produced data, dataset-level diversity analysis, CN-CLIP metadata.
