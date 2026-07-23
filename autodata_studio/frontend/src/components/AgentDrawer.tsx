import { useEffect, useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import SeparationPlot from "@/components/SeparationPlot";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Tick } from "@/types";

const TITLE: Record<string, string> = {
  challenger: "Challenger",
  verifier: "Quality verifier",
  weak: "Weak solver rollouts",
  strong: "Strong solver rollouts",
  judge: "Judge · rubric scoring",
};
const SUB: Record<string, string> = {
  challenger: "Writes the question, the reference answer, and the rubric.",
  verifier: "Checks the candidate for leakage, multi-image grounding, and rubric sanity.",
  weak: "Should struggle. Its ceiling is what makes an item hard enough to be worth keeping.",
  strong: "Should succeed. Its floor is what makes an item solvable at all.",
  judge: "Scores every rollout against the rubric, then reads the pattern.",
};

/** Per-round work for one agent, read back from the run's persisted history. */
export default function AgentDrawer({
  exampleId,
  agent,
  onClose,
}: {
  exampleId: string;
  agent: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setDetail(null);
    setErr("");
    api
      .getExample(exampleId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setErr(String(e.message || e)));
    return () => {
      live = false;
    };
  }, [exampleId]);

  const rounds: any[] = detail?.rounds_detail || [];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader>
          <div className="flex items-center gap-2.5">
            {(agent === "weak" || agent === "strong") && (
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  agent === "weak" ? "border-2 border-weak" : "bg-strong"
                )}
              />
            )}
            <SheetTitle>{TITLE[agent] ?? agent}</SheetTitle>
            <span className="font-mono text-[11px] text-muted-foreground">
              {exampleId.replace("ex_", "")}
            </span>
          </div>
          <SheetDescription>{SUB[agent]}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-auto p-5">
          {err && <p className="font-mono text-sm text-reject">{err}</p>}
          {!detail && !err && <p className="text-sm text-muted-foreground">Loading rounds…</p>}
          {detail && !rounds.length && (
            <p className="text-sm text-muted-foreground">
              No rounds recorded yet. They appear as the loop advances.
            </p>
          )}

          {rounds.map((r) => (
            <Round key={r.id} r={r} agent={agent} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Round({ r, agent }: { r: any; agent: string }) {
  const rollouts: any[] = r.rollouts || [];
  const challengerRubric: any[] = r.challenger?.rubric || [];
  const isMcqAnswerCheck = challengerRubric.length === 1
    && /final selected option is\s+[A-E]/i.test(String(challengerRubric[0]?.criterion || ""));
  const ticks = (role: string): Tick[] =>
    rollouts
      .filter((x) => x.role === role && x.score != null)
      .map((x) => ({ idx: x.idx, score: x.score }));

  const decisionColor =
    r.decision === "accept"
      ? "text-accept"
      : r.decision === "qv_fail" || r.decision === "too_easy" || r.decision === "challenger_error"
        ? "text-reject"
        : "text-muted-foreground";

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          round {String(r.n).padStart(2, "0")}
        </span>
        <span className={cn("channel-label ml-auto text-current", decisionColor)}>{r.decision}</span>
      </div>

      <div className="space-y-3 p-3 text-sm">
        {agent === "challenger" && (
          <>
            <KV k="question" v={r.challenger?.question} />
            <KV k="reference answer" v={r.challenger?.reference_answer} />
            <div className="channel-label">
              {isMcqAnswerCheck
                ? "answer check · exact option match"
                : `rubric · ${challengerRubric.length} criteria`}
            </div>
          </>
        )}

        {agent === "verifier" && <Json v={r.qv} />}

        {(agent === "weak" || agent === "strong") && (
          <>
            {ticks(agent).length > 0 && (
              <SeparationPlot
                weakTicks={agent === "weak" ? ticks("weak") : []}
                strongTicks={agent === "strong" ? ticks("strong") : []}
                variant="mini"
                className="mb-3"
              />
            )}
            {rollouts.filter((x) => x.role === agent).length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {agent} rollouts this round — the loop stopped before reaching them.
              </p>
            )}
            {rollouts
              .filter((x) => x.role === agent)
              .map((x, i) => (
                <div key={i} className="flex items-baseline gap-2.5 border-t pt-2 first:border-0">
                  <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
                    #{x.idx + 1}
                  </span>
                  <span className="w-10 shrink-0 font-mono tnum text-xs text-foreground">
                    {x.score?.toFixed(2)}
                  </span>
                  <span className="flex-1 text-xs leading-snug text-muted-foreground">
                    {x.answer}
                  </span>
                </div>
              ))}
          </>
        )}

        {agent === "judge" && (
          <>
            {(ticks("weak").length > 0 || ticks("strong").length > 0) && (
              <SeparationPlot
                weakTicks={ticks("weak")}
                strongTicks={ticks("strong")}
                weakAvg={r.judge?.weak_avg}
                strongAvg={r.judge?.strong_avg}
                className="mb-4"
              />
            )}
            <KV k="gap interpretation" v={r.judge?.gap_interpretation} />
            <KV k="grpo suitability" v={r.judge?.grpo_suitability} />
            <KV k="verdict" v={r.judge?.verdict} />
            <KV k="suggestion" v={r.judge?.suggestion_for_challenger} />
          </>
        )}

        {r.feedback && agent !== "judge" && (
          <p className="border-t pt-2 font-mono text-[11px] leading-snug text-muted-foreground">
            ↳ {r.feedback}
          </p>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: any }) {
  if (v === undefined || v === null || v === "") return null;
  return (
    <div>
      <div className="channel-label mb-1">{k}</div>
      <div className="leading-snug text-foreground">{String(v)}</div>
    </div>
  );
}

function Json({ v }: { v: any }): ReactNode {
  return (
    <pre className="overflow-x-auto rounded-sm bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}
