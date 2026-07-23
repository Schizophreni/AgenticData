import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

import Embed from "@/components/Embed";
import ChannelHeader from "@/components/shell/ChannelHeader";
import { Button } from "@/components/ui/button";
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
    <div className="flex h-full min-w-0 flex-1 flex-col bg-chat">
      <ChannelHeader
        name="analyze"
        topic="Read the source, then draft the recipe that manufactures data from it"
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-6 py-6">
          {/* the composer, styled as Discord's message box */}
          <div className="rounded-lg bg-input p-4">
            <label className="block">
              <span className="channel-label mb-1.5 block">Task</span>
              <Textarea
                rows={2}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                className="border-0 bg-elevated"
              />
            </label>
            <label className="mt-3 block">
              <span className="channel-label mb-1.5 block">Data path</span>
              <Input
                className="border-0 bg-elevated font-mono text-xs"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-muted-foreground">
                Point at the corpus directory itself. A parent directory profiles as empty and the
                run silently falls back to synthetic documents.
              </span>
            </label>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={analyze} disabled={busy}>
                {busy ? "Analyzing…" : "Analyze source"}
              </Button>
              {recipe && (
                <Button variant="secondary" onClick={() => setTab("curate")}>
                  Go to curation <ArrowRight />
                </Button>
              )}
              {err && <span className="font-mono text-sm text-reject">{err}</span>}
            </div>
          </div>

          {synthetic && (
            <Embed accent="reject" className="mt-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-reject" />
                <div className="text-sm">
                  <p className="font-semibold text-reject">This recipe is not reading your corpus.</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {profile.path_exists === false
                      ? "The data path does not exist on the backend host."
                      : "The path exists but no documents were found in it."}{" "}
                    The run will curate <span className="text-foreground">synthetic</span> documents
                    and the output will not be about your data. Fix the path, then analyze again.
                  </p>
                </div>
              </div>
            </Embed>
          )}

          {/* The profile only exists for a recipe analyzed in this session — GET
              /api/recipes/{id} returns the recipe alone, so these two render apart. */}
          {(profile || recipe) && (
            <div className="mt-4 space-y-3">
              {profile && (
                <Embed accent="none">
                  <EmbedTitle>Source profile</EmbedTitle>
                  <div className="mt-2 grid grid-cols-2 gap-x-6">
                    <Row k="modality" v={profile.modality} />
                    <Row k="sampled docs" v={profile.sampled_docs} />
                    <Row k="path exists" v={String(profile.path_exists)} bad={profile.path_exists === false} />
                    <Row k="images / doc · median" v={profile.images_per_doc?.median} />
                    <Row
                      k="synthetic fallback"
                      v={String(profile.using_synthetic_fallback)}
                      bad={!!profile.using_synthetic_fallback}
                    />
                    <Row k="multi-image fraction" v={profile.multi_image_fraction} />
                  </div>
                </Embed>
              )}

              {recipe && (
                <>
                  <Embed accent="none">
                    <EmbedTitle>Quality standards</EmbedTitle>
                    <ul className="mt-2 space-y-2">
                      {recipe.brief.map((b, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-snug">
                          <span
                            className={cn(
                              "mt-px h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                              b.confidence === "high"
                                ? "bg-accept/15 text-accept"
                                : "bg-secondary text-muted-foreground"
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
                  </Embed>

                  <Embed accent="none">
                    <EmbedTitle>Processing pipeline</EmbedTitle>
                    <ol className="mt-2 space-y-1.5">
                      {recipe.pipeline_spec.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-sm">
                          <span className="mt-px shrink-0 font-mono tnum text-[11px] text-muted-foreground">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="leading-snug text-foreground">{s}</span>
                        </li>
                      ))}
                    </ol>
                  </Embed>

                  <Embed accent="none">
                    <EmbedTitle>Quality rubric · {recipe.quality_rubric.length} criteria</EmbedTitle>
                    <div className="mt-2 space-y-1">
                      {recipe.quality_rubric.map((r) => (
                        <div key={r.number} className="flex items-baseline gap-2.5 text-sm">
                          <span
                            className={cn(
                              "w-7 shrink-0 text-right font-mono tnum text-xs",
                              r.weight >= 0 ? "text-accept" : "text-reject"
                            )}
                          >
                            {r.weight > 0 ? `+${r.weight}` : r.weight}
                          </span>
                          <span className="shrink-0 rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
                            {r.capability}
                          </span>
                          <span className="leading-snug text-foreground">{r.criterion}</span>
                        </div>
                      ))}
                    </div>
                  </Embed>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmbedTitle({ children }: { children: ReactNode }) {
  return <div className="text-sm font-semibold text-heading">{children}</div>;
}

function Row({ k, v, bad }: { k: string; v: any; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-mono tnum text-xs", bad ? "text-reject" : "text-foreground")}>
        {v ?? "—"}
      </span>
    </div>
  );
}
