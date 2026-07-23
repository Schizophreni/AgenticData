import { useEffect, useState, type ReactNode } from "react";
import { DownloadIcon } from "lucide-react";

import SeparationPlot from "@/components/SeparationPlot";
import StatusChip from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, imageSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Tick } from "@/types";

const AXES = ["question quality", "grounding", "rubric fairness", "difficulty"];

export default function PreviewFeedbackPanel() {
  const { runId, gap } = useStore();
  const [examples, setExamples] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [apply, setApply] = useState(true);
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);

  // The examples list has no SSE channel of its own; poll while a run is in flight.
  useEffect(() => {
    if (!runId) return;
    let live = true;
    const refresh = async () => {
      const rows = await api.runExamples(runId);
      if (!live) return;
      setExamples(rows);
      setSel((cur) => cur ?? rows.find((r) => r.status === "accepted")?.id ?? rows[0]?.id ?? null);
    };
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [runId]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    api.getExample(sel).then((d) => live && setDetail(d));
    return () => {
      live = false;
    };
  }, [sel]);

  async function submit() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await api.postFeedback(sel, { comment, ratings, apply });
      setSent(
        res.applied
          ? "Applied. The main agent folded this into the recipe for future generations."
          : "Saved."
      );
      setComment("");
      setRatings({});
      setDetail(await api.getExample(sel));
      setTimeout(() => setSent(""), 5000);
    } catch (e: any) {
      setSent(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!runId) {
    return (
      <div className="flex h-full items-center justify-center bench-grid p-8">
        <p className="text-sm text-muted-foreground">
          Start a run in <b className="text-foreground">02 Curate</b> to review what it produced.
        </p>
      </div>
    );
  }

  // The plot shows the FINAL round's judged rollouts — the ones the verdict rests on.
  const last = detail?.rounds_detail?.[detail.rounds_detail.length - 1];
  const ticksFor = (role: string): Tick[] =>
    (last?.rollouts || [])
      .filter((x: any) => x.role === role && x.score != null)
      .map((x: any) => ({ idx: x.idx, score: x.score }));

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 overflow-auto border-r bg-card">
        <div className="sticky top-0 flex items-center gap-2 border-b bg-card px-3 py-2.5">
          <span className="faceplate">{examples.length} specimens</span>
          <Button variant="ghost" size="icon-xs" className="ml-auto" asChild>
            <a href={api.exportUrl(runId)} title="Export accepted examples as JSONL">
              <DownloadIcon />
              <span className="sr-only">Export</span>
            </a>
          </Button>
        </div>
        {examples.map((e) => (
          <button
            key={e.id}
            onClick={() => setSel(e.id)}
            className={cn(
              "flex w-full items-center gap-2 border-b px-3 py-2.5 text-left transition-colors",
              sel === e.id ? "bg-accent" : "hover:bg-accent/50"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                e.status === "accepted"
                  ? "bg-accept"
                  : e.status === "rejected"
                    ? "bg-reject"
                    : "bg-muted-foreground pulse-run"
              )}
            />
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {e.id.replace("ex_", "")}
            </span>
            {e.gap != null && (
              <span className="ml-auto shrink-0 font-mono tnum text-[11px] text-foreground">
                {e.gap.toFixed(2)}
              </span>
            )}
          </button>
        ))}
      </aside>

      <section className="flex-1 overflow-auto bench-grid">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a specimen.
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              {(detail.images || []).length > 0 && (
                <div>
                  <div className="faceplate mb-2">source images</div>
                  <div className="flex flex-wrap gap-2">
                    {detail.images.map((src: string, i: number) => (
                      <div key={i} className="relative">
                        <img
                          src={imageSrc(src)}
                          loading="lazy"
                          alt={`source ${i + 1}`}
                          onError={(e) => (e.currentTarget.style.opacity = "0.2")}
                          className="size-24 rounded-sm border bg-muted object-cover"
                        />
                        <span className="absolute top-1 left-1 rounded-sm bg-background/90 px-1 font-mono text-[10px] text-foreground">
                          {i + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Block title="question">{detail.question}</Block>
              <Block title="reference answer">{detail.reference}</Block>

              <div>
                <div className="faceplate mb-2">rubric · {detail.rubric?.length || 0} criteria</div>
                <div className="space-y-1.5">
                  {(detail.rubric || []).map((r: any) => (
                    <div key={r.number} className="flex items-baseline gap-2.5 text-sm">
                      <span
                        className={cn(
                          "w-8 shrink-0 text-right font-mono tnum text-xs",
                          r.weight >= 0 ? "text-accept" : "text-reject"
                        )}
                      >
                        {r.weight > 0 ? `+${r.weight}` : r.weight}
                      </span>
                      <span className="leading-snug text-foreground">{r.criterion}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Separation</CardTitle>
                  <StatusChip status={detail.status} className="ml-auto" />
                </CardHeader>
                <CardContent>
                  <SeparationPlot
                    weakTicks={ticksFor("weak")}
                    strongTicks={ticksFor("strong")}
                    weakAvg={detail.weak_avg}
                    strongAvg={detail.strong_avg}
                    gap={detail.gap}
                    weakCeiling={gap.mode === "rubric_threshold" ? gap.weak_ceiling : undefined}
                    strongFloor={gap.mode === "rubric_threshold" ? gap.strong_floor : undefined}
                  />
                  <div className="mt-4 space-y-1 border-t pt-3">
                    <p className="text-xs leading-snug text-muted-foreground">
                      {detail.accept_reason}
                    </p>
                    <p className="font-mono tnum text-[11px] text-muted-foreground">
                      settled in {detail.rounds} round{detail.rounds === 1 ? "" : "s"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Feedback</CardTitle>
                  <span className="faceplate ml-auto">to the main agent</span>
                </CardHeader>
                <CardContent>
                  {AXES.map((a) => (
                    <div key={a} className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{a}</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            onClick={() => setRatings((r) => ({ ...r, [a]: n }))}
                            aria-label={`${a}: ${n} of 5`}
                            className={cn(
                              "size-5 rounded-sm font-mono text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                              (ratings[a] || 0) >= n
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-accent"
                            )}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <Textarea
                    rows={3}
                    className="mt-3"
                    placeholder="e.g. push toward comparing quantitative values across figures…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />

                  <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs leading-snug text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={apply}
                      onChange={(e) => setApply(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    Fold this into the recipe, so future generations follow it
                  </label>

                  <Button
                    className="mt-3 w-full"
                    onClick={submit}
                    disabled={busy || (!comment && Object.keys(ratings).length === 0)}
                  >
                    {busy ? "Sending…" : "Send feedback"}
                  </Button>
                  {sent && <p className="mt-2 text-xs text-accept">{sent}</p>}

                  {(detail.feedback || []).length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t pt-3">
                      {detail.feedback.map((f: any) => (
                        <div
                          key={f.id}
                          className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground"
                        >
                          <span className={f.applied ? "text-accept" : "text-muted-foreground"}>
                            {f.applied ? "✓" : "·"}
                          </span>
                          {f.comment}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
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
      <div className="faceplate mb-1.5">{title}</div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}
