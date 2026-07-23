#!/usr/bin/env python3
"""Curated assembler: high-quality, image-grounded, professional-leaning
interleave + multi-image grouping from Zhihu answers.

Addresses two rejections of the naive prototype:
  1. "interleave has too much image-unrelated text"  -> block-level parsing +
     relevance windowing (keep only image-adjacent / deixis-referencing text).
  2. "text is not professional"                      -> answer-level curation
     gate (require image-deixis grounding, drop opinion/social titles, image-count
     and grounding-density bands, structure/domain bonus scoring).

Rule-based only (no LLM/VLM). A later stage can add LLM professional scoring.
Read-only over source; writes samples to --out.
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

HASH_RE = re.compile(r"(v2-[0-9a-f]{32})", re.I)
IMG_ATTRS = ("data-actualsrc", "src", "data-original", "data-default-watermark-src")
LOCAL_EXTS = ("jpg", "png", "gif", "jpeg", "webp")
BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "figure", "figcaption", "ul", "ol", "table",
              "tr", "pre", "br", "hr"}

# text that explicitly points at an image => strong grounding signal
DEIXIS_RE = re.compile(
    r"如[下上右左]?图|下图|上图|见图|图中|图上|图里|如下所示|如下图|"
    r"图\s*[0-9０-９一二三四五六七八九①②③④⑤⑥⑦⑧⑨]|"
    r"红[框圈]|箭头(所指|指向)|如图所示")
# opinion / social / gossip title patterns => down-rank / drop (anti-professional)
OPINION_RE = re.compile(
    r"如何看待|如何评价|怎么看|是[一种]*怎样的[体验感受]|什么体验|"
    r"有没有必要|有必要吗|靠谱吗|值得吗|女朋友|男朋友|前任|相亲|"
    r"该不该|要不要分手|是什么感受|好不好看|算不算")
# crude professional/tutorial domain cues (title or body) => up-rank
DOMAIN_RE = re.compile(
    r"原理|算法|公式|推导|电路|编程|代码|函数|细胞|基因|分子|电压|电流|"
    r"结构|材料|工艺|参数|安装|教程|步骤|方法|区别|对比|测评|评测|拆解|"
    r"配置|选购|光圈|焦距|渲染|建模|求解|方程|定理|实验|数据|架构|协议")


class ImgLookup:
    def __init__(self, img_dirs):
        self.dirs = [d for d in img_dirs if os.path.isdir(d)]
        self.cache = {}

    def resolve(self, img_hash):
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
    for attr in IMG_ATTRS:
        u = el.get(attr) or ""
        if not u or u.startswith("data:"):
            continue
        m = HASH_RE.search(u)
        if m:
            return m.group(1).lower(), u
    return None


def parse_blocks(content_html, img_index):
    """Document-order sequence of block-level text segments and images.
    Unlike the naive prototype, text is flushed at block boundaries so
    paragraphs/list-items stay separate (no mega-blob)."""
    try:
        root = lxml_html.fragment_fromstring(content_html, create_parent="div")
    except Exception:
        root = lxml_html.fromstring("<div>" + content_html + "</div>")

    seq = []
    buf = []

    def flush():
        if not buf:
            return
        t = re.sub(r"[ \t]+", " ", "".join(buf)).strip()
        buf.clear()
        if t:
            seq.append({"type": "text", "text": t})

    def add_text(t):
        if t:
            buf.append(t)

    def walk(el):
        tag = el.tag if isinstance(el.tag, str) else None
        if tag == "img":
            flush()
            hit = img_hash_from_tag(el)
            if hit:
                h, url = hit
                if not (seq and seq[-1]["type"] == "image" and seq[-1]["hash"] == h):
                    local = img_index.resolve(h)
                    seq.append({"type": "image", "hash": h, "url": url,
                                "local": local, "present": local is not None})
            add_text(el.tail)
            return
        is_block = tag in BLOCK_TAGS
        if is_block:
            flush()
        add_text(el.text)
        for child in el:
            walk(child)
        if is_block:
            flush()
        add_text(el.tail)

    add_text(root.text)
    for child in root:
        walk(child)
    flush()
    return seq


def visible_len(seq):
    return sum(len(s["text"]) for s in seq if s["type"] == "text")


def window_relevant(seq, radius=1):
    """Keep only image entries + text blocks that are image-relevant:
    within `radius` blocks of an image, OR containing image deixis.
    Everything else is dropped (that's the image-unrelated prose)."""
    n = len(seq)
    img_idx = [i for i, s in enumerate(seq) if s["type"] == "image"]
    keep = set(img_idx)
    for i in img_idx:
        for j in range(max(0, i - radius), min(n, i + radius + 1)):
            if seq[j]["type"] == "text":
                keep.add(j)
    for i, s in enumerate(seq):
        if s["type"] == "text" and DEIXIS_RE.search(s["text"]):
            keep.add(i)
    curated = [seq[i] for i in sorted(keep)]
    # collapse consecutive duplicate images that may re-adjoin after dropping text
    out = []
    for s in curated:
        if (s["type"] == "image" and out and out[-1]["type"] == "image"
                and out[-1]["hash"] == s["hash"]):
            continue
        out.append(s)
    return out


def curate_answer(rec, img_index):
    """Return a curated interleave dict if the answer passes the quality gate,
    else (None, reason)."""
    content = rec.get("content") or ""
    if "<img" not in content:
        return None, "no_image"
    q = rec.get("question") or {}
    title = q.get("title") if isinstance(q, dict) else ""

    seq = parse_blocks(content, img_index)
    imgs = [s for s in seq if s["type"] == "image"]
    distinct = list(dict.fromkeys(s["hash"] for s in imgs))
    n_img = len(distinct)

    # --- answer-level gates ---
    if not (2 <= n_img <= 30):
        return None, "img_count_band"          # kill single-img & 100+ galleries
    present_hashes = {s["hash"] for s in imgs if s["present"]}
    if len(present_hashes) < 2:
        return None, "too_few_present"
    vis = visible_len(seq)
    dens = vis / max(n_img, 1)
    if not (30 <= dens <= 600):
        return None, "grounding_density"       # image dump vs image-sparse prose
    full_text = title + " " + " ".join(s["text"] for s in seq if s["type"] == "text")
    if not DEIXIS_RE.search(full_text):
        return None, "no_deixis"               # require explicit image reference
    if OPINION_RE.search(title or ""):
        return None, "opinion_title"           # drop gossip/opinion questions

    # --- curate: drop image-unrelated text ---
    curated = window_relevant(seq, radius=1)
    # keep only images that are present on disk (no dangling gaps)
    curated = [s for s in curated
               if s["type"] == "text" or s["present"]]
    cur_imgs = [s for s in curated if s["type"] == "image"]
    if len({s["hash"] for s in cur_imgs}) < 2:
        return None, "post_window_too_few_img"

    # --- quality score (for ranking) ---
    score = 0
    if DOMAIN_RE.search(full_text):
        score += 2
    for tag in ("<code", "<pre", "<table", "<ol", "<figcaption", "<h2", "<h3"):
        if tag in content:
            score += 1
    n_deixis = len(DEIXIS_RE.findall(full_text))
    score += min(n_deixis, 5)

    return {
        "id": rec.get("_aid") or rec.get("id"),
        "question_title": title,
        "question_url": (q.get("url") if isinstance(q, dict) else None),
        "sequence": curated,
        "n_images": len({s["hash"] for s in cur_imgs}),
        "quality_score": score,
        "orig_visible_chars": vis,
        "kept_visible_chars": visible_len(curated),
    }, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20000)
    ap.add_argument("--jsonl", default=JSONL)
    ap.add_argument("--out", default="curated_out")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    img_index = ImgLookup(IMG_DIRS)

    reasons = Counter()
    kept = []
    with open(args.jsonl) as f:
        for i, line in enumerate(f):
            if i >= args.limit:
                break
            reasons["scanned"] += 1
            try:
                rec = json.loads(line)
            except Exception:
                reasons["json_err"] += 1
                continue
            res, why = curate_answer(rec, img_index)
            reasons[why] += 1
            if res:
                kept.append(res)

    kept.sort(key=lambda r: r["quality_score"], reverse=True)
    out_path = os.path.join(args.out, "interleaved_curated.jsonl")
    with open(out_path, "w") as w:
        for r in kept:
            w.write(json.dumps(r, ensure_ascii=False) + "\n")

    print("\n===== CURATION REPORT =====")
    scanned = reasons["scanned"]
    print(f"scanned            : {scanned:,}")
    for k in ["no_image", "img_count_band", "too_few_present",
              "grounding_density", "no_deixis", "opinion_title",
              "post_window_too_few_img", "json_err"]:
        if reasons[k]:
            print(f"  dropped {k:<24}: {reasons[k]:,}")
    print(f"KEPT (passed gate) : {len(kept):,} ({len(kept)/max(scanned,1)*100:.2f}% of corpus)")
    if kept:
        import statistics as st
        drop = [1 - r["kept_visible_chars"]/max(r["orig_visible_chars"],1) for r in kept]
        print(f"  median text trimmed away by windowing: {st.median(drop)*100:.0f}%")
        print(f"  median images/sample : {st.median([r['n_images'] for r in kept]):.0f}")
        print(f"  quality_score p50/p90: {st.median([r['quality_score'] for r in kept])}"
              f" / {sorted(r['quality_score'] for r in kept)[int(len(kept)*0.9)]}")
    print(f"\nwrote: {out_path}")


if __name__ == "__main__":
    main()
