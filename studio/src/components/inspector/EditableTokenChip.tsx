import { useState } from "react";
import { INPUT_COMPACT } from "./inspectorControls";
import { TokenSelect } from "./TokenSelect";

export function EditableTokenChip({
  ariaLabel, tokenValue, tokenOptions, rawValue, onPickToken, onRawChange,
  swatch, rawEnabled = true, placeholder,
}: {
  ariaLabel: string;
  tokenValue: string | null;
  tokenOptions: { value: string; label: string }[];
  rawValue: string;
  onPickToken: (value: string) => void;
  onRawChange: (raw: string) => void;
  swatch?: string;
  rawEnabled?: boolean;
  placeholder?: string;
}) {
  const [rawMode, setRawMode] = useState(false);

  if (rawMode && rawEnabled) {
    // Exit raw mode only when focus leaves the WHOLE chip. A plain onBlur on
    // the text field fired when focus moved to a sibling (the colour picker),
    // snapping back to token mode before the picker could open. Opening the OS
    // colour dialog blurs with relatedTarget null — also stay in raw mode then.
    const onChipBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return; // moved within the chip
      if (next === null) return; // OS colour dialog / window — keep editing
      setRawMode(false);
    };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }} onBlur={onChipBlur}>
        {/* Native OS colour picker, seeded from the current colour. The picker
         *  is hex-only; the text field beside it still accepts rgb()/rgba()
         *  (incl. alpha) for exact values. */}
        <input data-testid="token-chip-swatch" type="color"
          aria-label={`${ariaLabel} colour picker`}
          value={toHexColor(swatch ?? rawValue)}
          onInput={(e) => onRawChange((e.target as HTMLInputElement).value)}
          style={{
            width: 20, height: 24, flex: "none", padding: 0, cursor: "pointer",
            borderRadius: 4, border: "1px solid var(--stroke-neutral-subtle)",
            background: "transparent",
          }} />
        <input aria-label={`${ariaLabel} raw`} style={{ ...INPUT_COMPACT, flex: 1 }}
          autoFocus value={rawValue}
          onChange={(e) => onRawChange(e.target.value)} />
        <button type="button" aria-label={`${ariaLabel} use tokens`} title="Use a token"
          onClick={() => setRawMode(false)}
          style={iconBtn}>↤</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TokenSelect ariaLabel={ariaLabel} value={tokenValue} options={tokenOptions}
          onPick={onPickToken} placeholder={placeholder} swatch={swatch} />
      </div>
      {rawEnabled && (
        <button type="button" aria-label={`Edit ${ariaLabel} raw value`} title="Type a raw value"
          onClick={() => setRawMode(true)} style={iconBtn}>#</button>
      )}
    </div>
  );
}

/** Coerce a CSS colour string to the `#rrggbb` form `<input type="color">`
 *  requires. Handles rgb()/rgba() and #rgb/#rrggbb; alpha is dropped (the
 *  picker can't represent it). Returns #000000 for anything unparseable
 *  (e.g. "transparent", a var() chain, or empty). */
export function toHexColor(value: string): string {
  const v = (value ?? "").trim();
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toLowerCase();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex6) return `#${hex6[1].toLowerCase()}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) {
    const h = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return "#000000";
}

const iconBtn: React.CSSProperties = {
  width: 24, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--stroke-neutral-subtle)", borderRadius: 6, background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 12,
};
