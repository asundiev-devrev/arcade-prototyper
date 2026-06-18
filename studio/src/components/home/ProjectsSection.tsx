import type { Project } from "../../../server/types";
import { ProjectCard } from "../projects/ProjectCard";

export interface ProjectsSectionProps {
  projects: Project[];
  onOpen: (slug: string) => void;
  onRename: (project: Project) => void | Promise<void>;
  onDelete: (project: Project) => void | Promise<void>;
}

export function ProjectsSection({ projects, onOpen, onRename, onDelete }: ProjectsSectionProps) {
  if (projects.length === 0) return null;

  // No heading here — the "My projects" tab in HomeShelf already labels this
  // section, so a "Projects" heading would just duplicate it.
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
      }}
    >
      {projects.map((p) => (
        <ProjectCard
          key={p.slug}
          project={p}
          onOpen={() => onOpen(p.slug)}
          onRename={() => onRename(p)}
          onDelete={() => onDelete(p)}
        />
      ))}
    </div>
  );
}
