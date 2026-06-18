import { useEffect, useRef, useState } from "react";
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
  // useProjects starts as [] and populates async, so a returning user's
  // projects may not be present at mount. Resolve the smart-default tab once,
  // the first time projects become non-empty; never override a later manual
  // switch (the ref guard ensures this fires at most once).
  const resolvedInitialTab = useRef(projects.length > 0);
  useEffect(() => {
    if (resolvedInitialTab.current) return;
    if (projects.length > 0) {
      resolvedInitialTab.current = true;
      setTab("projects");
    }
  }, [projects.length]);

  return (
    <section>
      <div style={{ marginBottom: 24 }}>
        {/* Each Item carries an explicit onClick AND the Root carries
            onValueChange on purpose: onValueChange drives the real Radix
            ToggleGroup in production, while onClick keeps the switch working
            under the test mock. Don't "simplify" by dropping the onClick.
            The inline font-size/padding scale the segmented control up — it
            doubles as this section's heading now that the "Projects" h2 is
            gone. */}
        <ToggleGroup.Root type="single" value={tab} onValueChange={(v: string) => { if (v === "projects" || v === "templates") setTab(v); }} style={{ fontSize: 16 }}>
          <ToggleGroup.Item value="projects" onClick={() => setTab("projects")} style={{ padding: "8px 16px", fontSize: 16, lineHeight: "24px" }}>My projects</ToggleGroup.Item>
          <ToggleGroup.Item value="templates" onClick={() => setTab("templates")} style={{ padding: "8px 16px", fontSize: 16, lineHeight: "24px" }}>Templates</ToggleGroup.Item>
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
