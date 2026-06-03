// studio/src/lift/mappings/composites.ts
//
// Studio prototype-kit composite → production pattern.
//
// Each entry maps a Studio composite to the shape an engineer would write
// in devrev-web today. We do NOT ask production to grow new composites;
// we match against existing Tier-2 (design-system) and Tier-3 (shared
// templates) composition patterns:
//
//   AppShell / NavSidebar / TitleBar        → <Page> + <Nav> manual flex
//   VistaPage / VistaHeader / VistaToolbar  → <ListViewPage>
//   SettingsPage / SettingsCard / SettingsRow → <SettingsPage> + <SettingsSection>
//   ChatInput / ChatMessages / ChatEmptyState, CanvasPanel, Computer*
//                                           → judgment (no direct production equivalent)
//
// Judgment entries are the honest answer when no obvious mapping exists.
// The manifest surfaces them verbatim so the engineer decides.

import type { MappingEntry } from "../types";
import { rawDs } from "./rawDs";

const PROD_SETTINGS = "@devrev-web/design-system/shared/settings";
// Verified against devrev-web: consumers import `ListViewPage` from the
// package root, not from an internal file path. Grep shows dozens of real
// usages: `import { ListViewPage } from '@devrev-web/shared/part-work-components';`
const PROD_LISTVIEW = "@devrev-web/shared/part-work-components";

export const COMPOSITE_MAPPINGS: MappingEntry[] = [
  // --- Layout chrome -----------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "AppShell" },
    production: { source: rawDs("Page"), name: "Page" },
    propDeltas: [],
    slotNotes: [
      "AppShell wraps the whole app in a sidebar+content flex layout. PREFER a higher-level page template when one fits the frame's shape: a settings-style frame (TitleBar + NavSidebar + BreadcrumbBar + centered body with grouped rows) lifts to `SettingsPage` from '@devrev-web/design-system/shared/settings' (≈86 call sites) — that template owns the chrome, so you do NOT unroll the flex layout. Read libs/.../*-settings page prior art (e.g. preferences-page.tsx) for the SettingsPage.Header / Toolbar shape.",
      "Only when NO template fits (a bespoke layout) do you unroll inline: `<div className=\"flex h-screen\"><aside>{sidebar}</aside><div className=\"flex-1\">{children}</div></div>` alongside <Page>. Inline-flex-+-Page is the fallback, not the default.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "TitleBar" },
    production: { source: rawDs("Page"), name: "Page" },
    propDeltas: [],
    slotNotes: [
      // Corrected 2026-05-12: drift audit flagged "Page.Header" — that's a
      // subcomponent, not a top-level export. Consumers import `Page` and
      // use `<Page.Header>` via compound reference.
      "Compose with `<Page.Header>` under `<Page>`. Production `Page.Header` is a subcomponent attachment, not a standalone export.",
      "Traffic-lights/window-chrome elements from Studio's TitleBar do not exist in production (they are Studio's own chrome); drop them.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "BreadcrumbBar" },
    production: { source: rawDs("Breadcrumbs"), name: "Breadcrumbs" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "PageBody" },
    production: { source: rawDs("Page"), name: "Page" },
    propDeltas: [],
    slotNotes: [
      "Compose as `<Page.Content>` inside `<Page>`. Page.Content is a subcomponent attachment on the `Page` export.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "NavSidebar" },
    production: { source: rawDs("Nav"), name: "Nav" },
    propDeltas: [],
    slotNotes: [
      "Studio's NavSidebar: <NavSidebar><NavSidebar.Section><NavSidebar.Item/></NavSidebar.Section></NavSidebar>.",
      "Production Nav: <Nav variant=\"primary\"><Nav.Header/><Nav.Content><Nav.List><Nav.List.Item><Nav.List.Item.Icon/><Nav.List.Item.Label/></Nav.List.Item></Nav.List></Nav.Content><Nav.Footer/></Nav>. Use Nav.List.Item — it is the canonical item (≈260 call sites); Nav.SingleSelectItem is a rare legacy variant, do not default to it.",
      "Section → Nav.List. Item → Nav.List.Item with `selected` prop. Studio's brand header and Computer footer have no production equivalent; typically drop them in the translation.",
    ],
    translationClass: "structural",
    priorArt: [
      {
        path: "libs/settings/feature/computer-settings/src/computer-settings-router.tsx",
        covers: "where Nav is mounted in a feature router (not inside pages)",
      },
    ],
  },
  // --- Vista (list-view) family -----------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "VistaPage" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage" },
    propDeltas: [],
    slotNotes: [
      "VistaPage composes AppShell + VistaHeader + VistaToolbar + content. Production wraps these behaviours in ListViewPage: pass tableProps, filterProps, headerProps.",
      "The `primaryAction`, `count`, `toolbarIcons`, `filters` slots from VistaPage map onto headerProps.actions, headerProps.count, toolbarProps.actions, toolbarProps.filters respectively.",
    ],
    translationClass: "structural",
    priorArt: [
      {
        path: "libs/commerce/features/skus/src/pages/skus-page.tsx",
        covers: "ListViewPage with tableProps, filters, headerProps",
      },
    ],
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaHeader" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage" },
    propDeltas: [],
    slotNotes: [
      // Corrected 2026-05-12: "ListViewPage.Header" is a subcomponent
      // attachment, not a top-level export.
      "Absorb into `headerProps` when composing at the ListViewPage level. `<ListViewPage.Header>` is a subcomponent attachment on the ListViewPage export; prefer passing headerProps over using the subcomponent directly.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaToolbar" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage" },
    propDeltas: [],
    slotNotes: [
      "Absorb into `toolbarProps` (mirrors VistaHeader pattern). Standalone subcomponent use is rare.",
    ],
    translationClass: "structural",
  },
  {
    // 2026-05-12 drift audit: the previous mapping pointed at `GroupRail`
    // which does not exist in devrev-web. Reclassified to judgment with
    // no production equivalent — the reviewer chooses (often: per-feature
    // inline composition using Nav or a custom rail component).
    studio: { source: "arcade-prototypes", name: "VistaGroupRail" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "VistaGroupRail has no standalone production equivalent. Features that need a rail compose one per-call-site (most commonly from Nav or from bespoke flex containers). Decide with the reviewer.",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaRow" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [
      {
        from: "stage",
        to: "stage",
        note: "StageTone/PriorityValue enums are Studio-specific; map onto production Badge variants at the call site.",
      },
    ],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "2026-05-12 drift audit: the previous mapping pointed at a `Row` export that does not exist in devrev-web. Production tables build rows per-feature from the data-layer + cell components — there is no single Row component. Decide whether to keep a reusable VistaRow shape or inline cells.",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaFilterPill" },
    production: { source: rawDs("Chip"), name: "Chip" },
    propDeltas: [],
    slotNotes: [
      "Production uses Chip with a close-button slot; Studio's VistaFilterPill bundles behaviour into one component.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaPagination" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "2026-05-12 drift audit: no `Pagination` export exists in raw-design-system. ListViewPage owns pagination itself; if the frame uses VistaPagination standalone, ask the reviewer whether to use the ListViewPage-owned behavior or inline a bespoke control.",
  },
  // --- Settings ---------------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "SettingsPage" },
    production: { source: PROD_SETTINGS, name: "SettingsPage" },
    propDeltas: [],
    slotNotes: [
      // Reclassified 2026-05-11: live lift of 01-skills-gallery showed this
      // is structural, not mechanical. Studio's SettingsPage takes slotted
      // children (sidebar, breadcrumb, actions, pageActions) as PROPS.
      // Production's SettingsPage takes children only, composed via compound
      // subcomponents (.Header, .Header.Title, .Header.Description,
      // .Header.Actions, .Content). The slot props don't translate 1:1.
      "Studio's SettingsPage takes `sidebar`, `breadcrumb`, `actions`, `pageActions` as PROPS. Production takes children only.",
      "Production shape:\n  <SettingsPage>\n    <SettingsPage.Header>\n      <SettingsPage.Header.Title breadcrumbs={<Breadcrumbs>...}>{title}</SettingsPage.Header.Title>\n      <SettingsPage.Header.Description>{subtitle}</SettingsPage.Header.Description>\n      <SettingsPage.Header.Actions>{actions}</SettingsPage.Header.Actions>\n    </SettingsPage.Header>\n    <SettingsPage.Content>{children}</SettingsPage.Content>\n  </SettingsPage>",
      "Studio's `sidebar` slot has no destination on the production page — in devrev-web the Nav is mounted at the router layout level, not the page (see e.g. libs/settings/feature/computer-settings/src/computer-settings-router.tsx). Drop the sidebar at the page boundary.",
      "Studio's `actions` slot (top-bar Search/Bell/Avatar chrome) belongs to the app shell in production, not the settings page. Drop unless the reviewer explicitly wants a bespoke page header.",
      "Studio's `pageActions` slot maps to `<SettingsPage.Header.Actions>`.",
    ],
    translationClass: "structural",
    priorArt: [
      {
        path: "libs/settings/feature/computer-settings/src/pages/preferences/preferences-page.tsx",
        covers: "SettingsPage + Header.Title + Breadcrumbs + Content",
      },
      {
        path: "libs/agent-platform/feature/customize-computer/src/pages/computer-skills-settings.tsx",
        covers: "SettingsPage + Header.Actions + Tabs inside Content",
      },
      {
        path: "libs/settings/feature/computer-settings/src/computer-settings-router.tsx",
        covers: "where the router mounts Nav — the sidebar SettingsPage does NOT own",
      },
    ],
  },
  {
    studio: { source: "arcade-prototypes", name: "SettingsCard" },
    production: { source: PROD_SETTINGS, name: "SettingsSection" },
    propDeltas: [],
    slotNotes: [
      "Card heading + body → SettingsSection with `title` + children.",
    ],
    translationClass: "mechanical",
  },
  {
    // 2026-05-12 drift audit: no `SettingsRow` export in the production
    // settings package. devrev-web settings pages compose rows inline
    // using label + input markup inside SettingsSection. Reclassify.
    studio: { source: "arcade-prototypes", name: "SettingsRow" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "No SettingsRow component in production. Compose rows inline inside `<SettingsSection>` using label + input markup. See libs/settings/feature/computer-settings/src/pages/preferences/preferences-page.tsx for the house style.",
  },
  // --- Computer / Chat / Canvas (no direct production equivalent) -------
  {
    studio: { source: "arcade-prototypes", name: "ComputerHeader" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "ComputerHeader is Studio-specific UI (the 'Computer' app's own title bar). No production equivalent — drop when the frame is being lifted as a product feature, keep if lifting the whole Computer experience.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ComputerSidebar" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "Studio-specific UI (chat sidebar for the Computer app). Treat like ComputerHeader.",
  },
  {
    studio: { source: "arcade-prototypes", name: "CanvasPanel" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "No production equivalent. Decide whether the frame genuinely needs a scratch-canvas pattern; most product features don't.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatInput" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "Studio provides a chat-input composite. In devrev-web chat inputs live inside specific features (Support, Timeline) and are bespoke. Map against the host feature's input component.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatMessages" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote: "Same as ChatInput — bespoke per host feature.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatEmptyState" },
    production: { source: rawDs("EmptyState"), name: "EmptyState" },
    propDeltas: [],
    slotNotes: [
      "Production EmptyState is the general empty-state component; the 'chat' framing is Studio-specific copy.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "ComputerPage" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [
      "Slot graph for the Computer / Agent Studio app shell (sidebar + header + chatInput + body + optional panel). Studio-specific UI; no production equivalent.",
    ],
    translationClass: "judgment",
    judgmentNote:
      "Computer is a Studio-only app shell. When lifting individual frames, drop ComputerPage and translate just the body content into the host feature. Keep only when lifting the whole Computer experience.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ComputerScene" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [
      "Populated-by-default Computer scene built on ComputerPage. Carries baked-in sessions, chats, header title, transcript and optional CanvasPanel — entirely Studio prototype data.",
    ],
    translationClass: "judgment",
    judgmentNote:
      "ComputerScene is a Studio prototype convenience — its baked-in roster (Ava Wright, sessions, chats, transcript) has no production analogue. Drop the wrapper and lift only the underlying body content the design actually targets.",
  },
  // --- Multi-frame navigation (prototype-only) --------------------------
  {
    studio: { source: "arcade-prototypes", name: "FrameLink" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "FrameLink is a prototype-only primitive for inter-frame navigation (multi-frame flows). In production, this becomes either a react-router Link/navigate call or a button with onClick handler. Replace with the appropriate routing primitive for the target app.",
  },
];
