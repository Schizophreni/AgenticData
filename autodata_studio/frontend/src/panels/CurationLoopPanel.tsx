import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

import AgentChain from "@/components/AgentChain";
import AgentDrawer from "@/components/AgentDrawer";
import Embed from "@/components/Embed";
import PromptEvolutionCard from "@/components/PromptEvolutionCard";
import SeparationPlot from "@/components/SeparationPlot";
import StatusChip from "@/components/StatusChip";
import ChannelHeader from "@/components/shell/ChannelHeader";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { LoopState } from "@/types";

/**
 * The live board, as Discord's message stream: every document that enters the loop
 * posts a message, and that message mutates in place as its agents report in. The
 * separation plot rides in the message's embed, whose left accent bar carries the
 * verdict — which is what an embed accent has always been for.
 */
export default function CurationLoopPanel() {
  const { recipe, gap, targetN, runId, runStatus, loops, order, accepted, rejected } = useStore();
  const [picked, setPicked] = useState<{ ex: string; agent: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Discord pins you to the newest message; so does the bench.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [order.length]);

  const list = order.map((id) => loops[id]).filter(Boolean);
  const settled = accepted + rejected;
  const thresholds = gap.mode === "rubric_threshold";

  const topic =
    runStatus === "idle"
      ? "Documents walk the chain: challenger → verifier → both solvers → judge"
      : `${accepted} accepted · ${rejected} rejected${
          settled ? ` · ${Math.round((accepted / settled) * 100)}% yield` : ""
        }`;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-chat">
      <ChannelHeader
        name="curate"
        topic={topic}
        actions={
          runStatus !== "idle" && (
            <span className="flex items-center gap-2 rounded-md bg-elevated px-2.5 py-1">
              <span
                className={cn(
                  "size-2 rounded-full",
                  runStatus === "running" ? "bg-idle pulse-run" : "bg-accept"
                )}
              />
              <span className="text-xs text-muted-foreground">{runStatus}</span>
              <span className="font-mono tnum text-xs text-foreground">
                {accepted}
                <span className="text-muted-foreground">/{targetN}</span>
              </span>
            </span>
          )
        }
      />

      <div className="flex-1 overflow-y-auto py-4">
        <PromptEvolutionCard runId={runId} />
        {!recipe ? (
          <Welcome
            title="No recipe on the bench"
            body="Analyze a source first — a curation run needs a recipe to work from."
          />
        ) : list.length === 0 ? (
          <Welcome
            title="#curate is quiet"
            body="Press Start curation run in the sidebar. Every document that enters the loop posts here and updates live as its agents report in."
          />
        ) : (
          <>
            {list.map((l) => (
              <SampleMessage
                key={l.example_id}
                loop={l}
                weakCeiling={thresholds ? gap.weak_ceiling : undefined}
                strongFloor={thresholds ? gap.strong_floor : undefined}
                onPick={(a) => setPicked({ ex: l.example_id, agent: a })}
              />
            ))}
            <div ref={bottom} />
          </>
        )}
      </div>

      {picked && (
        <AgentDrawer exampleId={picked.ex} agent={picked.agent} onClose={() => setPicked(null)} />
      )}
    </div>
  );
}

function SampleMessage({
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
  const accent =
    loop.status === "accepted" ? "accept" : loop.status === "rejected" ? "reject" : "idle";

  return (
    <article className="flex gap-4 px-4 py-2 transition-colors hover:bg-hover/40">
      <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-active text-muted-foreground">
        <FileText className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[15px] font-semibold text-heading">{loop.doc_id}</span>
          <span className="text-xs text-muted-foreground">{loop.n_images} images</span>
          <span className="text-xs text-muted-foreground">· round {loop.round}</span>
          <StatusChip status={loop.status} className="ml-1" />
        </div>

        <p className="mt-0.5 text-sm leading-relaxed text-foreground">
          {loop.question || <span className="text-muted-foreground">Writing the first candidate…</span>}
        </p>

        <Embed accent={accent} className="mt-2 max-w-2xl">
          <AgentChain loop={loop} onPick={onPick} />
          <div className="mt-3 border-t pt-3">
            <SeparationPlot
              weakTicks={loop.weakTicks}
              strongTicks={loop.strongTicks}
              weakAvg={loop.weak_avg}
              strongAvg={loop.strong_avg}
              gap={loop.gap}
              kWeak={loop.kWeak}
              kStrong={loop.kStrong}
              weakCeiling={weakCeiling}
              strongFloor={strongFloor}
              variant="mini"
            />
          </div>
          {loop.error && <p className="mt-2 font-mono text-[11px] text-reject">{loop.error}</p>}
          {loop.lastReason && loop.status !== "accepted" && !loop.error && (
            <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
              ↳ {loop.lastReason}
            </p>
          )}
        </Embed>
      </div>
    </article>
  );
}

/** Discord's empty-channel welcome: a big mark, a title, and one line of direction. */
function Welcome({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10">
      <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-active">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-full border-2 border-weak" />
          <span className="size-3 rounded-full bg-strong" />
        </span>
      </span>
      <h2 className="ginto text-2xl">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
