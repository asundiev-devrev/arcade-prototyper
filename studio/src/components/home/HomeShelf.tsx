import { useEffect, useRef, useState } from "react";
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
  onImport?: () => void;
}

export function HomeShelf({ projects, onOpen, onRename, onDelete, onStartTemplate, onImport }: HomeShelfProps) {
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
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          {(["projects", "templates"] as const).map((t) => {
            const label = t === "projects" ? "Projects" : "Templates";
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  appearance: "none",
                  background: "transparent",
                  border: "none",
                  padding: "8px 2px",
                  fontSize: 18,
                  lineHeight: "24px",
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-medium)",
                  borderBottom: active
                    ? "2px solid var(--fg-neutral-prominent)"
                    : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {onImport && (
          <button type="button" onClick={onImport}
            style={{ padding: "6px 12px", fontSize: 13, borderRadius: 6, border: "1px solid var(--stroke-neutral-subtle)", background: "transparent", color: "var(--fg-neutral-prominent)", cursor: "pointer" }}>
            Import project…
          </button>
        )}
      </div>
      {tab === "projects" ? (
        <ProjectsSection projects={projects} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
      ) : (
        <TemplatesSection onStart={onStartTemplate} />
      )}
    </section>
  );
}
