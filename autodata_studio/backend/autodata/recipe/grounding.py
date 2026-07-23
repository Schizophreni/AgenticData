"""Grounding-document loader.

Zhihu adapter: read answer JSONL, extract the interleaved text + <img> URLs in
reading order, resolve each `v2-<hash>` to a local `v2-<hash>_720w.<ext>` file.
If the configured path is unavailable, fall back to synthetic docs so the pipeline
and UI still run end-to-end (mock provider ignores image bytes anyway).
"""
from __future__ import annotations

import base64
import json
import mimetypes
import re
from pathlib import Path
from typing import Iterator

from .. import config

_IMG_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_HASH = re.compile(r"(v2-[0-9a-f]{32})", re.IGNORECASE)
_ATTR = re.compile(r'(?:src|data-actualsrc|data-original)="([^"]+)"', re.IGNORECASE)


def _resolve_local(hashid: str) -> Path | None:
    for d in config.ZHIHU_IMG_DIRS:
        if not d.exists():
            continue
        for ext in ("jpg", "jpeg", "png", "webp", "gif"):
            p = d / f"{hashid}_720w.{ext}"
            if p.exists():
                return p
    return None


def image_to_data_uri(path: Path) -> str | None:
    if not path.exists():
        return None
    mt = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    b = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mt};base64,{b}"


def _parse_zhihu_record(rec: dict, encode: bool) -> dict | None:
    content = rec.get("content", "") or ""
    images: list[str] = []
    seen = set()
    for tag in _IMG_TAG.findall(content):
        attrs = _ATTR.findall(tag)
        hid = None
        for a in attrs:
            if a.startswith("data:"):            # skip SVG placeholder
                continue
            m = _HASH.search(a)
            if m:
                hid = m.group(1).lower()
                break
        if not hid or hid in seen:
            continue
        seen.add(hid)
        local = _resolve_local(hid)
        if not local:
            continue
        images.append(image_to_data_uri(local) if encode else str(local))
    if len(images) < 2:                          # multi-image requirement
        return None
    images = images[:config.MAX_IMAGES_PER_DOC]
    text = re.sub(r"<[^>]+>", " ", content)
    text = re.sub(r"\s+", " ", text).strip()
    title = (rec.get("question", {}) or {}).get("title", "")
    return {"id": "zh_" + str(rec.get("id", len(seen))),
            "text": (title + "\n" + text)[:8000], "images": images}


_SKIP_DIRS = {"img", "img2", "img_zip"}          # ~10M flat files; never walk these


def _jsonl_files(path: Path) -> list[Path]:
    """The corpus root holds the JSONL one level down, beside the image dirs."""
    if path.is_file():
        return [path]
    files = sorted(path.glob("*.jsonl"))
    if files:
        return files
    for d in sorted(p for p in path.iterdir() if p.is_dir() and p.name not in _SKIP_DIRS):
        files.extend(sorted(d.glob("*.jsonl")))
    return files


def _iter_zhihu(path: Path, encode: bool) -> Iterator[dict]:
    files = _jsonl_files(path)
    for f in files:
        try:
            with f.open() as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    doc = _parse_zhihu_record(rec, encode)
                    if doc:
                        yield doc
        except OSError:
            continue


def _svg_placeholder(idx: int, topic: str) -> str:
    fills = ["#16213a", "#1d2545", "#241d3d"]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">'
        f'<rect width="240" height="240" fill="{fills[idx % 3]}"/>'
        f'<rect x="10" y="10" width="220" height="220" fill="none" stroke="#33D1E6" '
        f'stroke-width="1.5" opacity="0.45"/>'
        f'<circle cx="120" cy="118" r="46" fill="none" stroke="#F4A63A" stroke-width="2" opacity="0.6"/>'
        f'<line x1="74" y1="118" x2="166" y2="118" stroke="#33D1E6" stroke-width="1.5" opacity="0.5"/>'
        f'<text x="20" y="40" fill="#F4A63A" font-family="monospace" font-size="15">FIG {idx + 1}</text>'
        f'<text x="20" y="222" fill="#8492AD" font-family="monospace" font-size="10">{topic[:28]}</text>'
        f"</svg>"
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _synthetic(limit: int) -> list[dict]:
    """Placeholder grounding docs with visible labeled figures (no corpus present)."""
    topics = ["cnn training curve", "architecture diagram", "before / after panel",
              "microscopy t0 vs t1", "ui mock vs render", "ablation table"]
    docs = []
    for i in range(limit):
        picks = [topics[(i + k) % len(topics)] for k in range(3)]
        docs.append({"id": f"syn_{i}",
                     "text": f"[synthetic] A technical answer discussing {picks[0]} and "
                             f"{picks[1]}, with multiple figures the reader must compare.",
                     "images": [_svg_placeholder(k, picks[k]) for k in range(3)]})
    return docs


def load_grounding(recipe: dict, limit: int, encode_images: bool = False) -> list[dict]:
    path = Path(recipe.get("data_path", ""))
    docs: list[dict] = []
    if path.exists():
        for doc in _iter_zhihu(path, encode_images):
            docs.append(doc)
            if len(docs) >= limit:
                break
    if not docs:
        docs = _synthetic(limit)
    return docs
