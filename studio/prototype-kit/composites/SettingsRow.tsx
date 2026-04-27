/**
 * SettingsRow — DevRev settings row composite.
 *
 * Matches Figma "Contained Row / 2 line desc + Button + Toggle".
 *
 * Layout: label + description on the left, an optional right-slot action
 * cluster (typically a Link/Button and a Switch) on the right. All aligned
 * on the row's center axis.
 *
 * Intentional opinions:
 * - Vertical padding is baked in (14px) — matches the Figma density exactly.
 *   Do not override via className; if a new density is needed, make a new
 *   composite.
 * - Label uses text-system-medium (14px weight 540), description uses
 *   text-system with --fg-neutral-subtle (secondary text).
 * - Action slot is right-aligned with gap-3.
 *
 * Slots:
 * - `label` — primary row label.
 * - `description` — supporting copy under the label.
 * - `action` (optional) — button/link rendered before the toggle.
 * - `control` (optional) — typically a <Switch>.
 */
import type { ReactNode } from "react";

type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  control?: ReactNode;
};

export function SettingsRow({ label, description, action, control }: SettingsRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <div className="text-system-medium text-(--fg-neutral-prominent)">
          {label}
        </div>
        {description && (
          <div className="mt-0.5 text-system text-(--fg-neutral-subtle)">
            {description}
          </div>
        )}
      </div>
      {(action || control) && (
        <div className="flex items-center gap-3 shrink-0">
          {action}
          {control}
        </div>
      )}
    </div>
  );
}
