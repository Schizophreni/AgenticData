"""Feature 1 — source profiling: scan the data path, detect modality, compute stats."""
from __future__ import annotations

import statistics
from pathlib import Path

from .grounding import load_grounding


def profile_source(data_path: str, sample_size: int = 24) -> dict:
    p = Path(data_path)
    exists = p.exists()
    recipe_stub = {"data_path": data_path}
    docs = load_grounding(recipe_stub, limit=sample_size)
    synthetic = bool(docs) and docs[0]["id"].startswith("syn_")
    img_counts = [len(d.get("images", [])) for d in docs]
    text_lens = [len(d.get("text", "")) for d in docs]

    def _stats(xs):
        return {"min": min(xs), "max": max(xs),
                "median": statistics.median(xs),
                "mean": round(statistics.fmean(xs), 1)} if xs else {}

    modality = "interleaved" if img_counts and max(img_counts) > 0 else "text"
    return {
        "data_path": data_path,
        "path_exists": exists,
        "using_synthetic_fallback": synthetic,
        "sampled_docs": len(docs),
        "modality": modality,
        "images_per_doc": _stats(img_counts),
        "text_length": _stats(text_lens),
        "multi_image_fraction": round(
            sum(1 for c in img_counts if c >= 2) / len(img_counts), 3) if img_counts else 0.0,
    }
