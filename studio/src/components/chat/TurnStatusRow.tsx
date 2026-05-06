import { useEffect, useState } from "react";
import type { TurnPhase } from "../../hooks/useChatStream";

/**
 * Persistent turn-state indicator rendered after the last activity row.
 *
 * Shows three states so the user always knows whether the agent is still
 * working, done, or errored — even after a page refresh or cross-navigation
 * (the server-owned turn registry means we can reconstruct this state any
 * time). The "done" state is intentionally sticky: it stays visible until
 * the next turn starts, instead of flashing and disappearing.
 */
export function TurnStatusRow({
  phase,
  startedAt,
  endedAt,
}: {
  phase: TurnPhase;
  startedAt: number | null;
  endedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === "idle") return null;

  const runningSince = startedAt ?? now;
  const endedWhen = endedAt ?? now;
  const ms =
    phase === "running" ? now - runningSince : Math.max(0, endedWhen - (startedAt ?? endedWhen));
  const label = formatDuration(ms);

  if (phase === "running") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <PulseDot />
        <span>Working… {label}</span>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          fontSize: 12,
          color: "var(--fg-neutral-subtle)",
        }}
      >
        <span aria-hidden style={{ color: "var(--fg-accent-prominent, var(--fg-neutral-prominent))" }}>
          ✓
        </span>
        <span>Done in {label}</span>
      </div>
    );
  }

  // error — the ErrorBanner also renders below, but showing a compact
  // status row here keeps the activity timeline readable.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        fontSize: 12,
        color: "var(--fg-alert-prominent)",
      }}
    >
      <span aria-hidden>⚠</span>
      <span>Failed after {label}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function PulseDot() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--fg-accent-prominent, currentColor)",
        animation: "arcade-studio-pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}
