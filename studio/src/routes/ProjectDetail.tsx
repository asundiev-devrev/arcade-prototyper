import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../server/types";
import { Viewport } from "../components/viewport/Viewport";
import { DeviceToggle } from "../components/viewport/DeviceToggle";
import type { DevicePreset } from "../lib/devicePresets";
import { ChatPane } from "../components/chat/ChatPane";
import { DevModePanel } from "../components/devmode/DevModePanel";
import { StudioHeader } from "../components/shell/StudioHeader";
import { ThemeToggle } from "../components/shell/ThemeToggle";
import { ShareButton } from "../components/shell/ShareButton";
import { CanvasToggle } from "../components/shell/CanvasToggle";
import { ChatToggle } from "../components/shell/ChatToggle";
import { ProjectPicker } from "../components/shell/ProjectPicker";
import { AppSettingsButton } from "../components/shell/SettingsButton";

const CHAT_OPEN_STORAGE_KEY = "studio:chatPaneOpen";

export function ProjectDetail({
  slug,
  onBack,
  onOpenProject,
}: {
  slug: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [devicePreset, setDevicePreset] = useState<DevicePreset>("desktop");
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(CHAT_OPEN_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(chatOpen));
  }, [chatOpen]);

  const refreshProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    setProject(p);
  }, [slug]);

  useEffect(() => {
    void refreshProject();
  }, [refreshProject]);

  async function toggleProjectMode() {
    if (!project) return;
    const previous = project.mode;
    const next = previous === "dark" ? "light" : "dark";
    setProject({ ...project, mode: next });
    try {
      const res = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error("Failed to save theme");
      setReloadKey((k) => k + 1);
    } catch {
      setProject({ ...project, mode: previous });
    }
  }

  if (!project)
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-neutral-subtle)",
        }}
      >
        Loading project…
      </div>
    );

  return (
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100vh" }}>
      <StudioHeader
        title={
          <ProjectPicker
            project={project}
            onHome={onBack}
            onOpenProject={onOpenProject}
            onRenamed={() => void refreshProject()}
          />
        }
        center={<DeviceToggle value={devicePreset} onValueChange={setDevicePreset} />}
        right={
          <>
            <ChatToggle active={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
            <ThemeToggle mode={project.mode} onToggle={toggleProjectMode} />
            <ShareButton project={project} />
            <AppSettingsButton />
            <CanvasToggle active={devOpen} onToggle={() => setDevOpen((o) => !o)} />
          </>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${chatOpen ? "400px" : "0px"} 1fr${devOpen ? " auto" : ""}`,
          minHeight: 0,
          transition: "grid-template-columns 0.2s ease",
        }}
      >
        <aside
          aria-hidden={!chatOpen}
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            borderRight: chatOpen ? "1px solid var(--stroke-neutral-subtle)" : "none",
          }}
        >
          <ChatPane projectSlug={project.slug} />
        </aside>
        <main key={reloadKey} style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <Viewport
            project={project}
            devicePreset={devicePreset}
            onFramesChanged={refreshProject}
          />
        </main>
        {devOpen && <DevModePanel slug={project.slug} />}
      </div>
    </div>
  );
}
