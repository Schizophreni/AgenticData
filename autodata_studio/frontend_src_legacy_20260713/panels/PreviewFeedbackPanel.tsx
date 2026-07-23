import { useEffect, useState, type ReactNode } from "react";
import { api, imageSrc } from "../lib/api";
import { useStore } from "../store";
import GapCaliper from "../components/GapCaliper";

const AXES = ["question quality", "grounding", "rubric fairness", "difficulty right"];

export default function PreviewFeedbackPanel() {
  const { runId, gap } = useStore();
  const [examples, setExamples] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [apply, setApply] = useState(true);
  const [sent, setSent] = useState("");

  async function refresh() {
    if (!runId) return;
    const rows = await api.runExamples(runId);
    setExamples(rows);
    if (!sel && rows.length) setSel(rows.find((r) => r.status === "accepted")?.id || rows[0].id);
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  useEffect(() => {
    if (sel) api.getExample(sel).then(setDetail);
  }, [sel]);

  async function submit() {
    if (!sel) return;
    const res = await api.postFeedback(sel, { comment, ratings, apply });
    setSent(res.applied ? "Applied — recipe updated for future generations." : "Feedback saved.");
    setComment("");
    setRatings({});
    setTimeout(() => setSent(""), 4000);
  }

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <p className="text-dim text-sm">Start a run in <span className="text-strong">02 Curate</span> to preview output.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* specimen list */}
      <aside className="w-60 shrink-0 border-r border-rule bg-bench overflow-auto">
        <div className="flex items-center justify-between px-3 h-11 border-b border-rule sticky top-0 bg-bench">
          <span className="eyebrow">{examples.length} specimens</span>
          <a href={api.exportUrl(runId)} className="font-mono text-[11px] text-weak hover:text-strong">export ↓</a>
        </div>
        {examples.map((e) => (
          <button
            key={e.id}
            onClick={() => setSel(e.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-rule/40 transition ${
              sel === e.id ? "bg-bench2" : "hover:bg-bench2/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${e.status === "accepted" ? "bg-lock" : e.status === "rejected" ? "bg-rej" : "bg-strong led-run"}`} />
              <span className="font-mono text-[11px] text-dim truncate">{e.id.replace("ex_", "")}</span>
              {e.gap != null && <span className="ml-auto font-mono text-[11px] text-strong tnum">{e.gap.toFixed(2)}</span>}
            </div>
          </button>
        ))}
      </aside>

      <section className="flex-1 overflow-auto">
        {!detail ? (
          <div className="h-full flex items-center justify-center text-dim text-sm">Select a specimen.</div>
        ) : (
          <div className="max-w-6xl mx-auto px-6 py-6 grid lg:grid-cols-3 gap-6">
            {/* specimen */}
            <div className="lg:col-span-2 space-y-5">
              <div>
                <div className="eyebrow mb-2">source images</div>
                <div className="flex gap-2 flex-wrap">
                  {(detail.images || []).map((src: string, i: number) => (
                    <div key={i} className="relative">
                      <img
                        src={imageSrc(src)}
                        loading="lazy"
                        onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                        className="h-24 w-24 object-cover rounded-sm border border-rule bg-bench2"
                      />
                      <span className="absolute top-1 left-1 font-mono text-[10px] bg-abyss/85 text-weak px-1 rounded-sm">{i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Block title="question">{detail.question}</Block>
              <Block title="reference answer">{detail.reference}</Block>
              <div>
                <div className="eyebrow mb-2">rubric · {detail.rubric?.length || 0} criteria</div>
                <div className="space-y-1.5">
                  {(detail.rubric || []).map((r: any) => (
                    <div key={r.number} className="flex items-center gap-2.5 text-sm">
                      <span className={`font-mono text-xs tnum w-9 text-right ${r.weight >= 0 ? "text-lock" : "text-rej"}`}>
                        {r.weight > 0 ? `+${r.weight}` : r.weight}
                      </span>
                      <span className="text-chalk/85 leading-snug">{r.criterion}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* measurement + feedback */}
            <div className="space-y-4">
              <div className="border border-rule rounded bg-bench p-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-display text-chalk text-sm">Gap measurement</span>
                  <span className={`font-mono text-[10px] uppercase tracking-wider ${detail.status === "accepted" ? "text-lock" : "text-rej"}`}>
                    {detail.status}
                  </span>
                </div>
                <GapCaliper
                  weak={detail.weak_avg}
                  strong={detail.strong_avg}
                  gap={detail.gap}
                  weakCeiling={gap.mode === "rubric_threshold" ? gap.weak_ceiling : undefined}
                  strongFloor={gap.mode === "rubric_threshold" ? gap.strong_floor : undefined}
                />
                <div className="mt-4 pt-3 border-t border-rule/60 space-y-1">
                  <div className="text-[11px] text-dim leading-snug">{detail.accept_reason}</div>
                  <div className="font-mono text-[11px] text-faint">converged in {detail.rounds} rounds</div>
                </div>
              </div>

              <div className="border border-rule rounded bg-bench p-4">
                <div className="font-display text-chalk text-sm mb-1">Feedback</div>
                <div className="eyebrow mb-3">routes to the main agent</div>
                {AXES.map((a) => (
                  <div key={a} className="flex items-center justify-between mb-2">
                    <span className="text-xs text-dim">{a}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRatings((r) => ({ ...r, [a]: n }))}
                          className={`w-5 h-5 rounded-sm font-mono text-[10px] transition ${
                            (ratings[a] || 0) >= n ? "bg-strong text-abyss" : "bg-bench2 text-faint hover:text-dim"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <textarea
                  className="w-full bg-abyss border border-rule rounded-sm p-2 text-sm text-chalk mt-2 resize-none outline-none focus:border-strong/60"
                  rows={3}
                  placeholder="e.g. push toward comparing quantitative values across figures…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <label className="flex items-start gap-2 text-[11px] text-dim mt-2 leading-snug cursor-pointer">
                  <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="mt-0.5 accent-strong" />
                  send to main agent — folds this note into the recipe for future generations
                </label>
                <button
                  onClick={submit}
                  disabled={!comment && Object.keys(ratings).length === 0}
                  className="w-full mt-3 px-3 py-2 rounded-sm bg-weak text-abyss font-display font-semibold text-sm hover:brightness-110 disabled:opacity-40 transition"
                >
                  Submit feedback
                </button>
                {sent && <div className="text-[11px] text-lock mt-2 font-mono">{sent}</div>}

                {(detail.feedback || []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-rule/60 space-y-1.5">
                    {detail.feedback.map((f: any) => (
                      <div key={f.id} className="text-[11px] text-dim leading-snug flex gap-1.5">
                        <span className={f.applied ? "text-lock" : "text-faint"}>{f.applied ? "✓" : "·"}</span>
                        {f.comment}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{title}</div>
      <div className="text-chalk/90 text-sm leading-relaxed">{children}</div>
    </div>
  );
}
