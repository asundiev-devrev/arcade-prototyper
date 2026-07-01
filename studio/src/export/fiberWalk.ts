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

const CLIP_VALUES = new Set(["hidden", "clip", "auto", "scroll"]);

function parseBoxShadow(raw: string): ElementStyle["shadow"] | undefined {
  if (!raw || raw === "none") return undefined;
  // Computed format: "rgba(r, g, b, a) Xpx Ypx Bpx Spx" or "rgb(...) X Y B"
  const m = raw.match(/^(rgba?\([^)]+\))\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px(?:\s+([-\d.]+)px)?/);
  if (!m) return undefined;
  return { color: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), blur: parseFloat(m[4]), spread: m[5] !== undefined ? parseFloat(m[5]) : 0 };
}

const HIDDEN_BORDER_STYLES = new Set(["none", "hidden"]);

/** rotation degrees (clockwise) decoded from a computed `transform` matrix, or
 *  undefined when there's no meaningful rotation. */
function rotationDegrees(transform: string): number | undefined {
  if (!transform || transform === "none") return undefined;
  // 2D form: matrix(a, b, c, d, e, f). rotation = atan2(b, a).
  const m = transform.match(/^matrix\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,/);
  if (!m) return undefined;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return Math.abs(deg) > 0.1 ? deg : undefined;
}

function elementStyle(s: { getPropertyValue(p: string): string }, resolveColor: (v: string) => string): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("background-color");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveColor(bg);
  // Per-corner radius: read all four; collapse to cornerRadius when equal.
  const tl = parseFloat(s.getPropertyValue("border-top-left-radius")) || 0;
  const tr = parseFloat(s.getPropertyValue("border-top-right-radius")) || 0;
  const br = parseFloat(s.getPropertyValue("border-bottom-right-radius")) || 0;
  const bl = parseFloat(s.getPropertyValue("border-bottom-left-radius")) || 0;
  if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
    if (tl === tr && tr === br && br === bl) out.cornerRadius = tl;
    else out.corners = { tl, tr, br, bl };
  }
  // Per-side borders: capture each side with width>0 and a visible style.
  const sides = ["top", "right", "bottom", "left"] as const;
  const borders: NonNullable<ElementStyle["borders"]> = {};
  let anyBorder = false;
  for (const side of sides) {
    const w = parseFloat(s.getPropertyValue(`border-${side}-width`));
    const style = (s.getPropertyValue(`border-${side}-style`) || "").trim();
    if (Number.isFinite(w) && w > 0 && !HIDDEN_BORDER_STYLES.has(style)) {
      borders[side] = { color: resolveColor(s.getPropertyValue(`border-${side}-color`)), width: w };
      anyBorder = true;
    }
  }
  if (anyBorder) out.borders = borders;
  // CSS rotation (skew/scale ignored for v1).
  const rot = rotationDegrees(s.getPropertyValue("transform"));
  if (rot !== undefined) out.rotation = rot;
  // Clipping: overflow/overflow-x/overflow-y
  const ov = s.getPropertyValue("overflow");
  const ovx = s.getPropertyValue("overflow-x");
  const ovy = s.getPropertyValue("overflow-y");
  if (CLIP_VALUES.has(ov) || CLIP_VALUES.has(ovx) || CLIP_VALUES.has(ovy)) out.clip = true;
  // Box shadow (first shadow only)
  const shadow = parseBoxShadow(s.getPropertyValue("box-shadow"));
  if (shadow) out.shadow = shadow;
  // Opacity (computed opacity is always a pure number string "0" to "1", never has "px")
  const opacityRaw = s.getPropertyValue("opacity");
  if (opacityRaw && !opacityRaw.includes("px")) {
    const opacity = parseFloat(opacityRaw);
    if (Number.isFinite(opacity) && opacity < 1) out.opacity = opacity;
  }
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

    // SVG vector capture: when the host is an svg element, emit a leaf with the markup
    const tag = ctx.reader.hostTag(f);
    if (tag === "svg") {
      const box = ctx.reader.box(f);
      const markup = ctx.reader.svgMarkup(f);
      const s = ctx.reader.style(f);
      return {
        kind: "element",
        tag: "svg",
        box,
        layout: null,
        style: { ...elementStyle(s, ctx.resolveColor), ...(markup ? { svg: markup } : {}) },
        children: [],
      };
    }

    // Image capture: when the host is img AND reader can capture pixel data, emit a leaf
    if (tag === "img") {
      const imgData = ctx.reader.imageData(f);
      if (imgData) {
        const box = ctx.reader.box(f);
        const s = ctx.reader.style(f);
        return {
          kind: "element",
          tag: "img",
          box,
          layout: null,
          style: { ...elementStyle(s, ctx.resolveColor), imageData: imgData },
          children: [],
        };
      }
    }

    // host element, or composite/unknown component treated as a frame
    const box = ctx.reader.box(f);
    const text = ctx.reader.text(f);
    const kids = childFibers(f, ctx);
    const isFormField = tag === "input" || tag === "textarea";

    // Name for Figma layer: component name for composites, semantic tag for host elements
    const SEMANTIC_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "nav", "aside", "header", "footer", "main", "section", "ul", "ol", "li", "button", "a", "img", "form", "table"]);
    const name = nm ?? (tag && SEMANTIC_TAGS.has(tag) ? tag : undefined);

    // text leaf: visible text + no element children
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: textStyle(ctx.reader.style(f), ctx.resolveColor, text), children: [] };
    }

    // Read style once, used for both text styling and element styling
    const s = ctx.reader.style(f);
    const elStyle = elementStyle(s, ctx.resolveColor);

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

    // Placeholder text: an <input>/<textarea> shows its placeholder as an
    // attribute, not as textContent, so the walk would render an empty box.
    // Emit a text leaf styled from the field's own computed style (color at
    // the field's own color — ::placeholder color isn't reliably readable) so
    // a composer like "Ask me anything" is visible in the export.
    if (isFormField && !text && childNodes.length === 0) {
      const ph = ctx.reader.placeholder?.(f) ?? null;
      if (ph) {
        childNodes.push({ kind: "element", tag: "text", box, layout: null,
          style: textStyle(s, ctx.resolveColor, ph), children: [] });
      }
    }

    // For a rotated element, box() is the axis-aligned bbox of the rotated
    // shape — the wrong SIZE for a rotated Figma frame. Substitute the intrinsic
    // (un-rotated) size when available so the runtime can place + rotate it.
    let outBox = box;
    if (elStyle.rotation !== undefined) {
      const size = ctx.reader.unrotatedSize?.(f) ?? null;
      if (size && size.width > 0 && size.height > 0) {
        outBox = { x: box.x, y: box.y, width: size.width, height: size.height };
      } else {
        // No reliable intrinsic size → drop rotation, keep the bbox flat. Still
        // renders the fill/shadow/border so a stacked illustration reads.
        delete elStyle.rotation;
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
      box: outBox,
      layout,
      style: elStyle,
      children: childNodes,
    };
  }
  const root = walk(rootFiber, true);
  if (!root) throw new Error("fiberWalk: root produced no node");
  return root;
}
