import { useCallback, useEffect, useRef, useState } from "react";
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
import { ChatStreamProvider } from "../hooks/chatStreamContext";

const CHAT_OPEN_STORAGE_KEY = "studio:chatPaneOpen";
const CHAT_WIDTH_STORAGE_KEY = "studio:chatPaneWidth";
const CHAT_WIDTH_DEFAULT = 400;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 720;

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
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === "undefined") return CHAT_WIDTH_DEFAULT;
    const stored = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (!Number.isFinite(parsed)) return CHAT_WIDTH_DEFAULT;
    return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, parsed));
  });
  const [resizing, setResizing] = useState(false);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(chatOpen));
  }, [chatOpen]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const s = resizeStateRef.current;
      if (!s) return;
      const next = s.startWidth + (e.clientX - s.startX);
      setChatWidth(Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, next)));
    }
    function onUp() {
      setResizing(false);
      resizeStateRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizeStateRef.current = { startX: e.clientX, startWidth: chatWidth };
    setResizing(true);
  }

  function resetChatWidth() {
    setChatWidth(CHAT_WIDTH_DEFAULT);
  }

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
    <ChatStreamProvider projectSlug={project.slug}>
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
          gridTemplateColumns: `${chatOpen ? `${chatWidth}px` : "0px"} 1fr${devOpen ? " auto" : ""}`,
          minHeight: 0,
          transition: resizing ? "none" : "grid-template-columns 0.2s ease",
          position: "relative",
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
            position: "relative",
          }}
        >
          <ChatPane projectSlug={project.slug} />
          {chatOpen && (
            <div
              role="separator"
              aria-label="Resize chat pane"
              aria-orientation="vertical"
              aria-valuenow={chatWidth}
              aria-valuemin={CHAT_WIDTH_MIN}
              aria-valuemax={CHAT_WIDTH_MAX}
              onMouseDown={startResize}
              onDoubleClick={resetChatWidth}
              style={{
                position: "absolute",
                top: 0,
                right: -3,
                width: 6,
                height: "100%",
                cursor: "col-resize",
                zIndex: 2,
                background: resizing ? "var(--stroke-neutral-strong, #888)" : "transparent",
                transition: resizing ? "none" : "background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!resizing)
                  (e.currentTarget as HTMLDivElement).style.background =
                    "var(--stroke-neutral-subtle)";
              }}
              onMouseLeave={(e) => {
                if (!resizing) (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            />
          )}
        </aside>
        <main key={reloadKey} style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <Viewport project={project} devicePreset={devicePreset} />
        </main>
        {devOpen && <DevModePanel slug={project.slug} />}
      </div>
    </div>
    </ChatStreamProvider>
  );
}
