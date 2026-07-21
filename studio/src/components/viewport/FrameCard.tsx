import { useEffect, useRef, useState } from "react";
import { ArrowUpRightSmall, IconButton, Tooltip, TrashBin, useToast, Button } from "@xorkavi/arcade-gen";
import type { Frame } from "../../../server/types";
import { useEditSession } from "../../hooks/editSessionContext";
import type { TurnPhase } from "../../hooks/chatStreamReducer";
import { SaveComponentModal } from "../assets/SaveComponentModal";
import { observeFingerprint, type FpTracker } from "./visualNoOp";
import { handleDigestMessage, type RenderDigest } from "../../frame/frameDigest";

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
  onVisualNoOp,
  onRenderDigest,
  refineTimeoutMs = 90_000,
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
  /** Fired when an in-flight edit's at-rest render is pixel-identical to the
   *  prior committed render (a visual no-op candidate — a valid prop the
   *  component silently ignored). See visualNoOp.ts + the spec. */
  onVisualNoOp?: (frameSlug: string) => void;
  /** Fired once per mount with the frame's render digest (candidate elements +
   *  computed styles), forwarded from a LIVE iframe only. Render-verify buffers
   *  it in the shell to reconcile the user's requested property against the real
   *  render. See frameDigest.ts + the spec. */
  onRenderDigest?: (frameSlug: string, digest: RenderDigest) => void;
  /** Wall-clock budget (ms) for a failed edit to be auto-repaired before the
   *  "Refining…" chip flips to the terminal "couldn't fix it" state. Floor must
   *  exceed real repair latency (a claude turn + 60s rate-limit) — default 90s;
   *  overridable so tests can shrink it. */
  refineTimeoutMs?: number;
}) {
  const [resizing, setResizing] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Double-buffer: `committedNonce` is the last-good render that stays VISIBLE.
  // `reloadNonce` is the in-flight edit being validated in the hidden incoming
  // iframe. They diverge while an edit is being verified and reconverge on a
  // clean mount (swap) — an errored edit leaves committedNonce untouched so the
  // designer keeps seeing the last render that worked. `incomingLoading` gates
  // whether the hidden probe iframe is mounted at all.
  const [committedNonce, setCommittedNonce] = useState(0);
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [chip, setChip] = useState<"none" | "refining" | "terminal">("none");
  const [chipDetailOpen, setChipDetailOpen] = useState(false);
  const refineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only while an edit cycle is in flight (a reload was signalled and
  // hasn't cleanly swapped yet). Distinguishes an in-flight edit's probe
  // errors from ORDINARY at-rest runtime errors on the last-good committed
  // frame — which, after ≥1 successful edit, carry the same nonce and would
  // otherwise wrongly drive the Refining/terminal chip. Kept true THROUGH the
  // terminal state so a late frame-ready can still un-terminal (post-terminal
  // recovery); cleared only on a successful swap.
  const editCycleActive = useRef(false);
  // Nonce-keyed render-fingerprint baseline for visual-no-op detection. Holds
  // the last committed render's {fp, nonce}; each new-nonce fingerprint is
  // compared against it and then promotes. See visualNoOp.ts.
  const fpTracker = useRef<FpTracker>({ baseline: null });
  // onVisualNoOp read via a ref inside the message handler so the handler's
  // effect does NOT re-subscribe the global `message` listener every render
  // when the parent passes an inline callback (identity changes each render).
  const onVisualNoOpRef = useRef(onVisualNoOp);
  onVisualNoOpRef.current = onVisualNoOp;
  // Same ref-read pattern for onRenderDigest so the message listener's effect
  // does not re-subscribe on an inline-callback identity change (VN precedent).
  const onRenderDigestRef = useRef(onRenderDigest);
  onRenderDigestRef.current = onRenderDigest;
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

  // Targeted reload: when the server signals THIS frame changed, bump the nonce
  // so the iframe refetches — the shell and other frames stay alive.
  useEffect(() => {
    function onFrameChanged(e: Event) {
      const detail = (e as CustomEvent).detail as { slug?: string; frameId?: string };
      if (detail?.slug !== projectSlug || detail?.frameId !== frame.slug) return;
      // This frame's DOM is about to be rebuilt. Any active edit batch on THIS
      // frame holds element-ids + line/cols bound to the old DOM — stale after
      // the agent edit that triggered the reload. Keeping them risks silent
      // no-op previews and, worse, field edits writing the WRONG JSX node. Tear
      // the session down (also nulls the detached frameWindow).
      if (sessionFrameSlug === frame.slug) clear();
      // Bump the nonce (this becomes the in-flight edit's id) and arm the hidden
      // incoming iframe. Do NOT touch committedNonce — the last-good render
      // stays visible until this reload proves itself with a clean mount. A
      // fresh attempt starts hopeful: clear the chip and cancel any pending
      // terminal countdown from a prior failure.
      setReloadNonce((n) => n + 1);
      setIncomingLoading(true);
      editCycleActive.current = true;
      setChip("none");
      setChipDetailOpen(false);
      if (refineTimer.current) {
        clearTimeout(refineTimer.current);
        refineTimer.current = null;
      }
    }
    window.addEventListener("arcade-studio:frame-changed", onFrameChanged);
    return () => window.removeEventListener("arcade-studio:frame-changed", onFrameChanged);
  }, [projectSlug, frame.slug, sessionFrameSlug, clear]);

  // Double-buffer signal handler (Layer A + C). PURELY VISUAL: it swaps/keeps
  // the render and drives the chip/timer. It must NOT post to /api/runtime-error
  // — the repair-dispatch listener in Viewport.tsx owns that path. Nonce-gated:
  // messages whose `n` doesn't match the in-flight reloadNonce are late posts
  // from an outgoing (already-superseded) iframe and are ignored.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as
        | { type?: string; slug?: string; frame?: string; n?: unknown }
        | undefined;
      if (!d || typeof d !== "object") return;
      if (d.slug !== projectSlug || d.frame !== frame.slug) return;
      if (d.type === "arcade-studio:frame-fingerprint") {
        const fp = (d as { fp?: unknown }).fp;
        const n = String(d.n ?? "");
        // Only fold fingerprints from a LIVE iframe — the currently-committed
        // render (committedNonce) or the in-flight probe (reloadNonce), with the
        // 0↔"" normalization buildFrameUrl uses. A post from a superseded
        // outgoing iframe (an edit bumped reloadNonce before its probe measured)
        // carries a stale nonce that matches neither; folding it would poison the
        // baseline with a render the user never saw → a false "no-op" on the next
        // edit (the cardinal sin). Drop it.
        const liveNonce =
          n === String(committedNonce) ||
          n === String(reloadNonce) ||
          (n === "" && (committedNonce === 0 || reloadNonce === 0));
        if (typeof fp === "string" && liveNonce) {
          const outcome = observeFingerprint(fpTracker.current, fp, n);
          if (outcome === "no-op") onVisualNoOpRef.current?.(frame.slug);
        }
        return;
      }
      if (d.type === "arcade-studio:frame-digest") {
        handleDigestMessage(d as Parameters<typeof handleDigestMessage>[0], {
          projectSlug,
          frameSlug: frame.slug,
          committedNonce,
          reloadNonce,
          onRenderDigest: onRenderDigestRef.current,
        });
        return;
      }
      if (String(d.n ?? "") !== String(reloadNonce)) return; // stale iframe — ignore
      // Not an in-flight edit — ignore at-rest committed-frame errors/readies
      // (which reconverge to the same nonce after a successful edit). Viewport's
      // listener + the errorShim still handle a genuine at-rest runtime error;
      // this VISUAL handler must not chip/timer on one.
      if (!editCycleActive.current) return;
      if (d.type === "arcade-studio:frame-ready") {
        // Clean mount of the in-flight edit → promote it to last-good and
        // discard the probe. A LATE ready (after we went terminal) still lands
        // here and un-terminals: a slow fix arriving is a win.
        // Swap navigates the visible iframe from the last-good (n=0) render to
        // the agent's repaired source (n=reloadNonce). Any edit batch built on
        // the old DOM is now stale — line/cols point into shifted source → tear
        // the session down (same reason as the frame-changed teardown).
        if (sessionFrameSlug === frame.slug) clear();
        setCommittedNonce(reloadNonce);
        setIncomingLoading(false);
        editCycleActive.current = false;
        setChip("none");
        setChipDetailOpen(false);
        if (refineTimer.current) {
          clearTimeout(refineTimer.current);
          refineTimer.current = null;
        }
      } else if (d.type === "arcade-studio:frame-error") {
        // The in-flight edit crashed. Discard the broken probe, keep the
        // last-good render visible, and reassure with a calm chip. Start (or
        // restart) the terminal countdown — if no clean mount lands within the
        // budget, the chip flips to "couldn't fix it".
        setIncomingLoading(false);
        setChip("refining");
        if (refineTimer.current) clearTimeout(refineTimer.current);
        refineTimer.current = setTimeout(() => setChip("terminal"), refineTimeoutMs);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [projectSlug, frame.slug, reloadNonce, committedNonce, refineTimeoutMs, sessionFrameSlug, clear]);

  // Clean up the terminal timer on unmount (no leaked setTimeout).
  useEffect(() => {
    return () => {
      if (refineTimer.current) {
        clearTimeout(refineTimer.current);
        refineTimer.current = null;
      }
    };
  }, []);

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
    // Re-arm the picker if it was active before the reload. Posting
    // frame-pick-start immediately on the nonce bump would fire before the new
    // document is ready — do it here once the iframe's onLoad guarantees the
    // fresh document + picker listener are live.
    if (picking) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "arcade-studio:frame-pick-start" },
        "*",
      );
    }
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
  // Derive each iframe's URL from its nonce + the CURRENT projectMode. Keeping
  // `mode=${projectMode}` in the committed URL (rather than freezing a URL
  // string at reload time) means a later light/dark switch flows through: the
  // `key={projectMode}` on the committed iframe remounts it, and it refetches
  // with the new mode. `committedNonce` is the last-good (visible) render;
  // `reloadNonce` is the in-flight edit shown only in the hidden probe iframe.
  const buildFrameUrl = (nonce: number) =>
    `/api/frames/${projectSlug}/${frame.slug}?mode=${projectMode}${nonce ? `&n=${nonce}` : ""}`;
  const committedUrl = buildFrameUrl(committedNonce);
  const incomingUrl = buildFrameUrl(reloadNonce);
  // "Open in new tab" targets the last-good (visible) render.
  const frameUrl = committedUrl;
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
            // Spec 3.2: frame controls sit on a black pill by default so
            // they're legible over the dot-grid canvas.
            background: "#000000",
            borderRadius: 999,
            padding: "2px 4px",
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
          {/* Committed (last-good) iframe — the one the designer sees and the
              picker/inspector target. Keyed on `projectMode` AND `committedNonce`:
              a light/dark switch force-remounts it (integration hazard #1), AND
              — the fix — the double-buffer SWAP (which bumps committedNonce) now
              force-remounts it too. Without the nonce in the key, a swap only
              mutated the `src` attr on the REUSED node, which does NOT reliably
              re-navigate an already-loaded iframe → the visible frame stayed on
              the pre-edit render until a manual refresh (the "nothing happened"
              illusion). The hidden probe already keys on reloadNonce for exactly
              this reason; the committed iframe must too. */}
          <iframe
            ref={iframeRef}
            key={`${projectMode}-${committedNonce}`}
            data-frame-active="true"
            title={frame.name}
            src={committedUrl}
            onLoad={onIframeLoad}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: resizing ? "none" : "auto",
            }}
          />
          {/* Incoming (in-flight edit) iframe — hidden, non-interactive probe.
              pointer-events:none + opacity:0 + aria-hidden keep its
              gestureForwarder/picker from double-firing pan/zoom/picks to the
              parent. It swaps in only on a nonce-matched clean mount. A distinct
              key stops React from reusing the committed node (which would reload
              the broken edit into the VISIBLE frame). */}
          {incomingLoading && (
            <iframe
              key={`incoming-${reloadNonce}`}
              title={`${frame.name} (loading)`}
              src={incomingUrl}
              aria-hidden
              tabIndex={-1}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
          )}
          {chip !== "none" && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                right: 12,
                maxWidth: "calc(100% - 24px)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#fafafa",
                border: "1px solid var(--stroke-neutral-subtle)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontSize: 12.5,
                lineHeight: 1.45,
                color: "#374151",
                zIndex: 3,
              }}
            >
              <style>{`@keyframes arcade-studio-refine-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }`}</style>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {chip === "refining" && (
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      flex: "none",
                      borderRadius: "50%",
                      background: "#a78bfa",
                      animation: "arcade-studio-refine-pulse 1.4s ease-in-out infinite",
                    }}
                  />
                )}
                <span style={{ color: chip === "terminal" ? "#111827" : "#374151" }}>
                  {chip === "refining"
                    ? "Refining your change…"
                    : "I couldn't get that change right — tell me what you'd like instead"}
                </span>
              </div>
              {chip === "terminal" && (
                <button
                  type="button"
                  onClick={() => setChipDetailOpen((o) => !o)}
                  style={{
                    alignSelf: "flex-start",
                    padding: 0,
                    border: 0,
                    background: "none",
                    color: "#6b7280",
                    fontSize: 11.5,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {chipDetailOpen ? "Hide details" : "What happened?"}
                </button>
              )}
              {chip === "terminal" && chipDetailOpen && (
                <div style={{ color: "#6b7280", fontSize: 11.5 }}>
                  The last edit kept crashing this frame, so we're still showing
                  the version that worked. Describe the change again — or a
                  different way to get there — in the chat.
                </div>
              )}
            </div>
          )}
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
