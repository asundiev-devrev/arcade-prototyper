/**
 * Overlay colors. design-mode reads these from chrome.storage; Studio has no
 * such store, so they're constants here, chosen to read well on arcade frames.
 * Hex strings (hexToRgba applies alpha at paint time).
 */
export const OVERLAY_COLORS = {
  hover: "#4F9EFF",        // hover outline
  select: "#FF6B35",       // selection box + W×H badge + guides + pills
  marginBand: "#FF6363",   // margin visualizer (red)
  paddingBand: "#7CC886",  // padding visualizer (green)
} as const;

export const ALPHA = {
  hoverFill: 0.06,
  marginBand: 0.28,
  paddingBand: 0.3,
} as const;
