import type { ReactNode } from "react";

export function StudioHeader({
  title,
  center,
  right,
  variant = "default",
}: {
  title: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  // "home" is the branded landing header: taller, transparent (lets the
  // background artwork show through), no bottom border. "default" is the
  // compact chrome bar used inside a project.
  variant?: "default" | "home";
}) {
  const home = variant === "home";
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 12,
        height: home ? 72 : 48,
        padding: home ? "0 32px" : "0 16px",
        background: home ? "transparent" : "var(--surface-overlay)",
        borderBottom: home ? "none" : "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifySelf: "start",
          minWidth: 0,
          fontWeight: 540,
          fontSize: 14,
          color: "var(--fg-neutral-prominent)",
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
