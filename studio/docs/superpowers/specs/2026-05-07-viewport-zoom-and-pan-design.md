# Viewport zoom and pan

**Status**: Design
**Date**: 2026-05-07
**Area**: `studio/src/components/viewport/`

## Problem

Beta-tester feedback: *"I'd like the ability to zoom in / zoom out — will make it easier to navigate for laptops of different sizes. Feels like a canvas but it is not one."*

The viewport today is a horizontally-scrolling flex row of iframes. On smaller laptops a 1440px frame (the default) is wider than the viewport can show, so users scroll sideways to see the rest. There's no way to shrink the view to fit, and no canvas-style pan gesture — only scroll-wheel scrolling. The "feels like a canvas" signal is strong enough that we want to meet it: zoom + free pan, not just a zoom slider.

## Goals

- Users can fit wide frames onto small laptop screens by zooming out.
- The viewport behaves like a canvas for navigation: ⌘/ctrl+scroll to zoom around the cursor, space-drag (and middle-mouse drag) to pan.
- Zoom persists per project.
- Existing interactions (frame-width resize, element picking, iframe input, chat pane resize) continue to work unchanged.

## Non-goals

- No free positioning of frames on a 2D plane (frames stay in a horizontal row).
- No pan-position persistence across sessions — only zoom persists.
- No zoom slider UI. Discrete steps + keyboard + scroll is enough.
- No per-frame "fit single frame" button. Global fit-to-screen is sufficient.

## Approach

CSS `transform: scale()` on a wrapper inside the existing `overflow: auto` container. Pan = scroll position on that container; zoom = the transform. This is the Figma / tldraw / Chrome-devtools model.

Considered and rejected: CSS `zoom` (legacy, subpixel fuzziness, snaps at boundaries); per-frame scale (flex gap lives in screen space, so frames visually drift apart at different zooms — breaks the canvas feel).

## Interaction model

### Zoom

- **Range**: 25% → 200%. Default 100%.
- **Persistence**: `localStorage` key `studio:zoom:<slug>`, per project. Restored on project open.
- **Discrete stops**: 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200. Same scheme as Figma/Chrome. `nextStep(current, 'in' | 'out')` snaps to the next stop in that direction.
- **Keyboard**:
  - `⌘+=` / `Ctrl+=`: zoom in
  - `⌘+-` / `Ctrl+-`: zoom out
  - `⌘+0` / `Ctrl+0`: reset to 100%
  - `⌘+1` / `Ctrl+1`: fit-to-screen
  - Skipped when a text input / textarea / contenteditable is focused (so they don't collide with chat typing).
- **Mouse**: `⌘+scroll` (mac) or `ctrl+scroll` (non-mac) zooms one step per notch, anchored at the cursor so the content point under the mouse stays visually fixed.
- **Trackpad pinch**: macOS emits `ctrl+wheel` natively for pinch gestures, so the same handler covers it — no separate gesture code.
- Plain scrolling (two-finger on trackpad, scroll wheel without modifier) still scrolls normally.

### Pan

- **Space-drag**: hold space → cursor becomes grab → drag pans the viewport by writing `scrollLeft`/`scrollTop` directly.
- **Middle-mouse drag**: `e.button === 1` triggers the same pan handler without needing space.
- Both cancel on mouseup or when space is released.
- Rationale for space-drag (vs always-on drag): iframes need to receive mouse input for normal interaction and the existing element-picker flow. A modal gesture is the only reliable way to claim drag from the iframes.

### Cursor feedback

- Space held, no drag: `cursor: grab` on the viewport.
- Space held + mouse down: `cursor: grabbing`, and the zoom wrapper gets `pointer-events: none` for the duration so iframes don't swallow the drag.
- Otherwise: default cursor (iframes handle their own).

## UI

### Zoom indicator (replaces today's `Preview` badge)

The bottom-right of the viewport currently shows a small `Preview` label. It's replaced by a zoom pill in the same position:

```
  ┌──────────────┐
  │  100%   ▾    │
  └──────────────┘
```

Clicking opens a popover with:

- `Zoom in ⌘+`
- `Zoom out ⌘-`
- Separator
- `Zoom to 50%`
- `Zoom to 100%` `⌘0`
- `Zoom to 200%`
- `Zoom to fit` `⌘1`

Matches Figma's bottom-right control. Same visual weight as the `Preview` label it replaces — no new header real estate consumed.

## State ownership

- **`zoom`**: lives in [`ProjectDetail.tsx`](../../../src/routes/ProjectDetail.tsx) alongside `frameWidth`. Same `useState` + `localStorage` pattern. Passed to `Viewport`, then to `ViewportPreview` and `FrameCard` as a prop.
- **`isPanning`** and space-held state: viewport-local, inside [`ViewportPreview.tsx`](../../../src/components/viewport/ViewportPreview.tsx).

## DOM / component structure

Current `ViewportPreview`:

```tsx
<div overflow:auto>
  {children}
  <span>Preview</span>
</div>
```

New structure:

```tsx
<div class="viewport-scroll" overflow:auto ref={scrollRef}>
  <div class="zoom-wrapper"
       style={{
         transform: `scale(${zoom})`,
         transformOrigin: "0 0",
         width:  contentSize.width  * zoom,
         height: contentSize.height * zoom,
         pointerEvents: panning ? "none" : "auto",
       }}>
    <div ref={contentRef}>{children}</div>
  </div>
  <ZoomIndicator zoom={zoom} onChange={setZoom} onFit={fitToScreen} />
</div>
```

Why the `width`/`height` on the wrapper: `transform: scale` doesn't change layout box size, only visual size. Without setting the wrapper's box to `content × zoom`, the scroll container keeps the pre-scaled scrollable area — wrong in both directions (zoomed out: extra empty scroll; zoomed in: content clipped). A `ResizeObserver` on `contentRef` reads the unscaled content size.

## Cursor-anchored zoom math

Inside `ViewportPreview`, on `⌘/ctrl+wheel`:

```ts
const rect = scrollRef.current.getBoundingClientRect();
const cursorX = e.clientX - rect.left + scrollRef.current.scrollLeft;
const cursorY = e.clientY - rect.top  + scrollRef.current.scrollTop;

// content point under cursor, in unscaled coords
const contentX = cursorX / zoom;
const contentY = cursorY / zoom;

const nextZoom = nextStep(zoom, e.deltaY < 0 ? "in" : "out");
if (nextZoom === zoom) return;
setZoom(nextZoom);

// after React commits the new transform, restore scroll so the same
// content point sits under the cursor
requestAnimationFrame(() => {
  scrollRef.current!.scrollLeft = contentX * nextZoom - (e.clientX - rect.left);
  scrollRef.current!.scrollTop  = contentY * nextZoom - (e.clientY - rect.top);
});
```

`e.preventDefault()` on the wheel event prevents the browser's default ⌘+scroll page-zoom behavior.

## Frame-width resize under zoom

[`FrameCard.tsx:55-62`](../../../src/components/viewport/FrameCard.tsx#L55-L62) currently computes width from raw client-pixel delta:

```ts
const next = s.startWidth + (e.clientX - s.startX);
```

Under zoom, 1px of mouse motion ≠ 1px of content. The fix: divide by zoom.

```ts
const next = s.startWidth + (e.clientX - s.startX) / zoom;
```

`FrameCard` takes `zoom` as a prop (threaded through `Viewport`).

## Pan implementation

In `ViewportPreview`:

- `keydown`/`keyup` listeners on `window` track space-held state. Ignored when `document.activeElement` is a text input, textarea, or contenteditable.
- `onMouseDown` on the scroll container: if space is held or `e.button === 1`, capture `{ startX, startY, startScrollLeft, startScrollTop }` and attach window-level `mousemove` + `mouseup`.
- `mousemove` writes `scrollRef.current.scrollLeft = startScrollLeft - (e.clientX - startX)` (note: subtract, because dragging right moves content right = scroll left decreases). Same for Y.
- `mouseup` releases, detaches listeners, restores `pointer-events`.

## Fit-to-screen

`⌘+1` triggers:

```ts
const viewport = scrollRef.current.getBoundingClientRect();
const content = contentRef.current.getBoundingClientRect();
// content rect is already scaled; use unscaled size we track in ResizeObserver
const fitX = viewport.width  / contentSize.width;
const fitY = viewport.height / contentSize.height;
const raw = Math.min(fitX, fitY) * 0.95; // 5% padding
const fit = snapToNearestStep(raw);
setZoom(fit);
// center-scroll after commit
requestAnimationFrame(() => {
  scrollRef.current!.scrollLeft = (contentSize.width  * fit - viewport.width)  / 2;
  scrollRef.current!.scrollTop  = (contentSize.height * fit - viewport.height) / 2;
});
```

## Files changed

| File | Change |
|---|---|
| [`studio/src/routes/ProjectDetail.tsx`](../../../src/routes/ProjectDetail.tsx) | Add `zoom` state + localStorage (`studio:zoom:<slug>`); pass to `Viewport`. |
| [`studio/src/components/viewport/Viewport.tsx`](../../../src/components/viewport/Viewport.tsx) | Thread `zoom` + `setZoom` through to `ViewportPreview` and `FrameCard`. |
| [`studio/src/components/viewport/ViewportPreview.tsx`](../../../src/components/viewport/ViewportPreview.tsx) | Main change: transform wrapper, ResizeObserver on content, wheel / key handlers, pan handlers, ZoomIndicator. Drops the `Preview` label. |
| [`studio/src/components/viewport/FrameCard.tsx`](../../../src/components/viewport/FrameCard.tsx) | Takes `zoom` prop; divides resize delta by it. |
| **New**: `studio/src/components/viewport/ZoomIndicator.tsx` | Pill + popover with zoom controls. |
| **New**: `studio/src/components/viewport/zoomSteps.ts` | `ZOOM_STEPS` array + `nextStep(current, dir)` + `snapToNearestStep(raw)` helpers. Extracted so they're unit-testable. |

## Testing

Vitest additions under `studio/__tests__/`:

- `zoom-steps.test.ts`: step math — `nextStep(0.67, 'in') === 0.75`, `nextStep(2.0, 'in') === 2.0` (clamped), `snapToNearestStep(0.4) === 0.33`.
- `viewport-zoom-persistence.test.tsx`: `ProjectDetail` reads/writes `studio:zoom:<slug>`.
- `frame-card-resize-under-zoom.test.tsx`: resize delta is divided by `zoom` prop (mock mousemove, assert resulting width).

No visual tests — per `studio/CLAUDE.md`, the packaged app is the source of truth for UI verification.

## Accessibility

- ZoomIndicator popover items are a real menu (keyboard navigable, Esc to close).
- Keyboard shortcuts don't fire while text input is focused.
- The viewport has `role="region"` `aria-label="Design viewport"` so screen readers can locate it; the zoom indicator pill has `aria-label="Zoom: 100%"` reflecting current state.

## Risks and open questions

- **`requestAnimationFrame` timing for scroll restore**: scroll is restored in the next frame after `setZoom`. If React batching delays the transform commit beyond one frame, the cursor anchor drifts by a pixel. If this shows up in practice, switch to a `useLayoutEffect` that fires on zoom change.
- **Wheel-event `preventDefault` on a passive listener**: the default for React `onWheel` in some builds is passive, which would silently drop `preventDefault`. Attach the wheel listener directly via `ref.addEventListener("wheel", h, { passive: false })` in `useEffect` to be safe.
- **Pan-with-iframe-covering-the-whole-viewport**: `pointer-events: none` on the zoom wrapper during pan handles this. Verified mentally; will verify in browser.

## Rollout

Single PR. No flag — the feature is additive and has safe defaults (zoom = 100% if nothing stored). Beta testers see it on next DMG.
