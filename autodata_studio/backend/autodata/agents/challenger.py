"""Challenger agent: grounding doc (+feedback) -> {question, reference, rubric}."""
from __future__ import annotations

from ..providers.base import ChatMessage, LLMClient
from . import prompts
from .parsing import extract_json


async def run_challenger(client: LLMClient, doc: dict, generation_rubric: str,
                         feedback: str | None) -> dict:
    system = prompts.CHALLENGER.format(
        generation_rubric=generation_rubric or "(none provided)",
        feedback=feedback or "(first round — no feedback yet)",
    )
    images = doc.get("images", [])
    # The doc text may mention figures that were dropped by the per-doc image cap,
    # so state the surviving range explicitly or the question cites images we never sent.
    user = ChatMessage(
        role="user",
        content=(f"You are given exactly {len(images)} images, numbered Image 1 to "
                 f"Image {len(images)} in the order shown. Never refer to an image "
                 f"outside that range, even if the text mentions more.\n\n"
                 "Grounding document text:\n" + doc.get("text", "")[:6000] +
                 "\n\nProduce the multi-image example as strict JSON."),
        images=images,
    )
    comp = await client.chat([ChatMessage("system", system), user])
    obj = extract_json(comp.text)
    if isinstance(obj, list):                    # some models wrap the example in an array
        obj = next((x for x in obj if isinstance(x, dict) and "question" in x), None) or {}
    if not isinstance(obj, dict) or "question" not in obj:
        raise ValueError(f"challenger returned no question object: {str(obj)[:200]}")
    obj.setdefault("images", doc.get("images", []))
    obj["_latency_ms"] = comp.latency_ms
    obj["_tokens"] = comp.completion_tokens
    return obj
