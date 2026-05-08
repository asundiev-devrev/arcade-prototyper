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

const PROD_RDS = "@devrev-web/design-system/shared/raw-design-system";
const PROD_PAGES = "@devrev-web/design-system/shared/pages";
const PROD_SETTINGS = "@devrev-web/design-system/shared/settings";
// Verified against devrev-web: consumers import `ListViewPage` from the
// package root, not from an internal file path. Grep shows dozens of real
// usages: `import { ListViewPage } from '@devrev-web/shared/part-work-components';`
const PROD_LISTVIEW = "@devrev-web/shared/part-work-components";

export const COMPOSITE_MAPPINGS: MappingEntry[] = [
  // --- Layout chrome -----------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "AppShell" },
    production: { source: PROD_RDS, name: "Page" },
    propDeltas: [],
    slotNotes: [
      "AppShell wraps the whole app in a sidebar+content flex layout. In devrev-web, features compose this inline: `<div className=\"flex h-screen\"><aside>{sidebar}</aside><div className=\"flex-1\">{children}</div></div>` alongside <Page>. There is no single-component equivalent. Unroll into inline flex + Page.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "TitleBar" },
    production: { source: PROD_RDS, name: "Page.Header" },
    propDeltas: [],
    slotNotes: [
      "Production pages use Page.Header for the top bar; traffic-lights/window-chrome elements from Studio's TitleBar do not exist in production (they are Studio's own chrome).",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "BreadcrumbBar" },
    production: { source: PROD_RDS, name: "Breadcrumbs" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "PageBody" },
    production: { source: PROD_RDS, name: "Page.Content" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "NavSidebar" },
    production: { source: PROD_RDS, name: "Nav" },
    propDeltas: [],
    slotNotes: [
      "Studio's NavSidebar: <NavSidebar><NavSidebar.Section><NavSidebar.Item/></NavSidebar.Section></NavSidebar>.",
      "Production Nav: <Nav variant=\"primary\"><Nav.Header/><Nav.Content><Nav.List><Nav.SingleSelectItem><Nav.SingleSelectItem.Icon/><Nav.SingleSelectItem.Label/></Nav.SingleSelectItem></Nav.List></Nav.Content><Nav.Footer/></Nav>.",
      "Section → Nav.List. Item → Nav.SingleSelectItem with `selected` prop. Studio's brand header and Computer footer have no production equivalent; typically drop them in the translation.",
    ],
    translationClass: "structural",
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
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaHeader" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage.Header" },
    propDeltas: [],
    slotNotes: [
      "Absorbed into ListViewPage's headerProps when mapped at the page level. Only surface standalone if the frame uses VistaHeader without VistaPage.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaToolbar" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage.Toolbar" },
    propDeltas: [],
    slotNotes: [
      "Same absorption pattern as VistaHeader; standalone use is rare.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaGroupRail" },
    production: { source: PROD_LISTVIEW, name: "GroupRail" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaRow" },
    production: { source: PROD_RDS, name: "Row" },
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
      "VistaRow encodes specific columns (title, stage, priority, assignee). In devrev-web rows are built per-table via the data-layer + cell components. Decide whether to keep a reusable VistaRow shape or inline cells.",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaFilterPill" },
    production: { source: PROD_RDS, name: "Chip" },
    propDeltas: [],
    slotNotes: [
      "Production uses Chip with a close-button slot; Studio's VistaFilterPill bundles behaviour into one component.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaPagination" },
    production: { source: PROD_RDS, name: "Pagination" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  // --- Settings ---------------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "SettingsPage" },
    production: { source: PROD_SETTINGS, name: "SettingsPage" },
    propDeltas: [],
    slotNotes: [
      "Production SettingsPage is the exact production template engineers use for settings routes. Near-mechanical at the page level.",
    ],
    translationClass: "mechanical",
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
    studio: { source: "arcade-prototypes", name: "SettingsRow" },
    production: { source: PROD_SETTINGS, name: "SettingsRow" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
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
    production: { source: PROD_RDS, name: "EmptyState" },
    propDeltas: [],
    slotNotes: [
      "Production EmptyState is the general empty-state component; the 'chat' framing is Studio-specific copy.",
    ],
    translationClass: "mechanical",
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
