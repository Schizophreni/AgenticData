import { create } from "zustand";
import { api } from "@/lib/api";
import { LOCAL_CHALLENGER, LOCAL_TEXT, LOCAL_VISION } from "@/lib/localModels";
import { EMPTY_TRANSLATOR, type TranslatorConfig } from "@/lib/translate";
import type { GapConfig, LoopState, Recipe, RoleBinding, Role, SseEvent, Tick } from "@/types";

const MOCK_BINDING = (): RoleBinding => ({
  provider: "mock",
  model: "mock-vlm",
  base_url: "",
  api_key_env: "",
  is_vlm: true,
  temperature: 1.0,
  max_tokens: 2048,
  enable_thinking: false,
});

export function mockRoles(): Record<Role, RoleBinding> {
  return {
    main: { ...MOCK_BINDING(), model: "mock-main" },
    challenger: { ...MOCK_BINDING(), model: "mock-challenger" },
    weak: { ...MOCK_BINDING(), model: "mock-weak" },
    strong: { ...MOCK_BINDING(), model: "mock-strong" },
    judge: { ...MOCK_BINDING(), model: "mock-judge" },
  };
}

const local = (m: typeof LOCAL_TEXT, over: Partial<RoleBinding> = {}): RoleBinding => ({
  provider: "openai_compat",
  model: m.id,
  base_url: m.backendUrl, // dialled BY THE BACKEND — never the browser's /llm proxy path
  api_key_env: "", // the local vLLM servers take no key
  is_vlm: m.vision,
  temperature: 1.0,
  max_tokens: 2048,
  enable_thinking: false,
  ...over,
});

/**
 * The two models actually served here, mapped onto the five roles.
 *
 * Only ONE of them can see images, so weak and strong are the SAME model — and a
 * curation run whose two solvers are identical has no capability gap to measure at
 * all. The gap is therefore made out of the one lever that matters for this task:
 *
 *   weak    qwen2.5-vl-7b with is_vlm = false — the images are dropped before the
 *           request (openai_compat.py `_content`), so it must answer from text alone
 *   strong  qwen2.5-vl-7b with is_vlm = true  — it sees the figures
 *
 * That is not a trick to manufacture a gap: the task is cross-figure reasoning, so an
 * item is only worth keeping if it CANNOT be answered without looking at the images.
 * A text-blind weak solver failing where a sighted strong solver succeeds is precisely
 * the property the data is meant to have. Change it in Provider settings if you have a
 * second vision model to pit against this one.
 *
 * Temperatures are per-role for a reason that a real run made obvious: at the old
 * blanket 1.0, the 7B challenger — asked for a long structured JSON object while
 * holding 8 images — degenerated into multilingual token salad and errored out 14
 * times in 12 documents. Structured emission and grading want a cold model; only the
 * solver rollouts want heat, because their whole job is to vary across k samples.
 */
export function localRoles(): Record<Role, RoleBinding> {
  return {
    // autoresearch + feedback fold — text only
    main: local(LOCAL_TEXT, { temperature: 0.7 }),
    // must see the figures, and must emit a valid question + reference + rubric
    challenger: local(LOCAL_CHALLENGER, { temperature: 0.5, max_tokens: 4096 }),
    // text-blind on purpose; heat gives the k rollouts something to differ about
    weak: local(LOCAL_VISION, { is_vlm: false, temperature: 0.7 }),
    strong: local(LOCAL_VISION, { temperature: 0.7 }),
    // grading must be reproducible — a judge that wanders is a broken instrument
    judge: local(LOCAL_VISION, { temperature: 0.0 }),
  };
}

function defaultRoles(): Record<Role, RoleBinding> {
  return localRoles();
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
    // One-time migration for the Challenger models previously used by this project.
    // Preserve genuinely custom endpoints selected by the user.
    const oldChallengers = new Set([
      "mock-challenger",
      "qwen2.5-vl-7b",
      "qwen3.5-35b",
      "qwen3.5-122b",
    ]);
    if (oldChallengers.has(base.challenger.model)) {
      base.challenger = local(LOCAL_CHALLENGER, { temperature: 0.5, max_tokens: 4096 });
      localStorage.setItem("autodata.roles", JSON.stringify(base));
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

type Trash = { trashed: string[]; purged: string[] };

const loadTrash = (): Trash => {
  try {
    const s = localStorage.getItem("autodata.recipeTrash");
    if (s) {
      const t = JSON.parse(s);
      return {
        trashed: Array.isArray(t.trashed) ? t.trashed : [],
        purged: Array.isArray(t.purged) ? t.purged : [],
      };
    }
  } catch {
    /* corrupt entry — start with an empty bin rather than losing the list */
  }
  return { trashed: [], purged: [] };
};

const saveTrash = (t: Trash) => {
  try {
    localStorage.setItem("autodata.recipeTrash", JSON.stringify(t));
  } catch {
    /* ignore */
  }
};

/** The browser reaches the text model through this server's /llm proxy — see localModels.ts. */
export const LOCAL_TRANSLATOR: TranslatorConfig = {
  base_url: LOCAL_TEXT.browserUrl,
  model: LOCAL_TEXT.id,
  api_key: "",
};

const loadTranslator = (): TranslatorConfig => {
  try {
    const s = localStorage.getItem("autodata.translator");
    if (s) {
      const saved = { ...EMPTY_TRANSLATOR, ...JSON.parse(s) } as TranslatorConfig;
      // The local text endpoint moved from the retired 35B service to the
      // dedicated 7B translator. Migrate only our relative proxy binding and
      // leave genuinely custom translator endpoints untouched.
      const normalizedBase = saved.base_url.trim().replace(/^\//, "").replace(/\/+$/, "");
      const wasLocalTextEndpoint =
        normalizedBase === LOCAL_TEXT.browserUrl ||
        normalizedBase === "llm/text/v1" ||
        /^https?:\/\/(127\.0\.0\.1|localhost):8002\/v1$/.test(normalizedBase);
      if (wasLocalTextEndpoint && saved.model === "qwen3.5-35b") {
        localStorage.setItem("autodata.translator", JSON.stringify(LOCAL_TRANSLATOR));
        return { ...LOCAL_TRANSLATOR };
      }
      return saved;
    }
  } catch {
    /* corrupt entry — fall back to the local model */
  }
  return { ...LOCAL_TRANSLATOR };
};

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
  /**
   * One click to point every role (and the translator) at the models served here, or
   * back at the mock. Changing the DEFAULTS is not enough on its own: a browser that
   * has used this app already has its bindings in localStorage, and those win.
   */
  applyPreset: (p: "local" | "mock") => void;

  gap: GapConfig;
  setGap: (g: Partial<GapConfig>) => void;
  targetN: number;
  setTargetN: (n: number) => void;

  recipe: Recipe | null;
  profile: any | null;
  setRecipe: (r: Recipe, p: any) => void;

  /** Past recipes, listed in the Analyze sidebar. Backed by GET /api/recipes. */
  recipes: any[];
  loadRecipes: () => Promise<void>;
  openRecipe: (id: string) => Promise<void>;

  /**
   * The recipe trash.
   *
   * The API has no DELETE endpoint — recipes cannot actually be removed from the
   * backend. So both of these are browser-local: `trashed` hides a recipe from the
   * list but keeps it one click from coming back, and `purged` hides it for good.
   * Neither touches the database, and the UI must say so rather than implying the
   * recipe is gone. (A real DELETE /api/recipes/{id} is filed as a global decision.)
   */
  trashed: string[];
  purged: string[];
  trashRecipe: (id: string) => void;
  restoreRecipe: (id: string) => void;
  purgeRecipe: (id: string) => void;

  /** Where selection-translation sends its text. See lib/translate.ts for why it lives here. */
  translator: TranslatorConfig;
  setTranslator: (t: Partial<TranslatorConfig>) => void;

  runId: string | null;
  runStatus: string;
  accepted: number;
  rejected: number;
  loops: Record<string, LoopState>;
  order: string[];
  startRun: (id: string) => void;
  applyEvent: (e: SseEvent) => void;
  resetRun: () => void;

  /** Preview: the sidebar lists these and the main pane renders the selected one. */
  examples: any[];
  setExamples: (rows: any[]) => void;
  selectedExample: string | null;
  selectExample: (id: string | null) => void;

  /**
   * Load a run that already finished, so its specimens can be reviewed. Without this
   * the app can only ever show the run it just started — every past run, including
   * every real one already in the database, was unreachable.
   */
  openRun: (id: string, destination?: "preview" | "curate") => Promise<void>;
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

  // This deployment is primarily a live review surface. Open the persisted
  // accepted dataset immediately instead of showing an empty Analyze bench.
  tab: "preview",
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

  applyPreset: (p) =>
    set(() => {
      const roles = p === "local" ? localRoles() : mockRoles();
      const translator = p === "local" ? { ...LOCAL_TRANSLATOR } : { ...EMPTY_TRANSLATOR };
      try {
        localStorage.setItem("autodata.roles", JSON.stringify(roles));
        localStorage.setItem("autodata.translator", JSON.stringify(translator));
      } catch {
        /* ignore */
      }
      return { roles, translator };
    }),

  gap: DEFAULT_GAP,
  setGap: (g) => set((s) => ({ gap: { ...s.gap, ...g } })),
  targetN: 8,
  setTargetN: (n) => set({ targetN: n }),

  recipe: null,
  profile: null,
  setRecipe: (r, p) => set({ recipe: r, profile: p }),

  recipes: [],
  loadRecipes: async () => {
    try {
      set({ recipes: await api.listRecipes() });
    } catch {
      /* the list is a convenience; a failure here must not block analysis */
    }
  },
  openRecipe: async (id) => {
    const r = await api.getRecipe(id);
    // GET /api/recipes/{id} returns the recipe alone — there is no stored profile.
    set({ recipe: r.recipe ?? r, profile: null });
  },

  translator: loadTranslator(),
  setTranslator: (t) =>
    set((s) => {
      const translator = { ...s.translator, ...t };
      try {
        localStorage.setItem("autodata.translator", JSON.stringify(translator));
      } catch {
        /* ignore */
      }
      return { translator };
    }),

  ...loadTrash(),
  trashRecipe: (id) =>
    set((s) => {
      const next = {
        trashed: s.trashed.includes(id) ? s.trashed : [...s.trashed, id],
        purged: s.purged,
      };
      saveTrash(next);
      // Trashing the recipe currently on the bench takes it off the bench too —
      // leaving it loaded while it has vanished from the list reads as a glitch.
      const clearing = s.recipe?.id === id;
      return { ...next, ...(clearing ? { recipe: null, profile: null } : {}) };
    }),
  restoreRecipe: (id) =>
    set((s) => {
      const next = { trashed: s.trashed.filter((x) => x !== id), purged: s.purged };
      saveTrash(next);
      return next;
    }),
  purgeRecipe: (id) =>
    set((s) => {
      const next = {
        trashed: s.trashed.filter((x) => x !== id),
        purged: s.purged.includes(id) ? s.purged : [...s.purged, id],
      };
      saveTrash(next);
      return next;
    }),

  runId: null,
  runStatus: "idle",
  accepted: 0,
  rejected: 0,
  loops: {},
  order: [],
  startRun: (id) =>
    set({
      runId: id, runStatus: "running", accepted: 0, rejected: 0,
      loops: {}, order: [], examples: [], selectedExample: null,
    }),
  resetRun: () =>
    set({
      runId: null, runStatus: "idle", loops: {}, order: [], accepted: 0, rejected: 0,
      examples: [], selectedExample: null,
    }),

  examples: [],
  setExamples: (rows) =>
    set((s) => ({
      examples: rows,
      selectedExample: rows.some((r) => r.id === s.selectedExample)
        ? s.selectedExample
        : rows[0]?.id ?? null,
    })),
  selectedExample: null,
  selectExample: (id) => set({ selectedExample: id }),

  openRun: async (id, destination = "preview") => {
    const run = await api.getRun(id); // throws on an unknown id — the caller surfaces it
    const rows = await api.runExamples(id);
    const loadedRecipe = run.recipe_id
      ? await api.getRecipe(run.recipe_id).catch(() => null)
      : null;
    const loops = Object.fromEntries(rows.map((row: any) => {
      const ticks = (avg: number | null | undefined): Tick[] => {
        if (avg == null) return [];
        const correct = Math.max(0, Math.min(3, Math.round(Number(avg) * 3)));
        return [0, 1, 2].map((idx) => ({ idx, score: idx < correct ? 1 : 0 }));
      };
      const done = { status: "done" as const };
      const loop: LoopState = {
        example_id: row.id,
        doc_id: row.doc_id || row.id,
        n_images: row.n_images || 0,
        round: row.rounds || 1,
        status: row.status,
        question: row.question,
        agents: {
          challenger: done, verifier: done, weak: done, strong: done,
          "judge:weak": done, "judge:strong": done,
        },
        kWeak: 3,
        kStrong: 3,
        weakTicks: ticks(row.weak_avg),
        strongTicks: ticks(row.strong_avg),
        weak_avg: row.weak_avg,
        strong_avg: row.strong_avg,
        gap: row.gap,
        lastReason: row.accept_reason,
      };
      return [row.id, loop];
    }));
    set({
      runId: id,
      runStatus: run.status ?? "done",
      accepted: run.accepted ?? rows.filter((r: any) => r.status === "accepted").length,
      rejected: run.rejected ?? rows.filter((r: any) => r.status === "rejected").length,
      loops: destination === "curate" ? loops : {},
      order: destination === "curate" ? rows.map((row: any) => row.id) : [],
      examples: rows,
      selectedExample: rows[0]?.id ?? null,
      recipe: loadedRecipe ?? get().recipe,
      tab: destination,
    });
  },

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
