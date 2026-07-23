import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";

import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import CurationLoopPanel from "@/panels/CurationLoopPanel";
import PreviewFeedbackPanel from "@/panels/PreviewFeedbackPanel";
import ProviderConfig from "@/panels/ProviderConfig";
import SourceAnalysisPanel from "@/panels/SourceAnalysisPanel";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

/** A document is read, then curated, then reviewed. The order is the process, so it is numbered. */
const STAGES = [
  { id: "analyze", n: "01", label: "Analyze" },
  { id: "curate", n: "02", label: "Curate" },
  { id: "preview", n: "03", label: "Preview" },
];

export default function App() {
  const { tab, setTab, recipe, runStatus, accepted, rejected, targetN } = useStore();
  const [config, setConfig] = useState(false);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-stretch border-b bg-card">
        <div className="flex items-center gap-3 border-r pr-6 pl-5">
          <Mark />
          <div>
            <div className="headline text-[15px] leading-none text-foreground">AUTODATA</div>
            <div className="faceplate mt-1.5">assay bench</div>
          </div>
        </div>

        <nav className="flex items-center" aria-label="Stages">
          {STAGES.map((s, i) => {
            const active = tab === s.id;
            return (
              <div key={s.id} className="flex h-full items-center">
                <button
                  onClick={() => setTab(s.id)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "relative flex h-full items-center gap-2 px-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    active ? "bg-background" : "hover:bg-accent/50"
                  )}
                >
                  <span
                    className={cn(
                      "font-mono tnum text-[11px]",
                      active ? "text-foreground" : "text-muted-foreground/70"
                    )}
                  >
                    {s.n}
                  </span>
                  <span
                    className={cn(
                      "headline text-sm",
                      active ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {s.label}
                  </span>
                  {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />}
                </button>
                {i < STAGES.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4 pr-3 pl-4">
          {recipe && (
            <div className="hidden text-right lg:block">
              <div className="faceplate">recipe</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {recipe.id.slice(0, 14)}
              </div>
            </div>
          )}

          {runStatus !== "idle" && (
            <div className="flex items-center gap-2.5 rounded-md border px-3 py-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  runStatus === "running" ? "bg-foreground pulse-run" : "bg-accept"
                )}
              />
              <span className="faceplate">{runStatus}</span>
              <span className="font-mono tnum text-sm text-foreground">
                {accepted}
                <span className="text-muted-foreground">/{targetN}</span>
              </span>
              {rejected > 0 && (
                <span className="font-mono tnum text-xs text-muted-foreground">−{rejected}</span>
              )}
            </div>
          )}

          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={() => setConfig(true)}>
            <SlidersHorizontalIcon />
            Providers
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {tab === "analyze" && <SourceAnalysisPanel />}
        {tab === "curate" && <CurationLoopPanel />}
        {tab === "preview" && <PreviewFeedbackPanel />}
      </main>

      <ProviderConfig open={config} onOpenChange={setConfig} />
    </div>
  );
}

/**
 * The wordmark IS the product: a hollow weak mark and a filled strong mark, held
 * apart. The empty space between them is the gap the whole bench manufactures.
 */
function Mark() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      <span className="size-2.5 rounded-full border-2 border-weak" />
      <span className="h-px w-2 bg-border" />
      <span className="size-2.5 rounded-full bg-strong" />
    </span>
  );
}
