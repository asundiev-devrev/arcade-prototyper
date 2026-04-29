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
 * Why this composite exists: generators were hand-rolling a single-cell
 * div, losing the divider-segmented look. Encoding it here keeps every
 * frame's filter row visually identical to production.
 *
 * Slots:
 * - `icon` (optional) — 12–14px leading icon (arcade icon or custom SVG).
 * - `label` — the filter category, e.g. "Created date", "Stage", "Part".
 * - `operator` (optional, default "is") — the comparison word between label
 *   and value. Set to `null` to suppress (single-segment pill).
 * - `value` — the selected value(s), e.g. "last 30 days", "None of +1".
 * - `onRemove` (optional) — when provided, renders the trailing × button.
 *
 * @counterexample Do NOT hand-roll the filter pill as a single div with
 *   inline content. The segmented dividers are what make it read as a
 *   DevRev filter pill instead of a generic chip.
 * @counterexample Do NOT use `<Tag>` for filter pills. Tag is a label
 *   component and renders as a solid-tinted chip without segment dividers.
 */
import type { ReactNode } from "react";
import { CrossSmall } from "@xorkavi/arcade-gen";

type VistaFilterPillProps = {
  icon?: ReactNode;
  label: ReactNode;
  operator?: ReactNode | null;
  value: ReactNode;
  onRemove?: () => void;
};

export function VistaFilterPill({
  icon,
  label,
  operator = "is",
  value,
  onRemove,
}: VistaFilterPillProps) {
  return (
    <div className="inline-flex items-center h-control-sm rounded-square border border-(--stroke-neutral-subtle) bg-(--surface-overlay) text-body-small text-(--fg-neutral-prominent) overflow-hidden">
      <span className="inline-flex items-center gap-1.5 px-2 text-(--fg-neutral-subtle)">
        {icon}
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
