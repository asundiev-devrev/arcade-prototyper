import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import { NumberField, Field, fieldValue, INPUT_COMPACT, GRID_2, type ChangeFn } from "./inspectorControls";

export function AppearanceSection({ styles, pending, change }: {
  styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn;
}) {
  const opacityRaw = fieldValue(styles, pending, "opacity");
  const pct = Math.round((parseFloat(opacityRaw) || 0) * 100);
  return (
    <div style={GRID_2}>
      <Field label="Opacity %" htmlFor="ins-opacity">
        <input id="ins-opacity" type="number" aria-label="Opacity" min={0} max={100} style={INPUT_COMPACT}
          value={String(pct)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            const clamped = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
            change("opacity", String(clamped / 100));
          }} />
      </Field>
      <NumberField id="ins-radius" label="Corner radius" displayLabel="Radius"
        valuePx={fieldValue(styles, pending, "borderRadius")} onChange={(v) => change("borderRadius", v)} />
    </div>
  );
}
