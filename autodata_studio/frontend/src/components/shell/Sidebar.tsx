import { useEffect, useState } from "react";
import {
  ChevronDown, Download, Hash, Plus, RotateCcw, Settings, Trash2, X, type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { GapMode } from "@/types";

export default function Sidebar({
  onOpenSettings,
  onStartRun,
}: {
  onOpenSettings: () => void;
  onStartRun: () => void;
}) {
  const { tab, recipe, roles } = useStore();

  return (
    <div className="flex w-60 shrink-0 flex-col bg-sidebar">
      {/* server header — the recipe on the bench */}
      <button className="flex h-12 shrink-0 items-center gap-1 border-b px-4 text-left transition-colors hover:bg-hover">
        <span className="truncate text-[15px] font-semibold text-heading">
          {recipe ? recipe.id.replace("rec_", "recipe ") : "No recipe"}
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </button>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {tab === "analyze" && <AnalyzeSidebar />}
        {tab === "curate" && <CurateSidebar onStartRun={onStartRun} />}
        {tab === "preview" && <PreviewSidebar />}
      </div>

      {/* user panel — Discord parks your own account here; ours is the main model */}
      <div className="flex shrink-0 items-center gap-2 bg-rail px-2 py-1.5">
        <span className="relative shrink-0">
          <span className="flex size-8 items-center justify-center rounded-full bg-active text-xs font-bold">
            M
          </span>
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-rail",
              recipe ? "bg-accept" : "bg-muted-foreground"
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-heading">main</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {roles.main.model}
          </span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
              <Settings className="size-4" />
              <span className="sr-only">Provider settings</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Provider settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ analyze --- */

function AnalyzeSidebar() {
  const {
    recipes, loadRecipes, openRecipe, recipe, setRecipe,
    trashed, purged, trashRecipe, restoreRecipe, purgeRecipe,
  } = useStore();
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes, recipe?.id]);

  // Purged recipes still come back from GET /api/recipes — the backend never lost them.
  // Filtering here is the only thing keeping them out of sight.
  const listed = recipes.filter((r) => !trashed.includes(r.id) && !purged.includes(r.id));
  const inTrash = recipes.filter((r) => trashed.includes(r.id));

  const nameOf = (r: any) => (r.task ? r.task.slice(0, 28) : r.id);

  return (
    <>
      <Category label={`Recipes — ${listed.length}`}>
        <ChannelRow
          icon={<Plus className="size-4" />}
          label="New recipe"
          onClick={() => setRecipe(null as any, null)}
          muted
        />
        {listed.map((r) => (
          <ChannelRow
            key={r.id}
            label={nameOf(r)}
            sub={r.id.replace("rec_", "")}
            active={recipe?.id === r.id}
            onClick={() => openRecipe(r.id)}
            actions={[
              {
                icon: <Trash2 className="size-3.5" />,
                label: `Move ${nameOf(r)} to trash`,
                onClick: () => trashRecipe(r.id),
              },
            ]}
          />
        ))}
        {listed.length === 0 && (
          <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
            No recipes here. Describe the task and the corpus on the right, then analyze the source.
          </p>
        )}
      </Category>

      {/* Pinned to the foot of the sidebar: a bin you have to scroll 40 recipes to find
          is not a bin. Collapsed it is a one-line strip; open it grows upward. */}
      <div className="sticky bottom-0 -mx-2 mt-2 border-t bg-sidebar px-2 pb-1">
        <Category label={`Trash — ${inTrash.length}`} defaultOpen={false} icon={Trash2}>
          <div className="max-h-64 overflow-y-auto">
            {inTrash.length === 0 ? (
              <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
                Empty. Recipes you remove land here, and can be put back.
              </p>
            ) : (
              inTrash.map((r) => (
                <ChannelRow
                  key={r.id}
                  label={nameOf(r)}
                  sub={r.id.replace("rec_", "")}
                  muted
                  actions={[
                    {
                      icon: <RotateCcw className="size-3.5" />,
                      label: `Restore ${nameOf(r)}`,
                      onClick: () => restoreRecipe(r.id),
                    },
                    {
                      icon: <X className="size-3.5" />,
                      label: `Delete ${nameOf(r)} permanently`,
                      danger: true,
                      onClick: () => setConfirm(r.id),
                    },
                  ]}
                />
              ))
            )}
          </div>
        </Category>
      </div>

      <PurgeDialog
        id={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) purgeRecipe(confirm);
          setConfirm(null);
        }}
      />
    </>
  );
}

/**
 * Permanent deletion, stated honestly.
 *
 * The API has no DELETE endpoint, so this cannot remove the recipe from the backend —
 * it only stops this browser from ever listing it again. Saying "deleted" flat out
 * would be a lie, and the user would find out the hard way on another machine.
 */
function PurgeDialog({
  id,
  onCancel,
  onConfirm,
}: {
  id: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this recipe permanently?</DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4">
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            This hides the recipe for good in this browser — it will not come back from the trash.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            It does <span className="font-semibold text-foreground">not</span> delete the recipe
            from the backend. AutoData's API has no delete endpoint, so the recipe stays in the
            database and will be listed again in a different browser, or if you clear this site's
            data.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" className="ml-auto" onClick={onConfirm}>
            Hide permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- curate --- */

function CurateSidebar({ onStartRun }: { onStartRun: () => void }) {
  const { gap, setGap, targetN, setTargetN, recipe, runId, runStatus, openRun } = useStore();
  const running = runStatus === "running";
  const thresholds = gap.mode === "rubric_threshold";

  return (
    <>
      <OpenRun
        onOpen={(id) => openRun(id, "curate")}
        activeRunId={runId}
      />

      <Category label="Acceptance rule" />
      <div className="px-2 pb-3">
        <Select value={gap.mode} onValueChange={(v) => setGap({ mode: v as GapMode })}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rubric_threshold">rubric_threshold</SelectItem>
            <SelectItem value="verifiable">verifiable</SelectItem>
            <SelectItem value="flexible_judge">flexible_judge</SelectItem>
          </SelectContent>
        </Select>

        {thresholds && (
          <div className="mt-4">
            <Knob label="weak ceiling" v={gap.weak_ceiling} set={(x) => setGap({ weak_ceiling: x })} tint="weak" />
            <Knob label="strong floor" v={gap.strong_floor} set={(x) => setGap({ strong_floor: x })} tint="strong" />
            <Knob label="min gap" v={gap.min_gap} set={(x) => setGap({ min_gap: x })} />
          </div>
        )}
        {gap.mode === "verifiable" && (
          <div className="mt-4">
            <Num label="weak max correct" v={gap.weak_max_correct} set={(x) => setGap({ weak_max_correct: x })} />
            <Num label="strong min correct" v={gap.strong_min_correct} set={(x) => setGap({ strong_min_correct: x })} />
          </div>
        )}
        {gap.mode === "flexible_judge" && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            No fixed thresholds — the judge reads the rollout pattern and decides each round.
          </p>
        )}
      </div>

      <Category label="Rollouts" />
      <div className="px-2 pb-3">
        <Num label="weak · k" v={gap.k_weak} set={(x) => setGap({ k_weak: x })} />
        <Num label="strong · k" v={gap.k_strong} set={(x) => setGap({ k_strong: x })} />
        <Num label="step budget" v={gap.step_budget} set={(x) => setGap({ step_budget: x })} />
        <Num label="target accepted · N" v={targetN} set={setTargetN} />
      </div>

      <div className="px-2 pt-1">
        <Button className="w-full" onClick={onStartRun} disabled={running || !recipe}>
          {running ? "Running…" : "Start curation run"}
        </Button>
        {runId && running && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5 w-full text-reject hover:text-reject"
            onClick={() => api.cancelRun(runId)}
          >
            Cancel run
          </Button>
        )}
        {!recipe && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Analyze a source first — a run needs a recipe.
          </p>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ preview --- */

function PreviewSidebar() {
  const { examples, runId, openRun } = useStore();

  return (
    <>
      <OpenRun onOpen={openRun} activeRunId={runId} />

      {runId && examples.length > 0 && (
        <div className="mt-2 px-2">
          <Button variant="secondary" size="sm" className="w-full" asChild>
            <a href={api.exportUrl(runId)}>
              <Download className="size-4" />
              Export JSONL
            </a>
          </Button>
        </div>
      )}

    </>
  );
}

function OpenRun({
  onOpen,
  activeRunId,
}: {
  onOpen: (id: string) => Promise<void>;
  activeRunId: string | null;
}) {
  const [runs, setRuns] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    const refresh = () => api.listRuns()
      .then((rows) => live && setRuns(rows))
      .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  return (
    <div>
      <Category label={`Generation tasks — ${runs.length}`}>
        {runs.map((run) => (
          <ChannelRow
            key={run.id}
            label={run.id}
            mono
            active={activeRunId === run.id}
            dot={
              run.status === "done"
                ? "bg-accept"
                : run.status === "running"
                  ? "bg-idle"
                  : "bg-reject"
            }
            onClick={() => onOpen(run.id).catch(() => setErr("Could not open that run."))}
          />
        ))}
        {!runs.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No generation tasks yet.</p>
        )}
      </Category>
      {err && <p className="px-2 py-1.5 text-xs text-reject">{err}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------- parts --- */

/** Discord's channel category: click the label to collapse the group under it. */
function Category({
  label,
  children,
  defaultOpen = true,
  icon: Icon,
}: {
  label: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <button
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="channel-label flex w-full items-center gap-1 px-2 pt-2 pb-1.5 transition-colors hover:text-foreground"
    >
      <ChevronDown
        className={cn("size-3 shrink-0 transition-transform", !open && "-rotate-90")}
        aria-hidden
      />
      {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{label}</span>
    </button>
  );

  // Used both as a plain heading (no children) and as a collapsible group.
  if (children === undefined) return header;
  return (
    <div>
      {header}
      {open && children}
    </div>
  );
}

type RowAction = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
};

/**
 * A channel row. Actions live behind hover/focus like Discord's, so the list stays
 * quiet — but they are real buttons, so they are reachable by keyboard too.
 */
function ChannelRow({
  label,
  sub,
  icon,
  dot,
  right,
  active,
  muted,
  mono,
  onClick,
  actions,
}: {
  label: string;
  sub?: string;
  icon?: React.ReactNode;
  dot?: string;
  right?: string;
  active?: boolean;
  muted?: boolean;
  mono?: boolean;
  onClick?: () => void;
  actions?: RowAction[];
}) {
  return (
    <div
      className={cn(
        "group mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-active text-heading" : "text-muted-foreground hover:bg-hover"
      )}
    >
      <button
        onClick={onClick}
        disabled={!onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-left",
          onClick && "cursor-pointer group-hover:text-foreground"
        )}
      >
        {dot ? (
          <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
        ) : (
          <span className="shrink-0">{icon ?? <Hash className="size-4" />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[15px] leading-tight",
              mono && "font-mono text-xs",
              muted && "text-muted-foreground"
            )}
          >
            {label}
          </span>
          {sub && (
            <span className="block truncate font-mono text-[10px] text-muted-foreground">{sub}</span>
          )}
        </span>
      </button>

      {right && (
        <span className="shrink-0 font-mono tnum text-xs text-muted-foreground">{right}</span>
      )}

      {actions?.map((a) => (
        <Tooltip key={a.label}>
          <TooltipTrigger asChild>
            <button
              onClick={a.onClick}
              aria-label={a.label}
              className={cn(
                "shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
                a.danger
                  ? "text-muted-foreground hover:text-reject"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {a.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{a.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function Knob({
  label,
  v,
  set,
  tint,
}: {
  label: string;
  v: number;
  set: (x: number) => void;
  tint?: "weak" | "strong";
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono tnum text-xs text-foreground">{v.toFixed(2)}</span>
      </div>
      <Slider min={0} max={1} step={0.01} tint={tint} value={[v]} onValueChange={([x]) => set(x)} aria-label={label} />
    </div>
  );
}

function Num({ label, v, set }: { label: string; v: number; set: (x: number) => void }) {
  return (
    <label className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={v}
        onChange={(e) => set(parseInt(e.target.value) || 0)}
        className="h-7 w-16 px-2 text-right font-mono tnum text-xs"
      />
    </label>
  );
}
