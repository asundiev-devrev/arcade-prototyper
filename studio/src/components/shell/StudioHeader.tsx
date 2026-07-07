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
  // background artwork show through), no bottom border. "project" is the
  // editor header: bg-neutral-prominent (#211E20), no border, matching the
  // dark chat pane it sits above. "default" is the compact chrome bar.
  variant?: "default" | "home" | "project";
}) {
  const home = variant === "home";
  const project = variant === "project";
  return (
    <header
      className={project ? "studio-project-header" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 12,
        height: home ? 72 : 48,
        padding: home ? "0 32px" : "0 16px",
        // #211E20 literal: --bg-neutral-prominent inverts to white in the
        // dark-pinned shell.
        background: home ? "transparent" : project ? "#211e20" : "var(--surface-overlay)",
        borderBottom: home || project ? "none" : "1px solid var(--stroke-neutral-subtle)",
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
