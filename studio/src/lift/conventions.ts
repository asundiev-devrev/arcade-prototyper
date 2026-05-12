// studio/src/lift/conventions.ts
//
// Convention blocks — rules + anchors, not lookup tables. See the plan at
// studio/docs/plans/2026-05-11-lift-manifest-rules-over-tables.md for
// motivation. Each convention teaches the agent how to translate a CLASS
// of Studio construct, then hands off discovery (grep, file reads) to the
// agent at lift time rather than pretending to enumerate the surface.
//
// Shape: each convention is an object with three fields:
//   rule    — the canonical one-sentence mapping rule
//   lookup  — what to grep / read in devrev-web to resolve specifics
//   anchors — 2–5 illustrative examples, enough to ground the pattern
//             (passed through as-is; the renderer emits them inline)
//
// The renderer (src/lift/render.ts) converts these into the
// <icon_convention>, <chrome_convention>, and <default_mapping_convention>
// XML blocks when the frame hits each convention's trigger condition.

import { ICON_ANCHORS } from "./icons";

export interface Convention {
  /** Short name; used as the element tag (<icon_convention>). */
  tag:
    | "icon_convention"
    | "chrome_convention"
    | "default_mapping_convention"
    | "overlay_convention";
  /** One-sentence translation rule. */
  rule: string;
  /** Grep/read instruction for resolving specifics. */
  lookup: string;
  /** Illustrative examples the agent can extrapolate from. */
  anchors: string[];
}

export const ICON_CONVENTION: Convention = {
  tag: "icon_convention",
  rule:
    "arcade icons translate to <Icon iconType={ICON_TYPES.X} size=\"...\"/> " +
    "imported from '@devrev-web/shared/ui-icons'.",
  lookup:
    "ICON_TYPES is the enum in libs/shared/ui-icons/src/icon/types.ts. " +
    "For each arcade icon in the frame, grep that file for the closest " +
    "semantic match. Prefer exact-word matches; fall back to synonyms " +
    "(Bell→NOTIFICATION, TrashBin→DELETE). If no close match exists, " +
    "surface to the reviewer rather than inventing one. " +
    // Surfaced by 2026-05-12 live-lift validation runs: Studio icons
    // accept a `color` prop, production <Icon> does not. Telling the
    // agent what to do prevents the "drop silently + leave a TODO" trap
    // that happened twice in tmp/lift-experiment-v2/skills-gallery.tsx.
    "COLOR: if the Studio call site passes `color` to the icon, do NOT " +
    "forward it to the production <Icon> — production icons inherit " +
    "from `currentColor`. Wrap the icon in a parent element whose text " +
    "color is set via a theme-token `style` value or a Tailwind text-* " +
    "utility, and let the icon inherit. If the Studio value is a raw " +
    "hex (e.g. color=\"#2563eb\") with no obvious token equivalent, " +
    "surface to the reviewer instead of picking one.",
  anchors: [
    ...ICON_ANCHORS.map(
      (a) => `${a.studio} → ICON_TYPES.${a.productionIconType}`,
    ),
    // Color-handling anchor, pulled out of the main list so it stays
    // readable. Demonstrates the inherit-via-parent pattern.
    '<LightingBolt color="var(--fg-neutral-subtle)"/> → <span style={{ color: "var(--fg-neutral-subtle)" }}><Icon iconType={ICON_TYPES.ACTION_LIGHTNING}/></span>',
  ],
};

export const CHROME_CONVENTION: Convention = {
  tag: "chrome_convention",
  rule:
    "App-shell chrome (NavSidebar, TitleBar, AppShell, top-bar Search/Bell/" +
    "Avatar clusters) belongs to the ROUTER LAYOUT in devrev-web, not to " +
    "the page. Drop it at the page boundary during the lift.",
  lookup:
    "Production features mount their Nav at the feature router, not inside " +
    "the page component. Before discarding Studio's sidebar data, confirm " +
    "the host router already provides a Nav by reading e.g. " +
    "libs/settings/feature/computer-settings/src/computer-settings-router.tsx.",
  anchors: [
    "Studio `<SettingsPage sidebar={<NavSidebar/>}>` → keep the <SettingsPage> children, drop the sidebar prop; the host router's Nav renders the sidebar.",
    "Studio's top-bar `actions` cluster (Search + Bell + Avatar) → drop entirely; that chrome lives in the shell, not the page.",
    "Studio's `pageActions` (Create / Delete / Add) → keep; these go in <SettingsPage.Header.Actions>.",
  ],
};

export const OVERLAY_CONVENTION: Convention = {
  tag: "overlay_convention",
  rule:
    "Frames that hand-roll an overlay (fixed inset-0 backdrop + centered " +
    "card) should be lifted to <Modal> from " +
    "'@devrev-web/design-system/shared/raw-design-system', NOT preserved as " +
    "raw divs. Studio's generator prefers authoring overlays by hand because " +
    "arcade-gen doesn't expose a Modal composite, but production has one.",
  lookup:
    "Modal composes as: <Modal onOpenChange={...} open={...} size='...'>" +
    "<Modal.Content><Modal.Header><Modal.Header.Title/>" +
    "<Modal.Header.Actions/><Modal.Header.Description/></Modal.Header>" +
    "<Modal.Body/><Modal.Footer/></Modal.Content></Modal>. Map Studio's " +
    "header row → Modal.Header (title text → Modal.Header.Title; close " +
    "icon → Modal.Header.Actions), the card body → Modal.Body, the " +
    "footer row (action buttons) → Modal.Footer.",
  anchors: [
    "Studio `<div className=\"fixed inset-0 ...\">` backdrop → the outer `<Modal>` element controls visibility via `open`; the backdrop and positioning are managed by Modal itself, drop the hand-rolled markup.",
    "Studio's max-width/shadow card → `<Modal.Content>` (size prop controls width, e.g. size=\"480\" for 480px).",
    "Prior art (read before writing): libs/commerce/features/your-plan/src/components/switch-plan-confirm-dialog.tsx — small, self-contained Modal consumer with Header.Title + Body + Footer.",
  ],
};

export const DEFAULT_MAPPING_CONVENTION: Convention = {
  tag: "default_mapping_convention",
  rule:
    "For any arcade primitive with no explicit mapping entry, the default " +
    "assumption is that the same symbol is exported from " +
    "'@devrev-web/design-system/shared/raw-design-system'. Verify by grep; " +
    "if absent, surface to the reviewer.",
  lookup:
    "From a devrev-web checkout: " +
    "grep -rE \"^export .*\\b<Name>\\b\" libs/design-system/shared/raw-design-system/src/components. " +
    "If the export exists, use it. If not, it may live in a sibling package " +
    "(settings, pages, agent, side-panel) — widen the grep, or surface to " +
    "the reviewer. Prop names usually match; treat non-trivial prop " +
    "differences as the reviewer's decision.",
  anchors: [
    "Switch → raw-design-system Switch (direct match; confirm with grep)",
    "TextArea → raw-design-system TextArea (direct match; confirm with grep)",
  ],
};

/**
 * Trigger: chrome convention only fires when the frame imports at least one
 * Studio chrome primitive. Avoids emitting irrelevant guidance for frames
 * that don't draw their own chrome.
 */
const CHROME_PRIMITIVES = new Set<string>([
  "NavSidebar",
  "TitleBar",
  "AppShell",
  "BreadcrumbBar",
]);

/**
 * Detect hand-rolled overlays. Studio's generator authors modals as raw
 * divs because arcade-gen has no Modal composite; this is the cheapest
 * signal we can detect without parsing JSX. The pattern is deliberately
 * strict — `fixed inset-0` is the narrow full-viewport positioning
 * fingerprint. A false positive (e.g. a fullscreen loader) costs the
 * agent one ignorable convention block; a false negative means the
 * agent ships the raw divs, which is the bug we're fixing.
 */
const OVERLAY_MARKUP_PATTERNS: RegExp[] = [
  // className contains both `fixed` and `inset-0` somewhere in the string.
  /className=(?:"[^"]*?\bfixed\b[^"]*?\binset-0\b[^"]*"|"[^"]*?\binset-0\b[^"]*?\bfixed\b[^"]*")/,
  // Single-quoted / backtick variants.
  /className=(?:'[^']*?\bfixed\b[^']*?\binset-0\b[^']*'|'[^']*?\binset-0\b[^']*?\bfixed\b[^']*')/,
];

export function hasOverlayMarkup(frameSource: string): boolean {
  return OVERLAY_MARKUP_PATTERNS.some((re) => re.test(frameSource));
}

/**
 * Decide which conventions apply to a given set of imports. Called by the
 * renderer.
 *
 * The icon convention fires whenever the frame has at least one icon
 * import. The default-mapping convention always fires — it's the safety
 * net for any non-icon import the mapping table didn't cover. The chrome
 * convention fires only when a chrome primitive is present. The overlay
 * convention fires only when the frame source contains an overlay
 * fingerprint (hand-rolled fixed/inset-0 markup).
 */
export function applicableConventions(opts: {
  hasIcons: boolean;
  importedNames: Iterable<string>;
  hasOverlay?: boolean;
}): Convention[] {
  const out: Convention[] = [];
  if (opts.hasIcons) out.push(ICON_CONVENTION);
  const names = new Set(opts.importedNames);
  if ([...CHROME_PRIMITIVES].some((n) => names.has(n))) {
    out.push(CHROME_CONVENTION);
  }
  if (opts.hasOverlay) out.push(OVERLAY_CONVENTION);
  out.push(DEFAULT_MAPPING_CONVENTION);
  return out;
}
