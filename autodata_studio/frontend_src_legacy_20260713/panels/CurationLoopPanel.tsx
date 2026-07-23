import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { subscribeRun } from "../lib/sse";
import { useStore } from "../store";
import type { AgentStatus, GapMode, LoopState } from "../types";
import AgentDrawer from "../components/AgentDrawer";
import GapCaliper from "../components/GapCaliper";

const CHAIN: { key: string; label: string }[] = [
  { key: "challenger", label: "chal" },
  { key: "verifier", label: "verf" },
  { key: "weak", label: "weak" },
  { key: "strong", label: "strg" },
  { key: "judge", label: "judg" },
];

const LED: Record<AgentStatus, string> = {
  idle: "bg-faint/40",
  running: "bg-strong led-run text-strong",
  done: "bg-lock",
  failed: "bg-rej",
};

function ChainNode({
  label,
  status,
  tint,
  onClick,
}: {
  label: string;
  status: AgentStatus;
  tint: "weak" | "strong" | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 flex-1 min-w-0"
      title={`${label}: ${status}`}
    >
      <span className={`w-2.5 h-2.5 rounded-full transition ${LED[status]}`} />
      <span
        className={`font-mono text-[10px] transition group-hover:text-chalk ${
          status === "idle" ? "text-faint" : tint === "weak" ? "text-weak" : tint === "strong" ? "text-strong" : "text-dim"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function Channel({ loop, onPick }: { loop: LoopState; onPick: (a: string) => void }) {
  const st = (a: string): AgentStatus => (loop.agents[a]?.status as AgentStatus) || "idle";
  const judgeStatus = st("judge:weak") !== "idle" ? st("judge:weak") : st("judge:strong");
  const accent =
    loop.status === "accepted"
      ? "border-lock/40 shadow-[inset_0_1px_0_0_rgba(62,221,147,0.25)]"
      : loop.status === "rejected"
      ? "border-rej/30"
      : "border-rule";

  return (
    <div className={`rounded bg-bench border ${accent} overflow-hidden`}>
      {/* channel header */}
      <div className="flex items-center gap-2 px-3 h-8 border-b border-rule/70 bg-bench2/40">
        <span className="font-mono text-[11px] text-weak truncate">{loop.doc_id}</span>
        <span className="eyebrow">{loop.n_images}img</span>
        <span className="ml-auto font-mono text-[11px] text-dim">R{loop.round}</span>
        <StatusChip status={loop.status} />
      </div>

      {/* signal chain */}
      <div className="flex items-center px-3 pt-3">
        {CHAIN.map((c, i) => (
          <div key={c.key} className="contents">
            <ChainNode
              label={c.label}
              status={c.key === "judge" ? judgeStatus : st(c.key)}
              tint={c.key === "weak" ? "weak" : c.key === "strong" ? "strong" : null}
              onClick={() => onPick(c.key === "judge" ? "judge" : c.key)}
            />
            {i < CHAIN.length - 1 && (
              <span className="w-4 h-px bg-rule shrink-0 -mt-4" aria-hidden />
            )}
          </div>
        ))}
      </div>

      {/* body */}
      <div className="px-3 pb-3 pt-2.5 space-y-2.5">
        {loop.question ? (
          <p className="text-xs text-chalk/75 leading-snug line-clamp-2">{loop.question}</p>
        ) : (
          <p className="text-xs text-faint italic">awaiting first candidate…</p>
        )}

        {loop.status === "accepted" && (
          <GapCaliper weak={loop.weak_avg} strong={loop.strong_avg} gap={loop.gap} variant="mini" />
        )}
        {loop.lastReason && loop.status !== "accepted" && (
          <p className="text-[11px] text-faint font-mono line-clamp-1">↳ {loop.lastReason}</p>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: LoopState["status"] }) {
  const map = {
    accepted: "text-lock",
    rejected: "text-rej",
    in_progress: "text-strong",
  } as const;
  return <span className={`font-mono text-[10px] uppercase tracking-wider ${map[status]}`}>{status.replace("_", " ")}</span>;
}

export default function CurationLoopPanel() {
  const { recipe, roles, gap, setGap, targetN, setTargetN, runId, runStatus, loops, order, accepted, rejected, startRun, applyEvent } =
    useStore();
  const [picked, setPicked] = useState<{ ex: string; agent: string } | null>(null);
  const unsub = useRef<null | (() => void)>(null);
  useEffect(() => () => unsub.current?.(), []);

  async function start() {
    if (!recipe) return;
    const { run_id } = await api.createRun({ recipe_id: recipe.id, roles, gap, target_n: targetN, max_inflight: 4 });
    startRun(run_id);
    unsub.current?.();
    unsub.current = subscribeRun(run_id, applyEvent);
  }

  if (!recipe) {
    return (
      <Empty>
        No recipe loaded. Calibrate a source in <span className="text-strong">01 Analyze</span> first.
      </Empty>
    );
  }

  const loopList = order.map((id) => loops[id]).filter(Boolean);
  const total = accepted + rejected;

  return (
    <div className="h-full flex">
      {/* config bench */}
      <aside className="w-72 shrink-0 border-r border-rule bg-bench overflow-auto">
        <div className="px-4 py-3 border-b border-rule">
          <div className="eyebrow">step 02</div>
          <div className="font-display text-chalk">Run configuration</div>
        </div>
        <div className="p-4">
          <FieldLabel>Acceptance mode · the gap</FieldLabel>
          <select
            className="w-full bg-abyss border border-rule rounded-sm px-2 py-1.5 text-sm text-chalk mb-4 outline-none focus:border-strong/60"
            value={gap.mode}
            onChange={(e) => setGap({ mode: e.target.value as GapMode })}
          >
            <option value="rubric_threshold">rubric_threshold · CS</option>
            <option value="verifiable">verifiable · counts</option>
            <option value="flexible_judge">flexible_judge · Legal</option>
          </select>

          {gap.mode === "rubric_threshold" && (
            <>
              <Slider label="strong floor" v={gap.strong_floor} set={(x) => setGap({ strong_floor: x })} tint="strong" />
              <Slider label="weak ceiling" v={gap.weak_ceiling} set={(x) => setGap({ weak_ceiling: x })} tint="weak" />
              <Slider label="min gap" v={gap.min_gap} set={(x) => setGap({ min_gap: x })} tint="strong" />
            </>
          )}
          {gap.mode === "verifiable" && (
            <>
              <Num label="weak max correct" v={gap.weak_max_correct} set={(x) => setGap({ weak_max_correct: x })} />
              <Num label="strong min correct" v={gap.strong_min_correct} set={(x) => setGap({ strong_min_correct: x })} />
            </>
          )}
          {gap.mode === "flexible_judge" && (
            <p className="text-xs text-dim leading-relaxed mb-4">
              The judge decides accept / improve each round from the rollout pattern — no fixed thresholds.
            </p>
          )}

          <div className="h-px bg-rule my-4" />
          <Num label="weak rollouts · k" v={gap.k_weak} set={(x) => setGap({ k_weak: x })} />
          <Num label="strong rollouts · k" v={gap.k_strong} set={(x) => setGap({ k_strong: x })} />
          <Num label="step budget" v={gap.step_budget} set={(x) => setGap({ step_budget: x })} />
          <Num label="target accepted · N" v={targetN} set={setTargetN} />

          <button
            onClick={start}
            disabled={runStatus === "running"}
            className="w-full mt-5 px-3 py-2.5 rounded-sm bg-strong text-abyss font-display font-semibold text-sm hover:brightness-110 disabled:opacity-50 transition"
          >
            {runStatus === "running" ? "Running…" : "Start curation run"}
          </button>
          {runId && runStatus === "running" && (
            <button onClick={() => api.cancelRun(runId)} className="w-full mt-2 px-3 py-1.5 rounded-sm border border-rule text-rej text-xs font-mono hover:border-rej/50">
              cancel
            </button>
          )}
        </div>
      </aside>

      {/* board */}
      <section className="flex-1 overflow-auto">
        {loopList.length > 0 && (
          <div className="sticky top-0 z-10 flex items-center gap-4 px-5 h-11 border-b border-rule bg-bench/95 backdrop-blur">
            <span className="eyebrow">channels</span>
            <span className="font-mono text-xs text-dim tnum">{loopList.length} live</span>
            <div className="ml-auto flex items-center gap-4 font-mono text-xs">
              <span className="text-lock tnum">{accepted} accepted</span>
              <span className="text-rej tnum">{rejected} rejected</span>
              {total > 0 && <span className="text-faint tnum">{Math.round((accepted / total) * 100)}% yield</span>}
            </div>
          </div>
        )}

        {loopList.length === 0 ? (
          <Empty>
            Idle bench. Press <span className="text-strong">Start curation run</span> and watch documents flow
            through the challenger → solver → judge chain.
          </Empty>
        ) : (
          <div className="grid gap-3.5 p-5 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
            {loopList.map((l) => (
              <Channel key={l.example_id} loop={l} onPick={(a) => setPicked({ ex: l.example_id, agent: a })} />
            ))}
          </div>
        )}
      </section>

      {picked && <AgentDrawer exampleId={picked.ex} agent={picked.agent} onClose={() => setPicked(null)} />}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <p className="text-dim text-sm max-w-sm text-center leading-relaxed">{children}</p>
    </div>
  );
}
function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="eyebrow mb-1.5">{children}</div>;
}
function Slider({ label, v, set, tint }: { label: string; v: number; set: (x: number) => void; tint: "weak" | "strong" }) {
  return (
    <div className="mb-3.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-dim">{label}</span>
        <span className={`font-mono tnum ${tint === "weak" ? "text-weak" : "text-strong"}`}>{v.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => set(parseFloat(e.target.value))}
        className={`w-full h-1 ${tint === "weak" ? "accent-weak" : "accent-strong"}`}
      />
    </div>
  );
}
function Num({ label, v, set }: { label: string; v: number; set: (x: number) => void }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-xs text-dim">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => set(parseInt(e.target.value) || 0)}
        className="w-16 bg-abyss border border-rule rounded-sm px-2 py-1 text-sm font-mono tnum text-chalk text-right outline-none focus:border-strong/60"
      />
    </div>
  );
}
