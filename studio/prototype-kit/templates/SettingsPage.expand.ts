/**
 * Authored flat expansion of SettingsPage — the same chrome it renders
 * (AppShell + PageBody, flattened to host markup), with the caller's prop/child
 * SOURCE substrings dropped into their slots. Used by the post-generation
 * auto-expand pass so a generated frame becomes flat editable code instead of an
 * opaque <SettingsPage>. Keep BYTE-FAITHFUL to SettingsPage.tsx + AppShell/
 * PageBody; if their markup changes, update this too.
 *
 * WHY THIS LIVES IN ITS OWN FILE (not inside SettingsPage.tsx): this is a PURE
 * STRING BUILDER — it emits `<TitleBar …/>` etc. as TEXT and imports nothing.
 * It is consumed server-side by server/expand/registry.ts, which is in the
 * static import graph of vite.config.ts. If this function lived in
 * SettingsPage.tsx (which imports the React composites → the @xorkavi/arcade-gen
 * barrel → gridstack), then loading vite.config.ts under Node ESM would pull
 * gridstack, whose extensionless subpath import (`./gridstack-engine`) only a
 * bundler can resolve — crashing `pnpm run studio` at config load. Keeping the
 * expander import-free severs that chain. SettingsPage.tsx re-exports this name
 * so callers/tests can still reach it via the template module.
 *
 * `props` values are verbatim source substrings: title=`"My Cards"` (a quoted
 * string literal), sidebar=`<NavSidebar …/>` (JSX expression source), etc.
 */
export function expandSettingsPage(props: Record<string, string>): string {
  const { title, subtitle, sidebar, breadcrumb, actions, pageActions, titleAction, children } = props;
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
