import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStatus, LoopState } from "@/types";

/** The fixed path a document walks. Order is the process, so it is drawn as a run. */
export const CHAIN = [
  { key: "challenger", label: "chal", title: "Challenger — writes question, reference, rubric" },
  { key: "verifier", label: "verf", title: "Quality verifier — leakage, multi-image, rubric checks" },
  { key: "weak", label: "weak", title: "Weak solver — k rollouts, should struggle" },
  { key: "strong", label: "strg", title: "Strong solver — k rollouts, should succeed" },
  { key: "judge", label: "judg", title: "Judge — scores every rollout against the rubric" },
] as const;

/**
 * Running is a hollow ring, done is a filled dot. The pulse is a bonus, not the
 * signal — under prefers-reduced-motion the shapes still tell them apart.
 */
const LED: Record<AgentStatus, string> = {
  idle: "bg-muted-foreground/25",
  running: "border-2 border-foreground bg-card pulse-run",
  done: "bg-accept",
  failed: "bg-reject",
};

export function agentStatus(loop: LoopState, key: string): AgentStatus {
  if (key === "judge") {
    // The judge runs once per rollout under two names; surface whichever is live.
    const w = loop.agents["judge:weak"]?.status as AgentStatus | undefined;
    const s = loop.agents["judge:strong"]?.status as AgentStatus | undefined;
    if (w === "running" || s === "running") return "running";
    return (s ?? w ?? "idle") as AgentStatus;
  }
  return (loop.agents[key]?.status as AgentStatus) ?? "idle";
}

export default function AgentChain({
  loop,
  onPick,
}: {
  loop: LoopState;
  onPick: (agent: string) => void;
}) {
  return (
    <div className="flex items-center">
      {CHAIN.map((c, i) => {
        const status = agentStatus(loop, c.key);
        return (
          <div key={c.key} className="contents">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onPick(c.key)}
                  className="group flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-sm py-0.5 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className={cn("size-2 shrink-0 rounded-full transition-colors", LED[status])} />
                  <span
                    className={cn(
                      "font-mono text-[10px] transition-colors",
                      status === "idle"
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {c.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {c.title} · {status}
              </TooltipContent>
            </Tooltip>
            {i < CHAIN.length - 1 && (
              <span className="mb-4 h-px w-3 shrink-0 bg-border" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}
