/**
 * BreadcrumbBar — DevRev breadcrumb row composite.
 *
 * Matches Figma "Page Header / Breadcrumb Bar" (the 44px row directly below
 * the title bar that contains the current-location breadcrumb and any page-
 * level action cluster).
 *
 * Figma layout:
 *   [ Breadcrumb (left, truncates) ][ flex ][ actions cluster (right) ]
 *
 * Intentional opinions:
 * - No back/forward arrows here. Those live in the TitleBar's trailing
 *   cluster in the Figma design.
 * - No border. The divider BETWEEN this row and the page body is rendered
 *   by `AppShell` (via its body border-top). There is also NO divider
 *   between the TitleBar and this row — TitleBar owns the divider above
 *   this row (its `border-b`).
 *
 * Slots:
 * - `breadcrumb` — a <Breadcrumb.Root> from arcade.
 * - `actions` (optional) — page-level actions (e.g. a "More" IconButton,
 *   or a primary "Save" Button).
 */
import type { ReactNode } from "react";

type BreadcrumbBarProps = {
  breadcrumb: ReactNode;
  actions?: ReactNode;
};

export function BreadcrumbBar({ breadcrumb, actions }: BreadcrumbBarProps) {
  return (
    <div className="flex items-center gap-2 h-11 px-4 shrink-0">
      <div className="flex-1 min-w-0 flex items-center">{breadcrumb}</div>
      {actions ? (
        <div className="flex items-center gap-1 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
