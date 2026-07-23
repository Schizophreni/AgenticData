import { create } from "zustand";
import type { GapConfig, LoopState, Recipe, RoleBinding, Role, SseEvent } from "./types";

const DEFAULT_BINDING = (): RoleBinding => ({
  provider: "mock",
  model: "mock-vlm",
  base_url: "",
  api_key_env: "",
  is_vlm: true,
  temperature: 1.0,
  max_tokens: 2048,
});

function defaultRoles(): Record<Role, RoleBinding> {
  return {
    main: { ...DEFAULT_BINDING(), model: "mock-main" },
    challenger: { ...DEFAULT_BINDING(), model: "mock-challenger" },
    weak: { ...DEFAULT_BINDING(), model: "mock-weak" },
    strong: { ...DEFAULT_BINDING(), model: "mock-strong" },
    judge: { ...DEFAULT_BINDING(), model: "mock-judge" },
  };
}

const DEFAULT_GAP: GapConfig = {
  mode: "rubric_threshold",
  strong_floor: 0.65,
  weak_ceiling: 0.5,
  min_gap: 0.2,
  weak_max_correct: 1,
  strong_min_correct: 3,
  k_weak: 4,
  k_strong: 3,
  step_budget: 15,
};

interface Store {
  tab: string;
  setTab: (t: string) => void;

  roles: Record<Role, RoleBinding>;
  setRole: (r: Role, b: Partial<RoleBinding>) => void;

  gap: GapConfig;
  setGap: (g: Partial<GapConfig>) => void;
  targetN: number;
  setTargetN: (n: number) => void;

  recipe: Recipe | null;
  profile: any | null;
  setRecipe: (r: Recipe, p: any) => void;

  runId: string | null;
  runStatus: string;
  accepted: number;
  rejected: number;
  loops: Record<string, LoopState>;
  order: string[];
  startRun: (id: string) => void;
  applyEvent: (e: SseEvent) => void;
  resetRun: () => void;

  selectedExample: string | null;
  selectExample: (id: string | null) => void;
}

const loadRoles = (): Record<Role, RoleBinding> => {
  try {
    const s = localStorage.getItem("autodata.roles");
    if (s) return JSON.parse(s);
  } catch {}
  return defaultRoles();
};

export const useStore = create<Store>((set, get) => ({
  tab: "analysis",
  setTab: (t) => set({ tab: t }),

  roles: loadRoles(),
  setRole: (r, b) =>
    set((s) => {
      const roles = { ...s.roles, [r]: { ...s.roles[r], ...b } };
      try {
        localStorage.setItem("autodata.roles", JSON.stringify(roles));
      } catch {}
      return { roles };
    }),

  gap: DEFAULT_GAP,
  setGap: (g) => set((s) => ({ gap: { ...s.gap, ...g } })),
  targetN: 8,
  setTargetN: (n) => set({ targetN: n }),

  recipe: null,
  profile: null,
  setRecipe: (r, p) => set({ recipe: r, profile: p }),

  runId: null,
  runStatus: "idle",
  accepted: 0,
  rejected: 0,
  loops: {},
  order: [],
  startRun: (id) =>
    set({ runId: id, runStatus: "running", accepted: 0, rejected: 0, loops: {}, order: [] }),
  resetRun: () => set({ runId: null, runStatus: "idle", loops: {}, order: [], accepted: 0, rejected: 0 }),

  applyEvent: (e) => {
    const s = get();
    const p = e.payload || {};
    if (e.type === "run.status") {
      set({ runStatus: p.status });
      return;
    }
    if (e.type === "run.done") {
      set({ runStatus: p.status, accepted: p.accepted ?? s.accepted, rejected: p.rejected ?? s.rejected });
      return;
    }
    if (e.type === "example.start") {
      const id = p.example_id;
      if (s.loops[id]) return;
      set({
        order: [...s.order, id],
        loops: {
          ...s.loops,
          [id]: {
            example_id: id,
            doc_id: p.doc_id,
            n_images: p.n_images,
            round: 0,
            status: "in_progress",
            agents: {},
          },
        },
      });
      return;
    }
    const id = p.example_id;
    if (!id || !s.loops[id]) return;
    const loop = { ...s.loops[id], agents: { ...s.loops[id].agents } };

    if (e.type === "agent") {
      loop.agents[p.agent] = { status: p.status, info: p };
      if (p.round) loop.round = p.round;
      if (p.agent === "challenger" && p.question) loop.question = p.question;
    } else if (e.type === "round") {
      if (p.status === "accepted") {
        loop.status = "accepted";
        loop.weak_avg = p.weak_avg;
        loop.strong_avg = p.strong_avg;
        loop.gap = p.gap;
      } else if (p.status === "rejected") {
        loop.status = "rejected";
      }
      loop.lastReason = p.reason || loop.lastReason;
    } else if (e.type === "example.done") {
      loop.status = p.status;
      set({ accepted: p.accepted ?? s.accepted, rejected: p.rejected ?? s.rejected });
    }
    set({ loops: { ...s.loops, [id]: loop } });
  },

  selectedExample: null,
  selectExample: (id) => set({ selectedExample: id }),
}));
