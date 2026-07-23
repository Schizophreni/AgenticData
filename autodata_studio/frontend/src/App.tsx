import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import SelectionTranslate from "@/components/SelectionTranslate";
import MemberList from "@/components/shell/MemberList";
import Rail from "@/components/shell/Rail";
import Sidebar from "@/components/shell/Sidebar";
import CurationLoopPanel from "@/panels/CurationLoopPanel";
import PreviewFeedbackPanel from "@/panels/PreviewFeedbackPanel";
import ProviderConfig from "@/panels/ProviderConfig";
import SourceAnalysisPanel from "@/panels/SourceAnalysisPanel";
import { api } from "@/lib/api";
import { subscribeRun } from "@/lib/sse";
import { useStore } from "@/store";

export default function App() {
  const { tab, runId, recipe, roles, gap, targetN, startRun, applyEvent, openRun } = useStore();
  const [settings, setSettings] = useState(false);
  const [pipelineHealth, setPipelineHealth] = useState<any>(null);
  const unsub = useRef<null | (() => void)>(null);

  useEffect(() => () => unsub.current?.(), []);

  useEffect(() => {
    let live = true;
    const check = () => api.pipelineHealth()
      .then((health) => live && setPipelineHealth(health))
      .catch(() => live && setPipelineHealth(null));
    check();
    const timer = setInterval(check, 10_000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  // Preview should be useful immediately after opening the app. If no live run
  // is selected, load the newest persisted run (the MCQ import appears here).
  useEffect(() => {
    if (tab !== "preview" || runId) return;
    let live = true;
    // The synchronizer keeps this stable run current. Prefer it over "latest",
    // which may be a scratch/test run with no reviewable examples.
    openRun("run_mcq_live_merged").catch(() =>
      api.listRuns().then((runs) => {
        const latest = runs?.[0]?.id;
        if (live && latest) return openRun(latest);
      })
    ).catch(() => undefined);
    return () => { live = false; };
  }, [tab, runId, openRun]);

  /** Lives here, not in a panel: the Start button is in the sidebar, the board is in the stream. */
  async function onStartRun() {
    if (!recipe) return;
    const { run_id } = await api.createRun({
      recipe_id: recipe.id,
      roles,
      gap,
      target_n: targetN,
      max_inflight: 4,
    });
    startRun(run_id);
    unsub.current?.();
    unsub.current = subscribeRun(run_id, applyEvent);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {pipelineHealth && !pipelineHealth.ok && (
        <div className="fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-md border border-reject/40 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
          <AlertTriangle className="size-4 shrink-0 text-reject" />
          <span className="font-semibold text-reject">Model offline:</span>
          <span className="font-mono text-foreground">{pipelineHealth.down.join(", ")}</span>
          <span className="text-muted-foreground">
            generation paused at {pipelineHealth.pipeline?.accepted ?? "—"}/{pipelineHealth.pipeline?.target ?? "—"}
          </span>
        </div>
      )}
      <Rail onOpenSettings={() => setSettings(true)} />
      <Sidebar onOpenSettings={() => setSettings(true)} onStartRun={onStartRun} />

      {tab === "analyze" && <SourceAnalysisPanel />}
      {tab === "curate" && <CurationLoopPanel />}
      {tab === "preview" && <PreviewFeedbackPanel />}

      {tab === "curate" && <MemberList />}

      <ProviderConfig open={settings} onOpenChange={setSettings} />
      <SelectionTranslate onOpenSettings={() => setSettings(true)} />
    </div>
  );
}
