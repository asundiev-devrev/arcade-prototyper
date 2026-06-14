/**
 * Pick a PNG export scale for a Figma node so the reference image is sharp
 * enough to trace, and report the resulting pixel dimensions.
 *
 * Why this exists: the ingest used to export every node at a hardcoded scale
 * of 2 and record widthPx/heightPx as 0. A 240px-wide sidebar then yielded a
 * ~480px image — too coarse for the model to read spacing, icon sizes, or
 * truncation — and nothing downstream knew the real size. We instead target a
 * ~2000px longest edge (clamped to Figma's export ceiling of 4x and a floor of
 * 1x so we never shrink) and record the true dimensions so the prompt can tell
 * the model exactly how big the reference is relative to the source node.
 */

/** Desired longest edge of the exported PNG, in pixels. */
export const TARGET_LONGEST_EDGE_PX = 2000;

/** Figma's image export caps at 4x. */
const MAX_SCALE = 4;
/** Never downscale a node — a large frame still exports at native size. */
const MIN_SCALE = 1;
/** Scale to use when the node's dimensions are unknown (bbox missing). */
const FALLBACK_SCALE = 2;

export interface ExportScale {
  scale: number;
  widthPx: number;
  heightPx: number;
}

/**
 * @param srcWidth  node width in Figma px (absoluteBoundingBox.width)
 * @param srcHeight node height in Figma px (absoluteBoundingBox.height)
 */
export function computeExportScale(srcWidth: number, srcHeight: number): ExportScale {
  if (!isFinite(srcWidth) || !isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
    return { scale: FALLBACK_SCALE, widthPx: 0, heightPx: 0 };
  }
  const longest = Math.max(srcWidth, srcHeight);
  const raw = TARGET_LONGEST_EDGE_PX / longest;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  return {
    scale,
    widthPx: Math.round(srcWidth * scale),
    heightPx: Math.round(srcHeight * scale),
  };
}
