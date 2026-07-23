import { useEffect, useRef, useState, type ReactNode } from "react";

import AgentChain from "@/components/AgentChain";
import AgentDrawer from "@/components/AgentDrawer";
import SeparationPlot from "@/components/SeparationPlot";
import StatusChip from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { subscribeRun } from "@/lib/sse";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { GapMode, LoopState } from "@/types";

const MODE_HINT: Record<GapMode, string> = {
  rubric_threshold: "Accept when the weak solver stays under its ceiling, the strong solver clears its floor, and the mean gap is wide enough.",
  verifiable: "Accept on rollout counts: at most N weak solves, at least M strong solves.",
  flexible_judge: "No fixed thresholds — the judge reads the rollout pattern and decides each round.",
};

export default function CurationLoopPanel() {
  const {
    recipe, roles, gap, setGap, targetN, setTargetN,
    runId, runStatus, loops, order, accepted, rejected, startRun, applyEvent,
  } = useStore();
  const [picked, setPicked] = useState<{ ex: string; agent: string } | null>(null);
  const [err, setErr] = useState("");
  const unsub = useRef<null | (() => void)>(null);

  useEffect(() => () => unsub.current?.(), []);

  async function start() {
    if (!recipe) return;
    setErr("");
    try {
      const { run_id } = await api.createRun({
        recipe_id: recipe.id,
        roles,
        gap,
        target_n: targetN,
        max_inflight: 4,
      });
      startRun(run_id);
      unsub.current?.();
      unsub.current = subscribeRun(run_id, applyEvent);
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  if (!recipe) {
    return (
      <Empty>
        No recipe on the bench. Calibrate a source in <b className="text-foreground">01 Analyze</b>{" "}
        first.
      </Empty>
    );
  }

  const list = order.map((id) => loops[id]).filter(Boolean);
  const settled = accepted + rejected;
  const running = runStatus === "running";
  const thresholds = gap.mode === "rubric_threshold";

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-auto border-r bg-card">
        <div className="border-b px-4 py-3">
          <div className="faceplate">stage 02</div>
          <div className="headline mt-1 text-sm">Run configuration</div>
        </div>

        <div className="p-4">
          <div className="faceplate mb-1.5">Acceptance rule</div>
          <Select value={gap.mode} onValueChange={(v) => setGap({ mode: v as GapMode })}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rubric_threshold">rubric_threshold</SelectItem>
              <SelectItem value="verifiable">verifiable</SelectItem>
              <SelectItem value="flexible_judge">flexible_judge</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{MODE_HINT[gap.mode]}</p>

          <Separator className="my-4" />

          {thresholds && (
            <>
              <Knob
                label="weak ceiling"
                v={gap.weak_ceiling}
                set={(x) => setGap({ weak_ceiling: x })}
                tint="weak"
              />
              <Knob
                label="strong floor"
                v={gap.strong_floor}
                set={(x) => setGap({ strong_floor: x })}
                tint="strong"
              />
              <Knob label="min gap" v={gap.min_gap} set={(x) => setGap({ min_gap: x })} />
              <Separator className="my-4" />
            </>
          )}

          {gap.mode === "verifiable" && (
            <>
              <Num
                label="weak max correct"
                v={gap.weak_max_correct}
                set={(x) => setGap({ weak_max_correct: x })}
              />
              <Num
                label="strong min correct"
                v={gap.strong_min_correct}
                set={(x) => setGap({ strong_min_correct: x })}
              />
              <Separator className="my-4" />
            </>
          )}

          <Num label="weak rollouts · k" v={gap.k_weak} set={(x) => setGap({ k_weak: x })} />
          <Num label="strong rollouts · k" v={gap.k_strong} set={(x) => setGap({ k_strong: x })} />
          <Num label="step budget" v={gap.step_budget} set={(x) => setGap({ step_budget: x })} />
          <Num label="target accepted · N" v={targetN} set={setTargetN} />

          <Button className="mt-5 w-full" onClick={start} disabled={running}>
            {running ? "Running…" : "Start curation run"}
          </Button>
          {runId && running && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full text-reject"
              onClick={() => api.cancelRun(runId)}
            >
              Cancel run
            </Button>
          )}
          {err && <p className="mt-2 font-mono text-xs text-reject">{err}</p>}
        </div>
      </aside>

      <section className="flex-1 overflow-auto bench-grid">
        {list.length > 0 && (
          <div className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/90 px-5 py-2.5 backdrop-blur">
            <span className="faceplate">samples</span>
            <span className="font-mono tnum text-xs text-muted-foreground">{list.length} on bench</span>
            <div className="ml-auto flex items-center gap-4 font-mono tnum text-xs">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-accept" />
                <span className="text-foreground">{accepted}</span>
                <span className="text-muted-foreground">/ {targetN} accepted</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-reject" />
                <span className="text-foreground">{rejected}</span>
                <span className="text-muted-foreground">rejected</span>
              </span>
              {settled > 0 && (
                <span className="text-muted-foreground">
                  {Math.round((accepted / settled) * 100)}% yield
                </span>
              )}
            </div>
          </div>
        )}

        {list.length === 0 ? (
          <Empty>
            The bench is clear. Press <b className="text-foreground">Start curation run</b> and
            documents begin walking the chain — challenger, verifier, both solvers, judge.
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 p-5 md:grid-cols-2 2xl:grid-cols-3">
            {list.map((l) => (
              <SampleCard
                key={l.example_id}
                loop={l}
                weakCeiling={thresholds ? gap.weak_ceiling : undefined}
                strongFloor={thresholds ? gap.strong_floor : undefined}
                onPick={(a) => setPicked({ ex: l.example_id, agent: a })}
              />
            ))}
          </div>
        )}
      </section>

      {picked && (
        <AgentDrawer exampleId={picked.ex} agent={picked.agent} onClose={() => setPicked(null)} />
      )}
    </div>
  );
}

function SampleCard({
  loop,
  weakCeiling,
  strongFloor,
  onPick,
}: {
  loop: LoopState;
  weakCeiling?: number;
  strongFloor?: number;
  onPick: (agent: string) => void;
}) {
  const edge =
    loop.status === "accepted"
      ? "border-accept/50"
      : loop.status === "rejected"
        ? "border-reject/40"
        : "border-border";

  return (
    <div className={cn("overflow-hidden rounded-md border bg-card", edge)}>
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="truncate font-mono text-[11px] text-foreground">{loop.doc_id}</span>
        <span className="faceplate shrink-0">{loop.n_images} img</span>
        <span className="ml-auto shrink-0 font-mono tnum text-[11px] text-muted-foreground">
          R{loop.round}
        </span>
        <StatusChip status={loop.status} className="shrink-0" />
      </div>

      <div className="px-3 pt-3">
        <AgentChain loop={loop} onPick={onPick} />
      </div>

      <div className="space-y-2.5 px-3 pt-1 pb-3">
        <SeparationPlot
          weakTicks={loop.weakTicks}
          strongTicks={loop.strongTicks}
          weakAvg={loop.weak_avg}
          strongAvg={loop.strong_avg}
          gap={loop.gap}
          weakCeiling={weakCeiling}
          strongFloor={strongFloor}
          variant="mini"
        />

        {loop.question ? (
          <p className="line-clamp-2 text-xs leading-snug text-foreground">{loop.question}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Writing the first candidate…</p>
        )}

        {loop.error && <p className="font-mono text-[11px] text-reject">{loop.error}</p>}
        {loop.lastReason && loop.status !== "accepted" && !loop.error && (
          <p className="line-clamp-1 font-mono text-[11px] text-muted-foreground">
            ↳ {loop.lastReason}
          </p>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bench-grid p-8">
      <p className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** A threshold on the 0..1 score axis — tinted to match the population it gates. */
function Knob({
  label,
  v,
  set,
  tint,
}: {
  label: string;
  v: number;
  set: (x: number) => void;
  tint?: "weak" | "strong";
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono tnum text-xs text-foreground">{v.toFixed(2)}</span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.01}
        tint={tint}
        value={[v]}
        onValueChange={([x]) => set(x)}
        aria-label={label}
      />
    </div>
  );
}

function Num({ label, v, set }: { label: string; v: number; set: (x: number) => void }) {
  return (
    <label className="mb-2.5 flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={v}
        onChange={(e) => set(parseInt(e.target.value) || 0)}
        className="h-7 w-16 px-2 text-right font-mono tnum text-xs"
      />
    </label>
  );
}
