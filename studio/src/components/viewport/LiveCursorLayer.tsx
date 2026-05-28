import { useEffect, useState, type RefObject } from "react";
import type { Frame } from "../../../server/types";
import type { StreamState, TurnPhase } from "../../hooks/chatStreamReducer";
import { mapPathToFrame } from "../../lib/agentCursor";

const POINTER_SIZE = 18;

/**
 * Pure: given a frame's rect and the layer's container rect, decide where
 * to place the pointer for the current action. Exported so tests can hit
 * the math directly — jsdom doesn't lay elements out, so the rendered
 * transform isn't observable in tests.
 */
export function targetPointFor(
  rect: DOMRect,
  containerRect: DOMRect,
  action: "reading" | "writing" | "editing" | "thinking",
  filePath?: string,
): { x: number; y: number } {
  const left = rect.left - containerRect.left;
  const top = rect.top - containerRect.top;
  if (action === "reading") {
    return { x: left + 24, y: top + 24 };
  }
  if (action === "writing" || action === "editing") {
    let h = 0;
    for (let i = 0; i < (filePath?.length ?? 0); i += 1) {
      h = (h * 31 + filePath!.charCodeAt(i)) | 0;
    }
    const fx = Math.abs(h) % Math.max(1, Math.floor(rect.width - 48));
    const fy = Math.abs(h >> 8) % Math.max(1, Math.floor(rect.height / 3));
    return { x: left + 24 + fx, y: top + 24 + fy };
  }
  return { x: left + rect.width / 2, y: top + rect.height / 2 };
}

export function LiveCursorLayer({
  agentCursor,
  phase,
  containerRef,
  frames,
}: {
  agentCursor: StreamState["agentCursor"];
  phase: TurnPhase;
  containerRef: RefObject<HTMLDivElement>;
  frames: Frame[];
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const slug =
    agentCursor && (agentCursor.frame ?? mapPathToFrame(agentCursor.filePath ?? "", frames));

  useEffect(() => {
    if (phase !== "running" || !agentCursor) {
      setPos(null);
      return;
    }
    function recompute() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      if (!slug) {
        setPos({ x: containerRect.width / 2, y: containerRect.height / 2 });
        return;
      }
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(slug)
        : slug;
      const el = container.querySelector(`[data-frame-slug="${escaped}"]`);
      if (!el) {
        setPos({ x: containerRect.width / 2, y: containerRect.height / 2 });
        return;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      setPos(targetPointFor(rect, containerRect, agentCursor!.action, agentCursor!.filePath));
    }
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [phase, agentCursor, slug, containerRef]);

  if (phase !== "running" || !agentCursor || !pos) return null;

  const bubbleText = agentCursor.narration?.slice(0, 80) ?? "";

  return (
    <>
      <div
        data-testid="live-cursor"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: POINTER_SIZE,
          height: POINTER_SIZE,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <svg
          width={POINTER_SIZE}
          height={POINTER_SIZE}
          viewBox="0 0 18 18"
          aria-hidden="true"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }}
        >
          <path
            d="M2 2 L2 14 L6 11 L9 16 L12 14 L9 9 L14 9 Z"
            fill="white"
            stroke="black"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {bubbleText && (
        <div
          data-testid="live-cursor-bubble"
          title={agentCursor.narration ?? ""}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate(${pos.x + 16}px, ${pos.y - 8}px)`,
            transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: "var(--surface-overlay)",
            color: "var(--fg-neutral-medium)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 8,
            padding: "4px 8px",
            fontSize: 12,
            maxWidth: 240,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {bubbleText}
        </div>
      )}
    </>
  );
}
