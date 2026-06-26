import { useEffect, useRef, useState } from "react";
import { Button, useToast } from "@xorkavi/arcade-gen";
import {
  useEditSession, type StyleSnapshot, type PendingEdits, type EditedElement,
  TOKEN_PREFIX, isTokenPending, tokenClass,
} from "../../hooks/editSessionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";
import { postVisualEdit, isInFrame, buildSingleEdit } from "../../lib/visualEditClient";
import { useEditBlocks } from "../../hooks/editBlocksContext";
import { resolveInFrameComponent } from "../../frame/resolveInFrameComponent";
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

/**
 * Side map: pending AI block id → the scoped chat preamble that applies it.
 * When a deterministic field write bails (dynamic className/text, etc.) we emit
 * an `ai`/`pending` block instead of auto-sending. We stash the ready-to-send
 * preamble here, keyed by the block id, so Task 8's "Apply" can call
 * `onSend(pendingBlockPreambles.get(id))` without re-deriving the edit.
 */
export const pendingBlockPreambles = new Map<string, string>();

/**
 * Read AND evict the stashed preamble for a block. ProjectDetail's Apply
 * handler calls this so it can `onSend(...)` the scoped chat instruction
 * without re-deriving the edit — and the one-shot read keeps the side map
 * from growing unbounded once a pending block is applied. Discard/Undo also
 * call this to drop the entry for blocks that never get sent.
 */
export function takePendingBlockPreamble(id: string): string | undefined {
  const preamble = pendingBlockPreambles.get(id);
  pendingBlockPreambles.delete(id);
  return preamble;
}

function countChanges(e: EditedElement): number {
  return Object.values(e.pending).filter((v) => v !== undefined).length;
}

/** Short, human-readable label for an edit block (no file/line refs). */
function humanLabel(field: string, value: string): string {
  if (field === "text") return `text → "${value}"`;
  const v = value.startsWith(TOKEN_PREFIX) ? value.slice(TOKEN_PREFIX.length) : value;
  return `${field} → ${v}`;
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
  onSend, slug,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  /** Retained for API compatibility with callers; no longer used now that
   *  edits apply on settle (no Commit button to disable while busy). */
  busy?: boolean;
  slug: string;
}) {
  const {
    batch, focusedEditId, frameSlug, frameWindow, inspectorOpen, inspectorWidth,
    setField, resetField, removeElement, focus, clear, setInspectorWidth,
    shiftSelectionsBelow,
  } = useEditSession();
  const { toast, dismiss } = useToast();
  const { addBlock } = useEditBlocks();
  const catalogState = useAssetsCatalog();
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const [isResizing, setIsResizing] = useState(false);
  const dragOrigin = useRef<{ startX: number; startWidth: number } | null>(null);
  const [kitProps, setKitProps] = useState<{ name: string; values: string[] }[]>([]);
  const lastSuccessToastId = useRef<string | null>(null);
  // Debounce timers for the deterministic write-on-settle, keyed by editId:field.
  const applyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Ref to scheduleApply so the long-lived text-changed listener always calls
  // the current closure (reading the latest batch/slug/frameSlug).
  const scheduleApplyRef = useRef<(sel: EditedElement["selection"], field: string, value: string) => void>(() => {});

  // In-place text edits arrive from the iframe as text-changed messages.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "arcade-studio:text-changed") return;
      if (typeof d.editId === "number" && typeof d.text === "string") {
        setField(d.editId, "text", d.text);
        const elem = batch.find((x) => x.selection.editId === d.editId);
        if (elem) scheduleApplyRef.current(elem.selection, "text", d.text);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [setField, batch]);

  // Clear any in-flight debounce timer on unmount so a settled-but-not-yet-fired
  // deterministic write doesn't run after the inspector is gone (latent leak).
  useEffect(() => () => {
    Object.values(applyTimers.current).forEach(clearTimeout);
  }, []);

  // Fetch kit props for the RESOLVED nearest-in-frame component (not the clicked
  // element). The props we edit live on that in-frame instance — the one the
  // frame's own index.tsx placed — so its name drives the kit-props lookup.
  const focusedNow = batch.find((e) => e.selection.editId === focusedEditId) ?? null;
  const isComponentSel = !!focusedNow && !isInFrame(focusedNow.selection.file, frameSlug ?? "");
  const inFrameComp = isComponentSel && focusedNow
    ? resolveInFrameComponent(focusedNow.selection.ownerChain, frameSlug ?? "")
    : null;
  useEffect(() => {
    const name = inFrameComp?.componentName;
    if (!name || !/^[A-Z]/.test(name)) { setKitProps([]); return; }
    let cancelled = false;
    fetch(`/api/kit-props/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setKitProps(d.props ?? []); })
      .catch(() => { if (!cancelled) setKitProps([]); });
    return () => { cancelled = true; };
  }, [inFrameComp?.componentName]);

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
    if (rawValue === original || rawValue === "") { resetField(id, key as keyof StyleSnapshot); return; }
    setField(id, key as any, rawValue);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", editId: id, field: key, value: rawValue || original },
      "*",
    );
    // …then write the settled value deterministically (debounced) and emit a block.
    scheduleApply(elem.selection, key as string, rawValue);
  }

  function changeToken(key: keyof StyleSnapshot | "typeStyle", className: string, prevClassName?: string) {
    const id = focusedEditId;
    if (id == null) return;
    const elem = batch.find((e) => e.selection.editId === id);
    if (!elem) return;
    setField(id, key, `${TOKEN_PREFIX}${className}`);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview-class", editId: id, slot: key, className, prevClassName },
      "*",
    );
    scheduleApply(elem.selection, key as string, `${TOKEN_PREFIX}${className}`);
  }

  // Deterministic write-on-settle: each settled field edit writes to code and
  // produces a block. {ok:true} → instant/applied block; {ok:false} → ai/pending
  // block (NOT auto-sent — Task 8's Apply will send the stashed preamble).
  async function applyFieldEdit(sel: EditedElement["selection"], field: string, value: string) {
    const targetFrame = frameSlug ?? "";
    // Off-frame (shared kit) elements are the Customize path, not field edits.
    if (!targetFrame || !isInFrame(sel.file, targetFrame)) return;
    const det = await postVisualEdit(slug, buildSingleEdit(sel, field, value, targetFrame));
    if (det.ok) {
      // If the write changed the file's line count, refresh the held source
      // coordinates of any selection below it so a SECOND edit targets the
      // right JSX node instead of a now-stale line:column.
      if (det.lineDelta && typeof det.editLine === "number") {
        shiftSelectionsBelow(det.editLine, det.lineDelta);
      }
      addBlock({ label: humanLabel(field, value), kind: "instant", status: "applied", frameSlug: targetFrame });
      // Deterministic write succeeded → the edit is now applied on disk, so clear
      // the pending delta for this field. This drops it from totalChanges (which
      // gates the move ↑/↓ buttons), so once all edits settle the buttons
      // re-enable. Only clear on success; a bail (pending AI block) must keep
      // the pending entry since the change isn't applied yet.
      resetField(sel.editId, field as any);
    } else {
      // Can't map deterministically → pending AI block. Stash a ready-to-send
      // preamble keyed by block id so Task 8's Apply can call onSend(...).
      const id = addBlock({ label: humanLabel(field, value), kind: "ai", status: "pending", frameSlug: targetFrame });
      const elementWithPending: EditedElement = { selection: sel, pending: { [field]: value } as any };
      const preamble = buildVisualEditPreamble([elementWithPending], `${targetFrame}/index.tsx`);
      if (preamble) pendingBlockPreambles.set(id, preamble);
    }
  }
  function scheduleApply(sel: EditedElement["selection"], field: string, value: string) {
    const k = `${sel.editId}:${field}`;
    clearTimeout(applyTimers.current[k]);
    applyTimers.current[k] = setTimeout(() => { void applyFieldEdit(sel, field, value); }, 350);
  }
  scheduleApplyRef.current = scheduleApply;

  function changeIcon(name: string) {
    const id = focusedEditId;
    if (id == null || !catalog) return;
    setField(id, "iconSwap", name);
    const svg = iconSvg(catalog, name);
    if (svg) frameWindow?.postMessage({ type: "arcade-studio:preview-icon", editId: id, svg }, "*");
  }

  const focused = focusedNow;
  // Props-first component mode: a settled prop change writes prop:<name> on the
  // RESOLVED nearest-in-frame component instance (file/line/col from the resolver),
  // NOT the clicked element. {ok:true} → instant/applied block; otherwise fall
  // back to a scoped chat ask. Everything else routes through "Ask AI".
  function changeProp(propName: string, value: string) {
    if (!inFrameComp || !focused) return;
    if (value === "") return; // "—" = no change
    const sel = { ...focused.selection, file: inFrameComp.file, line: inFrameComp.line, column: inFrameComp.column };
    setField(focused.selection.editId, `prop:${propName}` as any, value);
    void postVisualEdit(slug, buildSingleEdit(sel, `prop:${propName}`, value, frameSlug ?? ""))
      .then((det) => {
        if (det.ok) {
          addBlock({
            label: `${inFrameComp.componentName}.${propName} → ${value}`,
            kind: "instant", status: "applied", frameSlug: frameSlug ?? "",
          });
        } else {
          askAi(`set its ${propName} to ${value}`);
        }
      });
  }
  function askAi(change: string) {
    if (!inFrameComp) return;
    onSend(`In frames/${frameSlug}/index.tsx, on the <${inFrameComp.componentName}> at line ${inFrameComp.line}, ${change}.`);
  }
  function discard() {
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
                        title={totalChanges > 0 ? "Finish editing this element before moving it" : "Move up"}
                        disabled={totalChanges > 0}
                        onClick={(ev) => { ev.stopPropagation(); void move(e, "up"); }}
                        style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: totalChanges > 0 ? "not-allowed" : "pointer", fontSize: 13, lineHeight: 1, opacity: totalChanges > 0 ? 0.4 : 1 }}>↑</button>
                      <button type="button" aria-label="Move element down"
                        title={totalChanges > 0 ? "Finish editing this element before moving it" : "Move down"}
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

                {/* Props-first component mode: edit the resolved in-frame
                    component's PROPS directly (instant, deterministic), and
                    route everything else through "Ask AI to change this". No
                    grayed style sections — they were never editable on a
                    component. */}
                {isComponentSel ? (
                  <Section title={inFrameComp ? `Editing <${inFrameComp.componentName}>` : "Component"}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {kitProps.length > 0 ? (
                        kitProps.map((p) => (
                          <Field key={p.name} label={p.name}>
                            <select aria-label={p.name} style={INPUT_COMPACT}
                              value={(pending[`prop:${p.name}`] as string) ?? ""}
                              onChange={(e) => changeProp(p.name, e.target.value)}>
                              <option value="">—</option>
                              {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </Field>
                        ))
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", lineHeight: 1.45 }}>
                          No editable properties — use Ask AI to change this.
                        </span>
                      )}
                      <Button variant="primary" onClick={() => askAi("describe the change")}>Ask AI to change this</Button>
                    </div>
                  </Section>
                ) : (
                <div>
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
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Edits apply to code as they settle — there is no Commit. This control
          just clears the selection and drops the live preview overlay. */}
      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Done</Button>
      </div>
    </aside>
  );
}
