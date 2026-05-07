import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ZoomIndicator } from "./ZoomIndicator";
import { nextStep, snapToNearestStep } from "./zoomSteps";

export function ViewportPreview({
  children,
  zoom,
  onZoomChange,
}: {
  children: ReactNode;
  zoom: number;
  onZoomChange: (next: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

  // Track unscaled content size so the wrapper can expand to match scaled bounds.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContentSize({
        width: el.scrollWidth,
        height: el.scrollHeight,
      });
    });
    observer.observe(el);
    // Initial measurement.
    setContentSize({ width: el.scrollWidth, height: el.scrollHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    function onWheel(e: WheelEvent) {
      // Only intercept when ⌘ (mac) or ctrl (other / trackpad pinch) is held.
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      const s = scrollRef.current;
      if (!s) return;
      const rect = s.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + s.scrollLeft;
      const cursorY = e.clientY - rect.top + s.scrollTop;
      const contentX = cursorX / zoom;
      const contentY = cursorY / zoom;

      const dir: "in" | "out" = e.deltaY < 0 ? "in" : "out";
      const next = nextStep(zoom, dir);
      if (next === zoom) return;
      onZoomChange(next);

      requestAnimationFrame(() => {
        const s2 = scrollRef.current;
        if (!s2) return;
        s2.scrollLeft = contentX * next - (e.clientX - rect.left);
        s2.scrollTop = contentY * next - (e.clientY - rect.top);
      });
    }

    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [zoom, onZoomChange]);

  const fitToScreen = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || contentSize.width === 0 || contentSize.height === 0) return;
    const vw = scroll.clientWidth;
    const vh = scroll.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const fitX = vw / contentSize.width;
    const fitY = vh / contentSize.height;
    const raw = Math.min(fitX, fitY) * 0.95;
    const next = snapToNearestStep(raw);
    onZoomChange(next);
    requestAnimationFrame(() => {
      const s = scrollRef.current;
      if (!s) return;
      s.scrollLeft = (contentSize.width * next - vw) / 2;
      s.scrollTop = (contentSize.height * next - vh) / 2;
    });
  }, [contentSize.width, contentSize.height, onZoomChange]);

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--surface-shallow)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentSize.width * zoom,
          height: contentSize.height * zoom,
        }}
      >
        <div ref={contentRef} style={{ width: "fit-content", minWidth: "100%" }}>
          {children}
        </div>
      </div>
      <ZoomIndicator
        zoom={zoom}
        onZoomChange={onZoomChange}
        onFitToScreen={fitToScreen}
      />
    </div>
  );
}
