// studio/src/export/serializeFrame.ts
import type { Box, ElementStyle, Layout, SljNode } from "./slj";
import { inferLayout, type StyleLike } from "./inferLayout";
import { resolveToken, type TokenIndex } from "./tokenIndex";

/** A computed-style snapshot. window.getComputedStyle(el) satisfies this. */
export interface StyleSnapshot {
  getPropertyValue(prop: string): string;
}

export interface DomReader {
  style(node: Element): StyleSnapshot;
  box(node: Element): Box;
}

interface Ctx {
  reader: DomReader;
  tokenIndex: TokenIndex;
}

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", "rgba(0,0,0,0)"]);

function readStyleLike(s: StyleSnapshot): StyleLike {
  const g = (p: string) => s.getPropertyValue(p);
  return {
    display: g("display"),
    flexDirection: g("flex-direction"),
    columnGap: g("column-gap"),
    rowGap: g("row-gap"),
    paddingTop: g("padding-top"),
    paddingRight: g("padding-right"),
    paddingBottom: g("padding-bottom"),
    paddingLeft: g("padding-left"),
    alignItems: g("align-items"),
    marginLeft: g("margin-left"),
  };
}

function elementStyle(s: StyleSnapshot, idx: TokenIndex): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("background-color");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveToken(idx, bg);
  const radius = parseFloat(s.getPropertyValue("border-top-left-radius"));
  if (Number.isFinite(radius) && radius > 0) out.cornerRadius = radius;
  const strokeW = parseFloat(s.getPropertyValue("border-top-width"));
  if (Number.isFinite(strokeW) && strokeW > 0) {
    out.stroke = { color: resolveToken(idx, s.getPropertyValue("border-top-color")), width: strokeW };
  }
  return out;
}

/** A node whose only content is text → emit a text element node. */
function isTextOnly(node: Element): boolean {
  return node.childElementCount === 0 && (node.textContent ?? "").trim().length > 0;
}

function textNode(node: Element, s: StyleSnapshot, idx: TokenIndex, box: Box): SljNode {
  return makeTextNode((node.textContent ?? "").trim(), s, idx, box);
}

/** Build a "text" element node from raw characters + the (parent) style/box.
 *  Used both for an element whose only content is text and for bare text nodes
 *  that sit alongside element siblings (they have no own style/box, so we read
 *  the parent's). */
function makeTextNode(characters: string, s: StyleSnapshot, idx: TokenIndex, box: Box): SljNode {
  return {
    kind: "element",
    tag: "text",
    box,
    layout: null,
    style: {
      characters,
      color: resolveToken(idx, s.getPropertyValue("color")),
      fontFamily: s.getPropertyValue("font-family"),
      fontSize: parseFloat(s.getPropertyValue("font-size")) || undefined,
      fontWeight: parseFloat(s.getPropertyValue("font-weight")) || undefined,
      lineHeight: parseFloat(s.getPropertyValue("line-height")) || undefined,
    },
    children: [],
  };
}

/** Collect a node's children by walking childNodes (not just element children),
 *  so bare text that sits alongside element siblings is not dropped (e.g. a
 *  ChatBubble with a tail/timestamp element renders extra element siblings next
 *  to its message text). Element children recurse via walk; non-empty text nodes
 *  become text nodes carrying the PARENT style/box (Slice 0 doesn't need
 *  per-text-run geometry, so we reuse the parent box). */
function collectChildren(node: Element, s: StyleSnapshot, box: Box, ctx: Ctx): SljNode[] {
  const out: SljNode[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      out.push(walk(child as Element, ctx));
    } else if (child.nodeType === 3 /* TEXT_NODE */) {
      const text = (child.textContent ?? "").trim();
      // box = parent box: Slice 0 has no per-text-run geometry.
      if (text.length > 0) out.push(makeTextNode(text, s, ctx.tokenIndex, box));
    }
  }
  return out;
}

function walk(node: Element, ctx: Ctx): SljNode {
  const s = ctx.reader.style(node);
  const box = ctx.reader.box(node);

  const childEls = Array.from(node.children);
  const childBoxes = childEls.map((c) => ctx.reader.box(c));
  const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);
  // One routine for both branches: walks childNodes so bare text alongside
  // element children is captured. For a childless text-only node this yields
  // exactly one text node, so there is no double-emit.
  const children = collectChildren(node, s, box, ctx);

  const stamp = node.getAttribute("data-arcade-component");
  if (stamp) {
    const rawSource = node.getAttribute("data-arcade-source");
    const source: "arcade/components" | "arcade-prototypes" =
      rawSource === "arcade-prototypes" ? "arcade-prototypes" : "arcade/components";
    let props: Record<string, unknown> = {};
    const raw = node.getAttribute("data-arcade-props");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          props = parsed as Record<string, unknown>;
        }
      } catch {
        props = {};
      }
    }
    return { kind: "component", component: stamp, source, props, box, layout, children };
  }

  // Text leaf: a childless text-only node already produced its single text node
  // via collectChildren, so return that node directly (no wrapper element).
  if (isTextOnly(node) && children.length === 1) return children[0];

  return {
    kind: "element",
    tag: node.tagName.toLowerCase(),
    box,
    layout,
    style: elementStyle(s, ctx.tokenIndex),
    children,
  };
}

export function serializeFrame(root: Element, ctx: Ctx): SljNode {
  return walk(root, ctx);
}
