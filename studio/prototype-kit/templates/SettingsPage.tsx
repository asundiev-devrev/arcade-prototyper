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
  /** Primary CTA aligned inline with the page title (e.g. "Add custom
   *  connector"). Prefer this over `pageActions` for the page's main action —
   *  Figma places it next to the heading, not in the breadcrumb bar. */
  titleAction?: ReactNode;
  children: ReactNode;
};

export function SettingsPage({
  sidebar,
  breadcrumb,
  actions,
  pageActions,
  title,
  subtitle,
  titleAction,
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
      <PageBody title={title} subtitle={subtitle} titleAction={titleAction}>
        {children}
      </PageBody>
    </AppShell>
  );
}

/**
 * Authored flat expansion of SettingsPage — the same chrome it renders
 * (AppShell + PageBody, flattened to host markup), with the caller's prop/child
 * SOURCE substrings dropped into their slots. Used by the post-generation
 * auto-expand pass so a generated frame becomes flat editable code instead of an
 * opaque <SettingsPage>. Keep BYTE-FAITHFUL to the component above + AppShell/
 * PageBody; if their markup changes, update this too.
 *
 * `props` values are verbatim source substrings: title=`"My Cards"` (a quoted
 * string literal), sidebar=`<NavSidebar …/>` (JSX expression source), etc.
 */
export function expandSettingsPage(props: Record<string, string>): string {
  const { title, subtitle, sidebar = "null", breadcrumb, actions, pageActions, titleAction, children = "null" } = props;
  // A string-literal prop ("X") becomes JSX text X; a JSX-expression prop stays {…}.
  const asText = (v: string | undefined): string => {
    if (v == null) return "";
    const m = /^"([\s\S]*)"$/.exec(v) ?? /^'([\s\S]*)'$/.exec(v);
    return m ? m[1] : `{${v}}`;
  };
  const asNode = (v: string | undefined): string => (v == null ? "" : v); // expression source inlined verbatim

  const titleBlock =
    title || subtitle
      ? `<div className="mb-10 flex items-start justify-between gap-4"><div>` +
        (title ? `<h1 className="text-title-large text-(--fg-neutral-prominent)">${asText(title)}</h1>` : ``) +
        (subtitle ? `<p className="mt-1 text-body text-(--fg-neutral-subtle)">${asText(subtitle)}</p>` : ``) +
        `</div>` +
        (titleAction ? `<div className="shrink-0 pt-1">${asNode(titleAction)}</div>` : ``) +
        `</div>`
      : ``;

  const pageBody =
    `<div className="mx-auto w-full max-w-[832px] px-6 pt-12 pb-16">` +
    titleBlock +
    `<div className="flex flex-col gap-12">${asNode(children)}</div>` +
    `</div>`;

  const titleBar = `<TitleBar trailingActions={${actions ?? "undefined"}} />`;
  const breadcrumbBar = `<BreadcrumbBar breadcrumb={${breadcrumb ?? "undefined"}} actions={${pageActions ?? "undefined"}} />`;

  return (
    `<div className="flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden">` +
    titleBar +
    `<div className="flex flex-1 min-h-0">` +
    `<aside className="w-60 shrink-0 h-full flex flex-col">${asNode(sidebar)}</aside>` +
    `<div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">` +
    breadcrumbBar +
    `<main className="flex-1 min-h-0 overflow-auto border-t border-(--stroke-neutral-subtle)">` +
    pageBody +
    `</main></div></div></div>`
  );
}
