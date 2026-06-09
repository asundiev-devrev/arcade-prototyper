// studio/src/export/fiberWalk.ts
import type { ElementStyle, Layout, SljNode } from "./slj";
import { inferLayout, type StyleLike } from "./inferLayout";
import { fiberName, type FiberReader, type MinimalFiber } from "./fiberTypes";

export interface WalkCtx {
  reader: FiberReader;
  /** Classify a component name: a mapped Figma primitive, an icon, a composite (frame+recurse), or null=unknown (treat as composite). */
  isComponent: (name: string) => "primitive" | "icon" | "composite" | null;
  /** Resolve a computed color to a token name or raw value (the existing tokenIndex resolveToken, curried). */
  resolveColor: (value: string) => string;
  /** Radix/internal wrappers to pass through transparently. */
  isSkippable: (name: string) => boolean;
  /** For a fiber being pruned as a mapped primitive, the arcade-gen name of the
   *  first icon-mapped descendant (e.g. "ChevronLeftSmall"), or null. Lets the
   *  walk record the glyph identity without un-pruning the subtree. */
  iconNameFor: (f: MinimalFiber) => string | null;
}

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", "rgba(0,0,0,0)"]);

function readStyleLike(s: { getPropertyValue(p: string): string }): StyleLike {
  const g = (p: string) => s.getPropertyValue(p);
  return { display: g("display"), flexDirection: g("flex-direction"), columnGap: g("column-gap"), rowGap: g("row-gap"),
    paddingTop: g("padding-top"), paddingRight: g("padding-right"), paddingBottom: g("padding-bottom"), paddingLeft: g("padding-left"),
    alignItems: g("align-items"), marginLeft: g("margin-left") };
}

function elementStyle(s: { getPropertyValue(p: string): string }, resolveColor: (v: string) => string): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("background-color");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveColor(bg);
  const radius = parseFloat(s.getPropertyValue("border-top-left-radius"));
  if (Number.isFinite(radius) && radius > 0) out.cornerRadius = radius;
  const sw = parseFloat(s.getPropertyValue("border-top-width"));
  if (Number.isFinite(sw) && sw > 0) out.stroke = { color: resolveColor(s.getPropertyValue("border-top-color")), width: sw };
  return out;
}

/** Serializable scalar props only (drop functions, ReactNodes). */
function scalarProps(props: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

/** The meaningful child fibers under a fiber: descend skip-list wrappers + unnamed
 *  non-host (fragments/context), collect the next host OR named-component fibers. */
function childFibers(f: MinimalFiber, ctx: WalkCtx): MinimalFiber[] {
  const out: MinimalFiber[] = [];
  const visit = (c: MinimalFiber | null) => {
    for (let n: MinimalFiber | null = c; n; n = n.sibling) {
      const nm = fiberName(n);
      if (nm && ctx.isSkippable(nm)) { visit(n.child); continue; } // transparent wrapper
      if (nm || ctx.reader.hostTag(n) !== null) { out.push(n); continue; } // a real node
      visit(n.child); // unnamed non-host (fragment/context) → descend
    }
  };
  visit(f.child);
  return out;
}

export function walkFiber(rootFiber: MinimalFiber, ctx: WalkCtx): SljNode {
  function walk(f: MinimalFiber): SljNode | null {
    const nm = fiberName(f);

    // Skip-list wrapper: pass through to its first meaningful child.
    if (nm && ctx.isSkippable(nm)) {
      const kids = childFibers(f, ctx);
      return kids.length ? walk(kids[0]) : null;
    }

    if (nm) {
      const cls = ctx.isComponent(nm);
      if (cls === "primitive" || cls === "icon") {
        // PRUNE-WITH-TEXT: emit a component node; do NOT serialize internals.
        // Carry a single text child when the host subtree has visible text so the
        // planner's firstText() override works.
        const box = ctx.reader.box(f);
        const text = ctx.reader.text(f);
        const children: SljNode[] = text
          ? [{ kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] }]
          : [];
        const icon = ctx.iconNameFor(f) ?? undefined;
        return { kind: "component", component: nm, source: "arcade/components", props: scalarProps(f.memoizedProps), box, layout: null, children, icon };
      }
      // composite / unknown → fall through to a frame that recurses
    }

    // host element, or composite/unknown component treated as a frame
    const tag = ctx.reader.hostTag(f);
    const box = ctx.reader.box(f);
    const text = ctx.reader.text(f);
    const kids = childFibers(f, ctx);

    // text leaf: visible text + no element children
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] };
    }

    const childNodes = kids.map(walk).filter((n): n is SljNode => n !== null);
    const childBoxes = kids.map((k) => ctx.reader.box(k));
    const s = ctx.reader.style(f);
    const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);
    return { kind: "element", tag: tag ?? "div", box, layout, style: elementStyle(s, ctx.resolveColor), children: childNodes };
  }
  const root = walk(rootFiber);
  if (!root) throw new Error("fiberWalk: root produced no node");
  return root;
}
