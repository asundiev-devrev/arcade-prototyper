/**
 * In-iframe companion to picker.ts. The picker hands each clicked element here
 * via `capture()`. We retain a MAP of edited nodes keyed by a stamped numeric
 * editId, read computed-style snapshots to seed the shell panel, and apply
 * throwaway INLINE-style previews per element on `arcade-studio:preview`.
 *
 * Text is edited IN PLACE: double-clicking a captured, text-editable leaf makes
 * it contenteditable; on blur we post the new text to the shell. We NEVER write
 * `textContent` on a container — doing so deleted child elements (the v1 bug).
 *
 * Why inline styles (not a managed stylesheet): Studio frames are
 * className-styled static prototypes and the picker intercepts clicks during a
 * session, so React doesn't reconcile the `style` we set. Preview is disposable;
 * the committed result always comes from the shell's batch state, never read
 * back from here. Dev-only — same React-internals constraints as picker.ts.
 */

export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
}

const STYLE_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "textAlign", "color",
  "backgroundColor", "borderColor", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "gap", "width", "height",
] as const;

const EDIT_ID_ATTR = "data-arcade-edit-id";

/** Direct (own) text of an element, trimmed — descendant element text excluded. */
function ownText(node: Element): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
  }
  return out.trim();
}

/** A node is text-editable iff it has own text AND no child ELEMENT nodes. */
export function isTextEditable(node: Element): boolean {
  if (ownText(node) === "") return false;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) return false;
  }
  return true;
}

export function readStyleSnapshot(node: Element): StyleSnapshot {
  const cs = window.getComputedStyle(node);
  return {
    text: ownText(node),
    fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
    textAlign: cs.textAlign, color: cs.color, backgroundColor: cs.backgroundColor,
    // getComputedStyle().borderColor is "" when sides differ; top is a stable proxy
    borderColor: cs.borderTopColor,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginRight: cs.marginRight,
    marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
    gap: cs.gap, width: cs.width, height: cs.height,
  };
}

interface Entry { node: HTMLElement; original: StyleSnapshot; }
const edits = new Map<number, Entry>();
let nextId = 1;

/** Retain a clicked node under a stamped numeric editId (reused if already stamped). */
export function capture(node: HTMLElement): { editId: number; textEditable: boolean; styles: StyleSnapshot } {
  const existing = node.getAttribute(EDIT_ID_ATTR);
  const editId = existing ? Number(existing) : nextId++;
  if (!existing) node.setAttribute(EDIT_ID_ATTR, String(editId));
  const styles = readStyleSnapshot(node);
  if (!edits.has(editId)) edits.set(editId, { node, original: styles });
  return { editId, textEditable: isTextEditable(node), styles };
}

function applyPreview(editId: number, field: string, value: string) {
  const entry = edits.get(editId);
  if (!entry) return;
  if (!(STYLE_FIELDS as readonly string[]).includes(field)) {
    console.warn(`[inspector] ignored unknown preview field "${field}"`);
    return;
  }
  if (field === "borderColor" && entry.node.style.borderStyle === "") {
    entry.node.style.borderStyle = "solid";
    if (entry.node.style.borderWidth === "") entry.node.style.borderWidth = "1px";
  }
  (entry.node.style as unknown as Record<string, string>)[field] = value;
}

/** Reset one element's inline style overrides. NEVER touches textContent. */
function resetOne(editId: number) {
  const entry = edits.get(editId);
  if (!entry) return;
  for (const field of STYLE_FIELDS) {
    (entry.node.style as unknown as Record<string, string>)[field] = "";
  }
  entry.node.style.borderStyle = "";
  entry.node.style.borderWidth = "";
}

function resetAll() {
  for (const id of edits.keys()) resetOne(id);
}

function onMessage(e: MessageEvent) {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  const t = (data as { type?: unknown }).type;
  if (t === "arcade-studio:preview") {
    const { editId, field, value } = data as { editId?: number; field?: string; value?: string };
    if (typeof editId === "number" && typeof field === "string" && typeof value === "string") {
      applyPreview(editId, field, value);
    }
  } else if (t === "arcade-studio:preview-reset") {
    const { editId, all } = data as { editId?: number; all?: boolean };
    if (all) resetAll();
    else if (typeof editId === "number") resetOne(editId);
  }
}

/** In-place text editing: double-click a captured, text-editable leaf to edit. */
function onDblClick(e: MouseEvent) {
  const node = e.target as HTMLElement | null;
  if (!node) return;
  const idAttr = node.getAttribute?.(EDIT_ID_ATTR);
  if (!idAttr) return;
  const editId = Number(idAttr);
  if (!edits.has(editId) || !isTextEditable(node)) return;
  e.preventDefault();
  e.stopPropagation();
  node.setAttribute("contenteditable", "true");
  node.focus();
  const finish = () => {
    node.removeAttribute("contenteditable");
    node.removeEventListener("blur", finish);
    try {
      window.parent?.postMessage(
        { type: "arcade-studio:text-changed", editId, text: ownText(node) }, "*",
      );
    } catch { /* ignore */ }
  };
  node.addEventListener("blur", finish);
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onMessage);
  document.addEventListener("dblclick", onDblClick, true);
}
