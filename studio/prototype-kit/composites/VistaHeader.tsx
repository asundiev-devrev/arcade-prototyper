/**
 * VistaHeader — DevRev vista page header band.
 *
 * Matches the header row on app.devrev.ai/devrev/vistas/* list views:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [title]  [count]                   [actions]  [primaryAction]│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   flex items-center justify-between px-page-gutter py-5
 *   → padding 20px 36px, height 72px, no bottom border
 *
 * The title and count sit on a shared baseline (matches the live
 * `flex items-baseline space-x-1.5`), NOT centered.
 *
 * Typography is owned by this composite so callers can't drift:
 *   - Title renders at `text-title-3` with `--fg-neutral-prominent`.
 *   - Count renders at `text-body` with `--fg-neutral-subtle`.
 * Pass plain text / numbers as children — do NOT wrap in your own
 * `<span className="text-…">`, it will be overridden.
 *
 * Slots:
 * - `title` — the vista title. A string or inline node; wrapped in the
 *   composite's title-3 h1 automatically.
 * - `count` (optional) — item count; rendered with text-body + fg-neutral-subtle.
 *   **Pass the string the reference shows, verbatim** — `"165.1K"`, `"1.2M"`,
 *   `"16,538"`. Do NOT strip separators (`"16538"`), expand abbreviations
 *   (`"165100"`), or reformat. The count slot is display-only.
 * - `actions` (optional) — icon-button cluster (search/sort/filter/…).
 *   Pass a list of `<VistaHeader.Action icon={…} label="…" />` children.
 *   The composite owns spacing (`gap-0.5`) and each Action bakes in the
 *   correct IconButton variant+size — callers don't need to remember the
 *   right props. Render exactly the icons the reference shows, in order.
 * - `primaryAction` (optional) — primary call-to-action button (e.g. + Issue).
 *   Use `<VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>`.
 *   The subcomponent bakes in `variant="primary"` + `size="md"` (28px, the
 *   Figma-spec'd height for vista chrome) and forces the icon to 16px so the
 *   CTA visually matches the header's icon-button cluster beside it.
 *   Note: arcade `Button variant="primary"` renders a dark/inverted button.
 *   DevRev vistas may show the CTA in DevRev-blue instead — if the reference
 *   shows a blue CTA, leave a TODO gap (`{/* TODO: blue vista CTA *\/}`)
 *   rather than substituting a dark button.
 *
 * @counterexample Do NOT inline `<IconButton variant="secondary" size="sm">…</IconButton>` into the `actions` slot. Use `<VistaHeader.Action icon={<MagnifyingGlass />} label="Search" />` — the subcomponent bakes variant/size/hit-target so icon buttons match DevRev vista chrome exactly.
 * @counterexample Do NOT inline `<Button variant="primary" size="sm" iconLeft={<PlusSmall />}>Issue</Button>` into the `primaryAction` slot. `size="sm"` is 20px tall — half the height of the vista icon cluster next to it, so the CTA renders squished. Use `<VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>` so the CTA height + icon size stay aligned with the rest of the header.
 * @counterexample Do NOT wrap `actions` children in your own `<div className="flex gap-*">`. The composite applies the correct inter-icon spacing; your wrapper will either collapse it or double it.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button, IconButton } from "@xorkavi/arcade-gen";

type VistaHeaderProps = {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
};

function Root({
  title,
  count,
  actions,
  primaryAction,
}: VistaHeaderProps) {
  return (
    <header className="flex items-center justify-between px-9 py-5 h-[72px] shrink-0">
      <div className="flex items-baseline gap-1.5">
        <h1 className="text-title-3 text-(--fg-neutral-prominent)">{title}</h1>
        {count != null ? (
          <span className="text-body text-(--fg-neutral-subtle)">{count}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {actions != null ? (
          <div className="flex items-center gap-0.5">{actions}</div>
        ) : null}
        {primaryAction}
      </div>
    </header>
  );
}

/** Icon-button action in the `actions` slot. Bakes in `variant="secondary"` +
 *  `size="md"` (28px, the Figma-spec'd default for vista chrome) and forces
 *  the icon to 16px so callers don't need to pass `size={16}` on every icon.
 *  Pass the icon element as `icon` and a human-readable label for accessibility. */
function Action({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const sized = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ size?: number }>, { size: 16 })
    : icon;
  return (
    <IconButton variant="secondary" size="md" aria-label={label} onClick={onClick}>
      {sized}
    </IconButton>
  );
}

/** Primary call-to-action in the `primaryAction` slot. Bakes in
 *  `variant="primary"` + `size="md"` (28px, the Figma-spec'd height for vista
 *  chrome) and forces the leading icon to 16px so the CTA visually matches the
 *  icon-button cluster beside it. Pass the label as children and the leading
 *  glyph as `icon` — no need to remember `iconLeft`, variant, or size. */
function PrimaryAction({
  icon,
  children,
  onClick,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  const sizedIcon = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ size?: number }>, { size: 16 })
    : icon;
  return (
    <Button variant="primary" size="md" iconLeft={sizedIcon} onClick={onClick}>
      {children}
    </Button>
  );
}

export const VistaHeader = Object.assign(Root, { Action, PrimaryAction });
