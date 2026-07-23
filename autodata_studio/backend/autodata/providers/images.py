"""Normalize an image reference to something a VLM provider can consume.

Grounding stores images as data URIs (synthetic) or local file paths (real corpus).
Providers need data URIs or http(s) URLs, so convert local paths to base64 here.
"""
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path


def resolve_image(ref: str) -> str | None:
    if not ref:
        return None
    if ref.startswith("data:") or ref.startswith("http://") or ref.startswith("https://"):
        return ref
    p = Path(ref)
    if p.is_file():
        mt = mimetypes.guess_type(str(p))[0] or "image/jpeg"
        return f"data:{mt};base64," + base64.b64encode(p.read_bytes()).decode()
    return None
