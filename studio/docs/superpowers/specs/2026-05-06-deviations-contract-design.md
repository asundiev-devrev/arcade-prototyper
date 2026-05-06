# Deviations contract — design

**Date:** 2026-05-06
**Scope:** `studio/`
**Status:** proposed

## Problem

Beta testers have reported two distinct modes of working with the studio:

1. **Standard work** — the frame they want is fully expressible in the design system. The studio is optimized for this today.
2. **Exploratory work** — the frame mixes in-system and out-of-system pieces. Here they want the agent to behave as a "design critic": when it has to deviate from the kit (hand-roll a piece, pick a non-token color, approximate a composite), it should say so explicitly and suggest the closest kit alternative instead of inventing silently.

The prompt-based workaround we've tried ("don't invent, tell me what doesn't exist, consult") does the right thing some of the time, but:

- The agent drifts back toward silent hand-rolling across turns.
- When it does flag deviations, it returns a verbose technical wall of text the user skips.
- Requiring the user to remember a specific prompt format does not survive contact with real designers.

## Non-goals

- A per-turn trigger (`/critique`, `#strict`). Rejected: relies on designers remembering prompt syntax.
- A UI toggle in the chat input. Rejected: users prefer no added UI; the studio is already dense.
- An inferred per-project mode. Rejected: invisible state, easy to forget it's on.
- A second-pass LLM to rewrite responses for concision. Rejected: extra latency, extra cost, extra failure mode. Revisit if v1 responses are still too verbose.
- A code-level lint that scans generated frames for hand-rolling signals. Rejected for v1 — duplicates part of the existing `validateArcadeImports` hook and couples us to the shape of `KIT-MANIFEST.md`. Revisit if the response-level contract starts lying (agent writes `None` while the code clearly deviates).

## Approach

Make "surface every deviation, stay terse" the default behavior — not a mode. Enforce it at two layers:

### Layer 1 — system prompt (template)

Add two new sections to [studio/templates/CLAUDE.md.tpl](../../../templates/CLAUDE.md.tpl):

**"Response shape"** — prescribes the exact shape of every assistant response.

- One sentence summary first. No technical jargon, no file paths, no tool names, no play-by-play of what the agent did (the frames render — the user can see what happened).
- Then a `### Deviations` section. Either a bulleted list of specific deviations, or the literal line `None.` when the whole frame maps cleanly to the kit.
- The `### Deviations` section is non-optional. Even a simple "change the heading" edit gets `### Deviations\n\nNone.` appended.

**"What counts as a deviation"** — defines the contract the agent is reporting against. A deviation is *anything the generated frame does that isn't a straight-through use of a kit composite, template, primitive, or token*. The template enumerates concrete cases the agent should list:

- Hand-rolled chrome where a composite would normally slot in.
- Raw Tailwind brackets (`w-[1040px]`, `text-[17px]`, `rounded-[17px]`, etc.) or hardcoded hex/rgb colors.
- A color used that doesn't map cleanly to a token — e.g. Figma shows neutral gray for an active-state pill, kit default is blue; the agent picked one or the other.
- An icon from outside `arcade/components`.
- A composite prop invented because the Figma node didn't supply it.
- A Figma node that couldn't be resolved to any kit piece and got a `{/* TODO */}` gap.
- A primitive hand-rolled with raw `<div>` + Tailwind because no matching primitive exists.

Each deviation bullet should be terse: *what* deviated and *why*, plus a suggested kit alternative when one exists. Example: `Dual sidebar — kit exposes one sidebar slot. Stacked two NavSidebars side by side; cleaner option is to hand-roll the outer shell.`

The template also adds one rule against verbosity: "Do not explain what you did. The deviations section IS the explanation. Do not pad with 'I chose X because…' prose before the bullets."

The existing "When you're done" section at the tail of the template gets folded into Response shape — it's superseded.

### Layer 2 — enforcement in chat middleware

In [studio/server/middleware/chat.ts](../../../server/middleware/chat.ts), after a Claude turn completes and we accumulate its narration, check the concatenated text for a `### Deviations` heading.

- **Present:** pass through unchanged.
- **Missing:** append a synthetic trailer:

  ```
  
  ### Deviations
  
  ⚠ Agent did not emit a Deviations section — every response must list where the frame deviates from the design system, and why. Review the frame manually.
  ```

The trailer is:

- Appended to the text before we persist it to chat history (so the warning survives reloads).
- Emitted to the live SSE stream so the user sees the warning in the current turn.

The check is a case-insensitive search for `/^###\s+Deviations\b/m` on the trimmed narration. Pure regex — no second LLM call, no manifest parsing.

### Why this shape works

- **No new UI and no user-facing mode.** Discoverability problem dissolves.
- **Always-on, cheap when irrelevant.** Standard work emits `### Deviations\n\nNone.` — ~10 extra tokens. No latency cost.
- **Fails loudly when the contract is skipped.** The trailer is a visible warning, not a silent log line. Designers see when the agent bypassed the rule.
- **Reuses existing rollout path.** `refreshStaleClaudeMd()` in [studio/server/projects.ts](../../../server/projects.ts) already re-renders per-project CLAUDE.md when the template changes, and clears `sessionId` so the next turn starts a fresh session with the new system prompt. Shipping the template update rolls out to all existing beta projects on next launch with zero migration.
- **Observable.** If deviations lists routinely say `None.` while the frame is obviously hand-rolled, that's a signal to add Layer 3 (code lint). Without data, we don't pre-pay for it.

## Files touched

| File | Change |
|---|---|
| [studio/templates/CLAUDE.md.tpl](../../../templates/CLAUDE.md.tpl) | Add "Response shape" + "What counts as a deviation" sections. Fold "When you're done" into Response shape. |
| [studio/server/middleware/chat.ts](../../../server/middleware/chat.ts) | In `runClaudeBranch`, after narration accumulation: regex check for `### Deviations` header; append synthetic trailer (and emit to SSE) if missing. |
| [studio/__tests__/server/chat-deviations-enforcement.test.ts](../../../__tests__/server/chat-deviations-enforcement.test.ts) | New test: narration with `### Deviations` passes through; narration without it gets the trailer appended and a live narration event emitted. |

## Contract details

**Where in the narration stream the trailer is inserted.** The chat middleware accumulates `narration` events into `narrationTexts` and joins them with `\n\n` before persisting. When the contract is not satisfied, the enforcement logic does both:

1. Emits one final `narration` event containing the trailer text to the live SSE stream, *before* the turn's terminal event. The client's existing narration renderer appends it to the turn's rendered message as if it were the last thing the agent said.
2. Pushes the same trailer string onto `narrationTexts` so the persisted chat history matches what the user saw live.

Emitting first and then pushing guarantees live view and persisted history agree. Doing only one of the two would desync the current-session UI from the next reload.

**The check is strict on the heading, loose on casing.** Regex is `/^###\s+Deviations\b/mi`. Any preceding/trailing content is allowed; a bare `Deviations:` (no `###` prefix) does NOT satisfy the contract. This keeps the contract verifiable by simple string matching and prevents the agent from slipping a prose paragraph through as "I'll mention deviations here…".

**The contract is per-turn, not per-session.** Every assistant response carries its own Deviations section. This is cheaper than maintaining session-level state, and means the user always sees the deviation summary for the most recent change.

**Non-interaction with `@Computer`.** The contract applies to `runClaudeBranch` only. Computer-agent turns (`runComputerBranch`) do not produce kit frames and are not subject to the check.

## Testing

One focused unit test at `studio/__tests__/server/chat-deviations-enforcement.test.ts`:

1. Given narration text containing `### Deviations\n\nNone.`, the persisted assistant message equals the original (no trailer appended).
2. Given narration text with no Deviations heading, the persisted assistant message ends with the synthetic trailer, and a `narration` event containing the trailer was emitted to the event stream.
3. Given narration text with a lowercase `### deviations` heading (casing variant), the contract is satisfied (no trailer).
4. Given narration text with a prose-form `Deviations:` (no `###`), the trailer IS appended (contract not satisfied).

Pattern follows existing server-side tests under `studio/__tests__/server/`. We do not need to exercise the live claude CLI — the enforcement logic is pure string manipulation against a synthetic narration buffer.

## Rollout

No user-facing rollout mechanic needed. On the next studio launch after the template change ships:

1. `refreshStaleClaudeMd()` detects the template has changed, rewrites every project's `CLAUDE.md`, clears stored `sessionId` values.
2. Next chat turn in any project spawns a fresh Claude session with the updated system prompt.
3. The chat middleware enforcement is active the moment the build ships — no configuration, no feature flag.

Bump `studio/packaging/VERSION` to `0.11.0` and add a CHANGELOG entry under Added/Changed.

## Risks and open questions

**Risk: the agent writes `None.` while the frame clearly deviates.** This is the main failure mode the code-level lint (Layer 3) would catch. We're choosing to see whether it happens in practice before building for it. Mitigation is to watch the first ~20 beta-user turns after shipping and spot-check deviation lists against the generated frames.

**Risk: the agent inflates trivial deviations into long bullet lists.** The template prescribes terseness ("terse: what deviated and why, plus a kit alternative"), but the template can't enforce it. If bullets drift long, v1.1 is to cap the section length or add an example of a good terse list next to the rule.

**Open: should `### Deviations\n\nNone.` be suppressed from the rendered message?** Arguably "None." is noise once users are trained. Deferred — start by showing it so the contract is visible; hide in v1.1 if users ask.
