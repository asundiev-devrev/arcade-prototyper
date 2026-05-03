import { useEffect, useRef, useState } from "react";
import type { Frame } from "../../../server/types";
import { useChatStreamContext } from "../../hooks/chatStreamContext";

const FRAME_WIDTH_MIN = 320;
const FRAME_WIDTH_MAX = 2560;

export function FrameCard({
  projectSlug,
  frame,
  frameWidth,
  onFrameWidthChange,
  projectMode,
}: {
  projectSlug: string;
  frame: Frame;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  projectMode: "light" | "dark";
}) {
  const { state, refine } = useChatStreamContext();
  const [resizing, setResizing] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
      const next = s.startWidth + (e.clientX - s.startX);
      onFrameWidthChange(
        Math.min(FRAME_WIDTH_MAX, Math.max(FRAME_WIDTH_MIN, next)),
      );
    }
    function onUp() {
      setResizing(false);
      resizeRef.current = null;
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
  }, [resizing, onFrameWidthChange]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: frameWidth };
    setResizing(true);
  }

  const clampedWidth = Math.min(
    FRAME_WIDTH_MAX,
    Math.max(FRAME_WIDTH_MIN, frameWidth),
  );
  const handleVisible = hoverHandle || resizing;

  return (
    <div style={{ flex: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
          color: "var(--fg-neutral-subtle)",
        }}
      >
        <span>{frame.name}</span>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg-neutral-tertiary)",
          }}
        >
          {clampedWidth}px
        </span>
        <button
          type="button"
          title="Refine this frame against the most recent reference image in chat"
          disabled={state.busy}
          onClick={() => void refine(frame.slug)}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "var(--surface-overlay)",
            color: state.busy ? "var(--fg-neutral-tertiary)" : "var(--fg-neutral-primary)",
            cursor: state.busy ? "not-allowed" : "pointer",
          }}
        >
          Refine against reference
        </button>
      </div>
      <div
        style={{
          position: "relative",
          width: clampedWidth,
          height: "calc(100vh - 180px)",
          transition: resizing ? "none" : "width 200ms ease-out",
          willChange: "width",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--surface-shallow)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <iframe
            key={projectMode}
            title={frame.name}
            src={`/api/frames/${projectSlug}/${frame.slug}?mode=${projectMode}`}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: resizing ? "none" : "auto",
            }}
          />
        </div>
        <div
          role="separator"
          aria-label="Resize frame"
          aria-orientation="vertical"
          aria-valuenow={clampedWidth}
          aria-valuemin={FRAME_WIDTH_MIN}
          aria-valuemax={FRAME_WIDTH_MAX}
          title="Drag to resize frame"
          onMouseDown={startResize}
          onMouseEnter={() => setHoverHandle(true)}
          onMouseLeave={() => setHoverHandle(false)}
          style={{
            position: "absolute",
            top: 0,
            right: -12,
            width: 16,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "col-resize",
            zIndex: 2,
            background: "transparent",
          }}
        >
          <div
            style={{
              width: 4,
              height: 48,
              borderRadius: 4,
              background: handleVisible
                ? "var(--component-button-primary-bg-idle)"
                : "var(--stroke-neutral-subtle)",
              transition: resizing ? "none" : "background 0.15s ease, height 0.15s ease",
            }}
          />
        </div>
      </div>
      {resizing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            cursor: "col-resize",
            zIndex: 9999,
          }}
        />
      )}
    </div>
  );
}
