# Structure Editing + Frame-Authored Style Hardening — Design

**Date:** 2026-06-29
**Status:** Approved design (revised after adversarial code review), pre-implementation
**Product:** Arcade Studio (`studio/`)
**Builds on:** the shipped data-driven-composites work (`transcript` prop +
`data-arcade-bind` + `writeBindEdit`). Extends that one machine; introduces no new
editing mechanism and does NOT reach into sealed composites.

## What changed from the first draft (and why)

The first draft proposed "style any element" including a per-message style control.
An adversarial code review **disproved the composite-style premise**:

- `ChatBubble` (the kit's message bubble) exposes only `variant: "sender" |
  "receiver"` + `tail` (verified: arcade-gen `index.d.mts`). `variant` is
  **semantic role, not style**, and `receiver` on a user bubble is a *wrong*
  visual. Assistant messages render via `ChatMessages.Agent`, which has **no
  style axis at all**. So per-message style = a near-empty box.
- Style value provably lives in **frame-authored elements** (raw markup the
  frame wrote): a Figma-import frame carries 20–119 styleable raw tags; the
  existing instant-style path **already writes** color/spacing/font/token changes
  into the frame's own source. ComputerScene-style frames carry ~0 raw tags.

**Conclusion (the honest scope):** for composite-heavy frames you can edit
**content + structure**, NOT restyle individual messages (the kit doesn't expose
it — that's Ask-AI). Rich style is real on **frame-authored** elements and
**already works** — it needs a reliability + discoverability pass, not new
mechanism. So this spec builds **(1) STRUCTURE editing** (the genuinely-missing,
valuable capability) and **(2) a frame-authored style hardening pass**. The
composite per-element style control is **dropped**.

## Problem

Two real gaps after the shipped text-editing:

1. **Structure** — add / remove / reorder messages, change who-said-it. Never
   built. Fits the data machine: it's operations on the frame's `transcript`
   array entries.
2. **Frame-authored style reliability** — the instant-style path writes className
   changes into frame source for raw elements, but its reach/reliability across a
   real Figma-import frame is unverified, and discoverability ("what can I click
   to restyle?") is unclear.

**The governing learning** (7 failures + the recorded "scalable accuracy" rule):
*the wall is sealed composites; edit only where the surface lives in the frame as
data or as frame-authored source; never reach into a composite; arbitrary
composite-internal chrome is Ask-AI.* This spec stays entirely on that ground.

## The model

```
EDITABLE SURFACE = (frame-authored source elements) ∪ (the frame's data arrays)

A. FRAME-AUTHORED element (raw <div>/<h1>/<button> with a static className):
   → instant-style path writes the className into frame source (color token /
     spacing / font / type style). RICH, already works. THIS SPEC: verify + harden
     reach/reliability + discoverability. No rebuild.

B. STRUCTURE of a composite data list (the transcript):
   → operate on the frame's `const transcript = [...]` ARRAY ENTRIES by id:
     insert / delete / move / setRole. New `writeBindStructure`, same TS-AST
     discipline as the shipped `writeBindEdit`. THIS SPEC: build it.

C. Per-element STYLE of a composite-internal node (recolor a bubble):
   → NOT built. The kit doesn't expose it. Ask-AI (honest escape). Out of scope.
```

**Honesty up front:** a ComputerScene frame becomes **content- and
structure-editable**, not style-editable. A Figma-import frame is
**richly style-editable** (case A) + structure where it has data lists. We do not
imply otherwise anywhere in the UI.

## Architecture

```
studio/server/codeWriter/
  ├─ index.ts (shipped): applyEditsToSource className write for frame-authored
  │     nodes — reliability pass target (NOT rebuilt)
  ├─ bindEdit.ts (shipped): writeBindEdit — used as the pattern/precedent
  └─ bindStructure.ts (NEW): writeBindStructure(source, arrayName, op) — TS-AST
        ops on the `const <arrayName> = [...]` literal, by id.

studio/prototype-kit/composites/ComputerScene.tsx (shipped binds; +structure ids)
  → each message already stamps data-arcade-bind for text; structure ops address
    the same `transcript[id=N]` entries (no new stamping needed for structure —
    the bind already identifies the entry + its id).

studio/src/components/inspector/InspectorPanel.tsx
  ├─ bound list item → STRUCTURE controls (add above / add below / delete /
  │     move up / move down / change role) → buildBindStructure → /api/visual-edit
  │     → on success: clear the held selection (mirror the existing move() path)
  └─ frame-authored element → existing instant-style fields (reliability pass)

studio/src/lib/visualEditClient.ts
  └─ buildBindStructure(arrayName, op, frameSlug) → VisualEditPayload (NEW)

studio/server/middleware/visualEdit.ts + codeWriter dispatch
  └─ a structure-op edit routes to writeBindStructure (NEW dispatch branch,
     mirroring the shipped bindPath branch)
```

### New / changed units

1. **`writeBindStructure`** (`studio/server/codeWriter/bindStructure.ts`, pure
   TS-AST) — locate the `const <arrayName> = [...]` literal (reuse the shipped
   `findArrayLiteral` which already unwraps `as const`/`satisfies`). Ops:
   - `insert` `{ afterId, entry }` — splice a new object-literal entry after the
     entry with `afterId` (or at end if `afterId` null). The new entry's `id` =
     `max(all numeric id literals in the array) + 1` (scan every element's
     numeric `id`; tolerate non-numeric/missing). Emit the entry matching the
     array's existing FORMAT (multi-line, one prop per line, trailing comma) so
     the written source is clean, not just parseable. Reparse-guard.
   - `delete` `{ id }` — remove that entry (and a dangling comma). Other entries'
     ids unchanged.
   - `move` `{ id, beforeId }` — reorder the entry (precedent: the shipped
     `reorder.ts` sibling-swap). ids unchanged.
   - `setRole` `{ id, role }` — change the entry's `role`. **Union hygiene:** the
     `Message` shape is a discriminated union (`user` has no `artefact`;
     `assistant` may). Frames are esbuild-transpiled, NOT type-checked, so a
     mismatched literal renders fine — but to keep the data honest, when flipping
     to `user`, STRIP an `artefact` prop if present. (Stated explicitly so the
     written object isn't union-invalid garbage.)
   - All return `{ok, source}` / `{ok:false, reason}`; never throw; reparse-guard
     every result.

2. **`buildBindStructure`** (`visualEditClient.ts`) — a `VisualEditPayload`
   carrying a structure op (a new optional field on `ElementEdit`, e.g.
   `structureOp?: {...}` + `arrayName`, mirroring the shipped `bindPath?`
   optional-field approach — NOT a union rewrite). Both `ElementEdit` copies
   (client + server) stay in sync.

3. **codeWriter dispatch branch** — in `applyEditsToSource`, before the JSX
   paths: if `edit.structureOp` is set → route to `writeBindStructure(source,
   edit.arrayName, edit.structureOp)` → return its result directly (standalone,
   like the shipped bindPath branch).

4. **Panel structure controls** (`InspectorPanel.tsx`) — when the focused
   selection's `bindPath` identifies a transcript entry (matches
   `^transcript\[id=\d+\]`), show a small structure toolbar: add-above,
   add-below, delete, move-up, move-down, change-role. Each builds the
   corresponding op (`afterId`/`beforeId` derived from the selection's id + the
   neighbor) and POSTs via `buildBindStructure`. **On success: `preview-reset` +
   `clear()` the selection** (the array mutated + the frame hot-reloads, so the
   held editId/DOM selection is stale — mirror the existing `move()` success
   path). On `{ok:false}` → calm error block (shipped fallback), no silent prompt.

5. **Frame-authored style reliability pass** (audit + targeted fixes, NOT a
   rebuild) — on a real Figma-import frame, verify the instant-style path:
   click a raw element → restyle (color token / spacing / font / type style) →
   persists to source. Known bails (`dynamic-classname` on `className={cond?…}`,
   `spacing-shorthand-conflict`) are correct — confirm they degrade to a calm
   block, not a silent no-op. Scope the user-facing claim to "static-class
   frame-authored elements." Fix any reachability/discoverability gaps found
   (e.g. ensure such elements are pickable + the panel shows the style fields).

## Data flow — representative edits

1. **Add a message:** click message id 2 → "add below" → `buildBindStructure
   {arrayName:"transcript", op:{kind:"insert", afterId:2, entry:{role:"user",
   text:"New message"}}}` → `writeBindStructure` computes id = max+1, splices a
   formatted entry after id 2 → reparse-guard → write → reload → new editable
   bubble; held selection cleared.
2. **Reorder:** click message → "move up" → `{kind:"move", id, beforeId:<prev>}`
   → entries reordered, ids intact → reload.
3. **Change role:** click a user message → "make assistant" → `{kind:"setRole",
   id, role:"assistant"}` → re-renders as an agent turn.
4. **Style a Figma-import heading (case A):** click `<h1>` → existing instant
   style → color token → className written to the frame's own source. Already
   works.

## Error handling

- Structure op with a missing `id` / `afterId` / `beforeId` → `{ok:false,
  reason}` → calm "couldn't apply" block, no silent prompt.
- Insert id = `max(numeric ids)+1`; tolerates runtime `Date.now()` ids already in
  persisted frames + non-numeric/missing id literals (skips them in the max scan).
- A splice that would not reparse → `{ok:false, reason:"reparse-failed"}`, file
  untouched.
- Stale selection after any structure op → cleared on success (no controls for a
  vanished node).
- Per-element style on a composite-internal node (case C) → no bind / not
  frame-authored → panel shows "Ask AI to change this" (only here).

## Testing

- **`writeBindStructure` (the core unit, pure):**
  - insert-after: new entry present at the right position, id = max+1, others
    intact, reparse-clean; insert at end when afterId null.
  - insert preserves FORMAT: against a multi-line trailing-comma array (the real
    seed shape) AND a single-line/no-trailing-comma array, the result reparses
    AND the new entry matches the surrounding style (assert the written entry
    is multi-line when the array is).
  - delete: entry gone, no dangling comma, others + their ids intact.
  - move: order changes, ids intact.
  - setRole: role flips; flipping to `user` STRIPS an `artefact` if present.
  - id scan: an array with a `Date.now()`-sized id → new id = that max+1.
  - bad id / absent array → `{ok:false}`; nothing throws.
- **Dispatch:** a `structureOp` edit routes to `writeBindStructure` (not the JSX
  path); a normal edit is unaffected; both `ElementEdit` copies have the field.
- **Panel:** a transcript-entry selection shows structure controls + writes +
  clears selection on success; a frame-authored element shows the instant-style
  fields (unchanged); a case-C node shows Ask-AI.
- **Frame-authored style reliability:** on a Figma-import frame, a raw element's
  color/spacing/font/type edit persists to source; a `className={cond?…}` element
  degrades to a calm block (not silent).
- **Manual gate (HUMAN):**
  - STRUCTURE on a generated Computer chat: add a message below another → new
    editable bubble; delete one → gone; move two → reorder; change a user message
    to assistant → re-renders as agent. All deterministic; scene stays
    interactive; the array in the frame source reflects each change.
  - STYLE on a Figma-import frame: recolor a heading / change spacing on a raw
    element → persists. A composite-internal bubble → panel offers Ask-AI, NOT a
    fake style control.

## Risks / honest limitations

- **Composite-heavy frames are not per-element style-editable.** Stated plainly,
  in the UI (Ask-AI), not just here. The kit doesn't expose it; widening kit
  composites to expose real style props is a separate design-system effort
  (explicitly out of scope, noted as the future unlock).
- **Frame-authored style is reliable only on static-class elements.** Dynamic
  `className={…}` degrades to Ask-AI/calm-block. Scope the claim accordingly.
- **Structure insert/format fidelity** is reparse-guarded AND format-matched, but
  exotic array formattings could still produce valid-but-slightly-off layout;
  reparse-guard prevents breakage, and the frame remains editable. Acceptable.
- **The bind/stamp convention is still per-composite hand-work.** This spec does
  NOT build a generic "composite declares its editable surface" primitive — that
  remains a pattern to copy. Honest: structure on a NEW composite still needs the
  array identified + entries id'd. ComputerScene already has it.
- **Verified by tests + reasoning** until the manual gate; mandatory given the
  history.

## Build sequence

1. **`writeBindStructure`** (pure, TS-AST) — the core, fully unit-tested
   (insert/delete/move/setRole + format fidelity + id scan).
2. **Dispatch + `buildBindStructure`** — thread the op through the visual-edit
   batch (optional-field, both ElementEdit copies).
3. **Panel structure controls** — toolbar on a transcript-entry selection +
   selection-clear on success.
4. **Frame-authored style reliability pass** — audit + targeted fixes on a
   Figma-import frame; scope the claim to static-class elements.
5. **Full suite + manual gate.**

## Out of scope

- Per-element style override on composite internals (case C → Ask-AI; the
  twice-reverted wall).
- Widening kit composites to expose real style props (separate DS effort).
- A generic declared-editable-surface primitive (future; pattern-copy for now).
- Lifting other ComputerScene content (sessions/people/header) to data (separate
  content-coverage effort).
- The Cloudflare share 500 (infra, tracked separately).
