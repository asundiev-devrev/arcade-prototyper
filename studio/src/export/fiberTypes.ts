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
  /** The host element's `class` attribute (space-separated), or null if none / no host. */
  hostClassName(f: MinimalFiber): string | null;
  /** Frame-relative box of the fiber's host node. */
  box(f: MinimalFiber): Box;
  /** The host element's UN-transformed layout size (offsetWidth/offsetHeight),
   *  or null when unavailable. `box()` returns the axis-aligned bbox of the
   *  possibly-rotated element, which is the wrong SIZE for a rotated frame;
   *  this gives the intrinsic size so a rotated frame can be placed correctly.
   *  Optional: only consulted when a node carries a rotation. */
  unrotatedSize?(f: MinimalFiber): { width: number; height: number } | null;
  /** The placeholder attribute of an <input>/<textarea> host (trimmed), or null
   *  when the element isn't a form field or has no placeholder. Optional: only
   *  consulted for input/textarea hosts. */
  placeholder?(f: MinimalFiber): string | null;
  /** A computed-style getter for the fiber's host node (kebab CSS props). */
  style(f: MinimalFiber): { getPropertyValue(prop: string): string };
  /** Visible text directly in the fiber's host node subtree (for prune-with-text + text leaves). */
  text(f: MinimalFiber): string | null;
  /** Direct child TEXT nodes of the host element (not descendants), concatenated
   *  + trimmed, with their union bounding box. null when the element has no
   *  own text. Lets the walk keep text that shares a parent with element kids. */
  directText(f: MinimalFiber): { text: string; box: Box } | null;
  /** SVG markup for a fiber whose host is an svg element. Returns serialized
   *  outerHTML with currentColor resolved, or null if not svg / too large. */
  svgMarkup(f: MinimalFiber): string | null;
  /** Base64-encoded PNG for img elements (or background-image hosts). Draws to
   *  off-screen canvas (cap 512x512), toDataURL, strips prefix. Returns null
   *  when CORS-tainted or not an image. */
  imageData(f: MinimalFiber): string | null;
}
