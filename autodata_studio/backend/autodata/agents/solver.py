"""Solver agent (weak or strong): question + images -> answer."""
from __future__ import annotations

from ..providers.base import ChatMessage, LLMClient
from . import prompts


async def run_solver(client: LLMClient, question: str, images: list[str],
                     is_mcq: bool = False) -> dict:
    if is_mcq:
        # Repeat the terse-output contract after the question. Some VLMs follow
        # the most recent instruction more reliably than the system message;
        # without this suffix they may spend the entire token budget reasoning
        # and get truncated before emitting the selected letter.
        suffix = (
            "\n\nAnswer protocol (mandatory): output exactly one uppercase option "
            "letter and no other text. Your response must be only A, B, C, D, or E."
        )
    else:
        suffix = "\n\nAnswer using the images."
    user = ChatMessage(
        role="user",
        content=f"Question: {question}{suffix}",
        images=images,
    )
    system = prompts.MCQ_SOLVER if is_mcq else prompts.SOLVER
    comp = await client.chat([ChatMessage("system", system), user])
    return {"answer": comp.text, "latency_ms": comp.latency_ms,
            "tokens": comp.completion_tokens}
