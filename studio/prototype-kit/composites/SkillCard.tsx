/**
 * SkillCard — vertical capability/skill card for picker grids.
 *
 * Matches the Figma "Cards" / "Skill Card" used inside the Agent Capabilities
 * picker (AS-MCP, node 9793:16889): a 271×172 vertical card with an icon chip
 * and a trailing action/status in the top row, a title + 2-line description in
 * the middle, and a status footer (dot + label) at the bottom.
 *
 *   ┌───────────────────────────────┐
 *   │  ◇                        +    │  ← top row: icon chip + trailing action
 *   │                               │
 *   │  Notion                        │  ← title
 *   │  Your docs and wikis, finally  │  ← description (2 lines)
 *   │  findable.                     │
 *   │                               │
 *   │  ● Connected                   │  ← status footer (optional)
 *   └───────────────────────────────┘
 *
 * Intentional opinions:
 * - Vertical layout, radius `rounded-square-x2` (8px), 15px padding, 16px gap —
 *   the Figma card geometry. Distinct from `EntityCard` (the horizontal row
 *   card used on settings/connectors list pages).
 * - The `icon` sits in a 40px rounded chip. `action` is a trailing top-right
 *   slot (e.g. a tertiary "+" IconButton, or a selection checkbox).
 * - `status` renders the bottom dot + label row (e.g. ● Connected). Omit when
 *   the card isn't a connection.
 * - Description clamps to 2 lines so cards stay equal height in the grid.
 *
 * Slots:
 * - `icon` — leading icon element (40px chip).
 * - `action` — top-right trailing node (IconButton / checkbox).
 * - `title` / `description` — name + 2-line supporting text.
 * - `status` — bottom status node (e.g. `<CardStatus>Connected</CardStatus>`),
 *   or pass your own dot+label.
 *
 * @counterexample Do NOT use this for a settings list row — that's `EntityCard`
 *   (horizontal). This is the vertical picker/gallery card.
 * @counterexample Do NOT put the title in the top row with the icon. Title sits
 *   in the middle block, below the icon row (Figma layout).
 *
 * @tokens
 * | Element | Token |
 * | Card surface | `--surface-overlay` |
 * | Card border | `--stroke-neutral-subtle` |
 * | Icon chip bg | `--surface-shallow` |
 * | Title | `--fg-neutral-prominent` |
 * | Description / status | `--fg-neutral-subtle` |
 */
import { type ReactNode } from "react";

type SkillCardProps = {
  icon?: ReactNode;
  action?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
};

export function SkillCard({
  icon,
  action,
  title,
  description,
  status,
}: SkillCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-square-x2 border border-(--stroke-neutral-subtle) bg-(--surface-overlay) p-[15px]">
      <div className="flex items-start justify-between">
        {icon && (
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-(--surface-shallow)">
            {icon}
          </span>
        )}
        {action && <span className="shrink-0">{action}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-body-medium-bold text-(--fg-neutral-prominent)">
          {title}
        </span>
        {description && (
          <span className="line-clamp-2 text-body-small text-(--fg-neutral-subtle)">
            {description}
          </span>
        )}
      </div>
      {status && (
        <span className="flex items-center gap-1.5 text-body-small text-(--fg-neutral-subtle)">
          {status}
        </span>
      )}
    </div>
  );
}
