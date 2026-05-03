/**
 * Element picker overlay that runs inside a frame iframe. When activated by
 * the parent window, it paints a hover outline on elements under the cursor
 * and intercepts the next click to identify which JSX element the clicked
 * DOM node came from. The result is posted back to the parent via
 * `postMessage`.
 *
 * How source info is resolved (React 19):
 *   React 19 no longer exposes `_debugSource` on fibers. Instead, every
 *   element carries `_debugStack` — an Error whose stack trace's top frames
 *   are the JSX call sites. We walk the fiber chain starting from the DOM
 *   node's fiber, pick the first fiber that has a `_debugStack`, and parse
 *   the first user-land frame out of the stack.
 *
 *   This uses React internals (fiber keys, `_debugStack`, `_debugOwner`) —
 *   fine for a dev-only feature, would not survive a production build.
 */

interface PickerSelection {
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
}

const OUTLINE_ID = "__arcade-studio-picker-outline";
const STYLE_ID = "__arcade-studio-picker-style";

function ensureOverlay(): { outline: HTMLDivElement } {
  let outline = document.getElementById(OUTLINE_ID) as HTMLDivElement | null;
  if (!outline) {
    outline = document.createElement("div");
    outline.id = OUTLINE_ID;
    outline.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:2px solid #3b82f6",
      "background:rgba(59,130,246,0.08)",
      "border-radius:2px",
      "transition:top 60ms linear,left 60ms linear,width 60ms linear,height 60ms linear",
      "display:none",
    ].join(";");
    document.body.appendChild(outline);
  }
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `html[data-arcade-picker="on"] * { cursor: crosshair !important; }`;
    document.head.appendChild(style);
  }
  return { outline };
}

function removeOverlay() {
  document.getElementById(OUTLINE_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

type FiberLike = {
  _debugStack?: { stack?: string } | null;
  _debugOwner?: FiberLike | null;
  type?: unknown;
  elementType?: unknown;
  stateNode?: unknown;
  return?: FiberLike | null;
};

function getFiberFromNode(node: Element): FiberLike | null {
  const key = Object.keys(node).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!key) return null;
  return (node as unknown as Record<string, FiberLike>)[key] ?? null;
}

function componentNameFromType(type: unknown): string | null {
  if (!type) return null;
  if (typeof type === "string") return type;
  const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
  if (t.displayName) return t.displayName;
  if (t.name) return t.name;
  if (t.render?.displayName) return t.render.displayName;
  if (t.render?.name) return t.render.name;
  return null;
}

/**
 * Parses a V8 stack trace and returns the first frame that points into a
 * file under the user's frames directory. Returns null if no such frame
 * exists (e.g. the click landed on a React-internal node).
 *
 * V8 frame format:  "    at Component (http://host/path/file.tsx?v=123:42:15)"
 * Anonymous frames: "    at http://host/path/file.tsx?v=123:42:15"
 */
function parseFirstUserFrame(stack: string): { file: string; line: number; column: number } | null {
  const lines = stack.split("\n");
  for (const line of lines) {
    const m =
      line.match(/\(((https?:\/\/|file:\/\/)[^)]+):(\d+):(\d+)\)/) ||
      line.match(/at\s+((?:https?:\/\/|file:\/\/)[^\s]+):(\d+):(\d+)/);
    if (!m) continue;
    const url = m[1];
    // Skip React / node_modules / HMR runtime frames — they can't be what
    // the user clicked on.
    if (
      /\/node_modules\//.test(url) ||
      /\/@react-refresh\b/.test(url) ||
      /\/@vite\b/.test(url) ||
      /\/@id\/virtual:/.test(url) ||
      /react-jsx/.test(url) ||
      /\/react-dom[-\/]/.test(url)
    ) {
      continue;
    }
    const lineNo = Number(m[m.length - 2]);
    const colNo = Number(m[m.length - 1]);
    // Strip origin + query string for a readable path.
    let file = url;
    try {
      const u = new URL(url);
      file = u.pathname;
    } catch {
      // already a path-like string
    }
    return { file, line: lineNo, column: colNo };
  }
  return null;
}

/**
 * Walk the fiber chain starting at the DOM node's fiber, finding the nearest
 * ancestor whose `_debugStack` parses cleanly to a user source file.
 */
function resolveSelection(fiber: FiberLike): PickerSelection | null {
  let node: FiberLike | null = fiber;
  while (node) {
    const stack = node._debugStack?.stack;
    if (stack) {
      const parsed = parseFirstUserFrame(stack);
      if (parsed) {
        const tagName =
          typeof node.type === "string" ? node.type : (componentNameFromType(node.type) ?? "");
        const componentName =
          (node._debugOwner && componentNameFromType(node._debugOwner.type)) ||
          tagName ||
          "Element";
        return { ...parsed, componentName, tagName };
      }
    }
    node = node.return ?? null;
  }
  return null;
}

let active = false;
let hoverTarget: Element | null = null;

function positionOutline(target: Element | null) {
  const { outline } = ensureOverlay();
  if (!target) {
    outline.style.display = "none";
    return;
  }
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    outline.style.display = "none";
    return;
  }
  outline.style.display = "block";
  outline.style.top = `${rect.top}px`;
  outline.style.left = `${rect.left}px`;
  outline.style.width = `${rect.width}px`;
  outline.style.height = `${rect.height}px`;
}

function onMouseOver(e: MouseEvent) {
  if (!active) return;
  const t = e.target as Element | null;
  if (!t || t === hoverTarget) return;
  hoverTarget = t;
  positionOutline(t);
}

function onScroll() {
  if (!active) return;
  positionOutline(hoverTarget);
}

function postPicked(sel: PickerSelection) {
  try {
    window.parent?.postMessage({ type: "arcade-studio:frame-picked", selection: sel }, "*");
  } catch {}
}

function postCancel(reason: string) {
  try {
    window.parent?.postMessage({ type: "arcade-studio:frame-pick-cancelled", reason }, "*");
  } catch {}
}

function flashOutlineAndFinish(ok: boolean, finish: () => void) {
  const { outline } = ensureOverlay();
  if (outline.style.display === "none") {
    finish();
    return;
  }
  const color = ok ? "#10b981" : "#ef4444";
  const bg = ok ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)";
  outline.style.transition = "none";
  outline.style.borderColor = color;
  outline.style.background = bg;
  window.setTimeout(finish, 180);
}

function onClick(e: MouseEvent) {
  if (!active) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  const target = e.target as Element | null;
  if (!target) {
    flashOutlineAndFinish(false, () => {
      postCancel("no-target");
      deactivate();
    });
    return;
  }
  const fiber = getFiberFromNode(target);
  if (!fiber) {
    flashOutlineAndFinish(false, () => {
      postCancel("no-fiber");
      deactivate();
    });
    return;
  }
  const sel = resolveSelection(fiber);
  if (!sel) {
    flashOutlineAndFinish(false, () => {
      postCancel("no-source");
      deactivate();
    });
    return;
  }
  flashOutlineAndFinish(true, () => {
    postPicked(sel);
    deactivate();
  });
}

function onKeyDown(e: KeyboardEvent) {
  if (!active) return;
  if (e.key === "Escape") {
    e.preventDefault();
    postCancel("escape");
    deactivate();
  }
}

export function activate() {
  if (active) return;
  active = true;
  ensureOverlay();
  document.documentElement.setAttribute("data-arcade-picker", "on");
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
}

export function deactivate() {
  if (!active) return;
  active = false;
  hoverTarget = null;
  document.documentElement.removeAttribute("data-arcade-picker");
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  removeOverlay();
}

function onParentMessage(e: MessageEvent) {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  const t = (data as { type?: unknown }).type;
  if (t === "arcade-studio:frame-pick-start") activate();
  else if (t === "arcade-studio:frame-pick-stop") deactivate();
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onParentMessage);
}
