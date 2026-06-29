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

import { capture } from "./inspector";
import * as overlay from "./overlay";
import { getFiberFromNode, componentNameFromType, type FiberLike } from "./fiber";
import type { OwnerLink } from "./resolveInFrameComponent";
import { readBindPath } from "./bindRead";

interface PickerSelection {
  editId: number;
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  textEditable: boolean;
  styles: import("./inspector").StyleSnapshot;
  iconCandidate?: string;
  ownerChain: OwnerLink[];
  bindPath?: string;
}

const CURSOR_STYLE_ID = "__arcade-studio-picker-cursor";
function addCursorStyle() {
  if (document.getElementById(CURSOR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CURSOR_STYLE_ID;
  style.textContent = `html[data-arcade-picker="on"] * { cursor: crosshair !important; }`;
  document.head.appendChild(style);
}
function removeCursorStyle() {
  document.getElementById(CURSOR_STYLE_ID)?.remove();
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
 * Walk the fiber `.return` chain from a node and, for every fiber that both has
 * a name and whose `_debugStack` parses to a user source file, emit an
 * OwnerLink. Order is innermost→outermost. Pure over the fiber shape (testable).
 */
export function buildOwnerChain(start: FiberLike | null): OwnerLink[] {
  const out: OwnerLink[] = [];
  let node: FiberLike | null = start;
  while (node) {
    const name =
      (typeof node.type === "function" || (node.type && typeof node.type === "object"))
        ? componentNameFromType(node.type)
        : null;
    const stack = node._debugStack?.stack;
    if (name && stack) {
      const parsed = parseFirstUserFrame(stack);
      if (parsed) out.push({ componentName: name, file: parsed.file, line: parsed.line, column: parsed.column });
    }
    node = node.return ?? null;
  }
  return out;
}

/**
 * Walk the fiber chain starting at the DOM node's fiber, finding the nearest
 * ancestor whose `_debugStack` parses cleanly to a user source file.
 */
function resolveSelection(fiber: FiberLike, domNode: HTMLElement): PickerSelection | null {
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
        const cap = capture(domNode);
        return {
          ...parsed, componentName, tagName,
          editId: cap.editId, textEditable: cap.textEditable, styles: cap.styles,
          iconCandidate: cap.iconCandidate,
          ownerChain: buildOwnerChain(fiber),
        };
      }
    }
    node = node.return ?? null;
  }
  return null;
}

/**
 * Build a minimal selection for a bound node that has no resolvable frame source
 * (e.g. a composite-internal node). Uses `capture()` to stamp an editId and
 * snapshot styles, but sets file/line/column to zero since there's no JSX location.
 */
function makeBareSelection(domNode: HTMLElement): PickerSelection {
  const cap = capture(domNode);
  const tagName = domNode.tagName.toLowerCase();
  const componentName = tagName.charAt(0).toUpperCase() + tagName.slice(1);
  return {
    editId: cap.editId,
    file: "",
    line: 0,
    column: 0,
    componentName,
    tagName,
    textEditable: cap.textEditable,
    styles: cap.styles,
    iconCandidate: cap.iconCandidate,
    ownerChain: [],
  };
}

let active = false;
let hoverTarget: Element | null = null;

function onMouseOver(e: MouseEvent) {
  if (!active) return;
  const t = e.target as Element | null;
  if (!t || t === hoverTarget) return;
  if (overlay.isOverlayElement(t as HTMLElement)) return;
  hoverTarget = t;
  overlay.showHover(t as HTMLElement);
}

function onScroll() {
  if (!active) return;
  overlay.reposition();
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

function onClick(e: MouseEvent) {
  if (!active) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  const target = e.target as Element | null;
  if (!target) {
    postCancel("no-target");
    return;
  }
  if (overlay.isOverlayElement(target as HTMLElement)) {
    return;
  }
  // Bind-first: if the clicked node is under a [data-arcade-bind], route to
  // data-editing instead of the source walk (which would bail for composite-
  // internal nodes).
  const bindPath = readBindPath(target);
  if (bindPath) {
    const fiber = getFiberFromNode(target);
    const sel = fiber ? resolveSelection(fiber, target as HTMLElement) : null;
    overlay.showSelection(target as HTMLElement);
    postPicked({
      ...(sel ?? makeBareSelection(target as HTMLElement)),
      bindPath,
    });
    return;
  }
  const fiber = getFiberFromNode(target);
  if (!fiber) {
    postCancel("no-fiber");
    return;
  }
  const sel = resolveSelection(fiber, target as HTMLElement);
  if (!sel) {
    postCancel("no-source");
    return;
  }
  overlay.showSelection(target as HTMLElement);
  postPicked(sel);
  // Do NOT deactivate — bulk editing keeps the picker live until the panel
  // is closed/committed/discarded (parent sends frame-pick-stop) or Escape.
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
  overlay.setEnabled(true);
  addCursorStyle();
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
  overlay.clear();
  overlay.setEnabled(false);
  removeCursorStyle();
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
