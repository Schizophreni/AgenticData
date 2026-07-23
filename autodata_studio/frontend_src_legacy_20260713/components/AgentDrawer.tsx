import { useEffect, useState } from "react";
import { api } from "../lib/api";

const AGENT_TITLE: Record<string, string> = {
  challenger: "Challenger",
  verifier: "Quality verifier",
  weak: "Weak solver rollouts",
  strong: "Strong solver rollouts",
  judge: "Judge · rubric scoring",
};
const AGENT_SUB: Record<string, string> = {
  challenger: "question + reference + rubric",
  verifier: "leakage · multi-image · rubric checks",
  weak: "should struggle",
  strong: "should succeed",
  judge: "per-criterion scoring + verdict",
};

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
    api.getExample(exampleId).then((d) => live && setDetail(d)).catch((e) => live && setErr(String(e.message || e)));
    return () => {
      live = false;
    };
  }, [exampleId]);

  const rounds: any[] = detail?.rounds_detail || [];
  const tint = agent === "weak" ? "text-weak" : agent === "strong" ? "text-strong" : "text-chalk";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-abyss/50" onClick={onClose}>
      <div className="w-[38rem] max-w-full h-full bg-bench border-l border-rule overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bench border-b border-rule px-4 h-14 flex items-center gap-3">
          <div className="leading-tight">
            <div className={`font-display text-sm ${tint}`}>{AGENT_TITLE[agent] || agent}</div>
            <div className="eyebrow mt-0.5">{AGENT_SUB[agent]}</div>
          </div>
          <span className="font-mono text-[11px] text-faint ml-1">{exampleId.replace("ex_", "")}</span>
          <button onClick={onClose} className="ml-auto w-7 h-7 rounded-sm border border-rule text-dim hover:text-chalk hover:border-strong/50 font-mono text-sm">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {err && <div className="text-rej text-sm font-mono">{err}</div>}
          {!detail && !err && <div className="text-dim text-sm">Loading…</div>}

          {rounds.map((r) => (
            <div key={r.id} className="border border-rule rounded overflow-hidden">
              <div className="bg-bench2/50 px-3 h-8 flex items-center gap-2 border-b border-rule/60">
                <span className="font-mono text-[11px] text-dim">round {String(r.n).padStart(2, "0")}</span>
                <span className={`ml-auto font-mono text-[10px] uppercase tracking-wider ${r.decision === "accept" ? "text-lock" : r.decision === "qv_fail" || r.decision === "too_easy" ? "text-rej" : "text-strong"}`}>
                  {r.decision}
                </span>
              </div>
              <div className="p-3 text-sm space-y-2.5">
                {agent === "challenger" && (
                  <>
                    <KV k="question" v={r.challenger?.question} />
                    <KV k="reference" v={r.challenger?.reference_answer} />
                    <div className="eyebrow">rubric · {r.challenger?.rubric?.length || 0} criteria</div>
                  </>
                )}
                {agent === "verifier" && <Json v={r.qv} />}
                {(agent === "weak" || agent === "strong") &&
                  (r.rollouts || [])
                    .filter((x: any) => x.role === agent)
                    .map((x: any, i: number) => (
                      <div key={i} className="flex gap-2.5 items-baseline">
                        <span className="font-mono text-[11px] text-faint w-6">#{x.idx}</span>
                        <span className={`font-mono text-xs tnum w-11 ${x.score >= 0.5 ? "text-lock" : "text-rej"}`}>{x.score?.toFixed(2)}</span>
                        <span className="text-chalk/75 text-xs flex-1 leading-snug">{x.answer}</span>
                      </div>
                    ))}
                {agent === "judge" && (
                  <>
                    <KV k="gap interpretation" v={r.judge?.gap_interpretation} />
                    <KV k="grpo suitability" v={r.judge?.grpo_suitability} />
                    <KV k="verdict" v={r.judge?.verdict} />
                    {r.judge?.suggestion_for_challenger && <KV k="suggestion" v={r.judge.suggestion_for_challenger} />}
                  </>
                )}
                {r.feedback && agent !== "judge" && (
                  <div className="text-[11px] text-strong/90 font-mono border-t border-rule/60 pt-2 leading-snug">↳ {r.feedback}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: any }) {
  if (v === undefined || v === null || v === "") return null;
  return (
    <div>
      <span className="eyebrow">{k}</span>
      <div className="text-chalk/85 leading-snug">{String(v)}</div>
    </div>
  );
}
function Json({ v }: { v: any }) {
  return <pre className="text-[11px] text-chalk/70 whitespace-pre-wrap font-mono leading-relaxed">{JSON.stringify(v, null, 2)}</pre>;
}
