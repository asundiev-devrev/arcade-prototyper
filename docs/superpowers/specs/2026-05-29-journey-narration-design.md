# Journey Narration Design

**Date:** 2026-05-29
**Branch:** `feat/studio-live-cursor`
**Status:** Draft, pending implementation

## Problem

During a typical 5–10 minute generation turn, the Studio chat pane shows
mostly raw tool rows — `grep`, `cat`, `Reading index.ts`, `Bash sed -n
'1300,1500p' /…` — interleaved with at most one or two short narration
phrases from Claude. The pane reads like terminal output, not like an
assistant explaining itself. Comparable tools (Figma Make, Cursor,
Claude Code's own chat) carry the user along with continuous prose
commentary even while tools fire underneath.

The fix lives in the prompt, not the UI. Claude is currently instructed
to be terse and to skip play-by-play. We want it to keep that discipline
for the **final reply** but emit a steady stream of short journey lines
**during** the turn.

## Goal

Add a "Narration discipline" section to the per-project `CLAUDE.md`
that makes Claude emit roughly 5–10 short, designer-friendly journey
lines per turn — one per phase of work — without changing the
final-summary + `### Deviations` contract.

## Non-Goals

- No synthetic studio-side narration. If Claude is silent, the
  LoadingShow scenes already cover the empty viewport; the chat pane
  stays as-is.
- No collapsible "Thought for Nm Ns" history block.
- No restyling of existing raw tool rows.
- No fallback when Claude doesn't emit the sentinel — graceful
  degradation to current behavior is fine.

## Architecture

Five small changes across the layers.

### 1. Prompt — `studio/templates/CLAUDE.md.tpl`

Append a new top-level section, "Narration discipline", that instructs
Claude to:

- Emit a short journey line before each major phase of work, prefixed
  with the sentinel `→ ` (right-arrow + space) at the start of a line.
- Use first-person present continuous, designer language only (no file
  paths, tool names, hex, Tailwind classes, prop names).
- Cap at ~10 words per line and roughly 5–10 lines per turn.
- Keep journey lines distinct from the final reply: the final reply
  still ends with the existing one-sentence summary + `### Deviations`
  block, with no `→ ` sentinel.

Examples included in the prompt:

```
→ Scanning the design system
→ Reading the navigation pattern
→ Sketching the page body
→ Composing the dashboard cards
→ Polishing spacing and type
```

The prompt explicitly says: do not emit raw tool names, file paths, or
the bash command being run. Talk about *what* you're working on in
design terms, not *how*.

### 2. Parser — `studio/src/lib/streamJson.ts`

`StudioEvent` gets a new variant:

```ts
| { kind: "journey"; text: string }
```

When an `assistant` message contains a `text` block, split the block
into lines:

- A line is a "journey line" iff, after stripping ASCII spaces/tabs from
  the start, it begins with the literal two-codepoint prefix `→ ` (U+2192
  + space). No other quoting/prefix is recognized — markdown blockquote
  prefixes like `> → …` are NOT journey lines.
- Each journey line emits one `journey` event with the sentinel and the
  preceding whitespace stripped, trailing whitespace trimmed.
- Remaining lines (text not matching the rule above) accumulate into a
  single `narration` event with the original line breaks preserved.

If a block is entirely sentineled, no `narration` event is emitted. If a
block is entirely un-sentineled, only `narration` is emitted (current
behavior preserved). Mixed blocks emit both.

### 3. Reducer + UI — `studio/src/hooks/chatStreamReducer.ts`, `MessageList.tsx`

`ChatTurnItem` gets a new variant:

```ts
| { kind: "journey"; text: string }
```

The reducer appends `journey` events to `currentItems` interleaved with
tool rows, in stream order.

`MessageList.ActivityRow` renders journey items with a distinct visual
style — lighter weight, italic or muted color, no bubble, no monospace
font, indented to match the tool-row gutter. They sit alongside tool
rows in the activity stream, not as part of `ComputerLive`'s aggregated
narration block.

**Computer-source turns.** When `source === "computer"` and `busy`,
`MessageList` currently renders `<ComputerLive>` (which collapses
narrations into a single `<ComputerMessage>` if any narration exists,
otherwise a `<ComputerThinkingRow>` over the tool labels). Journey
items are **not** part of `ComputerLive`'s `narrations` prop; they are
rendered as a separate stream of journey rows above or alongside the
ComputerLive block, using the same ActivityRow journey styling. Journey
items never collapse into `<ComputerMessage>`.

### 4. Server persistence — `studio/server/middleware/chat.ts`

`onEvent` already only pushes `narration` events into `narrationTexts`,
which becomes the persisted assistant bubble content. Because journey
events are a separate `kind`, they are **never** pushed into
`narrationTexts`. Persisted history still contains only the final
summary + Deviations text. No code change needed here beyond the
TypeScript discriminated union covering the new variant.

**Assumption.** The model's *final* text block in a turn carries the
summary + `### Deviations` section and contains no `→ ` sentinels.
Mid-turn text blocks are expected to be entirely sentineled. If a
mid-turn block contains both sentineled lines AND un-sentineled prose,
the un-sentineled portion will persist to history. The prompt
explicitly tells Claude to keep mid-turn prose to journey lines only.

### 5. Spectator relay — `studio/server/relay.ts` (or wherever `mapStudioEventToRelayEvent` lives)

Add `journey` to the list of `StudioEvent` kinds forwarded into the
`agent_event` envelope so multiplayer spectators see journey rows in
sync with the host. Same shape as `narration`. Without this, spectators
would see the same silent gap between tool rows that the host had
before this change.

## Event Flow

```
Claude streams:
  → Scanning the design system

streamJson emits:
  { kind: "journey", text: "Scanning the design system" }

reducer routes:
  currentItems.push({ kind: "journey", text: ... })

MessageList renders:
  italic muted line in activity log (live only)

…

Claude streams (final text block):
  "Built the navigation and breadcrumb from the kit.

  ### Deviations

  - …"

streamJson emits:
  { kind: "narration", text: <full block> }

reducer routes:
  currentItems.push({ kind: "narration", text: ... })

server pushes into narrationTexts; on turn-end, history is persisted as
the joined narration content. Journey lines are dropped from history.
```

## Failure Modes

- **Claude forgets the sentinel.** Journey count drops, user sees the
  current raw-tool-row experience. No regression. Monitor in real
  generations; tighten the prompt if needed.
- **Claude over-narrates.** Cap is in the prompt only. The UI doesn't
  enforce. Trust the model with explicit instruction.
- **Sentinel collision.** `→ ` at line start is rare in normal design
  prose. If a real reply ever begins a line with `→ `, that line gets
  treated as a journey item. Acceptable risk; can revisit with a
  bracketed token like `[journey] ` if collisions appear.
- **Mid-stream sentinel after final summary.** If Claude emits `→ …`
  after the summary block, it shows up as one more journey item but is
  also stripped from the persisted bubble (good). Final summary stays
  intact.
- **`message_delta` partial text.** Current parser only emits
  `narration` from completed `assistant` messages, not from streaming
  text deltas. Journey events come from the same code path, so they
  appear at message-completion time, not character-by-character. That's
  acceptable — phase boundaries are coarse-grained anyway.

## Testing

- **Parser unit test (`__tests__/lib/streamJson.test.ts`):**
  - Assistant message with mixed `→ Reading…\n\nFinal summary.\n###
    Deviations\nNone.` emits two events: one `journey` (text: `Reading
    the navigation pattern`), one `narration` (text: `Final
    summary.\n### Deviations\nNone.`).
  - Block of three sentineled lines emits three `journey` events, no
    `narration`.
  - Block with no sentinel emits one `narration`, no `journey`
    (regression check on current behavior).
  - Sentinel anywhere other than start-of-line is left intact in the
    narration text (no false positives mid-sentence).

- **Reducer test (`__tests__/hooks/chatStreamReducer.test.ts`):**
  - Sequence: `narration` → `journey` → `tool_call` → `journey` →
    `narration`. `currentItems` reflects all five in stream order. The
    reducer's `narrations` slice (used by `ComputerLive`) contains
    only the two `narration` texts.

- **Server persistence test (`__tests__/server/chat.test.ts` or
  similar):**
  - Stream a turn whose `assistant` message text contains journey
    sentinels followed by an un-sentineled summary block. Assert that
    `appendHistory()` is called with content equal to the un-sentineled
    block alone — no journey lines in persisted history.

- **Relay test (`__tests__/server/relay.test.ts` or similar):**
  - A `journey` event flows through `mapStudioEventToRelayEvent` and is
    forwarded as an `agent_event` envelope to spectators.

- **Component test (`__tests__/components/messageList.test.tsx`):**
  - `currentItems` containing one `journey` item renders a row with the
    expected text and the journey-distinct styling (assert presence of
    a class or data attribute).
  - Persisted history with no journey content still renders the bubble
    correctly (regression check).

- **Local visual check:** `pnpm run studio`, fresh project, real
  generation with a Figma URL. Confirm 5–10 journey lines flow during
  the turn and that they disappear from the chat history after the
  turn ends.

## Out of Scope

- Synthetic studio-side narration when Claude is silent.
- Collapsible "Thought for Nm Ns" persisted log.
- Re-styling existing raw tool rows.
- Suppressing tool rows entirely.
- Streaming partial text (character-by-character).

## Open Questions

None at design time. Implementation can proceed.
