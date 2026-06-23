import { useState, type ReactNode } from "react";

const HEADER: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
  padding: "10px 14px", borderTop: "1px solid var(--stroke-neutral-subtle)",
  userSelect: "none",
};
const TITLE: React.CSSProperties = {
  flex: 1, fontSize: 12, fontWeight: 600, color: "var(--fg-neutral-prominent)",
};
const BODY: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10, padding: "0 14px 12px",
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ color: "var(--fg-neutral-subtle)", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 120ms ease" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function Section({
  title, icon, defaultOpen = true, children,
}: {
  title: string; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        style={HEADER}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        {/* borderTop is a section separator */}
        {icon && <span style={{ display: "flex", color: "var(--fg-neutral-medium)" }} aria-hidden="true">{icon}</span>}
        <span style={TITLE}>{title}</span>
        <Chevron open={open} />
      </div>
      {open && <div style={BODY}>{children}</div>}
    </div>
  );
}
