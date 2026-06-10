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
    | "overlay_convention"
    | "style_attribute_convention"
    | "app_scoped_token_convention";
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
    "imported from '@devrev-web-internal/shared-ui-icons/icon' (the import " +
    "the whole codebase uses — `import { Icon, ICON_TYPES } from " +
    "'@devrev-web-internal/shared-ui-icons/icon'`; do NOT use " +
    "'@devrev-web/shared/ui-icons', which is a stale path with a single " +
    "legacy caller).",
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

export const STYLE_ATTRIBUTE_CONVENTION: Convention = {
  tag: "style_attribute_convention",
  rule:
    "Inline `style={{ ... }}` that references a theme CSS variable via " +
    "`var(--bg-*)`, `var(--fg-*)`, `var(--stroke-*)`, `var(--border-*)`, " +
    "or `var(--color-*)` is NOT portable to devrev-web. Many of these " +
    "tokens are stored as raw HSL channel triples (e.g. `--bg-surface-" +
    "overlay: 0 0% 100%`) — used directly they produce an invalid " +
    "color, fall back to `currentColor`, and render near-black. " +
    "Rewrite every such inline style to a Tailwind utility class " +
    "(preferred) or, if no utility resolves correctly, to a bracket " +
    "arbitrary-value class that wraps the token in `hsl(...)`.",
  lookup:
    "The target codebase registers utilities by token-prefix scanning in " +
    "its Tailwind config (devrev-web: tailwind.config.base.js). The " +
    "reliable mapping from `style` property to utility is: " +
    "`color: 'var(--fg-X)'` → className `fg-X`; " +
    "`backgroundColor: 'var(--bg-X)'` → `bg-X`; " +
    "`borderColor: 'var(--stroke-X)' | 'var(--border-X)'` → " +
    "`border-[hsl(var(--stroke-X))]` (the `border-X` auto-generated " +
    "utilities sometimes double-wrap `hsl()` and break — arbitrary value " +
    "is safer). For `borderBottom: '1px solid var(--X)'` use " +
    "`className=\"border-b border-[hsl(var(--X))]\"`. " +
    // 2026-06-10: a live lift FALSE-FLAGGED `bg-surface-shallow` as
    // "paints nothing, not a real utility" because it wasn't hand-listed
    // in tailwind.config.base.js — then "fixed" a working class. The
    // utilities are AUTO-GENERATED, not enumerated: generateCSSVariables()
    // walks every `--bg-*` / `--border-*` / `--color-*` var in
    // apps/product/styles/dark-styles.css and emits a matching bg-*/
    // border-*/fg-* utility. So a token absent from the config's
    // hand-written color block can still be a fully valid class.
    "DO NOT conclude a class is fake just because you don't see it " +
    "hand-listed in the Tailwind config — devrev-web AUTO-GENERATES " +
    "bg-*/border-*/fg-* utilities from the `--X` CSS vars defined in " +
    "apps/product/styles/dark-styles.css (see generateCSSVariables in " +
    "tailwind.config.base.js). 'Not in the config's color block' does NOT " +
    "mean 'not a utility'. The ONLY authoritative test of whether a class " +
    "paints is the live render (getComputedStyle), never a config grep. " +
    "Before committing, open the rendered page in a browser — a " +
    "transparent background or a black border means a token fell through; " +
    "swap to the arbitrary-value form. Equally: do not 'fix' a class you " +
    "only suspect is broken — confirm it paints wrong in the render first.",
  anchors: [
    'style={{ background: \'var(--bg-surface-overlay)\' }} → className="bg-surface-overlay"',
    'style={{ background: \'var(--bg-neutral-soft)\' }} → className="bg-neutral-soft"',
    'style={{ color: \'var(--fg-neutral-prominent)\' }} → className="fg-neutral-prominent"',
    'style={{ color: \'var(--fg-neutral-subtle)\' }} → className="fg-neutral-subtle"',
    'style={{ borderColor: \'var(--stroke-neutral-subtle)\' }} → className="border-[hsl(var(--stroke-neutral-subtle))]" (auto border-* utility is unreliable; use the arbitrary value)',
    'style={{ borderBottom: \'1px solid var(--stroke-neutral-subtle)\' }} → className="border-b border-[hsl(var(--stroke-neutral-subtle))]"',
    'bg-surface-shallow IS a real generated utility (renders rgb(249,250,250)) even though it is NOT hand-listed in the config color block — it is auto-generated from --bg-surface-shallow in apps/product/styles/dark-styles.css. Do not "fix" it.',
  ],
};

export const APP_SCOPED_TOKEN_CONVENTION: Convention = {
  tag: "app_scoped_token_convention",
  rule:
    "Some Tailwind color utilities in devrev-web are NOT global — their " +
    "backing CSS variable is defined only inside a specific app shell's " +
    "globals.css, not in the design-system theme. The chat-bubble tokens " +
    "are the known case: `bg-user-bubble-primary` / `text-user-bubble-" +
    "primary` (and the companion `force-dark` / `bubble-theme` classes the " +
    "sender-bubble prior art uses) resolve to a real color ONLY in app " +
    "shells that define `--bg-user-bubble-primary-color` / `--text-user-" +
    "bubble-primary-color`. In any app/context that doesn't, they fall " +
    "through to transparent text on a transparent background — the bubble " +
    "renders invisible. Grep alone CANNOT catch this: the class string " +
    "exists and is 'used', but it paints nothing. You MUST confirm at " +
    "render time (see render_harness) OR confirm the target app's " +
    "globals.css defines the token.",
  lookup:
    "Find which app shells define the token: " +
    "grep -rn \"user-bubble-primary\" apps/*/styles/globals.css. As of " +
    "2026-06 only apps/portal-shell (→ var(--bg-menu-selected)) and " +
    "apps/plug-widget (→ var(--bg-accent)) define it; the main devrev " +
    "product app does NOT. Decision rule: (1) if lifting INTO portal-shell " +
    "or plug-widget, the tokens resolve — keep them. (2) if lifting into " +
    "the devrev product app (or any shell without the token), do NOT use " +
    "`bg-user-bubble-primary`; substitute a token that IS global — the " +
    "receiver bubble's `bg-menu-selected` is the safe neutral fill, or " +
    "surface to the reviewer for the intended sender treatment. Either " +
    "way, render and read computed `backgroundColor` — it must NOT be " +
    "`rgba(0, 0, 0, 0)`.",
  anchors: [
    "Sender bubble in apps/portal-shell: `bg-user-bubble-primary` resolves to `var(--bg-menu-selected)` (globals.css:34) — keep as-is.",
    "Same class in the devrev product app: undefined → transparent. Substitute `bg-menu-selected` (global) or get the reviewer's intended sender fill.",
    "Prior art that uses the app-scoped form (only safe inside its own shell): libs/timeline/shared/feature/src/support-timeline/chat/chat-bubble.tsx.",
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
 * Trigger: the app-scoped-token convention fires when the frame imports a
 * Studio primitive whose canonical production translation pulls in an
 * app-scoped (non-global) color utility. ChatBubble is the known case —
 * its sender variant lifts to `bg-user-bubble-primary`, a token defined
 * only in apps/{portal-shell,plug-widget}/styles/globals.css. A live lift
 * of 01-chat-with-canvas shipped a transparent sender bubble because the
 * agent's static grep "confirmed the token resolves" when it didn't paint.
 */
const APP_SCOPED_TOKEN_PRIMITIVES = new Set<string>(["ChatBubble"]);

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
 * Detect inline `style={{ … }}` attributes that reference theme CSS
 * variables. The trigger is intentionally broad: any `style={` containing
 * `var(--<prefix>-…)` where prefix is one of bg/fg/stroke/border/color.
 * A false positive (e.g. someone wrote `var(--foo)` inside a non-style
 * context caught by the regex) costs the agent one ignorable convention
 * block; a false negative leaves the live-render token-fallthrough bug
 * in place.
 *
 * We look for the `var(--<prefix>-` token INSIDE a `style={` attribute
 * value, not anywhere in the file — otherwise JSX `className` with
 * arbitrary values like `border-[hsl(var(--stroke-…))]` would trip it.
 */
const INLINE_STYLE_TOKEN_RE =
  /style=\{\{[^}]*?\bvar\(--(?:bg|fg|stroke|border|color)-[a-z0-9-]+\)/;

export function hasInlineStyleTokens(frameSource: string): boolean {
  return INLINE_STYLE_TOKEN_RE.test(frameSource);
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
  hasInlineStyleTokens?: boolean;
}): Convention[] {
  const out: Convention[] = [];
  if (opts.hasIcons) out.push(ICON_CONVENTION);
  const names = new Set(opts.importedNames);
  if ([...CHROME_PRIMITIVES].some((n) => names.has(n))) {
    out.push(CHROME_CONVENTION);
  }
  if ([...APP_SCOPED_TOKEN_PRIMITIVES].some((n) => names.has(n))) {
    out.push(APP_SCOPED_TOKEN_CONVENTION);
  }
  if (opts.hasOverlay) out.push(OVERLAY_CONVENTION);
  if (opts.hasInlineStyleTokens) out.push(STYLE_ATTRIBUTE_CONVENTION);
  out.push(DEFAULT_MAPPING_CONVENTION);
  return out;
}
