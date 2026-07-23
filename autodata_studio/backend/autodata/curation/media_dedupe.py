"""Content-based media deduplication helpers for resumable generation."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterable


def file_sha256(path: str | Path) -> bytes:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def filter_unique_image_docs(
    docs: Iterable[dict],
    accepted_images: Iterable[str | Path],
) -> tuple[list[dict], int]:
    """Drop docs containing repeated images, including same bytes at different paths.

    Images from every retained document are reserved immediately, preventing two
    concurrently generated examples in the same shard from reusing an image.
    Missing paths are left for the normal media validator to report.
    """
    reserved = {
        file_sha256(path)
        for path in accepted_images
        if Path(path).is_file()
    }
    kept: list[dict] = []
    skipped = 0
    for doc in docs:
        hashes = [
            file_sha256(path)
            for path in doc.get("images", [])
            if Path(path).is_file()
        ]
        if len(hashes) != len(set(hashes)) or any(item in reserved for item in hashes):
            skipped += 1
            continue
        kept.append(doc)
        reserved.update(hashes)
    return kept, skipped
