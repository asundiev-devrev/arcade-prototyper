import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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

  useEffect(() => {
    // Narrow predicate for the zoom keys: skip only when focus is in a text
    // editor. Buttons/selects don't care about ⌘+/-/0/1 and we don't want the
    // shortcuts to silently no-op after the user clicks a toolbar icon.
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

      // ⌘+ (with or without shift) and ⌘=
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
    // fitToScreen is a useCallback with its own deps; it's stable unless
    // contentSize or onZoomChange changes. Including zoom ensures closures
    // see the fresh value when `nextStep` is called.
  }, [zoom, onZoomChange, fitToScreen]);

  useEffect(() => {
    function isTextTargetActive(): boolean {
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
      if (isTextTargetActive()) return;
      if (!spaceHeld) {
        e.preventDefault(); // prevent page scroll
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

  useEffect(() => {
    if (!panning) return;
    function onMove(e: MouseEvent) {
      const s = scrollRef.current;
      const st = panStateRef.current;
      if (!s || !st) return;
      s.scrollLeft = st.startScrollLeft - (e.clientX - st.startX);
      s.scrollTop = st.startScrollTop - (e.clientY - st.startY);
    }
    function onUp() {
      setPanning(false);
      panStateRef.current = null;
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
  }, [panning]);

  function startPan(e: ReactMouseEvent) {
    const s = scrollRef.current;
    if (!s) return;
    e.preventDefault();
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: s.scrollLeft,
      startScrollTop: s.scrollTop,
    };
    setPanning(true);
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      onMouseDown={(e) => {
        // Middle mouse → always pan. Space held + primary button → pan.
        if (e.button === 1 || (e.button === 0 && spaceHeld)) {
          startPan(e);
        }
      }}
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--surface-shallow)",
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
