"""OpenAI-compatible client — covers OpenAI, local vLLM and SGLang via base_url."""
from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

import httpx

from .. import config
from .base import ChatMessage, Completion, LLMClient
from .images import resolve_image


class OpenAICompatClient(LLMClient):
    def __init__(self, model: str, base_url: Optional[str] = None,
                 fallback_base_url: Optional[str] = None,
                 api_key_env: Optional[str] = None, is_vlm: bool = True,
                 temperature: float = 1.0, max_tokens: int = 2048,
                 enable_thinking: bool = False):
        super().__init__(model, is_vlm, temperature, max_tokens)
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.fallback_base_url = (
            fallback_base_url.rstrip("/") if fallback_base_url else None
        )
        self.api_key = os.environ.get(api_key_env or "OPENAI_API_KEY", "")
        self.enable_thinking = enable_thinking
        self._client = httpx.AsyncClient(timeout=config.HTTP_TIMEOUT)

    def _content(self, m: ChatMessage):
        if not (self.is_vlm and m.images):
            return m.content
        parts: list[dict] = [{"type": "text", "text": m.content}]
        for img in m.images:
            url = resolve_image(img)
            if url:
                parts.append({"type": "image_url", "image_url": {"url": url}})
        return parts

    async def chat(self, messages, temperature=None, max_tokens=None) -> Completion:
        payload = {
            "model": self.model,
            "messages": [{"role": m.role, "content": self._content(m)} for m in messages],
            "temperature": self.temperature if temperature is None else temperature,
            "max_tokens": self.max_tokens if max_tokens is None else max_tokens,
        }
        # Send the value explicitly. Omitting the field when False lets a Qwen3
        # server-side default silently turn thinking back on, wasting hundreds of
        # tokens on schema-constrained MCQ generation and validation.
        payload["chat_template_kwargs"] = {"enable_thinking": self.enable_thinking}
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        t0 = time.perf_counter()
        # Retry transport blips, 5xx, and 429 (rate limit) — an unretried one kills the whole
        # example, since only the challenger is wrapped in a per-round try. Other 4xx is our
        # own bad request: surface the body and raise immediately.
        last: Exception | None = None
        fresh_connection = False
        for attempt in range(config.HTTP_MAX_RETRIES):
            try:
                request_base_url = (
                    self.fallback_base_url
                    if fresh_connection and self.fallback_base_url
                    else self.base_url
                )
                if fresh_connection:
                    # A local vLLM server can close an idle keep-alive socket while
                    # httpx still has it in the shared pool. Retrying through that
                    # pool may repeatedly hit the same stale connection. Use an
                    # isolated client after a transport failure; do not close or
                    # replace the shared client because other rollout coroutines
                    # may be using it concurrently.
                    async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT) as retry_client:
                        resp = await retry_client.post(
                            f"{request_base_url}/chat/completions",
                            json=payload,
                            headers=headers,
                        )
                else:
                    resp = await self._client.post(
                        f"{request_base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                resp.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                if code != 429 and code < 500:
                    raise httpx.HTTPStatusError(
                        f"{code} from {self.model}: {e.response.text[:300]}",
                        request=e.request, response=e.response) from None
                last = e
                if code == 429:                      # honour Retry-After, else back off longer
                    ra = e.response.headers.get("retry-after")
                    wait = float(ra) if ra and ra.replace(".", "", 1).isdigit() else 5 * (attempt + 1)
                    if attempt < config.HTTP_MAX_RETRIES - 1:
                        await asyncio.sleep(min(wait, 30))
                    continue
            except httpx.TransportError as e:
                last = e
                fresh_connection = True
            if attempt < config.HTTP_MAX_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)
        else:
            if isinstance(last, httpx.TransportError):
                raise httpx.TransportError(
                    f"{self.model} request failed after {config.HTTP_MAX_RETRIES} attempts "
                    f"(primary={self.base_url}, "
                    f"fallback={self.fallback_base_url or 'none'}): {last}"
                ) from last
            raise last                                  # type: ignore[misc]
        data = resp.json()
        usage = data.get("usage", {})
        return Completion(
            text=data["choices"][0]["message"]["content"] or "",
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            latency_ms=(time.perf_counter() - t0) * 1000,
            model=self.model,
            raw=data,
        )

    async def aclose(self) -> None:
        await self._client.aclose()
