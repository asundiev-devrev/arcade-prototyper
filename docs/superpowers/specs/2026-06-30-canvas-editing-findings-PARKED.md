# Canvas Editing — Findings & Why It's Parked

**Date:** 2026-06-30
**Status:** PARKED after 8+ attempts. This document is the durable record so the
effort isn't repeated blindly. Code reverted; everything recoverable (see Recovery).
**Branch:** `feat/direct-canvas-edit` (unmerged; branched from `3884e2e`).
**Full archive tag:** `canvas-edit-full-archive` (HEAD of the whole effort, all
attempts + docs, recoverable any time).

## The goal

Make Arcade Studio prototypes editable **beyond the chat prompt** — let a designer
manipulate the rendered canvas (frames) directly, "like Figma but with real coded
objects." Concretely the job narrowed to: **fast, precise tweaks** — click a thing,
change its text/style/structure, without a prompt round-trip.

## The wall (the one root cause behind every failure)

Generated prototypes are **composed of kit composites**, and the high-value ones
are **self-contained interactive composites** (e.g. `ComputerScene` — a whole chat
app rendered from one line `<ComputerScene/>`). Their content + styling live
**inside the sealed kit component**, NOT in the frame the designer owns. So:

> There is no location in the frame's own source to edit, for anything baked
> inside a composite. Every editing approach that tries to reach INTO the
> composite hits this wall.

Eight approaches confirmed it from different angles. The ONLY thing that ever
worked was the inverse move: **lift content OUT of the composite into frame data**
(the `transcript` prop) — then editing that data is a normal, deterministic source
edit. But that only covers what the composite is refactored to expose, and it does
NOT cover styling (the kit owns rendering) or arbitrary internal elements.

## What was attempted (chronological), and why each failed

1. **Detach / eject** — serialize a clicked composite subtree to editable JSX.
   Failed: fiber-walk crashed on real trees; flattening either moved the opaque
   wall down one level or froze the kit (lost interactivity).
2. **Props-first panel** — edit the resolved in-frame component's declared props.
   Failed: a generated frame is ~95% nested kit components with no editable
   string-union props that matter; "No editable properties" + a useless Ask-AI.
   (Reverted, commit `33675dd`.)
3. **Auto-expand (SettingsPage)** — after generation, flatten a slot-layout
   composite into editable host markup. **Partially shipped + works for
   SettingsPage** (a slot graph). Did NOT generalize to scene composites, whose
   content is baked, not slotted.
4. **Overlay tweaks** — anchor visual overrides to rendered DOM nodes, persisted
   as a sidecar layer. Failed (adversarial review, pre-build): structural anchors
   silently re-apply to the WRONG node on live-mutating composites; and "commit
   to code" structurally can't write composite-internal overrides. (Superseded,
   never built — spec `017e0b2`.)
5. **Data-driven composites (transcript)** — lift the chat transcript into a
   frame `const transcript=[...]` prop; ComputerScene stamps each message with
   `data-arcade-bind="transcript[id=N].field"`; `writeBindEdit` edits that array
   by id. **This WORKED for message TEXT** — the one genuine success. Shipped
   commits `27ed06d`..`9625460` + the seed/as-const fixes. Verified live: edit a
   message's text → persists, scene stays interactive.
6. **Structure editing** — add/delete/move/change-role on the transcript array
   via `writeBindStructure`, surfaced as a panel toolbar. **Technically works**
   (deterministic, all formats, wall-safe) but the **manual gate rejected the
   UX**: clicking message text → reading a toolbar → clicking "Add below" feels
   SLOWER than typing "add a message after this." (Commits `e28287c`..`7d5b669`.)
7. **Frame-authored style hardening** — confirmed the instant-style className
   write works + is reachable for raw elements in Figma-import frames (style IS
   rich there). Test-only; no gap found. (Commit `a1c516f`.)
8. **Per-element style on composite bubbles** — DEAD END, confirmed twice. The kit
   exposes no style axis for a message (`ChatBubble` = `variant: sender|receiver`
   only; assistant messages via `ChatMessages.Agent` have none). And the panel
   BUG found at the final gate: a bound message selection fell into the
   style-editor branch, so changing a bubble's color previewed then REVERTED
   (the write can't persist — kit owns the styling). This is the wall again.

## What we actually learned (the durable value)

- **The wall is generation/architecture, not the editing layer.** Stop building
  editing UIs on top of opaque composites. Either the content is frame-owned data,
  or it's not editable in-place (→ Ask-AI).
- **Two worlds of prototype, opposite editability:**
  - **Figma-import / flat-markup frames** (lots of raw `<div>`/`<h1>`): style +
    text edits ALREADY work via the instant-style className write to frame source.
    This is solid ground.
  - **Composite-heavy frames** (ComputerScene): content can be lifted to data
    (text edits work), but **styling and arbitrary internal structure cannot be
    reached** — that's the kit's job.
- **Data-bind machine is real and reusable** (`data-arcade-bind` +
  `writeBindEdit`/`writeBindStructure`): deterministic, id-addressed, reparse-
  guarded, format-robust. It works for any content a composite is refactored to
  expose as a frame data array. The limit is **authoring cost** — each composite
  must be hand-refactored to lift + stamp its content; there's no generic
  "declare your editable surface" primitive (would be the real scalability unlock).
- **Direct-manipulation lost to prompting for STRUCTURE.** The designer's verdict:
  for add/remove/reorder/role, a sentence to the AI beats click→toolbar. Deterministic
  TEXT edit (double-click → type) is the one direct gesture that felt worth it.
- **Adversarial, code-running reviews are the highest-leverage check.** They caught:
  a dead-on-arrival bug (slug routing), an oversold feature (composite style), two
  regressions-in-waiting, and the final "Move to end produces invalid TSX" Critical
  — all before merge, several by RUNNING the code against the real generated frame.

## Why parked (not "failed")

The editing-layer investment keeps hitting the same architectural wall, and the
one UX that works (direct text edit) is narrow while the rest (structure, style)
either feels worse than prompting or can't persist. Continuing to polish the
canvas-edit UX is low-yield. The honest next move — if revisited — is NOT another
editing layer; it's one of:

- **Make composites expose real editable surface** (content AND style as props the
  frame sets), + a generic stamping/declaration primitive so it scales past one
  composite. This is design-system + kit work, not editing-layer work.
- **Lean into prompting** for structure/style (it's what felt fast), and keep
  ONLY the deterministic direct text edit as the manipulation affordance.
- **Generate flat/editable from the start** for prototypes the designer intends to
  edit (the auto-expand idea, generalized) — accept the interactivity tradeoff.

## What survives the revert (intentionally kept)

- This findings doc + all the specs/plans under `docs/superpowers/` (the reasoning
  trail of 8 attempts).
- `d740ffb` — chat live-preview + ttft/turns telemetry (unrelated, shipped, useful).
- The auto-expand work for SettingsPage (commits `84d258e`..`ef75434`) IF the
  revert is scoped to only the data-driven + structure + style work — see Recovery
  for the exact range decision (the user chose what to revert).
- Anything on `main` is untouched (this branch is unmerged).

## Recovery

Everything is in git, nothing is destroyed:
- **`canvas-edit-full-archive`** tag = the entire effort at HEAD (all attempts).
- **`props-panel-attempt-archive`** tag = the earlier props-panel attempt.
- The branch `feat/direct-canvas-edit` itself retains full history until deleted.
- To resurrect any specific piece: `git checkout <commit>` or cherry-pick from the
  archive tag. The data-bind machine (`writeBindEdit`/`writeBindStructure`/
  `bindEdit.ts`/`bindStructure.ts`) is the most reusable artifact if editing is
  revisited.
