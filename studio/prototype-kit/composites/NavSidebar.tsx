/**
 * NavSidebar — DevRev navigation sidebar composite.
 *
 * Matches Figma "Option_2_Interim_reduced(June)" (node 10:3508) — the current
 * DevRev SoR left nav. Replaces the bare `arcade.Sidebar` for prototype use.
 * Lives BELOW the window chrome in AppShell, so it owns its own top toolbar
 * (collapse / ⌘K search / add) but NOT the mac traffic lights.
 *
 * Default chrome (rendered top→bottom):
 * - Toolbar (top): collapse IconButton + ⌘K search field + "add" IconButton.
 * - Computer pill: a full-width muted rounded button with the "computer"
 *   wordmark — the product switcher.
 * - Nav body (scrollable): NavSidebar.Section + NavSidebar.Item children.
 * - User footer (bottom): avatar + status dot + a chat FAB.
 *
 * Intentional opinions:
 * - Surface is --surface-shallow so the sidebar reads as a muted panel.
 * - Group labels (Work / Teams / Views) render as small, 60%-opacity chips
 *   (text-system-small), matching the Figma "_Group Label".
 * - Items are 28px rows, padded px-4, label in --text-interactive-navigation-
 *   resting; the active/hover state is a subtle neutral wash (NOT a blue pill).
 * - Items support a leading icon, a trailing slot (count Tag, or a chevron for
 *   expandable groups), and `indent` for nested rows.
 *
 * Slots (all optional — sensible defaults render the full Figma design):
 * - `workspace` — kept for back-compat; when set WITHOUT a custom `pill`, the
 *   computer pill shows this label instead of the "computer" wordmark.
 * - `toolbar` — replace the default top toolbar. Pass `false` to hide it.
 * - `pill` — replace the default computer pill. Pass `false` to hide it.
 * - `header` — legacy: a custom node ABOVE the toolbar (e.g.
 *   `<NavSidebar.BackHeader>` for the Settings "← Title" chrome). When set,
 *   the default toolbar + pill are suppressed (the Settings chrome owns the top).
 * - `footer` — replace the default user footer. Pass `false` to hide it.
 *   `<NavSidebar.AppFooter>` is still available for the "Agent Studio" chrome.
 * - `children` — NavSidebar.Section / NavSidebar.Item tree.
 *
 * @counterexample When Figma shows a chat-style sidebar (with "New Chat" and chat history), use `ComputerSidebar` instead. That composite owns its own window chrome; do NOT also render a `TitleBar` alongside it.
 * @counterexample Never use `arcade.Sidebar` directly for the main app sidebar — it's the bare primitive. `NavSidebar` adds the toolbar, computer pill, user footer, and correct tokens.
 * @counterexample To hide a default slot, pass `false` (e.g. `toolbar={false}`), NOT an empty string. Composites check for `false` explicitly; other falsy values still render the default.
 */
import { forwardRef, type ReactNode } from "react";
import {
  ChevronDownSmall,
  ArrowLeftSmall,
  AgentStudio,
  DotInLeftWindow,
  IconButton,
  MagnifyingGlass,
  PlusLarge,
  KeyboardShortcut,
  Avatar,
  ChatBubbles,
} from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type NavSidebarRootProps = {
  /** Back-compat: when set without a custom `pill`, the computer pill shows
   *  this label instead of the "computer" wordmark. */
  workspace?: ReactNode;
  /** Custom top toolbar, or `false` to hide it. Defaults to the
   *  collapse / ⌘K search / add toolbar. */
  toolbar?: ReactNode | false;
  /** Custom product-switcher pill, or `false` to hide it. Defaults to the
   *  "computer" wordmark pill. */
  pill?: ReactNode | false;
  /** Legacy: a custom node rendered ABOVE everything, replacing the default
   *  toolbar + pill. Use `<NavSidebar.BackHeader>` for the Settings chrome. */
  header?: ReactNode;
  /** Custom footer, or `false` to hide it. Defaults to the avatar + chat
   *  user footer. */
  footer?: ReactNode | false;
  children?: ReactNode;
};

function Root({
  workspace,
  toolbar,
  pill,
  header,
  footer,
  children,
}: NavSidebarRootProps) {
  // A custom `header` (e.g. BackHeader) owns the top — suppress the default
  // toolbar + pill so the Settings chrome isn't doubled up.
  const topNode = header ?? (
    <>
      {toolbar === false ? null : (toolbar ?? <Toolbar />)}
      {pill === false ? null : (pill ?? <ComputerPill label={workspace} />)}
    </>
  );
  const footerNode = footer === false ? null : (footer ?? <UserFooter />);
  return (
    <div className="flex flex-col h-full w-full bg-(--surface-shallow)">
      {topNode}
      <nav className="flex-1 min-h-0 overflow-auto">{children}</nav>
      {footerNode}
    </div>
  );
}

/* ─── Toolbar (collapse / search / add) ─────────────────────────────────── */

function Toolbar({
  onToggle,
  onAdd,
}: {
  onToggle?: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-1 px-3 py-2.5 shrink-0">
      <div className="flex flex-1 min-w-0 items-center gap-1">
        <IconButton
          aria-label="Collapse sidebar"
          variant="tertiary"
          onClick={onToggle}
        >
          <DotInLeftWindow size={16} />
        </IconButton>
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-1.5 h-8 px-2 rounded-square text-(--fg-neutral-medium) hover:bg-(--control-bg-neutral-subtle-hover)"
        >
          <MagnifyingGlass size={16} className="shrink-0 text-(--fg-neutral-subtle)" />
          <KeyboardShortcut keys={["⌘", "K"]} />
        </button>
      </div>
      <IconButton aria-label="Add" variant="secondary" onClick={onAdd}>
        <PlusLarge size={16} />
      </IconButton>
    </div>
  );
}

/* ─── Computer pill (product switcher) ──────────────────────────────────── */

function ComputerPill({
  label,
  onClick,
}: {
  /** Defaults to the "computer" wordmark. */
  label?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="px-3 shrink-0">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-center gap-1.5 h-9 px-2 rounded-[20px] bg-(--bg-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) text-(--fg-neutral-prominent) text-body-medium"
      >
        {label ?? (
          <span className="lowercase tracking-tight">
            comp<span className="font-mono">u</span>ter
          </span>
        )}
      </button>
    </div>
  );
}

/* ─── Settings-style header & footer (slottable variants) ───────────────── */

function TrafficLights() {
  return (
    <span className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
      <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
      <span className="h-3 w-3 rounded-full bg-[#28C840]" />
    </span>
  );
}

function BackHeader({
  title,
  onBack,
  windowControls = false,
}: {
  title: ReactNode;
  onBack?: () => void;
  /** When true, render the mac window controls + collapse row above the title
   *  (the sidebar spans the full window height including the top-left). */
  windowControls?: boolean;
}) {
  return (
    <div className="shrink-0">
      {windowControls && (
        <div className="flex h-[52px] items-center justify-between px-4">
          <TrafficLights />
          <span className="flex h-6 w-6 items-center justify-center rounded-square text-(--fg-neutral-medium)">
            <DotInLeftWindow size={18} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 h-11">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-6 w-6 items-center justify-center rounded-square text-(--fg-neutral-medium) hover:bg-(--control-bg-neutral-subtle-hover)"
        >
          <ArrowLeftSmall size={16} />
        </button>
        <span className="text-body-large-bold text-(--fg-neutral-prominent)">
          {title}
        </span>
      </div>
    </div>
  );
}

function AppFooter({
  label = "Agent Studio",
  avatar,
  trailing,
}: {
  label?: ReactNode;
  /** User avatar shown in a bottom row. When set, the footer renders the
   *  Agent Studio link on one row and an avatar + `trailing` row below it. */
  avatar?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="shrink-0 pb-2">
      <div className="flex items-center gap-2 h-10 px-3">
        <AgentStudio size={16} className="text-(--fg-neutral-medium)" />
        <span className="flex-1 text-system text-(--fg-neutral-medium)">{label}</span>
        {!avatar && trailing}
      </div>
      {avatar && (
        <div className="flex items-center justify-between px-3 pt-1">
          {avatar}
          {trailing}
        </div>
      )}
    </div>
  );
}

/* ─── User footer (avatar + chat FAB) ───────────────────────────────────── */

function UserFooter({
  name = "Ada Lovelace",
  initial = "A",
  onChat,
}: {
  name?: string;
  initial?: string;
  onChat?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-5 pt-2 shrink-0">
      <span className="relative shrink-0">
        <Avatar name={name} size="md" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#28C840] ring-2 ring-(--surface-shallow)" />
      </span>
      <span className="flex-1" aria-hidden />
      <button
        type="button"
        onClick={onChat}
        aria-label="Open chat"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#714AF0] text-white hover:opacity-90"
      >
        <ChatBubbles size={16} />
      </button>
      <span className="sr-only">{initial}</span>
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
    <div className="flex flex-col gap-0.5 py-1.5 w-full">
      {title && (
        // Chip-style group label (Figma "_Group Label"): small, 60% opacity,
        // padded so it aligns over the item rows.
        <div className="flex items-center h-5 px-2.5">
          <span className="px-1.5 py-0.5 rounded text-system-small text-(--fg-neutral-prominent) opacity-60 whitespace-nowrap">
            {title}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

type ItemProps = {
  /** Item label. Legacy callers pass it as `children`; new callers may use
   *  `label` with `icon` / `trailing`. Both are supported. */
  children?: ReactNode;
  label?: ReactNode;
  /** Leading icon slot — typically a 16px arcade icon (rendered in a 20px box
   *  to match the Figma "Leading" slot). */
  icon?: ReactNode;
  /** Trailing content — counts (`<Tag intent="info">14</Tag>`), a chevron for
   *  expandable groups, or shortcuts. Pushed to the row's right edge. */
  trailing?: ReactNode;
  /** Nest the item under its parent. Applies extra left padding so child
   *  items align under a section/parent item. */
  indent?: boolean;
  active?: boolean;
  onClick?: () => void;
};

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
  { children, label, icon, trailing, indent, active, onClick },
  ref,
) {
  // Accept either `label` (new API) or `children` (legacy). `label` wins.
  const body = label ?? children;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 h-7 rounded-square cursor-pointer select-none",
        "text-[13px] leading-4 tracking-[0.1px]",
        indent ? "pl-12 pr-4" : "px-4",
        active
          ? "bg-(--bg-neutral-subtle) text-(--fg-neutral-prominent) font-medium"
          : "text-(--fg-neutral-medium) hover:bg-(--control-bg-neutral-subtle-hover) hover:text-(--fg-neutral-prominent)",
      ].join(" ")}
    >
      {icon ? (
        <span
          aria-hidden
          className={[
            "inline-flex items-center justify-center shrink-0 size-5",
            active ? "" : "text-(--fg-neutral-subtle)",
          ].join(" ")}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 min-w-0 truncate">{body}</span>
      {trailing != null ? (
        <span className="flex items-center justify-center shrink-0 w-7 h-5">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

/* ─── Convenience: expandable chevron for an Item's trailing slot ───────── */

function ExpandChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <ChevronDownSmall
      size={16}
      className={[
        "text-(--fg-neutral-subtle) transition-transform",
        expanded ? "" : "-rotate-90",
      ].join(" ")}
    />
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const NavSidebar = Object.assign(Root, {
  Section,
  Item,
  Toolbar,
  ComputerPill,
  UserFooter,
  ExpandChevron,
  BackHeader,
  AppFooter,
});
