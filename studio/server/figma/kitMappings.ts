/**
 * Curated Figma → arcade-gen kit mappings for the deterministic kit-emit
 * engine (kitEmit.ts).
 *
 * Identity comes from the figmanage REST payload: every INSTANCE carries a
 * componentId that resolves (via the response's components/componentSets
 * maps) to a PUBLISHED component-set key. Key match → kit component. This is
 * deterministic — no Code Connect, no name guessing for the primary path.
 *
 * Three tiers, checked in order:
 *  1. SET_KEY_TO_KIT — published component-set key (strongest identity; same
 *     keys as src/export/figma/componentEntries.ts, the reverse direction).
 *  2. ICON_SET_NAME_TO_KIT — icon sets by name. Names are the right key for
 *     icons: designers' files routinely contain detached/local icon copies
 *     that keep the name but not the published key.
 *  3. SET_NAME_TO_KIT — non-icon components by set name (fallback for local
 *     copies of kit components, e.g. a detached "Avatar").
 *
 * Anything unmatched stays faithful static markup (the owner's spec: known →
 * kit, unknown → hand-rolled). Growing coverage = adding a row here.
 */

/** Published component-set key → arcade-gen component. */
export const SET_KEY_TO_KIT: Record<string, string> = {
  "0b87fe4f9790e1c0053da61c767edbaa1c46826d": "Button",
  "3abc28fac47cbde78a253917b98d8b34eabfb218": "IconButton",
  a1475c3e4dfdf52bca771aff82f3ac849d31a036: "Checkbox",
  e9b9f1195504a3861823a8968797827963f26e5a: "Avatar",
  ee83688019e9eaf97359ee86016e4b65a4db0d4c: "Tabs",
  c921cbb0bf76d6f6d7f7908b9d3426e73f668728: "Switch",
  "367267f81839b123664fa8b1304b16ee6006b37a": "Badge", // 0.3 "Counter"
  "3067f69c7f76e7c43815148ce843654e36081bed": "Tag", // 0.3 "Chip"
  edd2821db8a05b808da334a1c6aed7646d23e82e: "ChatBubble", // 0.3 "Bubble"
};

/**
 * Component-set NAME → kit component, for instances whose set is local /
 * detached (no published key match). Special pseudo-kits:
 *  - "ImageAvatar": an avatar whose visual is a photo (IMAGE fill) → kit
 *    Avatar with src pointing at the exported PNG.
 */
export const SET_NAME_TO_KIT: Record<string, string> = {
  Avatar: "Avatar",
  "Account Avatar": "AccountAvatar",
  Images: "ImageAvatar",
  "User avatars": "ImageAvatar",
  "Avatar Group": "AvatarGroup",
  "Ghost Button": "IconButton",
  "Icon Button": "IconButton",
  Button: "Button",
};

/** Figma icon set name → arcade-gen icon export. Every value must exist in
 *  the kit barrel (test-enforced against arcade-components exports). */
export const ICON_SET_NAME_TO_KIT: Record<string, string> = {
  "Icons/Plus": "PlusSmall",
  "Icons / Plus": "PlusSmall",
  "Plus Icon": "PlusSmall",
  "Icons/Window": "Window",
  "Icons/Chat.bubbles": "ChatBubbles",
  "Icons/Chat.bubble": "ChatBubble",
  "Icons/Magnifying.glass": "MagnifyingGlass",
  "Icons/Magnifying.glass.in.square": "MagnifyingGlassInSquare",
  "Icons/Computer": "Computer",
  "Computer/Logomark/Animated": "Computer",
  "Icons/Dot.in.left.window": "DotInLeftWindow",
  "Icons/Dot.in.right.window": "DotInRightWindow",
  "Icons/Chevron.down": "ChevronDownSmall",
  "Icons / Chevron.Down": "ChevronDownSmall",
  "Chevron | Down": "ChevronDownSmall",
  "caret-down": "ChevronDownSmall",
  "Icons/Chevron.right": "ChevronRightSmall",
  "Icons / Chevron.Right": "ChevronRightSmall",
  "Chevron-right": "ChevronRightSmall",
  "Icons/Chevron.left": "ChevronLeftSmall",
  "Icons/Chevron.up": "ChevronUpSmall",
  "Icons/Bell": "Bell",
  "Icons / Bell.large": "Bell",
  "Icons/Clock": "Clock",
  "Icons / Clock": "Clock",
  "Interface, Essential/clock-time": "Clock",
  "Arrows, Diagrams/Arrange, Filter, Sort": "ArrowsUpAndDown",
  "Icons/Arrows.up.and.down": "ArrowsUpAndDown",
  "Music, Audio/Filter, Settings, Sort": "HorizontalLinesWithCircles",
  "Icons/Horizontal.lines.with.circles": "HorizontalLinesWithCircles",
  "Icons/Human.silhouette.with.plus": "HumanSilhouetteWithPlus",
  "Icons / Arrow.Up": "ArrowUpSmall",
  "Icons / Bubble.Plus": "PlusInChatBubble",
  "Icons / Sidebar.Left": "Sidebar",
  "Icons/Agent.studio": "AgentStudio",
  "Icons/Arrow.pointing.into.tray": "ArrowPointingIntoTray",
  "Icons/Cross": "CrossSmall",
  "Icons/Plus.circles.cross": "PlusCirclesCross",
  "Icons/Three.bars.horizontal": "ThreeBarsHorizontal",
  "Icons/Three.dots.vertical": "ThreeDotsVertical",
  "Icons/Document": "Document",
  "Icons/Eye": "Eye",
  "Icons/Book": "Book",
  "Icons/Paperclip": "Paperclip",
  "Icons/Pin": "Pin",
  "Icons/Globe": "Globe",
  "Icons/Calendar": "Calendar",
  "Icons/Flag": "Flag",
  "Icons/Lock": "Lock",
  "Icons/Cog": "Cog",
  "Icons/Camera": "Camera",
  "Icons/Photo": "Photo",
  "Icons/Trash.bin": "TrashBin",
  "Icons/Placeholder": "Placeholder",
  "Icons/Arrow.up.right": "ArrowUpRightSmall",
  "Icons/Three.dots.horizontal": "ThreeDotsHorizontal",
  "Icons/Chinese.character.with.letter.a": "ChineseCharacterWithLetterA",
  "Interface, Essential/Arrow, Down": "ChevronDownSmall",
  Elipsis: "ThreeDotsHorizontal",
  Hash: "SlashInSquare",
  "Attribute/arrow-right": "ArrowRightSmall",
  "Attribute/user": "HumanSilhouette",
  "Messages, Chat/Messages, Chat": "ChatBubble",
  "Programing, Data/Programming, Code, Language": "Mcp",
  "Drag Horizontal Lines": "ThreeBarsHorizontal",
  "two.human.silhouttes": "TwoHumanSilhouettes",
};

/** Figma variant value → arcade-gen prop value. */
export const VARIANT_VALUE_MAP: Record<string, string> = {
  Primary: "primary",
  Secondary: "secondary",
  Tertiary: "tertiary",
  Expressive: "expressive",
  Destructive: "destructive",
};

export const SIZE_VALUE_MAP: Record<string, string> = {
  Small: "sm",
  Default: "md",
  Large: "lg",
};

/** Nearest arcade-gen Avatar size for a px width. */
const AVATAR_PX: Array<[number, string]> = [
  [16, "xs"],
  [20, "default"],
  [24, "md"],
  [32, "lg"],
  [48, "xl"],
];

export function avatarSizeForPx(px: number): string {
  let best = AVATAR_PX[0];
  for (const cand of AVATAR_PX) {
    if (Math.abs(cand[0] - px) < Math.abs(best[0] - px)) best = cand;
  }
  return best[1];
}

export type KitMatch =
  | { kind: "icon"; kit: string }
  | { kind: "component"; kit: string };

/**
 * Resolve an INSTANCE node's kit identity. `setKey`/`setName` come from
 * resolving the instance's componentId through the REST payload's
 * components/componentSets maps.
 */
export function matchKit(
  setKey: string | undefined,
  setName: string | undefined,
): KitMatch | null {
  if (setName && ICON_SET_NAME_TO_KIT[setName]) {
    return { kind: "icon", kit: ICON_SET_NAME_TO_KIT[setName] };
  }
  if (setKey && SET_KEY_TO_KIT[setKey]) {
    return { kind: "component", kit: SET_KEY_TO_KIT[setKey] };
  }
  if (setName && SET_NAME_TO_KIT[setName]) {
    return { kind: "component", kit: SET_NAME_TO_KIT[setName] };
  }
  return null;
}
