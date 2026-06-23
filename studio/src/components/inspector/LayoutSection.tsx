import { useState, useRef } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import {
  NumberField, SegmentedToggle, fieldValue,
  FIELD_ROW, COL_LABEL, type ChangeFn,
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

function px(v: string): number { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }

const EXPAND_BTN: React.CSSProperties = {
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
  function uniform(side4: ("Top"|"Right"|"Bottom"|"Left")[], base: "margin"|"padding", pxVal: string) {
    for (const s of side4) change(`${base}${s}` as keyof StyleSnapshot, pxVal);
  }

  const showGap = display === "flex" || display === "grid";

  return (
    <div style={SECTION_BODY_LOCAL}>
      <SegmentedToggle ariaLabel="Layout mode" value={mode} onChange={setMode}
        options={[
          { value: "free", label: "Free", icon: FREE },
          { value: "row", label: "Row", icon: ROW },
          { value: "col", label: "Col", icon: COL },
          { value: "grid", label: "Grid", icon: GRID },
        ]} />

      <div style={{ ...FIELD_ROW }}>
        <NumberField id="ins-w" label="W" valuePx={fieldValue(styles, pending, "width")} onChange={onW} />
        <button type="button" aria-label={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
          aria-pressed={aspectLocked} onClick={toggleLock} style={{ ...EXPAND_BTN, color: aspectLocked ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)" }} title="Lock aspect">
          {aspectLocked ? "🔒" : "🔓"}
        </button>
        <NumberField id="ins-h" label="H" valuePx={fieldValue(styles, pending, "height")} onChange={onH} />
      </div>

      <NumberField id="ins-minw" label="Min W" valuePx={fieldValue(styles, pending, "minWidth")} onChange={(v) => change("minWidth", v)} />
      <NumberField id="ins-maxw" label="Max W" valuePx={fieldValue(styles, pending, "maxWidth")} onChange={(v) => change("maxWidth", v)} />
      <NumberField id="ins-minh" label="Min H" valuePx={fieldValue(styles, pending, "minHeight")} onChange={(v) => change("minHeight", v)} />
      <NumberField id="ins-maxh" label="Max H" valuePx={fieldValue(styles, pending, "maxHeight")} onChange={(v) => change("maxHeight", v)} />

      {/* Margin */}
      <div style={FIELD_ROW}>
        <NumberField id="ins-margin" label="Margin" valuePx={fieldValue(styles, pending, "marginTop")} onChange={(v) => uniform(["Top","Right","Bottom","Left"], "margin", v)} />
        <button type="button" aria-label="Expand margin" onClick={() => setMarginExpanded((x) => !x)} style={EXPAND_BTN} title="Per-side">⤢</button>
      </div>
      {marginExpanded && (["Top","Right","Bottom","Left"] as const).map((s) => (
        <NumberField key={s} id={`ins-margin-${s}`} label={`Margin ${s.toLowerCase()}`} valuePx={fieldValue(styles, pending, `margin${s}` as keyof StyleSnapshot)} onChange={(v) => change(`margin${s}` as keyof StyleSnapshot, v)} />
      ))}

      {/* Padding */}
      <div style={FIELD_ROW}>
        <NumberField id="ins-padding" label="Padding" valuePx={fieldValue(styles, pending, "paddingTop")} onChange={(v) => uniform(["Top","Right","Bottom","Left"], "padding", v)} />
        <button type="button" aria-label="Expand padding" onClick={() => setPaddingExpanded((x) => !x)} style={EXPAND_BTN} title="Per-side">⤢</button>
      </div>
      {paddingExpanded && (["Top","Right","Bottom","Left"] as const).map((s) => (
        <NumberField key={s} id={`ins-padding-${s}`} label={`Padding ${s.toLowerCase()}`} valuePx={fieldValue(styles, pending, `padding${s}` as keyof StyleSnapshot)} onChange={(v) => change(`padding${s}` as keyof StyleSnapshot, v)} />
      ))}

      {showGap && (
        <NumberField id="ins-gap" label="Gap" valuePx={fieldValue(styles, pending, "gap")} onChange={(v) => change("gap", v)} />
      )}
    </div>
  );
}

const SECTION_BODY_LOCAL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
