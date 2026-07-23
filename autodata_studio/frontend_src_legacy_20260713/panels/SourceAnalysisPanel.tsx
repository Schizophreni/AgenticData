import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";

export default function SourceAnalysisPanel() {
  const { recipe, profile, setRecipe, setTab, roles } = useStore();
  const [task, setTask] = useState(
    "Build multi-image QA that tests cross-figure reasoning over Zhihu technical answers"
  );
  const [dataPath, setDataPath] = useState(
    "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download/zhihu_answers"
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function analyze() {
    setBusy(true);
    setErr("");
    try {
      const res = await api.createRecipe({ task, data_path: dataPath, do_autoresearch: true, main: roles.main });
      setRecipe(res.recipe, res.profile);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="eyebrow mb-3">step 01 · source calibration</div>
        <h1 className="font-display text-3xl font-semibold text-chalk leading-tight max-w-2xl">
          Read the source, then draft the recipe that will manufacture data from it.
        </h1>
        <p className="text-dim text-sm mt-3 max-w-2xl leading-relaxed">
          Profile the corpus, autoresearch what counts as high-quality data for this task, and emit
          a processing pipeline plus the rubric the judge will grade against.
        </p>

        {/* instrument input */}
        <div className="mt-7 border border-rule rounded bg-bench">
          <div className="p-5 space-y-4">
            <Input label="Task">
              <textarea
                className="w-full bg-abyss border border-rule rounded-sm px-3 py-2 text-sm text-chalk resize-none focus:border-strong/60 outline-none"
                rows={2}
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
            </Input>
            <Input label="Data path">
              <input
                className="w-full bg-abyss border border-rule rounded-sm px-3 py-2 text-sm font-mono text-weak focus:border-strong/60 outline-none"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
              />
            </Input>
          </div>
          <div className="flex items-center gap-3 px-5 py-3 border-t border-rule bg-bench2/50">
            <button
              onClick={analyze}
              disabled={busy}
              className="px-4 py-2 rounded-sm bg-strong text-abyss font-display font-semibold text-sm hover:brightness-110 disabled:opacity-50 transition"
            >
              {busy ? "Calibrating…" : "Analyze source"}
            </button>
            {recipe && (
              <button
                onClick={() => setTab("loop")}
                className="px-4 py-2 rounded-sm border border-rule text-dim hover:text-chalk hover:border-strong/50 text-sm font-mono transition"
              >
                to curation →
              </button>
            )}
            {err && <span className="text-rej text-sm font-mono">{err}</span>}
          </div>
        </div>

        {profile && (
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <Spec title="Source profile" tag="scan">
              <Row k="modality" v={profile.modality} accent />
              <Row k="path exists" v={String(profile.path_exists)} />
              <Row k="synthetic fallback" v={String(profile.using_synthetic_fallback)} />
              <Row k="sampled docs" v={profile.sampled_docs} />
              <Row k="images / doc · median" v={profile.images_per_doc?.median} />
              <Row k="multi-image fraction" v={profile.multi_image_fraction} accent />
            </Spec>

            <Spec title="Quality standards" tag="autoresearch">
              <ul className="space-y-2.5">
                {recipe?.brief.map((b, i) => (
                  <li key={i} className="text-sm leading-snug flex gap-2.5">
                    <span
                      className={`shrink-0 mt-0.5 font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm h-fit ${
                        b.confidence === "high" ? "bg-lock/15 text-lock" : "bg-strong/15 text-strong"
                      }`}
                    >
                      {b.confidence}
                    </span>
                    <span className="text-chalk/90">
                      {b.claim}
                      {b.source && <span className="text-faint"> · {b.source}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Spec>

            <Spec title="Processing pipeline" tag="funnel">
              <ol className="space-y-2">
                {recipe?.pipeline_spec.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="font-mono text-[11px] text-strong shrink-0 mt-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-chalk/85 leading-snug">{s}</span>
                  </li>
                ))}
              </ol>
            </Spec>

            <Spec title="Quality rubric" tag="grading">
              <div className="space-y-1.5">
                {recipe?.quality_rubric.map((r) => (
                  <div key={r.number} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`font-mono text-xs tnum w-9 text-right ${
                        r.weight >= 0 ? "text-lock" : "text-rej"
                      }`}
                    >
                      {r.weight > 0 ? `+${r.weight}` : r.weight}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider px-1 rounded-sm bg-raise text-dim shrink-0">
                      {r.capability}
                    </span>
                    <span className="text-chalk/85 leading-snug">{r.criterion}</span>
                  </div>
                ))}
              </div>
            </Spec>
          </div>
        )}
      </div>
    </div>
  );
}

function Input({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Spec({ title, tag, children }: { title: string; tag: string; children: ReactNode }) {
  return (
    <section className="border border-rule rounded bg-bench">
      <header className="flex items-center justify-between px-4 h-9 border-b border-rule">
        <span className="font-display text-sm text-chalk">{title}</span>
        <span className="eyebrow">{tag}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Row({ k, v, accent }: { k: string; v: any; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline text-sm py-1 border-b border-rule/40 last:border-0">
      <span className="text-dim">{k}</span>
      <span className={`font-mono text-xs tnum ${accent ? "text-strong" : "text-chalk"}`}>{v ?? "—"}</span>
    </div>
  );
}
