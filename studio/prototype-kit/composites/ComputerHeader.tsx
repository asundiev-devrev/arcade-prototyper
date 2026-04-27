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
import { ChatBubbles, ChevronDownSmall } from "@xorkavi/arcade-gen";

type ComputerHeaderProps = {
  title: ReactNode;
  icon?: ReactNode;
  onTitleClick?: () => void;
  actions?: ReactNode;
};

export function ComputerHeader({ title, icon, onTitleClick, actions }: ComputerHeaderProps) {
  return (
    <div className="flex items-center justify-between h-12 shrink-0 px-4 gap-3">
      <button
        type="button"
        onClick={onTitleClick}
        className="flex items-center gap-2 min-w-0 py-1 px-1.5 -mx-1.5 rounded-square hover:bg-(--control-bg-neutral-subtle-hover) text-(--fg-neutral-prominent) text-body-medium"
      >
        <span className="shrink-0 w-4 h-4 flex items-center justify-center text-(--fg-neutral-prominent)">
          {icon ?? <ChatBubbles size={16} />}
        </span>
        <span className="truncate">{title}</span>
        <ChevronDownSmall className="shrink-0 text-(--fg-neutral-subtle)" />
      </button>
      {actions ? (
        <div className="shrink-0 flex items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
