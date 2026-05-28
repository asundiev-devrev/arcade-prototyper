import { useCallback, useEffect, useRef, useState } from "react";
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
import { BackButton } from "../components/shell/BackButton";
import { SharePanel } from "../components/multiplayer/SharePanel";
import { PresenceStrip } from "../components/multiplayer/PresenceStrip";
import { ChatStreamProvider } from "../hooks/chatStreamContext";
import { TargetSelectionProvider } from "../hooks/targetSelectionContext";
import { useProjectFromHost, type ProjectShellSource } from "../hooks/useProjectFromHost";
import { useProjectFromMirror } from "../hooks/useProjectFromMirror";
import { takePendingPrompt } from "../lib/pendingPrompt";
import { decoratePromptWithFigma } from "../lib/figmaUrl";
import { api } from "../lib/api";

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

/**
 * `ProjectDetail` is the single authoring shell that hosts (`mode="author"`)
 * and spectators (`mode="spectator"`) both render through. Two modes pull
 * from different data sources but share JSX:
 *
 *   - Author:    `useProjectFromHost(slug)`  — host fetch + chat SSE.
 *   - Spectator: `useProjectFromMirror(id)`  — mirror cache + relay SSE.
 *
 * Both hooks return the same `ProjectShellSource` shape, so the inner
 * `ProjectDetailShell` stays mode-agnostic. Spectator-only gates here:
 *
 *   - `readonly` flag threaded into Viewport + ChatPane (Tasks 5/6 wire
 *     the actual readonly behaviour into those children; Task 4 just
 *     plumbs the prop).
 *   - Host-only chrome (ProjectPicker, ShareButton, SharePanel toggle,
 *     DevModePanel toggle, ThemeToggle) is hidden in spectator mode —
 *     those mutate host state a guest can't drive.
 *
 * The wrapper-per-mode shape is deliberate: each wrapper calls exactly
 * one data hook so we never spin up the unused hook's fetch + SSE just
 * to discard it. Mode does not change for the lifetime of an instance
 * (App.tsx renders a fresh tree on route swap), so the wrapper split
 * doesn't lose any behaviour.
 */
export type ProjectDetailProps =
  | {
      mode: "author";
      slug: string;
      onBack: () => void;
      onOpenProject: (slug: string) => void;
    }
  | {
      mode: "spectator";
      id: string;
      onBack: () => void;
      onOpenProject: (slug: string) => void;
    };

export function ProjectDetail(props: ProjectDetailProps) {
  if (props.mode === "spectator") {
    return (
      <ProjectDetailSpectator
        id={props.id}
        onBack={props.onBack}
        onOpenProject={props.onOpenProject}
      />
    );
  }
  return (
    <ProjectDetailAuthor
      slug={props.slug}
      onBack={props.onBack}
      onOpenProject={props.onOpenProject}
    />
  );
}

function ProjectDetailAuthor({
  slug,
  onBack,
  onOpenProject,
}: {
  slug: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const source = useProjectFromHost(slug);
  const send = source.send;
  const consumedRef = useRef(false);

  useEffect(() => {
    // Hero→project handoff. Two double-fire defenses:
    //   - `consumedRef` (component-instance scope) blocks a second setup pass
    //     under React StrictMode (which runs setup → cleanup → setup in dev).
    //   - `takePendingPrompt` is read-and-remove, so even if consumedRef were
    //     bypassed, the bucket only yields the prompt once.
    //
    // No `cancelled` guard inside the IIFE: under StrictMode the cleanup ran
    // before the async hop resolved, so any cancelled flag flipped true and
    // suppressed the only call to `send()` — leaving the chat pane idle and
    // the user staring at a "dead window". `send()` itself is idempotent
    // against an already-running stream, so re-entry is harmless.
    if (consumedRef.current) return;
    if (!send) return;
    const pending = takePendingPrompt(slug);
    if (!pending) return;
    consumedRef.current = true;

    (async () => {
      let images = pending.imagePaths;
      if (images.length > 0) {
        try {
          const adoption = await api.adoptUploads(slug, images);
          images = images.map((old) => adoption.mapping[old] ?? old);
        } catch {
          images = [];
        }
      }
      const decorated = pending.figmaUrl
        ? decoratePromptWithFigma(pending.prompt, pending.figmaUrl)
        : pending.prompt;
      send(decorated, images);
    })();
  }, [slug, send]);

  return (
    <ProjectDetailShell
      mode="author"
      routeKey={slug}
      source={source}
      onBack={onBack}
      onOpenProject={onOpenProject}
    />
  );
}

function ProjectDetailSpectator({
  id,
  onBack,
  onOpenProject,
}: {
  id: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const source = useProjectFromMirror(id);
  // Spectator iframes hit the shared-projects compile endpoint — host's
  // `/api/frames/:slug/:frame` 404s for guests because the TSX lives in
  // the mirror cache, not under `projects/`. Memoize keyed on `id` so
  // child memoized iframes don't see a fresh function identity each render
  // and re-mount unnecessarily.
  const frameSrcOverride = useCallback(
    (slug: string) =>
      `/api/shared-projects/${encodeURIComponent(id)}/frame/${encodeURIComponent(slug)}`,
    [id],
  );
  return (
    <ProjectDetailShell
      mode="spectator"
      routeKey={id}
      source={source}
      onBack={onBack}
      onOpenProject={onOpenProject}
      frameSrcOverride={frameSrcOverride}
    />
  );
}

function ProjectDetailShell({
  mode,
  routeKey,
  source,
  onBack,
  onOpenProject,
  frameSrcOverride,
}: {
  mode: "author" | "spectator";
  routeKey: string;
  source: ProjectShellSource;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
  frameSrcOverride?: (frameSlug: string) => string;
}) {
  const isSpectator = mode === "spectator";
  // Optimistic local override for the theme toggle. Author-only path:
  // spectators never call `toggleProjectMode`, so the override stays null
  // for them. Kept here (rather than nested in the author wrapper) to
  // avoid re-mounting state on a hypothetical future mode-flip — and to
  // keep one shared shell.
  const [localModeOverride, setLocalModeOverride] =
    useState<"light" | "dark" | null>(null);
  const project = source.project
    ? localModeOverride
      ? { ...source.project, mode: localModeOverride }
      : source.project
    : null;
  const { presence, refresh: refreshProject, chatStream, chatHistory, postComment } = source;
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
    const stored = window.localStorage.getItem(`${ZOOM_STORAGE_PREFIX}${routeKey}`);
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
    window.localStorage.setItem(`${ZOOM_STORAGE_PREFIX}${routeKey}`, String(zoom));
  }, [routeKey, zoom]);

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
    // Theme toggle is a host-only mutation (`PATCH /api/projects/:slug`);
    // the spectator UI never renders ThemeToggle, so this guard is
    // belt-and-suspenders.
    if (!project || isSpectator) return;
    const previous = project.mode;
    const next = previous === "dark" ? "light" : "dark";
    setLocalModeOverride(next);
    try {
      const res = await fetch(`/api/projects/${routeKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error("Failed to save theme");
      setReloadKey((k) => k + 1);
      // Re-pull the canonical record before clearing the local override —
      // otherwise we briefly render the stale pre-PATCH `source.project`
      // (with the old mode) between the clear and the refetch landing,
      // producing a visible theme flash.
      await refreshProject();
      setLocalModeOverride(null);
    } catch {
      setLocalModeOverride(previous);
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
            {!isSpectator ? (
              <ProjectPicker
                project={project}
                onHome={onBack}
                onOpenProject={onOpenProject}
                onRenamed={() => refreshProject()}
              />
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <BackButton onClick={onBack} />
                <span>{project.name}</span>
              </span>
            )}
          </>
        }
        right={
          <>
            <PresenceStrip host={host} guests={guests} />
            {!isSpectator && (
              <>
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
            )}
          </>
        }
      />
      {!isSpectator && showShare && (
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
          <ChatPane
            projectSlug={project.slug}
            history={chatHistory}
            seedRef={seedChatRef}
            readonly={isSpectator}
            postComment={postComment}
          />
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
            readonly={isSpectator}
            frameSrcOverride={frameSrcOverride}
            agentCursor={chatStream.state.agentCursor}
            phase={chatStream.state.phase}
            narrations={chatStream.state.narrations}
          />
        </main>
        {!isSpectator && devOpen && <DevModePanel slug={project.slug} />}
      </div>
    </div>
    </TargetSelectionProvider>
    </ChatStreamProvider>
  );
}
