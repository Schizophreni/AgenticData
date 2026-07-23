import { useState, type ReactNode } from "react";
import { Languages, X } from "lucide-react";

import { hasEndpoint, type TranslatorConfig } from "@/lib/translate";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { ProviderKind, Role, RoleBinding } from "@/types";

const ROLES: Role[] = ["main", "challenger", "weak", "strong", "judge"];
const PROVIDERS: ProviderKind[] = ["mock", "openai_compat", "anthropic"];

const HINT: Record<Role, string> = {
  main: "Orchestrates autoresearch and folds your feedback back into the recipe.",
  challenger: "Writes the question, the reference answer, and the rubric.",
  weak: "Should struggle. Its ceiling is what makes an item hard enough to keep.",
  strong: "Should succeed. Its floor is what makes an item solvable at all.",
  judge: "Verifies quality, then scores every rollout against the rubric.",
};

/**
 * Discord's User Settings: a left nav of sections, a wide pane on the right, and a
 * big X in the corner. Bindings live in this browser (localStorage "autodata.roles");
 * the `main` binding is also sent with createRecipe, which is what makes autoresearch
 * run on a real model instead of the mock.
 */
export default function ProviderConfig({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { roles, setRole, translator, setTranslator, applyPreset } = useStore();
  const [sel, setSel] = useState<Role | "translation">("main");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[85vh] max-w-5xl overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="flex h-full min-h-0">
          <nav className="w-52 shrink-0 overflow-y-auto bg-sidebar px-2 py-4">
            <DialogTitle className="channel-label px-2 pb-2">Role bindings</DialogTitle>

            <div className="mb-3 flex gap-1 px-2">
              <Button
                variant="secondary"
                size="xs"
                className="flex-1"
                onClick={() => applyPreset("local")}
              >
                Local models
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="flex-1"
                onClick={() => applyPreset("mock")}
              >
                Mock
              </Button>
            </div>

            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setSel(r)}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[15px] capitalize transition-colors",
                  sel === r
                    ? "bg-active text-heading"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
              >
                {(r === "weak" || r === "strong") && (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      r === "weak" ? "border-2 border-weak" : "bg-strong"
                    )}
                  />
                )}
                {r}
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                  {roles[r].provider}
                </span>
              </button>
            ))}

            <div className="mt-3 border-t pt-3">
              <h3 className="channel-label px-2 pb-2">Tools</h3>
              <button
                onClick={() => setSel("translation")}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[15px] transition-colors",
                  sel === "translation"
                    ? "bg-active text-heading"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
              >
                <Languages className="size-4 shrink-0" />
                Translation
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {hasEndpoint(translator) ? "on" : "off"}
                </span>
              </button>
            </div>
          </nav>

          {sel === "translation" ? (
            <TranslationPane
              cfg={translator}
              onChange={setTranslator}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <RolePane
              role={sel}
              binding={roles[sel]}
              onChange={(b) => setRole(sel, b)}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RolePane({
  role: sel,
  binding: b,
  onChange,
  onClose,
}: {
  role: Role;
  binding: RoleBinding;
  onChange: (b: Partial<RoleBinding>) => void;
  onClose: () => void;
}) {
  const setRole = (_: Role, patch: Partial<RoleBinding>) => onChange(patch);
  return (
    <>
          <div className="min-w-0 flex-1 overflow-y-auto bg-chat p-6">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="ginto text-xl capitalize">{sel}</h2>
                <DialogDescription className="mt-1">{HINT[sel]}</DialogDescription>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={onClose}>
                <X className="size-5" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field label="Provider">
                <Select
                  value={b.provider}
                  onValueChange={(v) => setRole(sel, { provider: v as ProviderKind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p} className="font-mono">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Model">
                <Input
                  className="font-mono"
                  value={b.model}
                  onChange={(e) => setRole(sel, { model: e.target.value })}
                />
              </Field>

              <Field label="Base URL" hint="vLLM / OpenAI-compatible endpoint">
                <Input
                  className="font-mono"
                  placeholder="http://localhost:8001/v1"
                  value={b.base_url ?? ""}
                  onChange={(e) => setRole(sel, { base_url: e.target.value })}
                />
              </Field>

              <Field label="API key env var" hint="Name of the variable, not the key itself">
                <Input
                  className="font-mono"
                  placeholder="OPENAI_API_KEY"
                  value={b.api_key_env ?? ""}
                  onChange={(e) => setRole(sel, { api_key_env: e.target.value })}
                />
              </Field>

              <Field label="Temperature">
                <Input
                  type="number"
                  step="0.1"
                  className="font-mono tnum"
                  value={b.temperature}
                  onChange={(e) => setRole(sel, { temperature: parseFloat(e.target.value) || 0 })}
                />
              </Field>

              <Field label="Max tokens">
                <Input
                  type="number"
                  className="font-mono tnum"
                  value={b.max_tokens}
                  onChange={(e) => setRole(sel, { max_tokens: parseInt(e.target.value) || 0 })}
                />
              </Field>
            </div>

            <div className="mt-6 space-y-1 border-t pt-5">
              <Toggle
                label="Vision"
                hint="Send the grounding images to this model."
                checked={b.is_vlm}
                onChange={(v) => setRole(sel, { is_vlm: v })}
              />
              <Toggle
                label="Thinking"
                hint="Qwen3 only: sets chat_template_kwargs.enable_thinking on every request."
                checked={b.enable_thinking}
                onChange={(v) => setRole(sel, { enable_thinking: v })}
              />
            </div>

            {(sel === "weak" || sel === "strong") && (
              <div className="mt-5 rounded-md bg-elevated p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Both solvers run the same vision model
                  </span>{" "}
                  — it is the only one served here — so the gap is made out of{" "}
                  <span className="font-semibold text-foreground">Vision</span> instead: weak has it
                  off and never receives the images, strong has it on and sees them. The task is
                  cross-figure reasoning, so an item is only worth keeping if it cannot be answered
                  without looking. Turn Vision on for weak and the two become identical, and the run
                  will have no gap to measure.
                </p>
              </div>
            )}

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Saved to this browser. Bindings apply to the next run — a run already in flight keeps
              the models it started with. The backend dials these endpoints, so they are the{" "}
              <span className="font-mono">127.0.0.1</span> addresses of the tunnels, not the
              browser's proxy path. <span className="font-mono">mock</span> needs no endpoint and
              runs the whole bench offline.
            </p>
          </div>
    </>
  );
}

/**
 * Where selection-translation sends its text.
 *
 * This is deliberately NOT a role binding. A role binding's `api_key_env` names a
 * server-side environment variable, which the browser cannot read — and the request
 * here is made by the browser, because the backend has no /api/translate endpoint to
 * make it for us. Both of those facts are stated on this pane rather than buried:
 * the key sits in this browser, and the endpoint must allow cross-origin requests.
 */
function TranslationPane({
  cfg,
  onChange,
  onClose,
}: {
  cfg: TranslatorConfig;
  onChange: (t: Partial<TranslatorConfig>) => void;
  onClose: () => void;
}) {
  const on = hasEndpoint(cfg);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-chat p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="ginto text-xl">Translation</h2>
          <DialogDescription className="mt-1">
            Select any English text in the app and a{" "}
            <Languages className="inline size-3.5 align-text-bottom" /> button appears. Click it to
            translate the selection into Chinese.
          </DialogDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <span className={cn("size-2 rounded-full", on ? "bg-accept" : "bg-muted-foreground")} />
        <span className="text-sm text-foreground">
          {on ? "Ready" : "Not set up — selection translation will tell you so and stop."}
        </span>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Field label="Base URL" hint="OpenAI-compatible, ending in /v1">
          <Input
            className="font-mono"
            placeholder="http://localhost:8001/v1"
            value={cfg.base_url}
            onChange={(e) => onChange({ base_url: e.target.value })}
          />
        </Field>
        <Field label="Model">
          <Input
            className="font-mono"
            placeholder="Qwen3-8B"
            value={cfg.model}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </Field>
        <Field label="API key" hint="Leave empty for a local endpoint that needs no key.">
          <Input
            type="password"
            className="font-mono"
            placeholder="sk-…"
            value={cfg.api_key}
            onChange={(e) => onChange({ api_key: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-6 space-y-3 border-t pt-5 text-xs leading-relaxed text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">The request is made by the browser.</span>{" "}
          AutoData's API has no translate endpoint, so there is nothing on the server to relay it.
          Two things follow: the endpoint must send CORS headers, and the key above is stored in
          this browser's localStorage and sent from here — do not put a shared production key in it.
        </p>
        <p>
          The right home for this is a <span className="font-mono">POST /api/translate</span> on the
          backend: it would reuse the server-side key that a role binding's{" "}
          <span className="font-mono">api_key_env</span> already names, and no key would ever reach
          the browser. That needs a backend change, so it is proposed rather than done.
        </p>
        <p>
          If your browser ships Chrome's on-device translator, it is used automatically when no
          endpoint is set. It needs no key and no server, but it does not know this tool's jargon as
          well as a bound model does.
        </p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="channel-label">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Discord puts the switch on the right of a full-width labelled row. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-heading">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </label>
  );
}
