import { useMemo, useState } from "react";
import { Button, useToast } from "@xorkavi/arcade-gen";
import { useProjects } from "../hooks/useProjects";
import { ProjectCard } from "../components/projects/ProjectCard";
import { ProjectSearch } from "../components/projects/ProjectSearch";
import { api } from "../lib/api";
import { StudioHeader } from "../components/shell/StudioHeader";
import { AppSettingsButton } from "../components/shell/SettingsButton";

export function ProjectList({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, loading, error, refresh } = useProjects();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  async function createProject() {
    if (creating) return;
    setCreating(true);
    try {
      const p = await api.createProject({ name: "Untitled project", theme: "arcade", mode: "light" });
      void refresh();
      toast({ title: "Project created", intent: "success" });
      onOpen(p.slug);
    } catch (e) {
      toast({
        title: "Failed to create project",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <StudioHeader
        title="Studio"
        right={
          <>
            <AppSettingsButton />
            <Button variant="primary" onClick={() => void createProject()} disabled={creating}>
              + New project
            </Button>
          </>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <h1 style={{ flex: 1, margin: 0, fontSize: 24, fontWeight: 600 }}>Projects</h1>
            <ProjectSearch value={query} onChange={setQuery} />
          </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            background: "var(--bg-alert-subtle)",
            color: "var(--fg-alert-prominent)",
            border: "1px solid var(--bg-alert-medium)",
          }}
        >
          Failed to load projects: {error}
          <Button variant="tertiary" size="sm" onClick={() => void refresh()} style={{ marginLeft: 12 }}>
            Retry
          </Button>
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--fg-neutral-subtle)" }}>
          Loading projects…
        </div>
      ) : !loading && projects.length === 0 && !error ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--fg-neutral-subtle)" }}>
          No projects yet. Click "+ New project" to create one.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {filtered.map((p) => (
            <ProjectCard
              key={p.slug}
              project={p}
              onOpen={() => onOpen(p.slug)}
              onRename={async () => {
                const n = prompt("New name", p.name);
                if (n && n.trim()) {
                  try {
                    await api.renameProject(p.slug, n.trim());
                    void refresh();
                    toast({ title: "Project renamed", intent: "success" });
                  } catch (e) {
                    toast({
                      title: "Rename failed",
                      description: e instanceof Error ? e.message : String(e),
                      intent: "alert",
                    });
                  }
                }
              }}
              onDelete={async () => {
                if (confirm(`Delete "${p.name}"? This cannot be undone.`)) {
                  try {
                    await api.deleteProject(p.slug);
                    void refresh();
                    toast({ title: "Project deleted", intent: "success" });
                  } catch (e) {
                    toast({
                      title: "Delete failed",
                      description: e instanceof Error ? e.message : String(e),
                      intent: "alert",
                    });
                  }
                }
              }}
            />
          ))}
        </div>
      )}

        </div>
      </div>
    </div>
  );
}
