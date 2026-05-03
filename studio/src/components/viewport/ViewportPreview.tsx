import type { ReactNode } from "react";

export function ViewportPreview({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-start",
        height: "100%",
        padding: 24,
        position: "relative",
        background: "var(--surface-shallow)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          flex: "none",
          width: "fit-content",
          maxWidth: "100%",
          border: "1px solid var(--stroke-neutral-subtle)",
          borderRadius: 12,
          overflow: "auto",
          background: "var(--surface-overlay)",
        }}
      >
        {children}
      </div>
      <span
        style={{
          position: "absolute",
          bottom: 36,
          right: 36,
          padding: "2px 6px",
          fontSize: 10,
          color: "var(--fg-neutral-tertiary)",
          background: "var(--surface-overlay)",
          border: "1px solid var(--stroke-neutral-subtle)",
          borderRadius: 6,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Preview
      </span>
    </div>
  );
}
