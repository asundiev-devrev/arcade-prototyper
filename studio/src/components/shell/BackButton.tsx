/**
 * Header back-arrow that replaces the previous "Studio" wordmark in
 * `StudioHeader`'s left slot. Used by both author (via `ProjectPicker`) and
 * spectator views so the navigation affordance is identical regardless of
 * which mode mounted the shell.
 */
export function BackButton({ onClick }: { onClick?: () => void }) {
  const enabled = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Back to projects"
      aria-label="Back to projects"
      disabled={!enabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        background: "transparent",
        border: "none",
        borderRadius: 4,
        color: "var(--fg-neutral-prominent)",
        cursor: enabled ? "pointer" : "default",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (enabled) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 12L6 8l4-4" />
      </svg>
    </button>
  );
}
