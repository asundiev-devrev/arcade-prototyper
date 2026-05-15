interface Props {
  id: string;
  hostDisplayName: string;
  projectSlug: string;
  status?: "online" | "offline" | "unknown";
  onOpen: () => void;
}

/**
 * Tile representing a shared (guest-side mirror) project on the homepage.
 * Visually mirrors `ProjectCard` so the two card types coexist in the same
 * grid without looking out of place. Plain inline styles keep the
 * dependency surface small — no arcade-gen imports needed.
 */
export function SharedTile({ hostDisplayName, projectSlug, status, onOpen }: Props) {
  const liveLabel =
    status === "online" ? "● live" : status === "offline" ? "○ offline" : "○ shared";

  return (
    <article
      onClick={onOpen}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        minHeight: 180,
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          fontSize: 11,
          color: "var(--fg-neutral-subtle)",
        }}
      >
        {liveLabel}
      </div>
      <div
        style={{
          fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
          fontWeight: 700,
          lineHeight: "16px",
          color: "var(--fg-neutral-prominent)",
        }}
      >
        {projectSlug}
      </div>
      <div
        style={{
          color: "var(--fg-neutral-subtle)",
          fontSize: 12,
          marginTop: 4,
        }}
      >
        Shared by {hostDisplayName}
      </div>
    </article>
  );
}
