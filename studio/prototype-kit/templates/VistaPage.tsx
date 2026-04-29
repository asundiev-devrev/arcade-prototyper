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
 *
 * @counterexample Never re-implement `VistaPage` locally in the frame (`function VistaPage(…) { return <AppShell …/> }`). Import it from `arcade-prototypes`. Same for `VistaGroupRail` and `VistaRow`.
 * @counterexample Do NOT also pass a `TitleBar` via `AppShell` — vista pages are deliberately chromeless above the sidebar; the sidebar starts at y=0.
 * @counterexample Do NOT pre-wrap `title` or `count` in your own `<span className="text-…">`. `VistaHeader` applies `text-title-3` to the title and `text-body` + `--fg-neutral-subtle` to the count; any wrapper classes you add will just fight it.
 * @counterexample For the table body inside `children`, use `<VistaRow>` + the column vocabulary. Do NOT hand-roll `<div className="flex items-center h-11 …">` rows — they drift on tokens and hover states.
 * @counterexample Pass the `count` verbatim as it appears in the reference (Figma frame, screenshot, or description) — `"165.1K"`, `"1.2M"`, `"16,538"`. Do NOT reformat, expand (`"165100"`), strip separators (`"16538"`), or localize. `count` is a display string, not a number.
 * @counterexample Render exactly the controls the reference shows in `actions` — count them before writing JSX. If the reference shows 3 icon buttons, render 3. Do not add a gear, a more-menu, a view-toggle, or any "list views usually have X" control. Same for `toolbarIcons` and `filters`.
 * @counterexample When the reference shows a tab strip (e.g. `Issues +`) or segmented toggle between the toolbar and the table body, render it as the FIRST element inside `children`, ABOVE the group rail + table row. It is not optional chrome; dropping it changes the meaning of the page. If the template's slots don't cleanly accommodate a tab strip, put it inline inside `children` — just don't skip it.
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
