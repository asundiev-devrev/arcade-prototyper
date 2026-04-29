/**
 * VistaToolbar — DevRev vista toolbar band.
 *
 * Matches the filter/toolbar row on vista list views:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [icons] │ [filter pills…] [+] [Clear]                       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   Outer: flex items-start mb-4 px-page-gutter justify-between
 *     → padding 0 36px, margin-bottom 16px
 *   Inner: flex gap-2 items-center flex-wrap (content 30px tall)
 *
 * The vertical separator after the icon cluster is owned by this
 * composite. When `toolbarIcons` is provided, the separator renders.
 * When absent, the row starts with `filters` directly.
 *
 * Slots:
 * - `toolbarIcons` (optional) — icon cluster (@ / chart / clock / …).
 *   Pass a list of `<VistaToolbar.IconAction icon={…} label="…" />` children.
 *   The composite owns spacing (`gap-0.5`) and each IconAction bakes in the
 *   correct IconButton variant+size — callers don't remember it.
 * - `filters` (optional) — filter pill group + add-filter + clear.
 *
 * @counterexample Do NOT inline `<IconButton variant="secondary" size="sm">…</IconButton>` into the `toolbarIcons` slot. Use `<VistaToolbar.IconAction icon={<AtSymbol />} label="Mentions" />` — the subcomponent bakes variant/size so icons in the toolbar match DevRev vista chrome exactly.
 * @counterexample Do NOT wrap `toolbarIcons` children in your own `<div className="flex gap-*">`. The composite applies the correct inter-icon spacing; your wrapper will either collapse it or double it.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { IconButton } from "@xorkavi/arcade-gen";

type VistaToolbarProps = {
  toolbarIcons?: ReactNode;
  filters?: ReactNode;
};

function Root({
  toolbarIcons,
  filters,
}: VistaToolbarProps) {
  return (
    <div className="flex items-start px-9 mb-4 shrink-0">
      <div className="flex gap-2 items-center flex-wrap">
        {toolbarIcons != null ? (
          <div className="flex items-center">
            <div className="flex items-center gap-0.5">{toolbarIcons}</div>
            <div className="self-stretch my-2 ml-2 w-px bg-(--stroke-neutral-subtle)" />
          </div>
        ) : null}
        {filters}
      </div>
    </div>
  );
}

/** Icon-button action in the `toolbarIcons` slot. Bakes in `variant="secondary"`
 *  + `size="md"` (28px, the Figma-spec'd default for vista chrome) and forces
 *  the icon to 16px so callers don't need to pass `size={16}` on every icon.
 *  Pass the icon element as `icon` and a human-readable label for accessibility. */
function IconAction({
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

export const VistaToolbar = Object.assign(Root, { IconAction });
