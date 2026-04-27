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
 * Slots:
 * - `title` — the vista title. Typically an inline-edit button; a plain
 *   span also works.
 * - `count` (optional) — item count, rendered with fg-neutral-subtle.
 * - `actions` (optional) — IconButton cluster (search/sort/filter/…).
 * - `primaryAction` (optional) — primary call-to-action button (e.g. + Issue).
 */
import type { ReactNode } from "react";

type VistaHeaderProps = {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
};

export function VistaHeader({
  title,
  count,
  actions,
  primaryAction,
}: VistaHeaderProps) {
  return (
    <header className="flex items-center justify-between px-9 py-5 h-[72px] shrink-0">
      <div className="flex items-baseline gap-1.5 h-8">
        {title}
        {count != null ? (
          <span className="text-(--fg-neutral-subtle)">{count}</span>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {actions}
        {primaryAction}
      </div>
    </header>
  );
}
