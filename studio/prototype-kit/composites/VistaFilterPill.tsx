/**
 * VistaFilterPill — segmented filter chip for the VistaToolbar filters slot.
 *
 * DevRev vista toolbars show filters as compound pills:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ [icon] Label │ is │ Value │ × │
 *   └──────────────────────────────────────────┘
 *
 * Each segment is separated by a 1px --stroke-neutral-subtle divider. The
 * label is muted (--fg-neutral-subtle), the value is prominent. The trailing
 * × is an affordance to remove the filter.
 *
 * Pill height is `h-control-md` (28px) to align with the vista header/toolbar
 * icon-button cluster next to it. The composite forces the leading icon to
 * 14px so callers don't need to pass `size={…}` on every icon.
 *
 * Why this composite exists: generators were hand-rolling a single-cell
 * div, losing the divider-segmented look. Encoding it here keeps every
 * frame's filter row visually identical to production.
 *
 * Slots:
 * - `icon` (optional) — leading icon (arcade icon or custom SVG). Size is
 *   coerced to 14px automatically.
 * - `label` — the filter category, e.g. "Created date", "Stage", "Part".
 * - `operator` (optional, default "is") — the comparison word between label
 *   and value. Set to `null` to suppress (single-segment pill).
 * - `value` — the selected value(s), e.g. "last 30 days", "None of +1".
 * - `onRemove` (optional) — when provided, renders the trailing × button.
 *
 * **Compound:** `VistaFilterPill.Add` for the dashed "+ add filter" affordance
 * at the end of the filter row. `VistaFilterPill.Clear` for the trailing text
 * "Clear" button. Both are sized to match the pill height (28px) so the whole
 * row aligns.
 *
 * @counterexample Do NOT hand-roll the filter pill as a single div with
 *   inline content. The segmented dividers are what make it read as a
 *   DevRev filter pill instead of a generic chip.
 * @counterexample Do NOT use `<Tag>` for filter pills. Tag is a label
 *   component and renders as a solid-tinted chip without segment dividers.
 * @counterexample Do NOT hand-roll `<button className="h-7 w-7 border-dashed">` for the add-filter affordance. Use `<VistaFilterPill.Add />` — it bakes the 28px height, dashed border, and 16px plus icon so the add button aligns with the pills beside it.
 * @counterexample Do NOT hand-roll `<button className="text-body-small">Clear</button>` for the trailing clear-filters affordance. Use `<VistaFilterPill.Clear />` — it bakes the 28px height, muted foreground, and hover-prominent color so Clear aligns with the pills beside it.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { CrossSmall, PlusSmall } from "@xorkavi/arcade-gen";

type VistaFilterPillProps = {
  icon?: ReactNode;
  label: ReactNode;
  operator?: ReactNode | null;
  value: ReactNode;
  onRemove?: () => void;
};

function Root({
  icon,
  label,
  operator = "is",
  value,
  onRemove,
}: VistaFilterPillProps) {
  const sizedIcon = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ size?: number }>, { size: 14 })
    : icon;
  return (
    <div className="inline-flex items-center h-control-md rounded-square border border-(--stroke-neutral-subtle) bg-(--surface-overlay) text-body-small text-(--fg-neutral-prominent) overflow-hidden">
      <span className="inline-flex items-center gap-1.5 px-2 text-(--fg-neutral-subtle)">
        {sizedIcon}
        <span>{label}</span>
      </span>
      {operator != null ? (
        <>
          <span className="self-stretch w-px bg-(--stroke-neutral-subtle)" />
          <span className="px-2 text-(--fg-neutral-subtle)">{operator}</span>
        </>
      ) : null}
      <span className="self-stretch w-px bg-(--stroke-neutral-subtle)" />
      <span className="px-2">{value}</span>
      {onRemove ? (
        <>
          <span className="self-stretch w-px bg-(--stroke-neutral-subtle)" />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove filter"
            className="inline-flex items-center justify-center h-full px-1.5 text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)"
          >
            <CrossSmall size={12} />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Dashed "+ add filter" square that sits at the end of the filter row.
 *  28px square with a dashed --stroke-neutral-subtle border and a centered
 *  16px PlusSmall. Click handler optional — the add-picker UX is out of
 *  scope for prototypes. */
function Add({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add filter"
      className="inline-flex items-center justify-center h-control-md aspect-square rounded-square border border-dashed border-(--stroke-neutral-subtle) text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)"
    >
      <PlusSmall size={16} />
    </button>
  );
}

/** Trailing "Clear" text button that sits after the filter pills + Add.
 *  Same 28px height as the pills, muted foreground at rest, prominent on
 *  hover. Click handler optional. */
function Clear({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center h-control-md px-2 rounded-square text-body-small text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)"
    >
      Clear
    </button>
  );
}

export const VistaFilterPill = Object.assign(Root, { Add, Clear });
