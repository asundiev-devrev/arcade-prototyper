import type { ReactNode } from "react";

export function StudioHeader({
  title,
  titleEnd,
  titleRegionWidth,
  center,
  right,
}: {
  title: ReactNode;
  titleEnd?: ReactNode;
  titleRegionWidth?: number;
  center?: ReactNode;
  right?: ReactNode;
}) {
  const HEADER_PADDING_X = 16;
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 12,
        height: 48,
        padding: `0 ${HEADER_PADDING_X}px`,
        background: "var(--surface-overlay)",
        borderBottom: "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: titleEnd ? "space-between" : "flex-start",
          justifySelf: "start",
          width: titleRegionWidth ? titleRegionWidth - HEADER_PADDING_X : undefined,
          fontWeight: 540,
          fontSize: 14,
          color: "var(--fg-neutral-prominent)",
        }}
      >
        <div style={{ minWidth: 0 }}>{title}</div>
        {titleEnd}
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
