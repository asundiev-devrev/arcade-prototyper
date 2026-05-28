import { useEffect, useRef } from "react";

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function CodeStreamPanel({
  partial,
  filePath,
}: {
  partial: string;
  filePath: string;
}) {
  const bodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [partial]);

  return (
    <div
      data-testid="code-stream-panel"
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--surface-overlay)",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 2,
      }}
    >
      <div
        data-testid="code-stream-header"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
          {basename(filePath)}
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ animation: "arcade-studio-pulse 1.4s ease-in-out infinite" }}>•</span>
          <span>Writing… {partial.length} chars</span>
        </span>
      </div>
      <pre
        ref={bodyRef}
        data-testid="code-stream-body"
        style={{
          margin: 0,
          padding: 12,
          flex: 1,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--fg-neutral-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {partial}
      </pre>
    </div>
  );
}
