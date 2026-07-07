import { IconButton, Menu, ThreeDotsHorizontal } from "@xorkavi/arcade-gen";
import type { Project } from "../../../server/types";

export function ProjectCard({
  project, onOpen, onRename, onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
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
        borderRadius: 14,
        // Design uses --bg/neutral/medium (rgba(33,30,32,0.91)) — a dark
        // translucent fill. That token INVERTS to near-white in the
        // dark-pinned shell, so use the literal to keep the card dark (white
        // title/date sit on it). Same inversion trap as the landing bg.
        background: "rgba(33,30,32,0.91)",
        border: "1px solid var(--stroke-neutral-subtle)",
        cursor: "pointer",
      }}
    >
      {/* Footer row: title + date on the left (both white per design
          483:16743), the overflow menu right-aligned in the same row rather
          than floating in the top corner. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
              fontWeight: 600,
              fontSize: 18,
              lineHeight: "21px",
              color: "#ffffff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.name}
          </div>
          <div style={{ color: "#ffffff", fontSize: 14, lineHeight: "21px", marginTop: 5 }}>
            {new Date(project.updatedAt).toLocaleDateString()}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton aria-label="More" variant="tertiary" size="md">
                <ThreeDotsHorizontal style={{ color: "#ffffff" }} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Item onSelect={() => onRename()}>Rename</Menu.Item>
              <Menu.Item onSelect={() => onDelete()}>Delete</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </div>
      </div>
    </article>
  );
}
