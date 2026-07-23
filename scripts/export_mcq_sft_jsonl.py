#!/usr/bin/env python3
"""Export accepted MCQs to the multimodal messages JSONL training schema."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


MEDIA_TOKEN_RE = re.compile(r"<\|(?:image|video)\|>|<image>|<video>", re.IGNORECASE)
SYSTEM_PROMPT = "你是一个能够分析多媒体内容的智能助手。"


def answer_text(row: dict) -> str:
    reference = row.get("reference") or row.get("reference_answer")
    if isinstance(reference, str) and reference.strip():
        return reference.strip()
    answer = str(row.get("correct_answer") or row.get("annotated_answer") or "").strip().upper()
    if answer:
        return f"The correct answer is option {answer}."
    raise ValueError("missing reference and correct_answer")


def convert(row: dict) -> dict:
    images = row.get("images")
    question = row.get("question")
    if not isinstance(images, list) or not all(isinstance(path, str) for path in images):
        raise ValueError("images must be a list of paths")
    if not isinstance(question, str) or not question.strip():
        raise ValueError("question must be a non-empty string")

    absolute_images = []
    for path in images:
        image_path = Path(path).expanduser()
        if not image_path.is_absolute():
            raise ValueError(f"image path is not absolute: {path}")
        absolute_images.append(str(image_path))
    clean_question = MEDIA_TOKEN_RE.sub("", question).strip()
    tokens = "\n".join("<|image|>" for _ in absolute_images)
    user_content = f"{tokens}\n{clean_question}" if tokens else clean_question

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": answer_text(row)},
        ],
        "images": absolute_images,
        "videos": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    exported = 0
    with args.input.open("r", encoding="utf-8") as source, args.output.open(
        "w", encoding="utf-8"
    ) as target:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                converted = convert(json.loads(line))
            except Exception as exc:
                raise ValueError(f"invalid source row {line_number}: {exc}") from exc
            target.write(json.dumps(converted, ensure_ascii=False) + "\n")
            exported += 1
    print(json.dumps({"input_rows": exported, "output_rows": exported, "output": str(args.output)}))


if __name__ == "__main__":
    main()
