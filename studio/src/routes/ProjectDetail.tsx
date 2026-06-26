import { useCallback, useEffect, useRef, useState } from "react";
import { Viewport } from "../components/viewport/Viewport";
import { LeftPaneTabs, type LeftPaneTab, LEFT_PANE_TAB_KEY } from "../components/shell/LeftPaneTabs";
import { LeftPaneTabToggle } from "../components/shell/LeftPaneTabToggle";
import { DevModePanel } from "../components/devmode/DevModePanel";
import { InspectorPanel } from "../components/inspector/InspectorPanel";
import { StudioHeader } from "../components/shell/StudioHeader";
import { ThemeToggle } from "../components/shell/ThemeToggle";
import { ShareButton } from "../components/shell/ShareButton";
import { CanvasToggle } from "../components/shell/CanvasToggle";
import { ChatToggle } from "../components/shell/ChatToggle";
import { ProjectPicker } from "../components/shell/ProjectPicker";
import { ChatStreamProvider } from "../hooks/chatStreamContext";
import { EditSessionProvider, useEditSession } from "../hooks/editSessionContext";
import { EditBlocksProvider, useEditBlocks } from "../hooks/editBlocksContext";
import { postEditUndo } from "../lib/visualEditClient";
import { takePendingBlockPreamble } from "../components/inspector/InspectorPanel";
import { useProjectFromHost } from "../hooks/useProjectFromHost";
import type { Project, ChimeIn } from "../../server/types";
import { takePendingPrompt, peekPendingPrompt } from "../lib/pendingPrompt";
import { decoratePromptWithFigma } from "../lib/figmaUrl";
import { api } from "../lib/api";

const CHAT_OPEN_STORAGE_KEY = "studio:chatPaneOpen";
const CHAT_WIDTH_STORAGE_KEY = "studio:chatPaneWidth";
const CHAT_WIDTH_DEFAULT = 400;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 720;
const FRAME_WIDTH_STORAGE_KEY = "studio:frameWidth";
const FRAME_WIDTH_DEFAULT = 1440;
const ZOOM_STORAGE_PREFIX = "studio:zoom:";
const ZOOM_DEFAULT = 1.0;

export interface ProjectDetailProps {
  slug: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}

export function ProjectDetail({ slug, onBack, onOpenProject }: ProjectDetailProps) {
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
    <EditSessionProvider>
      <EditBlocksProvider>
        <ProjectDetailShell
          routeKey={slug}
          source={source}
          onBack={onBack}
          onOpenProject={onOpenProject}
        />
      </EditBlocksProvider>
    </EditSessionProvider>
  );
}

function ProjectDetailShell({
  routeKey,
  source,
  onBack,
  onOpenProject,
}: {
  routeKey: string;
  source: ReturnType<typeof useProjectFromHost>;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const { inspectorOpen, inspectorWidth } = useEditSession();
  const { blocks, setStatus, removeBlock } = useEditBlocks();
  // Optimistic local override for the theme toggle.
  const [localModeOverride, setLocalModeOverride] =
    useState<"light" | "dark" | null>(null);
  // Hero-handoff cold start: when the user submits from the home page we
  // create the project and navigate here BEFORE `GET /api/projects/:slug`
  // has resolved. Blocking the whole route on `source.project` (the old
  // behavior) hid the chat pane behind a full-screen "Loading project…",
  // so the turn that's already running server-side showed no "Working…",
  // no Stop button, nothing — the pane looked frozen for the first seconds.
  //
  // If a pending hero prompt exists for this slug, synthesize an optimistic
  // placeholder project so the shell + ChatPane mount immediately and the
  // optimistic "Working…" row paints at once. The real record replaces it
  // a beat later when the fetch lands.
  const optimisticProject: Project | null =
    !source.project && peekPendingPrompt(routeKey)
      ? {
          name: routeKey,
          slug: routeKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          theme: "arcade",
          mode: "light",
          frames: [],
          chimeIns: [],
        }
      : null;
  const baseProject = source.project ?? optimisticProject;
  const project = baseProject
    ? localModeOverride
      ? { ...baseProject, mode: localModeOverride }
      : baseProject
    : null;
  const { refresh: refreshProject, chatStream, chatHistory } = source;

  // Chime-ins: product-truth notes the Computer raised about generated
  // frames. Poll while mounted so a background drift check (which lands a
  // few seconds after a turn ends) surfaces without a manual refresh.
  const [chimeIns, setChimeIns] = useState<ChimeIn[]>([]);

  const refreshChimeIns = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${routeKey}/chime-ins`);
      // Only trust a genuine JSON array. During a Vite middleware restart the
      // route can briefly fall through to the SPA's index.html (a 200 with
      // text/html); parsing that throws and a non-array would wrongly clear
      // visible notes. Ignore anything that isn't a JSON array.
      if (!r.ok) return;
      if (!r.headers.get("content-type")?.includes("application/json")) return;
      const data = await r.json();
      if (Array.isArray(data)) setChimeIns(data);
    } catch {
      /* best-effort — leave existing notes untouched */
    }
  }, [routeKey]);

  useEffect(() => {
    void refreshChimeIns();
    const id = window.setInterval(() => void refreshChimeIns(), 5000);
    return () => window.clearInterval(id);
  }, [refreshChimeIns]);

  const handleApplyChimeIn = useCallback(
    async (c: ChimeIn) => {
      // A turn is already running — re-prompting now would be rejected as
      // "busy" and silently lost. Leave the note in place so the user can
      // Apply again once the current turn finishes.
      if (chatStream.state.phase === "running") return;
      await fetch(`/api/projects/${routeKey}/chime-ins/${c.id}/apply`, { method: "POST" });
      setChimeIns((list) => list.filter((x) => x.id !== c.id));
      source.send?.(
        `Computer flagged a product-truth issue: ${c.objection}. Please adjust the frame to match how DevRev actually works.`,
      );
    },
    [routeKey, source, chatStream.state.phase],
  );

  const handleDismissChimeIn = useCallback(
    async (c: ChimeIn) => {
      await fetch(`/api/projects/${routeKey}/chime-ins/${c.id}/dismiss`, { method: "POST" });
      setChimeIns((list) => list.filter((x) => x.id !== c.id));
    },
    [routeKey],
  );

  // Undo an instant block: revert the deterministic write on disk (LIFO at the
  // server), then mark the block undone. Also evict any stashed preamble.
  const handleUndoBlock = useCallback(
    async (id: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block) return;
      const result = await postEditUndo(routeKey, block.frameSlug);
      if (!result.ok) {
        console.warn(`Undo failed for block ${id} (frame ${block.frameSlug})`);
        return;
      }
      takePendingBlockPreamble(id);
      setStatus(id, "undone");
    },
    [routeKey, blocks, setStatus],
  );

  // Apply a pending AI block: send the stashed scoped preamble to the agent and
  // flip the block to working. (The reading also evicts the side-map entry.)
  const handleApplyBlock = useCallback(
    (id: string) => {
      const preamble = takePendingBlockPreamble(id);
      if (!preamble) return;
      source.send?.(preamble);
      setStatus(id, "working");
    },
    [source, setStatus],
  );

  // Discard a pending AI block: drop it from the stream and evict its preamble.
  const handleDiscardBlock = useCallback(
    (id: string) => {
      takePendingBlockPreamble(id);
      removeBlock(id);
    },
    [removeBlock],
  );

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
  const [leftTab, setLeftTab] = useState<LeftPaneTab>(() => {
    if (typeof window === "undefined") return "chat";
    return window.localStorage.getItem(LEFT_PANE_TAB_KEY) === "assets" ? "assets" : "chat";
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

  useEffect(() => {
    window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(chatOpen));
  }, [chatOpen]);

  useEffect(() => {
    window.localStorage.setItem(LEFT_PANE_TAB_KEY, leftTab);
  }, [leftTab]);

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
    if (!project) return;
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
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100vh" }}>
      <StudioHeader
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              // Span the chat-panel width (minus the header's 16px left pad)
              // so the Chat/Assets toggle right-aligns to the panel's edge.
              width: chatOpen ? chatWidth - 16 : undefined,
              minWidth: 0,
            }}
          >
            <ChatToggle active={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
            <ProjectPicker
              project={project}
              onHome={onBack}
              onOpenProject={onOpenProject}
              onRenamed={() => refreshProject()}
            />
            {chatOpen && (
              <div style={{ marginLeft: "auto" }}>
                <LeftPaneTabToggle tab={leftTab} onTabChange={setLeftTab} />
              </div>
            )}
          </div>
        }
        right={
          <>
            <ThemeToggle mode={project.mode} onToggle={toggleProjectMode} />
            <ShareButton project={project} />
            <CanvasToggle active={devOpen} onToggle={() => setDevOpen((o) => !o)} />
          </>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${chatOpen ? `${chatWidth}px` : "0px"} 1fr${devOpen ? " auto" : ""}${inspectorOpen ? ` ${inspectorWidth}px` : ""}`,
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
          <LeftPaneTabs
            tab={leftTab}
            onTabChange={setLeftTab}
            projectSlug={project.slug}
            history={chatHistory}
            seedRef={seedChatRef}
            chimeIns={chimeIns}
            onApplyChimeIn={handleApplyChimeIn}
            onDismissChimeIn={handleDismissChimeIn}
            onUndoBlock={handleUndoBlock}
            onApplyBlock={handleApplyBlock}
            onDiscardBlock={handleDiscardBlock}
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
            phase={chatStream.state.phase}
          />
        </main>
        {devOpen && <DevModePanel slug={project.slug} />}
        <InspectorPanel onSend={(p, imgs) => source.send(p, imgs)} busy={chatStream.state.phase === "running"} slug={project.slug} />
      </div>
    </div>
    </ChatStreamProvider>
  );
}
