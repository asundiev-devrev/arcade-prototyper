/**
 * VistaPagination — footer band for vista list views.
 *
 * Matches the footer across DevRev vista pages:
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Rows per page [50 v]            1–50 of 16538  ‹  ›        │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Sits below the scrolling table container, owns its own top border, and
 * is always visible (not part of the scroll region).
 *
 * Slots:
 * - `pageSize` — current rows-per-page value as a plain number/string.
 * - `onPageSizeClick` (optional) — handler for the size selector (toggles
 *   a dropdown the caller owns — this composite just renders the trigger).
 * - `rangeLabel` — the "1–50 of 16538" summary text (caller formats it).
 * - `onPrev` / `onNext` (optional) — paging handlers; omit to disable.
 * - `canPrev` / `canNext` (optional, default true) — disables the
 *   respective button without hiding it.
 *
 * @counterexample Do NOT hand-roll the pagination row as inline JSX
 *   inside VistaPage children. It's a sibling of the scrolling area with
 *   its own border; rolling it inline causes the border to scroll away.
 */
import {
  ChevronLeftSmall,
  ChevronRightSmall,
  ChevronDownSmall,
  IconButton,
} from "@xorkavi/arcade-gen";
import type { ReactNode } from "react";

type VistaPaginationProps = {
  pageSize: ReactNode;
  onPageSizeClick?: () => void;
  rangeLabel: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
};

export function VistaPagination({
  pageSize,
  onPageSizeClick,
  rangeLabel,
  onPrev,
  onNext,
  canPrev = true,
  canNext = true,
}: VistaPaginationProps) {
  return (
    <div className="flex items-center justify-between h-12 px-6 shrink-0 border-t border-(--stroke-neutral-subtle) text-body-small text-(--fg-neutral-subtle)">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <button
          type="button"
          onClick={onPageSizeClick}
          className="inline-flex items-center h-control-sm rounded-square border border-(--stroke-neutral-subtle) px-2 gap-1 text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)"
        >
          <span>{pageSize}</span>
          <ChevronDownSmall size={12} className="text-(--fg-neutral-subtle)" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span>{rangeLabel}</span>
        <IconButton
          aria-label="Previous page"
          variant="tertiary"
          size="sm"
          disabled={!canPrev}
          onClick={onPrev}
        >
          <ChevronLeftSmall size={16} />
        </IconButton>
        <IconButton
          aria-label="Next page"
          variant="tertiary"
          size="sm"
          disabled={!canNext}
          onClick={onNext}
        >
          <ChevronRightSmall size={16} />
        </IconButton>
      </div>
    </div>
  );
}
