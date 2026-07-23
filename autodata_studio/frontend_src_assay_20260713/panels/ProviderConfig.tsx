import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { ProviderKind, Role, RoleBinding } from "@/types";

const ROLES: Role[] = ["main", "challenger", "weak", "strong", "judge"];
const PROVIDERS: ProviderKind[] = ["mock", "openai_compat", "anthropic"];

const HINT: Record<Role, string> = {
  main: "Orchestrates autoresearch and folds your feedback back into the recipe.",
  challenger: "Writes the question, the reference answer, and the rubric.",
  weak: "Should struggle.",
  strong: "Should succeed.",
  judge: "Verifies quality, then scores every rollout against the rubric.",
};

/**
 * Role bindings live in this browser (localStorage "autodata.roles"). The `main`
 * binding is also sent with createRecipe — that is what makes autoresearch run on a
 * real model instead of the mock. See SourceAnalysisPanel.
 */
export default function ProviderConfig({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { roles, setRole } = useStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Provider bindings</DialogTitle>
          <DialogDescription>
            One model per role. Saved to this browser. <span className="font-mono">mock</span> needs
            no endpoint and runs the whole bench offline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-auto p-5">
          {ROLES.map((role) => (
            <RoleRow key={role} role={role} binding={roles[role]} onChange={(b) => setRole(role, b)} />
          ))}
        </div>

        <DialogFooter>
          <p className="text-xs text-muted-foreground">
            Bindings apply to the next run. A run in flight keeps the models it started with.
          </p>
          <Button className="ml-auto" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleRow({
  role,
  binding: b,
  onChange,
}: {
  role: Role;
  binding: RoleBinding;
  onChange: (b: Partial<RoleBinding>) => void;
}) {
  return (
    <section className="rounded-md border bg-background">
      <header className="flex items-baseline gap-2.5 border-b px-3 py-2">
        {(role === "weak" || role === "strong") && (
          <span
            className={cn(
              "size-2 shrink-0 self-center rounded-full",
              role === "weak" ? "border-2 border-weak" : "bg-strong"
            )}
          />
        )}
        <span className="headline text-sm capitalize">{role}</span>
        <span className="text-xs text-muted-foreground">{HINT[role]}</span>
      </header>

      <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
        <Field label="Provider">
          <Select value={b.provider} onValueChange={(v) => onChange({ provider: v as ProviderKind })}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} className="font-mono">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Model">
          <Input
            className="h-8 font-mono"
            value={b.model}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </Field>

        <Field label="Base URL">
          <Input
            className="h-8 font-mono"
            placeholder="http://localhost:8001/v1"
            value={b.base_url ?? ""}
            onChange={(e) => onChange({ base_url: e.target.value })}
          />
        </Field>

        <Field label="API key env var">
          <Input
            className="h-8 font-mono"
            placeholder="OPENAI_API_KEY"
            value={b.api_key_env ?? ""}
            onChange={(e) => onChange({ api_key_env: e.target.value })}
          />
        </Field>

        <Field label="Temperature">
          <Input
            type="number"
            step="0.1"
            className="h-8 font-mono tnum"
            value={b.temperature}
            onChange={(e) => onChange({ temperature: parseFloat(e.target.value) || 0 })}
          />
        </Field>

        <Field label="Max tokens">
          <Input
            type="number"
            className="h-8 font-mono tnum"
            value={b.max_tokens}
            onChange={(e) => onChange({ max_tokens: parseInt(e.target.value) || 0 })}
          />
        </Field>

        <Toggle
          label="Vision"
          hint={b.is_vlm ? "Sends images" : "Text only"}
          checked={b.is_vlm}
          onChange={(v) => onChange({ is_vlm: v })}
        />

        <Toggle
          label="Thinking"
          hint={b.enable_thinking ? "Qwen3 thinking on" : "Off"}
          checked={b.enable_thinking}
          onChange={(v) => onChange({ enable_thinking: v })}
        />
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="faceplate">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="faceplate">{label}</span>
      <label className="flex h-8 cursor-pointer items-center gap-2">
        <Switch checked={checked} onCheckedChange={onChange} />
        <span className="text-xs text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}
