/**
 * VistaGroupRail — DevRev vista group/sort rail.
 *
 * Matches the 256px-wide left column in vista list-view body:
 *
 *   ┌────────────────────────┐
 *   │  Sort by Default ↑     │  ← sortControl slot
 *   ├────────────────────────┤
 *   │  P0                  1 │
 *   │  P1                 15 │  ← VistaGroupRail.Item list
 *   │  P2                 13 │
 *   │  P3                 17 │
 *   └────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   Outer: w=256, flex flex-col
 *   Sort control area: px-2 pt-4 pb-2
 *   Item list: role="group", flex-col, px-2
 *   Item: role="listitem", h=32, rounded-md (6px), px-2 gap-2, text-body-small
 *   Selected item: rgba(75,83,236,0.2) bg with rgba(75,83,236,0.1) outline
 *     → token-mapped to --bg-interactive-primary with /20 and /10 alpha
 *   Non-selected hover: --surface-overlay-hovered
 *
 * The `Item` subcomponent encodes the selected-state token mapping so
 * callers can't drift on the alpha values.
 *
 * Slots:
 * - `sortControl` (optional) — sort button shown above the item list.
 * - `children` — a list of <VistaGroupRail.Item/>.
 *
 * VistaGroupRail.Item props:
 * - `selected` — highlights the row with the interactive-primary tokens.
 * - `label` — left-aligned main text.
 * - `count` (optional) — right-aligned count; uses --fg-neutral-subtle.
 * - `onClick` (optional) — click handler.
 */
import type { MouseEventHandler, ReactNode } from "react";

type VistaGroupRailProps = {
  sortControl?: ReactNode;
  children: ReactNode;
};

function Root({ sortControl, children }: VistaGroupRailProps) {
  return (
    <aside className="w-64 shrink-0 flex flex-col">
      {sortControl != null ? (
        <div className="px-2 pt-4 pb-2">{sortControl}</div>
      ) : null}
      <nav role="group" className="flex flex-col px-2 gap-px">
        {children}
      </nav>
    </aside>
  );
}

type ItemProps = {
  selected?: boolean;
  label: ReactNode;
  count?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

function Item({ selected, label, count, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role="listitem"
      onClick={onClick}
      className={[
        "h-8 rounded-md px-2 flex items-center gap-2 w-full text-left",
        "text-body-small cursor-pointer",
        selected
          ? "bg-(--bg-interactive-primary-resting)/20 outline outline-1 outline-(--bg-interactive-primary-resting)/10"
          : "hover:bg-(--surface-overlay-hovered)",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="text-(--fg-neutral-subtle)">{count}</span>
      ) : null}
    </button>
  );
}

export const VistaGroupRail = Object.assign(Root, { Item });
