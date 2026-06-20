import * as React from "react";
import { ChevronLeftSmall } from "arcade/components";
import { NAV_GROUPS, type PageId } from "./types.tsx";

export function ComputerSettingsSidebar({ active, onSelect, onBack }: { active: PageId; onSelect: (id: PageId) => void; onBack?: () => void }) {
  return (
    <div
      className="flex h-full w-60 shrink-0 flex-col border-r"
      style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--surface-shallow)" }}
    >
      {/* window chrome */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
      </div>
      {/* back row — a button when onBack is wired (returns to chat), else inert label */}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chat"
          className="flex h-12 shrink-0 items-center gap-1 px-3 text-left text-system-medium"
          style={{ color: "var(--fg-neutral-prominent)" }}
        >
          <ChevronLeftSmall size={16} />
          <span>Settings</span>
        </button>
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-1 px-3" style={{ color: "var(--fg-neutral-prominent)" }}>
          <ChevronLeftSmall size={16} />
          <span className="text-system-medium">Settings</span>
        </div>
      )}
      {/* groups */}
      <nav className="flex flex-col gap-4 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `g${gi}`} className="flex flex-col gap-0.5">
            {group.title && (
              <div className="px-2 pb-1 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{group.title}</div>
            )}
            {group.items.map((item) => {
              const on = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex items-center gap-2 rounded-square px-2 py-1.5 text-left text-system-medium"
                  style={{
                    background: on ? "var(--control-bg-neutral-subtle-hover)" : "transparent",
                    color: on ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-medium)",
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center" style={{ color: "var(--fg-neutral-medium)" }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
