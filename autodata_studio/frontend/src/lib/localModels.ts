/**
 * The two vLLM models served next to this app, and the two DIFFERENT addresses each
 * one has depending on who is calling.
 *
 *   backendUrl   what a ROLE BINDING uses. Role bindings are dialled by the backend
 *                (autodata/providers/openai_compat.py), which runs in the same
 *                container as the SSH tunnels, so it reaches 127.0.0.1 directly.
 *
 *   browserUrl   what the BROWSER uses — today only selection translation. The browser
 *                runs on the user's own machine, where 127.0.0.1 is their laptop, not
 *                this container. These requests go through the dev/preview server's
 *                /llm proxy (see vite.config.ts), which does sit beside the tunnels.
 *                It is a RELATIVE path on purpose: resolved against the current page,
 *                it keeps working under the path-prefixed reverse proxy, exactly like
 *                lib/api.ts. An absolute "/llm/..." would break there.
 *
 * Getting these two backwards is the whole trap: a role binding pointed at the proxy
 * path would have the backend calling itself, and a browser call pointed at
 * 127.0.0.1 would hit the user's laptop.
 */
export interface LocalModel {
  id: string;
  label: string;
  backendUrl: string;
  browserUrl: string;
  vision: boolean;
}

export const LOCAL_TEXT: LocalModel = {
  id: "qwen2.5-7b-translator",
  label: "Qwen2.5-7B-Instruct (Translator)",
  backendUrl: "http://127.0.0.1:8002/v1",
  browserUrl: "llm/text/v1",
  vision: false,
};

export const LOCAL_VISION: LocalModel = {
  id: "qwen2.5-vl-7b",
  label: "Qwen2.5-VL-7B-Instruct",
  backendUrl: "http://127.0.0.1:8004/v1",
  browserUrl: "llm/vision/v1",
  vision: true,
};

export const LOCAL_CHALLENGER: LocalModel = {
  id: "qwen3-vl-235b",
  label: "Qwen3-VL-235B-A22B-Instruct (Challenger)",
  backendUrl: "http://127.0.0.1:8007/v1",
  browserUrl: "llm/challenger/v1",
  vision: true,
};

export const LOCAL_MODELS = [LOCAL_TEXT, LOCAL_VISION, LOCAL_CHALLENGER];
