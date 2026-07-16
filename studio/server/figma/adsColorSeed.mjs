// ADS semantic color tokens — the design-system source of truth for color.
// Keys = kit custom-property form (sans leading --); values = ADS Light hex.
// Provenance: Arcade Design System, Figma file a2uKnm88LxRXEWAL1kOqeQ (collection "Mode").
// Regenerate via the figma-console Desktop Bridge: figma_get_variables
// (format=filtered, namePattern=^(BG|FG|Surface|Stroke|Icon)/, resolveAliases=true),
// then normalize each name (lowercase, / and whitespace -> -, collapse -).
// This is a checked-in MIRROR: getVariables is Enterprise-gated -> null in prod,
// so the ADS half of the check cannot be pulled live.
export const ADS_COLOR_SEED = {
  // Neutral
  "fg-neutral-prominent": "#211E20", "fg-neutral-on-prominent": "#FFFFFF",
  "fg-neutral-medium": "#737072", "fg-neutral-subtle": "#A5A0A3",
  "fg-neutral-black": "#211E20", "fg-neutral-white": "#FFFFFF",
  "bg-neutral-prominent": "#211E20", "bg-neutral-soft": "#C7C3C557",
  "bg-neutral-subtle": "#211E2026", "bg-neutral-medium": "#211E20E8",
  "bg-neutral-inverted": "#FFFFFF",
  "surface-backdrop": "#FFFFFF", "surface-overlay": "#FFFFFF", "surface-shallow": "#FAF9F9",
  "stroke-neutral-subtle": "#C7C3C5", "stroke-neutral-medium": "#898587",
  "stroke-neutral-prominent": "#211E20", "stroke-neutral-soft": "#ECEAEB",
  "stroke-neutral-inverted": "#FFFFFF",
  // Alert / Info / Success / Warning / Intelligence (semantic)
  "bg-alert-subtle": "#FFE5DB", "bg-alert-medium": "#FFCCBB", "bg-alert-prominent": "#D10000",
  "fg-alert-prominent": "#94030A", "fg-alert-on-prominent": "#FFF2EB", "stroke-alert": "#94030A",
  "bg-info-subtle": "#E7FBFF", "bg-info-medium": "#92E0FF", "bg-info-prominent": "#0053E7",
  "fg-info-prominent": "#002AB0", "fg-info-on-prominent": "#CFF4FF", "stroke-info": "#002AB0",
  "bg-success-subtle": "#EEFFD6", "bg-success-medium": "#C4FF66", "bg-success-prominent": "#4B8100",
  "fg-success-prominent": "#2B5500", "fg-success-on-prominent": "#EEFFD6", "stroke-success": "#2B5500",
  "bg-warning-subtle": "#FFFFBB", "bg-warning-medium": "#FFE000", "bg-warning-prominent": "#F6C800",
  "fg-warning-prominent": "#714400", "fg-warning-on-prominent": "#4F2900", "stroke-warning": "#A07000",
  "bg-intelligence-subtle": "#F6E5FF", "bg-intelligence-medium": "#D5ABFF", "bg-intelligence-prominent": "#4700AB",
  "fg-intelligence-prominent": "#4700AB", "fg-intelligence-on-prominent": "#F6E5FF", "stroke-intelligence": "#4700AB",
  // Expressive — Blue
  "bg-expressive-blue-subtle": "#E7FBFF", "bg-expressive-blue-medium": "#92E0FF", "bg-expressive-blue-prominent": "#0053E7",
  "fg-expressive-blue-prominent": "#077CFF", "fg-expressive-blue-on-prominent": "#E7FBFF",
  // Expressive — Orange
  "bg-expressive-orange-subtle": "#FCECD2", "bg-expressive-orange-medium": "#FFDAA3", "bg-expressive-orange-prominent": "#D14600",
  "fg-expressive-orange-prominent": "#FF7924", "fg-expressive-orange-on-prominent": "#FFF8EB",
  // Expressive — Yellow
  "bg-expressive-yellow-subtle": "#FFFA9B", "bg-expressive-yellow-medium": "#FFF049", "bg-expressive-yellow-prominent": "#FFE000",
  "fg-expressive-yellow-prominent": "#F6C800", "fg-expressive-yellow-on-prominent": "#FFFFBB",
  // Expressive — Green
  "bg-expressive-green-subtle": "#E1FFB2", "bg-expressive-green-medium": "#A0ED1A", "bg-expressive-green-prominent": "#74AE00",
  "fg-expressive-green-prominent": "#74AE00", "fg-expressive-green-on-prominent": "#EEFFD6",
  // Expressive — Red
  "bg-expressive-red-subtle": "#FFE5DB", "bg-expressive-red-medium": "#FFAB99", "bg-expressive-red-prominent": "#D10000",
  "fg-expressive-red-prominent": "#FF342D", "fg-expressive-red-on-prominent": "#FFF2EB",
  // Expressive — Teal
  "bg-expressive-teal-subtle": "#C6FFE3", "bg-expressive-teal-medium": "#3DF2B9", "bg-expressive-teal-prominent": "#006139",
  "fg-expressive-teal-prominent": "#00BF89", "fg-expressive-teal-on-prominent": "#E4FFEF",
  // Expressive — Purple
  "bg-expressive-purple-subtle": "#F6E5FF", "bg-expressive-purple-medium": "#D5ABFF", "bg-expressive-purple-prominent": "#4700AB",
  "fg-expressive-purple-prominent": "#A46FFF", "fg-expressive-purple-on-prominent": "#FBF2FF",
  // Expressive — Pink
  "bg-expressive-pink-subtle": "#FFE4F9", "bg-expressive-pink-medium": "#FF91D5", "bg-expressive-pink-prominent": "#E00274",
  "fg-expressive-pink-prominent": "#FF52A8", "fg-expressive-pink-on-prominent": "#FFF2FC",
};
export const ADS_SEED_PROVENANCE =
  "Arcade Design System, Figma file a2uKnm88LxRXEWAL1kOqeQ; regenerate via figma-console Desktop Bridge.";
