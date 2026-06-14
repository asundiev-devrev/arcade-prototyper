/**
 * CardGrid — responsive multi-column grid of EntityCards.
 *
 * Matches the Figma "Connectors" / Skills card grid: a 2-column grid of
 * EntityCards with an 8px gutter (Figma GRID container, ~662px content width =
 * two 327px cards + gap).
 *
 *   ┌─────────────┐  ┌─────────────┐
 *   │  Gmail      │  │  Outlook     │
 *   └─────────────┘  └─────────────┘
 *   ┌─────────────┐  ┌─────────────┐
 *   │  Salesforce │  │  HubSpot     │
 *   └─────────────┘  └─────────────┘
 *
 * Intentional opinions:
 * - Default 2 columns (the DevRev settings/connectors default). `columns={1}`
 *   for a single-column list; `columns={3}` for a dense gallery (Skills "From
 *   your org" uses 3). No other values — a different shape is a different grid.
 * - 8px gutter, matching the Figma grid gap. Cards stretch to fill their cell.
 *
 * Slots:
 * - `children` — EntityCard instances (or any cards).
 * - `columns` — 1 | 2 | 3 (default 2).
 *
 * @counterexample Do NOT set your own `grid-cols-*` or `gap-*` on a wrapper —
 *   pass `columns` instead. The gutter is fixed to the Figma value.
 * @counterexample Do NOT put section titles inside the grid. Render the title
 *   above the grid (the grid is cards only).
 */
import { type ReactNode } from "react";

type CardGridProps = {
  columns?: 1 | 2 | 3;
  children: ReactNode;
};

const COLS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export function CardGrid({ columns = 2, children }: CardGridProps) {
  return <div className={`grid ${COLS[columns]} gap-2`}>{children}</div>;
}
