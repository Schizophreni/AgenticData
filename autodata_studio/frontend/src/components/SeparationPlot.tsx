import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Tick } from "@/types";

/**
 * THE SIGNATURE INSTRUMENT — the separation axis.
 *
 * Descends from the old GapCaliper (weak point, strong point, illuminated gap) but
 * tells the truth the averages hide. The engine runs k_weak + k_strong rollouts and
 * judges each one; every rollout is a tick here. Two populations sit in two lanes on
 * one 0..1 score axis:
 *
 *   weak   ○ hollow, teal   (above the axis)
 *   strong ● filled, carrot (below the axis)
 *
 * Those two hues come from Discord's own role palette, stepped per mode to clear the
 * dataviz lightness band. They deliberately avoid blurple: blurple is chrome (primary
 * action, active state), and a data color that collides with chrome stops reading as
 * data at all.
 *
 * Two different quantities are drawn, and they must not be confused:
 *
 *   Δ mean       strong_avg − weak_avg. What the backend actually gates on
 *                (curation/gap.py), so it is the headline number. Each mean is also
 *                marked on the axis by a caret, because acceptance is really a
 *                question about where the means fall relative to the gates.
 *   separation   min(strong) − max(weak): the real, no-overlap window between the two
 *                populations, drawn as a caliper. Positive → cleanly split. Zero or
 *                negative → the rollouts interleave and the item discriminates worse
 *                than its Δ mean suggests. On a real mock run, half the accepted
 *                rounds had Δ mean ≈ +0.4 with a separation of 0.0 — that gap is the
 *                whole reason this plot exists.
 *
 * The caliper is drawn in INK, never in an outcome color: it is a measurement, not a
 * verdict. The verdict lives on the status chip. The only chromatic marks here are
 * the rollout ticks, their means, and the gates that judge them.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => `${clamp01(v) * 100}%`;
const fmt = (v?: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

export default function SeparationPlot({
  weakTicks = [],
  strongTicks = [],
  weakAvg,
  strongAvg,
  gap,
  kWeak,
  kStrong,
  weakCeiling,
  strongFloor,
  variant = "full",
  className,
}: {
  weakTicks?: Tick[];
  strongTicks?: Tick[];
  weakAvg?: number | null;
  strongAvg?: number | null;
  gap?: number | null;
  kWeak?: number;
  kStrong?: number;
  weakCeiling?: number;
  strongFloor?: number;
  variant?: "full" | "mini";
  className?: string;
}) {
  const full = variant === "full";

  const maxWeak = weakTicks.length ? Math.max(...weakTicks.map((t) => t.score)) : null;
  const minStrong = strongTicks.length ? Math.min(...strongTicks.map((t) => t.score)) : null;

  const separation = maxWeak != null && minStrong != null ? minStrong - maxWeak : null;
  const separated = separation != null && separation > 0;

  const dMean = gap != null ? gap : weakAvg != null && strongAvg != null ? strongAvg - weakAvg : null;

  const empty = !weakTicks.length && !strongTicks.length;

  // Caliper span: the clean window when separated, the interleaved region when not.
  const lo = separated ? clamp01(maxWeak!) : minStrong != null ? clamp01(minStrong) : 0;
  const hi = separated ? clamp01(minStrong!) : maxWeak != null ? clamp01(maxWeak) : 0;

  return (
    <div className={cn("select-none", className)}>
      {full && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <Readout
            mark="weak"
            label={`weak${kWeak ? ` ${weakTicks.length}/${kWeak}` : ""}`}
            value={weakAvg}
          />
          <div className="text-center">
            <div className="channel-label mb-1">Δ mean</div>
            <div className="ginto tnum text-xl leading-none">
              {dMean == null ? "—" : (dMean >= 0 ? "+" : "−") + Math.abs(dMean).toFixed(3)}
            </div>
          </div>
          <Readout
            mark="strong"
            label={`strong${kStrong ? ` ${strongTicks.length}/${kStrong}` : ""}`}
            value={strongAvg}
            align="right"
          />
        </div>
      )}

      {/* Inset so a tick at 0.00 or 1.00 is never half-clipped. */}
      <div
        className={cn("relative", full ? "h-20" : "h-9")}
        style={{ paddingInline: full ? 8 : 6 }}
      >
        <div className="relative h-full w-full">
          {/* the score axis */}
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden />
          {/* end anchors — without them a mini axis has no scale */}
          <End at={0} />
          <End at={1} />

          {/* the thresholds this run judges against, as limit lines */}
          {full && weakCeiling != null && <Gate pos={weakCeiling} kind="weak" label="w≤" />}
          {full && strongFloor != null && <Gate pos={strongFloor} kind="strong" label="s≥" />}

          {/* caliper — the measured interval between the two populations */}
          {separation != null && <Caliper lo={lo} hi={hi} separated={separated} full={full} />}

          {/* the means the backend gates on */}
          {full && weakAvg != null && <MeanCaret pos={weakAvg} kind="weak" />}
          {full && strongAvg != null && <MeanCaret pos={strongAvg} kind="strong" />}

          {/* weak lane — hollow ticks above the axis */}
          {weakTicks.map((t) => (
            <TickMark key={`w${t.idx}`} tick={t} kind="weak" lane="24%" full={full} />
          ))}

          {/* strong lane — filled ticks below the axis */}
          {strongTicks.map((t) => (
            <TickMark key={`s${t.idx}`} tick={t} kind="strong" lane="76%" full={full} />
          ))}

          {empty && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="channel-label">awaiting rollouts</span>
            </div>
          )}
        </div>
      </div>

      {full && (
        <>
          <div className="mt-1.5 flex justify-between px-1">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span key={t} className="font-mono tnum text-[10px] text-muted-foreground">
                {t.toFixed(2)}
              </span>
            ))}
          </div>

          <div className="mt-3 border-t pt-3">
            {separation == null ? (
              <p className="channel-label text-center">separation pending</p>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="channel-label shrink-0 text-foreground">
                  {separated ? "separated" : "overlap"}
                </span>
                <span className="shrink-0 font-mono tnum text-xs text-foreground">
                  {fmt(Math.abs(separation), 3)}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {separated
                    ? "no rollout of either solver landed in this window"
                    : "the solvers' rollouts interleave — Δ mean overstates the split"}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Caliper jaws + rule. Reads as a measurement; a filled bar would read as a meter. */
function Caliper({
  lo,
  hi,
  separated,
  full,
}: {
  lo: number;
  hi: number;
  separated: boolean;
  full: boolean;
}) {
  const jaw = full ? "h-2.5" : "h-1.5";
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2"
      style={{ left: pct(lo), width: pct(hi - lo) }}
      aria-hidden
    >
      <div className="relative flex h-0 items-center">
        <span
          className={cn(
            "absolute inset-x-0 top-1/2 -translate-y-1/2",
            full ? "h-[2px]" : "h-px",
            separated ? "bg-foreground" : "hatch-overlap border-y border-muted-foreground/50"
          )}
          style={!separated ? { height: full ? 7 : 5 } : undefined}
        />
        {separated && (
          <>
            <span className={cn("absolute left-0 w-[2px] -translate-y-1/2 bg-foreground", jaw)} />
            <span className={cn("absolute right-0 w-[2px] -translate-y-1/2 bg-foreground", jaw)} />
          </>
        )}
      </div>
    </div>
  );
}

function End({ at }: { at: 0 | 1 }) {
  return (
    <span
      className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
      style={{ left: pct(at) }}
      aria-hidden
    />
  );
}

function TickMark({
  tick,
  kind,
  lane,
  full,
}: {
  tick: Tick;
  kind: "weak" | "strong";
  lane: string;
  full: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="tick-in absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full p-1 focus-visible:outline-2 focus-visible:outline-ring"
          style={{ left: pct(tick.score), top: lane }}
          aria-label={`${kind} rollout ${tick.idx + 1}, score ${tick.score.toFixed(2)}`}
        >
          {/* 8px floor even in mini: below that a mark stops being reliably readable. */}
          <span
            className={cn(
              "block size-2 rounded-full ring-2 ring-card",
              full && "size-2.5",
              kind === "weak" ? "border-2 border-weak bg-card" : "bg-strong"
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side={kind === "weak" ? "top" : "bottom"}>
        <span className="font-mono tnum">
          {kind} #{tick.idx + 1} · {tick.score.toFixed(2)}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The mean, pointed at the axis from inside its own lane. */
function MeanCaret({ pos, kind }: { pos: number; kind: "weak" | "strong" }) {
  const weak = kind === "weak";
  return (
    <span
      className="absolute -translate-x-1/2"
      style={{
        left: pct(pos),
        [weak ? "bottom" : "top"]: "calc(50% + 2px)",
        borderLeft: "4px solid transparent",
        borderRight: "4px solid transparent",
        [weak ? "borderTop" : "borderBottom"]: `5px solid var(--${kind})`,
      }}
      aria-hidden
    />
  );
}

/** An acceptance threshold — a limit line across the whole axis, labelled at the edge. */
function Gate({ pos, kind, label }: { pos: number; kind: "weak" | "strong"; label: string }) {
  const weak = kind === "weak";
  return (
    <div className="absolute inset-y-0 -translate-x-1/2" style={{ left: pct(pos) }} aria-hidden>
      <div
        className="mx-auto h-full w-px"
        style={{
          backgroundImage: `repeating-linear-gradient(to bottom, color-mix(in oklab, var(--${kind}) 55%, transparent) 0 3px, transparent 3px 6px)`,
        }}
      />
      <span
        className={cn(
          "absolute left-1/2 -translate-x-1/2 font-mono text-[9px] leading-none whitespace-nowrap",
          weak ? "-top-0.5" : "-bottom-0.5"
        )}
        style={{ color: `var(--${kind})` }}
      >
        {label}
      </span>
    </div>
  );
}

/** Colored mark + ink text: identity is carried by the mark, never by colored numerals. */
function Readout({
  mark,
  label,
  value,
  align = "left",
}: {
  mark: "weak" | "strong";
  label: string;
  value?: number | null;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className={cn("mb-1 flex items-center gap-1.5", align === "right" && "flex-row-reverse")}>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            mark === "weak" ? "border-2 border-weak" : "bg-strong"
          )}
        />
        <span className="channel-label">{label}</span>
      </div>
      <div className="font-mono tnum text-sm leading-none text-foreground">{fmt(value)}</div>
    </div>
  );
}
