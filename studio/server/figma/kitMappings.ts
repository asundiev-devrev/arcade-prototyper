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
  // C1 — coverage, Tier-1 only (safe to emit standalone, no Radix portal):
  c4ff2f34e04a5c0f5b0c94733b157e512a871ec7: "Input", // 0.3 "Input/Text field"
  "93bc12b8c36c35f775f3a71d4821f4541e32dc79": "Select", // 0.3 "Select" (trigger-only)
  "0ecf3d67728cfd4196e964bbfb3795f540a0c70b": "Breadcrumb", // 0.3 "Breadcrumbs" (plain HTML)
  edf96535be2abc8d0b836f54d450d60683a896ab: "Banner", // 0.3 "Inline Banner"
  d43e5c28c7a26c01ebdbb7123751565a8955b52e: "TextArea", // 0.3 "Input/Text Area"
  "4bd8ce6785fee3244a829595d70e612350b5ecbd": "KeyboardShortcut", // 0.3 "Shortcut"
  "8ba9681b10fd5324ac7e381013e727ff8836e9d2": "SplitButton", // 0.3 "Split Button"
  // C3 — arcade-gen 2.0 components. Keys captured live from
  // GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/component_sets (2026-08-12), so these
  // are the real published set keys, not names. That matters here more than
  // usual: the same file also publishes "[🔴DEPRECATED] Chip Button",
  // "[🔴DEPRECATED]Number Field" and "[DLS]File Attachment" — near-identical
  // names for OLD components. Key matching can't pick the wrong twin.
  "19d5b8170133af3b1411a5be16b94621b558c816": "SearchInput", // 0.3 "Search Input"
  "4c4e26eb174a90e98da63a36f351946ad43498a5": "NumberField", // 0.3 "Input/Number field"
  "62304142aad2baf93fd56949820a5989f2715349": "ChipButton", // 0.3 "Chip Button"
  e4341909fd0d33d86b5284326349c6f2d678a70c: "FilterButton", // 0.3 "Filter Button"
  a11a736d2e3ef8673c0f3b57e18301cfcd0fbd37: "FileAttachment", // 0.3 "File attachment"
  // C4 — the Computer sidebar and its parts. Keys captured live 2026-08-12 from
  // a real Computer screen ("C - Scheduled tasks", frame 2207:29527) and
  // confirmed against the kit library's published set list.
  //
  // `Sidebar` is the set arcade-gen's own Sidebar.tsx cites as its source
  // ("Navigation page 8964:32926, Sidebar set 14510:10657" — that node IS this
  // key), so this is a 1:1 component match, not an approximation. It is a
  // COMPOUND: the emit case builds <Sidebar.Root> and never <Sidebar/>.
  // DELIBERATELY NOT MAPPED — 0.3 "Sidebar" (96a5f2ff…) and "Items/Expanded"
  // (51e257d3…). Both were mapped for one day and both had to come out; the
  // reasons are different and worth keeping.
  //
  // "Sidebar" is a COMPOUND. Emitting <Sidebar.Root> hands layout to the kit,
  // which is incompatible with an importer whose whole promise is Figma's own
  // geometry: children kept their absolute left/top (resolving against an
  // ancestor outside the compound) and horizontal rows got flexGrow in a
  // vertical container. Measured against the design, "Pins" landed at y=362
  // instead of 112. Leaf-only mapping renders it pixel-exact.
  //
  // "Items/Expanded" LOOKS like a leaf and is not: a mapped instance absorbs its
  // whole subtree, and these rows contain the person avatars, the unread dots,
  // the avatar stack with its "+9" count and the leading glyphs. Mapping the row
  // deleted all of that AND repainted it with the kit's row surface and line
  // height — grey blocks, washed-out text, no truncation, and "More" overlapping
  // "Messages" where a 28px Figma box met a taller component. Left unmapped, the
  // row keeps the design's text and spacing and its avatars still map as real
  // <Avatar>s on their own.
  "31849ab9b4e941d9e77ac29361573f053dbb0990": "Button", // 0.3 "Computer Action" (the New-session CTA)
  "4b433b10b30118026ca3e392fd033011bab3b57c": "IconButton", // 0.3 "History Action"
  // Computer input parts. NOTE the composer ITSELF is deliberately absent: on
  // the screen above it is a component LOCAL to the design file (key
  // 4854423e90…), not the library's, so a key can't match it — and its set is
  // named the bare word "Input", which is arcade-gen's TEXT FIELD. A name row
  // for it would turn every text field in every design into a ChatComposer.
  // Map it once the library's own "Computer input / Input" set key is known.
  "5ca8c57f76581c9a3b325c9a4364fe6c0e15c75b": "Separator", // 0.3 "Separator/Progressive"
  // NOT MAPPED, same reason as the row above: these are GROUP wrappers, and a
  // mapped instance absorbs its subtree. "Avatar Stack/Linear/Circle"
  // (e539550d…) lost the stack's "+9" overflow count; "Attachment group"
  // (31dfb458…) and "Text pasted attachment group" (25833cd9…) would re-flow
  // children Figma had already placed. Unmapped, each child still maps on its
  // own — the stack's faces are real <Avatar>s — and nothing moves.
  // DELIBERATELY NOT MAPPED: 0.3 "Group label" (21d4cbb7df…). Inside a sidebar
  // its text becomes the REQUIRED `title` of the enclosing <Sidebar.Section>, so
  // emitting it again as its own component would duplicate the heading. The
  // Sidebar emit case consumes it. On its own, outside a sidebar, faithful
  // markup is the right answer for it anyway.
  // DELIBERATELY OMITTED (kept as faithful static markup — a wrong component is
  // worse than the current default): Menu (0375c0ba…), Modal Content
  // (8122e871…), Popover (6a9dc99a…) are Radix-portal compounds whose VALUE is
  // the open panel — emitting the shell requires a live open-context and would
  // either throw or portal into nothing (blank frame), AND would absorb/lose the
  // panel's rich subtree. Tooltip (758e0e9d…) needs a `children` trigger +
  // `content` a bare instance never carries. See the plan's Phase C RISK 1–3.
};

/**
 * Component-set NAME → kit component, for instances whose set is local /
 * detached (no published key match). Special pseudo-kits:
 *  - "ImageAvatar": an avatar whose visual is a photo (IMAGE fill) → kit
 *    Avatar with src pointing at the exported PNG.
 */
export const SET_NAME_TO_KIT: Record<string, string> = {
  // NOTE: generic single-word names ("Button", "Avatar") are DELIBERATELY NOT
  // here. Matching a bare "Button" set name maps ANY generation's Button
  // (incl. deprecated/DLS) to arcade-gen — a cross-generation mislabel that
  // ships wrong production code. Arcade Buttons/Avatars resolve by KEY
  // (SET_KEY_TO_KIT), which is certain. Only keep names that are pseudo-kit
  // routes or icon-adjacent and unlikely to collide.
  "Account Avatar": "AccountAvatar",
  Images: "ImageAvatar",
  "User avatars": "ImageAvatar",
  "Avatar Group": "AvatarGroup",
  "Ghost Button": "IconButton",
  "Icon Button": "IconButton",
  // C3 — arcade-gen 2.0 components. These Figma set names are quoted verbatim in
  // arcade-gen's own type declarations (the components were built FROM these
  // sets), so the name→kit link is the library author's, not a guess. They're
  // also specific enough to clear the collision bar above: no other DevRev
  // generation ships a set called "Chip Button" or "Input/Number field".
  // Each one has a matching emit case in kitEmit.ts — a name with no case falls
  // back to faithful markup, which is safe but pointless.
  //
  // All but "Attribute Item" ALSO have their published set key in
  // SET_KEY_TO_KIT above, so these rows only fire for detached/local copies.
  "Search Input": "SearchInput",
  "Input/Number field": "NumberField",
  "Chip Button": "ChipButton",
  "Filter Button": "FilterButton",
  // UNVERIFIED against the published library: arcade-gen's types cite a Figma
  // set called "Attribute Item", but no such published component or set exists
  // in a2uKnm88LxRXEWAL1kOqeQ (checked 2026-08-12) — it likely lives in a file
  // we haven't indexed. Name-only, so it simply never fires until such a set
  // shows up in a designer's file; harmless either way.
  "Attribute Item": "AttributeItem",
  "File attachment": "FileAttachment",
};

/**
 * Filename extension → arcade-gen `FileAttachmentDocType`. The kit picks the
 * file glyph from `docType`; an unmapped extension is simply omitted so the
 * component uses its own "fallback" glyph. Keys are lowercased extensions.
 */
/**
 * 0.3 "File attachment" `Document` variant option → arcade-gen
 * `FileAttachmentDocType`. Captured live from the component set's
 * componentPropertyDefinitions (node 13747:1735, 2026-08-12). The set's ninth
 * option, `Failed`, is deliberately absent: it is the error STATE, not a file
 * type, and maps to the `failed` prop instead.
 */
export const FIGMA_DOCUMENT_TO_DOC_TYPE: Record<string, string> = {
  PDF: "pdf",
  PPT: "ppt",
  TXT: "txt",
  Markdown: "markdown",
  HTML: "html",
  DOC: "doc",
  CSV: "csv",
  Fallback: "fallback",
};

export const FILE_ATTACHMENT_DOC_TYPES: Record<string, string> = {
  pdf: "pdf",
  ppt: "ppt",
  pptx: "ppt",
  txt: "txt",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  doc: "doc",
  docx: "doc",
  csv: "csv",
};

/**
 * Pseudo-kit routing keys → the REAL arcade-gen component the emitter renders
 * for them. A few mapping values aren't direct kit exports; they're emit-switch
 * routes that render an existing component with extra props (e.g. an avatar
 * whose visual is a photo, or an account avatar). The mapping-hygiene test (D2)
 * validates each value against the real barrel by first resolving it through
 * this table, so these legitimately-non-exported routes don't false-fail — while
 * still asserting the component they ACTUALLY render (`Avatar`) exists.
 */
export const PSEUDO_KIT_RENDERS: Record<string, string> = {
  ImageAvatar: "Avatar", // Avatar with src = exported photo PNG
  AccountAvatar: "Avatar", // Avatar type="account" shape="square"
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
  // NOTE: there is intentionally NO "Icons / Sidebar.Left" entry. arcade-gen has
  // no sidebar-left ICON — `Sidebar` is a compound LAYOUT object ({Root, Section,
  // Item}), not a renderable glyph. Mapping the icon to `Sidebar` emitted
  // `<Sidebar size={16}/>`, which React rejects ("Element type is invalid …
  // got: object") and white-screens the whole frame. With no mapping, the node
  // falls back to an exported SVG (always renders). The NON_RENDERABLE_KIT_EXPORTS
  // guard below now makes this class of mistake impossible to ship again.
  "Icons/Agent.studio": "AgentStudio",
  "Icons/Arrow.pointing.into.tray": "ArrowPointingIntoTray",
  "Icons/Cross": "CrossSmall",
  "Cross.large": "CrossLarge", // the sidebar close button glyph (20px)
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
  // ---- Bare published set names, captured live 2026-08-12 ----
  // Every row above pairs a kit icon with a name like "Icons/Bell". That prefix
  // is how the set surfaces when it's nested under an Icons frame — but the sets
  // are PUBLISHED under their bare dotted names ("Bell", "Magnifying.glass"),
  // which is what a consuming file reports for a direct library instance. So the
  // prefixed rows alone missed the most common case. Verified against
  // GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/component_sets — all 521 Icons-page
  // sets — so each name below is a real set, not a guess.
  Window: "Window",
  Computer: "Computer",
  Bell: "Bell",
  Clock: "Clock",
  Document: "Document",
  Eye: "Eye",
  Book: "Book",
  Paperclip: "Paperclip",
  Pin: "Pin",
  Globe: "Globe",
  Calendar: "Calendar",
  Flag: "Flag",
  Lock: "Lock",
  Cog: "Cog",
  Camera: "Camera",
  Photo: "Photo",
  Placeholder: "Placeholder",
  "Chat.bubbles": "ChatBubbles",
  "Magnifying.glass": "MagnifyingGlass",
  "Magnifying.glass.in.square": "MagnifyingGlassInSquare",
  "Dot.in.left.window": "DotInLeftWindow",
  "Dot.in.right.window": "DotInRightWindow",
  "Arrows.up.and.down": "ArrowsUpAndDown",
  "Horizontal.lines.with.circles": "HorizontalLinesWithCircles",
  "Human.silhouette.with.plus": "HumanSilhouetteWithPlus",
  "Agent.studio": "AgentStudio",
  "Arrow.pointing.into.tray": "ArrowPointingIntoTray",
  "Plus.circles.cross": "PlusCirclesCross",
  "Three.bars.horizontal": "ThreeBarsHorizontal",
  "Three.dots.vertical": "ThreeDotsVertical",
  "Three.dots.horizontal": "ThreeDotsHorizontal",
  "Trash.bin": "TrashBin",
  "Chinese.character.with.letter.a": "ChineseCharacterWithLetterA",
  "Plus.small": "PlusSmall",
  "Plus.in.chat.bubble": "PlusInChatBubble",
  "Chevron.left.small": "ChevronLeftSmall",
  "Chevron.right.small": "ChevronRightSmall",
};

/**
 * Default control variant for 0.3 sets that expose NO `Variant` property.
 *
 * "Computer Action" (the New-session CTA) and "History Action" (its close button)
 * are both light-grey in the design, but neither carries a Variant prop — so the
 * generic fallbacks made them `primary` (solid black) and `tertiary` (no surface).
 * Keyed by SET NAME because that's what identifies the component; the values are
 * arcade-gen variant names.
 *
 * NOTE on shape: the design draws both fully rounded, and in arcade-gen 2.0 only
 * `primary`/`expressive` are pill/circular — `secondary` is square-cornered. The
 * wrapper's radius does NOT rescue this (an earlier note here claimed it did and
 * was wrong: the wrapper's own background is stripped, so it clips nothing and the
 * control's 4px corners showed through). The radius is passed to the control
 * itself — see controlBoxStyle in kitEmit.
 */
export const SET_NAME_DEFAULT_VARIANT: Record<string, string> = {
  "Computer Action": "secondary",
  "History Action": "secondary",
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

// C2 — variant-axis translation beyond Variant/Size. Each map reverses the
// `valueMap` recorded in src/export/figma/componentEntries.ts (arcade-gen prop
// value → Figma option) so the EMITTER can go the other way (Figma option →
// arcade-gen prop value). An unmapped Figma value falls through to the
// component's own default — never a wrong/throwing prop.

/** Badge `Variant` axis → arcade-gen Badge `variant`. The kit's BadgeVariant
 *  is exactly `"emphasis" | "neutral"` (verified against the installed barrel;
 *  the runtime is `variant === "emphasis" ? emphatic : neutral`). 0.3 "Counter"
 *  exposes Emphasis / Neutral — a direct 1:1 map. An earlier table emitted
 *  Emphasis → "info" (a value the kit Badge has NO case for), which silently
 *  rendered every emphatic counter as neutral while an unset variant rendered
 *  emphatic (kit default) — fully inverted. Map onto the real union. */
export const BADGE_VARIANT_MAP: Record<string, string> = {
  Neutral: "neutral",
  Emphasis: "emphasis",
};

/** Tag (0.3 "Chip") `Type` axis → arcade-gen Tag `intent`. */
export const TAG_INTENT_MAP: Record<string, string> = {
  Neutral: "neutral",
  Alert: "alert",
  Success: "success",
  Warning: "warning",
  Info: "info",
  Intelligence: "intelligence",
};

/** Tag (0.3 "Chip") `Appearance` axis → arcade-gen Tag `appearance`. */
export const TAG_APPEARANCE_MAP: Record<string, string> = {
  Tinted: "tinted",
  Filled: "filled",
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
 * arcade-gen exports that are COMPOUND NAMESPACE OBJECTS, not renderable React
 * components — `Sidebar` is `{ Root, Section, Item }`, `Modal` is `{ Root,
 * Content, … }`, etc. Emitting one as a bare element (`<Sidebar />`) makes React
 * throw "Element type is invalid … got: object" and white-screen the whole
 * frame. These names are real exports, so the export-membership hygiene test
 * passes them — this list is the SECOND gate: a mapping resolving to one of
 * these (especially as an `icon`, which always emits `<Name />`) is a bug.
 *
 * The icon path enforces it at runtime (drops the match → SVG fallback, which
 * always renders); the component path uses dotted sub-components via the emit
 * switch (`<Modal.Root>`, `<Select.Trigger>`) so a bare object never reaches
 * JSX there. A hygiene test asserts no ICON mapping value is in this set.
 *
 * Sourced from the compound `declare const X: { … }` exports in arcade-gen's
 * index.d.mts. If the kit adds another compound, add it here too.
 */
export const NON_RENDERABLE_KIT_EXPORTS = new Set<string>([
  "Accordion", "Breadcrumb", "Chart", "Dropdown", "Menu", "Modal", "Popover",
  "Radio", "ResizablePanel", "SegmentedControl", "Select", "Sidebar", "Table",
  "Tabs", "Toast", "Widget",
]);
// Re-derived against arcade-gen 2.0.0: the 16 names above are exactly the
// `declare const X: { … }` pure-namespace exports in index.d.mts. Deliberately
// ABSENT (they are real renderable components that merely carry sub-parts —
// `declare const X: ForwardRefExoticComponent<…> & { … }`): Card,
// CardRadioSelect, Grid, ToggleGroup. Note `SegmentedControl` replaced
// `ToggleGroup` here in 2.0 — the segmented control is the compound one now,
// while `ToggleGroup` became a renderable labelled-toggle-row list.

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
    const kit = ICON_SET_NAME_TO_KIT[setName];
    // Guard: an icon mapping must resolve to a renderable glyph, never a
    // compound layout object. A bad row (e.g. the old Sidebar.Left → Sidebar)
    // would otherwise emit `<Sidebar size={16}/>` and crash the frame. Drop the
    // match so the node falls back to its exported SVG, which always renders.
    if (!NON_RENDERABLE_KIT_EXPORTS.has(kit)) {
      return { kind: "icon", kit };
    }
  }
  if (setKey && SET_KEY_TO_KIT[setKey]) {
    return { kind: "component", kit: SET_KEY_TO_KIT[setKey] };
  }
  if (setName && SET_NAME_TO_KIT[setName]) {
    return { kind: "component", kit: SET_NAME_TO_KIT[setName] };
  }
  return null;
}
