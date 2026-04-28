/**
 * VistaToolbar — DevRev vista toolbar band.
 *
 * Matches the filter/toolbar row on vista list views:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [icons] │ [filter pills…] [+] [Clear]                       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   Outer: flex items-start mb-4 px-page-gutter justify-between
 *     → padding 0 36px, margin-bottom 16px
 *   Inner: flex gap-2 items-center flex-wrap (content 30px tall)
 *
 * The vertical separator after the icon cluster is owned by this
 * composite. When `toolbarIcons` is provided, the separator renders.
 * When absent, the row starts with `filters` directly.
 *
 * Slots:
 * - `toolbarIcons` (optional) — icon cluster (@ / chart / clock / …).
 * - `filters` (optional) — filter pill group + add-filter + clear.
 */
import type { ReactNode } from "react";

type VistaToolbarProps = {
  toolbarIcons?: ReactNode;
  filters?: ReactNode;
};

export function VistaToolbar({
  toolbarIcons,
  filters,
}: VistaToolbarProps) {
  return (
    <div className="flex items-start px-9 mb-4 shrink-0">
      <div className="flex gap-2 items-center flex-wrap">
        {toolbarIcons != null ? (
          <div className="flex items-center">
            {toolbarIcons}
            <div className="self-stretch my-2 w-px bg-(--stroke-neutral-subtle)" />
          </div>
        ) : null}
        {filters}
      </div>
    </div>
  );
}
