import { useState, type ReactNode } from "react";
import { AlertTriangleIcon, ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DEFAULT_DATA_PATH, useStore } from "@/store";

export default function SourceAnalysisPanel() {
  const { recipe, profile, setRecipe, setTab, roles } = useStore();
  const [task, setTask] = useState(
    "Build multi-image QA that tests cross-figure reasoning over Zhihu technical answers"
  );
  const [dataPath, setDataPath] = useState(DEFAULT_DATA_PATH);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function analyze() {
    setBusy(true);
    setErr("");
    try {
      // `main` rides along so autoresearch runs on the bound model, not the mock.
      const res = await api.createRecipe({
        task,
        data_path: dataPath,
        do_autoresearch: true,
        main: roles.main,
      });
      setRecipe(res.recipe, res.profile);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const synthetic = profile && (profile.using_synthetic_fallback || profile.path_exists === false);

  return (
    <div className="h-full overflow-auto bench-grid">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="faceplate mb-3">stage 01 · source calibration</div>
        <h1 className="headline max-w-2xl text-3xl leading-[1.15] text-foreground">
          Read the source before you manufacture anything from it.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Profile the corpus, research what counts as high-quality data for this task, and emit the
          pipeline plus the rubric the judge will grade against.
        </p>

        <Card className="mt-7">
          <CardContent className="space-y-4">
            <label className="block">
              <span className="faceplate mb-1.5 block">Task</span>
              <Textarea rows={2} value={task} onChange={(e) => setTask(e.target.value)} />
            </label>
            <label className="block">
              <span className="faceplate mb-1.5 block">Data path</span>
              <Input
                className="font-mono"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-muted-foreground">
                Point at the corpus directory itself. A parent directory profiles as empty and the
                run falls back to synthetic documents.
              </span>
            </label>
          </CardContent>
          <CardFooter>
            <Button onClick={analyze} disabled={busy}>
              {busy ? "Calibrating…" : "Analyze source"}
            </Button>
            {recipe && (
              <Button variant="outline" onClick={() => setTab("curate")}>
                Go to curation <ArrowRightIcon />
              </Button>
            )}
            {err && <span className="font-mono text-sm text-reject">{err}</span>}
          </CardFooter>
        </Card>

        {synthetic && (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-reject/40 bg-reject/5 p-4">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-reject" />
            <div className="text-sm">
              <p className="headline text-reject">This recipe is not reading your corpus.</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {profile.path_exists === false
                  ? "The data path does not exist on the backend host."
                  : "The path exists but no documents were found in it."}{" "}
                The run will curate <span className="text-foreground">synthetic</span> documents and
                the output will not be about your data. Check the path points at the corpus
                directory, then analyze again.
              </p>
            </div>
          </div>
        )}

        {profile && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Spec title="Source profile" tag="scan">
              <Row k="modality" v={profile.modality} />
              <Row k="path exists" v={String(profile.path_exists)} bad={profile.path_exists === false} />
              <Row
                k="synthetic fallback"
                v={String(profile.using_synthetic_fallback)}
                bad={!!profile.using_synthetic_fallback}
              />
              <Row k="sampled docs" v={profile.sampled_docs} />
              <Row k="images / doc · median" v={profile.images_per_doc?.median} />
              <Row k="multi-image fraction" v={profile.multi_image_fraction} />
            </Spec>

            <Spec title="Quality standards" tag="autoresearch">
              <ul className="space-y-2.5">
                {recipe?.brief.map((b, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-snug">
                    <span
                      className={cn(
                        "mt-px h-fit shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase",
                        b.confidence === "high"
                          ? "border-accept/40 text-accept"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {b.confidence}
                    </span>
                    <span className="text-foreground">
                      {b.claim}
                      {b.source && <span className="text-muted-foreground"> · {b.source}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Spec>

            <Spec title="Processing pipeline" tag="funnel">
              <ol className="space-y-2">
                {recipe?.pipeline_spec.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-px shrink-0 font-mono tnum text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="leading-snug text-foreground">{s}</span>
                  </li>
                ))}
              </ol>
            </Spec>

            <Spec title="Quality rubric" tag="grading">
              <div className="space-y-1.5">
                {recipe?.quality_rubric.map((r) => (
                  <div key={r.number} className="flex items-baseline gap-2.5 text-sm">
                    <span
                      className={cn(
                        "w-8 shrink-0 text-right font-mono tnum text-xs",
                        r.weight >= 0 ? "text-accept" : "text-reject"
                      )}
                    >
                      {r.weight > 0 ? `+${r.weight}` : r.weight}
                    </span>
                    <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                      {r.capability}
                    </span>
                    <span className="leading-snug text-foreground">{r.criterion}</span>
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

function Spec({ title, tag, children }: { title: string; tag: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="faceplate ml-auto">{tag}</span>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ k, v, bad }: { k: string; v: any; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-mono tnum text-xs", bad ? "text-reject" : "text-foreground")}>
        {v ?? "—"}
      </span>
    </div>
  );
}
