import { ClipboardCheck, FlaskConical, Microscope, Settings, type LucideIcon } from "lucide-react";

import ThemeToggle from "@/components/ThemeToggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

/** A document is read, then curated, then reviewed — the rail is that order. */
export const STAGES: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "analyze", label: "Analyze", Icon: Microscope },
  { id: "curate", label: "Curate", Icon: FlaskConical },
  { id: "preview", label: "Preview", Icon: ClipboardCheck },
];

export default function Rail({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { tab, setTab, runStatus, accepted } = useStore();

  return (
    <nav
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-rail py-3"
      aria-label="Stages"
    >
      <RailItem
        label="AutoData Studio"
        active={false}
        onClick={() => setTab("analyze")}
        home
      >
        <Logo />
      </RailItem>

      <span className="my-1 h-0.5 w-8 rounded-full bg-border" aria-hidden />

      {STAGES.map(({ id, label, Icon }) => (
        <RailItem
          key={id}
          label={label}
          active={tab === id}
          onClick={() => setTab(id)}
          badge={id === "curate" && runStatus === "running" ? accepted || undefined : undefined}
        >
          <Icon className="size-6" />
        </RailItem>
      ))}

      <div className="mt-auto flex flex-col items-center gap-2">
        <ThemeToggle />
        <RailItem label="Provider settings" active={false} onClick={onOpenSettings} small>
          <Settings className="size-5" />
        </RailItem>
      </div>
    </nav>
  );
}

/**
 * A rail icon. Discord's tell is the left pill: a nub at rest, growing on hover,
 * full height when active — and the squircle squaring off as it activates.
 */
function RailItem({
  label,
  active,
  onClick,
  children,
  badge,
  home,
  small,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  home?: boolean;
  small?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group relative flex items-center justify-center">
          <span
            className={cn(
              "absolute -left-3 w-1 rounded-r-full bg-heading transition-all duration-200",
              active ? "rail-pill h-10" : "h-2 scale-0 group-hover:scale-100"
            )}
            aria-hidden
          />
          <button
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center justify-center transition-all duration-200",
              small ? "size-10" : "size-12",
              "rounded-[24px] group-hover:rounded-[16px]",
              active
                ? "rounded-[16px] bg-primary text-primary-foreground"
                : home
                  ? "bg-elevated text-foreground group-hover:bg-primary group-hover:text-primary-foreground"
                  : "bg-elevated text-foreground group-hover:bg-primary group-hover:text-primary-foreground"
            )}
          >
            {children}
            <span className="sr-only">{label}</span>
          </button>
          {badge != null && (
            <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-[3px] border-rail bg-accept px-1 font-mono tnum text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The wordmark is the product: a hollow weak mark and a filled strong mark, held apart. */
function Logo() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      <span className="size-2 rounded-full border-2 border-weak" />
      <span className="size-2 rounded-full bg-strong" />
    </span>
  );
}
