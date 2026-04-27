/**
 * AppShell — DevRev desktop window composite.
 *
 * Matches the Figma "Desktop App" frame:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Title Bar (full-width, 52px; traffic lights + nav + actions) │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │               │                                              │
 *   │   Sidebar     │   Breadcrumb Bar (optional)                  │
 *   │   (240px)     ├──────────────────────────────────────────────┤
 *   │               │                                              │
 *   │               │   children (page body)                       │
 *   │               │                                              │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Title bar spans the FULL width at the top. The sidebar is below it,
 *   NOT beside it. This matches Figma exactly and is the single biggest
 *   shape difference from earlier iterations of this composite.
 * - Sidebar width is 240px. No border-r — the sidebar uses --surface-shallow
 *   against the body's --surface-overlay, so the color change is the separator.
 * - The divider ABOVE the page body (i.e. between breadcrumb bar and body
 *   content) is rendered here via border-t on the body scroll container.
 *   There is NO divider between the title bar and the breadcrumb bar.
 *
 * Slots:
 * - `titleBar` — a <TitleBar/>. Required.
 * - `sidebar` — a <NavSidebar/>. Required.
 * - `breadcrumbBar` (optional) — a <BreadcrumbBar/> rendered above the body.
 * - `children` — page body content (typically a <PageBody/>).
 */
import type { ReactNode } from "react";

type AppShellProps = {
  titleBar: ReactNode;
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  children: ReactNode;
};

export function AppShell({ titleBar, sidebar, breadcrumbBar, children }: AppShellProps) {
  // Divider above the body only makes sense when a breadcrumbBar sits above it.
  // When no breadcrumbBar is given (e.g. an agent/home screen), the body sits
  // directly under the title bar and needs no extra divider.
  const hasBreadcrumbBar = breadcrumbBar != null;
  return (
    <div className="flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden">
      {titleBar}
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 shrink-0 h-full flex flex-col">{sidebar}</aside>
        <div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">
          {hasBreadcrumbBar ? breadcrumbBar : null}
          <main
            className={[
              "flex-1 min-h-0 overflow-auto",
              hasBreadcrumbBar ? "border-t border-(--stroke-neutral-subtle)" : "",
            ].join(" ")}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
