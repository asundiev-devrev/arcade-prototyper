import { useEffect, useRef, useState } from "react";
import { Button } from "@xorkavi/arcade-gen";
import {
  useEditSession, type StyleSnapshot, type PendingEdits, type EditedElement,
} from "../../hooks/editSessionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";
import { fieldValue, toNumberInput, fromNumberInput, Field, NumberField, INPUT_COMPACT, GRID_2 } from "./inspectorControls";
import { Section } from "./Section";
import { LayoutSection } from "./LayoutSection";
import { AppearanceSection } from "./AppearanceSection";

const MIN_W = 280, MAX_W = 560;

function countChanges(e: EditedElement): number {
  return Object.values(e.pending).filter((v) => v !== undefined).length;
}

const SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--stroke-neutral-subtle)", padding: "12px 14px",
  display: "flex", flexDirection: "column", gap: 10,
};
const LABEL: React.CSSProperties = {
  fontSize: 11, color: "var(--fg-neutral-subtle)", textTransform: "uppercase", letterSpacing: 0.4,
};
const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };

export function InspectorPanel({
  onSend, busy,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
}) {
  const {
    batch, focusedEditId, frameWindow, inspectorOpen, inspectorWidth,
    setField, resetField, removeElement, focus, clear, setInspectorWidth,
  } = useEditSession();
  const [isResizing, setIsResizing] = useState(false);
  const dragOrigin = useRef<{ startX: number; startWidth: number } | null>(null);

  // In-place text edits arrive from the iframe as text-changed messages.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "arcade-studio:text-changed") return;
      if (typeof d.editId === "number" && typeof d.text === "string") {
        setField(d.editId, "text", d.text);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [setField]);

  // Resize drag (mirrors the chat-pane handle in ProjectDetail).
  useEffect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent) {
      const s = dragOrigin.current;
      if (!s) return;
      // Panel is on the RIGHT, handle on its LEFT edge → dragging left widens.
      const next = s.startWidth + (s.startX - e.clientX);
      setInspectorWidth(Math.min(MAX_W, Math.max(MIN_W, next)));
    }
    function onUp() {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isResizing, setInspectorWidth]);

  if (!inspectorOpen) return null;

  function change(key: keyof StyleSnapshot, rawValue: string) {
    const id = focusedEditId;
    if (id == null) return;
    const elem = batch.find((e) => e.selection.editId === id);
    if (!elem) return;
    const original = elem.selection.styles[key];
    if (rawValue === original || rawValue === "") resetField(id, key);
    else setField(id, key, rawValue);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", editId: id, field: key, value: rawValue || original },
      "*",
    );
  }

  const focused = batch.find((e) => e.selection.editId === focusedEditId) ?? null;
  function discard() {
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  function commit() {
    if (batch.length === 0) { discard(); return; }
    const frameRel = batch[0].selection.file.split("/frames/").pop() ?? batch[0].selection.file;
    const preamble = buildVisualEditPreamble(batch, frameRel);
    if (!preamble) { discard(); return; }
    onSend(preamble, []);
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    dragOrigin.current = { startX: e.clientX, startWidth: inspectorWidth };
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const totalChanges = batch.reduce((n, e) => n + countChanges(e), 0);
  const styles = focused?.selection.styles;
  const pending = focused?.pending ?? {};

  return (
    <aside
      style={{
        width: inspectorWidth, borderLeft: "1px solid var(--stroke-neutral-subtle)",
        background: "var(--surface-overlay)", display: "flex", flexDirection: "column",
        minHeight: 0, overflow: "hidden", position: "relative",
      }}
    >
      {/* left-edge resize handle */}
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize inspector"
        onMouseDown={startResize}
        style={{ position: "absolute", top: 0, left: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 2 }}
      />
      <div style={{
        height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 14px", borderBottom: "1px solid var(--stroke-neutral-subtle)",
        fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)",
      }}>
        <span>Edit elements{batch.length ? ` (${batch.length})` : ""}</span>
        <button type="button" onClick={discard} aria-label="Close inspector"
          style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {batch.length === 0 ? (
          <div style={{ padding: 24, color: "var(--fg-neutral-subtle)", fontSize: 13, textAlign: "center" }}>
            Click elements in the frame to edit them.
          </div>
        ) : (
          <>
            {/* batch list */}
            <div style={{ ...SECTION, borderTop: "none" }}>
              <span style={LABEL}>Edited elements</span>
              {batch.map((e) => {
                const isFocused = e.selection.editId === focusedEditId;
                const n = countChanges(e);
                return (
                  <div key={e.selection.editId} style={{
                    ...FIELD_ROW, justifyContent: "space-between", padding: "4px 8px", borderRadius: 6,
                    background: isFocused ? "var(--bg-neutral-soft)" : "transparent", cursor: "pointer",
                  }} onClick={() => focus(e.selection.editId)}>
                    <span style={{ fontSize: 12, color: "var(--fg-neutral-prominent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      &lt;{e.selection.tagName || e.selection.componentName}&gt;{n ? ` · ${n}` : ""}
                    </span>
                    <button type="button" aria-label={`Remove element ${e.selection.editId}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        frameWindow?.postMessage({ type: "arcade-studio:preview-reset", editId: e.selection.editId }, "*");
                        removeElement(e.selection.editId);
                      }}
                      style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>

            {focused && styles && (
              <>
                {focused.selection.textEditable && (
                  <div style={{ ...SECTION }}>
                    <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                      Double-click the element in the frame to edit its text.
                    </span>
                  </div>
                )}

                <Section title="Layout">
                  <LayoutSection styles={styles} pending={pending} change={change} />
                </Section>

                <Section title="Appearance">
                  <AppearanceSection styles={styles} pending={pending} change={change} />
                </Section>

                <Section title="Typography">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={GRID_2}>
                      <NumberField id="ins-fontSize" label="Font size" valuePx={fieldValue(styles, pending, "fontSize")}
                        onChange={(v) => change("fontSize", v)} />
                      <Field label="Weight" htmlFor="ins-fontWeight">
                        <select id="ins-fontWeight" aria-label="Font weight" style={INPUT_COMPACT}
                          value={fieldValue(styles, pending, "fontWeight")}
                          onChange={(e) => change("fontWeight", e.target.value)}>
                          {["300","400","500","600","700"].map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div style={GRID_2}>
                      <Field label="Align" htmlFor="ins-textAlign">
                        <select id="ins-textAlign" aria-label="Text align" style={INPUT_COMPACT}
                          value={fieldValue(styles, pending, "textAlign")}
                          onChange={(e) => change("textAlign", e.target.value)}>
                          {["left","center","right","justify"].map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </Field>
                      <Field label="Italic" htmlFor="ins-fontStyle">
                        <div style={{ height: 28, display: "flex", alignItems: "center" }}>
                          <input id="ins-fontStyle" type="checkbox" aria-label="Italic"
                            checked={fieldValue(styles, pending, "fontStyle") === "italic"}
                            onChange={(e) => change("fontStyle", e.target.checked ? "italic" : "normal")} />
                        </div>
                      </Field>
                    </div>
                  </div>
                </Section>

                <Section title="Color">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(["color","backgroundColor","borderColor"] as const).map((key) => (
                      <Field key={key} label={key === "color" ? "Text" : key === "backgroundColor" ? "Fill" : "Border"} htmlFor={`ins-${key}`}>
                        <input id={`ins-${key}`} aria-label={key} style={INPUT_COMPACT}
                          value={fieldValue(styles, pending, key)}
                          onChange={(e) => change(key, e.target.value)} />
                      </Field>
                    ))}
                  </div>
                </Section>
              </>
            )}
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Discard</Button>
        <Button variant="primary" onClick={commit} disabled={totalChanges === 0 || busy}>Commit</Button>
      </div>
    </aside>
  );
}
