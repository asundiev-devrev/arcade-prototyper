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

import { componentNameOf } from "./fiber";

export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
  minWidth: string; maxWidth: string; minHeight: string; maxHeight: string;
  display: string; flexDirection: string;
  opacity: string; borderRadius: string;
  appliedTokens: { color?: string; backgroundColor?: string; borderColor?: string; typeStyle?: string };
}

const STYLE_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "textAlign", "color",
  "backgroundColor", "borderColor", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "gap", "width", "height",
  "minWidth", "maxWidth", "minHeight", "maxHeight", "display", "flexDirection", "opacity", "borderRadius",
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

const TYPE_CLASS_RE = /^text-(body|title|caption|heading|display|label)[a-z-]*$/;

function scanAppliedTokens(node: Element): StyleSnapshot["appliedTokens"] {
  const out: StyleSnapshot["appliedTokens"] = {};
  for (const cls of Array.from(node.classList)) {
    if (TYPE_CLASS_RE.test(cls)) out.typeStyle = cls;
    else {
      const m = /^(text|bg|border)-\((--[a-z0-9-]+)\)$/.exec(cls);
      if (m) {
        if (m[1] === "text") out.color = cls;
        else if (m[1] === "bg") out.backgroundColor = cls;
        else out.borderColor = cls;
      }
    }
  }
  return out;
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
    minWidth: cs.minWidth, maxWidth: cs.maxWidth, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
    display: cs.display, flexDirection: cs.flexDirection,
    opacity: cs.opacity, borderRadius: cs.borderTopLeftRadius,
    appliedTokens: scanAppliedTokens(node),
  };
}

/** Resolve the swappable icon node: the single <svg> in the picked subtree
 *  (inclusive) whose owning component has a name. Returns null if zero or >1. */
function resolveIconNode(node: HTMLElement): { el: Element; name: string } | null {
  const svgs: Element[] = [];
  if (node.tagName.toLowerCase() === "svg") svgs.push(node);
  node.querySelectorAll("svg").forEach((s) => svgs.push(s));
  // de-dup (node itself may also match querySelectorAll on nested, but svg can't contain svg here)
  const unique = Array.from(new Set(svgs));
  if (unique.length !== 1) return null;
  const el = unique[0];
  const name = componentNameOf(el);
  if (!name) return null;
  return { el, name };
}

interface Entry { node: HTMLElement; original: StyleSnapshot; iconEl?: Element; iconOriginalHTML?: string; }
const edits = new Map<number, Entry>();
const previewClasses = new Map<number, Set<string>>(); // editId -> classes we added
let nextId = 1;

/** Retain a clicked node under a stamped numeric editId (reused if already stamped). */
export function capture(node: HTMLElement): { editId: number; textEditable: boolean; styles: StyleSnapshot; iconCandidate?: string } {
  const existing = node.getAttribute(EDIT_ID_ATTR);
  const editId = existing ? Number(existing) : nextId++;
  if (!existing) node.setAttribute(EDIT_ID_ATTR, String(editId));
  const styles = readStyleSnapshot(node);
  const icon = resolveIconNode(node);
  if (!edits.has(editId)) {
    edits.set(editId, { node, original: styles, iconEl: icon?.el, iconOriginalHTML: icon?.el.innerHTML });
  }
  return { editId, textEditable: isTextEditable(node), styles, iconCandidate: icon?.name };
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

function applyPreviewClass(editId: number, className: string, prevClassName?: string, slot?: string) {
  const entry = edits.get(editId);
  if (!entry) return;
  // remove the previous token class for this slot if present
  if (prevClassName) entry.node.classList.remove(prevClassName);
  entry.node.classList.add(className);
  let set = previewClasses.get(editId);
  if (!set) { set = new Set(); previewClasses.set(editId, set); }
  set.add(className);

  // Color slots: the dynamically-built token class (e.g. `bg-(--bg-neutral-
  // medium)`) is usually NOT a literal in any scanned source file, so Tailwind
  // v4 never compiled a rule for it — adding the class alone shows nothing.
  // Drive the preview with the token's var() chain inline instead; it resolves
  // against the frame's token CSS regardless of whether the class compiled.
  // (Commit is unaffected — it writes the class into source, which Tailwind
  // then rescans and compiles.)
  if (slot === "color" || slot === "backgroundColor" || slot === "borderColor") {
    const token = tokenFromColorClass(className);
    const styleSlot = slot as "color" | "backgroundColor" | "borderColor";
    if (slot === "borderColor" && entry.node.style.borderStyle === "") {
      entry.node.style.borderStyle = "solid";
      if (entry.node.style.borderWidth === "") entry.node.style.borderWidth = "1px";
    }
    entry.node.style[styleSlot] = token ? `var(${token})` : "";
  }
}

/** Extract the `--token` from a color utility class like `bg-(--bg-neutral-medium)`. */
function tokenFromColorClass(className: string): string | null {
  const m = /^(?:text|bg|border)-\((--[a-z0-9-]+)\)$/.exec(className.trim());
  return m ? m[1] : null;
}

function applyPreviewIcon(editId: number, svg: string) {
  const entry = edits.get(editId);
  if (!entry?.iconEl) return;
  // extract inner markup if a full <svg> wrapper was passed
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  entry.iconEl.innerHTML = m ? m[1] : svg;
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
  const cls = previewClasses.get(editId);
  if (cls) { for (const c of cls) entry.node.classList.remove(c); previewClasses.delete(editId); }
  if (entry.iconEl && entry.iconOriginalHTML != null) entry.iconEl.innerHTML = entry.iconOriginalHTML;
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
  } else if (t === "arcade-studio:preview-class") {
    const { editId, slot, className, prevClassName } = data as
      { editId?: number; slot?: string; className?: string; prevClassName?: string };
    if (typeof editId === "number" && typeof className === "string") {
      applyPreviewClass(editId, className, prevClassName, slot);
    }
  } else if (t === "arcade-studio:preview-icon") {
    const { editId, svg } = data as { editId?: number; svg?: string };
    if (typeof editId === "number" && typeof svg === "string") applyPreviewIcon(editId, svg);
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
  const onEditKeyDown = (ke: KeyboardEvent) => {
    // Interactive elements (button/a/summary) consume Space/Enter for native
    // activation instead of editing text. Handle them manually.
    if (ke.key === " ") {
      ke.preventDefault();
      ke.stopPropagation();
      document.execCommand("insertText", false, " ");
    } else if (ke.key === "Enter") {
      ke.preventDefault();
      ke.stopPropagation();
      node.blur(); // commit (single-line inline edit)
    }
  };
  const finish = () => {
    node.removeAttribute("contenteditable");
    node.removeEventListener("blur", finish);
    node.removeEventListener("keydown", onEditKeyDown, true);
    try {
      window.parent?.postMessage(
        { type: "arcade-studio:text-changed", editId, text: ownText(node) }, "*",
      );
    } catch { /* ignore */ }
  };
  node.addEventListener("keydown", onEditKeyDown, true);
  node.addEventListener("blur", finish);
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onMessage);
  document.addEventListener("dblclick", onDblClick, true);
}
