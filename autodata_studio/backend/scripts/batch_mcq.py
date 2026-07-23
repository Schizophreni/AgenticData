"""MCQ batch: multiple-choice multi-image QA with deliberate unanswerable questions
(MuirBench-style pairing). Gap mode = verifiable (binary correctness counting).
challenger+judge=397B, strong=122B, weak=7B."""
import asyncio, os, sys, time, json, glob, hashlib
from collections import Counter
from pathlib import Path

_SP = str(Path(__file__).resolve().parent)
_DB = os.environ.get("MCQ_DB", os.path.join(_SP, "batch_mcq.sqlite3"))
if os.environ.get("MCQ_RESUME", "0") != "1":
    for _f in glob.glob(_DB + "*"):
        os.remove(_f)
os.environ["AUTODATA_DB"] = _DB
# A contended 235B VLM can legitimately need several minutes.  The generic
# 120-second timeout caused five duplicate server-side generations and then
# counted the transport failure as a data rejection.  One long attempt avoids
# retry amplification and keeps infrastructure failures out of quality stats.
os.environ["AUTODATA_HTTP_TIMEOUT"] = os.environ.get("MCQ_HTTP_TIMEOUT", "600")
os.environ["AUTODATA_HTTP_RETRIES"] = os.environ.get("MCQ_HTTP_RETRIES", "3")
BACKEND = "/inspire/hdd/project/video-understanding/public/personal/wran/projects/Zhihu/autodata_studio/backend"
sys.path.insert(0, BACKEND)

from autodata import db, events
from autodata.models import GapConfig, RoleBinding, default_role_cfg
from autodata.prompt_pool import select_prompt
from autodata.providers import build_client
from autodata.recipe import recipe_builder, source_profiler, grounding
from autodata.curation import run_manager
from autodata.curation.content_gates import (
    has_unverified_iconqa_clock_reasoning,
    sanitize_relation_map_for_generated_task,
)
from autodata.curation.media_dedupe import filter_unique_image_docs
from autodata.muirbench_taxonomy import (
    IMAGE_TYPES, RELATION_TYPES, TASK_TYPES, allowed_tasks,
)

DATA = "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download/zhihu_answers"
ICONQA_ROOT = Path(
    "/inspire/qb-ilm2/project/video-understanding/public/datasets/iconQA"
)
ICONQA_DATA = ICONQA_ROOT / "iconqa_data/iconqa"
ICONQA_MAPPING = ICONQA_ROOT / "muir_iconqa_mapping"
ICONQA_MANIFEST = Path(
    "/inspire/hdd/project/video-understanding/public/personal/wran/projects/Zhihu/"
    "autodata_studio/backend/var/iconqa_choose_img_manifest.json"
)
ICONQA_AUX_MANIFEST = Path(
    "/inspire/hdd/project/video-understanding/public/personal/wran/projects/Zhihu/"
    "autodata_studio/backend/var/iconqa_choose_img_aux_manifest.json"
)
DATASET_MODE = os.environ.get("MCQ_DATASET", "zhihu").strip().lower()


def _iconqa_muir_overlap() -> set[tuple[str, str]]:
    """Return exact/near-exact IconQA instances already represented in MuirBench."""
    overlap: set[tuple[str, str]] = set()
    for name in ("row_pid_map.json", "precise_map.json"):
        path = ICONQA_MAPPING / name
        if not path.exists():
            continue
        payload = json.loads(path.read_text())
        for item in payload.values():
            if isinstance(item, dict) and item.get("pid") and item.get("split"):
                overlap.add((str(item["split"]), str(item["pid"])))
    return overlap


def _iconqa_aux_manifest() -> list[dict]:
    """Cache val/test choose_img metadata without changing the train prefix."""
    if ICONQA_AUX_MANIFEST.exists():
        try:
            payload = json.loads(ICONQA_AUX_MANIFEST.read_text())
            if isinstance(payload, list):
                return payload
        except (OSError, json.JSONDecodeError):
            pass
    manifest: list[dict] = []
    for split in ("val", "test"):
        root = ICONQA_DATA / split / "choose_img"
        if not root.exists():
            continue
        for item_dir in root.iterdir():
            metadata_path = item_dir / "data.json"
            if not metadata_path.exists():
                continue
            try:
                meta = json.loads(metadata_path.read_text())
                choices = [item_dir / str(name) for name in meta.get("choices", [])]
                answer = int(meta.get("answer"))
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
            if len(choices) not in (2, 3, 4) or not all(path.exists() for path in choices):
                continue
            if not 0 <= answer < len(choices):
                continue
            manifest.append({
                "split": split,
                "pid": item_dir.name,
                "meta": meta,
                "choices": [path.name for path in choices],
                "answer": answer,
            })
    ICONQA_AUX_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    tmp_manifest = ICONQA_AUX_MANIFEST.with_suffix(".tmp")
    tmp_manifest.write_text(json.dumps(manifest, ensure_ascii=False))
    tmp_manifest.replace(ICONQA_AUX_MANIFEST)
    return manifest


def _load_iconqa_docs(limit: int, start: int = 0) -> list[dict]:
    """Build a deterministic Muir-distributed stream from IconQA choose_img."""
    overlap = _iconqa_muir_overlap()
    excluded_clock_docs = 0
    root = ICONQA_DATA / "train/choose_img"
    pools: dict[int, list[tuple[Path, dict, list[Path], int]]] = {2: [], 3: [], 4: []}
    grade_priority = {"grade2": 0, "grade1": 1, "kindergarten": 2, "prek": 3}
    manifest = None
    if ICONQA_MANIFEST.exists():
        try:
            manifest = json.loads(ICONQA_MANIFEST.read_text())
        except (OSError, json.JSONDecodeError):
            manifest = None
    if not isinstance(manifest, list):
        manifest = []
        for item_dir in root.iterdir():
            pid = item_dir.name
            if ("train", pid) in overlap:
                continue
            metadata_path = item_dir / "data.json"
            if not metadata_path.exists():
                continue
            try:
                meta = json.loads(metadata_path.read_text())
                choices = [item_dir / str(name) for name in meta.get("choices", [])]
                answer = int(meta.get("answer"))
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
            if len(choices) not in pools or not all(path.exists() for path in choices):
                continue
            if not 0 <= answer < len(choices):
                continue
            manifest.append({
                "pid": pid,
                "meta": meta,
                "choices": [path.name for path in choices],
                "answer": answer,
            })
        ICONQA_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        tmp_manifest = ICONQA_MANIFEST.with_suffix(".tmp")
        tmp_manifest.write_text(json.dumps(manifest, ensure_ascii=False))
        tmp_manifest.replace(ICONQA_MANIFEST)
    for row in manifest:
        item_dir = root / str(row["pid"])
        meta = row["meta"]
        if has_unverified_iconqa_clock_reasoning(
            str(meta.get("question", "")), {"source": "IconQA"}
        ):
            excluded_clock_docs += 1
            continue
        choices = [item_dir / str(name) for name in row["choices"]]
        answer = int(row["answer"])
        if len(choices) in pools:
            pools[len(choices)].append((item_dir, meta, choices, answer))
    for pool in pools.values():
        pool.sort(key=lambda row: (
            grade_priority.get(str(row[1].get("grade", "")).lower(), 9),
            -len(str(row[1].get("question", "")).split()),
            int(row[0].name),
        ))

    # Match MuirBench's option mix at the source: 3 options=12%, 4=48%, 5=40%.
    # Since the final textual option is reserved, this selects 2/3/4 visual crops.
    # The legacy grade/question-length ordering groups near-identical templates
    # together. Global image-hash dedupe consequently discarded 80%+ of several
    # consecutive shards. Preserve every historical cursor mapping, then switch
    # only the unprocessed suffix to a stable hash permutation.
    shuffle_cutover = 5400
    counters = {2: 0, 3: 0, 4: 0}
    selected: list[tuple[Path, dict, list[Path], int]] = []
    legacy_end = min(start + limit, shuffle_cutover)
    for position in range(legacy_end):
        bucket = position % 25
        choice_count = 2 if bucket < 3 else 3 if bucket < 15 else 4
        index = counters[choice_count]
        counters[choice_count] += 1
        if position >= start and index < len(pools[choice_count]):
            selected.append(pools[choice_count][index])

    if start + limit > shuffle_cutover:
        train_suffix_pools = {
            choice_count: sorted(
                pool[counters[choice_count]:],
                key=lambda row: hashlib.sha256(
                    f"iconqa-train-suffix-v1:{row[0].name}".encode()
                ).digest(),
            )
            for choice_count, pool in pools.items()
        }
        suffix_counters = {2: 0, 3: 0, 4: 0}
        aux_cutover = 6050
        suffix_end = min(start + limit, aux_cutover)
        suffix_start = max(start, shuffle_cutover)
        for position in range(shuffle_cutover, suffix_end):
            bucket = (position - shuffle_cutover) % 25
            choice_count = 2 if bucket < 3 else 3 if bucket < 15 else 4
            index = suffix_counters[choice_count]
            suffix_counters[choice_count] += 1
            if position < suffix_start:
                continue
            pool = train_suffix_pools[choice_count]
            if index < len(pool):
                selected.append(pool[index])

        if start + limit > aux_cutover:
            aux_pools: dict[int, list[tuple[Path, dict, list[Path], int]]] = {
                2: [], 3: [], 4: []
            }
            for row in _iconqa_aux_manifest():
                split = str(row["split"])
                pid = str(row["pid"])
                if (split, pid) in overlap:
                    continue
                meta = row["meta"]
                if has_unverified_iconqa_clock_reasoning(
                    str(meta.get("question", "")), {"source": "IconQA"}
                ):
                    continue
                item_dir = ICONQA_DATA / split / "choose_img" / pid
                choices = [item_dir / str(name) for name in row["choices"]]
                choice_count = len(choices)
                if choice_count in aux_pools:
                    aux_pools[choice_count].append(
                        (item_dir, meta, choices, int(row["answer"]))
                    )
            extended_pools = {
                choice_count: sorted(
                    train_suffix_pools[choice_count][suffix_counters[choice_count]:]
                    + aux_pools[choice_count],
                    key=lambda row: hashlib.sha256(
                        (
                            "iconqa-all-suffix-v2:"
                            f"{row[0].parent.parent.name}:{row[0].name}"
                        ).encode()
                    ).digest(),
                )
                for choice_count in pools
            }
            extended_counters = {2: 0, 3: 0, 4: 0}
            extended_start = max(start, aux_cutover)
            for position in range(aux_cutover, start + limit):
                bucket = (position - aux_cutover) % 25
                choice_count = 2 if bucket < 3 else 3 if bucket < 15 else 4
                index = extended_counters[choice_count]
                extended_counters[choice_count] += 1
                if position < extended_start:
                    continue
                pool = extended_pools[choice_count]
                if index < len(pool):
                    selected.append(pool[index])

    docs: list[dict] = []
    label_counts: dict[str, int] = {}
    prompt_counts: dict[str, int] = {}
    for item_dir, meta, choices, answer in selected:
        pid = item_dir.name
        source_split = item_dir.parent.parent.name
        label = str(meta.get("label", "unknown"))
        # IconQA's image.png is only a horizontal contact sheet containing the
        # same candidates again. Sending it together with choice_*.png duplicates
        # visual content and makes Preview look corrupted. Keep only the individual
        # candidate crops; the original question/answer remain deterministic metadata.
        images = [str(path) for path in choices]
        correct_image = answer + 1
        relation_map = sanitize_relation_map_for_generated_task({
            "category": "IconQA图选项",
            "source": "IconQA",
            "source_split": source_split,
            "source_pid": pid,
            "source_question": str(meta.get("question", "")).strip(),
            "source_answer_index": answer,
            "source_image_indices": list(range(2, len(images) + 2)),
            "relevant_images": list(range(1, len(images) + 1)),
            "image_types": {str(i): "Graphics" for i in range(1, len(images) + 1)},
            "relations": [{
                "type": "Cropped/Zoomed",
                "images": list(range(1, len(images) + 1)),
                "evidence": [
                    "The supplied images are the non-overlapping visual answer crops "
                    "from the original IconQA contact sheet.",
                    f"Images 1-{len(images)} are the visual answer candidates.",
                    f"For the source task, Image {correct_image} is the annotated correct candidate.",
                ],
                "safe_semantics": [
                    "count", "shape", "color", "size", "position",
                    "pattern", "measurement", "visible candidate matching",
                ],
                "forbidden_inferences": [
                    "file name or dimensions as an answer cue",
                    "template frequency", "answer-position prior",
                    "world knowledge not required by the visible diagram",
                ],
            }],
            "allowed_tasks": ["Diagram Understanding"],
        })
        prompt_spec = select_prompt(relation_map, meta).as_dict()
        prompt_counts[prompt_spec["id"]] = prompt_counts.get(prompt_spec["id"], 0) + 1
        docs.append({
            "id": f"iconqa_{source_split}_{pid}",
            "text": (
                "IconQA controlled visual-reasoning seed.\n"
                f"Grade: {meta.get('grade', 'unknown')}; template label: {label}.\n"
                "Create a NEW image-grounded Diagram Understanding MCQ; do not merely "
                "translate, paraphrase, or restate the source question. Require a two-step "
                "comparison or elimination chain across at least three candidate images "
                "when three or more are supplied. A direct single-image lookup is invalid. "
                "Prefer conjunctions of two visible attributes, relative ranking, or a "
                "pair/set relation whose distractors differ by one visible fact. Do not use "
                "file size, whitespace, option position, or dataset priors as evidence."
            ),
            "images": images,
            "_relation_map": relation_map,
            "_gate_category": "IconQA图选项",
            "_source_metadata": meta,
            "_prompt_spec": prompt_spec,
            # One textual choice per visual candidate plus the reserved final
            # none/cannot-determine choice gives exactly 3-5 MCQ options.
            "_option_count": len(images) + 1,
        })
        label_counts[label] = label_counts.get(label, 0) + 1
    print(
        f"ICONQA LOADER: kept={len(docs)} start={start} "
        f"excluded_muir_instances={len(overlap)} excluded_clock_docs={excluded_clock_docs} "
        f"labels={len(label_counts)} prompts={json.dumps(prompt_counts, sort_keys=True)} "
        f"choices={{2:{sum(len(d['images']) == 2 for d in docs)},"
        f"3:{sum(len(d['images']) == 3 for d in docs)},"
        f"4:{sum(len(d['images']) == 4 for d in docs)}}}"
    )
    return docs


def ep(model, port, mt=1536):
    return dict(provider="openai_compat", model=model, is_vlm=True, max_tokens=mt,
                base_url=f"http://127.0.0.1:{port}/v1")


# 397B 那台(别人的机器)已消失。自有算力只剩 Qwen3.5-35B-A3B(57297, TP=2, 隧道 8002),
# 起服时 enable_thinking=false → 输出是干净 JSON,无思考前缀(397B 的截断根源)。
CHAL35 = ep("qwen3.5-35b", 8002, 8192)     # (retired: options too leaky for 235B QV)
# Independent 235B Challenger on the 10656 tunnel. Keep it separate from the
# 235B strong/judge endpoint so generation and evaluation do not contend.
CHAL235 = ep(
    "qwen3-vl-235b",
    int(os.environ.get("MCQ_CHALLENGER_PORT", "8007")),
    int(os.environ.get("MCQ_CHALLENGER_MAX_TOKENS", "512")),
)
CHAL235["fallback_base_url"] = (
    f"http://127.0.0.1:{int(os.environ.get('MCQ_STRONG_PORT', '8005'))}/v1"
)
JUDGE235 = ep(
    "qwen3-vl-235b",
    int(os.environ.get("MCQ_JUDGE_PORT", "8008")),
    int(os.environ.get("MCQ_JUDGE_MAX_TOKENS", "512")),
)
JUDGE235["fallback_base_url"] = CHAL235["fallback_base_url"]
WEAK7B = ep("qwen2.5-vl-7b", int(os.environ.get("MCQ_WEAK_PORT", "8004")), 256)
# strong + judge: 自有 Qwen3-VL-235B-A22B-Instruct(57148, TP=8, 隧道 8005)。
# 换掉 mimo 外部 API —— 其配额已耗尽('quota exhausted'),且不支持并发。235B 全自有、无限流。
VL235 = ep("qwen3-vl-235b", int(os.environ.get("MCQ_STRONG_PORT", "8005")), 256)
VL235["fallback_base_url"] = (
    f"http://127.0.0.1:{int(os.environ.get('MCQ_CHALLENGER_PORT', '8007'))}/v1"
)

MCQ_RUBRIC = """Produce a MULTIPLE-CHOICE question (MuirBench style).

RULE ZERO — IMAGE-GROUNDED OPTIONS (violating this is the #1 rejection cause):
Every option, correct and distractors alike, must be verifiable or refutable using ONLY the
images. You can read the accompanying text, but the solver NEVER sees it — do not bake
text-only facts (names, motives, backstory, off-screen events) into any option or the stem.
Likewise never assert content of an image you cannot actually see clearly.
For domain-specific icons or objects (game equipment, product symbols, medical imagery,
plants, brands), do not infer an exact name, function, or category from appearance or world
knowledge. Unless the image itself explicitly labels it, describe only visible attributes
such as color, shape, position, or printed text. A red game icon is not evidence that the
item is armor, attack equipment, or any other functional class.

TRUTH-TABLE RULE: Before returning JSON, internally classify every substantive option as supported,
contradicted, or unknown using only visible evidence. For a standard question, exactly the
correct option must be supported and every distractor must be visibly contradicted; an
unknown distractor is invalid. Never create two true options.

HIGH-RISK CLAIM RULE: Do not infer causality, intent, policy purpose, legal basis, function,
identity, abundance, chronology, compliance with a plan, or a transition between scenes
from juxtaposition or source text. Such a claim is allowed only when the relevant images
explicitly state or visibly demonstrate it. Prefer neutral visible comparisons.

Extra JSON keys required besides question/reference_answer/rubric:
  "options": ["A. ...", "...", "<final letter>. Cannot be determined from the given images"],
  "correct_answer": "<letter>",
  "answerable": true|false,
  "task_type": "<taxonomy id>"

Format rules:
1. The "question" field is ONLY the question stem — the thing being asked, with explicit
   image references (Image 1, Image 3...). Do NOT paste the options into it; they are
   assembled from the "options" array. The correct letter must not be hinted in the stem.
   Do not open with a restricted scope such as "Based on Image 3 and Image 4" and then use
   another image later. Every image used in the comparison must be included consistently
   in the stated scope.
2. The per-document instruction below dictates EXACTLY 3, 4, or 5 consecutive options
   (A-C, A-D, or A-E). The FINAL option is always "Cannot be determined from the given
   images". All earlier options are substantive visual claims. Distractors must be
   plausible near-misses: common misreadings or subtly wrong visible details.
3. Randomize which letter is correct across examples (do not favour any position).
4. reference_answer = ONLY the correct letter and ONE short clause naming the key evidence.
   Keep it minimal — do NOT elaborate specifics (extra detail invites hallucinated facts
   that get the whole item rejected). Scoring is by letter, so brevity is safe.
5. rubric = exactly ONE criterion: {"number":1, "criterion":"The final selected option is
   <letter>", "weight":10}. No secondary criteria — for MCQ the letter IS the score, and
   extra criteria only add things that can be wrong.

Whether this particular example must be answerable or unanswerable is dictated to you below
(a per-document instruction). Obey it exactly — do not decide for yourself.

Task type: use exactly ONE MuirBench task name from the per-document ALLOWED TASKS list
provided below. Never invent a task or choose a task outside that list. The image relation
is classified before generation; it determines which question families are valid.

Hard constraints: the question must cite >=2 images explicitly, and (for answerable ones)
must not be solvable from any single image nor from world knowledge alone."""

# An activated Prompt Evolution version is an additive, audited delta.  It is read once
# at process start so one batch never mixes two Challenger prompt versions.
_PROMPT_OVERRIDE = Path(BACKEND, "var", "mcq_challenger_prompt_override.txt")
if _PROMPT_OVERRIDE.exists():
    MCQ_RUBRIC += "\n\n" + _PROMPT_OVERRIDE.read_text()


ANS_MODE = """
=== THIS DOCUMENT: the correct option must be a substantive option (never the final
cannot-determine option) and must be genuinely derivable from the images. ==="""

LANG_MODE = {
    "en": """
=== LANGUAGE: Write the question stem, all five option texts, and the short
reference_answer in English. Do not mix Chinese into these fields. ===""",
    "zh": """
=== 语言要求：题干、五个选项的正文和简短 reference_answer 必须全部使用简体中文；
只保留 A/B/C/D/E 选项字母。不得在这些字段中夹杂英文说明。图像引用写作“图1、图2”。 ===""",
}

# Asking the model to invent an unanswerable question directly does not work (measured:
# 1/14, and that one still named a non-E answer). MuirBench's construction instead: take a
# genuinely answerable question and REPLACE its correct option with a plausible-but-wrong
# claim. Every substantive option is then unsupported, so the final option becomes correct, and the
# stem stays natural because it was written as a real question.
_REWRITE = """You are given the CORRECT option of a multi-image multiple-choice question,
plus the images it was written against.

{opt}

Rewrite ONLY this option into a claim that sounds equally plausible but is VISIBLY
CONTRADICTED by the images — a near-miss: a wrong visible quantity, the wrong image cited,
or a reversed visible direction. Do not merely invent an event or detail absent from the
images: absence would make the claim unknown rather than demonstrably false.
Keep the same letter prefix, register and roughly the same length.
Output the single rewritten option line and nothing else."""


async def _to_unanswerable(client, cand: dict) -> dict | None:
    """Remove the true substantive choice; the final option becomes none-of-the-above.

    The images still establish the underlying fact, so calling this "cannot be
    determined" would be semantically false.  This is distinct from a future
    insufficient-evidence/image-removal example.
    """
    from autodata.providers.base import ChatMessage
    opts = list(cand.get("options", []))
    if len(opts) not in (3, 4, 5):
        return None
    final_letter = "ABCDE"[len(opts) - 1]
    substantive_letters = "ABCDE"[:len(opts) - 1]
    letter = str(cand.get("correct_answer", "")).strip().upper()[:1]
    if letter not in substantive_letters:
        return None
    idx = next((i for i, o in enumerate(opts) if str(o).strip().upper().startswith(letter)), None)
    if idx is None:
        return None
    old = str(opts[idx])

    comp = await client.chat([ChatMessage(role="user", content=_REWRITE.format(opt=old),
                                          images=cand.get("images", []))])
    new = comp.text.strip().splitlines()[0].strip()
    if not new or len(new) < 8:
        return None
    if not new.upper().startswith(letter):                 # keep the letter prefix intact
        new = f"{letter}. {new.lstrip('ABCDE. ')}"

    opts[idx] = new
    # Poisoning must not collapse into a duplicate distractor; that creates an
    # invalid MCQ and was a frequent 235B QV rejection.
    bodies = [
        str(o).split(".", 1)[-1].strip().casefold() for o in opts[:-1]
    ]
    if len(set(bodies)) != len(bodies):
        return None
    is_zh = cand.get("language") == "zh"
    opts[-1] = (
        f"{final_letter}. 以上选项均不正确"
        if is_zh else f"{final_letter}. None of the above is correct"
    )
    cand["options"] = opts
    cand["question"] = str(cand.get("question", "")).replace(old, new)
    cand["question"] = cand["question"].replace(
        f"{final_letter}. Cannot be determined from the given images", opts[-1])
    cand["reference_answer"] = (
        f"正确答案是 {final_letter}：其余选项均不正确。" if is_zh
        else f"The correct answer is option {final_letter}: none of the earlier options is correct."
    )
    cand["correct_answer"] = final_letter
    cand["answerable"] = True
    cand["answer_type"] = "none_of_above"
    cand["rubric"] = [{"number": 1,
                       "criterion": f"The final selected option is {final_letter}",
                       "weight": 10, "category": "positive",
                       "capability": "visual_reasoning"}]
    cand["_poisoned_from"] = old
    return cand


def _install_mode_dictator():
    """Stamp the answerable/unanswerable split per document. loop.py binds run_challenger at
    import time, so the patch must land on the reference inside THAT module."""
    from autodata.curation import loop as loop_mod
    orig = loop_mod.run_challenger

    async def dictated(client, doc, gen_rubric, feedback):
        language = doc.get("_language", "en")
        language_mode = LANG_MODE.get(language, LANG_MODE["en"])
        relation_map = doc.get("_relation_map") or {}
        prompt_spec = doc.get("_prompt_spec") or select_prompt(
            relation_map, doc.get("_source_metadata")
        ).as_dict()
        option_count = int(doc.get("_option_count", 4))
        final_letter = "ABCDE"[option_count - 1]
        permitted_tasks = list(relation_map.get("allowed_tasks") or [])
        if not permitted_tasks:
            raise ValueError("relation/image taxonomy produced no allowed MuirBench task")
        relation_mode = """
=== IMAGE RELATION MAP (extracted once and reused across rounds) ===
{relations}
ALLOWED MUIRBENCH TASKS: {allowed_tasks}
OPTION COUNT: Return exactly {option_count} options, lettered A-{final_letter}. The final
option {final_letter} is the cannot-determine option; the correct answer for a normal
answerable item must be one of the earlier substantive letters.
Generate the question ONLY from a relation and evidence listed above. Use relevant_images
as the allowed image subset. Do not invent an object identity, function, category, causal
claim, or temporal order absent from the map. safe_semantics are allowed; anything in
forbidden_inferences is prohibited. If feedback asks for a rewrite, change the reasoning
angle while staying inside this same evidence map. Set task_type to exactly one string in
ALLOWED MUIRBENCH TASKS; no aliases or snake-case labels are accepted.

CRITICAL SOURCE-LABEL RULE: source_answer_index and text such as "Image X is the annotated
correct candidate" describe the hidden ORIGINAL IconQA task. They do not prove that Image X
answers a newly invented question. The new stem and keyed answer must be independently true
from the pixels. Never reverse-engineer a new claim merely to preserve the original answer
position.

NUMERIC-TRANSFORMATION RULE: do not generate clock/calendar/ruler/scale/count arithmetic or
"N units before/after" questions unless the relation evidence explicitly enumerates the
visible numeric value for every involved image. Generic "annotated correct candidate" or
"visible candidate matching" evidence is insufficient. With generic IconQA crop evidence,
use only directly visible comparisons whose truth can be checked without inventing a new
baseline, direction, quantity, or operation.
===""".format(relations=json.dumps(relation_map, ensure_ascii=False),
               allowed_tasks=json.dumps(permitted_tasks, ensure_ascii=False),
               option_count=option_count, final_letter=final_letter)
        type_mode = """
=== TYPE-SPECIFIC PROMPT POOL ROUTE: {prompt_id} ===
{instruction}
This type prompt refines the global rules; it never overrides grounding, option-count,
language, answer-mode, or quality-verification requirements.
===""".format(
            prompt_id=prompt_spec["id"],
            instruction=prompt_spec["instruction"],
        )
        routed_type_mode = (
            ""
            if prompt_spec["id"] in (gen_rubric or "")
            else "\n" + type_mode
        )
        cand = await orig(client, doc, (gen_rubric or "") + "\n" + ANS_MODE
                          + "\n" + language_mode + "\n" + relation_mode
                          + routed_type_mode, feedback)
        cand["language"] = language
        cand["relation_map"] = relation_map
        cand["prompt_pool_id"] = prompt_spec["id"]
        cand["prompt_pool_task_type"] = prompt_spec["task_type"]
        candidate_text = "\n".join(
            [str(cand.get("question") or "")]
            + [str(option) for option in (cand.get("options") or [])]
        )
        if has_unverified_iconqa_clock_reasoning(candidate_text, relation_map):
            raise ValueError(
                "deterministic content gate: IconQA clock/time reasoning is disallowed "
                "unless relation_map.numeric_values enumerates every image value; choose "
                "a different directly visible comparison"
            )
        if cand.get("task_type") not in permitted_tasks:
            raise ValueError(
                f"task_type={cand.get('task_type')!r} is incompatible with relation/image "
                f"types; allowed={permitted_tasks}"
            )
        # The 35B silently drops the MCQ schema on ~40% of calls and emits an open-ended
        # example instead. Reject it here: loop.py turns the raise into a challenger_error
        # round and retries with feedback, so half-formed "MCQs" never reach the dataset.
        # The final option is always fixed "cannot be determined", so normalise rather than
        # demand the model remember it: keep the first 4 non-E options and re-append a
        # a canonical final option. Models often drop it; recover instead of
        # burning a retry round. Only genuinely too-few options (<4) still fail.
        raw = cand.get("options") or []
        substantive_count = option_count - 1
        final_prefix = final_letter + "."
        non_final = [
            o for o in raw
            if not str(o).strip().upper().startswith(final_prefix)
            and "cannot be determined" not in str(o).lower()
            and "无法根据给定图片确定" not in str(o)
        ]
        letter = str(cand.get("correct_answer") or "").strip().upper()[:1]
        stem = str(cand.get("question") or "").strip()
        missing = []
        if len(non_final) >= substantive_count:
            final_option = (
                f"{final_letter}. 无法根据给定图片确定" if language == "zh"
                else f"{final_letter}. Cannot be determined from the given images"
            )
            bodies = [
                str(o).split(".", 1)[-1].strip() if "." in str(o) else str(o).strip()
                for o in non_final[:substantive_count]
            ]
            opts = [f"{letter}. {body}" for letter, body in zip("ABCDE", bodies)]
            opts.append(final_option)
            cand["options"] = opts
        else:
            opts = raw
            missing.append(
                f"only {len(non_final)} substantive options "
                f"(need {substantive_count} + final {final_letter})"
            )
        valid_letters = "ABCDE"[:option_count]
        substantive_letters = valid_letters[:-1]
        if letter not in valid_letters:
            missing.append(
                f"correct_answer={cand.get('correct_answer')!r} "
                f"(need a letter in {valid_letters})"
            )
        elif letter == final_letter:
            missing.append(
                f"correct_answer={letter} points to the reserved cannot-determine option; "
                f"answerable generation must use {substantive_letters}"
            )
        if len(stem) < 15:
            missing.append("question stem is empty")
        if missing:
            raise ValueError("challenger ignored the MCQ schema: " + "; ".join(missing))
        # 122B almost always parks the correct answer at A (measured: 12/13 answerable were A).
        # The prompt asks it to randomise and it won't, so shuffle substantive options in code —
        # otherwise the dataset teaches "pick A". E stays fixed 5th. (unans keeps E as correct,
        # so only shuffle for answerable items.)
        if doc.get("_mode") != "unans":
            if letter in substantive_letters:
                import random
                conts = [
                    str(o).split(".", 1)[-1].strip() if "." in str(o) else str(o)
                    for o in opts[:substantive_count]
                ]
                correct_content = conts[substantive_letters.index(letter)]
                random.shuffle(conts)
                opts = [
                    f"{L}. {ct}" for L, ct in zip(substantive_letters, conts)
                ] + [opts[-1]]
                letter = substantive_letters[conts.index(correct_content)]
                cand["correct_answer"] = letter
                cand["options"] = opts
            # CRITICAL: rewrite rubric+reference to match the (possibly shuffled) letter.
            # The shuffle moved the answer but the model's rubric/reference still named the
            # old letter -> self-contradiction -> QV rejected every item. Force them canonical.
            cand["rubric"] = [{"number": 1, "criterion": f"The final selected option is {letter}",
                               "weight": 10, "category": "positive", "capability": "visual_reasoning"}]
            cand["reference_answer"] = (f"正确答案是 {letter}。" if language == "zh"
                                        else f"The correct answer is option {letter}.")
        elif letter in substantive_letters:
            # Canonicalize before poisoning too. Otherwise the generic Challenger
            # rubric (10-15 criteria) survives and can contradict the new E answer.
            cand["rubric"] = [{"number": 1, "criterion": f"The final selected option is {letter}",
                               "weight": 10, "category": "positive",
                               "capability": "visual_reasoning"}]
            cand["reference_answer"] = (f"正确答案是 {letter}。" if language == "zh"
                                        else f"The correct answer is option {letter}.")
        # Assemble the solver-visible text from the parts rather than trusting the model to
        # duplicate the options into the stem (the #1 schema failure at scale).
        cand["question"] = stem + "\n\n" + "\n".join(str(o) for o in opts)

        if doc.get("_mode") == "unans":
            poisoned = await _to_unanswerable(client, cand)
            if poisoned is not None:
                return poisoned                    # else: fall through, keep it answerable
        return cand

    loop_mod.run_challenger = dictated


# Image-category gate (user requirement): only build MCQs from image sets whose visual type
# is close to what multi-image benchmarks (MuirBench / MMIU) are built on. Zhihu is mostly
# chat/comment screenshots, selfies and memes — filter those out at the source so we don't
# spend challenger+QV compute on docs that can never yield a cross-image reasoning question.
GATE_PROMPT = """你是 MuirBench Visual Gate 和 Image Relation Extractor。你会看到一组按顺序编号的图片，需同时完成
素材筛选和跨图关系抽取。不要出题，只提取能被像素、图中文字或明确结构直接支持的关系。

第一步，逐图分类。`image_types` 必须给每张候选图片分配且只能分配以下一个 MuirBench 类型：
Photography, Graphics, Slides, Drone and Satellite, Medical Image, 3D View, Map, Video,
Meme, Animation, Other, Data Visualization。
无法可靠归入这些类型、损坏、不可读或没有实质视觉信息的图片不得进入 relevant_images。

图片选择规则（必须执行）：`relevant_images` 只能包含支撑至少一条有效跨图关系所必需的图片。
删除同一文档中的封面、装饰图、重复图、无关截图，以及虽与文章主题相关但不参与该关系的图片。
优先选择能完整支撑一道题的最小图片子集；不得为了“多图”而保留无关图。每张入选图片都必须
在至少一条 relation 的 `images` 中出现，并有对应的可见 evidence。

适合(suitable=true) —— 必须能归入上述 MuirBench 图片类型，并含以下任一:
- 数据图表 / 统计图 / 统计表格(折线、柱状、饼图、数据表)
- 示意图 / 流程图 / 结构图 / 架构图
- 文档 / 公告 / 报告 / 证件 / 聊天记录中含实质信息的截图(需要阅读理解、可比对)
- 对比图(前后 / 多方案 / 正误)
- 同一主题的多张照片(现场多角度、物体多视角、操作步骤、产品细节)
- 地图 / 科学图像 / 医学影像 / 技术图纸

不适合(suitable=false):
- 纯表情包 / 梗图 / 段子
- 纯人物自拍 / 明星写真 / 写真 / 无信息合影 / 走秀穿搭展示
- 纯风景美图 / 纯装饰图 / 广告海报
- **纯聊天/评论截图**:如果只是对话气泡、无图表/文档/数据可比对,判 false
  (只有当截图里含实质的图表、单据、报告、可跨图比对的信息时才 true)
关系类型必须且只能从以下 MuirBench 关系中选择：Cropped/Zoomed, Partial Similarity,
Ordered_Pages, Object-Multiview, Overall Similarity, Independent, Complementary, Temporal,
Scene-Multiview, Narrative。每条关系必须涉及至少两张图片。

严格区分“可见事实”和“世界知识”。游戏道具、商品图标、医学符号、植物、品牌等，
如果图片内没有明确名称或类别标签，只能记录颜色、形状、位置、数量和可见文字；不得推断
名称、用途、攻击/防御类别、品牌或专业诊断。把这些风险写进 forbidden_inferences。

只输出一个紧凑 JSON 对象：
{"suitable":true,"category":"对比图","image_types":{"1":"Graphics","8":"Graphics"},
 "relevant_images":[1,8],"relations":[
 {"type":"Complementary","images":[1,8],
  "evidence":["Image 1 final icon is predominantly blue","Image 8 final icon is predominantly red"],
  "safe_semantics":["color","position"],
  "forbidden_inferences":["item name","attack/armor category"]}]}

suitable=true 时必须至少有一条证据明确、涉及>=2图的 relation；否则 suitable=false。
`relevant_images` 必须与所有有效 relation 使用到的图片并集完全一致，且至少包含2张图片。
每个 relevant image 都必须在 image_types 中有一个合法 MuirBench 类型。若图片类型与关系组合
无法支持任何 MuirBench 任务，则 suitable=false；不要为了通过 gate 强行改类型或关系。
category 用2-6个字。不要输出解释或 Markdown。
"""


async def _image_gate(client, images) -> dict:
    from autodata.providers.base import ChatMessage
    from autodata.agents.parsing import extract_json
    comp = await client.chat([ChatMessage(role="user", content=GATE_PROMPT, images=images)])
    try:
        obj = extract_json(comp.text)
    except ValueError:
        return {"suitable": False, "category": "unparsed", "relations": []}
    if isinstance(obj, list):
        obj = next((x for x in obj if isinstance(x, dict)), {})
    if not isinstance(obj, dict):
        return {"suitable": False, "category": "invalid", "relations": []}
    relations = obj.get("relations") if isinstance(obj.get("relations"), list) else []
    raw_image_types = obj.get("image_types") if isinstance(obj.get("image_types"), dict) else {}
    image_types = {}
    for key, value in raw_image_types.items():
        try:
            number = int(key)
        except (TypeError, ValueError):
            continue
        if 1 <= number <= len(images) and value in IMAGE_TYPES:
            image_types[number] = value
    valid = []
    for rel in relations:
        if not isinstance(rel, dict):
            continue
        nums = sorted({int(n) for n in rel.get("images", [])
                       if isinstance(n, (int, float)) and 1 <= int(n) <= len(images)})
        evidence = [str(x).strip() for x in rel.get("evidence", []) if str(x).strip()]
        relation_type = str(rel.get("type", "")).strip()
        if (len(nums) >= 2 and len(evidence) >= 2
                and relation_type in RELATION_TYPES
                and all(number in image_types for number in nums)):
            rel["images"] = nums
            rel["evidence"] = evidence
            rel["type"] = relation_type
            valid.append(rel)
    obj["relations"] = valid
    obj["relevant_images"] = sorted({n for rel in valid for n in rel["images"]})
    obj["image_types"] = {str(n): image_types[n] for n in obj["relevant_images"]
                          if n in image_types}
    selected_types = [image_types[n] for n in obj["relevant_images"] if n in image_types]
    permitted = allowed_tasks(selected_types, [rel["type"] for rel in valid])
    obj["allowed_tasks"] = permitted
    obj["suitable"] = (bool(obj.get("suitable")) and bool(valid)
                       and len(selected_types) == len(obj["relevant_images"])
                       and bool(permitted))
    return obj


def _prune_irrelevant_images(doc: dict, relation_map: dict) -> tuple[dict, dict]:
    """Keep only gate-selected images and renumber every relation to the compact list.

    The gate sees at most the first eight images, so an accepted document must never pass
    later unseen attachments to Challenger/Solvers. Preserve the original 1-based indices
    as provenance while all downstream-facing indices become 1..N.
    """
    import re

    visible_images = list(doc.get("images") or [])[:8]
    selected = sorted({int(n) for n in relation_map.get("relevant_images", [])
                       if isinstance(n, (int, float)) and 1 <= int(n) <= len(visible_images)})
    if len(selected) < 2:
        raise ValueError("relation gate selected fewer than two relevant images")
    old_to_new = {old: new for new, old in enumerate(selected, 1)}

    def renumber_text(value: object) -> str:
        text = str(value)

        def replace(match):
            old = int(match.group(1) or match.group(2))
            new = old_to_new.get(old)
            if new is None:
                return match.group(0)
            return f"Image {new}" if match.group(1) else f"图{new}"

        return re.sub(r"\bImage\s*(\d+)\b|图\s*(\d+)", replace, text,
                      flags=re.IGNORECASE)

    compact_relations = []
    for relation in relation_map.get("relations", []):
        old_nums = relation.get("images", []) if isinstance(relation, dict) else []
        new_nums = sorted({old_to_new[int(n)] for n in old_nums
                           if isinstance(n, (int, float)) and int(n) in old_to_new})
        if len(new_nums) < 2:
            continue
        compact = dict(relation)
        compact["images"] = new_nums
        compact["evidence"] = [renumber_text(x) for x in relation.get("evidence", [])]
        compact_relations.append(compact)
    if not compact_relations:
        raise ValueError("no valid relation remains after image pruning")

    pruned = dict(doc)
    pruned["images"] = [visible_images[old - 1] for old in selected]
    raw_types = relation_map.get("image_types") or {}
    compact_types = {
        str(old_to_new[old]): raw_types.get(str(old), raw_types.get(old)) for old in selected
    }
    if any(value not in IMAGE_TYPES for value in compact_types.values()):
        raise ValueError("selected image is missing a valid MuirBench image type")
    permitted = allowed_tasks(
        compact_types.values(), [relation.get("type") for relation in compact_relations]
    )
    if not permitted:
        raise ValueError("image types and relations have no compatible MuirBench task")
    compact_map = {
        "category": relation_map.get("category"),
        "source_image_indices": selected,
        "relevant_images": list(range(1, len(selected) + 1)),
        "image_types": compact_types,
        "relations": compact_relations,
        "allowed_tasks": permitted,
    }
    pruned["_relation_map"] = compact_map
    pruned["_gate_category"] = relation_map.get("category")
    return pruned, compact_map


async def _apply_gate(docs, binding, need=None):
    """Filter docs to benchmark-suitable image sets. Uses the strong VLM (7B was unstable —
    miscategorised charts/documents and hallucinated). This replaces the old yes/no gate:
    the same call now emits a reusable relation map, so no extra VLM call is added.
    Stops once `need` docs pass."""
    from collections import Counter
    c = build_client(RoleBinding(**{**binding, "max_tokens": 512, "temperature": 0.1}))
    kept, mix = [], Counter()
    from pathlib import Path as _P

    async def judge(d):
        imgs = [grounding.image_to_data_uri(_P(p)) for p in d["images"][:8]]
        imgs = [i for i in imgs if i]
        g = await _image_gate(c, imgs)
        return d, g

    # Gate requests are independent. Process them in small bounded waves so the
    # first phase no longer serializes all VLM calls, while avoiding an unbounded
    # burst against the shared strong/judge endpoint.
    concurrency = max(1, int(os.environ.get("MCQ_GATE_CONCURRENCY", "4")))
    scanned = 0
    for start in range(0, len(docs), concurrency):
        wave = docs[start:start + concurrency]
        results = await asyncio.gather(*(judge(d) for d in wave))
        scanned += len(results)
        for d, g in results:
            ok = bool(g.get("suitable"))
            mix[("keep" if ok else "skip", str(g.get("category"))[:12])] += 1
            if ok:
                original_image_count = min(8, len(d.get("images", [])))
                raw_map = {
                    "category": g.get("category"),
                    "image_types": g.get("image_types", {}),
                    "relevant_images": g.get("relevant_images", []),
                    "relations": g.get("relations", []),
                    "allowed_tasks": g.get("allowed_tasks", []),
                }
                try:
                    d, _ = _prune_irrelevant_images(d, raw_map)
                except ValueError:
                    mix[("skip", "prune_invalid")] += 1
                    continue
                mix[("images_removed", "total")] += max(
                    0, original_image_count - len(d.get("images", [])))
                kept.append(d)
        if need and len(kept) >= need:
            kept = kept[:need]
            print(f"RELATION EXTRACTOR: {len(kept)} kept after scanning {scanned} docs | {dict(mix)}")
            break
    else:
        print(f"RELATION EXTRACTOR: {len(docs)} scanned -> {len(kept)} kept | {dict(mix)}")
    await c.aclose()
    return kept


async def main():
    t0 = time.time()
    db.init()
    _install_mode_dictator()

    source_path = str(ICONQA_DATA) if DATASET_MODE == "iconqa" else DATA
    profile = source_profiler.profile_source(source_path, sample_size=8)
    print(f"PROFILE modality={profile['modality']} synthetic={profile['using_synthetic_fallback']}")

    objective = (
        "IconQA multi-image Diagram Understanding MCQ with shortcut controls"
        if DATASET_MODE == "iconqa"
        else "multi-image MCQ with unanswerable variants"
    )
    recipe = recipe_builder.build_recipe(objective, source_path, profile, [])
    recipe.generation_rubric = MCQ_RUBRIC
    rid = recipe_builder.save_recipe(recipe)
    print(f"RECIPE {rid} (MCQ rubric, {len(MCQ_RUBRIC)} chars)")

    target = int(os.environ.get("MCQ_DOCS", "60"))
    # MCQ_START is an offset in the stride-selected pool, not in the raw corpus.
    # Loading a fixed 1200 records silently capped the old script at roughly 300
    # candidates, so it could never reach a 10k accepted target. Load exactly the
    # raw prefix needed for this shard's gate scan instead. The supervisor advances
    # start after every completed shard, giving deterministic, non-overlapping input.
    start = int(os.environ.get("MCQ_START", "0"))
    gate_multiplier = max(1, int(os.environ.get("MCQ_GATE_MULTIPLIER", "8")))
    scan_n = target * gate_multiplier if os.environ.get("MCQ_GATE", "1") == "1" else target
    if DATASET_MODE == "iconqa":
        # IconQA choose_img is already a curated Graphics dataset. Its main image +
        # visual candidates are exactly the MuirBench Diagram construction, so use
        # deterministic file/metadata validation instead of spending one 235B gate call.
        docs = _load_iconqa_docs(target, start=start)
    else:
        raw_limit = 2 + 4 * (start + scan_n)
        all_docs = grounding.load_grounding({"data_path": DATA}, raw_limit)
        pool = all_docs[1::4][start:start + scan_n]
        if os.environ.get("MCQ_GATE", "1") == "1":
            docs = await _apply_gate(pool, CHAL235, need=target)
        else:
            docs = pool[:target]
    if os.environ.get("MCQ_RESUME", "0") == "1":
        accepted_doc_ids = {
            row["doc_id"] for row in db.query(
                "SELECT DISTINCT doc_id FROM examples WHERE status='accepted'"
            )
        }
        docs = [d for d in docs if d["id"] not in accepted_doc_ids]
        if DATASET_MODE == "iconqa":
            accepted_images = []
            for row in db.query(
                "SELECT images_json FROM examples WHERE status='accepted'"
            ):
                accepted_images.extend(json.loads(row["images_json"] or "[]"))
            docs, hash_skipped = filter_unique_image_docs(docs, accepted_images)
        else:
            hash_skipped = 0
        print(
            f"RESUME skipped={len(accepted_doc_ids)} accepted docs "
            f"hash_conflicts={hash_skipped}; remaining={len(docs)}"
        )
    # Small post-dedup shards are commonly 8-17 documents. Reusing the old
    # ``i % 10 in (0, 1, 2)`` rule in every shard over-allocated Chinese:
    # e.g. a 13-document shard received six Chinese items (46%), because both
    # 0..2 and 10..12 matched. Allocate one rounded 30% quota per actual shard
    # and spread those positions evenly instead.
    zh_quota = round(len(docs) * 0.30)
    for i, d in enumerate(docs):
        # IconQA/MuirBench's original 50% minimal-text mutation is easy to game.
        # Keep only 20% none-of-above in this batch; QV still requires every
        # substantive choice to be visibly contradicted.
        d["_mode"] = "unans" if i % (5 if DATASET_MODE == "iconqa" else 3) == 0 else "ans"
        # Keep the 70% English / 30% Chinese target deterministic under resume.
        # The cumulative-floor comparison selects exactly zh_quota positions,
        # distributed across the shard rather than clustered at its beginning.
        is_zh = (
            ((i + 1) * zh_quota) // len(docs) > (i * zh_quota) // len(docs)
            if docs else False
        )
        d["_language"] = "zh" if is_zh else "en"
        if DATASET_MODE != "iconqa":
            # Match MuirBench's observed option-count mix for free-form Zhihu sources.
            bucket = i % 25
            d["_option_count"] = 3 if bucket < 3 else 4 if bucket < 15 else 5
    n_unans = sum(1 for d in docs if d["_mode"] == "unans")
    n_zh = sum(1 for d in docs if d["_language"] == "zh")
    fed_prompts = Counter(
        str((d.get("_prompt_spec") or {}).get("id") or "unrouted")
        for d in docs
    )
    print(f"DOCS fed={len(docs)} unans={n_unans} ans={len(docs)-n_unans} "
          f"language=en:{len(docs)-n_zh},zh:{n_zh} "
          f"prompts={json.dumps(dict(sorted(fed_prompts.items())), ensure_ascii=False)}")
    run_manager.load_grounding = lambda _recipe, limit: docs

    roles = default_role_cfg()
    import os as _os
    # 397B is a contended shared box (owner load): keep only challenger+strong there.
    # Judge on mimo: MCQ scoring is letter comparison, fast + unloaded, temp 0.3.
    # Challenger stays on 397B — same-model challenger+weak would bias questions easy-for-weak.
    # 四角色互不重叠: challenger=35B(自有), weak=7B(自有独立机), strong/judge=mimo(外部)。
    # strong 与 judge 同为 mimo 的自评偏差在 MCQ 下可忽略(判分=选项字母机械比对)。
    # Final matrix: 122B challenger (fast, writes decent options; 35B's were too leaky and
    # 235B was too slow at ~10min/MCQ). strong+judge on the sharpest model (235B).
    roles["challenger"] = RoleBinding(**CHAL235)
    # Balance the two 235B boxes: challenger + QV/judge share 8007, while the
    # latency-sensitive strong rollout fan-out gets exclusive use of 8005.
    roles["judge"] = RoleBinding(**{**JUDGE235, "temperature": 0.3})
    roles["strong"] = RoleBinding(**VL235)
    roles["weak"] = RoleBinding(**WEAK7B)
    # verifiable, 5-way MCQ: weak (7B) has a ~20% guess floor, so 3-of-3 correct triggered
    # "too_easy" on genuinely hard items; allow up to 2 lucky hits. strong must still clear
    # 2-of-3. step_budget 3->4 gives the challenger one more chance to fix rubric nits.
    cfg = GapConfig(mode="verifiable", k_weak=3, k_strong=3,
                    weak_max_correct=2, strong_min_correct=2,
                    min_gap=1 / 3, step_budget=4)

    run_id = db.new_id("run")
    db.execute("INSERT INTO runs(id, recipe_id, role_cfg_json, gap_cfg_json, target_n,"
               " status, created_at) VALUES (?,?,?,?,?,?,?)",
               (run_id, rid, "{}", "{}", len(docs), "pending", db.now()))

    async def watch():
        async for evt in events.subscribe(run_id):
            t, p = evt["type"], evt["payload"]
            if t == "round":
                print(f"  [{time.time()-t0:6.0f}s] round={p.get('round')} {p.get('status')} "
                      f"w={p.get('weak_avg')} s={p.get('strong_avg')}")
            elif t == "example.error":
                print(f"  [{time.time()-t0:6.0f}s] ERROR {p.get('example_id')}: "
                      f"{str(p.get('error'))[:160]}")
            elif t == "example.done":
                print(f"  [{time.time()-t0:6.0f}s] DONE {p.get('status')}  "
                      f"tally {p.get('accepted')}A/{p.get('rejected')}R")
            elif t == "run.done":
                break

    watcher = asyncio.create_task(watch())
    # strong+judge now self-hosted (235B, no rate limit); 3 in flight keeps all boxes busy.
    max_inflight = max(1, int(os.environ.get("MCQ_MAX_INFLIGHT", "3")))
    await run_manager.execute_run(run_id, recipe_builder.load_recipe(rid), roles, cfg,
                                  target_n=len(docs), max_inflight=max_inflight)
    await watcher

    run = db.query_one("SELECT accepted, rejected, status FROM runs WHERE id=?", (run_id,))
    print(f"\nRUN {run} elapsed={time.time()-t0:.0f}s")

    rows = db.query(
        "SELECT e.doc_id, e.question, e.reference, e.rubric_json, e.images_json, "
        "e.weak_avg, e.strong_avg, e.gap, e.rounds, r.challenger_json "
        "FROM examples e LEFT JOIN rounds r ON r.example_id=e.id AND r.decision='accept' "
        "WHERE e.status='accepted' ORDER BY e.created_at")
    out = os.environ.get("MCQ_OUTPUT", os.path.join(_SP, "batch_mcq_accepted.jsonl"))
    from collections import Counter
    types, ans, letters = Counter(), Counter(), Counter()
    with open(out, "w") as f:
        for e in rows:
            cand = json.loads(e["challenger_json"] or "{}")
            answerable = bool(cand.get("answerable", True))
            ans["answerable" if answerable else "unanswerable"] += 1
            types[cand.get("task_type", "unlabeled")] += 1
            letters[str(cand.get("correct_answer", "?")).strip()[:1]] += 1
            f.write(json.dumps({
                "doc_id": e["doc_id"], "task_type": cand.get("task_type", "unlabeled"),
                "option_count": len(cand.get("options", [])),
                "image_types": (cand.get("relation_map") or {}).get("image_types", {}),
                "image_relations": [
                    relation.get("type") for relation in
                    (cand.get("relation_map") or {}).get("relations", [])
                    if isinstance(relation, dict)
                ],
                "relation_map": cand.get("relation_map", {}),
                "prompt_pool_id": cand.get("prompt_pool_id", ""),
                "prompt_pool_task_type": cand.get("prompt_pool_task_type", ""),
                "language": cand.get("language", "en"),
                "answerable": answerable,
                "answer_type": cand.get("answer_type", "standard"),
                "question": e["question"], "options": cand.get("options", []),
                "correct_answer": cand.get("correct_answer", ""),
                "reference": e["reference"],
                "rubric": json.loads(e["rubric_json"] or "[]"),
                "images": json.loads(e["images_json"] or "[]"),
                "weak_avg": e["weak_avg"], "strong_avg": e["strong_avg"],
                "gap": e["gap"], "rounds": e["rounds"],
            }, ensure_ascii=False) + "\n")
    print(f"EXPORTED {len(rows)} accepted -> {out}")
    print("ANSWERABLE MIX:", dict(ans))
    print("CORRECT LETTER MIX:", dict(letters.most_common()))
    print("TASK TYPE MIX:", dict(types.most_common()))


asyncio.run(main())
