/**
 * CapabilitySection — a titled capability group on the agent builder page.
 *
 * Matches the Figma "Capabilities" sections on the Agent creation page
 * (AS-Deploy, node 7546:37777): each capability (Knowledge, Skills/Tools/
 * Workflows, Guardrails) is a group with a leading icon, a title, a one-line
 * description, a trailing "+ Add" action, and a stack of added-item rows below.
 *
 *   ◇  Knowledge                                        + Add
 *      Add sources your agent can reference.
 *   ┌──────────────────────────────────────────────┐
 *   │  Knowledge Base                                 │  ← rows (children)
 *   │  Knowledge Base                                 │
 *   └──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - The header row is `icon + (title over description)` on the left and the
 *   `action` slot (typically a tertiary "+ Add" Button) on the right.
 * - `children` are the added rows, stacked at 8px. When empty, nothing renders
 *   below the header (the empty state is just the header + Add).
 * - This is a section *within* an agent builder body — it does not own page
 *   chrome. Stack several inside a centered column (see BuilderPage usage).
 *
 * Slots:
 * - `icon` — leading capability icon (arcade icon element).
 * - `title` — capability name.
 * - `description` — one-line explanation.
 * - `action` — trailing action (e.g. `<Button variant="tertiary">+ Add</Button>`).
 * - `children` — added-item rows (optional).
 *
 * @counterexample Do NOT hardcode a "+ Add" button with your own styling. Pass
 *   the arcade `<Button variant="tertiary">` as `action`.
 * @counterexample Do NOT wrap the whole section in a card border — sections are
 *   separated by spacing in the builder column, not boxed (the rows may be
 *   boxed by the caller, the section is not).
 *
 * @tokens
 * | Element | Token |
 * | Title text | `--fg-neutral-prominent` |
 * | Description text | `--fg-neutral-subtle` |
 * | Icon | `--fg-neutral-medium` |
 */
import { type ReactNode } from "react";

type CapabilitySectionProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
};

export function CapabilitySection({
  icon,
  title,
  description,
  action,
  children,
}: CapabilitySectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {icon && (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-(--fg-neutral-medium)">
              {icon}
            </span>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-body-large-bold text-(--fg-neutral-prominent)">
              {title}
            </span>
            {description && (
              <span className="text-body-small text-(--fg-neutral-subtle)">
                {description}
              </span>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="flex flex-col gap-2 pl-7">{children}</div>}
    </section>
  );
}
