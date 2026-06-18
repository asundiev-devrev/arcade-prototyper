import { useState } from "react";
import { ToggleGroup } from "@xorkavi/arcade-gen";
import type { Project } from "../../../server/types";
import { ProjectsSection } from "./ProjectsSection";
import { TemplatesSection } from "./TemplatesSection";

type Tab = "projects" | "templates";

export interface HomeShelfProps {
  projects: Project[];
  onOpen: (slug: string) => void;
  onRename: (p: Project) => void | Promise<void>;
  onDelete: (p: Project) => void | Promise<void>;
  onStartTemplate: (templateId: string) => void;
}

export function HomeShelf({ projects, onOpen, onRename, onDelete, onStartTemplate }: HomeShelfProps) {
  const [tab, setTab] = useState<Tab>(projects.length === 0 ? "templates" : "projects");

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <ToggleGroup.Root type="single" value={tab} onValueChange={(v: string) => { if (v === "projects" || v === "templates") setTab(v); }}>
          <ToggleGroup.Item value="projects" onClick={() => setTab("projects")}>My projects</ToggleGroup.Item>
          <ToggleGroup.Item value="templates" onClick={() => setTab("templates")}>Templates</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      {tab === "projects" ? (
        <ProjectsSection projects={projects} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
      ) : (
        <TemplatesSection onStart={onStartTemplate} />
      )}
    </section>
  );
}
