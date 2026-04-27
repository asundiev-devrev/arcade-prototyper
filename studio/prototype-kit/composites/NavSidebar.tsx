/**
 * NavSidebar — DevRev navigation sidebar composite.
 *
 * Matches Figma "Sidebar / My Work + Teams + Multiplayer Sidebar". Replaces
 * the bare `arcade.Sidebar` for prototype use. This composite lives BELOW
 * the TitleBar in AppShell, so it does NOT render traffic lights or a
 * collapse button — those are the TitleBar's responsibility.
 *
 * Intentional opinions:
 * - Three zones: brand header (top, workspace dropdown only), nav body
 *   (scrollable middle), Computer footer (bottom).
 * - Uses --surface-shallow so the sidebar reads as a muted panel against
 *   the body's --surface-overlay.
 * - Nav body accepts NavSidebar.Section and NavSidebar.Item children —
 *   same compound pattern as arcade.Sidebar for familiarity.
 *
 * Slots:
 * - `workspace` (optional) — label in the brand header (e.g. "DevRev").
 *   When omitted or falsy, the brand header is NOT rendered — use this when
 *   the Figma frame does not show a workspace header.
 * - `showFooter` (optional, default true) — when false, the Computer footer
 *   is not rendered. Use this when Figma shows a different footer pattern.
 * - `children` — NavSidebar.Section / NavSidebar.Item tree.
 */
import { forwardRef, type ReactNode } from "react";
import { ChevronDownSmall } from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type NavSidebarRootProps = {
  workspace?: ReactNode;
  showFooter?: boolean;
  children?: ReactNode;
};

function Root({ workspace, showFooter = true, children }: NavSidebarRootProps) {
  return (
    <div className="flex flex-col h-full w-full bg-(--surface-shallow)">
      {workspace ? <BrandHeader workspace={workspace} /> : null}
      <nav className="flex-1 min-h-0 overflow-auto py-1">{children}</nav>
      {showFooter ? <ComputerFooter /> : null}
    </div>
  );
}

/* ─── Brand header ──────────────────────────────────────────────────────── */

function BrandHeader({ workspace }: { workspace: ReactNode }) {
  return (
    <div className="flex items-center px-3 h-11 shrink-0">
      <button
        type="button"
        className="flex items-center gap-1.5 py-1 px-1 -mx-1 rounded-square hover:bg-(--control-bg-neutral-subtle-hover) text-(--fg-neutral-prominent) text-body-medium"
      >
        <DevRevMark />
        <span>{workspace}</span>
        <ChevronDownSmall className="text-(--fg-neutral-subtle)" />
      </button>
    </div>
  );
}

/* ─── Sections & items ──────────────────────────────────────────────────── */

type SectionProps = {
  title?: ReactNode;
  children: ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <div className="py-2">
      {title && (
        <div className="px-3 pb-1 text-caption text-(--fg-neutral-subtle) uppercase tracking-wider">
          {title}
        </div>
      )}
      <div className="flex flex-col px-2 gap-0.5">{children}</div>
    </div>
  );
}

type ItemProps = {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
};

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
  { children, active, onClick },
  ref,
) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "flex items-center gap-2 px-2 py-1 rounded-square text-system cursor-pointer select-none",
        active
          ? "bg-(--control-bg-neutral-subtle-active) text-(--fg-neutral-prominent)"
          : "text-(--fg-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) hover:text-(--fg-neutral-prominent)",
      ].join(" ")}
    >
      {children}
    </div>
  );
});

/* ─── Computer footer ───────────────────────────────────────────────────── */

function ComputerFooter() {
  return (
    <div className="flex items-center gap-2 h-10 px-3 shrink-0">
      <ComputerMark />
      <span className="flex-1 text-system text-(--fg-neutral-subtle)">
        computer
      </span>
      <kbd className="inline-flex items-center gap-0.5 text-caption text-(--fg-neutral-subtle) font-mono">
        <span>⌘</span>
        <span>.</span>
      </kbd>
    </div>
  );
}

/* ─── Inline brand marks ────────────────────────────────────────────────── */

function DevRevMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="16" height="16" rx="3" fill="currentColor" />
      <path
        d="M5 5H11M5 8H9M5 11H11"
        stroke="var(--surface-backdrop)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ComputerMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="text-(--fg-neutral-prominent)"
    >
      <rect
        x="2"
        y="3"
        width="14"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <line
        x1="6"
        y1="15.5"
        x2="12"
        y2="15.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const NavSidebar = Object.assign(Root, { Section, Item });
