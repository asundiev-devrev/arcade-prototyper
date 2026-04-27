/**
 * PageBody — DevRev centered page body composite.
 *
 * Matches Figma "Page Body": a vertically scrolling column, centered in the
 * main content area, with a fixed max-width, and containing (optionally) a
 * hero title + subtitle followed by the body content.
 *
 * Intentional opinions:
 * - Max-width 832px centered (DevRev settings / detail page convention).
 *   This is deliberately narrower than the viewport — a "floating" column on
 *   a large canvas, not a full-bleed layout.
 * - Hero title uses text-title-large (34px, Chip Display). Do not substitute
 *   text-title-1/2/3 — those are section-level, not page-level.
 * - Subtitle uses text-body with fg-neutral-subtle.
 * - Top and bottom padding is baked in; callers only provide content.
 *
 * Slots:
 * - `title` (optional) — hero page title (string, or any node).
 * - `subtitle` (optional) — description under the title.
 * - `children` — the page body sections (typically a stack of SettingsCards).
 */
import type { ReactNode } from "react";

type PageBodyProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
};

export function PageBody({ title, subtitle, children }: PageBodyProps) {
  return (
    <div className="mx-auto w-full max-w-[832px] px-6 pt-12 pb-16">
      {(title || subtitle) && (
        <div className="mb-10">
          {title && (
            <h1 className="text-title-large text-(--fg-neutral-prominent)">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="mt-1 text-body text-(--fg-neutral-subtle)">
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-12">{children}</div>
    </div>
  );
}
