// studio/src/lib/exportFrameToSlj.ts
import { walkFiber, type WalkCtx } from "../export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../export/fiberTypes";
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

  const mountEl = doc.getElementById("root")?.firstElementChild ?? doc.body.firstElementChild;
  if (!mountEl) throw new Error("Frame iframe has no mounted content to export");

  // Reach the React fiber from the mount DOM node, climb to the topmost fiber.
  const fiberKey = Object.keys(mountEl).find((k) => k.startsWith("__reactFiber$"));
  if (!fiberKey) throw new Error("Frame iframe mount has no React fiber (export needs the React tree)");
  let rootFiber = (mountEl as unknown as Record<string, MinimalFiber>)[fiberKey];
  while ((rootFiber as MinimalFiber & { return?: MinimalFiber | null }).return) {
    rootFiber = (rootFiber as MinimalFiber & { return: MinimalFiber }).return;
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
