"""Deterministic option-count allocation for small MCQ shards."""
from __future__ import annotations

from collections import Counter
import hashlib


def option_count_schedule(size: int, seed: str) -> list[int]:
    """Allocate 3/4/5-option tasks near 12%/48%/40%, with four the largest.

    Production shards are often only 8-12 documents after media deduplication.
    Applying a 25-item modulo pattern independently to every shard never reaches
    its five-option segment. Quotas over the actual shard preserve the intended
    mixture at every practical shard size.
    """
    if size <= 0:
        return []
    three = max(1, round(size * 0.12))
    five = round(size * 0.40)
    four = size - three - five
    while size >= 3 and five >= four and five > 0:
        five -= 1
        four += 1

    values = [3] * three + [4] * four + [5] * five
    order = sorted(
        range(size),
        key=lambda index: hashlib.sha256(
            f"{seed}:option-count:{index}".encode()
        ).digest(),
    )
    result = [4] * size
    for index, value in zip(order, values):
        result[index] = value
    assert Counter(result) == Counter(values)
    return result
