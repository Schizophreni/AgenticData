/**
 * The signature instrument: a ruler from 0..1 on which the weak (cyan) and strong
 * (amber) solver scores are plotted as opposed markers, with the gap between them
 * rendered as an illuminated interval — the thing the whole foundry manufactures.
 * `full` adds ruler ticks, end labels, the centered gap readout, and the acceptance
 * threshold gates (weak ceiling / strong floor) as notches under the track.
 */
export default function GapCaliper({
  weak,
  strong,
  gap,
  weakCeiling,
  strongFloor,
  variant = "full",
}: {
  weak?: number | null;
  strong?: number | null;
  gap?: number | null;
  weakCeiling?: number;
  strongFloor?: number;
  variant?: "full" | "mini";
}) {
  const full = variant === "full";
  const hasBoth = weak != null && strong != null;
  const w = clamp(weak);
  const s = clamp(strong);
  const lo = Math.min(w, s);
  const hi = Math.max(w, s);
  const g = gap != null ? gap : hasBoth ? strong! - weak! : null;

  return (
    <div className={full ? "select-none" : "select-none"}>
      {full && (
        <div className="flex items-end justify-between mb-2">
          <Reading label="weak" value={weak} color="text-weak" />
          <div className="text-center">
            <div className="eyebrow mb-0.5">gap</div>
            <div className="font-mono text-lg font-medium text-chalk tnum">
              {g != null ? (g >= 0 ? "+" : "") + g.toFixed(3) : "—"}
            </div>
          </div>
          <Reading label="strong" value={strong} color="text-strong" align="right" />
        </div>
      )}

      <div className={`relative ${full ? "h-9" : "h-5"}`}>
        {/* track */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-raise" />

        {/* ruler ticks */}
        {full &&
          [0, 0.25, 0.5, 0.75, 1].map((t) => (
            <div
              key={t}
              className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-rule"
              style={{ left: `${t * 100}%` }}
            />
          ))}

        {/* illuminated gap interval */}
        {hasBoth && (
          <div
            className="sweep absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full"
            style={{
              left: `${lo * 100}%`,
              width: `${(hi - lo) * 100}%`,
              background: "linear-gradient(90deg,#33D1E6,#F4A63A)",
              boxShadow: "0 0 12px -2px rgba(244,166,58,0.5)",
            }}
          />
        )}

        {/* acceptance gates (thresholds) */}
        {full && weakCeiling != null && (
          <Gate pos={weakCeiling} color="#33D1E6" label="w≤" />
        )}
        {full && strongFloor != null && (
          <Gate pos={strongFloor} color="#F4A63A" label="s≥" />
        )}

        {/* markers */}
        {weak != null && <Marker pos={w} color="#33D1E6" full={full} />}
        {strong != null && <Marker pos={s} color="#F4A63A" full={full} />}
      </div>
    </div>
  );
}

function clamp(v?: number | null) {
  return Math.max(0, Math.min(1, v ?? 0));
}

function Marker({ pos, color, full }: { pos: number; color: string; full: boolean }) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
      style={{ left: `${pos * 100}%` }}
    >
      <div
        className={`rounded-full ${full ? "w-3 h-3" : "w-2 h-2"}`}
        style={{ background: color, boxShadow: `0 0 10px -1px ${color}` }}
      />
    </div>
  );
}

function Gate({ pos, color, label }: { pos: number; color: string; label: string }) {
  return (
    <div className="absolute bottom-0" style={{ left: `${pos * 100}%` }}>
      <div className="w-px h-2.5 -translate-x-1/2" style={{ background: color, opacity: 0.6 }} />
      <div
        className="font-mono text-[8px] -translate-x-1/2 mt-0.5"
        style={{ color, opacity: 0.7 }}
      >
        {label}
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  color,
  align = "left",
}: {
  label: string;
  value?: number | null;
  color: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="eyebrow mb-0.5">{label}</div>
      <div className={`font-mono text-lg font-medium tnum ${color}`}>
        {value != null ? value.toFixed(3) : "—"}
      </div>
    </div>
  );
}
