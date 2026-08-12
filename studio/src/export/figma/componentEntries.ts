// Curated arcade-gen -> Arcade 0.3 component mappings. Captured Bridge-assisted
// from "Arcade UI Kit v0.3" (file key a2uKnm88LxRXEWAL1kOqeQ) and confirmed with
// the design owner (see CURATION-NOTES.md).
//
// Convention: unprefixed (0.3) preferred; [0.2] fallback; [DLS]/[WIP]/[DEPRECATED]
// rejected. Renamed concepts (Badge->Counter, Tag->Chip, Switch->Toggle) are real
// mappings, not gaps — the note records the rename.
//
// `variants` lists only the axes an arcade-gen prop drives; every other variant
// axis falls to the component's own default. `valueMap` maps the arcade-gen prop
// value to the Figma variant option. Keys are PUBLISHED component-set keys.
import type { FigmaComponentMapping } from "./types";

export const COMPONENT_ENTRIES: FigmaComponentMapping[] = [
  {
    arcadeGen: "ChatBubble",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "edd2821db8a05b808da334a1c6aed7646d23e82e", setName: "Bubble" },
    variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
    textNode: { strategy: "lowest-depth" },
    note: "Unprefixed canonical; rejected [DLS]/[WIP]/[0.2] Bubble. Proven end-to-end in Slice 0.",
  },
  {
    arcadeGen: "Button",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "0b87fe4f9790e1c0053da61c767edbaa1c46826d", setName: "Button" },
    variants: [
      { prop: "variant", figmaProp: "Variant", valueMap: { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary", expressive: "Expressive", destructive: "Destructive" } },
      { prop: "size", figmaProp: "Size", valueMap: { sm: "Small", md: "Default", lg: "Large" } },
    ],
    textNode: { strategy: "lowest-depth" },
    note: "Unprefixed canonical; rejected [DLS]Button (Varient/Smart/Skeleton), [0.2], [DEPRECATED]Button/*.",
  },
  {
    arcadeGen: "IconButton",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "3abc28fac47cbde78a253917b98d8b34eabfb218", setName: "Icon Button" },
    variants: [
      { prop: "variant", figmaProp: "Variant", valueMap: { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary", expressive: "Expressive", destructive: "Destructive" } },
      { prop: "size", figmaProp: "Size", valueMap: { sm: "Small", md: "Default", lg: "Large" } },
    ],
    note: "Unprefixed canonical 'Icon Button'; same Variant/Size axes as Button.",
  },
  {
    arcadeGen: "Checkbox",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "a1475c3e4dfdf52bca771aff82f3ac849d31a036", setName: "Checkbox" },
    variants: [
      { prop: "checked", figmaProp: "Checked", valueMap: { true: "True", false: "False" } },
    ],
    note: "Unprefixed canonical. Axes: Checked/State/Indeterminate/Disabled; we drive Checked.",
  },
  {
    arcadeGen: "Avatar",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "e9b9f1195504a3861823a8968797827963f26e5a", setName: "User Avatar" },
    variants: [
      { prop: "size", figmaProp: "Size", valueMap: { sm: "Small", md: "Default", lg: "X-Large" } },
    ],
    textNode: { strategy: "lowest-depth" },
    note: "Owner-specified 'User Avatar' (not Avatar Circle / Account Avatar). Axes Size/Fallback.",
  },
  {
    arcadeGen: "Tooltip",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "758e0e9d40787c3ac9b206afe70020ba8b885548", setName: "Tooltip" },
    variants: [],
    textNode: { strategy: "lowest-depth" },
    note: "Owner-linked canonical Tooltip (node 4592:40566). Axes Position/Contents left to defaults.",
  },
  {
    arcadeGen: "Tabs",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "ee83688019e9eaf97359ee86016e4b65a4db0d4c", setName: "Tabs" },
    variants: [],
    note: "Unprefixed 'Tabs' (bare COMPONENT, no variant axes). Tab rows are '_Tab Item' (key 891e2f83…), handled per-item by #3.",
  },
  {
    arcadeGen: "Breadcrumb",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "0ecf3d67728cfd4196e964bbfb3795f540a0c70b", setName: "Breadcrumbs" },
    variants: [],
    note: "Unprefixed 'Breadcrumbs' (bare COMPONENT). Sub-parts '_Separator' (214c0166…) + '_Item' (4da0fa6e…) handled by #3.",
  },
  {
    arcadeGen: "Badge",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "367267f81839b123664fa8b1304b16ee6006b37a", setName: "Counter" },
    variants: [
      { prop: "variant", figmaProp: "Variant", valueMap: { neutral: "Neutral", emphasis: "Emphasis" } },
    ],
    textNode: { strategy: "lowest-depth" },
    note: "RENAMED CONCEPT: arcade-gen 'Badge' == 0.3 'Counter'. Axis Variant (Emphasis/Neutral). The kit Badge variant is exactly 'emphasis' | 'neutral' (see server/figma/kitMappings.ts BADGE_VARIANT_MAP); an earlier table mapped non-existent 'info'/'intelligence' values and omitted 'emphasis'.",
  },
  {
    arcadeGen: "Tag",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "3067f69c7f76e7c43815148ce843654e36081bed", setName: "Chip" },
    variants: [
      { prop: "intent", figmaProp: "Type", valueMap: { neutral: "Neutral", alert: "Alert", success: "Success", warning: "Warning", info: "Info", intelligence: "Intelligence" } },
      { prop: "appearance", figmaProp: "Appearance", valueMap: { tinted: "Tinted", filled: "Filled" } },
    ],
    textNode: { strategy: "lowest-depth" },
    note: "RENAMED CONCEPT: arcade-gen 'Tag' == 0.3 'Chip'. Rejected [DLS]Chip, [DEPRECATED]Chip, Expressive Chip, Chip Button. Type axis (verified live): Neutral/Alert/Success/Warning/Info/Intelligence (note: the set also has a stray 'Intelligent' dupe of 'Intelligence' — we use the canonical 'Intelligence'). Appearance: Tinted/Filled.",
  },
  {
    arcadeGen: "Switch",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "c921cbb0bf76d6f6d7f7908b9d3426e73f668728", setName: "Toggle" },
    variants: [
      { prop: "checked", figmaProp: "Toggle", valueMap: { true: "True", false: "False" } },
    ],
    note: "RENAMED CONCEPT: arcade-gen 'Switch' == 0.3 'Toggle'. Rejected [DLS]Toggle, [DEPRECATED]Switcher/Toggle. Axes State/Toggle/Disabled; we drive Toggle.",
  },
  {
    arcadeGen: "Input",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "c4ff2f34e04a5c0f5b0c94733b157e512a871ec7", setName: "Input/Text field" },
    variants: [],
    textNode: { strategy: "lowest-depth" },
    note: "Unprefixed canonical 'Input/Text field' (27 variants, axes Type/State). Rejected [DLS]Field.*, [DEPRECATED]Text Field. Type/State left to defaults (Default/Idle).",
  },
  {
    arcadeGen: "Select",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "93bc12b8c36c35f775f3a71d4821f4541e32dc79", setName: "Select" },
    variants: [],
    textNode: { strategy: "lowest-depth" },
    note: "Owner-linked canonical Select (node 1150:8268). Axes States/Active/Disabled/Placeholder left to defaults.",
  },
  {
    arcadeGen: "Menu",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "0375c0bad6187274768f512c0422719a7493749d", setName: "Menu" },
    variants: [
      { prop: "width", figmaProp: "Width", valueMap: { sm: "Small", md: "Default" } },
    ],
    note: "Owner-linked canonical Menu (node 886:6081). Axis Width.",
  },
  {
    arcadeGen: "Modal",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "8122e8716d61125d19bb89de69b4525fa45311bf", setName: "Modal Content" },
    variants: [
      { prop: "size", figmaProp: "Size", valueMap: { sm: "Small", md: "Medium", lg: "Large" } },
    ],
    note: "Owner-linked Modal (node 4602:43787) resolves to 'Modal Content' set. Axis Size.",
  },
  {
    arcadeGen: "Popover",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "6a9dc99a75e632b481f5c0ac0c1fd7ba7ae03ebb", setName: "Popover" },
    variants: [],
    note: "Owner-linked canonical Popover (node 4592:40710). NOTE: the set has internal Figma errors so variant defs aren't readable; instance with defaults. Re-verify variant axes when the set is fixed in 0.3.",
  },
  {
    arcadeGen: "Separator",
    status: "ambiguous",
    generation: null,
    figma: null,
    variants: [],
    note: "Owner-linked separators page (node 5145:206173) has line/progressive/dotted styles as separate bare components, not one canonical set; name search returns none. Marked ambiguous pending a targeted pick; degrades to #3 fallback (a thin rule is trivially reconstructed). Re-curate to the intended default separator.",
  },
  {
    arcadeGen: "DevRevThemeProvider",
    status: "ambiguous",
    generation: null,
    figma: null,
    variants: [],
    note: "Provider, no UI component analogue in 0.3. Always degrades to fallback (renders its children's frame). Expected ambiguous.",
  },

  // --- arcade-gen 2.0 components ---
  // Keys AND variant axes captured live 2026-08-12 from
  //   GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/component_sets
  //   GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/nodes?ids=…  (componentPropertyDefinitions)
  // so the axis names and option spellings below are the file's, not inferred.
  // Two traps worth knowing before editing these:
  //  1. The pressed look is its own `Active / Pressed` axis (spaces around the
  //     slash are part of the name). `State` is only idle/hover.
  //  2. The file still publishes deprecated twins ([🔴DEPRECATED] Chip Button,
  //     [🔴DEPRECATED]Number Field, [DLS]File Attachment, [DLS]Search Input).
  //     These entries are keyed, so they can never resolve to one.
  {
    arcadeGen: "SearchInput",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "19d5b8170133af3b1411a5be16b94621b558c816", setName: "Search Input" },
    variants: [],
    textNode: { strategy: "by-name", name: "Placeholder" },
    note: "Axes are Placeholder(True/False) and Focus(True/False) — both are STATES, not props the kit exposes, so none is driven and the set defaults (empty, unfocused) apply. The query/placeholder text is the TEXT node named 'Placeholder'.",
  },
  {
    arcadeGen: "ChipButton",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "62304142aad2baf93fd56949820a5989f2715349", setName: "Chip Button" },
    variants: [
      { prop: "size", figmaProp: "Size", valueMap: { sm: "Small", md: "Default", lg: "Large" } },
      { prop: "active", figmaProp: "Active / Pressed", valueMap: { true: "True", false: "False" } },
      { prop: "loading", figmaProp: "Loading", valueMap: { true: "True", false: "False" } },
      { prop: "disabled", figmaProp: "Disabled", valueMap: { true: "True", false: "False" } },
    ],
    textNode: { strategy: "by-name", name: "Chip" },
    note: "Set default is Size=Small. `active` drives the 'Active / Pressed' axis — NOT `State`, whose only options are Idle | 'Hover / Press'. Skeleton axis left at default.",
  },
  {
    arcadeGen: "FilterButton",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "e4341909fd0d33d86b5284326349c6f2d678a70c", setName: "Filter Button" },
    variants: [
      { prop: "active", figmaProp: "Active / Pressed", valueMap: { true: "True", false: "False" } },
      { prop: "disabled", figmaProp: "Disabled", valueMap: { true: "True", false: "False" } },
    ],
    note: "Deliberately NO textNode hint: the set nests TWO TEXT nodes both named 'Label' (one holds the label, one holds the value), so a by-name write would land on whichever matched first and could print the label into the value slot. Variants export correctly; the text stays at the set default until the pair is disambiguated live. The `Has Value#19936:37` boolean toggles the value segment.",
  },
  {
    arcadeGen: "NumberField",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "4c4e26eb174a90e98da63a36f351946ad43498a5", setName: "Input/Number field" },
    variants: [
      { prop: "size", figmaProp: "Type", valueMap: { md: "Small", lg: "Default" } },
    ],
    note: "`Type` = Floating label | Default | Small, and it is a SINGLE axis carrying what the kit splits across two props (`size` and `labelStyle`). We drive it from `size` because that's the visible geometry: md → Small (28px), lg → Default (40px). A kit labelStyle='floating' should map to Type='Floating label' but can't share the axis; the set default IS Floating label, so an unsized field already lands there. State axis (Idle…Alert/Success) left at default.",
  },
  {
    arcadeGen: "FileAttachment",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "a11a736d2e3ef8673c0f3b57e18301cfcd0fbd37", setName: "File attachment" },
    variants: [
      {
        prop: "docType",
        figmaProp: "Document",
        valueMap: {
          pdf: "PDF", ppt: "PPT", txt: "TXT", markdown: "Markdown",
          html: "HTML", doc: "DOC", csv: "CSV", fallback: "Fallback",
        },
      },
    ],
    note: "One axis, `Document`, whose ninth option `Failed` is the error STATE rather than a file type — the kit models that as a separate `failed` boolean, which therefore can't be expressed on this axis (a failed export lands on its docType glyph instead). No textNode hint: the filename node is named after its own content ('Design document'), so the name isn't stable across instances.",
  },

  // --- Composite sub-parts surfaced by the fiber walk (the widen work) ---
  // The fiber tree exposes a frame's composite SUB-PARTS by name; these map to
  // real 0.3 primitives so the sidebar/chrome become real instances, not boxes.
  // Keyed on the QUALIFIED kit name (e.g. "ComputerSidebar.Item") — the kit
  // sub-parts must set a matching displayName so the fiber reports it qualified
  // (the bare name "Item" collides across composites). The export wiring (T8)
  // can also alias bare "Item" -> this entry when the parent composite is known.
  {
    arcadeGen: "ComputerSidebar.Item",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "ab11c00fafe90d430bc8dc9532da2d358012c7c9", setName: "Chat Item" },
    variants: [],
    textNode: { strategy: "by-name", name: "Item name#8536:0" },
    note: "Sidebar session/chat row → 0.3 'Chat Item' (set ab11c00f…, node 9013:34176, on the Navigation page). Probed live 2026-06-08: real labeled row — Leading (User Avatar), Content TEXT 'User', Trailing Dot. Label is the TEXT component property 'Item name#8536:0' (default 'User'); set via setProperties or by writing the 'User' TEXT node. Axes State(:idle/:hover/:active)/Expanded/hasUnread left to defaults. NOTE: an earlier curation pointed at 0.3 'Computer Item' (d5ad9a6b…) — that's the animated Computer WORDMARK chip with no label; do NOT use it for rows. Kit sub-part sets displayName 'ComputerSidebar.Item' so the fiber reports it qualified (collides with CanvasPanel.Item otherwise).",
  },
  {
    arcadeGen: "ComputerSidebar.User",
    status: "ambiguous",
    generation: null,
    figma: null,
    variants: [],
    note: "Sidebar user-footer composite (avatar + name + subtitle). No single 0.3 component; assembled from Computer Avatar + text. Degrades to a frame that recurses (its inner Avatar maps separately). Re-curate if a 0.3 'User Footer' appears.",
  },
];
