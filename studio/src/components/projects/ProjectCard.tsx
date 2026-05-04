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
        borderRadius: 12,
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      <div
        style={{ position: "absolute", top: 8, right: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton aria-label="More" variant="secondary" size="sm">
              <ThreeDotsHorizontal />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content align="end">
            <Menu.Item onSelect={() => onRename()}>Rename</Menu.Item>
            <Menu.Item onSelect={() => onDelete()}>Delete</Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </div>
      <div
        style={{
          fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
          fontWeight: 900,
          color: "var(--fg-neutral-prominent)",
        }}
      >
        {project.name}
      </div>
      <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12, marginTop: 4 }}>
        {new Date(project.updatedAt).toLocaleDateString()}
      </div>
    </article>
  );
}
