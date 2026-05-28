# Submit-redirect + Stop-streaming — Design

**Date:** 2026-05-28
**Scope:** `studio/`
**Status:** Draft (pre-implementation)

## Summary

Two related chat-pane UX fixes:

1. **Submit on the homepage redirects immediately** to the new project's
   screen. Today the user stays on the homepage, watches a project tile
   appear below the hero input, and has to click into it.
2. **A turn can be cancelled while it is streaming.** Today there is no way
   to stop a running agent turn from the UI; submit fires and the user
   waits.

Both ship together because they share the same surface (the chat input)
and one informs the other (after redirect-on-submit, the user is in the
project's chat pane while the turn streams — that's where Stop lives).

---

## Issue 1 — Redirect on submit

### Today

`HomePage.handleHeroSubmit` runs sequentially:

1. `api.createProject()`
2. `api.adoptUploads()` (only if images attached)
3. `api.startChatTurn()`
4. `void refresh()` (re-list projects → tile appears)
5. `onOpen(slug)` (writes hash, App swaps to `ProjectDetail`)

The redirect is at the end. On a slow request (or even a fast one with
multiple sequential awaits) the user perceives "submit did nothing →
tile appeared → screen finally swapped". The intended feel — submit
takes you into the project — is lost.

### Plan

**Optimistic navigation with pending-prompt handoff.**

1. `HomePage.handleHeroSubmit` does only the cheap part synchronously:
   `api.createProject()` to get a slug, then `onOpen(slug)`.
2. Before `onOpen`, stash `{ prompt, imagePaths, figmaUrl }` keyed by
   slug in a small singleton (module-level map; not persisted to disk).
3. On mount, `ProjectDetail` (author mode) consumes the pending entry:
   - If `imagePaths.length`, run `api.adoptUploads()` to remap to
     project-scoped paths.
   - Decorate prompt with Figma URL if present.
   - Call `chatStream.send(prompt, images)` once.
   - Clear the pending entry.
4. `useChatStream.send()` already POSTs `/api/chat` + reconnects SSE, so
   the chat pane lights up the moment the server emits the first event.

The handoff bucket lives in a new `src/lib/pendingPrompt.ts` (no React
context — the consumer is one component, the producer is one component,
a module map is enough).

**Failure modes:**

- `createProject` fails → toast + stay on home (current behavior).
- `adoptUploads` fails inside `ProjectDetail` → toast "couldn't attach
  N images", run the turn without them.
- `startChatTurn` (via `chatStream.send`) fails → existing error banner
  in the chat pane handles it.

**What we drop:** the pre-nav `api.startChatTurn` call. The turn now
starts post-nav from inside the project's chat hook.

---

## Issue 2 — Stop streaming

### Today

A running turn has no cancel path. `turnRegistry.finalize` only fires
on natural completion or supersession. The Claude CLI subprocess runs
with `--timeout 900s`. The DevRev Computer agent runs to completion.

There is no Stop button anywhere in the UI. `prototype-kit/composites/
ChatInput.tsx` already exports a `StopButton` component that's unused.

### Plan

**Server side**

1. Extend `TurnStatus` with `"cancelled"` alongside `running` / `done` /
   `error`. Extend `StudioEvent.end` with `cancelled?: boolean`.
2. `startTurn` stashes an `AbortController` on the turn record. The
   `run` callback receives `signal` so the runner can pass it to the
   subprocess.
3. New `cancelTurn(slug)`: looks up the running turn, calls
   `controller.abort()`, finalizes as `{ ok: false, cancelled: true }`.
   Idempotent — no-op if turn already terminal.
4. `chat.ts handleStart` builds the controller, threads `signal` into
   `runClaudeTurnWithRetry` (already accepts it) and `runComputerTurn`
   (already accepts it). On abort, the existing SIGTERM path in
   `claudeCode.ts` kills the subprocess.
5. New endpoint `POST /api/chat/cancel/:slug`:
   - `200 { cancelled: true }` if a running turn was cancelled.
   - `409 { error: { code: "no_running_turn" } }` otherwise.
6. Relay mirroring: extend `RelayEvent.turn_ended` with `cancelled?:
   boolean`. Spectators see the same terminal state.

**Client side**

1. `api.cancelTurn(slug)` posts to the new endpoint.
2. `useChatStream` exposes `cancel()`. Sends the cancel POST; relies on
   the SSE stream's terminal `end` event to drive state — does not
   optimistically flip phase.
3. `chatStreamReducer` handles `end.cancelled === true` → `phase:
   "cancelled"`. Add `"cancelled"` to `TurnPhase`.
4. `ChatPane` passes `onStop` to `PromptInput` when `state.phase ===
   "running"`.
5. `PromptInput`: when `busy`, render `ChatInput.StopButton` in place of
   `ChatInput.SendButton`. Click → `onStop()`. Disabled while a cancel
   POST is in flight (no double-fire).
6. `MessageList` / `TurnStatusRow` render the cancelled state as a
   neutral grey "Cancelled" indicator. No red error banner. No retry
   prompt. The cancelled turn's partial narration stays visible.

**Persisted history:** the cancelled turn writes whatever narration it
managed to emit (existing append-history flow runs only on `ok`, so
nothing changes for cancelled turns — they leave the user's prompt in
history and no assistant message). This is acceptable for v1; can
revisit if testers want partial output preserved.

---

## Out of scope

- Cancellation from the homepage hero (no streaming visible there
  post-redirect).
- "Stop and edit prompt" composite (just stop — re-typing is fine).
- Cancellation analytics / event logging.
- Server-side persistence of the cancelled status across restart (turn
  registry is in-memory only; this matches today's behavior for
  `done` / `error`).

## Open questions

- None blocking. The `cancelled` discriminant on relay events is a wire
  format extension; spectator clients on older builds will fall back to
  treating it as a generic terminal event (no break).

## Files touched (estimate)

**Issue 1:**
- `studio/src/lib/pendingPrompt.ts` (new)
- `studio/src/routes/HomePage.tsx`
- `studio/src/routes/ProjectDetail.tsx` (author wrapper consumes pending)
- `studio/src/hooks/useProjectFromHost.ts` (or a small new hook —
  whichever owns "first mount, kick off pending turn")

**Issue 2:**
- `studio/server/turnRegistry.ts`
- `studio/server/middleware/chat.ts`
- `studio/src/lib/streamJson.ts` (StudioEvent `end` extension)
- `studio/src/lib/api.ts`
- `studio/src/hooks/useChatStream.ts`
- `studio/src/hooks/chatStreamReducer.ts`
- `studio/src/components/chat/PromptInput.tsx`
- `studio/src/components/chat/ChatPane.tsx`
- `studio/src/components/chat/MessageList.tsx` (cancelled indicator)
- `studio/server/relay/types.ts` (RelayEvent `turn_ended` extension)
- Tests under `studio/__tests__/server/` and
  `studio/__tests__/components/`.
