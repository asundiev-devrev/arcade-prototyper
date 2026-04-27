/**
 * AppShell — DevRev desktop window composite.
 *
 * Matches the Figma "Desktop App" frame and DevRev SoR vista pages:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Title Bar (optional — full-width, 52px)                     │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │               │                                              │
 *   │   Sidebar     │   Breadcrumb Bar (optional)                  │
 *   │   (240 or     ├──────────────────────────────────────────────┤
 *   │    256px)     │                                              │
 *   │               │   children (page body)                       │
 *   │               │                                              │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Title bar spans the full width at the top WHEN PRESENT. Vista pages
 *   omit it — the sidebar starts at y=0.
 * - Sidebar width is 240px by default (matches the Figma Desktop App
 *   frame). Vista pages use 256px to match the real DevRev SoR app.
 * - No border-r on the sidebar — it uses --surface-shallow against the
 *   body's --surface-overlay so the color change is the separator.
 * - The divider above the page body (between breadcrumb bar and body)
 *   is rendered here via border-t on the body scroll container, and
 *   only when a breadcrumbBar is present.
 *
 * Slots:
 * - `titleBar` (optional) — a <TitleBar/>. Omit for chromeless/vista pages.
 * - `sidebar` — a <NavSidebar/>. Required.
 * - `breadcrumbBar` (optional) — a <BreadcrumbBar/> rendered above the body.
 * - `sidebarWidth` (optional, default "240") — "240" for Figma Desktop App
 *   frames, "256" for DevRev vista/production parity.
 * - `children` — page body content (typically a <PageBody/> or a vista body).
 */
import type { ReactNode } from "react";

type AppShellProps = {
  titleBar?: ReactNode;
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  sidebarWidth?: "240" | "256";
  children: ReactNode;
};

export function AppShell({
  titleBar,
  sidebar,
  breadcrumbBar,
  sidebarWidth = "240",
  children,
}: AppShellProps) {
  // Divider above the body only makes sense when a breadcrumbBar sits above it.
  // When no breadcrumbBar is given (e.g. an agent/home screen), the body sits
  // directly under the title bar and needs no extra divider.
  const hasBreadcrumbBar = breadcrumbBar != null;
  return (
    <div className="flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden">
      {titleBar}
      <div className="flex flex-1 min-h-0">
        <aside
          className={[
            sidebarWidth === "256" ? "w-64" : "w-60",
            "shrink-0 h-full flex flex-col",
          ].join(" ")}
        >
          {sidebar}
        </aside>
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
