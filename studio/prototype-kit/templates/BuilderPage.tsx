/**
 * BuilderPage — agent / entity builder page template.
 *
 * Matches the Figma Agent creation page (AS-Deploy, node 7546:37777): a desktop
 * window with a left nav, a tab bar (Build / Test / Deploy / Observe), and a
 * centered editor column containing the entity title + description, a
 * "Capabilities" group of CapabilitySections, and an Instructions block.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  TitleBar                                                  │
 *   ├───────────┬──────────────────────────────────────────────┤
 *   │           │  Build  Test  Deploy  Observe        (tabs)   │
 *   │  sidebar  ├──────────────────────────────────────────────┤
 *   │           │        CX Agent                               │
 *   │           │        You are a customer experience agent…   │
 *   │           │        Capabilities                            │
 *   │           │        ◇ Knowledge              + Add          │
 *   │           │        ◇ Skills, Tools & …      + Add          │
 *   │           │        ◇ Guardrails             + Add          │
 *   │           │        Instructions                            │
 *   └───────────┴──────────────────────────────────────────────┘
 *
 * Why a template: encodes the relationship between AppShell + the centered
 * 720px editor column + capability sections, so a generated agent-builder frame
 * is declarative slots, not hand-rolled chrome.
 *
 * Intentional opinions:
 * - Composes `AppShell` (title bar + sidebar) and renders a single centered
 *   max-w-[720px] editor column — the Figma agent editor content width.
 * - `tabs` is an optional row above the editor (Build/Test/Deploy/Observe).
 *   Pass a composed `Tabs` or leave undefined.
 * - `title` + `subtitle` are the agent heading; `children` is the editor body
 *   (typically a "Capabilities" heading + `CapabilitySection` stack + an
 *   Instructions block).
 *
 * Slots:
 * - `sidebar` — a composed NavSidebar (required).
 * - `actions` — TitleBar trailing cluster.
 * - `tabs` — optional tab row above the editor column.
 * - `title` / `subtitle` — agent name + role description.
 * - `children` — editor body (CapabilitySection stack, Instructions, etc.).
 *
 * @counterexample Do NOT widen the editor column past 720px — the builder is a
 *   centered reading-width column, not a full-bleed page.
 * @counterexample Do NOT use this for a settings/list page. Use `SettingsPage`
 *   or `VistaPage`. This template is for the capability-editor layout.
 */
import type { ReactNode } from "react";
import { AppShell } from "../composites/AppShell.js";
import { TitleBar } from "../composites/TitleBar.js";

type BuilderPageProps = {
  sidebar: ReactNode;
  actions?: ReactNode;
  /** Breadcrumb row above the tab bar (leading). Pass a composed Breadcrumb. */
  breadcrumb?: ReactNode;
  /** Trailing cluster on the breadcrumb row (e.g. an agent-status chip + icon). */
  headerActions?: ReactNode;
  tabs?: ReactNode;
  /** Trailing toolbar inline with the tab bar (e.g. a "Publish" pill button). */
  toolbar?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
};

export function BuilderPage({
  sidebar,
  actions,
  breadcrumb,
  headerActions,
  tabs,
  toolbar,
  title,
  subtitle,
  children,
}: BuilderPageProps) {
  return (
    <AppShell titleBar={<TitleBar trailingActions={actions} />} sidebar={sidebar}>
      <div className="flex h-full flex-col overflow-y-auto">
        {(breadcrumb || headerActions) && (
          <div className="flex h-11 shrink-0 items-center justify-between px-6">
            <div className="min-w-0">{breadcrumb}</div>
            {headerActions && (
              <div className="flex shrink-0 items-center gap-1.5">{headerActions}</div>
            )}
          </div>
        )}
        {tabs && (
          <div className="flex items-center justify-between border-b border-(--stroke-neutral-subtle) px-6">
            <div className="min-w-0">{tabs}</div>
            {toolbar && (
              <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
            )}
          </div>
        )}
        <div className="mx-auto w-full max-w-[720px] px-6 py-10">
          {(title || subtitle) && (
            <div className="mb-8 flex flex-col gap-2">
              {title && (
                <h1 className="text-title-1 text-(--fg-neutral-prominent)">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="text-body-medium text-(--fg-neutral-subtle)">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-8">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
