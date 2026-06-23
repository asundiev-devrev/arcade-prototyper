import { useEffect, useState, useRef } from "react";
import { useToast } from "@xorkavi/arcade-gen";
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";
import { ViewportPreview } from "./ViewportPreview";
import { NewFrameCard } from "./NewFrameCard";
import { api } from "../../lib/api";
import { LoadingShow } from "./LoadingShow";
import { useEditSession } from "../../hooks/editSessionContext";
import { useDialogs } from "../feedback/Dialogs";
import type { TurnPhase } from "../../hooks/chatStreamReducer";

export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
  zoom,
  onZoomChange,
  onSeedChat,
  phase = "idle",
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  onSeedChat: (text: string) => void;
  phase?: TurnPhase;
}) {
  const { frames, refresh } = useFrames(project);
  const [creatingFrame, setCreatingFrame] = useState(false);
  const { frameSlug, clear } = useEditSession();
  const { toast } = useToast();
  const { confirm } = useDialogs();
  const [highlight, setHighlight] = useState<{
    slug: string;
    kind: "target" | "missing";
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  async function handleCreateFrame() {
    if (creatingFrame) return;
    setCreatingFrame(true);
    try {
      const frame = await api.createFrame(project.slug);
      onSeedChat(`Design the ${frame.name} screen: `);
    } catch (err) {
      console.warn("[Viewport] createFrame failed:", err);
    } finally {
      setCreatingFrame(false);
    }
  }

  async function handleDeleteFrame(deletedFrameSlug: string) {
    const frame = frames.find((f) => f.slug === deletedFrameSlug);
    const label = frame?.name ?? deletedFrameSlug;
    const ok = await confirm({
      title: `Delete "${label}"?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteFrame(project.slug, deletedFrameSlug);
      if (frameSlug === deletedFrameSlug) clear();
      void refresh();
      toast({ title: "Frame deleted", intent: "success" });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    }
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "arcade-studio:frame-error"
      ) {
        return;
      }
      const payload = data as { slug?: string; frame?: string; message?: string };
      if (payload.slug !== project.slug) return;
      void fetch("/api/runtime-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: payload.slug,
          frame: payload.frame,
          message: payload.message,
        }),
      })
        .then(() => {
          // Server has appended the "Auto-repairing…" system message into
          // the project's chat-history.json (and another when the auto-fix
          // turn finishes). Nudge the chat pane to reload so the user sees
          // the breadcrumb without waiting for the next turn-end refresh.
          window.dispatchEvent(
            new CustomEvent("arcade-studio:refresh-chat-history"),
          );
        })
        .catch(() => {
          // non-critical; the iframe overlay already shows the error
        });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [project.slug]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "arcade-studio:navigate"
      ) {
        return;
      }
      const payload = data as { target?: unknown; source?: unknown };
      const target = typeof payload.target === "string" ? payload.target : null;
      const source = typeof payload.source === "string" ? payload.source : null;
      if (!target) return;

      // Defense-in-depth: frame slugs are constrained to [a-z0-9-]+ server-side
      // (see projectSchema in server/types.ts), so selector injection isn't
      // reachable today. Still escape if CSS.escape is available, fall back to
      // a conservative pattern check otherwise (jsdom lacks CSS.escape).
      const safeTarget = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(target)
        : /^[a-z0-9-]+$/i.test(target) ? target : null;
      if (!safeTarget) return;
      const targetEl = document.querySelector<HTMLElement>(
        `[data-frame-slug="${safeTarget}"]`,
      );
      if (!targetEl) {
        console.warn(`[Viewport] FrameLink target "${target}" not found`);
        if (source) {
          setHighlight({ slug: source, kind: "missing" });
          window.setTimeout(() => setHighlight(null), 600);
        }
        return;
      }

      targetEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      setHighlight({ slug: target, kind: "target" });
      window.setTimeout(() => setHighlight(null), 1100);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!frames.length) {
    // Empty + turn running: show the LoadingShow scene loop centered in
    // the viewport. Skips ViewportPreview wrapper — the loading scene is
    // a centered overlay, not a pannable/zoomable canvas, and putting it
    // through ViewportPreview's ResizeObserver-driven sizing collapses
    // the absolute layout to 0 height. Disappears as soon as the first
    // frame mounts.
    if (phase === "running") {
      return <LoadingShow />;
    }
    // Empty + idle: show the "+ New frame" CTA.
    return <EmptyViewport onCreateFrame={handleCreateFrame} busy={creatingFrame} />;
  }

  return (
    <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
      <div
        ref={containerRef}
        style={{
          position: "relative",
          display: "flex",
          gap: 64,
          padding: 32,
          height: "100%",
          width: "fit-content",
          minWidth: "100%",
        }}
      >
        {frames.map((f) => (
          <FrameCard
            key={f.slug}
            projectSlug={project.slug}
            frame={f}
            frameWidth={frameWidth}
            onFrameWidthChange={onFrameWidthChange}
            projectMode={project.mode}
            zoom={zoom}
            highlighted={highlight?.slug === f.slug ? highlight.kind : null}
            phase={phase}
            onDelete={handleDeleteFrame}
          />
        ))}
        <NewFrameCard onClick={handleCreateFrame} busy={creatingFrame} />
      </div>
    </ViewportPreview>
  );
}
