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
  return {
    kind: "element",
    tag: "text",
    box,
    layout: null,
    style: {
      characters: (node.textContent ?? "").trim(),
      color: resolveToken(idx, s.getPropertyValue("color")),
      fontFamily: s.getPropertyValue("font-family"),
      fontSize: parseFloat(s.getPropertyValue("font-size")) || undefined,
      fontWeight: parseFloat(s.getPropertyValue("font-weight")) || undefined,
      lineHeight: parseFloat(s.getPropertyValue("line-height")) || undefined,
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
