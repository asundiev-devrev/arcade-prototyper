export function NewFrameCard({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <div style={{ flex: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
          visibility: "hidden",
        }}
      >
        {/* spacer to match FrameCard's header height so card tops align */}
        <span>New frame</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label="New frame"
        style={{
          width: 320,
          height: "calc(100vh - 180px)",
          border: "2px dashed var(--stroke-neutral-subtle)",
          borderRadius: 12,
          background: "transparent",
          color: "var(--fg-neutral-subtle)",
          cursor: busy ? "progress" : "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          fontSize: 16,
          transition: "border-color 0.15s ease, color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (busy) return;
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--component-button-primary-bg-idle)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-neutral-prominent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--stroke-neutral-subtle)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-neutral-subtle)";
        }}
      >
        <span style={{ fontSize: 32, lineHeight: 1 }}>+</span>
        <span>New frame</span>
      </button>
    </div>
  );
}
