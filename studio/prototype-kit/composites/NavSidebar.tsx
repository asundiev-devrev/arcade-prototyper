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
 * - Active item is solid --bg-info-prominent with --fg-info-on-prominent,
 *   matching the DevRev production app (not a muted gray pill).
 * - Section titles render at text-system-medium with --fg-neutral-prominent
 *   — NOT uppercase/caption. Uppercase was a carry-over from an older
 *   design and doesn't match the current sidebar spec.
 *
 * Slots:
 * - `workspace` (optional) — label in the brand header (e.g. "DevRev").
 *   When omitted or falsy, the brand header is NOT rendered — use this when
 *   the Figma frame does not show a workspace header.
 * - `showFooter` (optional, default true) — when false, the Computer footer
 *   is not rendered. Use this when Figma shows a different footer pattern.
 * - `children` — NavSidebar.Section / NavSidebar.Item tree.
 *
 * @counterexample When Figma shows a chat-style sidebar (with "New Chat" and chat history), use `ComputerSidebar` instead. That composite owns its own window chrome; do NOT also render a `TitleBar` alongside it.
 * @counterexample Never use `arcade.Sidebar` directly for the main app sidebar — it's the bare primitive. `NavSidebar` adds the workspace dropdown, Computer footer, and correct tokens.
 * @counterexample Do not pass `workspace=""` to hide the brand header. Composites check truthiness; the empty string counts as "present but empty". Omit the prop entirely.
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
        <div className="px-3 pb-1 text-system-medium text-(--fg-neutral-prominent)">
          {title}
        </div>
      )}
      <div className="flex flex-col px-2 gap-0.5">{children}</div>
    </div>
  );
}

type ItemProps = {
  /** Item label. Legacy callers pass it as `children`; new callers may use
   *  `label` with `icon` / `trailing` for a richer row. Both are supported
   *  to avoid breaking existing prototype code. */
  children?: ReactNode;
  label?: ReactNode;
  /** Leading icon slot — typically a 16px arcade icon. Rendered with
   *  --fg-neutral-subtle when idle, inheriting the active fg on selection. */
  icon?: ReactNode;
  /** Trailing content — counts (`<Tag intent="info">14</Tag>`), shortcuts,
   *  or a chevron for expandable sections. Pushed to the row's right edge. */
  trailing?: ReactNode;
  /** Nest the item under its parent. Applies an extra 16px left padding
   *  so child items align visually under a section/parent item. */
  indent?: boolean;
  active?: boolean;
  onClick?: () => void;
};

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
  { children, label, icon, trailing, indent, active, onClick },
  ref,
) {
  // Accept either `label` (new API) or `children` (legacy). `label` wins
  // when both are set so callers can migrate piecemeal without ambiguity.
  const body = label ?? children;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "flex items-center gap-2 py-1 rounded-square text-system cursor-pointer select-none",
        indent ? "pl-8 pr-2" : "px-2",
        active
          ? "bg-(--bg-info-prominent) text-(--fg-info-on-prominent)"
          : "text-(--fg-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) hover:text-(--fg-neutral-prominent)",
      ].join(" ")}
    >
      {icon ? (
        <span
          aria-hidden
          className={[
            "inline-flex items-center shrink-0",
            active ? "" : "text-(--fg-neutral-subtle)",
          ].join(" ")}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 min-w-0 truncate">{body}</span>
      {trailing != null ? (
        <span className="shrink-0 inline-flex items-center">{trailing}</span>
      ) : null}
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
