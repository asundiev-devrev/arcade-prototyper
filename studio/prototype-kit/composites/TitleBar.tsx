/**
 * TitleBar — DevRev desktop window title bar composite.
 *
 * Matches Figma "Desktop/TitleBar With Tabs" (full-width 52px row).
 *
 * Figma layout:
 *   [ Window/Leading (240w, matches sidebar width) ][ Window/Trailing (remainder) ]
 *
 * Leading cluster: traffic-light dots + collapse icon.
 * Trailing cluster: back/forward arrows + (optional tab strip) + trailing
 * actions (icons + avatar) on the far right.
 *
 * A divider runs at the BOTTOM of this row (border-b). There is NO divider
 * between the title bar and the breadcrumb bar directly — the breadcrumb
 * bar is below this divider in the page area.
 *
 * Intentional opinions:
 * - Height is fixed at 52px to match Figma.
 * - Traffic-light SVGs + collapse icon are inline because they are pure
 *   chrome and never vary.
 * - The divider position matches Figma exactly (below title bar, above body).
 *
 * Slots:
 * - `leadingActions` (optional) — additional icons in the leading cluster
 *   (rare; Figma usually has just traffic lights + collapse).
 * - `nav` (optional) — back/forward arrows and any related nav controls.
 *   Defaults to a back+forward pair rendered inline. Pass `null` to hide
 *   the nav cluster entirely when Figma does not show back/forward arrows.
 * - `trailingActions` (optional) — icons + avatar cluster on the far right
 *   (search, bell, more, avatar). Pass <IconButton/>s + <Avatar/>.
 * - `showTrafficLights` (optional, default true) — suppress the macOS
 *   traffic-light dots when Figma does not show them.
 * - `showCollapseButton` (optional, default true) — suppress the sidebar
 *   collapse icon when Figma does not show it.
 *
 * @counterexample Do NOT render `TitleBar` when you're using `VistaPage` or `ComputerSidebar` — both compose their own window chrome. Doubling up stacks two title bars.
 * @counterexample Do NOT pass `nav={<></>}` to hide the back/forward arrows. Pass `nav={null}` — React treats empty fragments as present, `null` as absent.
 * @counterexample Do NOT inline your own `<svg>` traffic lights or collapse icon. They're baked in and will be duplicated.
 */
import type { ReactNode } from "react";
import { IconButton } from "@xorkavi/arcade-gen";

type TitleBarProps = {
  leadingActions?: ReactNode;
  nav?: ReactNode;
  trailingActions?: ReactNode;
  showTrafficLights?: boolean;
  showCollapseButton?: boolean;
};

export function TitleBar({
  leadingActions,
  nav,
  trailingActions,
  showTrafficLights = true,
  showCollapseButton = true,
}: TitleBarProps) {
  return (
    <div className="flex items-center h-13 shrink-0 border-b border-(--stroke-neutral-subtle) bg-(--surface-overlay)">
      {/* Leading cluster (width matches sidebar: 240px) */}
      <div className="w-60 shrink-0 flex items-center gap-3 px-4 h-full">
        {showTrafficLights ? <TrafficLights /> : null}
        {leadingActions}
        <div className="flex-1" />
        {showCollapseButton ? (
          <IconButton aria-label="Collapse sidebar" variant="tertiary" size="sm">
            <SidebarCollapseIcon />
          </IconButton>
        ) : null}
      </div>
      {/* Trailing cluster fills the rest */}
      <div className="flex-1 min-w-0 flex items-center gap-2 px-3 h-full">
        {nav !== null ? (
          <div className="flex items-center gap-0.5 shrink-0">
            {nav ?? <DefaultNav />}
          </div>
        ) : null}
        <div className="flex-1" />
        {trailingActions ? (
          <div className="flex items-center gap-1 shrink-0">{trailingActions}</div>
        ) : null}
      </div>
    </div>
  );
}

function DefaultNav() {
  return (
    <>
      <IconButton aria-label="Back" variant="tertiary" size="sm">
        <ChevronLeftIcon />
      </IconButton>
      <IconButton aria-label="Forward" variant="tertiary" size="sm">
        <ChevronRightIcon />
      </IconButton>
    </>
  );
}

/* ─── Inline chrome icons ───────────────────────────────────────────────── */

function TrafficLights() {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="w-3 h-3 rounded-circle bg-[#FF5F57]" />
      <span className="w-3 h-3 rounded-circle bg-[#FEBC2E]" />
      <span className="w-3 h-3 rounded-circle bg-[#28C840]" />
    </div>
  );
}

function SidebarCollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <line x1="6" y1="3.5" x2="6" y2="12.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
