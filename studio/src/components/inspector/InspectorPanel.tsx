import { useEffect, useRef, useState } from "react";
import { Button } from "@xorkavi/arcade-gen";
import {
  useEditSession, type StyleSnapshot, type PendingEdits, type EditedElement,
  TOKEN_PREFIX, isTokenPending, tokenClass,
} from "../../hooks/editSessionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";
import { toElementEdits, postVisualEdit } from "../../lib/visualEditClient";
import { fieldValue, toNumberInput, fromNumberInput, Field, NumberField, INPUT_COMPACT, GRID_2, SegmentedToggle } from "./inspectorControls";
import { Section } from "./Section";
import { LayoutSection } from "./LayoutSection";
import { AppearanceSection } from "./AppearanceSection";
import { colorTokens, typeTokens, colorClassName, colorTokenFromClass, resolveSwatch, type ColorSlot } from "./tokenCatalog";
import { EditableTokenChip } from "./EditableTokenChip";
import { useAssetsCatalog } from "../assets/useAssetsCatalog";
import { iconNameSet, iconSvg, iconList } from "./iconCatalog";
import { IconSwapSection } from "./IconSwapSection";

const MIN_W = 280, MAX_W = 560;
const RAW_LINE_INDENT = 22; // swatch 16 + gap 6

function countChanges(e: EditedElement): number {
  return Object.values(e.pending).filter((v) => v !== undefined).length;
}

const ALIGN_ICON = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>
);
const ALIGN_OPTS = [
  { value: "left",    label: "Left",    icon: ALIGN_ICON("M3 6h18M3 12h12M3 18h15") },
  { value: "center",  label: "Center",  icon: ALIGN_ICON("M3 6h18M7 12h10M5 18h14") },
  { value: "right",   label: "Right",   icon: ALIGN_ICON("M3 6h18M9 12h12M6 18h15") },
  { value: "justify", label: "Justify", icon: ALIGN_ICON("M3 6h18M3 12h18M3 18h18") },
];

const SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--stroke-neutral-subtle)", padding: "12px 14px",
  display: "flex", flexDirection: "column", gap: 10,
};
const LABEL: React.CSSProperties = {
  fontSize: 11, color: "var(--fg-neutral-subtle)", textTransform: "uppercase", letterSpacing: 0.4,
};
const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };

function ColorRow({
  slot, label, styles, pending, changeToken, change,
}: {
  slot: ColorSlot;
  label: string;
  styles: StyleSnapshot;
  pending: PendingEdits;
  changeToken: (key: ColorSlot, className: string, prevClassName?: string) => void;
  change: (key: ColorSlot, rawValue: string) => void;
}) {
  const appliedCls = styles.appliedTokens[slot] ?? null;
  const pendingTok = isTokenPending(pending[slot]) ? tokenClass(pending[slot]!) : undefined;
  const currentToken = pendingTok ?? appliedCls ?? null;
  const tokenOpts = colorTokens().map((t) => ({ value: colorClassName(t.token, slot), label: t.label }));
  const rawComputed = isTokenPending(pending[slot]) ? styles[slot] : fieldValue(styles, pending, slot);
  // swatch ALWAYS: token's live value if a token is current, else the computed color
  let swatch = rawComputed;
  if (currentToken) {
    const parsed = colorTokenFromClass(currentToken);
    if (parsed) swatch = resolveSwatch(parsed.token, document.documentElement) || rawComputed;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Field label={label}>
        <EditableTokenChip
          ariaLabel={label}
          tokenValue={currentToken}
          tokenOptions={tokenOpts}
          rawValue={rawComputed}
          onPickToken={(cls) => changeToken(slot, cls, currentToken ?? undefined)}
          onRawChange={(raw) => change(slot, raw)}
          swatch={swatch}
          placeholder="— (no token)"
        />
      </Field>
      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", fontVariantNumeric: "tabular-nums", paddingLeft: RAW_LINE_INDENT }}>
        {rawComputed}
      </span>
    </div>
  );
}

export function InspectorPanel({
  onSend, busy, slug,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
  slug: string;
}) {
  const {
    batch, focusedEditId, frameWindow, inspectorOpen, inspectorWidth,
    setField, resetField, removeElement, focus, clear, setInspectorWidth,
  } = useEditSession();
  const catalogState = useAssetsCatalog();
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const [isResizing, setIsResizing] = useState(false);
  const dragOrigin = useRef<{ startX: number; startWidth: number } | null>(null);
  const [kitProps, setKitProps] = useState<{ name: string; values: string[] }[]>([]);

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

  // Fetch kit props for uppercase component names
  useEffect(() => {
    const focused = batch.find((e) => e.selection.editId === focusedEditId) ?? null;
    const name = focused?.selection.componentName;
    if (!name || !/^[A-Z]/.test(name)) { setKitProps([]); return; }
    let cancelled = false;
    fetch(`/api/kit-props/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setKitProps(d.props ?? []); })
      .catch(() => { if (!cancelled) setKitProps([]); });
    return () => { cancelled = true; };
  }, [focusedEditId, batch.find((e) => e.selection.editId === focusedEditId)?.selection.componentName]);

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

  function change(key: keyof StyleSnapshot | "typeStyle" | "iconSwap" | `prop:${string}`, rawValue: string) {
    const id = focusedEditId;
    if (id == null) return;
    const elem = batch.find((e) => e.selection.editId === id);
    if (!elem) return;
    // For prop: fields, no preview and no original check
    if (typeof key === "string" && key.startsWith("prop:")) {
      if (rawValue === "") resetField(id, key as any);
      else setField(id, key as any, rawValue);
      return;
    }
    const original = elem.selection.styles[key as keyof StyleSnapshot];
    if (rawValue === original || rawValue === "") resetField(id, key as keyof StyleSnapshot);
    else setField(id, key as any, rawValue);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", editId: id, field: key, value: rawValue || original },
      "*",
    );
  }

  function changeToken(key: keyof StyleSnapshot | "typeStyle", className: string, prevClassName?: string) {
    const id = focusedEditId;
    if (id == null) return;
    setField(id, key, `${TOKEN_PREFIX}${className}`);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview-class", editId: id, slot: key, className, prevClassName },
      "*",
    );
  }

  function changeIcon(name: string) {
    const id = focusedEditId;
    if (id == null || !catalog) return;
    setField(id, "iconSwap", name);
    const svg = iconSvg(catalog, name);
    if (svg) frameWindow?.postMessage({ type: "arcade-studio:preview-icon", editId: id, svg }, "*");
  }

  const focused = batch.find((e) => e.selection.editId === focusedEditId) ?? null;
  function discard() {
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  async function commit() {
    if (batch.length === 0) { discard(); return; }
    const frameRel = batch[0].selection.file.split("/frames/").pop() ?? batch[0].selection.file;

    // 1. Try the deterministic code-writer.
    const payload = toElementEdits(batch);
    const det = await postVisualEdit(slug, payload);
    if (det.ok) {
      // Vite will hot-reload the frame from disk; drop the inline preview.
      frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
      clear();
      return;
    }

    // 2. Fall back to the chat path (unchanged behaviour).
    const preamble = buildVisualEditPreamble(batch, frameRel);
    if (!preamble) { discard(); return; }
    onSend(preamble, []);
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  async function move(el: EditedElement, dir: "up" | "down") {
    const frameSlug = el.selection.file.split("/frames/").pop()?.split("/")[0] ?? "";
    try {
      const res = await fetch(`/api/visual-edit/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameSlug, move: {
          file: el.selection.file, line: el.selection.line, column: el.selection.column, dir,
        } }),
      });
      const result = await res.json();
      if (result.ok) {
        // frame hot-reloads; the picked element's line moves, so drop the selection.
        frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
        clear();
      } else {
        // Server bailed (no sibling, dynamic parent, etc.) — preserve the batch and pending edits.
        console.warn("[InspectorPanel] Move failed:", result.reason);
      }
    } catch (err) {
      console.warn("[InspectorPanel] Move request failed:", err);
    }
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
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <button type="button" aria-label="Move element up"
                        title={totalChanges > 0 ? "Commit or discard edits before moving" : "Move up"}
                        disabled={totalChanges > 0}
                        onClick={(ev) => { ev.stopPropagation(); void move(e, "up"); }}
                        style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: totalChanges > 0 ? "not-allowed" : "pointer", fontSize: 13, lineHeight: 1, opacity: totalChanges > 0 ? 0.4 : 1 }}>↑</button>
                      <button type="button" aria-label="Move element down"
                        title={totalChanges > 0 ? "Commit or discard edits before moving" : "Move down"}
                        disabled={totalChanges > 0}
                        onClick={(ev) => { ev.stopPropagation(); void move(e, "down"); }}
                        style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: totalChanges > 0 ? "not-allowed" : "pointer", fontSize: 13, lineHeight: 1, opacity: totalChanges > 0 ? 0.4 : 1 }}>↓</button>
                      <button type="button" aria-label={`Remove element ${e.selection.editId}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          frameWindow?.postMessage({ type: "arcade-studio:preview-reset", editId: e.selection.editId }, "*");
                          removeElement(e.selection.editId);
                        }}
                        style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                    </div>
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

                {kitProps.length > 0 && (
                  <Section title={`${focused.selection.componentName} component`}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {kitProps.map((p) => (
                        <Field key={p.name} label={p.name}>
                          {/* Controlled on pending value only (committed-on-disk reflection is out of scope for picker snapshots) */}
                          <select aria-label={p.name} style={INPUT_COMPACT}
                            value={(pending[`prop:${p.name}`] as string) ?? ""}
                            onChange={(e) => change(("prop:" + p.name) as any, e.target.value)}>
                            <option value="">—</option>
                            {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </Field>
                      ))}
                      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)" }}>
                        Inner styles are part of this component. Use "Ask AI to customize" to change them.
                      </span>
                      <Button variant="tertiary" onClick={() => {
                        const frameRel = focused.selection.file.split("/frames/").pop() ?? focused.selection.file;
                        const name = focused.selection.componentName;
                        const line = focused.selection.line;
                        onSend(`In frames/${frameRel}, customize the <${name}> at line ${line}.`);
                      }}>
                        Ask AI to customize
                      </Button>
                    </div>
                  </Section>
                )}

                <div style={kitProps.length > 0 ? { opacity: 0.5, pointerEvents: "none" } : {}}>
                  <Section title="Layout">
                    <LayoutSection styles={styles} pending={pending} change={change} />
                  </Section>

                  <Section title="Appearance">
                    <AppearanceSection styles={styles} pending={pending} change={change} />
                  </Section>

                  {(() => {
                    const cand = focused.selection.iconCandidate;
                    if (!catalog || !cand || !iconNameSet(catalog).has(cand)) return null;
                    // current shows the pending swap if any, else the detected icon
                    const pendingIcon = pending.iconSwap;
                    const currentName = pendingIcon ?? cand;
                    return (
                      <Section title="Icon">
                        <IconSwapSection
                          currentName={currentName}
                          currentSvg={iconSvg(catalog, currentName)}
                          icons={iconList(catalog)}
                          onPickIcon={changeIcon}
                        />
                      </Section>
                    );
                  })()}

                  <Section title="Typography">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(() => {
                      const typeOptValues = new Set(typeTokens().map((t) => t.className));
                      const rawType = isTokenPending(pending.typeStyle)
                        ? tokenClass(pending.typeStyle!)
                        : (styles.appliedTokens.typeStyle ?? null);
                      const current = rawType && typeOptValues.has(rawType) ? rawType : null;
                      return (
                        <Field label="Style">
                          <EditableTokenChip
                            ariaLabel="Type style"
                            tokenValue={current}
                            tokenOptions={typeTokens().map((t) => ({ value: t.className, label: t.label }))}
                            rawValue=""
                            rawEnabled={false}
                            onPickToken={(cls) => changeToken("typeStyle", cls, rawType ?? undefined)}
                            onRawChange={() => {}}
                            placeholder="— (no token)"
                          />
                        </Field>
                      );
                    })()}
                    <div style={GRID_2}>
                      <NumberField id="ins-fontSize" label="Size" valuePx={fieldValue(styles, pending, "fontSize")}
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
                      <Field label="Align">
                        <SegmentedToggle ariaLabel="Text align" value={fieldValue(styles, pending, "textAlign")}
                          options={ALIGN_OPTS}
                          onChange={(v) => change("textAlign", v)} />
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
                      <ColorRow slot="color" label="Text" styles={styles} pending={pending} changeToken={changeToken} change={change} />
                      <ColorRow slot="backgroundColor" label="Fill" styles={styles} pending={pending} changeToken={changeToken} change={change} />
                      <ColorRow slot="borderColor" label="Border" styles={styles} pending={pending} changeToken={changeToken} change={change} />
                    </div>
                  </Section>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Discard</Button>
        <Button variant="primary" onClick={() => { void commit(); }} disabled={totalChanges === 0 || busy}>Commit</Button>
      </div>
    </aside>
  );
}
