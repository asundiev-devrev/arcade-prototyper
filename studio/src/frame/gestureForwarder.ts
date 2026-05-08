/**
 * Runs inside each frame iframe. Iframes are an event boundary: wheel and
 * mouse events that fire inside a frame never reach the parent window, which
 * is why cursor-over-frame ⌘+scroll would otherwise trigger the browser's
 * native page zoom. This forwarder captures the gestures that the parent's
 * viewport wants to own (pan + zoom) and re-dispatches them via postMessage
 * with parent-window coordinates attached.
 *
 * The parent listens for these messages in ViewportPreview and runs the same
 * code paths it already has for direct wheel / mousedown / keydown — so the
 * zoom/pan always affects the whole canvas, not individual frames.
 */

type ForwardPayload = {
  type:
    | "arcade-studio:canvas-wheel"
    | "arcade-studio:canvas-pan-start"
    | "arcade-studio:canvas-pan-move"
    | "arcade-studio:canvas-pan-end"
    | "arcade-studio:canvas-space-down"
    | "arcade-studio:canvas-space-up";
  deltaY?: number;
  parentX?: number;
  parentY?: number;
  button?: number;
  modifier?: "meta" | "ctrl" | "none";
};

function post(msg: ForwardPayload) {
  try {
    window.parent?.postMessage(msg, "*");
  } catch {
    // cross-origin guards — this is always same-origin in practice
  }
}

/**
 * Translate iframe-local client coords into parent-window client coords.
 * Uses frameElement (same-origin only, which is always our case) to get the
 * iframe's bounding box in the parent's viewport.
 */
function toParentCoords(clientX: number, clientY: number): { x: number; y: number } | null {
  const frameEl = window.frameElement as HTMLIFrameElement | null;
  if (!frameEl) return null;
  const rect = frameEl.getBoundingClientRect();
  return { x: rect.left + clientX, y: rect.top + clientY };
}

let spaceHeld = false;
let panning = false;

function isTextEditorActive(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

function onWheel(e: WheelEvent) {
  if (!(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  const coords = toParentCoords(e.clientX, e.clientY);
  if (!coords) return;
  post({
    type: "arcade-studio:canvas-wheel",
    deltaY: e.deltaY,
    parentX: coords.x,
    parentY: coords.y,
    modifier: e.metaKey ? "meta" : "ctrl",
  });
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code !== "Space") return;
  if (isTextEditorActive()) return;
  if (!spaceHeld) {
    e.preventDefault();
    spaceHeld = true;
    post({ type: "arcade-studio:canvas-space-down" });
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code !== "Space") return;
  if (spaceHeld) {
    spaceHeld = false;
    post({ type: "arcade-studio:canvas-space-up" });
  }
}

function onMouseDown(e: MouseEvent) {
  // Middle mouse → always pan. Space + primary button → pan.
  if (!(e.button === 1 || (e.button === 0 && spaceHeld))) return;
  e.preventDefault();
  const coords = toParentCoords(e.clientX, e.clientY);
  if (!coords) return;
  panning = true;
  post({
    type: "arcade-studio:canvas-pan-start",
    parentX: coords.x,
    parentY: coords.y,
    button: e.button,
  });
}

function onMouseMove(e: MouseEvent) {
  if (!panning) return;
  const coords = toParentCoords(e.clientX, e.clientY);
  if (!coords) return;
  post({
    type: "arcade-studio:canvas-pan-move",
    parentX: coords.x,
    parentY: coords.y,
  });
}

function onMouseUp() {
  if (!panning) return;
  panning = false;
  post({ type: "arcade-studio:canvas-pan-end" });
}

function onBlurOrHide() {
  if (spaceHeld) {
    spaceHeld = false;
    post({ type: "arcade-studio:canvas-space-up" });
  }
  if (panning) {
    panning = false;
    post({ type: "arcade-studio:canvas-pan-end" });
  }
}

if (typeof window !== "undefined") {
  // Capture phase so the frame's own app can't stop propagation before us.
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("blur", onBlurOrHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") onBlurOrHide();
  });
}
