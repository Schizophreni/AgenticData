#!/usr/bin/env python3
"""Prototype: assemble Zhihu answers -> interleaved text-image + multi-image samples.

Read-only over the source. Writes a small sample manifest to --out.
Usage:
  python assemble_prototype.py --limit 3000 --out sample_out
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

from lxml import html as lxml_html

SRC = "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download"
JSONL = os.path.join(SRC, "zhihu_answers", "zhihu_good_answers.jsonl")
IMG_DIRS = [os.path.join(SRC, "img"), os.path.join(SRC, "img2")]

# Every real Zhihu image URL embeds a content hash `v2-<32hex>` (across several
# resolution variants: _720w.jpg via src/data-actualsrc, _r.jpg via data-original).
# Local files are stored as `v2-<hash>_720w.<ext>`, so we key on the hash.
HASH_RE = re.compile(r"(v2-[0-9a-f]{32})", re.I)
IMG_ATTRS = ("data-actualsrc", "src", "data-original", "data-default-watermark-src")
LOCAL_EXTS = ("jpg", "png", "gif", "jpeg", "webp")


class ImgLookup:
    """Resolve basename -> local path by direct stat in each store.
    Avoids scanning the 11.4M-file flat dirs (fine for a sample; a full run
    would build a persistent basename->path index once)."""

    def __init__(self, img_dirs):
        self.dirs = [d for d in img_dirs if os.path.isdir(d)]
        self.cache = {}

    def resolve(self, img_hash):
        """hash -> local path, trying each stored extension. Cached per hash."""
        if img_hash in self.cache:
            return self.cache[img_hash]
        path = None
        for ext in LOCAL_EXTS:
            name = f"{img_hash}_720w.{ext}"
            for d in self.dirs:
                p = os.path.join(d, name)
                if os.path.exists(p):
                    path = p
                    break
            if path:
                break
        self.cache[img_hash] = path
        return path


def img_hash_from_tag(el):
    """Extract the v2-<hash> content id from an <img> tag's URL attributes.
    Returns None for SVG/base64 placeholders or non-image tags (e.g. equations)."""
    for attr in IMG_ATTRS:
        u = el.get(attr) or ""
        if not u or u.startswith("data:"):
            continue
        m = HASH_RE.search(u)
        if m:
            return m.group(1).lower(), u
    return None


def parse_interleaved(content_html, img_index):
    """Walk the HTML in document order, emit a sequence of
    {'type':'text','text':...} and {'type':'image','url':...,'local':...,'present':bool}."""
    try:
        root = lxml_html.fragment_fromstring(content_html, create_parent="div")
    except Exception:
        root = lxml_html.fromstring("<div>" + content_html + "</div>")

    seq = []

    def push_text(t):
        if not t:
            return
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            if seq and seq[-1]["type"] == "text":
                seq[-1]["text"] = (seq[-1]["text"] + " " + t).strip()
            else:
                seq.append({"type": "text", "text": t})

    def walk(el):
        if el.tag == "img":
            hit = img_hash_from_tag(el)
            if hit:
                img_hash, url = hit
                # skip if this exact image was just emitted (placeholder+real dupes)
                if not (seq and seq[-1]["type"] == "image" and seq[-1]["hash"] == img_hash):
                    local = img_index.resolve(img_hash)
                    seq.append({
                        "type": "image",
                        "hash": img_hash,
                        "url": url,
                        "local": local,
                        "present": local is not None,
                    })
            # text tail after img
            push_text(el.tail)
            return
        push_text(el.text)
        for child in el:
            walk(child)
        push_text(el.tail)

    push_text(root.text)
    for child in root:
        walk(child)
    return seq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=3000)
    ap.add_argument("--jsonl", default=JSONL)
    ap.add_argument("--out", default="sample_out")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    print(f"[1/3] image lookup over {IMG_DIRS} (direct stat)", file=sys.stderr)
    img_index = ImgLookup(IMG_DIRS)

    stats = Counter()
    img_total = 0
    img_present = 0
    multi_img_records = 0

    inter_path = os.path.join(args.out, "interleaved_sample.jsonl")
    multi_path = os.path.join(args.out, "multiimage_sample.jsonl")
    fi = open(inter_path, "w")
    fm = open(multi_path, "w")

    with open(args.jsonl) as f:
        for i, line in enumerate(f):
            if i >= args.limit:
                break
            stats["records"] += 1
            try:
                rec = json.loads(line)
            except Exception:
                stats["json_err"] += 1
                continue
            content = rec.get("content") or ""
            q = rec.get("question") or {}
            title = q.get("title") if isinstance(q, dict) else None

            seq = parse_interleaved(content, img_index)
            imgs = [s for s in seq if s["type"] == "image"]
            if not imgs:
                stats["no_image"] += 1
                continue
            # distinct images per record (an image may be referenced twice in body)
            distinct = list(dict.fromkeys(s["hash"] for s in imgs))
            present_hashes = [h for h in distinct
                              if any(s["hash"] == h and s["present"] for s in imgs)]
            stats["with_image"] += 1
            img_total += len(distinct)
            img_present += len(present_hashes)
            if len(distinct) >= 2:
                multi_img_records += 1
            present = [s for s in imgs if s["present"]]

            aid = rec.get("_aid") or rec.get("id")
            # interleaved sample: keep sequence, mark missing images
            fi.write(json.dumps({
                "id": aid,
                "question_title": title,
                "question_url": (q.get("url") if isinstance(q, dict) else None),
                "sequence": seq,
                "n_images": len(distinct),
                "n_images_present": len(present_hashes),
            }, ensure_ascii=False) + "\n")

            # multi-image sample: distinct present images grouped, title as prompt/context
            uniq_present = list(dict.fromkeys(
                s["local"] for s in imgs if s["present"]))
            if uniq_present:
                fm.write(json.dumps({
                    "id": aid,
                    "prompt": title,
                    "images": uniq_present,
                    "n_images": len(uniq_present),
                    "excerpt": (rec.get("excerpt") or "")[:500],
                }, ensure_ascii=False) + "\n")

    fi.close()
    fm.close()

    print("\n===== PROTOTYPE REPORT =====")
    print(f"records scanned      : {stats['records']:,}")
    print(f"  json parse errors  : {stats['json_err']:,}")
    print(f"  with >=1 real image: {stats['with_image']:,} ({stats['with_image']/max(stats['records'],1)*100:.1f}%)")
    print(f"  no image           : {stats['no_image']:,}")
    print(f"  multi-image (>=2)  : {multi_img_records:,}")
    print(f"image refs total     : {img_total:,}")
    print(f"image refs on disk   : {img_present:,} ({img_present/max(img_total,1)*100:.1f}% coverage)")
    print(f"\nwrote: {inter_path}")
    print(f"wrote: {multi_path}")


if __name__ == "__main__":
    main()
