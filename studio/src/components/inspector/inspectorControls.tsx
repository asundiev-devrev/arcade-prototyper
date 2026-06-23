import type { ReactNode } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";

export const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
export const COL_LABEL: React.CSSProperties = { width: 84, fontSize: 12, color: "var(--fg-neutral-medium)", flex: "none" };
export const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)", fontSize: 12,
};

export function toNumberInput(v: string): string { return v.endsWith("px") ? v.slice(0, -2) : v; }
export function fromNumberInput(v: string): string { return v === "" ? "" : `${v}px`; }
export function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}

export type ChangeFn = (key: keyof StyleSnapshot, rawValue: string) => void;

export function NumberField({ id, label, valuePx, onChange, placeholder }: {
  id: string; label: string; valuePx: string; onChange: (px: string) => void; placeholder?: string;
}) {
  return (
    <div style={FIELD_ROW}>
      <label htmlFor={id} style={COL_LABEL}>{label}</label>
      <input id={id} type="number" aria-label={label} style={INPUT}
        value={toNumberInput(valuePx)}
        placeholder={placeholder}
        onChange={(e) => onChange(fromNumberInput(e.target.value))} />
    </div>
  );
}

export function SegmentedToggle({ ariaLabel, options, value, onChange }: {
  ariaLabel: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg-neutral-soft)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={active}
            onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              height: 26, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12,
              background: active ? "var(--surface-overlay)" : "transparent",
              color: active ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
            }}>
            {o.icon}
            {!o.icon && o.label}
          </button>
        );
      })}
    </div>
  );
}
