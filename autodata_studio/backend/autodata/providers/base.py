"""Provider-agnostic chat interface.

The one contract every backend (OpenAI-compatible / vLLM / Anthropic / mock)
normalizes to. Images are passed as a list of data-URIs or http(s) URLs on a
message; VLM providers turn them into content parts, text providers ignore them.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ChatMessage:
    role: str                                   # "system" | "user" | "assistant"
    content: str
    images: list[str] = field(default_factory=list)   # data URIs or URLs


@dataclass
class Completion:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: float = 0.0
    model: str = ""
    raw: Optional[dict] = None


class LLMClient(abc.ABC):
    def __init__(self, model: str, is_vlm: bool = True,
                 temperature: float = 1.0, max_tokens: int = 2048):
        self.model = model
        self.is_vlm = is_vlm
        self.temperature = temperature
        self.max_tokens = max_tokens

    @abc.abstractmethod
    async def chat(self, messages: list[ChatMessage],
                   temperature: Optional[float] = None,
                   max_tokens: Optional[int] = None) -> Completion:
        ...

    async def aclose(self) -> None:  # override if the client holds a session
        return None
