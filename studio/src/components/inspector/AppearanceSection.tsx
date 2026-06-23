import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import { NumberField, fieldValue, FIELD_ROW, COL_LABEL, INPUT, type ChangeFn } from "./inspectorControls";

export function AppearanceSection({ styles, pending, change }: {
  styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn;
}) {
  const opacityRaw = fieldValue(styles, pending, "opacity");
  const pct = Math.round((parseFloat(opacityRaw) || 0) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={FIELD_ROW}>
        <label htmlFor="ins-opacity" style={COL_LABEL}>Opacity</label>
        <input id="ins-opacity" type="number" aria-label="Opacity" min={0} max={100} style={INPUT}
          value={String(pct)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            const clamped = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
            change("opacity", String(clamped / 100));
          }} />
      </div>
      <NumberField id="ins-radius" label="Corner radius" valuePx={fieldValue(styles, pending, "borderRadius")} onChange={(v) => change("borderRadius", v)} />
    </div>
  );
}
