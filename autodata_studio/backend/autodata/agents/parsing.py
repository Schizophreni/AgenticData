"""Robust JSON extraction from model text (handles code fences / surrounding prose)."""
from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_FENCE_OPEN = re.compile(r"^```(?:json)?\s*", re.IGNORECASE)
_MISSING = object()


def extract_json(text: str) -> Any:
    text = text.strip()
    m = _FENCE.search(text)
    if m:
        text = m.group(1).strip()
    else:
        # A generation cut off at max_tokens opens the fence but never closes it.
        text = _FENCE_OPEN.sub("", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Scan every top-level balanced JSON value and keep the LAST one that parses.
    # A thinking model emits a reasoning preamble before the answer, and that prose
    # can contain brace-y fragments ("score is {0.9}"), so first-match grabs the
    # wrong blob; the real answer is the final complete value. raw_decode handles
    # quoted braces correctly and returns the end offset so we skip nested values.
    decoder = json.JSONDecoder()
    last = _MISSING
    i, n = 0, len(text)
    while i < n:
        if text[i] in "{[":
            try:
                obj, end = decoder.raw_decode(text, i)
            except json.JSONDecodeError:
                i += 1
                continue
            last = obj
            i = end
        else:
            i += 1
    if last is not _MISSING:
        return last
    if text[:1] in ("{", "["):
        raise ValueError("model output looks truncated mid-JSON — raise max_tokens "
                         f"(got {len(text)} chars, no balanced close): {text[:120]!r}")
    raise ValueError(f"no JSON found in model output: {text[:200]!r}")
