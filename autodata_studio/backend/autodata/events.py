"""In-memory pub/sub event bus feeding the per-run SSE stream.

Every agent state transition (challenger.running, weak.rollout.done, judge.scoring,
round.accepted, ...) is published here and drained by the SSE endpoint so the
frontend can render the multi-loop board live.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any, AsyncIterator

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
_history: dict[str, list[dict]] = defaultdict(list)   # replay buffer for late subscribers
_HISTORY_CAP = 2000


def publish(run_id: str, event_type: str, payload: dict[str, Any]) -> None:
    evt = {"ts": time.time(), "type": event_type, "payload": payload}
    hist = _history[run_id]
    hist.append(evt)
    if len(hist) > _HISTORY_CAP:
        del hist[: len(hist) - _HISTORY_CAP]
    for q in list(_subscribers.get(run_id, ())):
        try:
            q.put_nowait(evt)
        except asyncio.QueueFull:
            pass


async def subscribe(run_id: str, replay: bool = True) -> AsyncIterator[dict]:
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    _subscribers[run_id].add(q)
    try:
        if replay:
            for evt in list(_history.get(run_id, ())):
                yield evt
        while True:
            evt = await q.get()
            yield evt
            if evt["type"] == "run.done":
                break
    finally:
        _subscribers[run_id].discard(q)
