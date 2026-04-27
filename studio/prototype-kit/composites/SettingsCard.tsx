/**
 * SettingsCard — DevRev settings group composite.
 *
 * Matches Figma "Form / Section" (a bordered group of SettingsRows with an
 * optional section title ABOVE the border).
 *
 * Intentional opinions:
 * - Section title is rendered OUTSIDE and ABOVE the bordered container,
 *   using text-title-3 (section-level heading). The border wraps only the
 *   row stack.
 * - Corner radius is rounded-square-x2 (12px, arcade "normal density" card).
 * - Stroke uses --stroke-neutral-subtle (never hardcoded).
 * - **Separators between rows are rendered automatically.** Callers just
 *   pass a flat list of <SettingsRow /> children — the composite interleaves
 *   <Separator /> between them. Explicit <Separator /> children are still
 *   respected (useful for section breaks), but you no longer need to add
 *   them between every row. This closes the most common generation bug
 *   where the agent forgot dividers between rows.
 *
 * Slots:
 * - `title` — the section heading (string or node).
 * - `children` — SettingsRow instances (or any nodes). Separators are
 *   inserted automatically between each pair.
 */
import { Children, Fragment, type ReactNode, isValidElement } from "react";
import { Separator } from "@xorkavi/arcade-gen";

type SettingsCardProps = {
  title?: ReactNode;
  children: ReactNode;
};

export function SettingsCard({ title, children }: SettingsCardProps) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section>
      {title && (
        <h2 className="mb-3 text-title-3 text-(--fg-neutral-prominent)">
          {title}
        </h2>
      )}
      <div className="rounded-square-x2 border border-(--stroke-neutral-subtle) overflow-hidden bg-(--surface-overlay)">
        {rows.map((row, i) => {
          const isLast = i === rows.length - 1;
          const nextIsSeparator =
            !isLast &&
            isValidElement(rows[i + 1]) &&
            (rows[i + 1] as { type?: unknown }).type === Separator;
          const thisIsSeparator =
            isValidElement(row) && (row as { type?: unknown }).type === Separator;
          const key = isValidElement(row) ? row.key ?? i : i;
          return (
            <Fragment key={key}>
              {row}
              {!isLast && !thisIsSeparator && !nextIsSeparator ? (
                <Separator />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
