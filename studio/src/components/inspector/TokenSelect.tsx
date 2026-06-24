import { INPUT_COMPACT } from "./inspectorControls";

export function TokenSelect({ options, value, onPick, ariaLabel, placeholder, swatch }: {
  options: { value: string; label: string }[];
  value: string | null;
  onPick: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** optional current swatch color (live-resolved) shown as a leading chip */
  swatch?: string;
}) {
  const ph = placeholder ?? "— (no token)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {swatch !== undefined && (
        <span data-testid="token-chip-swatch" aria-hidden="true" style={{
          width: 16, height: 16, flex: "none", borderRadius: 4,
          border: "1px solid var(--stroke-neutral-subtle)", background: swatch,
        }} />
      )}
      <select aria-label={ariaLabel} style={{ ...INPUT_COMPACT, flex: 1 }}
        value={value ?? ""}
        onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
        {value === null && <option value="">{ph}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
