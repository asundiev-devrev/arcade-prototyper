/**
 * MobileFrame — iOS device chrome wrapper for mobile prototype screens.
 *
 * Matches the Figma "iPhone" frame chrome used across Computer chat and
 * Onboarding (Home Indicator + Status bar - iPhone): a 402×874 device viewport
 * with a status bar (time left, signal/wifi/battery right) at top and a home
 * indicator pill at the bottom. The screen content sits between them.
 *
 *   ┌─────────────────────────────┐
 *   │  9:41          ▴ 􀙇 􀛨         │  ← status bar
 *   │                             │
 *   │        children             │  ← screen content
 *   │                             │
 *   │          ────                │  ← home indicator
 *   └─────────────────────────────┘
 *
 * Intentional opinions:
 * - Fixed 402px width (iPhone 16 Pro logical width), the Figma mobile artboard.
 * - Status bar is 54px tall with the canonical "9:41" time; the right cluster
 *   is the signal/wifi/battery glyph row. Time/glyphs are presentational.
 * - Home indicator is the 5px rounded bar in a 34px safe-area band.
 * - Content area scrolls between the two bars; pass a full mobile screen as
 *   `children`. Use `bg` to set the screen background (default surface-overlay).
 *
 * Slots:
 * - `children` — the mobile screen content.
 * - `time` — status-bar time (default "9:41").
 * - `bg` — screen background token class (default `bg-(--surface-overlay)`).
 *
 * @counterexample Do NOT draw your own status bar or home indicator inside
 *   `children` — this wrapper renders both. Double chrome is the #1 mobile bug.
 * @counterexample Do NOT set a custom width — the frame is fixed to the iPhone
 *   logical width so multiple mobile frames line up.
 *
 * @tokens
 * | Element | Token |
 * | Status bar text/glyphs | `--fg-neutral-prominent` |
 * | Home indicator | `--fg-neutral-prominent` |
 * | Screen bg | `--surface-overlay` (override via `bg`) |
 */
import { type ReactNode } from "react";

type MobileFrameProps = {
  children: ReactNode;
  time?: string;
  bg?: string;
};

export function MobileFrame({
  children,
  time = "9:41",
  bg = "bg-(--surface-overlay)",
}: MobileFrameProps) {
  return (
    <div className={`flex h-[874px] w-[402px] flex-col overflow-hidden rounded-[44px] ${bg}`}>
      {/* Status bar */}
      <div className="flex h-[54px] shrink-0 items-end justify-between px-8 pb-2 text-(--fg-neutral-prominent)">
        <span className="text-system-medium tabular-nums">{time}</span>
        <span className="flex items-center gap-1.5">
          {/* signal */}
          <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
            <rect x="0" y="8" width="3" height="4" rx="1" />
            <rect x="5" y="5" width="3" height="7" rx="1" />
            <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
            <rect x="15" y="0" width="3" height="12" rx="1" />
          </svg>
          {/* wifi */}
          <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
            <path d="M8 2.5c2.6 0 5 1 6.8 2.7l-1.4 1.5A7.8 7.8 0 0 0 8 4.6 7.8 7.8 0 0 0 2.6 6.7L1.2 5.2A9.8 9.8 0 0 1 8 2.5Zm0 3.7c1.5 0 2.9.6 3.9 1.6l-1.4 1.5A3.6 3.6 0 0 0 8 8.3c-1 0-1.8.4-2.5 1L4.1 7.8A5.6 5.6 0 0 1 8 6.2Zm0 3.6.0 0 1.4 1.5L8 12 6.6 10.6 8 9.8Z" />
          </svg>
          {/* battery */}
          <span className="flex items-center">
            <span className="relative h-3 w-6 rounded-[3px] border border-(--fg-neutral-prominent)/40">
              <span className="absolute inset-0.5 rounded-[1.5px] bg-(--fg-neutral-prominent)" />
            </span>
            <span className="ml-0.5 h-1.5 w-0.5 rounded-r-sm bg-(--fg-neutral-prominent)/40" />
          </span>
        </span>
      </div>

      {/* Screen content */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {/* Home indicator */}
      <div className="flex h-[34px] shrink-0 items-center justify-center">
        <span className="h-[5px] w-[134px] rounded-full bg-(--fg-neutral-prominent)" />
      </div>
    </div>
  );
}
