import type { ReactNode } from "react";
import { useStore } from "../store";
import type { ProviderKind, Role, RoleBinding } from "../types";

const ROLES: Role[] = ["main", "challenger", "weak", "strong", "judge"];
const PROVIDERS: ProviderKind[] = ["mock", "openai_compat", "anthropic"];
const ROLE_HINT: Record<Role, string> = {
  main: "orchestrator · autoresearch",
  challenger: "writes question + rubric",
  weak: "should struggle",
  strong: "should succeed",
  judge: "verifier + rubric scorer",
};
const ROLE_TINT: Record<Role, string> = {
  main: "text-chalk",
  challenger: "text-chalk",
  weak: "text-weak",
  strong: "text-strong",
  judge: "text-chalk",
};

const inputCls =
  "bg-abyss border border-rule rounded-sm px-2 py-1 text-sm text-chalk focus:border-strong/60 outline-none";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

export default function ProviderConfig({ onClose }: { onClose: () => void }) {
  const { roles, setRole } = useStore();

  const RoleRow = ({ role }: { role: Role }) => {
    const b: RoleBinding = roles[role];
    return (
      <div className="border border-rule rounded bg-bench">
        <div className="flex items-baseline gap-2.5 px-3 h-9 border-b border-rule/70">
          <span className={`font-display text-sm capitalize ${ROLE_TINT[role]}`}>{role}</span>
          <span className="eyebrow">{ROLE_HINT[role]}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
          <Field label="Provider">
            <select className={inputCls} value={b.provider} onChange={(e) => setRole(role, { provider: e.target.value as ProviderKind })}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input className={`${inputCls} font-mono`} value={b.model} onChange={(e) => setRole(role, { model: e.target.value })} />
          </Field>
          <Field label="Base URL · vLLM/OpenAI">
            <input className={`${inputCls} font-mono`} placeholder="http://localhost:8001/v1" value={b.base_url ?? ""} onChange={(e) => setRole(role, { base_url: e.target.value })} />
          </Field>
          <Field label="API key env var">
            <input className={`${inputCls} font-mono`} placeholder="OPENAI_API_KEY" value={b.api_key_env ?? ""} onChange={(e) => setRole(role, { api_key_env: e.target.value })} />
          </Field>
          <Field label="Temperature">
            <input type="number" step="0.1" className={`${inputCls} font-mono tnum`} value={b.temperature} onChange={(e) => setRole(role, { temperature: parseFloat(e.target.value) })} />
          </Field>
          <Field label="Max tokens">
            <input type="number" className={`${inputCls} font-mono tnum`} value={b.max_tokens} onChange={(e) => setRole(role, { max_tokens: parseInt(e.target.value) })} />
          </Field>
          <Field label="Vision">
            <button onClick={() => setRole(role, { is_vlm: !b.is_vlm })} className={`${inputCls} text-left font-mono ${b.is_vlm ? "text-lock" : "text-faint"}`}>
              {b.is_vlm ? "● images on" : "○ text only"}
            </button>
          </Field>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-abyss/80 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-bench border border-rule rounded w-full max-w-4xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 h-12 border-b border-rule sticky top-0 bg-bench">
          <span className="font-display text-chalk">Provider bindings</span>
          <span className="eyebrow">pluggable per role · mock needs no endpoint · saved to this browser</span>
          <button onClick={onClose} className="ml-auto px-3 py-1 rounded-sm border border-rule text-dim hover:text-chalk hover:border-strong/50 text-xs font-mono">
            done
          </button>
        </div>
        <div className="flex flex-col gap-3 p-5">
          {ROLES.map((r) => (
            <RoleRow key={r} role={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
