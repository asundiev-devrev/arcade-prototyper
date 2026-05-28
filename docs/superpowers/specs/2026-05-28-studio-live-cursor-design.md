# Studio Live Cursor — Design Spec

**Date**: 2026-05-28
**Status**: Draft, pending implementation plan
**Author**: brainstormed via Claude Code

## Inspiration

Pencil.dev (https://www.pencil.dev/) ships a "live build" effect during AI generation: a cursor moves around the canvas and UI appears progressively. It feels lively where most AI tools (bolt.new, v0, claude artifacts, Studio today) make users stare at an empty preview until the agent finishes.

## Why we can't replicate Pencil's mechanism directly

Pencil is a vector editor with a scene-graph file format (`.pen`). Their MCP server exposes `batch_design.insert/update/move/delete` tools that let the agent mutate individual canvas elements. Each mutation animates natively. The granularity is cheap because the agent operates on a structured canvas, not raw code.

Studio is the opposite shape: agent uses Claude CLI's built-in `Write` / `Edit` tools to write `.tsx` files; Vite HMR reloads the iframe atomically when files save. There is no scene graph, no per-element mutation API, and modifying the generation contract to add one would be a months-long product re-architecture with high risk of regressing model output quality.

We therefore aim for **perceived progressive build**: the *feel* of Pencil's effect, decoupled from the generation pipeline. Three layers stacked:

1. Anonymous pointer cursor that flies between FrameCards based on which file the agent is currently reading/writing/editing.
2. Composite-aware skeleton scaffold painted inside the targeted FrameCard while the agent works.
3. Top-down wipe animation when Vite HMR lands the real iframe content.

This adapts Pencil's *signature* (motion + things appearing in stages) without touching the generation pipeline, the prompt template, or the iframe contract. If Studio later pivots to a Pencil-style structured-canvas generation model, that becomes a separate spec — today's design does not block it.

## Goals

- During an active turn, the user always sees motion + signal in the viewport. Whenever the agent emits a tool_call or narration event, the cursor or bubble updates within one render frame.
- A composite-aware skeleton appears inside the targeted FrameCard while the agent writes/edits its file.
- When Vite HMR lands an iframe reload, a top-down wipe reveals the real content while the skeleton fades.
- Spectators see the same cursor + skeleton + reveal automatically. No new relay protocol.
- Zero regressions in the existing generation pipeline (turn duration, file output, error handling).
- Effect degrades gracefully when file→frame mapping fails: cursor parks center-viewport, skeleton omitted, HMR wipe still plays.

## Non-goals

- Inside-iframe rendering or partial JSX execution. The iframe contract is untouched.
- Modifying `studio/templates/CLAUDE.md.tpl` or any generation prompt.
- Custom MCP tools or replacing `Write` / `Edit`.
- Settings toggle. Effect is always on.
- "Truthful" representation of what's being written. Skeleton is pleasant decoration; HMR reveal is the source of truth.

## Architecture overview

```
                     ┌─ parser (streamJson.ts) ─────────────┐
agent stream ───────▶│   tool_use → tool_call + agent_cursor │
                     │   text     → narration                │
                     └────────────────┬──────────────────────┘
                                      │ StudioEvent
                                      ▼
                     ┌─ chatStreamReducer.ts ───────────────┐
                     │   StreamState.agentCursor: {…}       │
                     └────────────────┬──────────────────────┘
                                      │
                  ┌───────────────────┼─────────────────────┐
                  ▼                   ▼                     ▼
       LiveCursorLayer        FrameCard.tsx          (spectator hook
       (cursor + bubble,      (FrameSkeleton +        replays same
        absolute-positioned   onLoad-triggered        events through
        in Viewport)          top-down wipe)          same reducer)
```

All client-side. Parser change is small + additive. Server / middleware untouched. Spectator parity comes for free because `useChatStream` and the spectator hook drive the same reducer (per `useChatStream.ts:90-95`).

## Section 1 — Event protocol

Extend `StudioEvent` in `studio/src/lib/streamJson.ts`:

```ts
| {
    kind: "agent_cursor";
    /** Frame slug being targeted, or null = parked (no clear target) */
    frame: string | null;
    /** What the agent is doing on that frame right now */
    action: "reading" | "writing" | "editing" | "thinking";
    /** File the action is touching (for the bubble + debug) */
    filePath?: string;
    /** Composite imports the writer/editor pulled in (for skeleton hints) */
    composites?: string[];
  }
```

The parser (`parseStreamLineAll`) emits `agent_cursor` *in addition to* the existing `tool_call` / `narration` events — never instead of them. Existing UI surfaces (chat pane, etc.) are unaffected.

**Emission rules** (after the existing `tool_call` / `narration` push):

- `Read` → `agent_cursor { action: "reading", filePath }`
- `Write` → `agent_cursor { action: "writing", filePath, composites: extractComposites(content) }`
- `Edit` → `agent_cursor { action: "editing", filePath, composites: extractComposites(new_string) }`
- `Glob` / `Grep` / `Bash` / other → `agent_cursor { action: "thinking", frame: null }`
- text narration → already pushes `narration`; no separate `agent_cursor` (reducer merges narration into existing cursor state)

Parser emits `filePath` only. Resolution from path → frame slug happens client-side in the layer (parser does not have access to the project's frame list).

## Section 2 — Util: agentCursor.ts

New file `studio/src/lib/agentCursor.ts`.

```ts
export function extractComposites(content: string): string[];
export function mapPathToFrame(path: string, frames: Frame[]): string | null;
```

**`extractComposites`**:

- Matches `import { A, B as C } from "@xorkavi/arcade-gen"` — collects identifiers, handles `as` aliases
- Matches `import Foo from "<path>/composites/<Name>"` (default import) and `import { A, B } from "<path>/composites/<Name>"` (named import) for any relative or alias path containing `/composites/` — collects all identifiers
- Returns deduped array

For `Edit`, parsing `new_string` may miss imports if Edit only touches the JSX body. Acceptable — `composites` is empty, skeleton uses generic fallback layout.

**`mapPathToFrame`**:

- Matches `/frames/<slug>/...` segment
- Returns `<slug>` if it's in `frames`, else `null`

Tests in `__tests__/lib/agentCursor.test.ts`:
- `extractComposites` finds named imports, `as` aliases, multiple imports, prototype-kit relative imports, returns empty for non-import content
- `mapPathToFrame` returns slug for in-frame path, null for outside, null when slug unknown

## Section 3 — Reducer state

Extend `StreamState` in `studio/src/hooks/chatStreamReducer.ts`:

```ts
agentCursor: {
  frame: string | null;
  action: "reading" | "writing" | "editing" | "thinking";
  filePath?: string;
  composites: string[];
  narration?: string;       // last narration text
  updatedAt: number;
} | null;
```

`INITIAL_STREAM_STATE.agentCursor = null`.

**Reducer rules**:

- `agent_cursor` event → shallow-merge into `state.agentCursor`, set `updatedAt: Date.now()`. Initialize composites to `[]` if absent. Preserve existing `narration`.
- `narration` event → if `state.agentCursor` exists, set `agentCursor.narration = ev.text`. Otherwise create `{frame: null, action: "thinking", composites: [], narration: ev.text, updatedAt}`. (Lets the bubble hydrate from a narration that arrives before any tool_call, e.g., "Let me start by reading the existing frame…".)
- `end` event → `agentCursor = null`.
- `turn` header replay (any status) → `agentCursor = null`.

Tests in `__tests__/lib/chatStreamReducer.test.ts`:
- `agent_cursor` writes state, preserves narration, bumps updatedAt
- `narration` updates text, preserves frame/action/composites
- `end` clears
- replayed `turn` header clears (so reconnect mid-turn re-derives from event replay)

## Section 4 — LiveCursorLayer component

New file `studio/src/components/viewport/LiveCursorLayer.tsx`.

Mounted inside `Viewport.tsx` as a sibling to the FrameCards container. Mounted INSIDE the same zoomed container as the cards (verified at build time by inspecting `ViewportPreview.tsx`'s child slot) so cursor coordinates scale with zoom naturally.

**Props**:
```ts
{
  agentCursor: StreamState["agentCursor"];
  phase: TurnPhase;
  containerRef: RefObject<HTMLDivElement>;
  frames: Frame[];
}
```

**DOM**:
- Single root `div` with `position: absolute; inset: 0; pointer-events: none;`. Z-index resolved at build time: must sit above FrameCards (which use no explicit z-index in current tree) and below Studio modal / toast layers. Implementation step: grep `z-index` in `studio/src/` and pick a value (e.g., 5) that is below the lowest modal/toast layer.
- Pointer SVG (anonymous, no label): macOS-style arrow, white fill, black 1.5px stroke, 18×18px, drop-shadow `0 2px 6px rgba(0,0,0,0.25)`. `position: absolute; transform: translate(x, y)`.
- Narration bubble: `position: absolute`, anchored to pointer with `(16, -8)` offset. Truncate at 80 chars, max 2 lines, ellipsis. `title` attribute holds full text. Fade+slide in (8px from bottom), 200ms.

**Position resolution** (each render, no rAF needed — driven by event/scroll changes):
1. `agentCursor === null` or `phase !== "running"` → fade layer to opacity 0 over 400ms then unmount
2. `agentCursor.frame === null` → cursor parks at viewport center
3. `agentCursor.frame === "<slug>"` → resolve via `containerRef.current.querySelector('[data-frame-slug="<slug>"]')`; transform rect to layer-relative coords
4. Pick a target point inside the frame:
   - `reading`: top-left corner inset 24px
   - `writing` / `editing`: stable hash of `filePath` → biased toward upper third of frame
   - `thinking` (with frame): same as last position (no jump)

**Animation**: CSS transition `transform 250ms cubic-bezier(0.4, 0, 0.2, 1)` on the pointer's `translate(x, y)`. No `framer-motion` dependency. No spring math. Single code path.

**Bubble updates**: text changes via `dangerouslySet`-free swap; CSS transition `opacity 200ms` keyed off `narration` content.

**Window resize / scroll**: `ResizeObserver` on `containerRef` + scroll listener trigger re-resolution. (`getBoundingClientRect` on each event is cheap.)

Tests in `__tests__/components/liveCursorLayer.test.tsx`:
- Renders pointer near frame center given `agentCursor.frame` set + matching `[data-frame-slug]` in DOM
- Hides layer at `phase: "idle"`
- Bubble updates on narration change
- Pointer parks at viewport center on `frame: null`

## Section 5 — Skeleton (FrameSkeleton)

New file `studio/src/components/viewport/FrameSkeleton.tsx`.

Lives INSIDE FrameCard's iframe wrapper (sibling to the iframe), absolutely positioned over it. Renders nothing when `visible === false`.

**Props**:
```ts
{ composites: string[]; visible: boolean }
```

**Composite shape registry** in `studio/src/components/viewport/skeletonShapes.ts`:

```ts
export const SHAPES = {
  Hero:    { kind: "block",     height: "30%" },
  Header:  { kind: "bar",       height: "8%",  anchor: "top"    },
  Footer:  { kind: "bar",       height: "8%",  anchor: "bottom" },
  Sidebar: { kind: "rail",      width:  "20%", anchor: "left"   },
  Card:    { kind: "tile",      aspect: "4/3", repeat: 3        },
  Modal:   { kind: "centered",  width:  "60%", height: "50%"    },
} as const;
```

Static map. Extended explicitly when prototype-kit grows.

**Layout algorithm** (deterministic, no DOM measurement):
1. For each `composite` in `composites`, look up shape; missing → ignore (don't fall back per-composite, only at the empty-list level)
2. Pre-place anchored shapes (Header top, Footer bottom, Sidebar left/right)
3. Stack remaining shapes vertically in the middle area with 16px gaps
4. If `composites` empty → fallback to a generic 4-block scaffold: header bar, two body blocks, footer bar

**Visual style**:
- Each block: `background: var(--surface-overlay-2)`, border-radius 8px, pulse animation `opacity 0.6→0.9 over 1.6s ease-in-out infinite alternate`, stagger phase by 200ms per block
- Outer container has 12px radius matching FrameCard

Tests in `__tests__/components/frameSkeleton.test.tsx`:
- Composite list maps to expected blocks (count + anchor)
- Empty composites → generic 4-block fallback
- `visible: false` → renders nothing

## Section 6 — Top-down wipe in FrameCard

Edit `studio/src/components/viewport/FrameCard.tsx`.

**New props**:
```ts
agentCursor?: StreamState["agentCursor"]; // passed from Viewport
phase?: TurnPhase;
```

**Behavior**:
- `isTargeted = phase === "running" && agentCursor?.frame === frame.slug`
- Render `<FrameSkeleton visible={isTargeted && !justWiped} composites={agentCursor?.composites ?? []} />` absolutely positioned over the iframe
- `justWiped` boolean: set true when iframe `onLoad` fires while turn running; cleared 500ms later
- On the same `onLoad`, add CSS class `arcade-studio-frame-wipe` to the iframe wrapper; `animationend` listener removes it
- Wipe gated on `phase === "running"` so user-triggered iframe reloads outside turns don't flash

**CSS** (added to existing global stylesheet `studio/src/styles/...`):

```css
.arcade-studio-frame-wipe::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--surface-overlay);
  clip-path: inset(0 0 100% 0);
  animation: arcade-studio-wipe 450ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  pointer-events: none;
  z-index: 1;
}
.arcade-studio-frame-wipe::after {
  content: "";
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: var(--component-button-primary-bg-idle);
  box-shadow: 0 0 12px var(--component-button-primary-bg-idle);
  animation: arcade-studio-wipe-edge 450ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  pointer-events: none;
  z-index: 2;
}
@keyframes arcade-studio-wipe {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(100% 0 0 0); }
}
@keyframes arcade-studio-wipe-edge {
  from { top: 0; opacity: 1; }
  to   { top: 100%; opacity: 0; }
}
```

Tests in `__tests__/components/frameCard.test.tsx`:
- `onLoad` while `phase === "running"` adds wipe class
- `animationend` removes wipe class
- Skeleton hidden after `onLoad` fires (justWiped flips)
- Wipe NOT added when `phase !== "running"` (manual reload outside turn)

## Section 7 — Wiring in Viewport.tsx

Edit `studio/src/components/viewport/Viewport.tsx`:

- Accept `agentCursor` + `phase` props from parent (`ProjectDetail.tsx`)
- Pass `agentCursor` + `phase` down to each `FrameCard`
- Mount `<LiveCursorLayer agentCursor={agentCursor} phase={phase} containerRef={containerRef} frames={frames} />` inside the FrameCard container, INSIDE the zoom transform (verify against `ViewportPreview` structure)

Edit `studio/src/routes/ProjectDetail.tsx`:

- Pull `state.agentCursor` and `state.phase` out of `useChatStream` (host mode) and the spectator hook (`useProjectFromHost.ts` / `useProjectFromMirror.ts`, whichever drives spectator chat state — verify at build time)
- Pass through to `Viewport`

## Edge cases

| Case | Behavior |
|---|---|
| No frames yet (empty viewport) | LiveCursorLayer hides; skeleton + wipe never engage |
| Project switched mid-turn | Reducer state already resets; `agentCursor` clears; layer unmounts |
| Turn cancelled | `end` event fires → `agentCursor: null` → layer fades |
| Bedrock auth failure | `is_error: true` result → `end` → cursor clears, error UI takes over |
| Window resize / scroll | `ResizeObserver` + scroll listener re-resolve cursor position |
| Long narration | Truncates at 80 chars / 2 lines, ellipsis, `title` holds full text |
| File outside frames (helper read) | `mapPathToFrame` returns null → cursor parks center; bubble still updates |
| Manual iframe reload outside turn | Wipe class NOT added (gated on phase); skeleton not visible |
| Rapid Edit→Edit→Edit (multiple HMRs) | Class re-added on each `onLoad`; previous animation cancels and restarts |

## Failure modes

**OK to ship with**:
- Cursor occasionally parks when `mapPathToFrame` misses — user sees "thinking" bubble in viewport center, still alive
- Skeleton layout doesn't match final UI exactly — wipe replaces with truth
- Narration text race (next narration arrives mid-bubble-animation) — bubble re-animates

**Block ship**:
- LiveCursorLayer crash takes down viewport. Mitigation: wrap layer in error boundary; on error, unmount layer, log, generation continues unaffected.
- Wipe class stuck (animation didn't complete). Mitigation: `animationend` listener removes class. (No defensive setTimeout — `animationend` is reliable across browsers we support; if a real bug surfaces, a test in `frameCard.test.tsx` will catch it.)
- Skeleton remains visible after wipe completes. Mitigation: `justWiped` flips false on wipe-start, controlled by the same `onLoad` handler.

## Build order (5 PRs)

1. **Parser + reducer + tests**. `agent_cursor` event, `extractComposites`, `mapPathToFrame`, reducer state. No UI yet. Vitest only.
2. **LiveCursorLayer cursor + bubble**. Pointer flying between FrameCards on tool_call events. Always on. No skeleton, no wipe. Most visible win first.
3. **FrameSkeleton + composite registry**. Generic fallback. No wipe.
4. **HMR top-down wipe**. FrameCard `onLoad` → animation. Skeleton fades on wipe-start.
5. **Polish**. 120ms click bounce on action change, narration noun chips inside skeleton blocks (optional), perf audit.

Each PR = its own version bump (0.x.0 minor) + CHANGELOG entry. No big-bang ship.

## Test discipline (per `studio/CLAUDE.md`)

- Parser/reducer → `__tests__/lib/agentCursor.test.ts`, extend `__tests__/lib/chatStreamReducer.test.ts`
- LiveCursorLayer → `__tests__/components/liveCursorLayer.test.tsx` (mock `@xorkavi/arcade-gen`, render with stub state)
- FrameSkeleton → `__tests__/components/frameSkeleton.test.tsx`
- FrameCard wipe → extend or add `__tests__/components/frameCard.test.tsx`
- Spectator parity → extend existing spectator hook test to assert `agentCursor` flows through replayed events

`pnpm run studio:test` before each commit.

## Out of scope (future polish, not blocking)

- Narration-driven noun chips inside skeleton blocks ("table", "form", "chart" inferred from narration)
- Stale-state cursor fade after >8s without events
- Sine-wave drift on `thinking` to make parked cursor breathe
- `cursorFrames` turn-end telemetry
- Pivot to structured-canvas generation (Pencil-style MCP) — separate spec
