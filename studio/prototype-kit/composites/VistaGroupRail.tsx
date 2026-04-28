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
 *   Item list: role="list", flex-col, px-2
 *   Item: role="listitem", h=32, rounded-md (6px), px-2 gap-2, text-body-small
 *   Selected item: solid --bg-info-prominent (blue) with --fg-info-on-prominent
 *   Non-selected hover: --control-bg-neutral-subtle-hover
 *
 * Why solid blue for selected: arcade-gen's token vocabulary does not
 * include `--bg-interactive-primary-resting` or `--surface-overlay-hovered`
 * — those are invented names from an earlier draft of this file. The real
 * active-nav color in DevRev is `--bg-info-prominent` (solid) with
 * `--fg-info-on-prominent` on top, which is what production uses for the
 * selected priority group.
 *
 * The `Item` subcomponent encodes the selected-state token mapping so
 * callers can't drift on alpha values.
 *
 * Slots:
 * - `sortControl` (optional) — sort button shown above the item list.
 * - `children` — a list of <VistaGroupRail.Item/>.
 *
 * VistaGroupRail.Item props:
 * - `selected` — highlights the row with the solid info-prominent background.
 * - `label` — left-aligned main text.
 * - `count` (optional) — right-aligned count.
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
      <nav role="list" className="flex flex-col px-2 gap-px">
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
          ? "bg-(--bg-info-prominent) text-(--fg-info-on-prominent)"
          : "text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{label}</span>
      {count != null ? (
        <span
          className={
            selected
              ? "text-(--fg-info-on-prominent) opacity-80"
              : "text-(--fg-neutral-subtle)"
          }
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export const VistaGroupRail = Object.assign(Root, { Item });
