/**
 * ResizeHandle — a thin draggable divider for resizing a sibling pane.
 *
 * Internal helper for ComputerSidebar (right edge) and CanvasTabs (left edge).
 * NOT exported from the kit barrel — it's pane chrome, not a standalone
 * composite. Pointer-drag updates a width via `onResize(px)`; the caller owns
 * the width state and applies it (as an inline width on the resized pane).
 *
 * `side` controls drag direction:
 * - "right": handle on the pane's right edge; dragging right grows the pane
 *   (sidebar). delta = +dx.
 * - "left": handle on the pane's left edge; dragging left grows the pane
 *   (canvas, which sits on the right). delta = -dx.
 */
import * as React from "react";

type ResizeHandleProps = {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** Extra classes (e.g. container-query hides in the rail/drawer states). */
  className?: string;
};

export function ResizeHandle({ side, width, min, max, onResize, className = "" }: ResizeHandleProps) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const delta = side === "right" ? dx : -dx;
      const next = Math.max(min, Math.min(max, startW + delta));
      onResize(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={[
        "group/resize relative z-[1] w-1 shrink-0 cursor-col-resize select-none",
        className,
      ].join(" ")}
    >
      {/* Visible hairline on hover/drag; wider invisible hit area. */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
      <span className="absolute inset-y-0 left-0 w-px bg-(--stroke-neutral-subtle) opacity-0 transition-opacity group-hover/resize:opacity-100" />
    </div>
  );
}
