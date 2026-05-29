/**
 * ComputerHeader — top bar for a Computer / Agent Studio chat screen.
 *
 * Matches Figma node 152:5697 in the "Untitled" prototype file. Thin 48px
 * bar that sits directly above the chat body (no border — just the blank
 * surface behind it). Shape:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ [💬] Prepare marketting presentations  ⌄     [👤+]  [📑]   │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Left: a ChatBubbles icon + conversation title + chevron, rendered as a
 *   single borderless pill that looks like a dropdown affordance for
 *   switching/renaming the conversation.
 * - Right: a trailing action cluster (add collaborator, open canvas, etc.).
 *   Slot — caller decides what goes there.
 * - There is NO border below the header. The ChatInput / chat body sits
 *   directly beneath it against the same surface.
 *
 * Slots:
 * - `title` — the conversation title text (required).
 * - `icon` (optional) — leading icon next to the title. Defaults to the
 *   arcade `<ChatBubbles />` mark.
 * - `onTitleClick` (optional) — called when the title pill is clicked.
 *   Typically opens a rename/switch menu.
 * - `actions` (optional) — the trailing action cluster. Typically one or
 *   two `<IconButton />` components. When omitted, no trailing cluster
 *   renders.
 */
import type { ReactNode } from "react";
import {
  ChevronDownSmall,
  DotInRightWindow,
  IconButton,
  Menu,
  Pencil,
  MagnifyingGlass,
  TrashBin,
} from "@xorkavi/arcade-gen";

type ComputerHeaderProps = {
  title: ReactNode;
  /** Leading icon for the title pill. Pass to add one — by default the title
   *  renders without any icon, matching the colleague Computer prototype. */
  icon?: ReactNode;
  onTitleClick?: () => void;
  actions?: ReactNode;
  /**
   * Right-most action: the canvas / artefacts panel toggle. **Defaults to a
   *  built-in `DotInRightWindow` IconButton** so every Computer screen carries
   *  the canvas opener without the caller having to remember it. Pass `null`
   *  to suppress; pass your own IconButton to override (e.g. to wire it to
   *  your own panel state). Rendered AFTER the `actions` slot.
   */
  panelToggle?: ReactNode;
  /**
   * Conversation menu rendered when the chevron is clicked. **Defaults to a
   * Rename / Inspect Session / Delete menu** — pass `null` to suppress, pass a
   * custom `<Menu.Content />` body (or `<>` of `<Menu.Item>`s) to override.
   */
  conversationMenu?: ReactNode;
  /** Handlers for the default conversation menu items. */
  onRename?: () => void;
  onInspect?: () => void;
  onDelete?: () => void;
  /**
   * Optional secondary row rendered below the title pill — typically a row of
   * meta chips ("# Q3 Strategy", "Today", "1 related"). Caller renders the
   * chips; the header just provides the row.
   */
  meta?: ReactNode;
};

const PANEL_TOGGLE_UNSET = Symbol("PANEL_TOGGLE_UNSET");
const CONVERSATION_MENU_UNSET = Symbol("CONVERSATION_MENU_UNSET");

export function ComputerHeader({
  title,
  icon,
  onTitleClick,
  actions,
  panelToggle = PANEL_TOGGLE_UNSET as unknown as ReactNode,
  conversationMenu = CONVERSATION_MENU_UNSET as unknown as ReactNode,
  onRename,
  onInspect,
  onDelete,
  meta,
}: ComputerHeaderProps) {
  const resolvedPanelToggle =
    panelToggle === PANEL_TOGGLE_UNSET ? <DefaultPanelToggle /> : panelToggle;
  const resolvedMenu =
    conversationMenu === CONVERSATION_MENU_UNSET ? (
      <DefaultConversationMenu
        onRename={onRename}
        onInspect={onInspect}
        onDelete={onDelete}
      />
    ) : conversationMenu;
  const chevronButton = (
    <IconButton
      aria-label="Open conversation menu"
      variant="tertiary"
      size="sm"
      onClick={onTitleClick}
      className="text-(--fg-neutral-subtle)"
    >
      <ChevronDownSmall size={16} aria-hidden="true" />
    </IconButton>
  );
  return (
    <div className="flex flex-col shrink-0 px-4 pt-2 pb-1 gap-1">
      <div className="flex items-center justify-between gap-3 h-9">
        <div className="flex items-center gap-2 min-w-0 text-(--fg-neutral-prominent) text-body-medium">
          {icon ? (
            <span className="shrink-0 w-5 h-5 flex items-center justify-center text-(--fg-neutral-prominent)">
              {icon}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
          {resolvedMenu ? (
            <Menu.Root>
              <Menu.Trigger asChild>{chevronButton}</Menu.Trigger>
              <Menu.Content align="start" sideOffset={4}>
                {resolvedMenu}
              </Menu.Content>
            </Menu.Root>
          ) : (
            chevronButton
          )}
        </div>
        {actions || resolvedPanelToggle ? (
          <div className="shrink-0 flex items-center gap-1">
            {actions}
            {resolvedPanelToggle}
          </div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex items-center gap-2 pl-1 text-caption text-(--fg-neutral-subtle)">
          {meta}
        </div>
      ) : null}
    </div>
  );
}

function DefaultConversationMenu({
  onRename,
  onInspect,
  onDelete,
}: {
  onRename?: () => void;
  onInspect?: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <Menu.Item onSelect={onRename}>
        <span className="inline-flex items-center gap-2">
          <Pencil size={16} aria-hidden="true" />
          Rename
        </span>
      </Menu.Item>
      <Menu.Item onSelect={onInspect}>
        <span className="inline-flex items-center gap-2">
          <MagnifyingGlass size={16} aria-hidden="true" />
          Inspect Session
        </span>
      </Menu.Item>
      <Menu.Item onSelect={onDelete} className="text-(--fg-danger-prominent)">
        <span className="inline-flex items-center gap-2">
          <TrashBin size={16} aria-hidden="true" />
          Delete
        </span>
      </Menu.Item>
    </>
  );
}

function DefaultPanelToggle() {
  return (
    <IconButton
      aria-label="Open canvas"
      variant="tertiary"
      className="text-(--fg-neutral-prominent)"
    >
      <DotInRightWindow size={16} aria-hidden="true" />
    </IconButton>
  );
}
