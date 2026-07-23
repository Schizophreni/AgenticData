import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Shuffle, X } from "lucide-react";

import AgentDrawer from "@/components/AgentDrawer";
import Embed from "@/components/Embed";
import SeparationPlot from "@/components/SeparationPlot";
import StatusChip from "@/components/StatusChip";
import ChannelHeader from "@/components/shell/ChannelHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, imageSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Tick } from "@/types";

const AXES = ["question quality", "grounding", "rubric fairness", "difficulty"];

const INSPECT = [
  { key: "challenger", label: "challenger" },
  { key: "verifier", label: "verifier" },
  { key: "weak", label: "weak" },
  { key: "strong", label: "strong" },
  { key: "judge", label: "judge" },
];

export default function PreviewFeedbackPanel() {
  const { runId, gap, examples, setExamples, selectedExample, selectExample } = useStore();
  const [detail, setDetail] = useState<any>(null);
  const [drawer, setDrawer] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [apply, setApply] = useState(true);
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [indexInput, setIndexInput] = useState("1");

  // The examples list has no SSE channel of its own; poll while a run is in flight.
  useEffect(() => {
    if (!runId) return;
    let live = true;
    const refresh = async () => {
      const rows = await api.runExamples(runId);
      if (live) setExamples(rows);
    };
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [runId, setExamples]);

  useEffect(() => {
    if (!selectedExample) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    api.getExample(selectedExample).then((d) => live && setDetail(d));
    return () => {
      live = false;
    };
  }, [selectedExample]);

  const currentIndex = examples.findIndex((e) => e.id === selectedExample);

  useEffect(() => {
    setIndexInput(currentIndex >= 0 ? String(currentIndex + 1) : examples.length ? "1" : "");
  }, [currentIndex, examples.length]);

  function jumpTo(raw: string) {
    if (!examples.length) return;
    const requested = Number.parseInt(raw, 10);
    if (!Number.isFinite(requested)) {
      setIndexInput(currentIndex >= 0 ? String(currentIndex + 1) : "1");
      return;
    }
    const index = Math.max(0, Math.min(examples.length - 1, requested - 1));
    setIndexInput(String(index + 1));
    selectExample(examples[index].id);
  }

  function move(delta: number) {
    if (!examples.length) return;
    const base = currentIndex >= 0 ? currentIndex : 0;
    const index = Math.max(0, Math.min(examples.length - 1, base + delta));
    selectExample(examples[index].id);
  }

  function sampleRandom() {
    if (!examples.length) return;
    let index = Math.floor(Math.random() * examples.length);
    if (examples.length > 1 && index === currentIndex) index = (index + 1) % examples.length;
    selectExample(examples[index].id);
  }

  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      const n = detail?.images?.length ?? 0;
      if (e.key === "Escape") setLightbox(null);
      if (n > 1 && e.key === "ArrowRight") setLightbox((i) => (i == null ? 0 : (i + 1) % n));
      if (n > 1 && e.key === "ArrowLeft") setLightbox((i) => (i == null ? 0 : (i - 1 + n) % n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, detail?.images?.length]);

  async function submit() {
    if (!selectedExample) return;
    setBusy(true);
    try {
      const res = await api.postFeedback(selectedExample, { comment, ratings, apply });
      setSent(
        res.applied
          ? "Applied. The main agent folded this into the recipe for future generations."
          : "Saved."
      );
      setComment("");
      setRatings({});
      setDetail(await api.getExample(selectedExample));
      setTimeout(() => setSent(""), 5000);
    } catch (e: any) {
      setSent(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!runId)
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-chat">
        <ChannelHeader name="preview" topic="Review what the run produced, then steer it" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Start a run in Curate and its specimens land here.
          </p>
        </div>
      </div>
    );

  /*
   * Plot the last round that actually REACHED the solvers — not simply the last round.
   *
   * A round that dies at the quality verifier never runs a solver, so it persists no
   * rollouts. In the real Qwen run that is the norm, not the exception: 54 of its 57
   * rejections end on a round with zero rollouts, and 46 never scored a rollout in any
   * round at all. Keying the plot to `rounds_detail.at(-1)` therefore drew an empty axis
   * for almost every rejected specimen — the very ones a reviewer opens to find out what
   * went wrong.
   */
  const rounds: any[] = detail?.rounds_detail ?? [];
  let scoredIdx = -1;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if ((rounds[i].rollouts || []).some((x: any) => x.score != null)) {
      scoredIdx = i;
      break;
    }
  }
  const scored = scoredIdx >= 0 ? rounds[scoredIdx] : null;
  const staleRound = scored != null && scoredIdx !== rounds.length - 1;

  // MCQ batches persist the generated schema inside the accepted round's
  // challenger payload. Keep the existing preview contract intact and derive
  // the MCQ view when those fields are present.
  const mcq = [...rounds]
    .reverse()
    .map((r: any) => r.challenger || {})
    .find((c: any) => Array.isArray(c.options) && c.options.length >= 4);
  const rubric: any[] = detail?.rubric || [];
  const mcqAnswerCheck = Boolean(mcq) && rubric.length === 1
    && /final selected option is\s+[A-E]/i.test(String(rubric[0]?.criterion || ""));
  const correctOption = mcqAnswerCheck
    ? String(rubric[0].criterion).match(/final selected option is\s+([A-E])/i)?.[1]?.toUpperCase()
    : null;

  const ticksFor = (role: string): Tick[] =>
    (scored?.rollouts || [])
      .filter((x: any) => x.role === role && x.score != null)
      .map((x: any) => ({ idx: x.idx, score: x.score }));

  const accepted = examples.filter((e) => e.status === "accepted").length;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-chat">
      <ChannelHeader
        name="preview"
        topic={`${accepted} of ${examples.length} specimens accepted`}
        actions={
          <div className="flex items-center gap-1.5">
            {detail && <StatusChip status={detail.status} />}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous specimen"
              onClick={() => move(-1)}
              disabled={currentIndex <= 0}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input
                type="number"
                min={1}
                max={Math.max(1, examples.length)}
                value={indexInput}
                onChange={(e) => setIndexInput(e.target.value)}
                onBlur={() => jumpTo(indexInput)}
                onKeyDown={(e) => e.key === "Enter" && jumpTo(indexInput)}
                aria-label="Specimen index"
                className="h-8 w-16 px-2 text-center font-mono text-xs"
              />
              <span className="whitespace-nowrap">/ {examples.length}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next specimen"
              onClick={() => move(1)}
              disabled={currentIndex < 0 || currentIndex >= examples.length - 1}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={sampleRandom}
              disabled={!examples.length}
            >
              <Shuffle className="size-4" />
              抽样
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            该生成任务暂无可预览数据。
          </div>
        ) : (
          <div className="max-w-3xl space-y-3 px-6 py-6">
            {(detail.images || []).length > 0 && (
              <div>
                <div className="channel-label mb-2">source images</div>
                <div className="flex flex-wrap gap-2">
                  {detail.images.map((src: string, i: number) => (
                    <div
                      key={i}
                      className="relative flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated"
                    >
                      <img
                        src={imageSrc(src)}
                        loading="lazy"
                        alt={`source ${i + 1}`}
                        onError={(e) => (e.currentTarget.style.opacity = "0.2")}
                        onClick={() => setLightbox(i)}
                        className="h-full w-full cursor-zoom-in object-contain transition-opacity hover:opacity-80"
                      />
                      <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
                        {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Embed accent={detail.status === "accepted" ? "accept" : "reject"}>
              <div className="text-sm font-semibold text-heading">Question</div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{detail.question}</p>
              {mcq && <McqCard candidate={mcq} />}
              <div className="mt-3 text-sm font-semibold text-heading">Reference answer</div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail.reference}</p>
            </Embed>

            <Embed accent="none">
              <div className="text-sm font-semibold text-heading">Separation</div>

              {scored ? (
                <div className="mt-3">
                  <SeparationPlot
                    weakTicks={ticksFor("weak")}
                    strongTicks={ticksFor("strong")}
                    weakAvg={detail.weak_avg}
                    strongAvg={detail.strong_avg}
                    gap={detail.gap}
                    weakCeiling={gap.mode === "rubric_threshold" ? gap.weak_ceiling : undefined}
                    strongFloor={gap.mode === "rubric_threshold" ? gap.strong_floor : undefined}
                  />
                  {staleRound && (
                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                      Showing round {scored.n}, the last one that reached the solvers. Rounds after
                      it never got past the quality verifier.
                    </p>
                  )}
                </div>
              ) : (
                <NeverScored rounds={rounds} />
              )}

              <div className="mt-3 border-t pt-3">
                <p className="text-xs leading-snug text-muted-foreground">{detail.accept_reason}</p>
                <p className="mt-1 font-mono tnum text-[11px] text-muted-foreground">
                  settled in {detail.rounds} round{detail.rounds === 1 ? "" : "s"}
                </p>
              </div>

              {/* The rounds are persisted, so a finished specimen can be opened up too —
                  not just one caught live on the board. */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="channel-label mr-1">inspect rounds</span>
                {INSPECT.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => setDrawer(a.key)}
                    className="rounded bg-elevated px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </Embed>

            <Embed accent="none">
              <div className="text-sm font-semibold text-heading">
                {mcqAnswerCheck ? "Answer check · exact match" : `Rubric · ${rubric.length} criteria`}
              </div>
              {mcqAnswerCheck ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-accept/10 px-2 py-1 font-mono text-accept">
                    Correct option: {correctOption || "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Rollout score = 1 only when the selected letter matches.
                  </span>
                </div>
              ) : <div className="mt-2 space-y-1">
                {rubric.map((r: any) => (
                  <div key={r.number} className="flex items-baseline gap-2.5 text-sm">
                    <span
                      className={cn(
                        "w-7 shrink-0 text-right font-mono tnum text-xs",
                        r.weight >= 0 ? "text-accept" : "text-reject"
                      )}
                    >
                      {r.weight > 0 ? `+${r.weight}` : r.weight}
                    </span>
                    <span className="leading-snug text-foreground">{r.criterion}</span>
                  </div>
                ))}
              </div>}
            </Embed>

            {/* feedback — Discord's composer at the foot of the channel */}
            <div className="rounded-lg bg-input p-4">
              <div className="text-sm font-semibold text-heading">Feedback to the main agent</div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {AXES.map((a) => (
                  <div key={a} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{a}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRatings((r) => ({ ...r, [a]: n }))}
                          aria-label={`${a}: ${n} of 5`}
                          className={cn(
                            "size-5 rounded font-mono text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                            (ratings[a] || 0) >= n
                              ? "bg-primary text-primary-foreground"
                              : "bg-elevated text-muted-foreground hover:bg-hover"
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <Textarea
                rows={3}
                className="mt-3 border-0 bg-elevated"
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
                className="mt-3"
                onClick={submit}
                disabled={busy || (!comment && Object.keys(ratings).length === 0)}
              >
                {busy ? "Sending…" : "Send feedback"}
              </Button>
              {sent && <p className="mt-2 text-xs text-accept">{sent}</p>}
            </div>

            {(detail.feedback || []).length > 0 && (
              <Embed accent="none">
                <div className="text-sm font-semibold text-heading">
                  Feedback history · {detail.feedback.length}
                </div>
                <div className="mt-2 space-y-1.5">
                  {detail.feedback.map((f: any) => (
                    <div
                      key={f.id}
                      className="flex gap-1.5 text-xs leading-snug text-muted-foreground"
                    >
                      <span className={f.applied ? "text-accept" : "text-muted-foreground"}>
                        {f.applied ? "✓" : "·"}
                      </span>
                      {f.comment}
                    </div>
                  ))}
                </div>
              </Embed>
            )}
          </div>
        )}
      </div>

      {drawer && selectedExample && (
        <AgentDrawer
          exampleId={selectedExample}
          agent={drawer}
          onClose={() => setDrawer(null)}
        />
      )}

      {lightbox != null && detail?.images?.[lightbox] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Image ${lightbox + 1} of ${detail.images.length}`}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close image preview"
            className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="size-5" />
          </button>
          {detail.images.length > 1 && (
            <button
              type="button"
              aria-label="Previous image"
              className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i == null ? 0 : (i - 1 + detail.images.length) % detail.images.length)); }}
            >
              <ChevronLeft className="size-6" />
            </button>
          )}
          <img
            src={imageSrc(detail.images[lightbox])}
            alt={`source ${lightbox + 1}`}
            className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {detail.images.length > 1 && (
            <button
              type="button"
              aria-label="Next image"
              className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i == null ? 0 : (i + 1) % detail.images.length)); }}
            >
              <ChevronRight className="size-6" />
            </button>
          )}
          <div className="absolute bottom-4 rounded-full bg-black/60 px-3 py-1 font-mono text-xs text-white">
            {lightbox + 1} / {detail.images.length}
          </div>
        </div>
      )}
    </div>
  );
}

function McqCard({ candidate }: { candidate: any }) {
  const answerable = candidate.answerable !== false;
  const answerType = String(candidate.answer_type || "");
  const correct = String(candidate.correct_answer || "").trim().slice(0, 1).toUpperCase();
  const options = (candidate.options || []).map((o: unknown) => String(o));
  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-elevated/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="channel-label">multiple choice</span>
        {candidate.task_type && (
          <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {candidate.task_type}
          </span>
        )}
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          answerable ? "bg-accept/15 text-accept" : "bg-warn/15 text-warn"
        )}>
          {answerType === "none_of_above"
            ? "answerable · none of A–D"
            : answerType === "insufficient_evidence" || !answerable
              ? "insufficient evidence · E"
              : "answerable"}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {options.map((option: string, i: number) => {
          const letter = option.trim().slice(0, 1).toUpperCase() || String.fromCharCode(65 + i);
          const isCorrect = letter === correct;
          return (
            <div
              key={`${letter}-${i}`}
              className={cn(
                "rounded-md border px-2.5 py-2 text-sm leading-snug",
                isCorrect ? "border-accept/50 bg-accept/10 text-foreground" : "border-border/50 text-muted-foreground"
              )}
            >
              <span className="mr-2 font-mono text-xs font-semibold">{letter}.</span>
              {option.replace(/^[A-Ea-e][.)：:\\s]+/, "")}
              {isCorrect && <span className="ml-2 text-xs text-accept">✓ correct</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * There is no axis to draw, because no solver ever ran. Say so, and say what stopped it.
 * An empty instrument reading "awaiting rollouts" implies scores are still coming — for
 * these specimens they never will, and that is the whole story of why they were rejected.
 */
function NeverScored({ rounds }: { rounds: any[] }) {
  const tally = rounds.reduce<Record<string, number>>((acc, r) => {
    acc[r.decision] = (acc[r.decision] ?? 0) + 1;
    return acc;
  }, {});

  const REASON: Record<string, string> = {
    qv_fail: "the quality verifier rejected the question",
    too_easy: "the weak solver already solved it, so the strong solver never ran",
    challenger_error: "the challenger errored",
  };

  const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const why = dominant ? REASON[dominant[0]] : undefined;

  return (
    <div className="mt-3 rounded-md bg-background/60 p-3">
      <p className="text-sm leading-relaxed text-foreground">
        No rollouts were ever scored, so there is nothing to separate.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {why
          ? `In ${dominant[1]} of ${rounds.length} round${
              rounds.length === 1 ? "" : "s"
            } ${why} — the loop stopped before the solvers ran.`
          : "The loop stopped before the solvers ran."}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {rounds.map((r) => (
          <span
            key={r.id}
            className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            r{r.n} · {r.decision}
          </span>
        ))}
      </div>
    </div>
  );
}
