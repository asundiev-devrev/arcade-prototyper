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
import { forwardRef, createContext, useContext, type ReactNode } from "react";
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
  ThreeDotsHorizontal,
  DotInLeftWindow,
} from "@xorkavi/arcade-gen";

/* ─── Context for canvas-aware collapse threshold ──────────────────────── */

const SidebarCtx = createContext(false);

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = {
  workspace?: ReactNode;
  primaryAction?: ReactNode;
  historyAction?: ReactNode;
  showWindowChrome?: boolean;
  agentStudioLink?: ReactNode;
  user?: ReactNode;
  footerAction?: ReactNode;
  /** Optional pinned row rendered above the first group — e.g. a "Today's
   *  Daily Digest" banner on the Computer web surface. Pass a
   *  `<ComputerSidebar.Banner />` here. */
  banner?: ReactNode;
  /** When true, the sidebar renders as a 64px icon-rail (labels hidden, New
   *  Chat → circle). A container query ALSO forces the rail below ~600px
   *  regardless of this prop, so a width-forced collapse auto-restores. */
  collapsed?: boolean;
  /** Callback fired when the user clicks the window-chrome collapse toggle. */
  onToggleCollapse?: () => void;
  /** When the canvas is docked, collapse to the rail earlier (at 900px container
   *  width instead of 600) — the docked canvas steals horizontal room. */
  canvasOpen?: boolean;
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
  banner,
  collapsed = false,
  onToggleCollapse,
  canvasOpen = false,
  children,
}: RootProps) {
  // The primary action row (New Chat + history) is Computer's defining feature.
  // Render defaults when the caller omits both props; render nothing only if
  // the caller explicitly opts out with `primaryAction={null}`.
  const primary =
    (primaryAction as unknown) === ACTION_ROW_UNSET ? <DefaultPrimaryAction /> : primaryAction;
  const history =
    (historyAction as unknown) === ACTION_ROW_UNSET ? <DefaultHistoryAction /> : historyAction;
  const hasActionRow = primary != null || history != null;
  const agentStudio =
    (agentStudioLink as unknown) === ACTION_ROW_UNSET ? <DefaultAgentStudioLink /> : agentStudioLink;

  return (
    <SidebarCtx.Provider value={canvasOpen}>
      <div
        data-collapsed={collapsed ? "true" : undefined}
        className={[
          "group/sidebar flex flex-col h-full shrink-0 bg-(--surface-overlay) border-r border-(--stroke-neutral-subtle)",
          "transition-[width] duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] overflow-hidden",
          collapsed ? "w-16" : "w-64",
          // Width-forced rail: when the container is narrow, force 64px even if
          // not React-collapsed. THRESHOLD_NO_CANVAS = 600.
          "@max-[600px]:w-16",
          canvasOpen ? "@max-[900px]:w-16" : "",
        ].join(" ")}
      >
        {showWindowChrome ? <WindowChrome onToggle={onToggleCollapse} /> : null}

        {workspace ? <Brand label={workspace} /> : null}

        {hasActionRow ? (
          <div className={[
            "flex items-center gap-2 px-3 pt-2 pb-3",
            "group-data-[collapsed=true]/sidebar:flex-col group-data-[collapsed=true]/sidebar:items-center group-data-[collapsed=true]/sidebar:gap-1.5 group-data-[collapsed=true]/sidebar:px-0",
            "@max-[600px]:flex-col @max-[600px]:items-center @max-[600px]:gap-1.5 @max-[600px]:px-0",
            canvasOpen ? "@max-[900px]:flex-col @max-[900px]:items-center @max-[900px]:gap-1.5 @max-[900px]:px-0" : "",
          ].join(" ")}>
            {primary}
            {history}
          </div>
        ) : null}

        <nav className="flex-1 min-h-0 overflow-auto">
          {banner ? <div className="px-2 pt-2">{banner}</div> : null}
          {children}
        </nav>

        {agentStudio ? <div className={[
          "px-2 pb-1 shrink-0",
          "group-data-[collapsed=true]/sidebar:px-0 @max-[600px]:px-0",
          canvasOpen ? "@max-[900px]:px-0" : "",
        ].join(" ")}>{agentStudio}</div> : null}

        {user ? (
          <div className={[
            "flex items-center gap-2 px-2 py-2 shrink-0 group-data-[collapsed=true]/sidebar:justify-center",
          ].join(" ")}>
            <div className="flex-1 min-w-0 px-1">{user}</div>
            {footerAction ? <div className={[
              "shrink-0 group-data-[collapsed=true]/sidebar:hidden",
              "@max-[600px]:hidden",
              canvasOpen ? "@max-[900px]:hidden" : "",
            ].join(" ")}>{footerAction}</div> : null}
          </div>
        ) : null}
      </div>
    </SidebarCtx.Provider>
  );
}

/* ─── Window chrome ─────────────────────────────────────────────────────── */

function WindowChrome({ onToggle }: { onToggle?: () => void }) {
  const canvasOpen = useContext(SidebarCtx);
  return (
    <div className={[
      "flex items-center h-11 shrink-0 px-3 gap-2",
      "group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0",
      "@max-[600px]:justify-center @max-[600px]:px-0",
      canvasOpen ? "@max-[900px]:justify-center @max-[900px]:px-0" : "",
    ].join(" ")}>
      <span className={[
        "flex",
        "group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")}>
        <TrafficLights />
      </span>
      <IconButton
        aria-label="Toggle sidebar"
        variant="tertiary"
        className="text-(--fg-neutral-prominent)"
        onClick={onToggle}
      >
        <DotInLeftWindow size={16} aria-hidden="true" />
      </IconButton>
      <div className={[
        "flex-1",
        "group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")} />
      <div className={[
        "flex items-center gap-0.5 text-(--fg-neutral-prominent) group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")}>
        <IconButton aria-label="Back" variant="tertiary" size="sm">
          <ChevronLeftSmall size={16} />
        </IconButton>
        <IconButton aria-label="Forward" variant="tertiary" size="sm">
          <ChevronRightSmall size={16} />
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
  const canvasOpen = useContext(SidebarCtx);
  return (
    <Button variant="secondary" size="lg" className={[
      "flex-1 justify-center group-data-[collapsed=true]/sidebar:flex-none group-data-[collapsed=true]/sidebar:w-10 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:rounded-full",
      "@max-[600px]:flex-none @max-[600px]:w-10 @max-[600px]:px-0 @max-[600px]:justify-center @max-[600px]:rounded-full",
      canvasOpen ? "@max-[900px]:flex-none @max-[900px]:w-10 @max-[900px]:px-0 @max-[900px]:justify-center @max-[900px]:rounded-full" : "",
    ].join(" ")}>
      <span className="inline-flex items-center gap-2">
        <PlusInChatBubble size={16} />
        <span className={[
          "group-data-[collapsed=true]/sidebar:hidden",
          "@max-[600px]:hidden",
          canvasOpen ? "@max-[900px]:hidden" : "",
        ].join(" ")}>New Chat</span>
      </span>
    </Button>
  );
}

function DefaultHistoryAction() {
  return (
    <IconButton aria-label="History" variant="secondary" size="lg">
      <Clock size={20} />
    </IconButton>
  );
}

function DefaultAgentStudioLink() {
  const canvasOpen = useContext(SidebarCtx);
  return (
    <button
      type="button"
      className={[
        "flex items-center gap-2.5 w-full px-3 py-1.5 rounded-square text-body text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)",
        "group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0",
        "@max-[600px]:justify-center @max-[600px]:px-0",
        canvasOpen ? "@max-[900px]:justify-center @max-[900px]:px-0" : "",
      ].join(" ")}
    >
      <span className="shrink-0 w-5 h-5 flex items-center justify-center">
        <AgentStudio size={16} />
      </span>
      <span className={[
        "flex-1 text-left",
        "group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")}>Agent Studio</span>
    </button>
  );
}

/* ─── Group ─────────────────────────────────────────────────────────────── */

type GroupProps = {
  title?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  /** When true, the ENTIRE group (title + items) hides in the icon-rail —
   *  not just the title. Used for Sessions, which collapse away in the rail
   *  leaving only the Chats avatar stack. */
  hideOnCollapse?: boolean;
};

function Group({ title, trailing, children, hideOnCollapse = false }: GroupProps) {
  const canvasOpen = useContext(SidebarCtx);
  return (
    <div className={[
      "pt-1.5 pb-1",
      hideOnCollapse ? "group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden" : "",
      hideOnCollapse && canvasOpen ? "@max-[900px]:hidden" : "",
    ].join(" ")}>
      {title || trailing ? (
        <div className={[
          "flex items-center justify-between px-3 py-2 mx-1 rounded-square hover:bg-(--bg-neutral-soft) transition-colors group-data-[collapsed=true]/sidebar:hidden",
          "@max-[600px]:hidden",
          canvasOpen ? "@max-[900px]:hidden" : "",
        ].join(" ")}>
          <span className="text-caption text-(--fg-neutral-subtle)">
            {title}
          </span>
          {trailing ?? (
            <button
              type="button"
              aria-label="Add"
              className="text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) w-[22px] h-[22px] flex items-center justify-center rounded-square hover:bg-(--control-bg-neutral-subtle-hover)"
            >
              <PlusSmall size={14} />
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
  /** Visual emphasis. Use "strong" for unread chat/session names — renders
   *  prominent fg colour and semibold weight even when inactive. Default
   *  "normal" uses the subtle fg colour for read items. */
  emphasis?: "normal" | "strong";
  onClick?: () => void;
  /** When provided, a three-dots icon button appears on hover (right side)
   *  and the existing `trailing` content hides while hovered. Click invokes
   *  the handler — the caller is responsible for opening any menu UI. */
  onMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
  { leading, trailing, children, active, emphasis = "normal", onClick, onMenu },
  ref,
) {
  const canvasOpen = useContext(SidebarCtx);
  const strong = active || emphasis === "strong";
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "group/item flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-square-x2 text-body cursor-pointer select-none transition-colors",
        active
          ? "bg-(--control-bg-neutral-subtle-active)"
          : "hover:bg-(--bg-neutral-soft)",
        strong ? "text-(--fg-neutral-prominent) font-semibold" : "text-(--fg-neutral-prominent)",
        "group-data-[collapsed=true]/sidebar:justify-center",
        "@max-[600px]:justify-center",
        canvasOpen ? "@max-[900px]:justify-center" : "",
      ].join(" ")}
    >
      {leading ? <span className="shrink-0 w-5 h-5 flex items-center justify-center text-(--fg-neutral-subtle)">{leading}</span> : null}
      <span className={[
        "min-w-0 flex-1 truncate group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")}>{children}</span>
      {onMenu || trailing ? (
        <span className="shrink-0 flex items-center gap-1.5">
          {trailing ? (
            <span className={onMenu ? "group-hover/item:hidden" : undefined}>{trailing}</span>
          ) : null}
          {onMenu ? (
            <button
              type="button"
              aria-label="More"
              onClick={(e) => {
                e.stopPropagation();
                onMenu(e);
              }}
              className="hidden group-hover/item:flex items-center justify-center w-[22px] h-[22px] rounded-square text-(--fg-neutral-subtle) hover:bg-(--bg-neutral-subtle) hover:text-(--fg-neutral-prominent)"
            >
              <ThreeDotsHorizontal size={14} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
});

/* ─── User footer block ─────────────────────────────────────────────────── */

type UserProps = {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  /** Render a green presence dot bottom-right of the avatar. Default true. */
  presence?: boolean;
};

function User({ avatar, name, subtitle, presence = true }: UserProps) {
  const canvasOpen = useContext(SidebarCtx);
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="relative shrink-0">
        {avatar}
        {presence ? (
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-circle bg-(--bg-success-prominent) ring-2 ring-(--surface-shallow)"
            aria-label="Online"
          />
        ) : null}
      </div>
      <div className={[
        "flex flex-col min-w-0",
        "group-data-[collapsed=true]/sidebar:hidden",
        "@max-[600px]:hidden",
        canvasOpen ? "@max-[900px]:hidden" : "",
      ].join(" ")}>
        <span className="text-body-medium text-(--fg-neutral-prominent) truncate">{name}</span>
        {subtitle ? (
          <span className="text-system text-(--fg-neutral-subtle) truncate">{subtitle}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Banner (pinned row above the first group) ─────────────────────────── */
/**
 * A distinct "pinned" row rendered via the Root `banner` slot. Used on the
 * Computer web surface for the "Today's Daily Digest by …" card that sits
 * above the saved-chats list. Two lines: a bold label (primary) and an
 * optional muted subtitle, inside a soft-surface pill with no leading icon.
 */
type BannerProps = {
  children: ReactNode;
  subtitle?: ReactNode;
  active?: boolean;
  onClick?: () => void;
};

function Banner({ children, subtitle, active, onClick }: BannerProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "flex flex-col gap-0.5 px-3 py-2 rounded-square cursor-pointer select-none",
        active
          ? "bg-(--control-bg-neutral-subtle-active)"
          : "bg-(--bg-neutral-soft) hover:bg-(--control-bg-neutral-subtle-hover)",
      ].join(" ")}
    >
      <span className="text-system text-(--fg-neutral-prominent) truncate">
        {children}
      </span>
      {subtitle ? (
        <span className="text-caption text-(--fg-neutral-subtle) truncate">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

// Qualify the sub-part names so the fiber-walk export reports them as
// "ComputerSidebar.Item" / "ComputerSidebar.User" (not bare "Item"/"User",
// which collide across composites and miss their Figma mappings). See
// studio/src/export/figma/componentEntries.ts.
Item.displayName = "ComputerSidebar.Item";
(User as { displayName?: string }).displayName = "ComputerSidebar.User";

export const ComputerSidebar = Object.assign(Root, { Group, Item, User, Banner });
