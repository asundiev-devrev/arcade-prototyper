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
    flexDirection: g("flexDirection"),
    columnGap: g("columnGap"),
    rowGap: g("rowGap"),
    paddingTop: g("paddingTop"),
    paddingRight: g("paddingRight"),
    paddingBottom: g("paddingBottom"),
    paddingLeft: g("paddingLeft"),
    alignItems: g("alignItems"),
    marginLeft: g("marginLeft"),
  };
}

function elementStyle(s: StyleSnapshot, idx: TokenIndex): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("backgroundColor");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveToken(idx, bg);
  const radius = parseFloat(s.getPropertyValue("borderTopLeftRadius"));
  if (Number.isFinite(radius) && radius > 0) out.cornerRadius = radius;
  const strokeW = parseFloat(s.getPropertyValue("borderTopWidth"));
  if (Number.isFinite(strokeW) && strokeW > 0) {
    out.stroke = { color: resolveToken(idx, s.getPropertyValue("borderTopColor")), width: strokeW };
  }
  return out;
}

/** A node whose only content is text → emit a text element node. */
function isTextOnly(node: Element): boolean {
  return node.childElementCount === 0 && (node.textContent ?? "").trim().length > 0;
}

function textNode(node: Element, s: StyleSnapshot, idx: TokenIndex, box: Box): SljNode {
  return {
    kind: "element",
    tag: "text",
    box,
    layout: null,
    style: {
      characters: (node.textContent ?? "").trim(),
      color: resolveToken(idx, s.getPropertyValue("color")),
      fontFamily: s.getPropertyValue("fontFamily"),
      fontSize: parseFloat(s.getPropertyValue("fontSize")) || undefined,
      fontWeight: parseFloat(s.getPropertyValue("fontWeight")) || undefined,
      lineHeight: parseFloat(s.getPropertyValue("lineHeight")) || undefined,
    },
    children: [],
  };
}

function walk(node: Element, ctx: Ctx): SljNode {
  const s = ctx.reader.style(node);
  const box = ctx.reader.box(node);

  const childEls = Array.from(node.children);
  const children = childEls.map((c) => walk(c, ctx));
  const childBoxes = childEls.map((c) => ctx.reader.box(c));
  const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);

  const stamp = node.getAttribute("data-arcade-component");
  if (stamp) {
    const source = (node.getAttribute("data-arcade-source") as
      | "arcade/components"
      | "arcade-prototypes") ?? "arcade/components";
    let props: Record<string, unknown> = {};
    const raw = node.getAttribute("data-arcade-props");
    if (raw) {
      try {
        props = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        props = {};
      }
    }
    // A stamped component with only text content still carries that text as a child.
    const componentChildren =
      childEls.length === 0 && isTextOnly(node)
        ? [textNode(node, s, ctx.tokenIndex, box)]
        : children;
    return { kind: "component", component: stamp, source, props, box, layout, children: componentChildren };
  }

  // Text leaf
  if (isTextOnly(node)) return textNode(node, s, ctx.tokenIndex, box);

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
