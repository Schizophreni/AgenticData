import type { GapConfig, Recipe, RoleBinding, Role } from "@/types";

/**
 * Resolve API paths against the directory of the current page, so requests work
 * both under a direct port-forward (http://localhost:5173/) and under a
 * path-prefixed reverse proxy (https://host/.../proxy/5173/). Absolute "/api/..."
 * would break under the latter, hence this runtime base.
 */
const BASE = new URL(".", window.location.href).href; // always ends with "/"
export const apiUrl = (path: string) => BASE + "api/" + path.replace(/^\/+/, "");

/** Render an image ref: data URIs / URLs pass through; server file paths go via /api/image. */
export const imageSrc = (ref: string) =>
  ref.startsWith("data:") || ref.startsWith("http")
    ? ref
    : apiUrl("image") + "?path=" + encodeURIComponent(ref);

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const jsonPost = (path: string, body: unknown) =>
  fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  health() {
    return fetch(apiUrl("health")).then((r) => j<{ status: string }>(r));
  },
  pipelineHealth() {
    return fetch(apiUrl("pipeline-health")).then((r) => j<any>(r));
  },

  createRecipe(body: {
    task: string;
    data_path: string;
    modality?: string;
    do_autoresearch?: boolean;
    sample_size?: number;
    main?: RoleBinding;
  }) {
    return jsonPost("recipes", body).then((r) => j<{ recipe: Recipe; profile: any }>(r));
  },

  listRecipes() {
    return fetch(apiUrl("recipes")).then((r) => j<any[]>(r));
  },
  getRecipe(id: string) {
    return fetch(apiUrl(`recipes/${id}`)).then((r) => j<any>(r));
  },

  createRun(body: {
    recipe_id: string;
    roles: Record<Role, RoleBinding>;
    gap: GapConfig;
    target_n: number;
    max_inflight: number;
  }) {
    return jsonPost("runs", body).then((r) => j<{ run_id: string }>(r));
  },

  getRun(id: string) {
    return fetch(apiUrl(`runs/${id}`)).then((r) => j<any>(r));
  },
  listRuns() {
    return fetch(apiUrl("runs")).then((r) => j<any[]>(r));
  },
  promptEvolution(runId = "run_mcq_live_merged") {
    return fetch(apiUrl("prompt-evolution") + `?run_id=${encodeURIComponent(runId)}`).then((r) => j<any>(r));
  },
  proposePromptEvolution(runId = "run_mcq_live_merged") {
    return jsonPost("prompt-evolution/propose", { run_id: runId }).then((r) => j<any>(r));
  },
  activatePromptEvolution(id: string) {
    return jsonPost(`prompt-evolution/${id}/activate`, {}).then((r) => j<any>(r));
  },
  runExamples(id: string) {
    return fetch(apiUrl(`runs/${id}/examples`)).then((r) => j<any[]>(r));
  },
  getExample(id: string) {
    return fetch(apiUrl(`examples/${id}`)).then((r) => j<any>(r));
  },
  postFeedback(id: string, body: { comment: string; ratings: Record<string, number>; apply: boolean }) {
    return jsonPost(`examples/${id}/feedback`, body).then((r) => j<any>(r));
  },
  cancelRun(id: string) {
    return fetch(apiUrl(`runs/${id}/cancel`), { method: "POST" }).then((r) => j<any>(r));
  },
  exportUrl(id: string) {
    return apiUrl(`export/${id}`);
  },
};
