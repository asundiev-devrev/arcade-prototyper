// studio/src/lib/exportFrameToSlj.ts
import { walkFiber, type WalkCtx } from "../export/fiberWalk";
import { fiberName, type MinimalFiber, type FiberReader } from "../export/fiberTypes";
import { buildTokenIndex, tokenNamesFromRoot, resolveToken } from "../export/tokenIndex";
import { SLJ_VERSION, type SljDocument, type Box } from "../export/slj";
import { findComponentMapping } from "../export/figma/componentMap";
import { findIconMapping } from "../export/figma/iconMap";

interface ExportArgs {
  iframe: HTMLIFrameElement;
  projectSlug: string;
  frameSlug: string;
  mode: "light" | "dark";
  width: number;
}

// Wrappers the fiber walk should pass through transparently (harness + Radix
// internals, not real UI). Extend as live runs surface more.
const SKIPPABLE = new Set([
  "DevRevThemeProvider", "FrameFontProxy", "FrameErrorBoundary",
  "MenuProvider", "DropdownMenuProvider", "DropdownMenu", "Provider",
  "Root", "Group", "Slot", "Portal", "Presence",
]);

/** Read the same-origin frame iframe's live React tree, walk it to SLJ, POST it. */
export async function exportFrameToSlj(args: ExportArgs): Promise<SljDocument> {
  const doc = args.iframe.contentDocument;
  const win = args.iframe.contentWindow as (Window & typeof globalThis) | null;
  if (!doc || !win) throw new Error("Frame iframe document is unreachable (cross-origin or not loaded)");

  // Reach the React fiber from the ReactDOM root container, NOT by climbing
  // `.return` off a mounted child. Under StrictMode the `.return` climb can
  // land on a stale alternate tree whose async-loaded subtrees (e.g. the chat
  // transcript) were never committed, silently dropping whole regions. The
  // container's `__reactContainer$<id>` key points at the live committed
  // HostRoot fiber — the correct, complete tree.
  const rootEl = doc.getElementById("root") ?? doc.body;
  if (!rootEl) throw new Error("Frame iframe has no #root container to export");
  const containerKey = Object.keys(rootEl).find((k) => k.startsWith("__reactContainer$"));
  let rootFiber: MinimalFiber;
  if (containerKey) {
    rootFiber = (rootEl as unknown as Record<string, MinimalFiber>)[containerKey];
  } else {
    // Fallback: older React or a detached mount — reach via a child's fiber
    // and climb. Less reliable under StrictMode but better than failing.
    const mountEl = rootEl.firstElementChild ?? doc.body.firstElementChild;
    if (!mountEl) throw new Error("Frame iframe has no mounted content to export");
    const fiberKey = Object.keys(mountEl).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) throw new Error("Frame iframe mount has no React fiber (export needs the React tree)");
    rootFiber = (mountEl as unknown as Record<string, MinimalFiber>)[fiberKey];
    while ((rootFiber as MinimalFiber & { return?: MinimalFiber | null }).return) {
      rootFiber = (rootFiber as MinimalFiber & { return: MinimalFiber }).return;
    }
  }

  // Token index from the iframe's :root computed style (DevRevThemeProvider injected them).
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const tokenNames = tokenNamesFromRoot(rootStyle);
  const tokenIndex = buildTokenIndex(tokenNames, (n) => rootStyle.getPropertyValue(n));

  // Resolve a fiber's host DOM node: descend .child until a real Element stateNode.
  const hostOf = (f: MinimalFiber): Element | null => {
    let c: MinimalFiber | null = f;
    let guard = 0;
    while (c && guard++ < 60) {
      if (c.stateNode instanceof win.Element) return c.stateNode as Element;
      c = c.child;
    }
    return null;
  };

  const reader: FiberReader = {
    hostTag: (f) => { const h = hostOf(f); return h ? h.tagName.toLowerCase() : null; },
    box: (f) => {
      const h = hostOf(f);
      if (!h) return { x: 0, y: 0, width: 0, height: 0 } as Box;
      const r = h.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    style: (f) => { const h = hostOf(f); return h ? win.getComputedStyle(h) : { getPropertyValue: () => "" }; },
    text: (f) => { const h = hostOf(f); const t = h?.textContent?.trim(); return t && t.length > 0 ? t : null; },
  };

  const ctx: WalkCtx = {
    reader,
    isComponent: (name) => {
      if (findIconMapping(name)) return "icon";
      const m = findComponentMapping(name);
      if (m && m.status === "mapped") return "primitive";
      return "composite";
    },
    resolveColor: (value) => resolveToken(tokenIndex, value),
    isSkippable: (name) => SKIPPABLE.has(name),
    // Glyph capture: when pruning a mapped primitive (e.g. an IconButton),
    // scan its fiber subtree for the first icon-mapped descendant and return
    // that arcade-gen name (e.g. "ChevronLeftSmall"). Bounded BFS so a deep
    // subtree can't stall the walk; null when no recognized icon is inside.
    iconNameFor: (f: MinimalFiber): string | null => {
      const queue: (MinimalFiber | null)[] = [f.child];
      let guard = 0;
      while (queue.length && guard++ < 200) {
        const n = queue.shift();
        if (!n) continue;
        const name = fiberName(n);
        if (name && findIconMapping(name)) return name;
        if (n.child) queue.push(n.child);
        if (n.sibling) queue.push(n.sibling);
      }
      return null;
    },
  };

  const root = walkFiber(rootFiber, ctx);
  const slj: SljDocument = {
    slj: SLJ_VERSION,
    frame: { slug: args.frameSlug, project: args.projectSlug, width: args.width, mode: args.mode },
    root,
  };

  const res = await fetch(`/api/projects/${args.projectSlug}/export/${args.frameSlug}.slj.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slj),
  });
  if (!res.ok) throw new Error(`SLJ save failed: ${res.status}`);
  return slj;
}
