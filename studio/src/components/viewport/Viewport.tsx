import { useEffect } from "react";
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";
import { ViewportPreview } from "./ViewportPreview";

export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
}) {
  const { frames } = useFrames(project);

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

  if (!frames.length) return <EmptyViewport />;

  return (
    <ViewportPreview>
      <div
        style={{
          display: "flex",
          gap: 32,
          padding: 24,
          background: "var(--surface-backdrop)",
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
          />
        ))}
      </div>
    </ViewportPreview>
  );
}
