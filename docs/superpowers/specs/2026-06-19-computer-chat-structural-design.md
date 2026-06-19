# Computer Chat composite — structural behaviors (Sub-project A)

**Date:** 2026-06-19
**Status:** Approved design, ready for implementation plan
**Branch:** `feat/homepage-templates` (continues; Computer-chat composite work)
**Reference prototype:** `DeReGilz/responsive` (`prototype/` — vanilla HTML/CSS/JS), live at https://responsive-rosy-one.vercel.app/#/chat

## Goal

Bring three **structural / layout** behaviors from the reference prototype into our Computer chat composite stack:

1. **Responsive shell** — the 3-column layout (sidenav | chat | canvas) reflows as the available width shrinks.
2. **Collapsible sidenav** — the left sidebar collapses between expanded (~260px, labels) and an icon-rail (64px), plus a floating overlay drawer when the container is too narrow to dock.
3. **Canvas tabs** — a tab strip above the right-hand canvas panel, with connected-tab styling and graceful truncation.

The two **in-content** behaviors (avatar popup menu, artefact card) and overall style polish are **Sub-project B** — out of scope here.

## Core architectural decision: container queries, not a JS width engine

The prototype drives a CSS grid from JS that reads `window.innerWidth` on a throttled resize loop and writes `--sidenav-width` / `--canvas-width` custom properties. **We deliberately do NOT port that.** Our composites render inside DevRev frames at fixed iframe widths (1440 / 1024 / 768 / 375…); a generated prototype must not ship a `window.innerWidth` resize-rAF engine, and "responsive" for us means *responding to the frame's own width*, not the viewport.

Instead, **`ComputerPage` becomes a container-query-driven CSS grid**:
- The template root gets `container-type: inline-size` (Tailwind v4.3 `@container`, built-in — confirmed available; no plugin).
- The three columns reflow via container-query breakpoints keyed on the **container's own width**, so the same composite behaves correctly at any frame width AND when resized live, with **zero JS resize listener**.
- State that genuinely needs JS — the user's pinned collapse, the drawer open/close — stays as React `useState` in `ComputerScene`. Width-*forced* collapse is pure CSS (a container query hides labels + narrows the rail at the threshold).

This is the one architectural fork; everything else follows.

## Constants (borrowed from the prototype, reframed as container widths)

One shared table (module constants in `ComputerPage` / `ComputerScene`):

| Name | Value | Meaning |
|---|---|---|
| `RAIL_WIDTH` | `64px` | icon-rail sidebar width |
| `SIDENAV_EXPANDED` | `260px` | expanded sidebar width |
| `SIDENAV_OVERLAY` | `360px` | floating overlay-drawer width |
| `CANVAS_WIDTH` | `320px` | docked canvas panel width (matches current CanvasPanel ~272–320) |
| `CANVAS_MIN` | `260px` | canvas floor before it converts to a drawer |
| `MAIN_MIN` | `260px` | chat column never compresses below this |
| `THRESHOLD_NO_CANVAS` | `600px` (container) | below: sidebar forced to rail |
| `THRESHOLD_WITH_CANVAS` | `900px` (container) | below (when canvas docked): sidebar forced to rail |
| `CANVAS_DRAWER_BELOW` | `600px` (container) | below: canvas leaves the grid → fixed overlay drawer |

The sidebar-collapse threshold is dynamic: `900` when the canvas is docked, else `600` (the right pane steals room, so the sidebar collapses earlier). Implemented as two container-query variants gated by whether the canvas is open.

## The three behaviors

### A) Collapsible sidenav — `ComputerSidebar`

Two discrete docked states + one orthogonal overlay:

- **expanded** (`SIDENAV_EXPANDED`, labels + section headers + Sessions visible)
- **icon-rail** (`RAIL_WIDTH`, labels/section-headers/Sessions hidden; only icons + the Chats avatar stack survive; New Chat pill → 40px circle)
- **overlay drawer** (`SIDENAV_OVERLAY`, `position: fixed`, slides in over the chat with a backdrop) — used only when the container is too narrow to dock an expanded sidebar.

**Rendered state = `max(user-pinned collapse, width-forced collapse)`:**
- *Width-forced collapse* is **pure CSS** — a container query at the threshold applies the rail styling regardless of React state. So a width-forced collapse auto-restores when the container regrows, with no JS.
- *User-pinned collapse* + *drawer open* are React `useState` in `ComputerScene` (`sidebarCollapsed`, `sidebarDrawerOpen`), toggled by the collapse button in the sidebar header.
- When both apply, the rail wins (CSS forced state overrides the expanded React state via specificity / the container query).

**Collapse toggle:** the existing sidebar-header chrome row (traffic lights + collapse). Clicking toggles `sidebarCollapsed`; when the container can't dock an expanded sidebar, the toggle instead opens the overlay drawer (`sidebarDrawerOpen`).

**Animation:** a simple CSS `transition` on width + label opacity (~200ms, `cubic-bezier(0.33,1,0.68,1)`). The prototype's 200-line FLIP/WAAPI morph engine is **explicitly NOT ported** — a CSS transition is visually sufficient for a prototype composite.

**Rail content rules (CSS, keyed on a `data-collapsed` attr / container query):** hide `.label` spans, section titles, the Sessions group; keep icons + the Chats people-avatar stack; New Chat pill becomes a circle; rows recenter.

### B) Canvas tabs — new `CanvasTabs` composite wrapping `CanvasPanel`

A horizontal tab strip above the canvas content:

- **Markup:** `.canvas__tabs` (flex, `overflow-x:auto`, thin scrollbar) → `button.canvas__tab` items (`flex:0 1 auto; min-width:0`, ellipsis `.canvas__tab-label`) + a trailing flex-filler that carries the bottom rule + an optional `+` add button (`flex-shrink:0`).
- **Truncation ladder (CSS, no JS):** full labels → ellipsis-truncated → horizontal scroll, purely from the flex + `min-width:0` + `overflow-x:auto`.
- **Connected-tab active style:** active tab = white fill, **no** bottom rule; inactive tabs + the trailing filler carry `box-shadow: inset 0 -1px 0 <stroke>` (NOT `border-bottom` — a real border changes box height by 1px and misaligns). The active tab reads as merging into the panel body.
- **Tab icons** inherit `currentColor` (mask-based or arcade icon with `color`), so active/inactive coloring is automatic.
- **Switching IS wired:** the prototype left tabs static; we add real `useState` selection (`activeTab`) so they're clickable. `CanvasTabs` owns this state; `CanvasPanel` (or whatever the tab renders) is the active panel's body.

Compound shape: `<CanvasTabs>` with `<CanvasTabs.Tab id label icon active onSelect>` children + a body slot. The existing `CanvasPanel` renders as one tab's content.

### C) Responsive reflow — `ComputerPage` grid

- Root: `container-type: inline-size`, `display: grid`, `grid-template-columns: <sidenav> 1fr <canvas>`; each child pinned to its explicit grid column so overlay/drawer states don't shift the others.
- **≥ threshold:** all three docked; sidebar may be expanded.
- **< sidebar threshold (600 / 900-with-canvas):** sidebar forced to rail (CSS).
- **< 600 (canvas open):** canvas leaves the grid (column → 0) and becomes a `position:fixed` full-width-ish overlay **drawer** with a backdrop + a close button; the chat goes full-width behind it. Canvas does NOT auto-close — it converts to a drawer and stays open in state.
- Chat column never compresses below `MAIN_MIN`.
- `overflow:hidden` on the grid means drawers must be `position:fixed` (not absolute) to escape the zero-width column + clip. z-order: sidebar-drawer above canvas-drawer; each backdrop just under its drawer.

## Files

All under `studio/prototype-kit/`:

- **`templates/ComputerPage.tsx`** (modify) — flex row → container grid; add canvas-drawer overlay + backdrop; container-query breakpoints (600/900); new optional props for collapse/drawer state + the canvas-drawer close handler. Keep the existing slot API (`sidebar`, `header`, `chatInput`, `children`, `panel`) backward compatible — additions are optional props with sensible defaults so existing generated frames still render.
- **`composites/ComputerSidebar.tsx`** (modify) — add `collapsed` styling (rail at 64px), CSS width/opacity transition, label/section/Sessions hide rules, New Chat circle in rail. A `collapsed?: boolean` prop drives the React-pinned state; a container query enforces the width-forced state independent of the prop.
- **`composites/CanvasTabs.tsx`** (new) — the tab strip composite (connected-tab styling, scrollable, `useState` selection) + compound `CanvasTabs.Tab`.
- **`composites/ComputerScene.tsx`** (modify) — orchestrator: `useState` for `sidebarCollapsed` + `sidebarDrawerOpen` + `canvasDrawerOpen`; wire the collapse toggle; pass state to `ComputerPage` + `ComputerSidebar`; wrap the canvas in `CanvasTabs` (default tabs: e.g. "Canvas" / "Docs"). Default behavior on open is unchanged (transcript + optional canvas).
- **`composites/CanvasPanel.tsx`** (minor) — ensure it composes cleanly as a `CanvasTabs` body (no structural change expected).
- **`index.ts`** (modify) — export `CanvasTabs`.

## Data flow

`ComputerScene` holds three booleans (`sidebarCollapsed`, `sidebarDrawerOpen`, `canvasDrawerOpen`) → passes to `ComputerPage` (layout + drawers) and `ComputerSidebar` (rail styling). Width-forced collapse + canvas→drawer conversion are CSS-only (container queries), so there is **no resize listener anywhere**. Tab selection is local `useState` inside `CanvasTabs`.

## Error handling / edge cases

- Backward compatibility: existing generated Computer frames that call `ComputerPage`/`ComputerSidebar` with today's props must keep rendering — all new props optional, defaults preserve current (expanded, no drawer) behavior.
- A frame narrower than `MAIN_MIN + RAIL_WIDTH` (~324px): chat stays at `MAIN_MIN`, horizontal scroll rather than breaking layout.
- Canvas drawer + sidebar drawer both open at very narrow widths: z-order pins sidebar drawer on top; backdrops don't stack visually (shared dim).

## Testing / verification

The kit is render-verified, not unit-tested. Verification:
1. `pnpm run studio:templates` builds (the seed tree compiles via esbuild — fails loudly on a bad composite).
2. Live screenshots of a seeded Computer frame at **three container widths** — wide (~1440), mid (~800), narrow (~520) — confirming the ladder: *docked expanded* → *rail + docked canvas* → *rail + canvas drawer*. Plus: click the collapse toggle (expanded↔rail), open/close the canvas drawer, switch canvas tabs.
3. Existing suite stays green (`pnpm run studio:test`) — ComputerScene isn't in the settings template but shares the kit build + the arcade-gen component mock; any new arcade-gen symbol used must be added to relevant test mocks.
4. `kit:build` + a Vite hard-restart before judging rendered frames (stale dist trap — auto-memory `prototype-kit-dist-vite-cache`).

## Out of scope (Sub-project B / later)

- Avatar popup menu, artefact card in chat, overall style polish.
- The JS FLIP/WAAPI morph animation, the dev bar, the Agent Studio pane.
- Viewport media queries (we use container queries exclusively).
- Persisting collapse/drawer state across reloads.
