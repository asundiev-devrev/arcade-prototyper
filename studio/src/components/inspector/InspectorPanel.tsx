import { Button } from "@xorkavi/arcade-gen";
import { useTargetSelection, type StyleSnapshot, type PendingEdits } from "../../hooks/targetSelectionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";

/** Strip a trailing "px" for numeric inputs; pass other units through as-is. */
function toNumberInput(v: string): string {
  return v.endsWith("px") ? v.slice(0, -2) : v;
}
/** Re-attach "px" for a numeric field's pending value. */
function fromNumberInput(v: string): string {
  return v === "" ? "" : `${v}px`;
}

/** Current value for a field: pending override if present, else the original. */
function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}

const SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--stroke-neutral-subtle)",
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const LABEL: React.CSSProperties = {
  fontSize: 11,
  color: "var(--fg-neutral-subtle)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const INPUT: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)",
  background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)",
  fontSize: 12,
};

export function InspectorPanel({
  onSend,
  busy,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
}) {
  const {
    target, pending, setPendingField, resetPendingField, inspectorOpen, clear, frameWindow,
  } = useTargetSelection();

  if (!inspectorOpen) return null;

  // Apply a change: store pending (or reset if back to original) + preview it live.
  function change(key: keyof StyleSnapshot, rawValue: string) {
    if (!target) return;
    const original = target.styles[key];
    if (rawValue === original || rawValue === "") {
      resetPendingField(key);
    } else {
      setPendingField(key, rawValue);
    }
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", field: key, value: rawValue || original },
      "*",
    );
  }

  function discard() {
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset" }, "*");
    clear();
  }

  function commit() {
    if (!target) return;
    const preamble = buildVisualEditPreamble(target, pending);
    if (!preamble) {
      discard();
      return;
    }
    onSend(preamble, []);
    // Source rewrite + HMR will repaint the frame; drop the throwaway preview.
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset" }, "*");
    clear();
  }

  const hasChanges = Object.values(pending).some((v) => v !== undefined);

  return (
    <aside
      style={{
        width: 280,
        borderLeft: "1px solid var(--stroke-neutral-subtle)",
        background: "var(--surface-overlay)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 44, flex: "none", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 14px",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
          fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)",
        }}
      >
        <span>Edit element</span>
        <button
          type="button" onClick={discard} aria-label="Close inspector"
          style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!target ? (
          <div style={{ padding: 24, color: "var(--fg-neutral-subtle)", fontSize: 13, textAlign: "center" }}>
            Click an element in the frame to edit it.
          </div>
        ) : (
          <>
            {/* Text */}
            <div style={SECTION}>
              <span style={LABEL}>Text</span>
              <input
                aria-label="Text content"
                style={INPUT}
                value={fieldValue(target.styles, pending, "text")}
                onChange={(e) => change("text", e.target.value)}
              />
            </div>

            {/* Typography */}
            <div style={SECTION}>
              <span style={LABEL}>Typography</span>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontSize" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Font size</label>
                <input
                  id="ins-fontSize" type="number" aria-label="Font size" style={INPUT}
                  value={toNumberInput(fieldValue(target.styles, pending, "fontSize"))}
                  onChange={(e) => change("fontSize", fromNumberInput(e.target.value))}
                />
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontWeight" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Weight</label>
                <select
                  id="ins-fontWeight" aria-label="Font weight" style={INPUT}
                  value={fieldValue(target.styles, pending, "fontWeight")}
                  onChange={(e) => change("fontWeight", e.target.value)}
                >
                  {["300", "400", "500", "600", "700"].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-textAlign" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Align</label>
                <select
                  id="ins-textAlign" aria-label="Text align" style={INPUT}
                  value={fieldValue(target.styles, pending, "textAlign")}
                  onChange={(e) => change("textAlign", e.target.value)}
                >
                  {["left", "center", "right", "justify"].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontStyle" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Italic</label>
                <input
                  id="ins-fontStyle" type="checkbox" aria-label="Italic"
                  checked={fieldValue(target.styles, pending, "fontStyle") === "italic"}
                  onChange={(e) => change("fontStyle", e.target.checked ? "italic" : "normal")}
                />
              </div>
            </div>

            {/* Color */}
            <div style={SECTION}>
              <span style={LABEL}>Color</span>
              {(["color", "backgroundColor", "borderColor"] as const).map((key) => (
                <div style={FIELD_ROW} key={key}>
                  <label htmlFor={`ins-${key}`} style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>
                    {key === "color" ? "Text" : key === "backgroundColor" ? "Fill" : "Border"}
                  </label>
                  <input
                    id={`ins-${key}`} aria-label={key} style={INPUT}
                    value={fieldValue(target.styles, pending, key)}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* Spacing & size */}
            <div style={SECTION}>
              <span style={LABEL}>Spacing &amp; size</span>
              {(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "width", "height"] as const).map((key) => (
                <div style={FIELD_ROW} key={key}>
                  <label htmlFor={`ins-${key}`} style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>{key}</label>
                  <input
                    id={`ins-${key}`} type="number" aria-label={key} style={INPUT}
                    value={toNumberInput(fieldValue(target.styles, pending, key))}
                    onChange={(e) => change(key, fromNumberInput(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Discard</Button>
        <Button variant="primary" onClick={commit} disabled={!hasChanges || busy}>Commit</Button>
      </div>
    </aside>
  );
}
