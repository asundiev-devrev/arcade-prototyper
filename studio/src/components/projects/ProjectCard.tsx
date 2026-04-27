import type { Project } from "../../../server/types";
import { placeholderTint } from "../../../server/thumbnails";

export function ProjectCard({
  project, onOpen, onRename, onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const thumbnailUrl = project.coverThumbnail
    ? `/api/projects/${project.slug}/thumbnails/${project.coverThumbnail.replace("thumbnails/", "").replace(".png", "")}.png`
    : null;

  return (
    <article
      onClick={onOpen}
      style={{
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={project.name}
          style={{
            width: "100%",
            height: 120,
            borderRadius: 8,
            marginBottom: 12,
            objectFit: "cover",
          }}
        />
      ) : (
        <div style={{ height: 120, borderRadius: 8, marginBottom: 12, background: placeholderTint(project.theme) }} />
      )}
      <div style={{ fontWeight: 540, color: "var(--fg-neutral-prominent)" }}>{project.name}</div>
      <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12 }}>
        {new Date(project.updatedAt).toLocaleDateString()}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={(e) => { e.stopPropagation(); onRename(); }}>Rename</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
      </div>
    </article>
  );
}
