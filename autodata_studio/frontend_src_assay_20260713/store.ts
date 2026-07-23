import { create } from "zustand";
import type { GapConfig, LoopState, Recipe, RoleBinding, Role, SseEvent, Tick } from "@/types";

const DEFAULT_BINDING = (): RoleBinding => ({
  provider: "mock",
  model: "mock-vlm",
  base_url: "",
  api_key_env: "",
  is_vlm: true,
  temperature: 1.0,
  max_tokens: 2048,
  enable_thinking: false,
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

export const DEFAULT_DATA_PATH =
  "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download/zhihu_answers";

export type Theme = "light" | "dark";

/**
 * Role bindings persist in this browser. Merge each stored binding over a fresh
 * default so bindings saved before a field existed (e.g. enable_thinking) load
 * with that field defined rather than undefined.
 */
const loadRoles = (): Record<Role, RoleBinding> => {
  const base = defaultRoles();
  try {
    const s = localStorage.getItem("autodata.roles");
    if (!s) return base;
    const stored = JSON.parse(s) as Partial<Record<Role, Partial<RoleBinding>>>;
    for (const r of Object.keys(base) as Role[]) {
      if (stored[r]) base[r] = { ...base[r], ...stored[r] };
    }
  } catch {
    /* corrupt entry — fall back to defaults */
  }
  return base;
};

const loadTheme = (): Theme => {
  try {
    const t = localStorage.getItem("autodata.theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyTheme = (t: Theme) => document.documentElement.classList.toggle("dark", t === "dark");

const newLoop = (p: any): LoopState => ({
  example_id: p.example_id,
  doc_id: p.doc_id,
  n_images: p.n_images,
  round: 0,
  status: "in_progress",
  agents: {},
  weakTicks: [],
  strongTicks: [],
});

/** Replace the tick at `idx`, or append it. SSE may replay, so never blind-push. */
const putTick = (ticks: Tick[], t: Tick): Tick[] => {
  const i = ticks.findIndex((x) => x.idx === t.idx);
  if (i === -1) return [...ticks, t].sort((a, b) => a.idx - b.idx);
  const next = [...ticks];
  next[i] = t;
  return next;
};

interface Store {
  theme: Theme;
  toggleTheme: () => void;

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
}

export const useStore = create<Store>((set, get) => ({
  theme: loadTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      applyTheme(theme);
      try {
        localStorage.setItem("autodata.theme", theme);
      } catch {
        /* ignore */
      }
      return { theme };
    }),

  tab: "analyze",
  setTab: (t) => set({ tab: t }),

  roles: loadRoles(),
  setRole: (r, b) =>
    set((s) => {
      const roles = { ...s.roles, [r]: { ...s.roles[r], ...b } };
      try {
        localStorage.setItem("autodata.roles", JSON.stringify(roles));
      } catch {
        /* ignore */
      }
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
  resetRun: () =>
    set({ runId: null, runStatus: "idle", loops: {}, order: [], accepted: 0, rejected: 0 }),

  /**
   * SSE reducer.
   *
   * The backend publishes exactly these event types (curation/loop.py,
   * curation/run_manager.py, feedback.py):
   *   run.status · example.start · example.error · example.done · run.done
   *   feedback.applied · agent
   *
   * There is NO "round" event type. loop.py's _emit() hardcodes type "agent" for
   * everything, so a round's outcome arrives as an AGENT event whose agent field
   * is the literal "round":
   *   {type:"agent", payload:{agent:"round", status:"accepted"|"improve"|"rejected",
   *                           round, weak_avg, strong_avg, gap, reason}}
   * Handling that special case is what puts scores on the live board at all.
   */
  applyEvent: (e) => {
    const s = get();
    const p = e.payload || {};

    if (e.type === "run.status") return set({ runStatus: p.status });

    if (e.type === "run.done")
      return set({
        runStatus: p.status,
        accepted: p.accepted ?? s.accepted,
        rejected: p.rejected ?? s.rejected,
      });

    if (e.type === "example.start") {
      if (s.loops[p.example_id]) return; // replayed
      return set({
        order: [...s.order, p.example_id],
        loops: { ...s.loops, [p.example_id]: newLoop(p) },
      });
    }

    const id = p.example_id;
    if (!id || !s.loops[id]) return;
    const loop: LoopState = {
      ...s.loops[id],
      agents: { ...s.loops[id].agents },
      weakTicks: [...s.loops[id].weakTicks],
      strongTicks: [...s.loops[id].strongTicks],
    };

    if (e.type === "example.error") {
      loop.error = p.error;
    } else if (e.type === "example.done") {
      loop.status = p.status;
      set({ accepted: p.accepted ?? s.accepted, rejected: p.rejected ?? s.rejected });
    } else if (e.type === "agent") {
      const a: string = p.agent;

      if (a === "round") {
        // A round resolved. status ∈ accepted | improve | rejected.
        if (p.status === "accepted") {
          loop.status = "accepted";
          loop.weak_avg = p.weak_avg;
          loop.strong_avg = p.strong_avg;
          loop.gap = p.gap;
        } else if (p.status === "rejected") {
          loop.status = "rejected";
        }
        loop.lastReason = p.reason || loop.lastReason;
      } else {
        loop.agents[a] = { status: p.status, info: p };
        if (p.round) loop.round = p.round;

        if (a === "challenger") {
          if (p.status === "running" && p.round && p.round > s.loops[id].round) {
            // A new round starts from a blank axis — last round's ticks are stale.
            loop.weakTicks = [];
            loop.strongTicks = [];
            loop.weak_avg = undefined;
            loop.strong_avg = undefined;
            loop.gap = undefined;
            loop.kWeak = undefined;
            loop.kStrong = undefined;
          }
          if (p.question) loop.question = p.question;
        } else if (a === "weak" || a === "strong") {
          // "running" announces k up front, so the axis can show pending slots.
          if (p.status === "running" && p.k != null) {
            if (a === "weak") loop.kWeak = p.k;
            else loop.kStrong = p.k;
          }
          // "done" carries the authoritative score list + average for the round.
          if (p.status === "done" && Array.isArray(p.scores)) {
            const ticks: Tick[] = p.scores.map((score: number, idx: number) => ({ idx, score }));
            if (a === "weak") {
              loop.weakTicks = ticks;
              loop.weak_avg = p.avg;
            } else {
              loop.strongTicks = ticks;
              loop.strong_avg = p.avg;
            }
            if (loop.weak_avg != null && loop.strong_avg != null)
              loop.gap = loop.strong_avg - loop.weak_avg;
          }
        } else if (a === "judge:weak" || a === "judge:strong") {
          // Scores stream in one rollout at a time — this is what makes the axis live.
          if (p.status === "done" && p.score != null && p.idx != null) {
            const t: Tick = { idx: p.idx, score: p.score };
            if (a === "judge:weak") loop.weakTicks = putTick(loop.weakTicks, t);
            else loop.strongTicks = putTick(loop.strongTicks, t);
          }
        }
      }
    } else {
      return; // feedback.applied and anything else: no board state
    }

    set({ loops: { ...s.loops, [id]: loop } });
  },
}));

// Sync the class on first load (index.html already did this pre-paint; keep in step).
applyTheme(useStore.getState().theme);
