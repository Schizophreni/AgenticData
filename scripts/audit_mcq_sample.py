#!/usr/bin/env python3
"""Deterministically sample accepted MCQs and independently audit them with a VLM."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import mimetypes
import os
import random
import re
import urllib.request
from pathlib import Path


AUDIT_PROMPT = """You are an independent, highly skeptical auditor of a multi-image MCQ dataset.
Inspect every supplied image and the complete MCQ. Do not trust the annotated answer.

Evaluate:
1. Are image numbers/references valid and is the question genuinely dependent on at least two images?
2. Is the annotated answer correct and uniquely supported by visible image evidence?
3. Are all A-D claims visually verifiable/refutable, without hidden source text or unsupported world knowledge?
4. If the annotated answer is E, distinguish none_of_above (images determine the fact but A-D are all wrong)
   from insufficient_evidence (the images do not determine the fact).
5. Does wording overclaim abundance, identity, causality, intent, function, chronology, or other facts beyond pixels/OCR?

Severity:
- pass: correct, unique, genuinely multi-image, and well grounded.
- minor: answer remains correct and unique, but wording/format has a localized fixable issue.
- major: wrong/ambiguous answer, fake multi-image dependency, unsupported world knowledge, invalid media reference,
  or an E item whose semantics are wrong.

Return ONLY one compact JSON object:
{"severity":"pass|minor|major","annotated_correct":true|false,"suggested_answer":"A|B|C|D|E|uncertain","multi_image_required":true|false,"world_knowledge_risk":true|false,"issue_types":["..."],"evidence":"brief image-grounded explanation","recommended_fix":"brief fix or empty string"}
"""


def data_uri(path: str) -> str:
    p = Path(path)
    mime = mimetypes.guess_type(p.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def choose_sample(rows: list[dict], seed: int) -> list[dict]:
    rng = random.Random(seed)
    for row in rows:
        row["_audit_key"] = rng.random()

    # Risk-oriented stratification: 70/30 EN/ZH, with E/none-of-above deliberately represented.
    quotas = [("en", "standard", 27), ("en", "none_of_above", 8),
              ("zh", "standard", 13), ("zh", "none_of_above", 2)]
    selected: list[dict] = []
    used: set[str] = set()
    for language, answer_type, count in quotas:
        pool = [r for r in rows if r.get("language") == language and
                r.get("answer_type", "standard") == answer_type]
        # Interleave task types and gap values before using the deterministic random key.
        pool.sort(key=lambda r: (r.get("task_type", ""), round(float(r.get("gap", 0)), 3), r["_audit_key"]))
        stride_order = []
        buckets: dict[tuple, list[dict]] = {}
        for r in pool:
            buckets.setdefault((r.get("task_type"), round(float(r.get("gap", 0)), 3)), []).append(r)
        while buckets and len(stride_order) < count:
            for key in sorted(list(buckets)):
                if buckets[key]:
                    stride_order.append(buckets[key].pop(0))
                    if len(stride_order) == count:
                        break
                if not buckets[key]:
                    del buckets[key]
        for r in stride_order:
            identity = r.get("doc_id", "") + "\0" + r.get("question", "")
            if identity not in used:
                selected.append(r); used.add(identity)
    if len(selected) != 50:
        raise RuntimeError(f"expected 50 samples, got {len(selected)}")
    selected.sort(key=lambda r: r["_audit_key"])
    return selected


def parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I | re.S)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"no JSON object: {text[:200]}")
    return json.loads(text[start:end + 1])


def call_auditor(row: dict, endpoint: str, model: str, api_key_env: str) -> dict:
    question = row["question"]
    if row.get("options") and "\nA." not in question and "\nA、" not in question:
        question += "\n\n" + "\n".join(row["options"])
    text = (f"Annotated answer: {row.get('correct_answer')}\n"
            f"Declared answer_type: {row.get('answer_type', 'standard')}\n"
            f"MCQ:\n{question}")
    content = [{"type": "text", "text": AUDIT_PROMPT + "\n\n" + text}]
    content += [{"type": "image_url", "image_url": {"url": data_uri(p)}} for p in row["images"]]
    payload = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                          "temperature": 0, "max_tokens": 768, "stream": False}).encode()
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get(api_key_env, "") if api_key_env else ""
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(endpoint.rstrip("/") + "/chat/completions", data=payload,
                                 headers=headers)
    with urllib.request.urlopen(req, timeout=600) as response:
        body = json.load(response)
    verdict = parse_json(body["choices"][0]["message"]["content"])
    verdict["auditor_model"] = body.get("model", model)
    verdict["doc_id"] = row.get("doc_id")
    verdict["language"] = row.get("language")
    verdict["task_type"] = row.get("task_type")
    verdict["answer_type"] = row.get("answer_type", "standard")
    verdict["annotated_answer"] = row.get("correct_answer")
    verdict["gap"] = row.get("gap")
    verdict["question"] = row.get("question")
    verdict["images"] = row.get("images")
    return verdict


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--endpoint", default="http://127.0.0.1:8005/v1")
    ap.add_argument("--model", default="qwen3-vl-235b")
    ap.add_argument("--api-key-env", default="")
    ap.add_argument("--seed", type=int, default=20260722)
    ap.add_argument("--concurrency", type=int, default=2)
    args = ap.parse_args()
    rows = [json.loads(line) for line in args.input.open(encoding="utf-8") if line.strip()]
    sample = choose_sample(rows, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(args.concurrency)
    done = 0

    async def audit(index: int, row: dict) -> tuple[int, dict]:
        nonlocal done
        async with semaphore:
            verdict = await asyncio.to_thread(
                call_auditor, row, args.endpoint, args.model, args.api_key_env
            )
            done += 1
            print(f"AUDIT {done}/50 doc={row.get('doc_id')} severity={verdict.get('severity')}", flush=True)
            return index, verdict

    results = await asyncio.gather(*(audit(i, row) for i, row in enumerate(sample)))
    results.sort()
    with args.output.open("w", encoding="utf-8") as f:
        for _, verdict in results:
            f.write(json.dumps(verdict, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
