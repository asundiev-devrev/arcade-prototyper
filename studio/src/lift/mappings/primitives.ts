// studio/src/lift/mappings/primitives.ts
//
// Studio arcade-gen primitive → production raw-design-system equivalents.
// Curated by hand. When arcade-gen or raw-design-system change, update
// entries here; the mapping-coverage test fails loud when a primitive
// exported from arcade-components.tsx has no entry.
//
// Scope: only primitives actually reachable from generated frames. That's
// everything exported from studio/prototype-kit/arcade-components.tsx.
// Not the full arcade-gen API — a frame can't import things arcade-components
// doesn't re-export.

import type { MappingEntry } from "../types";

const PROD_SOURCE = "@devrev-web/design-system/shared/raw-design-system";

export const PRIMITIVE_MAPPINGS: MappingEntry[] = [
  // --- Core controls -----------------------------------------------------
  {
    studio: { source: "arcade", name: "Button" },
    production: { source: PROD_SOURCE, name: "Button" },
    propDeltas: [
      {
        from: "size",
        to: "size",
        valueMap: { md: "M", lg: "L" },
        note: "Studio narrows to md|lg; production accepts S|M|L. A Studio frame never uses sm.",
      },
      {
        from: "variant",
        to: "variant",
        valueMap: {
          primary: "primary",
          secondary: "secondary",
          tertiary: "tertiary",
          destructive: "destructive",
        },
      },
    ],
    slotNotes: [
      "Children are identical. Leading/trailing icons move from raw children to `start` / `end` slots in production.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "IconButton" },
    production: { source: PROD_SOURCE, name: "IconButton" },
    propDeltas: [
      { from: "size", to: "size", valueMap: { md: "M", lg: "L" } },
      { from: "variant", to: "variant" },
    ],
    slotNotes: [
      "Studio injects a numeric `size` prop onto the single icon child via React.cloneElement. Production renders the icon as-is inside a Slot; size is controlled by the IconButton's own size token. Drop the runtime cloning when translating.",
    ],
    translationClass: "structural",
  },
  // --- Inputs ------------------------------------------------------------
  {
    studio: { source: "arcade", name: "Input" },
    production: { source: PROD_SOURCE, name: "TextInput" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onChange" },
      { from: "placeholder", to: "placeholder" },
      {
        from: "disabled",
        to: "modifiers",
        note: "Production moves disabled/readOnly into a `modifiers` prop object: modifiers={{ disabled: true }}.",
      },
    ],
    slotNotes: [
      "Studio exposes `start` / `end` as children-like nodes. Production uses explicit `start` / `end` slot props.",
    ],
    translationClass: "structural",
    judgmentNote: undefined,
  },
  {
    studio: { source: "arcade", name: "Select" },
    production: { source: PROD_SOURCE, name: "SingleSelect" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onValueChange" },
    ],
    slotNotes: [
      "Production uses a compound API: <SingleSelect.Root><SingleSelect.Trigger /><SingleSelect.Options>... Migrate children accordingly.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade", name: "Checkbox" },
    production: { source: PROD_SOURCE, name: "Checkbox" },
    propDeltas: [
      { from: "checked", to: "checked" },
      { from: "onChange", to: "onCheckedChange" },
    ],
    slotNotes: [],
    translationClass: "mechanical",
  },
  // --- Surfaces ----------------------------------------------------------
  {
    studio: { source: "arcade", name: "Modal" },
    production: { source: PROD_SOURCE, name: "Modal" },
    propDeltas: [
      { from: "open", to: "open" },
      { from: "onOpenChange", to: "onOpenChange" },
    ],
    slotNotes: [
      "Both use compound subcomponents. Rename Modal.Root → Modal.Root, Modal.Content → Modal.Content, etc. API shape matches closely; mechanical.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Popover" },
    production: { source: PROD_SOURCE, name: "Popover" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Tabs" },
    production: { source: PROD_SOURCE, name: "TabList" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onValueChange" },
    ],
    slotNotes: ["Production names the component TabList; subcomponent shape is similar."],
    translationClass: "mechanical",
  },
  // --- Misc --------------------------------------------------------------
  {
    studio: { source: "arcade", name: "Badge" },
    production: { source: PROD_SOURCE, name: "Badge" },
    propDeltas: [{ from: "variant", to: "variant" }],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Tooltip" },
    production: { source: PROD_SOURCE, name: "Tooltip" },
    propDeltas: [{ from: "content", to: "content" }],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Avatar" },
    production: { source: PROD_SOURCE, name: "Avatar" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Tag" },
    production: { source: PROD_SOURCE, name: "Chip" },
    propDeltas: [{ from: "intent", to: "variant", note: "Studio's TagIntent maps onto production Chip variants; 1:1 for the common cases." }],
    slotNotes: [],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade", name: "Separator" },
    production: { source: PROD_SOURCE, name: "Separator" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "DevRevThemeProvider" },
    production: { source: PROD_SOURCE, name: "ThemeProvider" },
    propDeltas: [],
    slotNotes: [
      "Production's ThemeProvider takes the arcade theme config via spread: `<ThemeProvider {...arcadeDesignSystemTheme()}>`. Studio's DevRevThemeProvider takes a `mode` prop directly; translation reassembles the theme call.",
    ],
    translationClass: "judgment",
    judgmentNote:
      "Confirm whether the target feature already has a ThemeProvider further up the tree (devrev-web typically wraps at the feature level, not the frame level). Likely remove this wrapper from the translated output.",
  },
];
