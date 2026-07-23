/**
 * Selection translation, English → Chinese.
 *
 * Translating needs a model, and this frontend has no privileged way to reach one:
 *
 *   - The backend has no /api/translate endpoint, and the backend is out of scope for
 *     this branch. That is where this SHOULD live — it would reuse the server-side API
 *     keys the role bindings already name (api_key_env), avoid CORS entirely, and keep
 *     the key out of the browser. It is filed as a proposed global decision.
 *   - A role binding's `api_key_env` is the NAME of a server-side environment variable.
 *     The browser cannot resolve it, so role bindings cannot be reused as-is.
 *
 * So until that endpoint exists, the browser talks to an OpenAI-compatible endpoint
 * itself. Two consequences the UI must state plainly rather than hide:
 *   1. the endpoint has to send CORS headers, and
 *   2. the API key is held in this browser's localStorage and sent from the browser.
 *
 * Chrome 138+ ships an on-device Translator API. When it is there we prefer nothing —
 * it is only used as a fallback, because it is a general-purpose translator and the
 * text here is dense ML jargon that a bound model handles better. It needs no key and
 * no server, so it is worth having when no endpoint is configured.
 */

export interface TranslatorConfig {
  /** OpenAI-compatible base, e.g. http://host:8001/v1 */
  base_url: string;
  model: string;
  /** Sent as a Bearer token, straight from the browser. Empty is fine for local vLLM. */
  api_key: string;
}

export const EMPTY_TRANSLATOR: TranslatorConfig = { base_url: "", model: "", api_key: "" };

export const hasEndpoint = (c: TranslatorConfig) => !!c.base_url.trim() && !!c.model.trim();

/**
 * Every call into the on-device translator is time-boxed.
 *
 * `Translator.availability()` is a capability CHECK, but it does not always answer:
 * where the API exists and the language pack does not, it can wait forever on a
 * download that never lands. Awaiting it unguarded hung the whole popover on
 * "Translating…" with nothing thrown and nothing to retry. A probe that can hang is
 * a probe that must have a deadline.
 */
function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout());
      }
    );
  });
}

const PROBE_MS = 1500;
const TRANSLATE_MS = 20_000;

/** Chrome's on-device translator, if this browser has it AND it answers promptly. */
async function builtinAvailable(): Promise<boolean> {
  const T = (self as any).Translator;
  if (!T?.availability) return false;
  return withDeadline(
    (async () => (await T.availability({ sourceLanguage: "en", targetLanguage: "zh" })) !== "unavailable")(),
    PROBE_MS,
    () => false
  );
}

async function translateBuiltin(text: string): Promise<string> {
  const T = (self as any).Translator;
  const out = await withDeadline(
    (async () => {
      const t = await T.create({ sourceLanguage: "en", targetLanguage: "zh" });
      return (await t.translate(text)) as string | null;
    })(),
    TRANSLATE_MS,
    () => null
  );
  if (out == null)
    throw new Error("The browser's on-device translator did not respond. Set an endpoint instead.");
  return out;
}

const SYSTEM =
  "You are a translator for an ML data-curation tool. Translate the user's English text into " +
  "Simplified Chinese. Keep technical terms, model names, metric names, file paths and code " +
  "identifiers as they are. Return the translation only — no notes, no quotes, no preamble.";

/**
 * A base_url may be absolute (someone's own remote endpoint) or relative — the local
 * models are reached through this server's /llm proxy as "llm/text/v1". A relative one
 * is resolved against the current page directory, the same rule lib/api.ts follows, so
 * it survives the path-prefixed reverse proxy. A leading-slash "/llm/..." would not.
 */
export function resolveBase(base_url: string): string {
  const b = base_url.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(b)) return b;
  const pageDir = new URL(".", window.location.href).href; // always ends with "/"
  return new URL(b.replace(/^\/+/, ""), pageDir).href.replace(/\/+$/, "");
}

async function translateEndpoint(
  text: string,
  cfg: TranslatorConfig,
  signal: AbortSignal
): Promise<string> {
  const base = resolveBase(cfg.base_url);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.api_key.trim()) headers.authorization = `Bearer ${cfg.api_key.trim()}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: cfg.model.trim(),
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (typeof out !== "string" || !out.trim())
    throw new Error("The endpoint replied without any text.");
  return out.trim();
}

export class NoTranslatorError extends Error {
  constructor() {
    super("No translator configured.");
    this.name = "NoTranslatorError";
  }
}

/** Endpoint first (it knows the jargon); the browser's on-device model as a fallback. */
export async function translate(
  text: string,
  cfg: TranslatorConfig,
  signal: AbortSignal
): Promise<{ text: string; via: "endpoint" | "browser" }> {
  if (hasEndpoint(cfg)) {
    return { text: await translateEndpoint(text, cfg, signal), via: "endpoint" };
  }
  if (await builtinAvailable()) {
    return { text: await translateBuiltin(text), via: "browser" };
  }
  throw new NoTranslatorError();
}
