# Rich Editor — Phase 1: Overlay — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Part of:** "Rich Editor" — borrowing design-mode's editor UX. Phased:
1. **Overlay (this spec)** — DOM-highlighting visuals.
2. Panel shell + toolbar + tabs reskin (later spec).
3. Rich panel sections — Layout / Appearance / Fill (later spec).

Each phase ships and demos independently.

## Source & license

[design-mode](https://github.com/SandeepBaskaran/design-mode) is **MIT-licensed**
(© 2026 Sandeep Baskaran). We lift its overlay code (vanilla TS, no framework)
with attribution. Lifted files carry a header crediting design-mode + MIT, and a
repo-root `THIRD-PARTY.md` records the borrow.

## Problem

Studio's element picker (`studio/src/frame/picker.ts`) draws a single
hand-rolled blue outline (`ensureOverlay` → a `position:fixed` div with a 2px
border) plus a green/red flash on pick. It works but is visually thin. design-mode
ships a far richer, polished overlay — hover outline, selection box, a W×H
dimension badge, margin/padding visualizer bands, dashed measurement guides with
distance pills, and layout (grid/column) guides — all pure vanilla DOM. We lift
that overlay into Studio's iframes, replacing our hand-drawn visuals, while
keeping the picker's existing brains (React-fiber → source resolution,
click-to-pick, the `data-arcade-edit-id` stamp).

## Scope

**In (passive visuals):**
- Hover outline (element under cursor while picking).
- Selection box (the picked/targeted element).
- W×H dimension badge.
- Margin (red) + padding (green) box-model bands.
- Dashed measurement guides + distance pills (the orange number badges).
- Layout guides (grid/column overlay).

**Out (deliberately deferred):**
- **Resize handles / drag-to-resize** — interactive; would write a new size into
  the pending batch + need iframe-geometry↔pending wiring. Passive only this phase.
- The Design panel, toolbar, tabs (Phase 2+).
- Anything touching the commit path — Phase 1 changes ZERO commit behavior.
- design-mode's Chrome-extension runtime, MCP/WebSocket bridge, `chrome.storage`,
  change-tracker, comments, presets, layers, export.

## How design-mode's overlay works (from source analysis)

`packages/extension/src/content/` — ~1,200 LOC of pure vanilla DOM/geometry, no
React/Vite binding:
- `overlays.ts` (368) — hover outline, selection box, W×H badge, margin/padding
  bands. `createElement` + inline styles. Colors read from `chrome.storage` (the
  one coupling to cut).
- `measure-guides.ts` (524) — dashed axis lines, distance pills, AND the 8 resize
  handles + drag logic (we strip the handle/drag half — passive only).
- `layout-guides.ts` (225) — grid/column guides via injected stylesheet. No
  chrome deps; lifts clean.
- `helpers.ts` (175) — `getElementRect` (their version adds `window.scrollX/Y`),
  `getOrAssignId`, `hexToRgba`; `constants.ts` — `Z_INDEX`, `DATA_ATTR`.

Couplings to cut: `chrome.storage` (colors), `chrome.runtime.sendMessage`
(element-info messaging), the heartbeat. None are overlay-critical.

## Architecture

### New module: `studio/src/frame/overlay/`

| File | Origin | Responsibility | Changes from source |
|---|---|---|---|
| `overlays.ts` | lift design-mode `overlays.ts` | hover outline, selection box, W×H badge, margin/padding bands | Remove `chrome.storage` color read + `onChanged` listener; take colors from `overlayConfig` (below). |
| `measureGuides.ts` | lift design-mode `measure-guides.ts` | dashed guides + distance pills | **Strip** the resize-handle creation, the drag/resize/move event logic, and the commit callbacks (passive). Keep only guide-line + pill rendering. |
| `layoutGuides.ts` | lift design-mode `layout-guides.ts` | grid/column guides | Lift as-is (no chrome deps). |
| `geometry.ts` | lift from their `helpers.ts` + `constants.ts` | `getElementRect`, `hexToRgba`, `Z_INDEX` constant | `getElementRect` returns **viewport** coords (`getBoundingClientRect`, NO scroll offset) — see Coordinate model. |
| `overlayConfig.ts` | new (Studio) | the colors/tokens the overlay paints with | Arcade token-derived hex/rgba constants (selection, hover, margin, padding, guide, pill). Replaces design-mode's stored prefs. |
| `index.ts` | new (Studio) | the overlay's public API the picker calls | `showHover(el)`, `showSelection(el)`, `clear()`, `setEnabled(on)` — thin facade over the lifted modules. |

### `picker.ts` changes (keep brains, drop drawing)

**Delete:** `ensureOverlay`, `removeOverlay`, `positionOutline`,
`flashOutlineAndFinish`, the `OUTLINE_ID`/`STYLE_ID` constants and the inline
outline div. (The crosshair-cursor `<style>` injection stays — that's not the
overlay.)

**Keep unchanged:** `getFiberFromNode`, `componentNameFromType`,
`parseFirstUserFrame`, `resolveSelection`, `capture()` wiring, the
`frame-picked`/`frame-pick-cancelled` postMessages, `onClick`, `onKeyDown`,
`activate`/`deactivate`, `onParentMessage`.

**Rewire:**
- `onMouseOver` → `overlay.showHover(hoverTarget)` (was `positionOutline`).
- `onClick` success → `overlay.showSelection(target)` then the existing
  `postPicked` (the green flash is replaced by the selection box; the red
  "fail" flash becomes a brief no-op or a simple toast — keep it minimal).
- `activate` → `overlay.setEnabled(true)`; `deactivate` → `overlay.clear()` +
  `setEnabled(false)`.
- `onScroll`/`onResize` reposition → call `overlay` re-measure of the current
  hover/selection target.

inspector.ts (ours) is untouched — it owns preview/contenteditable, not picker visuals.

## Coordinate model (the one real porting risk)

design-mode positions overlays with `position:absolute` + `window.scrollX/scrollY`
(document coordinates) because it runs on arbitrary scrolling pages. **Studio
frames are fixed-size iframes rendered at a zoom factor inside a CSS-transformed
parent.** Today's `picker.ts` proves the correct model for us: `position:fixed` +
`getBoundingClientRect()` (viewport coords, no scroll offset), letting the
parent's CSS zoom transform scale the overlay for free.

**Decision:** keep Studio's coordinate model; adapt design-mode's drawing to it.
Concretely:
- `geometry.ts:getElementRect` returns `el.getBoundingClientRect()` directly
  (drop the `+ window.scrollX/Y` their version adds).
- The overlay container/elements use `position:fixed` (not `absolute`).
- No zoom/pan math in the overlay — the parent transform handles scaling, exactly
  as it does for today's outline.

This is the main edit and it's isolated to `geometry.ts` + the position helpers
inside `overlays.ts`/`measureGuides.ts`. Verified safe: today's picker already
renders correctly fixed+rect+zoomed.

## Data flow

1. Picker active → `overlay.setEnabled(true)`.
2. Mouse over element → `picker.onMouseOver` → `overlay.showHover(el)` →
   overlay measures `getElementRect(el)`, paints hover outline + W×H badge +
   margin/padding bands + measure guides/pills for that element.
3. Click → picker resolves fiber→source + `capture()` (unchanged) →
   `overlay.showSelection(el)` paints the selection box → `postPicked`.
4. Scroll/resize while active → overlay re-measures the active target.
5. Deactivate (Esc / pick-stop / panel close) → `overlay.clear()`.

No messages to the parent change; no commit-path code runs.

## Error handling

- **Zero-size / detached element** (`getBoundingClientRect` all-zero): overlay
  hides rather than drawing a 0×0 box (design-mode already guards this; keep it).
- **Element removed mid-hover**: next `showHover`/re-measure no-ops on a missing
  node; overlay clears.
- **Overlay nodes must never be pickable**: they carry a data attribute the
  picker's hit-testing skips (design-mode's `isDMElement` pattern — keep an
  equivalent so hovering the overlay doesn't re-trigger hover).

## Testing

- **Unit (jsdom)** — `geometry.ts`: `getElementRect` returns viewport rect (no
  scroll offset); `hexToRgba` correctness. `index.ts`: `showHover`/`showSelection`/
  `clear` create/position/remove the expected overlay nodes; `overlayConfig`
  colors applied to the painted elements.
- **Picker regression** — existing `picker`/frame tests stay green; the removal of
  `ensureOverlay` et al. must not break `resolveSelection`/`capture`/postMessage
  (those are untouched). Confirm no test asserted on the old `OUTLINE_ID` node.
- **Visual (manual, the real deliverable)** — `pnpm run studio`: hover paints the
  rich outline + W×H + bands; pick paints the selection box; measure guides +
  distance pills render; layout guides render; everything correct at 100% zoom
  AND zoomed in/out (the coordinate-model check); overlay never blocks picking.
- Full suite green (no commit-path change → no batch-model risk).

## Key decisions

1. **Lift the overlay, replace ours.** design-mode's is richer and vanilla; ours
   is hand-drawn. Single overlay system, theirs. picker keeps its brains.
2. **Passive only — no resize handles.** Keeps Phase 1 free of any commit-path /
   iframe-geometry-to-pending wiring. Handles can be a later phase.
3. **Keep Studio's coordinate model** (fixed + viewport rect + parent zoom),
   adapt their document-coord drawing to it. Avoids reintroducing zoom/pan math.
4. **Colors from an `overlayConfig`, not `chrome.storage`.** Arcade-token-derived
   constants; the single Chrome coupling in the overlay, cut cleanly.
5. **MIT attribution** on lifted files + `THIRD-PARTY.md`.

## Out-of-scope / future phases (recorded, not built here)

- Phase 2: panel shell + toolbar (nudge/duplicate/delete/comment/screenshot
  icons) + Layers/Design/Changes tabs, reskinned to design-mode's look, current
  controls retained.
- Phase 3: rich panel sections (Layout box-model, Appearance, Fill) — **token-first
  controls wearing design-mode's slick pickers** (color = arcade swatch dropdown
  first + hex escape hatch; spacing = Tailwind scale steps), committing through
  the existing `pending` → Claude token-idiomatic pipeline. This is where the
  CSS-vs-token tension is resolved; Phase 1 has no commit path so it does not arise.
- Resize handles (interactive overlay) — deferred; would wire drag → pending.
