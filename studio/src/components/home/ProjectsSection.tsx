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

  return (
    <section>
      <h2
        style={{
          margin: 0,
          marginBottom: 16,
          fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
          fontWeight: 600,
          fontSize: 27,
          lineHeight: "36px",
          color: "var(--fg-neutral-prominent, #211e20)",
        }}
      >
        Projects
      </h2>
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
    </section>
  );
}
