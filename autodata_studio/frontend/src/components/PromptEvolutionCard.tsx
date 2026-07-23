import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, RefreshCw, Sparkles } from "lucide-react";

import Embed from "@/components/Embed";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const pct = (v: unknown) => `${Math.round(Number(v || 0) * 100)}%`;
const num = (v: unknown) => v == null ? "—" : Number(v).toFixed(2);

export default function PromptEvolutionCard({ runId }: { runId?: string | null }) {
  const rid = runId || "run_mcq_live_merged";
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try { setState(await api.promptEvolution(rid)); } catch { /* backend may be restarting */ }
  }, [rid]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function propose() {
    setBusy("propose"); setMessage("");
    try {
      const p = await api.proposePromptEvolution(rid);
      setMessage(`v${p.version} proposed from ${p.changes.length} high-impact signals.`);
      await load();
    } catch (e: any) { setMessage(String(e.message || e)); }
    finally { setBusy(""); }
  }

  async function activate(id: string) {
    setBusy(id); setMessage("");
    try {
      const p = await api.activatePromptEvolution(id);
      setMessage(`v${p.version} active — the next batch will load it.`);
      await load();
    } catch (e: any) { setMessage(String(e.message || e)); }
    finally { setBusy(""); }
  }

  if (!state) return null;
  const m = state.metrics || {};
  const versions: any[] = state.versions || [];
  const proposed = versions.find((v) => v.status === "proposed");
  const active = versions.find((v) => v.status === "active");

  return (
    <div className="px-4 pb-3">
      <Embed accent="idle" className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-active text-idle">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-heading">Prompt evolution</span>
              <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {active ? `v${active.version} active` : "base prompt"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Gap/QV outcomes → audited prompt delta → next batch. No optimizer VLM call.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={propose} disabled={!!busy}>
            <RefreshCw className={cn("size-3.5", busy === "propose" && "animate-spin")} />
            Evolve prompt
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <Metric label="QV fail" value={pct(m.qv_fail_rate)} warn={m.qv_fail_rate >= .25} />
          <Metric label="too easy" value={pct(m.too_easy_rate)} warn={m.too_easy_rate >= .1} />
          <Metric label="strong fail" value={pct(m.strong_fail_rate)} warn={m.strong_fail_rate >= .1} />
          <Metric label="accept" value={pct(m.accept_rate)} />
          <Metric label="avg gap" value={num(m.gap_avg)} warn={m.gap_avg != null && m.gap_avg < 1 / 3} />
          <Metric label="avg rounds" value={num(m.rounds_avg)} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Flow label="collect signals" done /> <ArrowRight className="size-3" />
          <Flow label="propose delta" done={!!proposed || !!active} /> <ArrowRight className="size-3" />
          <Flow label="human activate" done={!!active} /> <ArrowRight className="size-3" />
          <Flow label="next batch A/B" />
        </div>

        {proposed && (
          <div className="mt-3 rounded-md border border-idle/30 bg-background/50 p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-heading">v{proposed.version} proposal</span>
              <span className="text-[10px] text-muted-foreground">applies only after activation</span>
              <Button className="ml-auto" size="sm" onClick={() => activate(proposed.id)} disabled={!!busy}>
                <Check className="size-3.5" /> Activate for next batch
              </Button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {(proposed.changes || []).map((c: any) => (
                <li key={c.key} className="text-xs leading-relaxed text-foreground">
                  <span className="mr-1.5 rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-idle">
                    {c.key}
                  </span>
                  <span className="font-medium">{c.reason}.</span>{" "}{c.instruction}
                </li>
              ))}
            </ul>
            <PromptCompare version={proposed} />
          </div>
        )}
        {active && !proposed && (
          <div className="mt-3 rounded-md border border-accept/20 bg-background/40 p-3">
            <div className="font-mono text-xs font-semibold text-heading">
              v{active.version} active prompt
            </div>
            <PromptCompare version={active} />
          </div>
        )}
        {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
      </Embed>
    </div>
  );
}

function PromptCompare({ version }: { version: any }) {
  const before = String(version.base_prompt || "");
  const after = String(version.evolved_prompt || "");
  const unchanged = before.trim() === after.trim();
  const delta = after.startsWith(before) ? after.slice(before.length).trim() : "";

  return (
    <details className="mt-3 rounded-md border border-border/60 bg-elevated/30">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-heading">
        Compare old and new prompt
        {delta && <span className="ml-2 font-mono text-[10px] text-accept">+{delta.length} chars</span>}
      </summary>
      {unchanged ? (
        <div className="border-t border-border/60 bg-background/80 px-3 py-4 text-xs text-muted-foreground">
          No effective prompt change — the proposed instructions are already active.
        </div>
      ) : <div className="grid gap-px border-t border-border/60 bg-border/60 lg:grid-cols-2">
        <PromptPane label="OLD · base prompt" text={before} />
        <PromptPane
          label={delta ? "NEW · added instructions only" : "NEW · evolved prompt"}
          text={delta || after}
          delta={delta}
        />
      </div>}
      {!unchanged && delta && <details className="border-t border-border/60 bg-background/70">
        <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] text-muted-foreground">
          Show fully reconstructed new prompt ({after.length} chars)
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border/40 p-3 font-mono text-[10px] leading-relaxed text-foreground">
          {after}
        </pre>
      </details>}
    </details>
  );
}

function PromptPane({ label, text, delta }: { label: string; text: string; delta?: string }) {
  return (
    <div className="min-w-0 bg-background/95 p-3">
      <div className={cn("channel-label mb-1", delta ? "text-accept" : "text-muted-foreground")}>{label}</div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground">
        {text || "Prompt text unavailable for this version."}
      </pre>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded bg-background/60 px-2 py-1.5">
      <div className="channel-label truncate">{label}</div>
      <div className={cn("mt-0.5 font-mono tnum text-sm", warn ? "text-warn" : "text-foreground")}>{value}</div>
    </div>
  );
}

function Flow({ label, done }: { label: string; done?: boolean }) {
  return <span className={cn("rounded px-1.5 py-1", done ? "bg-accept/10 text-accept" : "bg-elevated")}>{label}</span>;
}
