# Rich Target Editor v2 — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Supersedes parts of:** `2026-06-23-rich-target-editor-design.md` (v1, shipped on `feat/rich-target-editor`)

## Why v2

v1 shipped a working single-element inspector. Live testing surfaced four
issues, three of which are entangled in the data model:

1. **Bug — selecting a block deletes it.** Root cause is v1's own
   final-review fix: `inspector.ts` resets/previews text with
   `node.textContent = originalSnapshot.text`. `originalSnapshot.text` is
   *direct* text only (`ownText` excludes children). For a **container**
   element (a div with child elements), own-text is `""`, so
   `textContent = ""` **deletes every child** → the block vanishes. A reload
   re-renders from source and brings it back. The auto-reset-on-new-pick
   logic (v1 `capture()`) triggers this on the *previously* selected node.

2. **Request — bulk editing.** Picking a new element should NOT end the
   session. The user wants to select element A, edit it, select B, edit it,
   … then Commit all at once. v1 is strictly one-element-at-a-time.

3. **Request — in-place text editing.** Editing text via a panel `<input>` is
   clumsy. The user wants design-mode's model: edit the text *on the element*
   in the frame.

4. **Corrections — panel resize + wider default.** The panel is fixed at
   280px and not resizable; labels collide with inputs. It should match every
   other pane in the app (drag-to-resize, persisted) and default wider.

(1), (2), and (3) are one redesign: the bug fix and bulk editing both require
abandoning v1's single-target/auto-reset model, and in-place text editing
**eliminates the bug by construction** (see below). (4) is independent and
trivial.

## How the pieces fit

### The bug dies by construction, not by patch

v2 **never** sets `textContent` on a container. Text is edited only **in
place**, and only on **leaf text elements** — elements whose own text *is*
their content. The rule:

- A node is **text-editable** iff `ownText(node) !== ""` AND it has no child
  *element* nodes (only text nodes). Buttons, headings, labels, paragraphs
  qualify; cards, rows, sections do not.
- Style edits (color/spacing/type) apply to **any** element, leaf or
  container — those use `node.style.*`, which never touches children.
- Because text is only ever written to leaf text nodes via `contenteditable`,
  the `textContent = ""` wipe is structurally impossible. There is no
  "restore text" reset path that runs on containers anymore.

### In-place text editing (replaces the panel Text input)

- The panel's **Text input row is removed.**
- After selecting a text-editable element, **double-click** it in the frame
  to drop a caret in. The element becomes `contenteditable` for that edit;
  typing updates the DOM directly = live preview for free.
- On **blur** (or Enter), `inspector.ts` reads the element's new own-text and
  posts it to the shell as that element's pending `text` edit, then removes
  `contenteditable`.
- The picker must let the double-click reach the element (today it
  `preventDefault`s every click). Single-click still = select; double-click
  on an already-selected, text-editable element = edit.

### Bulk editing (the data-model change)

- **Selection stays active** after a pick. The picker no longer
  `deactivate()`s on pick; it deactivates only on Escape, Commit, Discard, or
  closing the panel.
- Each picked element gets a stable **`editId`** (a monotonic integer stamped
  by `inspector.ts` as `data-arcade-edit-id` on the node). The shell keys all
  per-element state by `editId`. (This reverses v1's deliberate "no editId"
  cut — v1 had one live node so an id was needless; v2 has many live nodes at
  once, so the id is now genuinely required.)
- The shell holds a **batch**: an ordered list of `EditedElement` records,
  each `{ editId, selection (file/line/col/component/tag/styles), pending
  edits }`. The **focused** editId drives the control panel.
- Picking an element already in the batch **re-focuses** it (does not
  duplicate). Picking a new element appends it and focuses it.
- **Same frame only.** All elements in a batch share one frame (one source
  file → one Claude turn). Picking in a *different* frame prompts: "Commit
  current N edits first, or discard them?" — then starts a fresh batch in the
  new frame. (Cross-frame batches are explicitly out of scope — they'd need
  multi-file commit orchestration.)
- **Commit** serializes the whole batch (every element + its changes) into
  one instruction and sends it through the existing `onSend` pipeline.
- **Live preview is independent per element** — each edited node carries its
  own inline-style overrides simultaneously, so the user sees the whole batch
  building up in the frame.

### Panel resize + wider default (independent)

- Default width **280 → 360** (fixes label/input collision; labels are 72px +
  gaps + input need more room).
- A **drag handle on the panel's left edge**, mirroring the chat-pane resize
  in `ProjectDetail.tsx` (mousedown → track clientX → clamp min/max → persist
  to `localStorage`). Min 280, max 560. Key `studio:inspectorWidth`.

## Architecture — what changes from v1

| Unit | v1 | v2 |
|---|---|---|
| `targetSelectionContext.tsx` → **`editSessionContext.tsx`** (renamed) | single `target` + flat `pending` | a `batch: EditedElement[]`, `focusedEditId`, `frameSlug` + `frameWindow` for the batch, add/focus/remove/setField/reset/clear, `inspectorOpen`, `inspectorWidth` + setter. |
| `inspector.ts` | one retained `editingNode`; `textContent` reset path | a **Map<editId, {node, original}>**; stamps `data-arcade-edit-id`; style preview per editId; **contenteditable** flow for text-editable leaves; **no `textContent` reset on containers**; reports `editId` + `textEditable` flag + styles in the pick message; clears one or all overrides by editId. |
| `picker.ts` | `deactivate()` on every pick | stays active after pick; emits `editId` + `textEditable`; lets double-click through for text edit. |
| `visualEditPreamble.ts` | `(target, pending)` → one element | `(elements: EditedElement[], frameRel)` → one instruction listing every element + its changes; still token-idiomatic; still "" when batch empty. |
| `InspectorPanel.tsx` | single element's controls + Text input | a **batch list** ("N elements edited", click to focus, × to remove) + the focused element's controls (Text input **removed**) + Commit/Discard; **resizable** with a left drag handle + wider default. |
| `FrameCard.tsx` | pick → setTarget + open | pick → add-or-focus in batch + register frameWindow (guard: different frame → prompt); keeps picker active. |
| `ProjectDetail.tsx` | mount panel, fixed column | mount panel, **`auto` column already**; width now driven by context `inspectorWidth`. |

### Types

```ts
export interface StyleSnapshot { /* unchanged from v1 — text + 17 style fields incl. gap */ }
export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;

export interface ElementSelection {
  editId: number;
  file: string; line: number; column: number;
  componentName: string; tagName: string;
  /** true iff own-text non-empty AND no child element nodes (text-editable leaf). */
  textEditable: boolean;
  styles: StyleSnapshot;
}

export interface EditedElement {
  selection: ElementSelection;
  pending: PendingEdits;
}
```

### postMessage protocol (extends v1)

Parent → iframe:
- `arcade-studio:frame-pick-start` / `-stop` *(exists)*
- `arcade-studio:preview` — now `{ editId, field, value }` (per-element)
- `arcade-studio:preview-reset` — now `{ editId }` (reset one element) or
  `{ all: true }` (reset whole batch on Discard/Commit)
- `arcade-studio:text-edit-start` — `{ editId }` (parent asks iframe to make
  that element contenteditable + focus it; sent on the panel's behalf when a
  text edit begins, though double-click originates in-iframe — see note)

iframe → parent:
- `arcade-studio:frame-picked` — now `{ selection: ElementSelection }` (incl.
  `editId`, `textEditable`)
- `arcade-studio:text-changed` — `{ editId, text }` (posted on blur after an
  in-place edit)
- `arcade-studio:frame-pick-cancelled` *(exists)*

**Note on double-click origin:** the double-click is detected *inside* the
iframe (that's where the element lives), so `inspector.ts` owns the
contenteditable lifecycle directly and just reports `text-changed` on blur.
`text-edit-start` exists for completeness (panel could trigger it) but the
primary path is iframe-local.

## Live preview mechanism (unchanged principle)

Still inline `node.style.*` per element — no managed stylesheet (v1's rejected
over-engineering stands). The only change: overrides are tracked **per editId**
in a Map so multiple elements preview at once. Commit still reads the shell's
batch state, **never the DOM**, so preview fragility cannot corrupt a commit.
Text preview is now the contenteditable DOM itself (live), read back to
pending on blur.

## Error handling

- **Pick a non-text element for text editing:** double-click does nothing if
  `textEditable` is false (no caret, no-op). Style controls still work.
- **Different-frame pick mid-batch:** prompt to commit-or-discard the current
  batch before switching (no silent cross-frame mixing).
- **Node vanishes (remount):** that element's inline preview is lost; its
  pending entry survives in the shell; commit unaffected (reads batch).
- **Empty batch / all-reset element:** Commit with no real changes discards
  instead of sending (v1 behavior, extended to the batch).
- **Phantom edit:** inherited via `onSend` → existing `phantomEditRetry.ts`.

## Testing

- `editSessionContext` — add element, re-pick same editId re-focuses (no
  dup), remove element, setField/reset per editId, clear, frame-switch reset,
  width setter.
- `inspector.ts` — `textEditable` classification (leaf-with-text true;
  container false; empty-leaf false); style preview per editId on the right
  node; **container never has textContent zeroed** (regression test for the
  bug: apply/reset a container, assert children survive); contenteditable
  blur posts `text-changed`.
- `visualEditPreamble` — multi-element batch serialization; single element;
  empty → ""; text vs style lines.
- `InspectorPanel` — batch list renders N, focus switch, remove, Commit sends
  preamble with all elements, resize handle updates width.
- Manual e2e — the four real scenarios from this round (no disappearing
  block; bulk edit 2+ elements then commit; in-place double-click text; resize
  + width).

## Key decisions

1. **In-place text editing kills the bug by construction** — text only ever
   touches leaf text nodes via contenteditable; containers' text is never
   written. Chosen over patching the reset to skip containers (patch leaves
   the footgun; construction removes it).
2. **`editId` per element** — now earned (multiple simultaneous live nodes);
   reverses v1's YAGNI cut, documented.
3. **Same-frame batches only** — one source file, one Claude turn; cross-frame
   deferred (multi-file commit is a separate problem).
4. **Switch-with-list panel UX** (chosen) — focused controls + a compact
   edited-elements list to revisit/remove; not an accordion (too tall) or
   silent (lose track).
5. **Double-click to edit text** (chosen) — select on single-click, caret on
   double-click; avoids stray-click text nudges while staying close to
   design-mode.
6. **Rename context to `editSessionContext`** — it now models a batch edit
   session, not a single target; the old name would mislead.

## Migration / compatibility

This is all on the unmerged `feat/rich-target-editor` branch — no shipped
version to keep compatible with. The v1 commits stay in history; v2 rewrites
the same files forward. The branch ships as one feature when done.
