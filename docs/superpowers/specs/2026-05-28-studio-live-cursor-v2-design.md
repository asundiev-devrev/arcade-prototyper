# Studio Live Cursor v2 — Design Spec

**Date:** 2026-05-28
**Status:** Approved (sections 1–5)
**Supersedes:** `2026-05-27-studio-rendezvous-worker-design.md` is unrelated; this replaces the in-tree 0.24.x live-cursor implementation entirely.

## Goal

Make Arcade Studio's generation feel alive during the 5–10 minute window between "user hits send" and "frame finished rendering." Code should appear character-by-character in a panel inside the frame card. A bottom-of-viewport ticker should narrate what the agent is doing throughout. After a frame iframe loads, a cursor sprite should hop between regions during follow-up Edit calls.

The previous attempt (0.24.0 / 0.24.1) hooked rendering to completed-tool-call events from claude CLI's stream-json output. Those events fire only after each tool finishes — so users saw nothing until the very end of generation, then the entire UI appeared at once. The fix is upstream: enable the `--include-partial-messages` flag on the claude CLI subprocess and consume Anthropic SDK's `content_block_start` + `content_block_delta` events directly. Pencil.dev uses the same model and the same flag; their cursor + code-streaming effect rides on these partials.

## Architecture

Three new event types in `StudioEvent`:

- **`tool_call_started`** — fires on `content_block_start` whose `content_block.type === "tool_use"`. Carries `toolUseId`, `name`, optional preview from `prettyTool()`. Emitted before any input bytes arrive.
- **`tool_input_partial`** — fires per `input_json_delta`. Carries `toolUseId`, cumulative buffered input string, and best-effort regex-extracted `content` / `file_path` / `new_string` fields.
- **`tool_input_complete`** — fires on `content_block_stop`. Carries the fully-parsed input. The legacy `tool_call` and `agent_cursor` events still fire here for back-compat with chat pane code; the parser emits all three.

Three independent visual layers consume these:

1. **`<NarrationTicker>`** — bottom-of-viewport status strip, always visible during `phase === "running"`. Subscribes to `narrations[]` and `lastTool`. Phase 1 lifeline (5–7 minutes of reads/bash where no frames exist yet).
2. **`<CodeStreamPanel>`** — mounted inside `FrameCard` when an `activeWrites` entry resolves to that frame's slug. Renders the partial `content` field of a Write/Edit call as growing monospace text with auto-scroll. Hides on `tool_input_complete`; existing iframe wipe animation takes over.
3. **`<EditCursor>`** — pointer sprite at viewport level. Activates only when `agentCursor.action === "editing"` AND the target slug's iframe has loaded at least once (tracked via `loadedSlugs` Set). Hashes `(filePath + new_string).slice(0, 64)` to coords inside the card rect, hops between coords with 250ms eased transition.

Pipe parity: Host SSE stream and spectator mirror relay both replay through `applyStudioEvent`. Adding partial events upstream auto-propagates to spectators since the relay copies events verbatim. No separate spectator path.

## Data Flow

### Server side

`studio/server/claudeCode.ts`:
- Add `--include-partial-messages` to the spawn args. No other server changes.
- Stdout line parser stays — it forwards every line to the SSE writer regardless of shape.

### Parser

`studio/src/lib/streamJson.ts`:
- New top-level branch: `if (ev.type === "stream_event") → switch on ev.event.type`.
- `content_block_start` with `content_block.type === "tool_use"` → emit `tool_call_started` with `toolUseId`, `name`. (Index of the content block is also tracked internally for buffering.)
- `content_block_delta` with `delta.type === "input_json_delta"` → buffer per index. Concat `partial_json`. Regex-extract:
  - `"file_path":"((?:[^"\\]|\\.)*)"` (matches escaped chars verbatim)
  - `"content":"((?:[^"\\]|\\.)*)`(no closing quote required — capture grows with stream)
  - `"new_string":"((?:[^"\\]|\\.)*)`
  - Extracted strings are JSON-unescape decoded (`\\n` → newline, `\\"` → quote, etc.) only at display time, not at parse time.
- Emit `tool_input_partial` event with `{ toolUseId, partialContent?, filePath?, action: "writing" | "editing" }`.
- `content_block_stop` → emit three events in order: `tool_input_complete`, the existing `tool_call` (full pretty form), and the existing `agent_cursor`.
- `signature_delta`, `text_delta`, `thinking_delta`, `message_start`, `message_stop`, `message_delta` → not consumed in v1 (placeholder for future token-streamed narration).
- Bash/Read/Glob/Grep/Other tools: `tool_call_started` fires, but no `tool_input_partial` emitted (panel events only for Write/Edit).

### Reducer

`studio/src/hooks/chatStreamReducer.ts`:
- New state slice: `activeWrites: Record<string /* toolUseId */, { slug: string | null; filePath: string; partialContent: string; startedAt: number }>`.
- `tool_call_started` for Write/Edit with filePath under `/frames/<slug>/...` → seed entry, resolve slug via `mapPathToFrame(filePath, frames)`. Skip if filePath unknown or non-frame.
- `tool_input_partial` → merge into existing entry (replace `partialContent` with cumulative latest).
- `tool_input_complete` → delete entry from `activeWrites`.
- Phase transitions to `"cancelled" | "error" | "done"` → clear `activeWrites` to `{}`.
- `agentCursor` slice unchanged: only updates on `tool_input_complete` for Edit calls (preserves existing chat pane behavior).

Throttling: when multiple `tool_input_partial` events for the same `toolUseId` arrive within one animation frame (16ms), the reducer collapses them via `requestAnimationFrame`-batched setState. Verified via fake-timers in unit tests.

### View wiring

`studio/src/components/viewport/Viewport.tsx`:
- New props/state: receives `activeWrites` from chatStreamReducer state. Tracks `loadedSlugs: Set<string>` in local `useState`. Threaded down to each `FrameCard` as a new `onIframeLoad: (slug: string) => void` prop, called from `FrameCard`'s existing `onIframeLoad` handler.
- Three render branches:
  - `phase === "running"` and `frames.length === 0` → `<PhantomSkeleton>` + `<NarrationTicker>`.
  - `phase === "running"` and `frames.length > 0` → existing FrameCard grid; each card matches its slug against `activeWrites` and conditionally mounts `<CodeStreamPanel>`. `<NarrationTicker>` always rendered. `<EditCursor>` rendered once at viewport level.
  - `phase !== "running"` and `frames.length === 0` and `!isReadonly` → `<EmptyViewport>` (existing CTA).
- Removed: `<LiveCursorLayer>` import + usage. The 0.24.1 phantom-card empty-state branch is replaced by `<PhantomSkeleton>` + `<NarrationTicker>`.

## Components

### `studio/src/components/viewport/CodeStreamPanel.tsx` (new)

Props: `partial: string`, `filePath: string`.

- Renders `<pre>` with monospace font and line numbers in a left gutter. Auto-scrolls to bottom when content grows past container height.
- Lightweight syntax tokens via simple regex (keyword / string / comment); falls back to plain text on incomplete JSX (no full parser).
- Mounted inside `FrameCard`'s existing iframe wrapper at `position: absolute; inset: 0`. Solid background hides the iframe behind it.
- Header strip: filename basename + "Writing…" indicator + small char count (`{partial.length} chars`).
- Unmounts when its `activeWrites` entry is dropped (Write completes).

### `studio/src/components/viewport/NarrationTicker.tsx` (new)

Props: `narrations: string[]`, `lastTool: { name: string; pretty: string } | null`, `phase: TurnPhase`.

- Fixed strip 120px from viewport bottom, full-width minus 32px padding.
- Left side: last 3 narrations stacked vertically, top item brightest. Older items fade to ~40% opacity.
- Right side: animated dots ("•••") + last tool's `pretty` string ("Reading kit-manifest.md").
- Auto-hides via `display: none` when `phase !== "running"` AND `narrations.length === 0`.

### `studio/src/components/viewport/EditCursor.tsx` (new)

Props: `agentCursor: StreamState["agentCursor"]`, `containerRef: RefObject<HTMLDivElement>`, `frames: Frame[]`, `loadedSlugs: ReadonlySet<string>`.

- Renders only when `agentCursor !== null` AND `agentCursor.action === "editing"` AND the resolved slug is in `loadedSlugs`.
- Hash `(agentCursor.filePath ?? "") + (agentCursor.narration ?? "")` slice 64 → 32-bit integer → `(x, y)` inside the resolved frame card's bounding rect.
- 250ms `cubic-bezier(0.4, 0, 0.2, 1)` transform transition between hops.
- SVG sprite identical to 0.24.x.
- Disappears immediately when `agentCursor === null` (turn end).

### `studio/src/components/viewport/PhantomSkeleton.tsx` (new — supersedes FrameSkeleton)

Same SHAPES catalog from `skeletonShapes.ts`. Same per-block staggered pulse animation.

Contrast fix: pulse alternates between `var(--surface-overlay)` and a new `--surface-overlay-strong` token (added to `studio/src/styles/tokens.css`). Adds outer card border + 12px radius so the skeleton card itself is visible against viewport background regardless of theme.

Composites prop populated when `tool_input_partial` arrives with detectable imports (parse partial content via existing `extractComposites` from `studio/src/lib/agentCursor.ts`).

### Files retired

- `studio/src/components/viewport/LiveCursorLayer.tsx` — deleted.
- `studio/src/components/viewport/FrameSkeleton.tsx` — replaced by `PhantomSkeleton.tsx` (rename + contrast fix).
- `__tests__/components/live-cursor-layer.test.tsx` — deleted.

## Error Handling and Edge Cases

**Partial JSON parse failures.** `input_json_delta` chunks split mid-string (e.g. `"con` then `tent\":\"impo"`). Don't full-parse; regex-extract against the cumulative buffer. JSON-unescape only at display time. Until enough bytes arrive for a regex match, `partialContent` is empty and the panel header shows "Writing…" with no body.

**Out-of-order completion.** `activeWrites` keyed by `toolUseId` handles parallel Writes. If two Writes target the same slug (rare), last-writer-wins on display; the earlier one is overwritten when its panel re-mounts.

**Aborted turns mid-Write.** Reducer clears `activeWrites` on phase transition to `cancelled`/`error`/`done`. Panel unmounts immediately; iframe re-shows whatever was last good.

**Replay (host reconnect / spectator initial cache_replay).** Replayed events run through the same reducer. If a turn already completed, all `tool_input_complete` events fire after their respective partials, so `activeWrites` ends up empty. Replay during in-flight turn: partial events arrive in order; final state matches live.

**Spectator relay.** `studio/server/relay/persistence.ts` already buffers all events into `replay-buffer.jsonl`. New event kinds piggyback on the same buffer — no schema migration needed. Bandwidth: a 5K-delta Write is roughly 250KB raw, inside acceptable SSE chunk envelope. No batching required for v1.

**Iframe load timing race.** Edit fires before iframe `onLoad` event → cursor doesn't appear (waits for `loadedSlugs` set membership). Avoids cursor floating over a not-yet-rendered frame. Iframe re-loads (HMR) → `onLoad` fires again → slug stays in set (Set, not toggle).

**Backpressure.** If the renderer falls behind on a slow machine, buffered partials stack. The reducer keeps only the latest `partialContent` per `toolUseId` (replace, not append) since the cumulative string already includes all prior. Worst case: skips intermediate frames, renders latest. Visually graceful degrade.

## Testing

### New test files

**`__tests__/lib/streamJson-partials.test.ts`** — parser unit tests
- Fixture: spike-captured stream-json log → assert correct event sequence.
- `content_block_start` (Write/Edit) → `tool_call_started` with `toolUseId`.
- 5 successive `input_json_delta` lines → `tool_input_partial` events with growing `partialContent`.
- `content_block_stop` → emits `tool_input_complete` AND legacy `tool_call` event (back-compat).
- `signature_delta` lines silently ignored.
- Bash tool deltas → no `tool_input_partial` emitted.

**`__tests__/hooks/chatStreamReducer-partials.test.ts`** — reducer unit tests
- `tool_call_started` for Write at `/frames/hero/index.tsx` → `activeWrites["toolu_X"]` populated with slug `"hero"`.
- `tool_input_partial` → entry's `partialContent` updated.
- `tool_input_complete` → entry removed.
- `phase: cancelled` → all `activeWrites` cleared.
- Replay sequence (start → 3 partials → stop) ends with empty `activeWrites`.
- Throttle: 10 partials within 16ms → state correct (latest `partialContent`).

**`__tests__/components/code-stream-panel.test.tsx`** — renders partial text, auto-scrolls to bottom on growth, header shows char count.

**`__tests__/components/narration-ticker.test.tsx`** — shows last 3 narrations, fades older, hides when phase idle.

**`__tests__/components/edit-cursor.test.tsx`** — renders only when `action === "editing"` AND slug in `loadedSlugs`. Hash determinism: same input → same coords.

**`__tests__/components/phantom-skeleton.test.tsx`** (replaces `frame-skeleton.test.tsx`) — contrast token assertions, composite-detected layouts.

**`__tests__/components/viewport-partials.test.tsx`** — integration
- Mount `<Viewport>` with `phase="running"`, no frames, narrations populated → `<PhantomSkeleton>` + `<NarrationTicker>` render, no `<CodeStreamPanel>`.
- Add `activeWrites` entry for slug `"hero"` (with frames `[{slug: "hero"}]`) → `<CodeStreamPanel>` mounts inside hero card.
- Drop `activeWrites` (write complete) → panel unmounts.
- Add `agentCursor: { action: "editing", filePath: "/frames/hero/index.tsx", ... }` after `loadedSlugs.add("hero")` → `<EditCursor>` renders.

**`__tests__/server/relay-partials.test.ts`** — write a `stream_event` line to source stream → fan out to spectator → mirror cache stores it → replay reproduces same event sequence (round-trip identity).

### Deleted

- `__tests__/components/live-cursor-layer.test.tsx`
- `__tests__/components/frame-skeleton.test.tsx` (renamed)

Test count: ~20 new, 1 deleted. Full suite stays green.

## Out of scope (for v1)

- Token-streamed narration in the ticker (`text_delta` / `thinking_delta` consumed but not displayed). v2 if user requests.
- Cursor following Read/Bash positions — explicitly rejected during brainstorm.
- Cursor following code-typing inside the panel — explicitly rejected during brainstorm.
- Diff highlighting in `<CodeStreamPanel>` for Edit calls — v1 just shows `new_string` as plain growing text.
- Multi-Write parallel rendering polish — v1 picks last-writer-wins per slug.
