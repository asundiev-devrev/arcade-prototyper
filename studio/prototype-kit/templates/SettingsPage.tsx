/**
 * SettingsPage — DevRev settings-style page template.
 *
 * Composes AppShell + TitleBar + NavSidebar + BreadcrumbBar + PageBody in
 * the canonical DevRev desktop settings layout:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  TitleBar (traffic lights + collapse | nav + actions)    │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  NavSidebar  │  BreadcrumbBar                            │
 *   │              ├───────────────────────────────────────────┤
 *   │              │  PageBody (title + subtitle + sections)   │
 *   └──────────────┴───────────────────────────────────────────┘
 *
 * Why a template, not a composite: this layer encodes the *relationship*
 * between composites. A generated frame shrinks from ~250 hand-rolled lines
 * to ~40 declarative slots, and there is no room to hallucinate the wrong
 * page chrome.
 *
 * Intentional opinions:
 * - The template controls the outer chrome (title bar, sidebar split, body
 *   divider). Callers fill slots but do not choose the assembly.
 * - `sidebar` expects a fully-composed NavSidebar; the template does not
 *   render one implicitly, because the sidebar contents vary per prototype.
 * - `actions` populates the TitleBar's trailing cluster (top-right of the
 *   window) — search, bell, avatar, etc.
 * - `breadcrumb` is passed straight through to BreadcrumbBar.
 * - `title`, `subtitle`, and `children` are passed straight through to
 *   PageBody.
 *
 * Slots:
 * - `sidebar` — typically <NavSidebar workspace="DevRev">…</NavSidebar>.
 * - `breadcrumb` — typically <Breadcrumb.Root>…</Breadcrumb.Root>.
 * - `actions` (optional) — top-right cluster (IconButtons + Avatar).
 * - `pageActions` (optional) — cluster on the BreadcrumbBar (e.g. a "More"
 *   IconButton or a "Save" primary Button).
 * - `title` (optional) — hero page title.
 * - `subtitle` (optional) — page description.
 * - `children` — SettingsCard stack (or any centered body content).
 */
import type { ReactNode } from "react";
import { AppShell } from "../composites/AppShell.js";
import { TitleBar } from "../composites/TitleBar.js";
import { BreadcrumbBar } from "../composites/BreadcrumbBar.js";
import { PageBody } from "../composites/PageBody.js";

type SettingsPageProps = {
  sidebar: ReactNode;
  breadcrumb: ReactNode;
  actions?: ReactNode;
  pageActions?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
};

export function SettingsPage({
  sidebar,
  breadcrumb,
  actions,
  pageActions,
  title,
  subtitle,
  children,
}: SettingsPageProps) {
  return (
    <AppShell
      titleBar={<TitleBar trailingActions={actions} />}
      sidebar={sidebar}
      breadcrumbBar={
        <BreadcrumbBar breadcrumb={breadcrumb} actions={pageActions} />
      }
    >
      <PageBody title={title} subtitle={subtitle}>
        {children}
      </PageBody>
    </AppShell>
  );
}
