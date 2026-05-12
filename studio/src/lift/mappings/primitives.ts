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
        // Agent-authored frames can and do pass size="sm" directly despite
        // the TS narrowing in studio/prototype-kit/arcade-components.tsx —
        // the wrapper coerces sm→md at runtime, but the lift sees the
        // pre-coercion value in source. Production accepts S|M|L, so the
        // honest translation is sm→S. (The original note claimed "a Studio
        // frame never uses sm"; live lift of 01-skills-gallery proved that
        // false — every Button/IconButton in that frame used sm.)
        valueMap: { sm: "S", md: "M", lg: "L" },
      },
      { from: "variant", to: "variant" },
    ],
    slotNotes: [
      "Children are identical. Leading/trailing icons move from raw children to `start` / `end` slots in production.",
    ],
    translationClass: "mechanical",
    knownStudioProps: [
      "size",
      "variant",
      "iconLeft",
      "iconRight",
      "loading",
      "disabled",
      "onClick",
      "className",
      "children",
      "type",
      "aria-label",
    ],
  },
  {
    studio: { source: "arcade", name: "IconButton" },
    production: { source: PROD_SOURCE, name: "IconButton" },
    propDeltas: [
      { from: "size", to: "size", valueMap: { sm: "S", md: "M", lg: "L" } },
      { from: "variant", to: "variant" },
    ],
    slotNotes: [
      "Studio injects a numeric `size` prop onto the single icon child via React.cloneElement. Production renders the icon as-is inside a Slot; size is controlled by the IconButton's own size token. Drop the runtime cloning when translating.",
    ],
    translationClass: "structural",
    knownStudioProps: [
      "size",
      "variant",
      "aria-label",
      "children",
      "loading",
      "disabled",
      "onClick",
      "className",
    ],
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
    // Corrected 2026-05-12: prior mapping said "TabList" but production
    // re-exports the component as `Tabs` from raw-design-system. Drift
    // audit caught the inconsistency. The subcomponent shape (Tabs.List,
    // Tabs.Item, etc.) is noted below.
    studio: { source: "arcade", name: "Tabs" },
    production: { source: PROD_SOURCE, name: "Tabs" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onValueChange" },
    ],
    slotNotes: [
      "Studio Tabs.Root / Tabs.Trigger → production Tabs / Tabs.Item. Tabs.List is identical.",
    ],
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
    propDeltas: [
      {
        from: "size",
        to: "size",
        // Production Avatar `size` is a NUMERIC-STRING token enum
        // ('12'|'16'|'20'|'24'|'28'|'32'|'40'|'48'|'64'|'72'|'96'|...).
        // Studio's xs|sm|md|lg|xl don't map 1:1 — these are conservative
        // visual matches picked against the arcade-gen default sizes.
        // Reviewer should confirm per-call-site against design.
        valueMap: { xs: "16", sm: "24", md: "32", lg: "40", xl: "64" },
      },
      // Production Avatar takes `name` (not displayName — a 2026-05-12
      // live-lift run hallucinated displayName based on other DS
      // conventions and shipped broken code). Identity delta is here
      // so the prop-coverage lint proves the author considered it.
      { from: "name", to: "name" },
      // Studio Avatar takes `src`; production Avatar takes `image`.
      // Same URL value, renamed prop.
      { from: "src", to: "image" },
    ],
    slotNotes: [
      "Studio's string size tokens (xs|sm|md|lg|xl) map to production numeric-string tokens. Confirm per call site against design — numeric tokens exist at finer granularity than Studio's five-step scale.",
      // Explicit because the hallucination is cheap: downstream LLMs see Avatar and guess 'displayName' from familiar DS APIs. Production uses `name`.
      "Prop names carry unchanged: `name` stays `name` (NOT `displayName`), `image` stays `image`. Production Avatar extracts initials from `name` the same way Studio does.",
    ],
    translationClass: "structural",
    knownStudioProps: [
      "size",
      "name",
      "src", // arcade Avatar uses `src`; production uses `image`
      "type",
      "shape",
      "status",
      "icon",
      "contextBadge",
      "skeleton",
      "inactive",
      "className",
    ],
    droppedStudioProps: [
      {
        prop: "type",
        reason:
          "Studio's AvatarEntityType (user|account|agent|customer|icon|computer) has no single-prop equivalent in production Avatar — shape/image/backgroundColor cover the common cases. Reviewer decides per call site.",
      },
      {
        prop: "contextBadge",
        reason:
          "Studio's contextBadge maps to production Avatar's `context` slot, but the mask behavior differs. Review per call site.",
      },
    ],
  },
  {
    studio: { source: "arcade", name: "Tag" },
    production: { source: PROD_SOURCE, name: "Chip" },
    propDeltas: [{ from: "intent", to: "variant", note: "Studio's TagIntent maps onto production Chip variants; 1:1 for the common cases." }],
    slotNotes: [
      "Studio Tag has both `intent` and `appearance`; production Chip has only `variant`. The tonal/tinted styling Studio expresses via `appearance` is not recoverable on Chip — either accept the flat look, or surface to the reviewer if the design explicitly requires tinted.",
    ],
    translationClass: "structural",
    knownStudioProps: ["intent", "appearance", "icon", "onDismiss", "children", "className"],
    droppedStudioProps: [
      {
        prop: "appearance",
        reason:
          "Production Chip has no `appearance` axis — variant alone controls style. Drop with a TODO if the design specifically requires the tinted look; otherwise Chip variant='neutral' (or equivalent) is the honest translation.",
      },
      {
        prop: "icon",
        reason:
          "Studio Tag exposes a leading `icon` ReactNode slot; production Chip does not. Wrap the icon inline with the Chip content (or surface to reviewer if the icon must sit in a dedicated slot).",
      },
    ],
  },
  {
    // Added 2026-05-11: live lift of 01-skills-gallery hit this as a silent
    // gap — arcade exports `Breadcrumb` but the mapping table had no entry,
    // so it surfaced as `<unmapped/>` and the agent had no guidance.
    studio: { source: "arcade", name: "Breadcrumb" },
    production: { source: PROD_SOURCE, name: "Breadcrumbs" },
    propDeltas: [],
    slotNotes: [
      "Studio shape: <Breadcrumb.Root><Breadcrumb.Item><Breadcrumb.Link href=... current>…</Breadcrumb.Link></Breadcrumb.Item><Breadcrumb.Separator/>…",
      "Production shape: <Breadcrumbs size=\"small\" separator={<Icon iconType={ICON_TYPES.BASE_CHEVRON_RIGHT} size=\"3xs\"/>}> <Breadcrumbs.Item href=\"…\" active hoverable={false}>…</Breadcrumbs.Item> </Breadcrumbs>",
      "No Breadcrumbs.Link subcomponent in production — the Item is polymorphic and renders as the anchor itself (pass `href` directly to Item).",
      "Separator moves from per-item `<Breadcrumb.Separator/>` children to a single `separator` prop on the root Breadcrumbs.",
      "Studio's `current` prop on a Link becomes `active` on the Item.",
    ],
    translationClass: "structural",
    priorArt: [
      {
        path: "libs/settings/feature/computer-settings/src/pages/preferences/preferences-page.tsx",
        covers: "Breadcrumbs with separator + Breadcrumbs.Item active",
      },
    ],
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
