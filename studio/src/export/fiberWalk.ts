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

// Capture computed text styling for a text leaf. Only sets fields that parse.
function textStyle(
  s: { getPropertyValue(p: string): string },
  resolveColor: (v: string) => string,
  characters: string,
): ElementStyle {
  const out: ElementStyle = { characters };
  const color = s.getPropertyValue("color");
  if (color) out.color = resolveColor(color);
  const size = parseFloat(s.getPropertyValue("font-size"));
  if (Number.isFinite(size) && size > 0) out.fontSize = size;
  const weight = parseFloat(s.getPropertyValue("font-weight"));
  if (Number.isFinite(weight) && weight > 0) out.fontWeight = weight;
  const family = s.getPropertyValue("font-family");
  if (family) out.fontFamily = family;
  const lh = parseFloat(s.getPropertyValue("line-height"));
  if (Number.isFinite(lh) && lh > 0) out.lineHeight = lh;
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
  function walk(f: MinimalFiber, isRoot: boolean): SljNode | null {
    const nm = fiberName(f);

    // Skip-list wrapper: pass through to its first meaningful child.
    if (nm && ctx.isSkippable(nm)) {
      const kids = childFibers(f, ctx);
      return kids.length ? walk(kids[0], false) : null;
    }

    // Skip invisible nodes (except root): display:none OR visibility:hidden
    // Also skip 0×0 boxes, but only if they have explicit display/visibility styling
    // (avoids false positives from test fixtures with unmeasured elements).
    if (!isRoot) {
      const s = ctx.reader.style(f);
      const display = s.getPropertyValue("display");
      const visibility = s.getPropertyValue("visibility");
      if (display === "none" || visibility === "hidden") {
        return null;
      }
      // Additional check: 0×0 box combined with positioning (absolute fibers in Radix Tabs)
      const box = ctx.reader.box(f);
      const position = s.getPropertyValue("position");
      if (box.width === 0 && box.height === 0 && (position === "absolute" || position === "fixed")) {
        return null;
      }
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
          ? [{ kind: "element", tag: "text", box, layout: null, style: textStyle(ctx.reader.style(f), ctx.resolveColor, text), children: [] }]
          : [];
        const icon = ctx.iconNameFor(f) ?? undefined;
        return { kind: "component", component: nm, source: "arcade/components", props: scalarProps(f.memoizedProps), box, layout: null, children, icon };
      }
      // composite / unknown → fall through to a frame that recurses (carry name)
    }

    // host element, or composite/unknown component treated as a frame
    const tag = ctx.reader.hostTag(f);
    const box = ctx.reader.box(f);
    const text = ctx.reader.text(f);
    const kids = childFibers(f, ctx);

    // Name for Figma layer: component name for composites, semantic tag for host elements
    const SEMANTIC_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "nav", "aside", "header", "footer", "main", "section", "ul", "ol", "li", "button", "a", "img", "form", "table"]);
    const name = nm ?? (tag && SEMANTIC_TAGS.has(tag) ? tag : undefined);

    // text leaf: visible text + no element children
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: textStyle(ctx.reader.style(f), ctx.resolveColor, text), children: [] };
    }

    // Read style once, used for both text styling and element styling
    const s = ctx.reader.style(f);

    const childNodes = kids.map((k) => walk(k, false)).filter((n): n is SljNode => n !== null);

    // Mixed content: an element with BOTH direct text nodes and element
    // children (e.g. <div>Let's prepare <span>next meeting.</span></div>).
    // childFibers can't see HostText fibers, so read the DOM's direct text
    // and keep it as a sibling text leaf — otherwise it is silently lost.
    if (kids.length > 0) {
      const direct = ctx.reader.directText(f);
      if (direct) {
        childNodes.unshift({ kind: "element", tag: "text", box: direct.box, layout: null,
          style: textStyle(s, ctx.resolveColor, direct.text), children: [] });
      }
    }

    const childBoxes = kids.map((k) => ctx.reader.box(k));
    const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);
    const cls = ctx.reader.hostClassName(f);
    return {
      kind: "element",
      tag: tag ?? "div",
      ...(cls ? { className: cls } : {}),
      ...(name ? { name } : {}),
      box,
      layout,
      style: elementStyle(s, ctx.resolveColor),
      children: childNodes,
    };
  }
  const root = walk(rootFiber, true);
  if (!root) throw new Error("fiberWalk: root produced no node");
  return root;
}
