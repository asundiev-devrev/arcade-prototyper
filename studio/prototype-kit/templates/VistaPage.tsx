/**
 * VistaPage — DevRev vista list-view page template.
 *
 * Composes AppShell + VistaHeader + VistaToolbar in the canonical DevRev
 * vista layout, with a single body slot for the group rail + table:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  NavSidebar │  VistaHeader (title / count / actions)          │
 *   │  (256px)    ├──────────────────────────────────────────────┤
 *   │             │  VistaToolbar (icons | filters)                 │
 *   │             ├──────────────────────────────────────────────┤
 *   │             │  children (group rail + table, split by caller) │
 *   └─────────────┴──────────────────────────────────────────────┘
 *
 * Why a template, not a composite: like SettingsPage, this layer encodes
 * the relationship between composites. A generated frame drops from
 * ~200 hand-rolled lines to ~40 declarative slots.
 *
 * Intentional opinions:
 * - AppShell receives sidebarWidth="256" and no titleBar — vista pages are
 *   chromeless above the sidebar.
 * - The body band's 1px top border is owned by this template (no
 *   composite, because it's a sibling flex row with no state).
 * - `sidebar` expects a fully-composed NavSidebar; the template does not
 *   render one implicitly.
 *
 * Slots:
 * - `sidebar` — typically <NavSidebar workspace="DevRev">…</NavSidebar>.
 * - `title` — VistaHeader title slot.
 * - `count` (optional) — VistaHeader count slot.
 * - `actions` (optional) — VistaHeader right-cluster icon buttons.
 * - `primaryAction` (optional) — VistaHeader primary button (e.g. + Issue).
 * - `toolbarIcons` (optional) — VistaToolbar icon cluster.
 * - `filters` (optional) — VistaToolbar filter pills + add + clear.
 * - `children` — body content; typically a <VistaGroupRail/> followed by
 *   a flex-1 table container.
 */
import type { ReactNode } from "react";
import { AppShell } from "../composites/AppShell.js";
import { VistaHeader } from "../composites/VistaHeader.js";
import { VistaToolbar } from "../composites/VistaToolbar.js";

type VistaPageProps = {
  sidebar: ReactNode;

  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;

  toolbarIcons?: ReactNode;
  filters?: ReactNode;

  children: ReactNode;
};

export function VistaPage({
  sidebar,
  title,
  count,
  actions,
  primaryAction,
  toolbarIcons,
  filters,
  children,
}: VistaPageProps) {
  return (
    <AppShell sidebar={sidebar} sidebarWidth="256">
      <VistaHeader
        title={title}
        count={count}
        actions={actions}
        primaryAction={primaryAction}
      />
      <VistaToolbar toolbarIcons={toolbarIcons} filters={filters} />
      <div className="flex flex-grow min-h-0 border-t border-(--stroke-neutral-subtle)">
        {children}
      </div>
    </AppShell>
  );
}
