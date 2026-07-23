"""Solver agent (weak or strong): question + images -> answer."""
from __future__ import annotations

from ..providers.base import ChatMessage, LLMClient
from . import prompts


async def run_solver(client: LLMClient, question: str, images: list[str],
                     is_mcq: bool = False) -> dict:
    user = ChatMessage(role="user", content=f"Question: {question}\n\nAnswer using the images.",
                       images=images)
    system = prompts.MCQ_SOLVER if is_mcq else prompts.SOLVER
    comp = await client.chat([ChatMessage("system", system), user])
    return {"answer": comp.text, "latency_ms": comp.latency_ms,
            "tokens": comp.completion_tokens}
