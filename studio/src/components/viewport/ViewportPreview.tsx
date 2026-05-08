import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ZoomIndicator } from "./ZoomIndicator";
import { ZOOM_MAX, ZOOM_MIN, nextStep, snapToNearestStep } from "./zoomSteps";

// Wheel zoom is continuous (multiplicative). Each wheel unit multiplies zoom
// by exp(-deltaY * ZOOM_WHEEL_FACTOR). Clamp per-event delta so a single
// scroll-wheel notch (deltaY ≈ 100) doesn't blow past several "steps" at once.
const ZOOM_WHEEL_FACTOR = 0.005;
const ZOOM_WHEEL_MAX_DELTA = 50;

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
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

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
    setContentSize({ width: el.scrollWidth, height: el.scrollHeight });
    return () => observer.disconnect();
  }, []);

  /**
   * Apply a continuous cursor-anchored zoom. `clientX`/`clientY` are
   * parent-window client coordinates; `deltaY` is the raw wheel delta.
   *
   * Zoom is multiplicative so pinch gestures feel proportional: small
   * delta → small zoom change, regardless of current level. Scroll-up (or
   * trackpad fingers apart) → negative deltaY → zoom in.
   */
  const applyZoomAtPoint = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      const s = scrollRef.current;
      if (!s) return;
      const clamped = Math.max(-ZOOM_WHEEL_MAX_DELTA, Math.min(ZOOM_WHEEL_MAX_DELTA, deltaY));
      const factor = Math.exp(-clamped * ZOOM_WHEEL_FACTOR);
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
      if (next === zoom) return;

      const rect = s.getBoundingClientRect();
      const cursorX = clientX - rect.left + s.scrollLeft;
      const cursorY = clientY - rect.top + s.scrollTop;
      const contentX = cursorX / zoom;
      const contentY = cursorY / zoom;

      onZoomChange(next);

      requestAnimationFrame(() => {
        const s2 = scrollRef.current;
        if (!s2) return;
        s2.scrollLeft = contentX * next - (clientX - rect.left);
        s2.scrollTop = contentY * next - (clientY - rect.top);
      });
    },
    [zoom, onZoomChange],
  );

  /** Begin a pan. `clientX`/`clientY` are parent-window coordinates. */
  const beginPan = useCallback((clientX: number, clientY: number) => {
    const s = scrollRef.current;
    if (!s) return;
    panStateRef.current = {
      startX: clientX,
      startY: clientY,
      startScrollLeft: s.scrollLeft,
      startScrollTop: s.scrollTop,
    };
    setPanning(true);
  }, []);

  const updatePan = useCallback((clientX: number, clientY: number) => {
    const s = scrollRef.current;
    const st = panStateRef.current;
    if (!s || !st) return;
    s.scrollLeft = st.startScrollLeft - (clientX - st.startX);
    s.scrollTop = st.startScrollTop - (clientY - st.startY);
  }, []);

  const endPan = useCallback(() => {
    setPanning(false);
    panStateRef.current = null;
  }, []);

  // Direct wheel handler on the scroll container. Catches ⌘+wheel when the
  // cursor is over parent DOM (gaps between frames, the background, the
  // indicator pill). When the cursor is over an iframe, the frame-side
  // gestureForwarder posts a "canvas-wheel" message and the listener below
  // runs applyZoomAtPoint with the translated coordinates.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    function onWheel(e: WheelEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      applyZoomAtPoint(e.clientX, e.clientY, e.deltaY);
    }
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [applyZoomAtPoint]);

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

  // Keyboard shortcuts: ⌘+/-/0/1. Global so the gesture works whether or not
  // the viewport is focused.
  useEffect(() => {
    function isTextEditorActive(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTextEditorActive()) return;
      if (e.key === "+" || e.key === "=") {
        const next = nextStep(zoom, "in");
        if (next !== zoom) {
          e.preventDefault();
          onZoomChange(next);
        }
        return;
      }
      if (e.key === "-") {
        const next = nextStep(zoom, "out");
        if (next !== zoom) {
          e.preventDefault();
          onZoomChange(next);
        }
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        onZoomChange(1.0);
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        fitToScreen();
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, onZoomChange, fitToScreen]);

  // Space-held tracking for space-drag pan. Broader predicate than the zoom
  // shortcuts because Space activates focused buttons natively — we must not
  // preempt that.
  useEffect(() => {
    function isInteractiveTargetActive(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute("role") === "button") return true;
      return false;
    }
    function onDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (isInteractiveTargetActive()) return;
      if (!spaceHeld) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function onUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
    }
    function onBlurOrHide() {
      setSpaceHeld(false);
      setPanning(false);
      panStateRef.current = null;
    }
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") onBlurOrHide();
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlurOrHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlurOrHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [spaceHeld]);

  // Direct mousemove/mouseup while panning, for pans that started on parent
  // DOM. The transform wrapper sets pointer-events:none while panning, so
  // even drags that cross over iframes keep hitting the parent window.
  useEffect(() => {
    if (!panning) return;
    function onMove(e: MouseEvent) {
      updatePan(e.clientX, e.clientY);
    }
    function onUp() {
      endPan();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [panning, updatePan, endPan]);

  // Forwarded events from frame iframes. Iframes are a hard event boundary,
  // so the gestureForwarder runs inside each frame and posts parent-window
  // coordinates back here. We run the same actions the direct handlers do.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: unknown } | null;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      const type = data.type;
      if (type === "arcade-studio:canvas-wheel") {
        const { parentX, parentY, deltaY } = data as {
          parentX: number;
          parentY: number;
          deltaY: number;
        };
        applyZoomAtPoint(parentX, parentY, deltaY);
      } else if (type === "arcade-studio:canvas-space-down") {
        setSpaceHeld(true);
      } else if (type === "arcade-studio:canvas-space-up") {
        setSpaceHeld(false);
      } else if (type === "arcade-studio:canvas-pan-start") {
        const { parentX, parentY } = data as { parentX: number; parentY: number };
        beginPan(parentX, parentY);
      } else if (type === "arcade-studio:canvas-pan-move") {
        const { parentX, parentY } = data as { parentX: number; parentY: number };
        updatePan(parentX, parentY);
      } else if (type === "arcade-studio:canvas-pan-end") {
        endPan();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyZoomAtPoint, beginPan, updatePan, endPan]);

  function startPan(e: ReactMouseEvent) {
    e.preventDefault();
    beginPan(e.clientX, e.clientY);
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      onMouseDown={(e) => {
        if (e.button === 1 || (e.button === 0 && spaceHeld)) {
          startPan(e);
        }
      }}
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--bg-neutral-soft)",
        overflow: "auto",
        cursor: panning ? "grabbing" : spaceHeld ? "grab" : undefined,
      }}
    >
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentSize.width * zoom,
          height: contentSize.height * zoom,
          pointerEvents: panning ? "none" : "auto",
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
