/**
 * Geometry + color helpers for the frame overlay.
 *
 * Adapted from design-mode (https://github.com/SandeepBaskaran/design-mode),
 * MIT © 2026 Sandeep Baskaran. See THIRD-PARTY.md.
 *
 * KEY DIFFERENCE from design-mode's helpers: getElementRect returns VIEWPORT
 * coordinates (no window.scrollX/scrollY offset). Studio frames are fixed-size
 * iframes rendered at a zoom factor inside a CSS-transformed parent; overlay
 * elements use position:fixed and the parent transform scales them. Adding a
 * scroll offset (as design-mode does for full scrolling pages) would mis-place
 * every overlay here.
 */

export interface Rect {
  top: number; left: number; width: number; height: number; bottom: number; right: number;
}

export function getElementRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return `rgba(255, 99, 99, ${alpha})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Single high band so the overlay always sits above frame content. Bands sit
// just below their outline so the outline border reads on top.
export const Z_INDEX = {
  HOVER_BANDS: 2147483640,
  HOVER_OVERLAY: 2147483641,
  GUIDES: 2147483642,
  SELECT_BANDS: 2147483643,
  SELECT_OVERLAY: 2147483644,
} as const;
