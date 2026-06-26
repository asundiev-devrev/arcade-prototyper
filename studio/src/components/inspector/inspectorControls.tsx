import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";

// design-mode density: tiny uppercase label ABOVE a compact input, fields packed
// into grid rows rather than one full-width row each.
export const LABEL_ABOVE: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase",
  color: "var(--fg-neutral-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
export const INPUT_COMPACT: React.CSSProperties = {
  width: "100%", minWidth: 0, boxSizing: "border-box", height: 28, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)", fontSize: 12,
};
export const GRID_2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 };
export const GRID_4: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 };
// Kept for the rare full-width control (color values that need room).
export const FIELD_COL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };

export function toNumberInput(v: string): string { return v.endsWith("px") ? v.slice(0, -2) : v; }
export function fromNumberInput(v: string): string { return v === "" ? "" : `${v}px`; }
export function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}

export type ChangeFn = (key: keyof StyleSnapshot, rawValue: string) => void;

/** A labeled field: tiny uppercase label above its control. */
export function Field({ label, htmlFor, children }: {
  label: string; htmlFor?: string; children: ReactNode;
}) {
  return (
    <div style={FIELD_COL}>
      <label htmlFor={htmlFor} style={LABEL_ABOVE}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Numeric field, label above. `label` is the accessible name (aria + association);
 * `displayLabel` overrides the visible caption when it should be shorter
 * (e.g. visible "Left" while the a11y name stays "Margin left").
 */
export function NumberField({ id, label, displayLabel, valuePx, onChange, placeholder, trailing }: {
  id: string; label: string; displayLabel?: string; valuePx: string;
  onChange: (px: string) => void; placeholder?: string; trailing?: ReactNode;
}) {
  // Local draft so the user can clear/edit freely; commit to px on blur/Enter.
  const [draft, setDraft] = useState<string>(toNumberInput(valuePx));
  useEffect(() => { setDraft(toNumberInput(valuePx)); }, [valuePx]);

  function commit() {
    const t = draft.trim();
    if (t === "") return;                       // empty → no edit
    const n = Number(t);
    if (!Number.isFinite(n)) { setDraft(toNumberInput(valuePx)); return; } // junk → revert
    onChange(`${n}px`);
  }

  const input = (
    <input id={id} type="text" inputMode="decimal" aria-label={label} style={INPUT_COMPACT}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
  );
  return (
    <Field label={displayLabel ?? label} htmlFor={id}>
      {trailing
        ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>{input}{trailing}</div>
        : input}
    </Field>
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
              height: 28, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12,
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
