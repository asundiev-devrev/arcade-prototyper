/**
 * In-iframe companion to picker.ts. After the picker resolves a clicked
 * element, it hands the DOM node here via `capture()`. We retain that node,
 * read a computed-style snapshot to seed the shell's inspector panel, and
 * apply throwaway INLINE-style previews when the parent posts
 * `arcade-studio:preview` messages.
 *
 * Why inline (not a managed stylesheet): Studio frames are className-styled
 * static prototypes and the picker intercepts clicks during a session, so
 * React never reconciles the `style` prop we set out-of-band. Preview is
 * disposable — the committed result always comes from the shell's `pending`
 * state, never read back from here.
 *
 * Dev-only: relies on the same iframe/React-internals constraints as picker.ts.
 */

export interface StyleSnapshot {
  text: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string;
  width: string; height: string;
}

// CSS properties we preview (every key except `text`). Kept as a const so the
// message handler can validate incoming field names.
const STYLE_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "textAlign", "color",
  "backgroundColor", "borderColor", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "gap", "width", "height",
] as const;

/** Direct (own) text of an element, trimmed — descendant text excluded. */
function ownText(node: Element): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
  }
  return out.trim();
}

export function readStyleSnapshot(node: Element): StyleSnapshot {
  const cs = window.getComputedStyle(node);
  return {
    text: ownText(node),
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    textAlign: cs.textAlign,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    // getComputedStyle().borderColor returns "" when sides differ; use top as stable proxy
    borderColor: cs.borderTopColor,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginRight: cs.marginRight,
    marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
    gap: cs.gap,
    width: cs.width, height: cs.height,
  };
}

let editingNode: HTMLElement | null = null;
let originalSnapshot: StyleSnapshot | null = null;

/** Called by picker.ts on a successful pick. Retains the node + returns its snapshot. */
export function capture(node: HTMLElement): StyleSnapshot {
  // If we had a previous edit session, auto-reset that old node before capturing the new one.
  if (editingNode && originalSnapshot && editingNode !== node) {
    for (const field of STYLE_FIELDS) {
      (editingNode.style as unknown as Record<string, string>)[field] = "";
    }
    editingNode.style.borderStyle = "";
    editingNode.style.borderWidth = "";
    editingNode.textContent = originalSnapshot.text;
  }
  editingNode = node;
  originalSnapshot = readStyleSnapshot(node);
  return originalSnapshot;
}

function applyField(field: string, value: string) {
  if (!editingNode) return;
  if (field === "text") {
    editingNode.textContent = value;
    return;
  }
  if ((STYLE_FIELDS as readonly string[]).includes(field)) {
    // border preview needs a visible style+width or color alone won't paint
    if (field === "borderColor" && editingNode.style.borderStyle === "") {
      editingNode.style.borderStyle = "solid";
      if (editingNode.style.borderWidth === "") editingNode.style.borderWidth = "1px";
    }
    (editingNode.style as unknown as Record<string, string>)[field] = value;
  } else {
    console.warn(`[inspector] ignored unknown preview field "${field}"`);
  }
}

function resetAll() {
  if (!editingNode || !originalSnapshot) return;
  // Clearing our inline overrides returns the node to its className-driven styles.
  for (const field of STYLE_FIELDS) {
    (editingNode.style as unknown as Record<string, string>)[field] = "";
  }
  editingNode.style.borderStyle = "";
  editingNode.style.borderWidth = "";
  editingNode.textContent = originalSnapshot.text;
}

function onMessage(e: MessageEvent) {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  const t = (data as { type?: unknown }).type;
  if (t === "arcade-studio:preview") {
    const { field, value } = data as { field?: string; value?: string };
    if (typeof field === "string" && typeof value === "string") applyField(field, value);
  } else if (t === "arcade-studio:preview-reset") {
    resetAll();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onMessage);
}
