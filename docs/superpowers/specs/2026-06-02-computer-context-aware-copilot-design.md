# Computer as Context-Aware Co-Pilot — Design

**Date:** 2026-06-02
**Product:** Arcade Studio (`studio/`)
**Status:** Approved design, pre-implementation

## Problem

Studio runs two isolated agents in one chat:

1. **Code agent** — the default Claude Code subprocess. Generates React frames. Has rich context (project `CLAUDE.md`, frame dir via `--add-dir`, Figma enrichment, DESIGN.md).
2. **Computer** — summoned via `@Computer`, provides DevRev-specific context. Today it is a **stateless REST call** to DevRev agent/620 (`https://api.devrev.ai/internal/ai-agents.events.execute-sync`). It receives only the user's cleaned prompt plus an optional `#frame` source. No chat history, no project state, no awareness of what's being built.

The dual-agent setup is novel, but Computer's isolation makes it far less useful than it could be. This design makes Computer **context-aware** and **proactive**:

1. **Context on summon** — when `@Computer` fires, it answers with full project context.
2. **Silent product-truth watcher** — Computer evaluates each frame generation in the background and chimes in *only* when the prototype drifts from how DevRev actually works as a product.

## Key constraints (from prior learnings)

These shape the design and are non-negotiable:

- **agent/620 has no filesystem tools** — it cannot read frames itself; everything must be sent in the payload. (`devrev_computer_agent_capabilities`)
- **~50KB tool-output cap** — DevRev's SDK truncates tool results over 50KB to a 2KB preview. The context payload must stay under this. (`computer-agent-tool-output-cap`)
- **agent/620 fabricates live org data** — invents ownership; public APIs can't return the user's own sessions. Therefore **live DevRev org data is NOT a reliable truth source.** Drift detection is grounded in Computer's *general DevRev product judgment*, not live data. (`computer-data-into-prototype-broken`)
- **Vite middleware does not hot-reload** — anything touching `server/middleware/*` needs a full app restart to test. (`studio/CLAUDE.md`)

## Truth source decision

The product-truth Computer checks against is **its own general DevRev product/domain knowledge** — e.g. "tickets don't auto-close like that", "this isn't how Rev vs. Dev users split", "that workflow state isn't reachable". No live-org-data dependency (hallucination risk). This is what agent/620 actually does well today.

## Architecture

### Shared spine: the context builder

Both features depend on one new pure function:

```
buildComputerContext(slug): string
```

Assembles project state into a single text block, **capped under the 50KB limit**, from four sources:

| Source | Content | Notes |
|---|---|---|
| Project summary | name, goal, what's been built so far | always included; highest priority |
| Pending chime-ins | drift notes Computer raised but not yet resolved | so a summon can elaborate on them |
| Current frame source | in-view frame's `index.tsx` | the `#frame` reader, made automatic |
| Recent chat history | last N user↔code-agent turns | filler; trimmed first when over budget |

**Budget order when trimming to fit:** project summary (always) → pending chime-ins → current frame → chat history (oldest turns dropped first). Frame + summary are high-signal; raw history is the filler.

**Boundary:** pure assembly + truncation. It does NOT call Computer and does NOT judge drift. Fully testable in isolation — give it a project, assert payload shape and that it stays under budget. Degrades gracefully: a missing frame or empty history omits that block, never throws.

### Feature 1 — Context-aware summon

When `@Computer` is detected, `runComputerBranch` (`server/middleware/chat.ts`) calls `buildComputerContext(slug)` and prepends the assembled block to the cleaned prompt before the REST call.

- Today: `computerAgent.ts` sends `{ input_message: { message: cleanedPrompt } }`.
- New: message becomes `contextBlock + "\n\n" + cleanedPrompt`, capped to leave room for the user's actual question.
- The `#frame` trigger becomes redundant for the in-view frame (now automatic) but still works for explicit frame references.
- `session_object` (`project.computerConversationId`) is unchanged — DevRev still holds the multi-turn thread; we front-load richer context each summon.

### Feature 2 — Silent per-generation drift check

After a code-agent turn that wrote/changed a frame, fire a **background** Computer call. It does not block generation and adds zero latency to the visible turn — the frame has already hot-reloaded by the time the check runs.

Flow:

1. Code-agent turn ends → server detects a frame write (already tracked via the project watch plugin).
2. Fire-and-forget `runDriftCheck(slug)`:
   - Builds context via `buildComputerContext(slug)`.
   - Prepends a **drift-check instruction** (a tunable constant beside the agent ID):
     > "You watch this prototype for DevRev product-truth drift. Respond ONLY if you have a specific, concrete objection about how DevRev actually works. If the frame is fine or you are unsure, respond with exactly `NONE`."
3. Parse the response:
   - `NONE` / empty / low-confidence → store nothing, render nothing. **Silent.**
   - Concrete objection → persist a chime-in record, emit an event to the frontend.

**Noise gate = the instruction itself.** Computer is told to default to silence and bias hard toward false-negatives (miss a drift) over false-positives (annoying interruptions). A "looks fine" is never shown.

**Dedup:** if the same objection is flagged on consecutive turns, collapse to one chime-in (no stacking).

**Staleness:** a chime-in about frame X auto-dismisses if frame X changes again before the user acts — the objection may no longer apply.

### Chime-in data model

Stored on the project (new field, alongside `computerConversationId`):

```ts
ChimeIn {
  id: string
  frameSlug: string                              // which frame it's about (staleness key)
  objection: string                              // Computer's concrete product-truth note
  createdAt: string                              // ISO
  status: "pending" | "applied" | "dismissed"
}
```

`project.chimeIns: ChimeIn[]`. Pending ones feed the context builder and render in chat.

### Chime-in UI — inline collapsed note

- Renders under the code-agent turn that triggered it. Computer-styled (same icon as `ComputerMessage`) but compact: one line — *"Computer noticed something — {first line of objection}"*.
- Tap to expand the full objection.
- Two actions:
  - **Apply** → feeds the objection to the code agent as the next prompt (`"Computer flagged: {objection}. Adjust the frame."`); marks chime-in `applied`.
  - **Dismiss** → marks `dismissed`, collapses.
- Staleness auto-dismiss drops it silently (no user action).

**Render placement:** `MessageList` already branches on `source === "computer"`. Chime-ins are a **new render case**, not a `ChatMessage` (they are not turns). They render as a separate list keyed by `frameSlug`/turn and interleave with messages by `createdAt`.

## Error handling

- Drift check is fire-and-forget: a failed or timed-out REST call is logged and dropped silently. A background watcher must never surface an error or nag.
- Context builder degrades gracefully — missing frame or empty history omits that block, never throws.
- 50KB cap enforced before send. If even the summary alone overflows (shouldn't happen), hard-truncate with a marker.

## Testing

Matches existing studio discipline (every unit testable in isolation, arcade-gen mocked per existing component-test pattern):

- `buildComputerContext` — payload shape, budget order, stays under cap. Pure function, no network.
- Drift-check response parser — `NONE` → silent; objection → chime-in record. Mock the REST call.
- Chime-in lifecycle — dedup, staleness auto-dismiss, Apply/Dismiss state transitions.
- Component test — collapsed note renders, expand works, Apply emits the correct follow-up prompt.

## Scope cuts (YAGNI)

- ❌ Live DevRev org data as truth source — hallucination risk (learning-backed).
- ❌ "Discuss"/third action — Apply/Dismiss only.
- ❌ Auto-apply — user always confirms.
- ❌ "Computer reviewed ✓" reassurance marker — true silent watcher.
- ❌ Periodic/batch triggering — per-generation only.

## Touch points (orientation, not a plan)

- `server/middleware/chat.ts` — `runComputerBranch` (summon context), drift-check trigger after frame-writing turns.
- `server/devrev/computerAgent.ts` — drift-check instruction constant; payload now carries context block.
- New `buildComputerContext` module (server side).
- `server/types.ts` — `ChimeIn` type + `project.chimeIns`.
- `server/projects.ts` — read/write chime-ins.
- `src/components/chat/MessageList.tsx` + new collapsed-note component — chime-in render + Apply/Dismiss.
- `src/hooks/chatStreamReducer.ts` — handle chime-in events.

## Restart caveat

The drift check and summon-context changes live in server middleware, which does not hot-reload. Dev iteration requires a full app restart.
