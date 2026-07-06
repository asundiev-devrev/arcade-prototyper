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
import { toSourcePosition } from "./sourceLocate";

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
function parseFirstUserFrame(
  stack: string,
): { file: string; moduleUrl: string; line: number; column: number } | null {
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
    // Keep the FULL url (origin + path + query) as `moduleUrl` — that is what
    // we append `.map` to for source-map translation, and the query carries
    // Vite's version token that keys the served map. `file` is the readable
    // pathname used for display + frame-slug matching downstream.
    let file = url;
    try {
      file = new URL(url).pathname;
    } catch {
      // already a path-like string
    }
    return { file, moduleUrl: url, line: lineNo, column: colNo };
  }
  return null;
}

/**
 * Walk the fiber `.return` chain from a node and, for every fiber that both has
 * a name and whose `_debugStack` parses to a user source file, emit an
 * OwnerLink. Order is innermost→outermost. Pure over the fiber shape (testable).
 */
export async function buildOwnerChain(start: FiberLike | null): Promise<OwnerLink[]> {
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
      if (parsed) {
        // Translate the transformed call-site back to source coords so the
        // resolved in-frame component's line:column matches the on-disk file.
        const src = await toSourcePosition(parsed.moduleUrl, parsed.line, parsed.column);
        out.push({ componentName: name, file: parsed.file, line: src.line, column: src.column });
      }
    }
    node = node.return ?? null;
  }
  return out;
}

/**
 * Walk the fiber chain starting at the DOM node's fiber, finding the nearest
 * ancestor whose `_debugStack` parses cleanly to a user source file.
 */
async function resolveSelection(fiber: FiberLike, domNode: HTMLElement): Promise<PickerSelection | null> {
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
        // Translate the transformed click location back to the on-disk source
        // line:column. Without this, `line`/`column` point into Vite's expanded
        // module (e.g. line 2295 of a 2500-line served file) and never match
        // the 262-line source that both `locateJsx` and the agent edit.
        const src = await toSourcePosition(parsed.moduleUrl, parsed.line, parsed.column);
        return {
          file: parsed.file, line: src.line, column: src.column,
          componentName, tagName,
          editId: cap.editId, textEditable: cap.textEditable, styles: cap.styles,
          iconCandidate: cap.iconCandidate,
          ownerChain: await buildOwnerChain(fiber),
        };
      }
    }
    node = node.return ?? null;
  }
  return null;
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
  const fiber = getFiberFromNode(target);
  if (!fiber) {
    postCancel("no-fiber");
    return;
  }
  // Show the selection outline immediately (sync), then resolve source coords
  // (async: the first pick on a frame fetches its source map) and post. The
  // picker stays live either way — bulk editing continues until the parent
  // sends frame-pick-stop or the user hits Escape.
  overlay.showSelection(target as HTMLElement);
  void (async () => {
    const sel = await resolveSelection(fiber, target as HTMLElement);
    if (!sel) {
      postCancel("no-source");
      return;
    }
    postPicked(sel);
  })();
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
