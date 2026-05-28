import { useEffect, useState, type RefObject } from "react";
import type { Frame } from "../../../server/types";
import type { StreamState } from "../../hooks/chatStreamReducer";
import { mapPathToFrame } from "../../lib/agentCursor";

const POINTER_SIZE = 18;

export function _hashCoords(seed: string, w: number, h: number): { x: number; y: number } {
  let h32 = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h32 = (h32 * 31 + seed.charCodeAt(i)) | 0;
  }
  const x = Math.abs(h32) % Math.max(1, Math.floor(w - POINTER_SIZE));
  const y = Math.abs(h32 >> 8) % Math.max(1, Math.floor(h - POINTER_SIZE));
  return { x, y };
}

export function EditCursor({
  agentCursor,
  containerRef,
  frames,
  loadedSlugs,
}: {
  agentCursor: StreamState["agentCursor"];
  containerRef: RefObject<HTMLDivElement | null>;
  frames: Frame[];
  loadedSlugs: ReadonlySet<string>;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const slug = agentCursor
    ? agentCursor.frame ?? mapPathToFrame(agentCursor.filePath ?? "", frames)
    : null;

  const shouldShow = Boolean(
    agentCursor && agentCursor.action === "editing" && slug && loadedSlugs.has(slug),
  );

  useEffect(() => {
    if (!shouldShow || !slug || !agentCursor) {
      setPos(null);
      return;
    }
    function recompute() {
      const container = containerRef.current;
      if (!container) return;
      const cardEl = container.querySelector<HTMLElement>(`[data-frame-slug="${slug}"]`);
      if (!cardEl) return;
      const cardRect = cardEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const seed = (agentCursor!.filePath ?? "") + (agentCursor!.narration ?? "");
      const local = _hashCoords(seed.slice(0, 64), cardRect.width, cardRect.height);
      setPos({
        x: cardRect.left - containerRect.left + local.x,
        y: cardRect.top - containerRect.top + local.y,
      });
    }
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [shouldShow, slug, agentCursor, containerRef]);

  if (!shouldShow || !pos) return null;

  return (
    <div
      data-testid="edit-cursor"
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
  );
}
