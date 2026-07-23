import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { LoopState, Role } from "@/types";

/**
 * The five role bindings, rendered as Discord's member list.
 *
 * The mapping is not a costume: Discord's four presence states are exactly the four
 * states an agent can be in, so the dot means what the dot has always meant.
 *
 *   online  (green)  running right now in at least one loop
 *   idle    (yellow) has done work this run, currently between rounds
 *   dnd     (red)    failed
 *   offline (grey)   hasn't run yet
 *
 * The model name sits where Discord puts the custom status.
 */
const ROLES: { role: Role; agents: string[]; blurb: string }[] = [
  { role: "main", agents: [], blurb: "Autoresearch · folds feedback into the recipe" },
  { role: "challenger", agents: ["challenger"], blurb: "Writes question, reference, rubric" },
  { role: "weak", agents: ["weak"], blurb: "Should struggle" },
  { role: "strong", agents: ["strong"], blurb: "Should succeed" },
  { role: "judge", agents: ["verifier", "judge:weak", "judge:strong"], blurb: "Verifies, then scores every rollout" },
];

type Presence = "online" | "idle" | "dnd" | "offline";

const DOT: Record<Presence, string> = {
  online: "bg-accept",
  idle: "bg-idle",
  dnd: "bg-reject",
  offline: "bg-muted-foreground",
};
const WORD: Record<Presence, string> = {
  online: "running",
  idle: "between rounds",
  dnd: "failed",
  offline: "not started",
};

function presenceOf(loops: Record<string, LoopState>, keys: string[]): Presence {
  if (!keys.length) return "offline";
  let seen = false;
  let failed = false;
  for (const loop of Object.values(loops)) {
    for (const k of keys) {
      const st = loop.agents[k]?.status;
      if (!st) continue;
      if (st === "running") return "online";
      if (st === "failed") failed = true;
      seen = true;
    }
  }
  if (failed) return "dnd";
  return seen ? "idle" : "offline";
}

export default function MemberList() {
  const { roles, loops, recipe, runStatus } = useStore();

  const rows = ROLES.map(({ role, agents, blurb }) => {
    // `main` never walks the loop — it runs autoresearch and the feedback fold — so
    // the loop's vocabulary ("running", "between rounds") would be a lie about it.
    if (role === "main") {
      const presence: Presence = recipe ? "online" : "offline";
      return {
        role,
        blurb,
        presence,
        word: recipe ? "ready" : "no recipe",
        binding: roles[role],
      };
    }
    const presence = presenceOf(loops, agents);
    return { role, blurb, presence, word: WORD[presence], binding: roles[role] };
  });

  const active = rows.filter((r) => r.presence !== "offline").length;

  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto bg-sidebar px-2 py-4 xl:block">
      <h2 className="channel-label mb-2 px-2">
        Roles — {active}/{rows.length}
      </h2>
      <ul className="space-y-0.5">
        {rows.map(({ role, blurb, presence, word, binding }) => (
          <li key={role}>
            <div
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover"
              title={blurb}
            >
              <span className="relative shrink-0">
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-xs font-bold uppercase",
                    role === "weak"
                      ? "border-2 border-weak text-weak"
                      : role === "strong"
                        ? "bg-strong text-white"
                        : "bg-active text-foreground"
                  )}
                >
                  {role[0]}
                </span>
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-sidebar",
                    DOT[presence],
                    presence === "online" && "pulse-run"
                  )}
                />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-sm font-medium",
                    presence === "offline" ? "text-muted-foreground" : "text-foreground"
                  )}
                >
                  {role}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {binding.model}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{word}</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
