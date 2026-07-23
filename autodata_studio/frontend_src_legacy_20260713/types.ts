export type ProviderKind = "openai_compat" | "anthropic" | "mock";
export type Role = "main" | "challenger" | "weak" | "strong" | "judge";

export interface RoleBinding {
  provider: ProviderKind;
  model: string;
  base_url?: string | null;
  api_key_env?: string | null;
  is_vlm: boolean;
  temperature: number;
  max_tokens: number;
}

export type GapMode = "verifiable" | "rubric_threshold" | "flexible_judge";

export interface GapConfig {
  mode: GapMode;
  strong_floor: number;
  weak_ceiling: number;
  min_gap: number;
  weak_max_correct: number;
  strong_min_correct: number;
  k_weak: number;
  k_strong: number;
  step_budget: number;
}

export interface RubricItem {
  number: number;
  criterion: string;
  category: "positive" | "negative";
  capability: string;
  weight: number;
}

export interface Recipe {
  id: string;
  task: string;
  data_path: string;
  modality: string;
  brief: { claim: string; source: string; confidence: string }[];
  pipeline_spec: string[];
  gen_rubric: string;
  quality_rubric: RubricItem[];
  version: number;
}

export interface SseEvent {
  ts: number;
  type: string;
  payload: any;
}

export type AgentStatus = "idle" | "running" | "done" | "failed";

export interface LoopState {
  example_id: string;
  doc_id: string;
  n_images: number;
  round: number;
  status: "in_progress" | "accepted" | "rejected";
  question?: string;
  agents: Record<string, { status: AgentStatus; info?: any }>;
  weak_avg?: number;
  strong_avg?: number;
  gap?: number;
  lastReason?: string;
}
