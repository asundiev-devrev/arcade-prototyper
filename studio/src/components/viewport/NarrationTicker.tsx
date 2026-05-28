import type { TurnPhase } from "../../hooks/chatStreamReducer";

export function NarrationTicker({
  narrations,
  lastTool,
  phase,
}: {
  narrations: string[];
  lastTool: { name: string; pretty: string } | null;
  phase: TurnPhase;
}) {
  if (phase !== "running" && narrations.length === 0) return null;

  const recent = narrations.slice(-3).reverse();
  const total = recent.length;

  return (
    <div
      data-testid="narration-ticker"
      style={{
        position: "absolute",
        bottom: 24,
        left: 32,
        right: 32,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        {recent.map((text, i) => {
          const opacity = total === 1 ? 0.85 : 0.85 - 0.3 * (i / (total - 1));
          return (
            <div
              key={i}
              data-testid="narration-item"
              title={text}
              style={{
                color: "var(--fg-neutral-medium)",
                fontSize: 12,
                opacity,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
      {lastTool && (
        <div
          data-testid="narration-tool"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--fg-neutral-tertiary)",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ animation: "arcade-studio-pulse 1.4s ease-in-out infinite" }}>•••</span>
          <span>{lastTool.pretty}</span>
        </div>
      )}
    </div>
  );
}
