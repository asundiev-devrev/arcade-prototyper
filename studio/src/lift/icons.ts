// studio/src/lift/icons.ts
//
// Icon classifier + anchor examples. Used by buildManifest to split the
// unmapped list into icon imports (absorbed by the icon convention) and
// genuine unmapped imports (still surfaced to the reviewer).
//
// Rationale: arcade-gen ships dozens of icons and the set grows as design
// evolves. A curated icon→ICON_TYPES table goes stale immediately — see
// the plan at studio/docs/plans/2026-05-11-lift-manifest-rules-over-tables.md.
// Instead, we (a) detect icon imports by naming convention and (b) teach
// the agent to grep ICON_TYPES for the semantic match at lift time. A
// handful of anchor examples ground the lookup without pretending to
// enumerate the surface.

/**
 * Plain-noun icon names from arcade-gen that don't match the suffix pattern.
 * Kept in sync with studio/__tests__/lift/mappingCoverage.test.ts — both
 * files treat these as "icons, not components." When arcade-gen ships a new
 * plain-noun icon, add it here AND to mappingCoverage.test.ts.
 */
const PLAIN_NOUN_ICON_NAMES = new Set<string>([
  "AgentStudio",
  "Bell",
  "ChatBubbles",
  "Clock",
  "ClockWithDashedOutline",
  "Computer",
  "Document",
  "DotInLeftWindow",
  "DotInRightWindow",
  "Globe",
  "HumanSilhouette",
  "HumanSilhouetteWithPlus",
  "LightingBolt", // arcade-gen spelling (sic)
  "PlusInChatBubble",
  "ThreeDotsHorizontal",
  "ThreeDotsVertical",
  "ThumbsDown",
  "ThumbsUp",
  "TrashBin",
  "TwoSquaresOverlapping",
  // Common arcade-gen icon nouns that don't carry a size suffix.
  "MagnifyingGlass",
  "Pencil",
  "Link", // NOTE: arcade exports both a Link ICON and a Link COMPONENT. See
  // `LINK_IS_AMBIGUOUS` below — we treat Link as a component, not an icon,
  // because the mapping table has a component entry.
]);

/**
 * Names that LOOK like icons by suffix but are actually components.
 * Studio's arcade re-exports keep a few of these around (most famously
 * `Link`). When in doubt, err on the side of "component" — the lift
 * manifest's default-mapping convention can handle unknown components
 * gracefully; it cannot handle a component mis-classified as an icon.
 */
const NOT_ICONS = new Set<string>(["Link", "ChatBubble"]);

/**
 * True when `name` is an arcade-gen icon export. Used by buildManifest to
 * route icon imports into the icon convention instead of the unmapped list.
 */
export function isIcon(name: string): boolean {
  if (NOT_ICONS.has(name)) return false;
  if (PLAIN_NOUN_ICON_NAMES.has(name)) return true;
  // Suffix convention used throughout arcade-gen: *Small / *Medium / *Large
  // (size-suffixed icons), *Icon (canonical icon suffix when it exists).
  return /(?:Small|Medium|Large|Icon)$/.test(name);
}

/**
 * Anchor examples surfaced in the `<icon_convention>` block of the manifest.
 * These are not the mapping table. They're three or four "here's how the
 * translation looks" hints so the agent can extrapolate to the frame's
 * actual icon imports.
 *
 * Keep short. The point is illustration, not coverage.
 */
export const ICON_ANCHORS: Array<{ studio: string; productionIconType: string }> = [
  { studio: "Bell", productionIconType: "NOTIFICATION" },
  { studio: "MagnifyingGlass", productionIconType: "SEARCH" },
  { studio: "TrashBin", productionIconType: "DELETE" },
  { studio: "PlusSmall", productionIconType: "BASE_ADD" },
  { studio: "ChevronRightSmall", productionIconType: "BASE_CHEVRON_RIGHT" },
];
