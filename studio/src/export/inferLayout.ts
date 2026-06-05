import type { Box, Layout } from "./slj";

/** The subset of a computed style inferLayout reads. window.getComputedStyle
 *  satisfies this (all values are px/keyword strings). */
export interface StyleLike {
  display: string;
  flexDirection: string;
  columnGap: string;
  rowGap: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  alignItems: string;
  marginLeft: string;
}

const px = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function mapAlign(alignItems: string): Layout["align"] {
  switch (alignItems) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "stretch":
      return "stretch";
    default:
      return "start";
  }
}

/** Overlap along the main axis means it's not a clean stack → irregular. */
function hasMainAxisOverlap(boxes: Box[], mode: "horizontal" | "vertical"): boolean {
  const sorted = [...boxes].sort((a, b) => (mode === "vertical" ? a.y - b.y : a.x - b.x));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevEnd = mode === "vertical" ? prev.y + prev.height : prev.x + prev.width;
    const curStart = mode === "vertical" ? cur.y : cur.x;
    if (curStart < prevEnd) return true;
  }
  return false;
}

export function inferLayout(style: StyleLike, childBoxes: Box[]): Layout | null {
  if (style.display !== "flex" && style.display !== "inline-flex") return null;
  // Negative margins have no auto-layout equivalent → fall back to absolute.
  if (px(style.marginLeft) < 0) return null;

  const mode: Layout["mode"] = style.flexDirection.startsWith("row") ? "horizontal" : "vertical";
  if (hasMainAxisOverlap(childBoxes, mode)) return null;

  const gap = mode === "horizontal" ? px(style.columnGap) : px(style.rowGap);
  return {
    mode,
    gap,
    padding: [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)],
    align: mapAlign(style.alignItems),
  };
}
