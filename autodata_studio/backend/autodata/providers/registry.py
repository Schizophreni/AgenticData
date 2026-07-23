"""Map a RoleBinding to a concrete client instance."""
from __future__ import annotations

from ..models import RoleBinding
from .anthropic import AnthropicClient
from .base import LLMClient
from .mock import MockClient
from .openai_compat import OpenAICompatClient


def build_client(binding: RoleBinding) -> LLMClient:
    kw = dict(model=binding.model, is_vlm=binding.is_vlm,
              temperature=binding.temperature, max_tokens=binding.max_tokens)
    if binding.provider == "openai_compat":
        return OpenAICompatClient(base_url=binding.base_url,
                                  fallback_base_url=binding.fallback_base_url,
                                  api_key_env=binding.api_key_env,
                                  enable_thinking=binding.enable_thinking, **kw)
    if binding.provider == "anthropic":
        return AnthropicClient(base_url=binding.base_url,
                               api_key_env=binding.api_key_env, **kw)
    return MockClient(**kw)
