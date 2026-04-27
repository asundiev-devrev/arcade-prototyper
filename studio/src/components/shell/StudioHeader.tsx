import type { ReactNode } from "react";

export function StudioHeader({
  title,
  center,
  right,
}: {
  title: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 12,
        height: 48,
        padding: "0 16px",
        background: "var(--surface-overlay)",
        borderBottom: "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <div
        style={{
          fontWeight: 540,
          fontSize: 14,
          color: "var(--fg-neutral-prominent)",
          justifySelf: "start",
        }}
      >
        {title}
      </div>
      <div style={{ justifySelf: "center" }}>{center}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifySelf: "end",
        }}
      >
        {right}
      </div>
    </header>
  );
}
