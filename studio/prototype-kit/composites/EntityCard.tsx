/**
 * EntityCard — a single selectable/listed entity row-card.
 *
 * Matches the Figma "Cards" instance used across Connectors, Skills, and
 * Agent capability grids: a 72px-tall bordered card with a leading brand/icon
 * slot, a title (+ optional description), and an optional trailing status Tag
 * or action.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  [icon]  Gmail                    Connected    │   ← single-line (Connectors)
 *   └──────────────────────────────────────────────┘
 *   ┌──────────────────────────────────────────────┐
 *   │  [icon]  Prospect Research                     │   ← two-line (Skills)
 *   │          Pulls a company brief before any…     │
 *   └──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Bordered, radius `rounded-square` (Figma card radius ≈ 8.5px), 16px padding,
 *   12px gap between the icon slot and the text — the Figma "Cards" geometry.
 * - The leading `icon` renders in a fixed 40px slot. Pass a brand favicon
 *   (`<img>`) or an arcade icon element.
 * - `status` renders a trailing arcade `Tag` — pass the node directly
 *   (e.g. `<Tag intent="success">Connected</Tag>`). For a clickable card use
 *   `trailing` for a button/chevron instead.
 * - `description` is optional; when present the card grows to fit two lines and
 *   the text column stacks title over description.
 *
 * Slots:
 * - `icon` — leading brand/icon element (40px slot).
 * - `title` — entity name.
 * - `description` — optional supporting line (truncated to 2 lines).
 * - `status` / `trailing` — optional trailing node (Tag, button, chevron).
 *
 * @counterexample Do NOT add your own `border`/`rounded`/`p-4` — the card is a
 *   bordered, padded, rounded container already.
 * @counterexample Do NOT hardcode a green pill for "Connected". Use the arcade
 *   `<Tag intent="success">` as the `status` node.
 * @counterexample Do NOT wrap many EntityCards in your own flex/grid — use the
 *   `CardGrid` composite, which owns the 2-column layout and gutters.
 *
 * @tokens
 * | Element | Token |
 * | Card surface | `--surface-overlay` |
 * | Card border | `--stroke-neutral-subtle` |
 * | Title text | `--fg-neutral-prominent` |
 * | Description text | `--fg-neutral-subtle` |
 */
import { type ReactNode } from "react";

type EntityCardProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  trailing?: ReactNode;
};

export function EntityCard({
  icon,
  title,
  description,
  status,
  trailing,
}: EntityCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-square border border-(--stroke-neutral-subtle) bg-(--surface-overlay) p-4">
      {icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden">
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-medium text-(--fg-neutral-prominent)">
          {title}
        </span>
        {description && (
          <span className="line-clamp-2 text-body-small text-(--fg-neutral-subtle)">
            {description}
          </span>
        )}
      </div>
      {(status || trailing) && (
        <span className="flex shrink-0 items-center gap-2">
          {status}
          {trailing}
        </span>
      )}
    </div>
  );
}
