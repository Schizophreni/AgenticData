import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Languages, Loader2, Settings, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoTranslatorError, hasEndpoint, translate } from "@/lib/translate";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

const MIN_CHARS = 2;
const MAX_CHARS = 4000;
const CARD_W = 340;

type Phase =
  | { k: "idle" }
  | { k: "bubble" }
  | { k: "loading" }
  | { k: "done"; zh: string; via: "endpoint" | "browser" }
  | { k: "error"; msg: string }
  | { k: "unconfigured" };

/** Selection is captured the moment it is made — clicking the bubble must not depend on it. */
interface Shot {
  text: string;
  x: number; // viewport coords of the selection's end
  y: number;
}

const inFormField = (n: Node | null) => {
  const el = n instanceof Element ? n : n?.parentElement;
  return !!el?.closest("input, textarea, [contenteditable='true']");
};

export default function SelectionTranslate({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { translator } = useStore();
  const [shot, setShot] = useState<Shot | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [copied, setCopied] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const dismiss = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setShot(null);
    setPhase({ k: "idle" });
    setCopied(false);
  }, []);

  // capture a selection
  useEffect(() => {
    const onUp = (e: MouseEvent | KeyboardEvent) => {
      // a click inside our own popover must never re-read the selection
      if (hostRef.current?.contains(e.target as Node)) return;

      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";

      if (!sel || sel.isCollapsed || text.length < MIN_CHARS || inFormField(sel.anchorNode)) {
        dismiss();
        return;
      }

      // Anchor to where the selection ENDS, not to the bounding box of every line it
      // spans — on a wrapped paragraph the box's right edge is nowhere near the words.
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      setShot({ text: text.slice(0, MAX_CHARS), x: rect.right, y: rect.bottom });
      setPhase({ k: "bubble" });
      setCopied(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      else if (e.shiftKey || e.key.startsWith("Arrow")) onUp(e);
    };

    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    // A moving page would leave the bubble stranded next to nothing.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [dismiss]);

  async function run() {
    if (!shot) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ k: "loading" });
    try {
      const { text, via } = await translate(shot.text, translator, ac.signal);
      if (!ac.signal.aborted) setPhase({ k: "done", zh: text, via });
    } catch (e: any) {
      if (ac.signal.aborted || e?.name === "AbortError") return;
      if (e instanceof NoTranslatorError) setPhase({ k: "unconfigured" });
      else setPhase({ k: "error", msg: String(e?.message || e) });
    }
  }

  if (!shot || phase.k === "idle") return null;

  const bubble = phase.k === "bubble";
  const w = bubble ? 34 : CARD_W;
  const left = Math.min(Math.max(8, shot.x - (bubble ? 0 : 12)), window.innerWidth - w - 8);
  const top = Math.min(shot.y + 8, window.innerHeight - (bubble ? 42 : 140));

  return createPortal(
    <>
      {/* click-away catcher; keeps the popover from swallowing the whole page */}
      {!bubble && <div className="fixed inset-0 z-[60]" onMouseDown={dismiss} aria-hidden />}

      <div
        ref={hostRef}
        className="fixed z-[61]"
        style={{ left, top }}
        // Never let a mousedown here collapse the selection or steal focus.
        onMouseDown={(e) => e.preventDefault()}
      >
        {bubble ? (
          <button
            onClick={run}
            title="Translate to Chinese"
            className="flex size-[34px] items-center justify-center rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-black/20 transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Languages className="size-4" />
            <span className="sr-only">Translate the selected text to Chinese</span>
          </button>
        ) : (
          <div
            className="flex flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-xl ring-1 ring-black/20"
            style={{ width: CARD_W }}
            role="dialog"
            aria-label="Translation"
            data-phase={phase.k}
          >
            <div className="flex items-center gap-1.5 border-b px-3 py-2">
              <Languages className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="channel-label">译文 · Chinese</span>
              {phase.k === "done" && (
                <span className="ml-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {phase.via === "endpoint" ? translator.model : "on-device"}
                </span>
              )}
              <button
                onClick={dismiss}
                className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-label="Close translation"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <p className="max-h-16 overflow-y-auto border-b px-3 py-2 text-xs leading-snug text-muted-foreground">
              {shot.text}
            </p>

            <div className="px-3 py-2.5">
              {phase.k === "loading" && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Translating…
                </p>
              )}

              {phase.k === "done" && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {phase.zh}
                </p>
              )}

              {phase.k === "error" && (
                <>
                  <p className="text-sm leading-relaxed text-reject">Translation failed.</p>
                  <p className="mt-1 font-mono text-[11px] leading-snug break-all text-muted-foreground">
                    {phase.msg}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    The request goes straight from this browser, so the endpoint must allow
                    cross-origin requests. Check the URL, the model name, and the key.
                  </p>
                </>
              )}

              {phase.k === "unconfigured" && (
                <>
                  <p className="text-sm leading-relaxed text-foreground">
                    No translator is set up.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Translating needs a model. Point this at an OpenAI-compatible endpoint in
                    Provider settings → Translation, and it will translate the selection.
                  </p>
                </>
              )}
            </div>

            {(phase.k === "done" || phase.k === "error" || phase.k === "unconfigured") && (
              <div className="flex items-center gap-1.5 border-t px-2 py-1.5">
                {phase.k === "done" && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      navigator.clipboard?.writeText(phase.zh);
                      setCopied(true);
                    }}
                  >
                    {copied ? <Check className="text-accept" /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                )}
                {(phase.k === "error" || phase.k === "unconfigured") && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      dismiss();
                      onOpenSettings();
                    }}
                  >
                    <Settings />
                    {hasEndpoint(translator) ? "Check settings" : "Set up translation"}
                  </Button>
                )}
                {phase.k === "error" && (
                  <Button variant="ghost" size="xs" className="ml-auto" onClick={run}>
                    Retry
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

/** Exported for the settings pane, so it can show the same "is it usable" answer. */
export { hasEndpoint };
