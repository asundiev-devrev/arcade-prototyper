import { useEffect, useRef, useState } from "react";
import { IconButton, Tooltip } from "@xorkavi/arcade-gen";
import { Viewport } from "../components/viewport/Viewport";
import { ChatPane } from "../components/chat/ChatPane";
import { DevModePanel } from "../components/devmode/DevModePanel";
import { StudioHeader } from "../components/shell/StudioHeader";
import { ThemeToggle } from "../components/shell/ThemeToggle";
import { ShareButton } from "../components/shell/ShareButton";
import { CanvasToggle } from "../components/shell/CanvasToggle";
import { ChatToggle } from "../components/shell/ChatToggle";
import { ProjectPicker } from "../components/shell/ProjectPicker";
import { SharePanel } from "../components/multiplayer/SharePanel";
import { PresenceStrip } from "../components/multiplayer/PresenceStrip";
import { ChatStreamProvider } from "../hooks/chatStreamContext";
import { TargetSelectionProvider } from "../hooks/targetSelectionContext";
import { useProjectFromHost } from "../hooks/useProjectFromHost";

function TeammatesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const CHAT_OPEN_STORAGE_KEY = "studio:chatPaneOpen";
const CHAT_WIDTH_STORAGE_KEY = "studio:chatPaneWidth";
const CHAT_WIDTH_DEFAULT = 400;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 720;
const FRAME_WIDTH_STORAGE_KEY = "studio:frameWidth";
const FRAME_WIDTH_DEFAULT = 1440;
const ZOOM_STORAGE_PREFIX = "studio:zoom:";
const ZOOM_DEFAULT = 1.0;

export function ProjectDetail({
  slug,
  onBack,
  onOpenProject,
}: {
  slug: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const source = useProjectFromHost(slug);
  // Allow optimistic local updates (e.g. theme toggle) on top of the
  // hook-owned project record. `localProject`, when set, overrides the
  // hook's value until the next refresh lands.
  const [localProject, setLocalProject] = useState<typeof source.project>(null);
  const project = localProject ?? source.project;
  const { presence, refresh: refreshProject, chatStream } = source;
  const { host, guests } = presence;
  const [devOpen, setDevOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [frameWidth, setFrameWidth] = useState<number>(() => {
    if (typeof window === "undefined") return FRAME_WIDTH_DEFAULT;
    const stored = window.localStorage.getItem(FRAME_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (!Number.isFinite(parsed)) return FRAME_WIDTH_DEFAULT;
    return parsed;
  });
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === "undefined") return ZOOM_DEFAULT;
    const stored = window.localStorage.getItem(`${ZOOM_STORAGE_PREFIX}${slug}`);
    const parsed = stored ? Number(stored) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return ZOOM_DEFAULT;
    return parsed;
  });
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
  const seedChatRef = useRef<((text: string) => void) | null>(null);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(chatOpen));
  }, [chatOpen]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    window.localStorage.setItem(FRAME_WIDTH_STORAGE_KEY, String(frameWidth));
  }, [frameWidth]);

  useEffect(() => {
    window.localStorage.setItem(`${ZOOM_STORAGE_PREFIX}${slug}`, String(zoom));
  }, [slug, zoom]);

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

  async function toggleProjectMode() {
    if (!project) return;
    const previous = project.mode;
    const next = previous === "dark" ? "light" : "dark";
    setLocalProject({ ...project, mode: next });
    try {
      const res = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error("Failed to save theme");
      setReloadKey((k) => k + 1);
      // Re-pull the canonical record so any server-side normalisation
      // (e.g. updatedAt) lands; clear the local override on next render.
      refreshProject();
      setLocalProject(null);
    } catch {
      setLocalProject({ ...project, mode: previous });
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
    <ChatStreamProvider value={chatStream}>
    <TargetSelectionProvider>
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100vh" }}>
      <StudioHeader
        title={
          <>
            <ChatToggle active={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
            <ProjectPicker
              project={project}
              onHome={onBack}
              onOpenProject={onOpenProject}
              onRenamed={() => refreshProject()}
            />
          </>
        }
        right={
          <>
            <PresenceStrip host={host} guests={guests} />
            <ThemeToggle mode={project.mode} onToggle={toggleProjectMode} />
            <Tooltip content="Share with teammates">
              <IconButton
                aria-label="Share with teammates"
                variant={showShare ? "primary" : "tertiary"}
                onClick={() => setShowShare((s) => !s)}
              >
                <TeammatesIcon />
              </IconButton>
            </Tooltip>
            <ShareButton project={project} />
            <CanvasToggle active={devOpen} onToggle={() => setDevOpen((o) => !o)} />
          </>
        }
      />
      {showShare && (
        <SharePanel slug={project.slug} onClose={() => setShowShare(false)} />
      )}
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
          <ChatPane projectSlug={project.slug} seedRef={seedChatRef} />
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
          <Viewport
            project={project}
            frameWidth={frameWidth}
            onFrameWidthChange={setFrameWidth}
            zoom={zoom}
            onZoomChange={setZoom}
            onSeedChat={(text) => seedChatRef.current?.(text)}
          />
        </main>
        {devOpen && <DevModePanel slug={project.slug} />}
      </div>
    </div>
    </TargetSelectionProvider>
    </ChatStreamProvider>
  );
}
