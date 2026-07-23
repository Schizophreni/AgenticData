"""Anthropic client via the Messages REST API (no SDK dependency required).

Supports image blocks (base64 data-URIs or URLs) for VLM roles.
"""
from __future__ import annotations

import os
import re
import time
from typing import Optional

import httpx

from .. import config
from .base import ChatMessage, Completion, LLMClient
from .images import resolve_image

_DATA_URI = re.compile(r"^data:(?P<mt>[^;]+);base64,(?P<b64>.+)$", re.DOTALL)


class AnthropicClient(LLMClient):
    def __init__(self, model: str, base_url: Optional[str] = None,
                 api_key_env: Optional[str] = None, is_vlm: bool = True,
                 temperature: float = 1.0, max_tokens: int = 2048):
        super().__init__(model, is_vlm, temperature, max_tokens)
        self.base_url = (base_url or "https://api.anthropic.com").rstrip("/")
        self.api_key = os.environ.get(api_key_env or "ANTHROPIC_API_KEY", "")
        self._client = httpx.AsyncClient(timeout=config.HTTP_TIMEOUT)

    def _image_block(self, img: str) -> Optional[dict]:
        img = resolve_image(img) or img
        m = _DATA_URI.match(img)
        if m:
            return {"type": "image",
                    "source": {"type": "base64", "media_type": m.group("mt"),
                               "data": m.group("b64")}}
        if img.startswith("http"):
            return {"type": "image", "source": {"type": "url", "url": img}}
        return None

    def _content(self, m: ChatMessage):
        if not (self.is_vlm and m.images):
            return m.content
        blocks = [{"type": "text", "text": m.content}]
        for img in m.images:
            b = self._image_block(img)
            if b:
                blocks.append(b)
        return blocks

    async def chat(self, messages, temperature=None, max_tokens=None) -> Completion:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        convo = [{"role": m.role, "content": self._content(m)}
                 for m in messages if m.role != "system"]
        payload = {
            "model": self.model,
            "system": system,
            "messages": convo,
            "temperature": self.temperature if temperature is None else temperature,
            "max_tokens": self.max_tokens if max_tokens is None else max_tokens,
        }
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        t0 = time.perf_counter()
        resp = await self._client.post(f"{self.base_url}/v1/messages",
                                       json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        text = "".join(b.get("text", "") for b in data.get("content", [])
                       if b.get("type") == "text")
        usage = data.get("usage", {})
        return Completion(
            text=text,
            prompt_tokens=usage.get("input_tokens", 0),
            completion_tokens=usage.get("output_tokens", 0),
            latency_ms=(time.perf_counter() - t0) * 1000,
            model=self.model,
            raw=data,
        )

    async def aclose(self) -> None:
        await self._client.aclose()
