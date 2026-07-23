import { useState } from "react";
import { useStore } from "./store";
import SourceAnalysisPanel from "./panels/SourceAnalysisPanel";
import CurationLoopPanel from "./panels/CurationLoopPanel";
import PreviewFeedbackPanel from "./panels/PreviewFeedbackPanel";
import ProviderConfig from "./panels/ProviderConfig";

const TABS = [
  { id: "analysis", n: "01", label: "Analyze" },
  { id: "loop", n: "02", label: "Curate" },
  { id: "preview", n: "03", label: "Preview" },
];

export default function App() {
  const { tab, setTab, recipe, runStatus, accepted, rejected, targetN } = useStore();
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="h-full flex flex-col bg-abyss">
      <header className="flex items-stretch border-b border-rule bg-bench">
        {/* wordmark */}
        <div className="flex items-center gap-3 pl-5 pr-6 border-r border-rule">
          <div className="relative w-4 h-4">
            <span className="absolute inset-0 rounded-full bg-weak" style={{ boxShadow: "0 0 10px -1px #33D1E6" }} />
            <span className="absolute inset-0 rounded-full bg-strong translate-x-1.5" style={{ boxShadow: "0 0 10px -1px #F4A63A", mixBlendMode: "screen" }} />
          </div>
          <div className="leading-none">
            <div className="font-display font-bold tracking-tight text-[15px] text-chalk">
              AUTODATA<span className="text-strong"> ·</span> STUDIO
            </div>
            <div className="eyebrow mt-1">agentic self-instruct bench</div>
          </div>
        </div>

        {/* numbered pipeline nav */}
        <nav className="flex">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`group relative px-5 flex items-center gap-2.5 border-r border-rule transition-colors ${
                  active ? "bg-bench2" : "hover:bg-bench2/50"
                }`}
              >
                <span className={`font-mono text-[11px] ${active ? "text-strong" : "text-faint"}`}>{t.n}</span>
                <span className={`font-display text-sm ${active ? "text-chalk" : "text-dim"}`}>{t.label}</span>
                {active && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-strong" />}
              </button>
            );
          })}
        </nav>

        {/* telemetry */}
        <div className="ml-auto flex items-center gap-5 pr-4">
          {recipe && (
            <div className="hidden md:block text-right">
              <div className="eyebrow">recipe</div>
              <div className="font-mono text-xs text-weak">{recipe.id.slice(0, 14)}</div>
            </div>
          )}
          {runStatus !== "idle" && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-sm border border-rule bg-abyss">
              <span
                className={`w-2 h-2 rounded-full ${runStatus === "running" ? "bg-strong led-run text-strong" : "bg-lock"}`}
              />
              <span className="eyebrow">{runStatus}</span>
              <span className="font-mono text-sm tnum">
                <span className="text-lock">{accepted}</span>
                <span className="text-faint">/{targetN}</span>
              </span>
              {rejected > 0 && <span className="font-mono text-xs text-rej tnum">−{rejected}</span>}
            </div>
          )}
          <button
            onClick={() => setShowConfig(true)}
            className="px-3 py-1.5 rounded-sm border border-rule text-dim hover:text-chalk hover:border-strong/50 text-xs font-mono transition-colors"
          >
            providers
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden bg-bench-grid" style={{ backgroundSize: "32px 32px" }}>
        {tab === "analysis" && <SourceAnalysisPanel />}
        {tab === "loop" && <CurationLoopPanel />}
        {tab === "preview" && <PreviewFeedbackPanel />}
      </main>

      {showConfig && <ProviderConfig onClose={() => setShowConfig(false)} />}
    </div>
  );
}
