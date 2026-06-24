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
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {swatch !== undefined && (
          <span data-testid="token-chip-swatch" aria-hidden="true" style={{
            width: 16, height: 16, flex: "none", borderRadius: 4,
            border: "1px solid var(--stroke-neutral-subtle)", background: swatch,
          }} />
        )}
        <input aria-label={`${ariaLabel} raw`} style={{ ...INPUT_COMPACT, flex: 1 }}
          autoFocus value={rawValue}
          onChange={(e) => onRawChange(e.target.value)}
          onBlur={() => setRawMode(false)} />
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

const iconBtn: React.CSSProperties = {
  width: 24, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--stroke-neutral-subtle)", borderRadius: 6, background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 12,
};
