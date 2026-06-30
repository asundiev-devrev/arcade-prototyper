import { useEffect, useRef, useState } from "react";
import { ArrowUpRightSmall, IconButton, Tooltip, TrashBin, useToast, Button } from "@xorkavi/arcade-gen";
import type { Frame } from "../../../server/types";
import { useEditSession } from "../../hooks/editSessionContext";
import type { TurnPhase } from "../../hooks/chatStreamReducer";
import { SaveComponentModal } from "../assets/SaveComponentModal";

const FRAME_WIDTH_MIN = 320;
const FRAME_WIDTH_MAX = 2560;

function CrosshairIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export function FrameCard({
  projectSlug,
  frame,
  frameWidth,
  onFrameWidthChange,
  projectMode,
  zoom,
  highlighted,
  phase = "idle",
  onDelete,
}: {
  projectSlug: string;
  frame: Frame;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  projectMode: "light" | "dark";
  zoom: number;
  /** When set, paints a temporary outline: "target" = blue (nav success),
   *  "missing" = red (nav target not found). `null`/`undefined` = no highlight. */
  highlighted?: "target" | "missing" | null;
  phase?: TurnPhase;
  onDelete?: (frameSlug: string) => void;
}) {
  const [resizing, setResizing] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wipeWrapperRef = useRef<HTMLDivElement | null>(null);
  const { batch, frameSlug: sessionFrameSlug, addOrFocus, setInspectorOpen, clear, frameWindow } = useEditSession();
  const { toast } = useToast();

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
      const zoomSafe = zoom > 0 ? zoom : 1;
      const next = s.startWidth + (e.clientX - s.startX) / zoomSafe;
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
  }, [resizing, onFrameWidthChange, zoom]);

  // Picking-gated effect: manages picker lifecycle in the iframe.
  useEffect(() => {
    if (!picking) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "arcade-studio:frame-pick-start" },
      "*",
    );
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      const t = (data as { type?: unknown }).type;
      if (t === "arcade-studio:frame-picked") {
        const selection = (data as { selection?: import("../../hooks/editSessionContext").ElementSelection }).selection;
        if (selection) {
          const win = iframeRef.current?.contentWindow ?? null;
          // Cross-frame guard: a batch is single-frame. If the user picks in a
          // different frame than the active batch, reset the old frame's
          // previews and start fresh in this frame.
          if (sessionFrameSlug && sessionFrameSlug !== frame.slug) {
            frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
            clear();
          }
          addOrFocus(selection, frame.slug, win);
          setInspectorOpen(true);
          // Component vs. in-frame is now decided in the inspector panel (it
          // grays fields + shows Customize when the source isn't this frame's
          // own index.tsx). No in-iframe chip to surface here anymore.
        }
        // NOTE: do NOT setPicking(false) — bulk picking stays active.
      } else if (t === "arcade-studio:frame-pick-cancelled") {
        const reason = (data as { reason?: string }).reason;
        if (reason && reason !== "escape" && reason !== "no-target") {
          const msg =
            reason === "no-source"
              ? "Couldn't locate this element's source file."
              : reason === "no-fiber"
              ? "That's not a React element we can target."
              : "Pick failed.";
          toast({ title: "Couldn't target element", description: msg, intent: "alert" });
        }
        setPicking(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPicking(false);
      }
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
      iframeRef.current?.contentWindow?.postMessage(
        { type: "arcade-studio:frame-pick-stop" },
        "*",
      );
    };
  }, [picking, frame.slug, addOrFocus, setInspectorOpen, clear, frameWindow, sessionFrameSlug, toast]);

  function onIframeLoad() {
    if (phase !== "running") return;
    const wrapper = wipeWrapperRef.current;
    if (!wrapper) return;
    // Restart animation cleanly if a previous wipe is still mid-flight.
    wrapper.classList.remove("arcade-studio-frame-wipe");
    // Force reflow so adding the class restarts the animation.
    void wrapper.offsetWidth;
    wrapper.classList.add("arcade-studio-frame-wipe");
  }

  function onWrapperAnimationEnd() {
    wipeWrapperRef.current?.classList.remove("arcade-studio-frame-wipe");
  }

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
  const frameUrl = `/api/frames/${projectSlug}/${frame.slug}?mode=${projectMode}`;
  const isTargetedFrame = sessionFrameSlug === frame.slug && batch.length > 0;
  const lastSelection = batch[batch.length - 1]?.selection ?? null;

  return (
    <div
      style={{ flex: "none" }}
      data-frame-slug={frame.slug}
      data-nav-highlight={highlighted ?? undefined}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
        }}
      >
        <span>{frame.name}</span>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg-neutral-tertiary)",
          }}
        >
          {Math.round(clampedWidth)}px
        </span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 4,
            opacity: picking || isTargetedFrame ? 1 : 0.5,
            transition: "opacity 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const base = picking || isTargetedFrame ? "1" : "0.5";
            (e.currentTarget as HTMLDivElement).style.opacity = base;
          }}
        >
          <Tooltip
            content={
              picking
                ? "Cancel (Esc)"
                : isTargetedFrame
                ? `Editing ${batch.length} element(s) — click to clear`
                : "Pick an element to target in chat"
            }
          >
            <IconButton
              aria-label={
                picking
                  ? "Cancel element picker"
                  : isTargetedFrame
                  ? "Clear targeted element"
                  : "Pick element"
              }
              aria-pressed={picking || isTargetedFrame}
              variant={picking || isTargetedFrame ? "primary" : "tertiary"}
              onClick={() => {
                if (picking) { setPicking(false); setInspectorOpen(false); return; }
                if (isTargetedFrame) { clear(); return; }
                setInspectorOpen(true); setPicking(true);
              }}
            >
              <CrosshairIcon />
            </IconButton>
          </Tooltip>
          {isTargetedFrame && (
            <Tooltip content="Save as component">
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => setShowSaveModal(true)}
                style={{ fontSize: 11, padding: "4px 8px" }}
              >
                Save as component
              </Button>
            </Tooltip>
          )}
          <IconButton
            aria-label="Open frame in new tab"
            variant="tertiary"
            onClick={() => window.open(frameUrl, "_blank", "noopener,noreferrer")}
          >
            <ArrowUpRightSmall size={16} aria-hidden="true" />
          </IconButton>
          {onDelete && (
            <Tooltip content="Delete frame">
              <IconButton
                aria-label="Delete frame"
                variant="tertiary"
                onClick={() => onDelete(frame.slug)}
              >
                <TrashBin size={16} aria-hidden="true" />
              </IconButton>
            </Tooltip>
          )}
        </div>
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
        {highlighted && (
          <span
            key={`${highlighted}-${frame.slug}-${Date.now()}`}
            className="arcade-studio-nav-pulse"
            data-kind={highlighted}
            aria-hidden="true"
          />
        )}
        <div
          ref={wipeWrapperRef}
          onAnimationEnd={onWrapperAnimationEnd}
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--surface-overlay)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: picking
              ? "inset 0 0 0 2px var(--component-button-primary-bg-idle)"
              : undefined,
            transition: "box-shadow 0.2s ease",
          }}
        >
          <iframe
            ref={iframeRef}
            key={projectMode}
            title={frame.name}
            src={frameUrl}
            onLoad={onIframeLoad}
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
      {showSaveModal && lastSelection && isTargetedFrame && (
        <SaveComponentModal
          target={lastSelection}
          frameSlug={frame.slug}
          projectSlug={projectSlug}
          onClose={() => setShowSaveModal(false)}
          onSaved={(name) => {
            clear();
            setShowSaveModal(false);
            toast({ title: `Saved ${name}` });
          }}
        />
      )}
    </div>
  );
}
