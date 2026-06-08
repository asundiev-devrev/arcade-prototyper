// studio/src/export/fiberTypes.ts
import type { Box } from "./slj";

/** The subset of a React fiber the walk reads. A real React 19 fiber satisfies this. */
export interface MinimalFiber {
  type: unknown;                       // string (host) | function | {render|displayName} | null (text)
  child: MinimalFiber | null;
  sibling: MinimalFiber | null;
  memoizedProps: Record<string, unknown> | null;
  stateNode?: unknown;                 // Element for host fibers
}

/** Component name for a fiber, or null for host elements / text / unnamed. */
export function fiberName(f: MinimalFiber): string | null {
  const t = f.type as any;
  if (typeof t === "function") return t.displayName || t.name || null;
  if (t && typeof t === "object") return t.displayName || (t.render && (t.render.displayName || t.render.name)) || null;
  return null; // host string, or null (text)
}

/** Abstracts the host-DOM reads (geometry + computed style + tag + text) for a
 *  fiber, so fiberWalk is testable with fakes. The live impl resolves the
 *  fiber's host DOM node (descend .child to first Element stateNode). */
export interface FiberReader {
  /** Host tag for a host fiber (e.g. "div","svg","button"), or null if none. */
  hostTag(f: MinimalFiber): string | null;
  /** Frame-relative box of the fiber's host node. */
  box(f: MinimalFiber): Box;
  /** A computed-style getter for the fiber's host node (kebab CSS props). */
  style(f: MinimalFiber): { getPropertyValue(prop: string): string };
  /** Visible text directly in the fiber's host node subtree (for prune-with-text + text leaves). */
  text(f: MinimalFiber): string | null;
}
