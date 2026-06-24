import { useState, useRef } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import {
  NumberField, SegmentedToggle, Field, fieldValue,
  GRID_2, GRID_4, type ChangeFn,
} from "./inspectorControls";

const ICON = (path: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);
// Minimal inline glyphs (no external icon dep). Free=dashed square, Row=cols, Col=rows, Grid=grid.
const FREE = ICON(<rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />);
const ROW = ICON(<><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></>);
const COL = ICON(<><rect x="4" y="3" width="16" height="7" rx="1" /><rect x="4" y="14" width="16" height="7" rx="1" /></>);
const GRID = ICON(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);
const LOCK = ICON(<><rect x="6" y="10" width="12" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>);
const UNLOCK = ICON(<><rect x="6" y="10" width="12" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>);
const SIDES = ICON(<><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 9h16M4 15h16M9 4v16M15 4v16" /></>);

function px(v: string): number { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }

const ICON_BTN: React.CSSProperties = {
  width: 28, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--stroke-neutral-subtle)", borderRadius: 6, background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-subtle)", cursor: "pointer",
};

export function LayoutSection({ styles, pending, change }: {
  styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn;
}) {
  const [aspectLocked, setAspectLocked] = useState(false);
  const ratioRef = useRef<number | null>(null);
  const [marginExpanded, setMarginExpanded] = useState(false);
  const [paddingExpanded, setPaddingExpanded] = useState(false);

  const display = fieldValue(styles, pending, "display");
  const flexDir = fieldValue(styles, pending, "flexDirection");
  const mode =
    display === "grid" ? "grid"
    : display === "flex" ? (flexDir === "column" ? "col" : "row")
    : "free";

  function setMode(v: string) {
    if (v === "free") change("display", "block");
    else if (v === "grid") change("display", "grid");
    else { change("display", "flex"); change("flexDirection", v === "col" ? "column" : "row"); }
  }

  function toggleLock() {
    const next = !aspectLocked;
    if (next) {
      const w = px(fieldValue(styles, pending, "width"));
      const h = px(fieldValue(styles, pending, "height"));
      ratioRef.current = Number.isFinite(w) && Number.isFinite(h) && w > 0 ? h / w : null;
    }
    setAspectLocked(next);
  }
  function onW(pxVal: string) {
    change("width", pxVal);
    if (aspectLocked && ratioRef.current != null) {
      const w = px(pxVal);
      if (Number.isFinite(w)) change("height", `${Math.round(w * ratioRef.current)}px`);
    }
  }
  function onH(pxVal: string) {
    change("height", pxVal);
    if (aspectLocked && ratioRef.current != null && ratioRef.current > 0) {
      const h = px(pxVal);
      if (Number.isFinite(h)) change("width", `${Math.round(h / ratioRef.current)}px`);
    }
  }
  function uniform(base: "margin"|"padding", pxVal: string) {
    for (const s of ["Top","Right","Bottom","Left"] as const) change(`${base}${s}` as keyof StyleSnapshot, pxVal);
  }
  function sidesEqual(base: "margin"|"padding"): boolean {
    const [t, r, b, l] = (["Top","Right","Bottom","Left"] as const).map((s) => fieldValue(styles, pending, `${base}${s}` as keyof StyleSnapshot));
    return t === r && r === b && b === l;
  }

  const showGap = display === "flex" || display === "grid";
  const marginMixed = !sidesEqual("margin");
  const paddingMixed = !sidesEqual("padding");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SegmentedToggle ariaLabel="Layout mode" value={mode} onChange={setMode}
        options={[
          { value: "free", label: "Free", icon: FREE },
          { value: "row", label: "Row", icon: ROW },
          { value: "col", label: "Col", icon: COL },
          { value: "grid", label: "Grid", icon: GRID },
        ]} />

      {/* W │ lock │ H */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", gap: 8, alignItems: "end" }}>
        <NumberField id="ins-w" label="W" valuePx={fieldValue(styles, pending, "width")} onChange={onW} />
        <button type="button" aria-label={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
          aria-pressed={aspectLocked} onClick={toggleLock}
          style={{ ...ICON_BTN, color: aspectLocked ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)" }}
          title="Lock aspect">
          {aspectLocked ? LOCK : UNLOCK}
        </button>
        <NumberField id="ins-h" label="H" valuePx={fieldValue(styles, pending, "height")} onChange={onH} />
      </div>

      {/* Min W │ Max W │ Min H │ Max H */}
      <div style={GRID_4}>
        <NumberField id="ins-minw" label="Min W" valuePx={fieldValue(styles, pending, "minWidth")} onChange={(v) => change("minWidth", v)} />
        <NumberField id="ins-maxw" label="Max W" valuePx={fieldValue(styles, pending, "maxWidth")} onChange={(v) => change("maxWidth", v)} />
        <NumberField id="ins-minh" label="Min H" valuePx={fieldValue(styles, pending, "minHeight")} onChange={(v) => change("minHeight", v)} />
        <NumberField id="ins-maxh" label="Max H" valuePx={fieldValue(styles, pending, "maxHeight")} onChange={(v) => change("maxHeight", v)} />
      </div>

      {/* Margin │ Padding (each: input + per-side expand button) */}
      <div style={GRID_2}>
        <NumberField id="ins-margin" label="Margin"
          valuePx={sidesEqual("margin") ? fieldValue(styles, pending, "marginTop") : ""}
          placeholder={marginMixed ? "Mixed" : undefined}
          onChange={(v) => uniform("margin", v)}
          trailing={
            <button type="button" aria-label="Expand margin" onClick={() => setMarginExpanded((x) => !x)} style={ICON_BTN} title="Per-side">{SIDES}</button>
          } />
        <NumberField id="ins-padding" label="Padding"
          valuePx={sidesEqual("padding") ? fieldValue(styles, pending, "paddingTop") : ""}
          placeholder={paddingMixed ? "Mixed" : undefined}
          onChange={(v) => uniform("padding", v)}
          trailing={
            <button type="button" aria-label="Expand padding" onClick={() => setPaddingExpanded((x) => !x)} style={ICON_BTN} title="Per-side">{SIDES}</button>
          } />
      </div>

      {(marginExpanded || marginMixed) && (
        <Field label="Margin sides">
          <div style={GRID_4}>
            {(["Top","Right","Bottom","Left"] as const).map((s) => (
              <NumberField key={s} id={`ins-margin-${s}`} label={`Margin ${s.toLowerCase()}`} displayLabel={s}
                valuePx={fieldValue(styles, pending, `margin${s}` as keyof StyleSnapshot)} onChange={(v) => change(`margin${s}` as keyof StyleSnapshot, v)} />
            ))}
          </div>
        </Field>
      )}
      {(paddingExpanded || paddingMixed) && (
        <Field label="Padding sides">
          <div style={GRID_4}>
            {(["Top","Right","Bottom","Left"] as const).map((s) => (
              <NumberField key={s} id={`ins-padding-${s}`} label={`Padding ${s.toLowerCase()}`} displayLabel={s}
                valuePx={fieldValue(styles, pending, `padding${s}` as keyof StyleSnapshot)} onChange={(v) => change(`padding${s}` as keyof StyleSnapshot, v)} />
            ))}
          </div>
        </Field>
      )}

      {showGap && (
        <div style={GRID_2}>
          <NumberField id="ins-gap" label="Gap" valuePx={fieldValue(styles, pending, "gap")} onChange={(v) => change("gap", v)} />
        </div>
      )}
    </div>
  );
}
