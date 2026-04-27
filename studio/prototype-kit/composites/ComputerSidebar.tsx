/**
 * ComputerSidebar — chat-app sidebar composite for "Computer" / Agent Studio.
 *
 * Matches Figma "_Sidebar" in the "C - May Release" file
 * (node 7253:101676). This is DIFFERENT from `NavSidebar`:
 *
 * - `NavSidebar` is for the DevRev SoR desktop app (lives below a shared
 *   TitleBar; workspace dropdown header; Computer footer).
 * - `ComputerSidebar` is for the Computer chat interface. It owns its own
 *   window chrome (traffic lights + collapse + nav arrows), then a primary
 *   action row ("New Chat" + history), then chat groups with items, then a
 *   user footer (avatar + name + subtitle + bell).
 *
 * Because it owns window chrome, pages using `ComputerSidebar` typically do
 * NOT use `TitleBar` on top — the sidebar IS the title bar on the left, and
 * the main canvas has no top chrome.
 *
 * Slots:
 * - `workspace` (optional) — when provided, renders a brand pill (mark +
 *   label + chevron) below the chrome. Computer sidebars typically omit
 *   this (chrome goes straight into the action row). NavSidebar uses a
 *   separate BrandHeader for the DevRev SoR app — don't confuse the two.
 * - `primaryAction` (optional) — primary CTA pill on the left of the actions
 *   row. **Defaults to a "New Chat" button** when the prop is omitted.
 *   Pass `null` to suppress; pass your own button to override.
 * - `historyAction` (optional) — icon button to the right of the primary
 *   action. **Defaults to a history clock IconButton** when omitted.
 *   Pass `null` to suppress; pass your own IconButton to override.
 * - `showWindowChrome` (optional, default true) — set to false if your page
 *   renders its own TitleBar above the sidebar.
 * - `agentStudioLink` (optional) — renders an "Agent Studio" link row directly
 *   above the user footer. **Defaults to a built-in link** when omitted.
 *   Pass `null` to suppress; pass a custom node to override.
 * - `user` (optional) — the user footer block. Pass a <ComputerSidebar.User />.
 *   When omitted, the footer is not rendered.
 * - `footerAction` (optional) — icon button on the right of the user footer
 *   (typically a <Bell /> notifications icon).
 * - `children` — ComputerSidebar.Group / ComputerSidebar.Item tree.
 *
 * Usage tips:
 * - Chat items should use the arcade `<Avatar name="..." src="..." size="sm" />`
 *   component for leading content — never a raw string letter placeholder.
 */
import { forwardRef, type ReactNode } from "react";
import {
  ChevronDownSmall,
  ChevronLeftSmall,
  ChevronRightSmall,
  PlusInChatBubble,
  Clock,
  PlusSmall,
  AgentStudio,
  IconButton,
  Button,
} from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = {
  workspace?: ReactNode;
  primaryAction?: ReactNode;
  historyAction?: ReactNode;
  showWindowChrome?: boolean;
  agentStudioLink?: ReactNode;
  user?: ReactNode;
  footerAction?: ReactNode;
  children?: ReactNode;
};

const ACTION_ROW_UNSET = Symbol("ACTION_ROW_UNSET");

function Root({
  workspace,
  primaryAction = ACTION_ROW_UNSET as unknown as ReactNode,
  historyAction = ACTION_ROW_UNSET as unknown as ReactNode,
  showWindowChrome = true,
  agentStudioLink = ACTION_ROW_UNSET as unknown as ReactNode,
  user,
  footerAction,
  children,
}: RootProps) {
  // The primary action row (New Chat + history) is Computer's defining feature.
  // Render defaults when the caller omits both props; render nothing only if
  // the caller explicitly opts out with `primaryAction={null}`.
  const primary =
    primaryAction === ACTION_ROW_UNSET ? <DefaultPrimaryAction /> : primaryAction;
  const history =
    historyAction === ACTION_ROW_UNSET ? <DefaultHistoryAction /> : historyAction;
  const hasActionRow = primary != null || history != null;
  const agentStudio =
    agentStudioLink === ACTION_ROW_UNSET ? <DefaultAgentStudioLink /> : agentStudioLink;

  return (
    <div className="flex flex-col h-full w-64 shrink-0 bg-(--surface-shallow) border-r border-(--stroke-neutral-subtle)">
      {showWindowChrome ? <WindowChrome /> : null}

      {workspace ? <Brand label={workspace} /> : null}

      {hasActionRow ? (
        <div className="flex items-center gap-2 px-3 pt-2 pb-3">
          {primary}
          {history}
        </div>
      ) : null}

      <nav className="flex-1 min-h-0 overflow-auto">{children}</nav>

      {agentStudio ? <div className="px-2 pb-1 shrink-0">{agentStudio}</div> : null}

      {user ? (
        <div className="flex items-center gap-3 px-3 h-14 shrink-0 border-t border-(--stroke-neutral-subtle)">
          <div className="flex-1 min-w-0">{user}</div>
          {footerAction ? <div className="shrink-0">{footerAction}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Window chrome ─────────────────────────────────────────────────────── */

function WindowChrome() {
  return (
    <div className="flex items-center h-11 shrink-0 px-3 gap-2">
      <TrafficLights />
      <IconButton
        aria-label="Toggle sidebar"
        variant="tertiary"
        size="sm"
        className="text-(--fg-neutral-subtle)"
      >
        <SidebarCollapseIcon />
      </IconButton>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 text-(--fg-neutral-subtle)">
        <IconButton aria-label="Back" variant="tertiary" size="sm">
          <ChevronLeftSmall />
        </IconButton>
        <IconButton aria-label="Forward" variant="tertiary" size="sm">
          <ChevronRightSmall />
        </IconButton>
      </div>
    </div>
  );
}

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

/* ─── Brand pill ────────────────────────────────────────────────────────── */

function Brand({ label }: { label: ReactNode }) {
  return (
    <div className="flex items-center px-3 pt-1 pb-2 shrink-0">
      <button
        type="button"
        className="flex items-center gap-1.5 py-1 px-1.5 -mx-1 rounded-square hover:bg-(--control-bg-neutral-subtle-hover) text-(--fg-neutral-prominent) text-body-medium"
      >
        <DevRevMark />
        <span>{label}</span>
        <ChevronDownSmall className="text-(--fg-neutral-subtle)" />
      </button>
    </div>
  );
}

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

/* ─── Default actions row children ──────────────────────────────────────── */

function DefaultPrimaryAction() {
  return (
    <Button variant="secondary" size="lg" className="flex-1 justify-center gap-2">
      <PlusInChatBubble size={16} />
      New Chat
    </Button>
  );
}

function DefaultHistoryAction() {
  return (
    <IconButton aria-label="History" variant="secondary" size="lg">
      <Clock />
    </IconButton>
  );
}

function DefaultAgentStudioLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-square text-system text-(--fg-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) hover:text-(--fg-neutral-prominent)"
    >
      <span className="shrink-0 w-5 h-5 flex items-center justify-center">
        <AgentStudio size={16} />
      </span>
      <span className="flex-1 text-left">Agent Studio</span>
    </button>
  );
}

/* ─── Group ─────────────────────────────────────────────────────────────── */

type GroupProps = {
  title?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
};

function Group({ title, trailing, children }: GroupProps) {
  return (
    <div className="py-2">
      {title || trailing ? (
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-caption text-(--fg-neutral-subtle)">
            {title}
          </span>
          {trailing ?? (
            <button
              type="button"
              aria-label="Add"
              className="text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) p-0.5 rounded-square hover:bg-(--control-bg-neutral-subtle-hover)"
            >
              <PlusSmall size={16} />
            </button>
          )}
        </div>
      ) : null}
      <div className="flex flex-col px-2 gap-0.5">{children}</div>
    </div>
  );
}

/* ─── Item ──────────────────────────────────────────────────────────────── */

type ItemProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
};

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
  { leading, trailing, children, active, onClick },
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
      {leading ? <span className="shrink-0 w-5 h-5 flex items-center justify-center text-caption">{leading}</span> : null}
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
});

/* ─── User footer block ─────────────────────────────────────────────────── */

type UserProps = {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
};

function User({ avatar, name, subtitle }: UserProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="shrink-0">{avatar}</div>
      <div className="flex flex-col min-w-0">
        <span className="text-system text-(--fg-neutral-prominent) truncate">{name}</span>
        {subtitle ? (
          <span className="text-caption text-(--fg-neutral-subtle) truncate">{subtitle}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const ComputerSidebar = Object.assign(Root, { Group, Item, User });
