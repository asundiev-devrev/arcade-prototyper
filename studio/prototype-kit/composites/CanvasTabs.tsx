/**
 * CanvasTabs — tab strip for the Computer canvas pane. Connected-tab styling
 * (active tab merges into the body via white fill + no bottom rule; inactive
 * tabs + a trailing filler carry an inset bottom rule). Tabs shrink + ellipsis
 * + horizontally scroll as the canvas narrows — no JS for that.
 *
 * Usage:
 *   <CanvasTabs tabs={[{id:"canvas",label:"Canvas"},{id:"docs",label:"Docs"}]}>
 *     {(active) => active === "docs" ? <DocsBody/> : <CanvasPanel .../>}
 *   </CanvasTabs>
 */
import * as React from "react";
import { PlusSmall } from "@xorkavi/arcade-gen";
import { ResizeHandle } from "./ResizeHandle";

export type CanvasTab = { id: string; label: string; icon?: React.ReactNode };

type CanvasTabsProps = {
  tabs: CanvasTab[];
  defaultTabId?: string;
  /** Docked width in px (user-resizable). Applied inline; in the narrow
   *  drawer mode a container query overrides it to a wide overlay. Default 320. */
  width?: number;
  /** Fired during drag of the left-edge resize handle with the new width. */
  onResize?: (width: number) => void;
  /** Render-prop: receives the active tab id, returns that tab's body. */
  children: (activeId: string) => React.ReactNode;
};

export function CanvasTabs({ tabs, defaultTabId, width = 320, onResize, children }: CanvasTabsProps) {
  const [active, setActive] = React.useState(defaultTabId ?? tabs[0]?.id ?? "");
  return (
    <div
      style={{ width }}
      className="flex h-full shrink-0 flex-row border-l border-(--stroke-neutral-subtle) bg-(--surface-overlay) @max-[600px]:!w-[88vw]"
    >
      {/* Left-edge resize handle — docked only; hidden in the narrow drawer. */}
      {onResize ? (
        <ResizeHandle side="left" width={width} min={260} max={560} onResize={onResize} className="@max-[600px]:hidden" />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Tab strip */}
      <div className="flex shrink-0 items-stretch overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className="flex min-w-0 shrink items-center gap-1.5 px-3 py-2 text-body-small"
              style={{
                background: on ? "var(--surface-overlay)" : "transparent",
                color: on ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
                boxShadow: on ? "none" : "inset 0 -1px 0 var(--stroke-neutral-subtle)",
              }}
            >
              {t.icon ? <span className="shrink-0" style={{ color: on ? "var(--fg-info-prominent)" : "inherit" }}>{t.icon}</span> : null}
              <span className="min-w-0 truncate">{t.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Add tab"
          className="flex shrink-0 items-center px-2 text-(--fg-neutral-subtle)"
          style={{ boxShadow: "inset 0 -1px 0 var(--stroke-neutral-subtle)" }}
        >
          <PlusSmall size={16} />
        </button>
        {/* Trailing filler carries the bottom rule across leftover width */}
        <span className="flex-1" style={{ boxShadow: "inset 0 -1px 0 var(--stroke-neutral-subtle)" }} />
      </div>
      {/* Active tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children(active)}</div>
      </div>
    </div>
  );
}
