# Direct Canvas Editing — Design (Phase A foundation)

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)

## Problem

Today the canvas (the central viewport that renders generated React frames) is
mostly a viewer. A user can pan, zoom, pick an element, and tweak its styles in
the Inspector — but every change is serialized into a chat prompt and applied by
the Claude subprocess. That round-trip means latency, token cost, and a
"Thinking…" spinner for even trivial edits like changing a label or nudging
padding.

We want the canvas to feel more like Figma — direct manipulation of real coded
objects — starting with making the common edits **instant and deterministic**,
no AI in the loop.

## Scope of this spec

This spec covers **Phase A: the deterministic code-writer foundation**, driven
through the existing Inspector panel. On-canvas drag handles, selection boxes,
and freeform manipulation are **Phase B**, previewed at the end but not specified
here.

### Decisions locked during brainstorming

- **Core job:** edit objects in place (restyle, edit text, reorder within
  layout). NOT wiring flows, NOT FigJam-style arrangement, NOT a component
  palette.
- **Manipulations in A:** restyle (color, spacing, font, radius…), edit text
  content, reorder-within-layout (sibling up/down). Freeform x/y move is out;
  movement is auto-layout-style reorder only.
- **Feel:** hybrid. Instant deterministic edits for clean cases; silent fall
  back to a quick AI edit when the change can't be mapped to code directly.
- **Kit boundary:** "show what's editable, gray the rest." Kit components expose
  their declared props for editing; deep internal restyle is blocked (with an
  "Ask AI to customize" escape), not silently AI-wrapped.
- **Reorder:** ship in A (sibling up/down move), so Phase B's drag reuses the
  same node-move writer.
- **Undo:** reuse whatever exists. Today nothing exists (see below); direct
  edits inherit the same no-undo gap as today's AI edits. Not a blocker.

## What exists today (reused, unchanged)

The risky "resolve a clicked pixel back to source code" work is already shipped:

- **Picker** (`studio/src/frame/picker.ts`) — runs inside the frame iframe;
  resolves a clicked DOM node to its JSX source `file:line:column` via the React
  19 `_debugStack` fiber walk (`resolveSelection`, picker.ts:94). Also returns
  `tagName`, `componentName`, `textEditable`, and a captured `StyleSnapshot`.
- **Inspector** (`studio/src/frame/inspector.ts`) — captures element styles and
  applies inline live previews via `postMessage`.
- **Edit-session batch** (`studio/src/hooks/editSessionContext.tsx`) — holds the
  `EditedElement[]` batch (all from one frame), each with a `pending` style map
  whose values are already Tailwind/token classes.
- **Preamble serializer** (`studio/src/lib/visualEditPreamble.ts`) —
  `buildVisualEditPreamble()` turns the batch into a Claude instruction. This
  becomes the **AI fallback path**, unchanged.
- **Hot reload** — `projectWatchPlugin.ts` watches `frames/<frame>/index.tsx`
  and triggers Vite full-reload on write; the frame re-renders automatically.

**No undo / revert / git snapshot exists today.** `frameChangeContract.ts`
(`snapshotProjectFiles` / `diffSnapshots`) captures per-turn snapshots only for
change-detection and discards them. Frames overwrite in place. Recovery today =
re-prompt. Direct edits inherit this; the snapshot infra is the natural seam if
undo is added later.

## Architecture

One new server module forks the "Apply" step:

```
pick → tweak in Inspector → Apply
                              │
          deterministic? ─────┼──── too complex / kit-internal?
                ↓                              ↓
   code-writer patches index.tsx     existing chat path (buildVisualEditPreamble)
                ↓                              ↓
        Vite hot-reload                Claude subprocess → Vite hot-reload
```

### New pieces

1. **`POST /api/visual-edit/:slug`** — server endpoint. Body = the existing
   `EditedElement[]` batch (frame slug + per-element `file`/`line`/`column` +
   `pending` map). Returns `{ ok: true }` after a successful direct patch, or
   `{ ok: false, reason }` to signal the client to fall back to chat.

2. **`studio/server/codeWriter.ts`** — the deterministic patcher. Reads the
   frame source, applies the edit via AST, re-parses to confirm validity, writes.

### Why server-side

Frame source lives on disk
(`projects/<slug>/frames/<frame>/index.tsx`). Only the server can read/write it.
The client sends edit *intent*; the server does the AST patch.

## The code-writer

**Goal:** given "element at `line:column`, set padding → `p-6`, color →
`text-(--fg-muted)`, text → 'Save'", change exactly that element and nothing
else.

**Find the element:** parse `index.tsx` into an AST with Babel (already present
via Vite/React tooling). Walk to the JSX element whose opening tag is at the
picker-supplied `line:column`. Exact-coordinate match — no string-search
ambiguity, no "zero or multiple matches" hazard the chat path warns about.

**Apply each change type:**

- **className edits** (color, spacing, radius, font, display, etc.): the
  Inspector already emits Tailwind/token classes. Read the element's `className`
  string literal, remove any existing class in the **same family** (drop old
  `p-4` when adding `p-6`; drop old `text-(--fg-*)` when setting a new text
  color), append the new class. Family-aware removal prevents class pile-up.
- **text content:** replace the element's JSX text child with the new string.
- **kit prop attribute:** for a kit component, set/replace a JSX attribute
  (`variant="primary"`) — see Kit boundary.
- **reorder within layout:** move a child JSX node up or down among its siblings
  in the same parent. Deterministic sibling-array reorder; no x/y.

**Bail conditions → AI fallback** (return `{ ok: false, reason }`):

- `className` is not a plain string literal (`cn(...)`, template literal,
  conditional expression, or a variable reference).
- The text child is not a plain string (`{label}`, interpolation, multiple
  expression children).
- The target is a kit component and the change addresses its internals (not an
  exposed prop or the outer-box `className` passthrough).

**Safety — re-parse guard:** after computing the patch, re-parse the resulting
source. If it doesn't parse, discard the patch (file untouched) and return
`{ ok: false, reason: "reparse-failed" }`. The writer never persists invalid
code.

## Kit boundary ("show what's editable, gray the rest")

**Detecting a kit component:** the picker returns `tagName` + `componentName`.
An uppercase tag matching a kit export (e.g. `Button`, not `div`) is a kit
component. The kit ships TypeScript types in its dist (`index.d.mts` — the same
file the import-validation hook already reads). The writer reads the component's
declared prop names + union values once and caches them.

**Inspector behavior for a kit component:**

- **Editable:** declared props (`variant`, `size`, `tone`, …) shown as
  dropdowns. Changing one patches the JSX attribute deterministically. We only
  ever offer props the component actually declares, so an attribute patch can't
  produce invalid code.
- **Grayed:** internal style controls (padding inside the Button, its font)
  shown disabled with a one-line "part of the Button component" note, plus a
  small "Ask AI to customize" action that routes that element to the chat path.
- **Outer-box vs internal:** most kit components accept a `className`
  passthrough. Setting an outer-box style (e.g. margin) on a `<Button>` writes
  to its `className` attribute — legitimate — while true internals stay grayed.

**Raw elements** (`div`, `span`, `p` the user authored): full restyle, nothing
grayed. This is where Phase-A deterministic editing is richest.

## UX surface (Phase A — Inspector-driven)

**Restyle:** pick element → Inspector opens (as today) → drag a slider or pick a
token. Live preview already renders inline (existing `postMessage`). On release,
the code-writer patches the file → Vite reloads → preview becomes real. No
spinner for clean edits.

**Edit text in place:** double-click a text element → contenteditable (exists
today). On blur, the code-writer writes the new string straight to the JSX text
child. Instant.

**Reorder within layout:** sibling elements get up/down move controls in the
Inspector (not drag yet). Moves the JSX node among its siblings. This exercises
the node-move writer that Phase B's drag will reuse.

**Feedback signals (the hybrid tell):**

- Instant edit: brief flash/checkmark on the element; no "Thinking…".
- AI fallback: existing "Thinking…" indicator, so the user knows latency/tokens
  are in play and why.
- Failed/bailed patch: silent fall to AI — the user never sees a broken state.

**"Apply" button:** retained as the commit for **batches** and **AI-fallback**
edits; relabeled so it's clear when AI is involved. Single clean edits don't
need it.

**Batch rule:** if *any* element in a batch hits a bail condition, the **whole
batch** goes to the AI path (avoids a half-deterministic / half-AI race on one
file).

## Testing

Follows Studio's "every fix gets a test" discipline.

- **`__tests__/server/codeWriter.test.ts`** — table of input `index.tsx` snippet
  + edit intent → expected output: add class to empty className; swap within
  family (`p-4`→`p-6`); set color token; replace text child; set kit prop attr;
  sibling reorder up/down.
- **Fallback-detection tests** — each bail condition (`cn()`, conditional,
  `{interp}`, kit-internal) asserts `ok: false` + correct reason. This is the
  safety net: a missed bail = broken code on disk.
- **Re-parse guard test** — an edit that would yield invalid syntax: assert the
  writer discards, signals fallback, leaves the file unchanged.
- **Kit-prop introspection test** — given a known kit `.d.mts`, assert the
  correct editable-prop list (guards the gray-vs-editable boundary).

No new component-render tests required; the Inspector UI largely exists.

## Out of scope for Phase A (explicit)

- On-canvas drag handles, selection boxes, freeform x/y move.
- Multi-frame selection, layers / outliner panel.
- Dedicated undo stack (reuse the no-undo status quo; snapshot infra is the
  future seam).

## Phase B preview (not specified here)

Phase B adds an interactive overlay rendered in canvas coordinates on top of the
iframe: selection box, resize handles, drag-to-reorder-within-layout, inline
text caret — all mapping to the **same** code-writer this spec builds. Hard
parts deferred to B's own spec: mapping iframe-internal element rects into the
zoomed/panned canvas space, drag-reorder respecting flex/grid order, and keeping
handles glued across HMR. Phase A deliberately proves the deterministic
write-back (the genuinely risky piece) before B layers direct manipulation on
top.
