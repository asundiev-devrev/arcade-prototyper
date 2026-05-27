import { useEffect, useState } from "react";
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";
import { ViewportPreview } from "./ViewportPreview";
import { NewFrameCard } from "./NewFrameCard";
import { api } from "../../lib/api";

export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
  zoom,
  onZoomChange,
  onSeedChat,
  // Spectator mode passes `readonly`. Task 5 will gate destructive
  // affordances on this. Accepted here so the prop typechecks today
  // and threading from `ProjectDetail` (Task 4) compiles.
  readonly: _readonly,
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  onSeedChat: (text: string) => void;
  readonly?: boolean;
}) {
  void _readonly;
  const { frames } = useFrames(project);
  const [creatingFrame, setCreatingFrame] = useState(false);
  const [highlight, setHighlight] = useState<{
    slug: string;
    kind: "target" | "missing";
  } | null>(null);

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
      }).catch(() => {
        // non-critical; the UI already shows the error
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

  if (!frames.length) return <EmptyViewport onCreateFrame={handleCreateFrame} busy={creatingFrame} />;

  return (
    <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
      <div
        style={{
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
          />
        ))}
        <NewFrameCard onClick={handleCreateFrame} busy={creatingFrame} />
      </div>
    </ViewportPreview>
  );
}
