"""Pydantic schemas shared across the API and engine."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Role = Literal["main", "challenger", "weak", "strong", "judge"]
Provider = Literal["openai_compat", "anthropic", "mock"]


# ---------------------------------------------------------------- providers ---
class RoleBinding(BaseModel):
    provider: Provider = "mock"
    model: str = "mock-vlm"
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None          # name of env var holding the key
    is_vlm: bool = True
    temperature: float = 1.0
    max_tokens: int = 2048
    enable_thinking: bool = False              # Qwen3: per-request chat_template_kwargs override


def default_role_cfg() -> dict[str, RoleBinding]:
    return {r: RoleBinding() for r in ("main", "challenger", "weak", "strong", "judge")}


# ------------------------------------------------------------------- rubric ---
class RubricItem(BaseModel):
    number: int
    criterion: str
    category: Literal["positive", "negative"] = "positive"
    capability: str = "reasoning"
    weight: int = 1


# ------------------------------------------------------------------- recipe ---
class QualityStandard(BaseModel):
    claim: str
    source: str = ""
    confidence: Literal["high", "medium", "low"] = "medium"


class Recipe(BaseModel):
    id: Optional[str] = None
    task: str
    data_path: str
    modality: Literal["text", "image", "interleaved"] = "interleaved"
    brief: list[QualityStandard] = Field(default_factory=list)
    pipeline_spec: list[str] = Field(default_factory=list)
    generation_rubric: str = ""                 # instructions to the challenger
    quality_rubric: list[RubricItem] = Field(default_factory=list)
    version: int = 1


class RecipeRequest(BaseModel):
    task: str
    data_path: str
    modality: Literal["text", "image", "interleaved"] = "interleaved"
    do_autoresearch: bool = True
    sample_size: int = 24
    main: RoleBinding = Field(default_factory=RoleBinding)


# --------------------------------------------------------------- gap config ---
GapMode = Literal["verifiable", "rubric_threshold", "flexible_judge"]


class GapConfig(BaseModel):
    mode: GapMode = "rubric_threshold"
    # rubric_threshold knobs (paper CS defaults):
    strong_floor: float = 0.65
    weak_ceiling: float = 0.50
    min_gap: float = 0.20
    # verifiable knobs:
    weak_max_correct: int = 1
    strong_min_correct: int = 3
    # rollouts:
    k_weak: int = 4
    k_strong: int = 3
    step_budget: int = 15


# ---------------------------------------------------------------------- run ---
class RunRequest(BaseModel):
    recipe_id: str
    roles: dict[str, RoleBinding] = Field(default_factory=default_role_cfg)
    gap: GapConfig = Field(default_factory=GapConfig)
    target_n: int = 10
    max_inflight: int = 4


class RunSummary(BaseModel):
    id: str
    recipe_id: str
    status: str
    target_n: int
    accepted: int
    rejected: int


# ----------------------------------------------------------------- feedback ---
class FeedbackRequest(BaseModel):
    comment: str
    ratings: dict[str, int] = Field(default_factory=dict)   # 1..5 per axis
    apply: bool = False                                      # send back to main agent
