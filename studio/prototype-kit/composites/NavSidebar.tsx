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
 * - Nav body (scrollable): the canonical DevRev nav (Work / Teams / Views +
 *   Explore) by default, or NavSidebar.Section + NavSidebar.Item children if
 *   you pass your own tree.
 * - User footer (bottom): avatar + status dot + a chat FAB.
 *
 * IMPORTANT: `<NavSidebar />` with NO children renders the full standard
 * DevRev nav out of the box — prefer this. Only pass Section/Item children
 * when the frame genuinely needs a DIFFERENT set of nav items. Do NOT
 * hand-author the standard Work/Teams/Views items; you'll just reproduce the
 * default less accurately.
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
 * - `workspace` — accepted for back-compat but IGNORED. The pill is the
 *   "computer" product switcher and always shows the computer wordmark; it is
 *   not a workspace-name label. (Pass a custom `pill` to change the switcher.)
 * - `toolbar` — replace the default top toolbar. Pass `false` to hide it.
 * - `pill` — replace the default computer pill. Pass `false` to hide it.
 * - `header` — legacy: a custom node ABOVE the toolbar (e.g.
 *   `<NavSidebar.BackHeader>` for the Settings "← Title" chrome). When set,
 *   the default toolbar + pill are suppressed (the Settings chrome owns the top).
 * - `footer` — replace the default user footer. Pass `false` to hide it.
 *   `<NavSidebar.AppFooter>` is still available for the "Agent Studio" chrome.
 * - `children` — OPTIONAL custom NavSidebar.Section / NavSidebar.Item tree.
 *   Omit entirely to get the standard DevRev nav (Work / Teams / Views +
 *   Explore). Only provide children for a genuinely different item set.
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
  Computer,
  Placeholder,
  Avatar,
  ChatBubbles,
  Bell,
  Document,
  TwoHumanSilhouettes,
  Window,
  MagnifyingGlassInSquare,
} from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type NavSidebarRootProps = {
  /** Accepted for back-compat but IGNORED — the pill always shows the
   *  "computer" wordmark. Use `pill` to replace the switcher. */
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
  // `workspace` is accepted for back-compat but intentionally ignored: the
  // pill is the "computer" product switcher and always shows the computer
  // wordmark, never a workspace name. (Older callers passed workspace="DevRev",
  // which previously — and wrongly — replaced the logo with plain text.)
  void workspace;
  const topNode = header ?? (
    <>
      {toolbar === false ? null : (toolbar ?? <Toolbar />)}
      {pill === false ? null : (pill ?? <ComputerPill />)}
    </>
  );
  const footerNode = footer === false ? null : (footer ?? <UserFooter />);
  // Bake the canonical DevRev nav as the default. A prototype almost always
  // wants the real Work / Teams / Views + Explore tree, and asking the
  // generator to author it every time produced random, off-design items. So
  // `<NavSidebar />` with no children renders the exact Figma nav; pass
  // Section/Item children only when a frame genuinely needs a custom tree.
  const usingDefault = children == null;
  const body = children ?? <DefaultNav />;
  return (
    <div className="flex flex-col h-full w-full bg-(--surface-shallow)">
      {topNode}
      <nav className="flex-1 min-h-0 overflow-auto">{body}</nav>
      {/* The default nav pins "Explore" to the bottom (above the footer),
          separated from the scrollable Work/Teams/Views list — per Figma. */}
      {usingDefault && <DefaultBottomNav />}
      {footerNode}
    </div>
  );
}

/* ─── Default nav (canonical DevRev SoR tree, Figma 10:3508) ─────────────── */

/** The standard DevRev left-nav contents, rendered when NavSidebar is given
 *  no children. Matches the Figma: Work / Teams (expandable Foundations with
 *  sub-items) / Views, plus a standalone Explore. */
function DefaultNav() {
  return (
    <>
      <Section title="Work">
        <Item icon={<Bell size={16} />} label="Updates" />
        <Item icon={<Document size={16} />} label="My tasks" />
      </Section>
      <Section title="Teams">
        <Item
          icon={<TwoHumanSilhouettes size={16} />}
          label="Foundations"
          trailing={<ExpandChevron expanded />}
        />
        <Item label="Lobby" indent />
        <Item label="Issues" indent active />
        <Item label="Roadmap" indent />
        <Item label="Sprints" indent />
        <Item
          icon={<TwoHumanSilhouettes size={16} />}
          label="Experience Foundations"
          trailing={<ExpandChevron />}
        />
      </Section>
      <Section title="Views">
        <Item icon={<Window size={16} />} label="Trails" />
        <Item icon={<Window size={16} />} label="Now, next, later" />
      </Section>
    </>
  );
}

/** Bottom-pinned nav row(s) for the default nav — "Explore" sits above the
 *  footer, separated from the scrollable list, per Figma. No horizontal
 *  padding on the wrapper: Section item rows have none either (the Item's own
 *  px-4 sets the indent), so this keeps Explore flush-aligned with them. */
function DefaultBottomNav() {
  return (
    <div className="shrink-0 pb-1">
      <Item icon={<MagnifyingGlassInSquare size={16} />} label="Explore" />
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
      {/* Left cluster hugs its content (collapse + search). It must NOT take
          flex-1, or the search button's hover background stretches the full
          sidebar width — the design's search is auto-width. */}
      <div className="flex items-center gap-1 min-w-0">
        <IconButton
          aria-label="Collapse sidebar"
          variant="tertiary"
          onClick={onToggle}
        >
          <DotInLeftWindow size={16} />
        </IconButton>
        <button
          type="button"
          aria-label="Search"
          // Auto-width (no flex-1): the hover wash only covers the icon + ⌘K.
          className="inline-flex items-center gap-2 h-8 px-2 rounded-square text-(--fg-neutral-medium) hover:bg-(--control-bg-neutral-subtle-hover)"
        >
          {/* Full-weight search icon in the medium fg — the design's magnifier
              reads clearly, not the faint subtle token. */}
          <MagnifyingGlass size={16} className="shrink-0 text-(--fg-neutral-medium)" />
          {/* Plain "⌘K" hint, NOT the KeyboardShortcut badge (which renders
              "⌘ + K" with a separator the design doesn't use). */}
          <span className="text-system text-(--fg-neutral-subtle)">⌘K</span>
        </button>
      </div>
      {/* Secondary "add" button: the design gives it a soft neutral fill
          (Figma BG/Neutral/Soft), not the near-invisible default. */}
      <IconButton
        aria-label="Add"
        variant="secondary"
        onClick={onAdd}
        className="bg-(--bg-neutral-soft) hover:bg-(--control-bg-neutral-subtle-hover)"
      >
        <PlusLarge size={16} />
      </IconButton>
    </div>
  );
}

/* ─── Computer pill (product switcher) ──────────────────────────────────── */

function ComputerPill({
  onClick,
}: {
  onClick?: () => void;
}) {
  return (
    <div className="px-3 shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-label="computer"
        // Figma pill fill is a LIGHT neutral wash (BG/Neutral/Soft). The
        // kit's --bg-neutral-subtle reads too dark here, so use --bg-neutral-soft.
        className="flex w-full items-center justify-center h-9 px-2 rounded-[20px] bg-(--bg-neutral-soft) hover:bg-(--control-bg-neutral-subtle-hover) text-(--fg-neutral-prominent)"
      >
        {/* The "computer" wordmark: "comp" + the Computer glyph as the "u" +
            "ter", matching the Figma logo. This is the product switcher and
            ALWAYS shows the computer brand — it is not a workspace-name label. */}
        <ComputerWordmark />
      </button>
    </div>
  );
}

/** The "comp—ter" wordmark with the Computer glyph standing in for the "u". */
function ComputerWordmark() {
  return (
    <span className="inline-flex items-baseline text-[15px] font-medium tracking-tight text-(--fg-neutral-prominent)">
      comp
      <Computer size={13} className="self-center mx-px text-(--fg-neutral-prominent)" />
      ter
    </span>
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
  /** Alias of `title`. The generator sometimes emits `label` on a Section;
   *  accept both so the group heading never silently disappears. */
  label?: ReactNode;
  children: ReactNode;
};

function Section({ title, label, children }: SectionProps) {
  const heading = title ?? label;
  return (
    <div className="flex flex-col gap-0.5 py-1.5 w-full">
      {heading && (
        // Chip-style group label (Figma "_Group Label"): small, 60% opacity,
        // padded so it aligns over the item rows.
        <div className="flex items-center h-5 px-2.5">
          <span className="px-1.5 py-0.5 rounded text-system-small text-(--fg-neutral-prominent) opacity-60 whitespace-nowrap">
            {heading}
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
  /** Nest the item under its parent (e.g. Lobby/Issues under a team). Indents
   *  the row so its TEXT aligns under the parent's text. Per the design, nested
   *  items are icon-less — pass no `icon` and none is reserved. */
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
  // Nested items are icon-less by design (their text aligns under the parent's
  // text). Top-level items always show a leading icon; if the generator passes
  // icon={null}, fall back to a neutral placeholder so the row isn't misaligned.
  const leadingIcon = indent ? null : (icon ?? <Placeholder size={16} />);
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
        // Top-level: px-4 + 20px icon + 6px gap puts text at 42px. Nested items
        // have no icon, so pad to 42px directly to align their text under the
        // parent's text (the design's nested rows sit at that same x).
        indent ? "pl-[42px] pr-4" : "px-4",
        active
          ? "bg-(--bg-neutral-subtle) text-(--fg-neutral-prominent) font-medium"
          : "text-(--fg-neutral-medium) hover:bg-(--control-bg-neutral-subtle-hover) hover:text-(--fg-neutral-prominent)",
      ].join(" ")}
    >
      {leadingIcon ? (
        <span
          aria-hidden
          className={[
            "inline-flex items-center justify-center shrink-0 size-5",
            active ? "" : "text-(--fg-neutral-subtle)",
          ].join(" ")}
        >
          {leadingIcon}
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
