# Predictable Editing Redesign (v1) — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)

## Problem

Live testing of the current panel-driven editor failed on four counts, all rooted
in one design flaw:

1. **No way to clear/overwrite number inputs** — `type="number"` + the px-suffix
   round-trip makes editing existing values cumbersome.
2. **Inconsistent live preview** — sometimes a change shows on canvas, sometimes
   not.
3. **"Commit" silently sends an agent prompt** — the user can't tell what is
   actually applied without committing, and Commit often just routes to the AI
   chat (the old flow with extra steps).
4. **The Customize chip is unreachable** — the cursor can't land on the floating
   `Customize` link.

The deeper flaw under #2/#3: the deterministic instant-edit path covers only a
narrow slice (exact Tailwind scale steps, token colors, font weight on plain
elements). **Everything else — width/height, arbitrary px, kit components,
dynamic classNames — silently falls to the AI**, so the experience is
unpredictable: sometimes instant, sometimes a spinner, with no signal which or
why. The hybrid that looked clean on paper reads as "random and broken" in use.

## The model (Figma-Make-style), as decided

Editing becomes **predictable and honest**. Two kinds of change, behaving
differently and visibly:

- **Instant changes** (deterministic): color, spacing, font, text, reorder, and
  now **width/height and any arbitrary px**. These apply to code the moment you
  make them — no staging, no Apply click, no spinner. Each lands in the chat
  panel as a **done block with Undo**.
- **AI-needed changes** (the un-mappable few): dynamic className (`cn(...)`,
  conditionals), kit-component internals, anything the writer can't represent.
  These appear as **pending blocks** requiring explicit **Apply** (and
  discardable before applying), because they cost time/tokens — the user opts in.

The chat panel shows a **mixed stream**: instant edits as ✓-done-with-Undo; AI
edits as pending Apply/Discard. The user is never surprised by a spinner (instant
is instant), never charged for AI without consent, and **Undo covers both**.

"Applied" now always means "written to code." *How* it's written (deterministic
vs agent) is invisible plumbing.

### Decisions locked during brainstorming

- **Live preview, code-on-action.** Changes preview instantly in-browser. Instant
  (deterministic) changes write to the file immediately and become done blocks.
  AI changes stay pending until Apply.
- **Most changes do NOT route to the agent.** Deterministic by default; agent is
  the rare fallback.
- **Arbitrary px → Tailwind arbitrary values** (`w-[300px]`, `p-[18px]`,
  `text-[15px]`), snapping to a scale step (`p-4`) when the value is one. This is
  what makes width/size/off-scale values instant. Stays in the className world.
- **Undo = per-change file snapshots, LIFO.** Before each applied change,
  snapshot the frame `index.tsx`; Undo restores the prior snapshot. A stack gives
  multi-step undo in reverse order. Uniform for deterministic + AI edits.
- **v1 scope = trustworthy panel editing.** On-canvas resize/move HANDLES are
  DEFERRED to a later phase (own spec). v1 makes the editing model honest first.
- **Inline text edit** stays (double-click), refitted to the block model.

## What this fixes (mapping to the four failures)

- **#1 number inputs** — replace `type="number"` with a text input that allows
  empty + free editing; commit on blur/Enter; tolerate empty (no value → no
  change). (See "Number input" below.)
- **#2 inconsistent preview** — the preview path is unified: every field previews
  through one mechanism, and the done/pending block reflects the real applied
  state, so "did it apply?" is always answerable from the panel.
- **#3 Commit confusion** — the explicit "Commit" button is REMOVED. Instant
  edits self-apply (done block + Undo); only AI edits have Apply. No hidden
  prompt.
- **#4 unreachable Customize** — the chip becomes a reliable click target (see
  "Customize chip fix").

## What exists today (reused / modified)

- **Picker / inspector / overlay** (`src/frame/*`) — element selection, style
  capture, inline preview via `postMessage`, contenteditable text. Reused; the
  preview path is unified.
- **Code-writer** (`server/codeWriter/*`) — `pxScale` (value→class), `classFamily`
  (family-aware swap), `locateJsx`, `patchSource`, `writeBatch` (reparse-guarded,
  all-or-nothing). EXTENDED: `pxScale` emits arbitrary `[…]` values; sizing fields
  stop bailing.
- **`/api/visual-edit`** endpoint + `visualEditClient` — reused as the
  deterministic write path; gains a per-write snapshot for undo.
- **Customize** (`server/customize/*`, the chip) — kept; chip reachability fixed.
- **Chat panel** (`ChatStreamProvider`, the existing message list) — the block
  stream is rendered here; the existing chat send path is the AI-edit Apply.
- **`frameChangeContract.ts`** (`snapshotProjectFiles`) — the seam for the undo
  snapshot stack.

## Architecture

```
Select element → edit in panel (live preview, instant)
        │
        ├─ deterministic?  ── YES ──→ snapshot frame → /api/visual-edit writes code
        │  (color/spacing/font/text/reorder/size/arbitrary-px)   → DONE block + Undo
        │
        └─ NO (dynamic className / kit-internal) ──→ PENDING block
                                                      → user clicks Apply
                                                      → snapshot → agent writes → DONE block + Undo

Chat panel = stream of blocks:
  [✓ padding → 24  ↶Undo]   (instant, already applied)
  [✓ color → muted  ↶Undo]
  [⏳ "make this responsive"  Apply | Discard]  (AI, pending)
```

### New / changed units

1. **`pxScale` extension** (`server/codeWriter/pxScale.ts`) — `translateField`
   stops returning `null` for sizing/off-scale. Instead:
   - value maps to a scale step → emit the step class (`p-4`, `w-64`);
   - else → emit a Tailwind arbitrary value (`p-[18px]`, `w-[300px]`,
     `text-[15px]`, `opacity-[0.37]`).
   - `classFamily` already swaps within a family; arbitrary values share the same
     prefix family (`w-`, `p[trbl]-`, etc.) so swap/remove still works.
   - Net effect: deterministic coverage expands to nearly all numeric/color/font
     edits; the writer only bails on genuinely non-className-expressible changes.

2. **Undo snapshot stack** (`server/customize` pattern generalized →
   `server/editHistory.ts`) — keyed per `slug::frameSlug`, a LIFO stack of
   pre-change frame-source snapshots. `POST /api/edit-undo/:slug` pops + restores
   the top. Each deterministic write AND each AI-applied edit pushes a snapshot
   before writing. (Replaces the single-slot Customize snapshot with the shared
   stack; Customize undo rides it.)

3. **Block-stream model** (client) — an `EditBlock` per applied/pending change:
   `{ id, label, kind: "instant" | "ai", status: "applied" | "pending" |
   "working", undoable }`. Instant edits create an `applied` block immediately;
   AI edits create a `pending` block with Apply/Discard. Undo on a block calls
   `/api/edit-undo` and marks the block undone. Rendered in the chat panel
   alongside conversation.

4. **Inspector change flow rewrite** (`InspectorPanel.tsx`) — `change()` no longer
   stages into a batch awaiting Commit. Instead, on each edit it (a) shows live
   preview, (b) immediately attempts the deterministic write, (c) on success →
   emits an instant `applied` block; on deterministic-bail → emits a `pending` AI
   block. The **Commit button is removed**. Discard/Undo act per-block.

5. **Number input** (`inspectorControls.tsx` `NumberField`) — switch from
   `type="number"` to `type="text"` with `inputMode="decimal"`; allow empty
   string (clears the field, no edit emitted until a value is entered); parse a
   bare number → px; commit on blur/Enter; reject non-numeric gracefully. Fixes
   the can't-clear / cumbersome-overwrite problem.

6. **Customize chip reachability** (`overlay/overlays.ts`) — the chip is a small
   floating target the cursor can't reach. Fix: enlarge the hit area, ensure
   `pointer-events: auto` + a high z-index above the frame content, and anchor it
   so it doesn't sit under the selection outline / off the scroll viewport.
   (Implementer to confirm the exact failure — overlap vs pointer-events vs
   off-viewport — during the fix; the spec mandates "a reliably clickable
   Customize affordance.")

## Data flow — instant edit (the common path)

1. User changes padding in the panel → `change()` posts live preview to the iframe
   (instant visual).
2. `change()` calls `/api/visual-edit` with the single-field edit (targets the
   session frame).
3. Server snapshots `index.tsx` (push to undo stack), writes the className change
   (now incl. arbitrary px), reparse-guards, returns `{ ok: true }`.
4. Client emits an `applied` instant block with Undo. Vite hot-reloads; the
   preview becomes the real rendered result.
5. If the server returns `{ ok: false, reason }` (dynamic className etc.) → the
   client converts it to a `pending` AI block instead (no file change yet).

## Error handling

- **Deterministic write fails reparse** → server aborts (file untouched), returns
  `{ ok: false }`; client falls to a pending AI block (the change can still be
  applied via agent). Never writes broken code.
- **Undo with empty stack** → `{ ok: false, reason: "nothing-to-undo" }`; the
  block's Undo is disabled once popped.
- **AI Apply fails** → block shows an error state; the snapshot was taken before,
  so state is recoverable; no partial write persists.
- **Number input non-numeric / empty** → no edit emitted; field shows empty,
  reverts to current value on blur if left empty.

## Testing

Follows Studio's "every fix gets a test" discipline.

- **pxScale arbitrary values** — `translateField("width","300px") === "w-[300px]"`;
  `translateField("paddingTop","18px") === "pt-[18px]"`; still snaps when on-scale
  (`"24px" → "pt-6"`); opacity off-step → `opacity-[0.37]`. classFamily swaps an
  arbitrary value with a scale value and vice versa.
- **Undo stack** — push N snapshots, pop restores in LIFO order; empty → no-op;
  deterministic and AI edits both push.
- **Number input** — clearing to empty emits no edit; typing a value emits px;
  non-numeric rejected; existing value editable without the old round-trip
  friction (component test).
- **Block model** — an instant edit yields an `applied` block; a deterministic
  bail yields a `pending` AI block; Undo on a block calls edit-undo and marks it
  undone; no Commit button rendered.
- **Customize chip** — the click target is reachable (hit area / pointer-events /
  z-index assertions in the overlay test); clicking still posts customize-request.
- **Regression** — the existing visual-edit, customize, inspector, and chat
  suites stay green; the Commit-removal doesn't orphan the AI fallback (AI Apply
  still sends the same scoped prompt).

## Risks / honest limitations

- **Arbitrary Tailwind values must be compiled.** `w-[300px]` only renders if
  Tailwind v4 scans the source after the write — confirmed how Studio scans
  (the `@source` setup). The hot-reload re-scans on write, so this should hold;
  the manual gate must verify an arbitrary-value edit actually renders.
- **LIFO-only undo** — you can't undo block #2 while keeping #3; Undo is
  strictly most-recent-first in v1. Accepted; reverse-patch per-block is a later
  enhancement.
- **No on-canvas handles in v1** — resize/move by grabbing the object is the next
  phase. v1 delivers predictable panel editing, not the full Figma feel.
- **The deterministic write happening on every keystroke/blur** must be debounced
  so a slider drag doesn't spam writes + snapshots — write on commit (blur/release),
  not per intermediate value. (Implementer: debounce the write, not the preview.)

## Out of scope for this spec

- On-canvas resize/move/restyle HANDLES (next phase, own spec).
- Reverse-patch / out-of-order undo (LIFO only here).
- Absolute x/y repositioning.
