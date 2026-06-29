# Style & Structure Editing — One Data-Bind Machine — Design

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)
**Builds on:** the shipped data-driven-composites work (`transcript` prop +
`data-arcade-bind` + `writeBindEdit`). This spec EXTENDS that one machine; it does
NOT introduce a new editing mechanism.

## Problem

After seven failed editing approaches, ONE worked: lift content into the frame as
DATA, have the composite stamp each rendered node with `data-arcade-bind`, and
write the frame's data array deterministically (`writeBindEdit`). That shipped for
ONE field (a chat message's `text` + artefact title). Two gaps remain, and the
designer is explicit that content-only is "not good enough":

1. **Style** — recolor / spacing / font / variant on what you click. Twice
   reverted (overlay, props-panel) because both tried to reach INTO a sealed
   composite and override pixels on a guessed element. That is **the wall**.
2. **Structure** — add / remove / reorder messages, change who-said-it. Never
   built. Naturally fits the data machine (it's array entries).

**The learning that governs this spec** (from 7 failures + the recorded
"scalable accuracy" rule): *the wall is sealed composites; editing only works
where the surface lives in the frame as data; never reach into a composite;
solve at the level of a reusable PRINCIPLE, not per-design patches.*

## Key evidence (measured this session)

A generated prototype is one of two worlds, and style differs sharply:

- **Frame-authored / flat-markup frames** (e.g. a Figma import: 33 raw host tags,
  4 kit components in a real sample): the elements are written DIRECTLY in the
  frame. The existing **instant style path already writes className changes into
  frame source** (color/spacing/font). Style here is RICH and already works — the
  job is reliability + reach, not new mechanism.
- **Composite-heavy frames** (ComputerScene: 0 raw tags, 1 component): everything
  is sealed in the composite. Style here is limited to what the composite EXPOSES
  as data (e.g. `ChatBubble` exposes only `variant: "sender" | "receiver"`).
  Honest ceiling: thin-but-real, not a wall.

## The model — ONE machine, three honest cases

```
EDITABLE SURFACE = (frame-authored elements) ∪ (data a composite exposes)

A. FRAME-AUTHORED element (raw <div>/<h1>/<button> the frame wrote):
   → existing instant-style path writes the className into frame source
     (text + color/spacing/font). RICH style. Already works.
   Job: make it reliable + discoverable on EVERY clickable frame-authored node.

B. COMPOSITE DATA ITEM (a transcript message, later a session row):
   → data-arcade-bind carries CONTENT fields (text — shipped) AND STYLE fields
     (e.g. transcript[id=2].variant) AND the item is part of a list (structure).
   → writeBindEdit writes the field into the frame's data array (proven).
   → STRUCTURE = the SAME writeBindEdit machine operating on whole array ENTRIES
     (insert / delete / move / change role) instead of one field.
   Style ceiling = exactly the variants the composite/kit exposes (honest, on-brand).

C. ARBITRARY INTERNAL CHROME a composite never exposed (a divider 3 levels deep):
   → Ask-AI (the honest escape; the agent edits source). Rare in practice.
```

**Scalable principle (the anti-per-design rule):** *a composite DECLARES its
editable surface — which fields are content, which are style, and which items are
list-structured — as data the frame owns.* One convention
(`data-arcade-bind` + a small per-composite "editable surface" declaration),
extended from text to style+structure. Authored once on ComputerScene, the
convention makes the next composite cheap — not a per-design patch.

## Decisions locked during brainstorming

- **Style first** (designer priority), then structure — but BOTH are designed
  here as one model so they share the machine. (Build order in the plan can run
  style-as-data before structure; see Build Sequence.)
- **Style is reliable + on-brand, NOT pixel-arbitrary.** Frame-authored → rich
  (className writes); composite items → the variants the kit exposes; arbitrary
  internal chrome → Ask-AI. We do NOT build freeform per-element CSS override on
  composite internals — that is the twice-reverted wall.
- **Structure = array-entry operations** via the existing writeBindEdit machine
  (extended from "set a field" to "insert/delete/move/role-change an entry"),
  addressed by message `id` (reorder-safe, per the shipped bind format).
- **No reaching into composites.** Every editable thing is either frame-authored
  source or a field the composite exposed as data. Case C is explicitly Ask-AI,
  not a new override layer.

## Architecture

```
studio/src/frame/  (in-frame, reused)
  ├─ picker: bind-first resolve (shipped) — a clicked bound node carries bindPath
  └─ instant-style path (shipped) — frame-authored nodes write className to source

studio/server/codeWriter/
  ├─ bindEdit.ts (shipped): writeBindEdit(source, "transcript[id=N].FIELD", value)
  │     → EXTEND: FIELD can be a style field (e.g. "variant"), not just "text"
  └─ bindStructure.ts (NEW): writeBindStructure(source, array, op) where op =
        { kind:"insert", afterId, entry } | { kind:"delete", id }
        | { kind:"move", id, beforeId } | { kind:"setRole", id, role }
        TS-AST edits to the frame's data array (same as bindEdit, on entries).

studio/prototype-kit/composites/ComputerScene.tsx
  ├─ stamp STYLE binds where a content item has a style axis
  │     (a message bubble already maps to ChatBubble variant — expose it as
  │      transcript[id=N].variant, default by role, stamped data-arcade-bind)
  └─ (Message type gains an optional `variant` field; render reads it)

studio/src/components/inspector/InspectorPanel.tsx
  ├─ bound STYLE field → a control (the kit's variant options) → writeBindEdit
  └─ bound list item → structure controls (add above/below, delete, move, role)
       → writeBindStructure
```

### New / changed units

1. **`writeBindEdit` style fields** (extend `bindEdit.ts`) — already walks
   `transcript[id=N].<field>` to a string-literal leaf. A style field
   (`variant`) is the same write. If the field is ABSENT on the entry (e.g. a
   message with no `variant` yet), the writer INSERTS the property into the
   object literal (new capability: add-prop, not just replace-value),
   reparse-guarded. Pure, by-id, JSON-escaped (all shipped properties).

2. **`writeBindStructure`** (`bindEdit-structure.ts`, new, pure TS-AST) — operate
   on the array as a whole: insert a new entry (with a fresh unique id) after a
   given id; delete the entry with an id; move an entry before another id;
   change an entry's `role`. Reparse-guarded; by-id throughout (never index).
   Returns `{ok, source}` / `{ok:false, reason}`.

3. **ComputerScene style binds** — give `Message` an optional `variant`; the
   transcript renderer reads it (falls back to role-derived default so existing
   frames are unchanged) and stamps the bubble with
   `data-arcade-bind="transcript[id=N].variant"` (in addition to the text bind).
   Only the variants `ChatBubble` actually exposes are offered. Byte-identical
   render when `variant` is absent.

4. **Panel: style + structure controls for a bound selection**
   (`InspectorPanel.tsx`) — when the selection's `bindPath` ends in a known
   STYLE field, render the kit's variant options (a select), writing via
   `buildBindEdit` (shipped path). When the selection is a list item, render
   structure actions (add above / add below / delete / move up / move down /
   switch role) → a new `buildBindStructure` payload → `/api/visual-edit`
   (a new dispatch branch, mirroring the bindPath branch).

5. **Frame-authored style reliability pass** (audit, mostly verification) — the
   instant-style path already writes className for frame-authored nodes. Verify
   it is reachable + reliable on a Figma-import frame (where style is richest):
   click any raw element → restyle (color token / spacing / font / type style)
   → persists to source. Fix gaps found; do NOT rebuild it.

## Data flow — three representative edits

1. **Style a message (composite data item):** click bubble → bindPath
   `transcript[id=2].variant` → panel shows ChatBubble's variant options → pick
   → `writeBindEdit` sets/inserts `variant` on entry id 2 → reload → bubble
   restyles. Deterministic, on-brand.
2. **Add a message (structure):** click a message → "add below" → `buildBindStructure
   {kind:"insert", afterId:2, entry:{id:<fresh>, role:"user", text:"New message"}}`
   → `writeBindStructure` splices a new object into the array → reload → new
   editable bubble appears.
3. **Style a Figma-import heading (frame-authored):** click the `<h1>` → existing
   instant-style path → change color token → className written to the frame's own
   source. Rich style, already works.

## Error handling

- Bound style field on an entry that lacks it → writer INSERTS the prop
  (reparse-guarded); on any parse failure → `{ok:false}` → no write + a calm
  "couldn't apply" block (the shipped fallback pattern), never a silent prompt.
- Structure op referencing a missing id → `{ok:false, reason}` → calm block.
- Insert id collision → the new id is computed as `max(existing ids)+1` so it's
  always unique within the array.
- Arbitrary internal chrome (case C) → no bind → the panel shows "Ask AI to
  change this" (only here, not for bound items — per the shipped UX fix).
- Frame-authored style write reparse fail → existing instant-style guard aborts.

## Testing

- **`writeBindEdit` style field** — set `variant` on an entry that has it;
  INSERT `variant` on an entry that lacks it; both reparse-clean; absent-array /
  missing-id → `{ok:false}`.
- **`writeBindStructure`** — insert-after (fresh unique id, correct position);
  delete (entry gone, others intact, ids unchanged); move (order changes, ids
  intact); setRole (role flips, text intact); each reparse-clean; bad id →
  `{ok:false}`; insert id = max+1 (no collision).
- **ComputerScene style bind** — a message with `variant` renders that variant +
  stamps `transcript[id=N].variant`; a message WITHOUT `variant` renders the
  role-default + still stamps (so it can be added); bare/legacy frames render
  byte-identical.
- **Panel** — a bound style selection shows the variant options + writes; a bound
  list item shows structure actions + writes; a frame-authored element shows the
  existing instant-style fields (unchanged); case-C (no bind) shows Ask-AI.
- **Frame-authored reliability** — on a Figma-import frame, a raw element's
  color/spacing/font/type edit persists to source (regression-verify the shipped
  path).
- **Manual gate (HUMAN):** (a) STYLE — on a generated Computer chat, click a
  message → change its variant → persists; on a Figma-import frame, recolor a
  heading → persists. (b) STRUCTURE — add a message below a message → new
  editable bubble; delete one → gone; reorder two → order changes; change a
  user message to assistant → re-renders as agent. All deterministic, scene stays
  interactive. Case-C internal chrome → Ask-AI (no false "editable" promise).

## Risks / honest limitations

- **Composite-item style is only as rich as the kit exposes.** A ChatBubble
  offers `sender/receiver` — that's the honest ceiling for a message; we do NOT
  invent arbitrary recolor on it. Where designers need more, that's either a
  frame-authored element (rich) or Ask-AI. Stated plainly to avoid the
  expectation gap that sank prior attempts.
- **The richest style lives on frame-authored elements**, which is most of a
  Figma-import frame but little of a composite-heavy one. So "style anything" is
  honestly "style frame-authored richly + composite items within their variants +
  Ask-AI for the rest." That IS the on-brand model the designer approved.
- **Structure is full** on the transcript (and any composite list we later mark
  structured); other composites get it when their lists are declared editable —
  the scalable convention, not a per-design patch.
- **Build order is style-first per priority**, but both share one machine, so
  neither blocks the other.
- **Verified by tests + reasoning** until the manual gate; given the history, the
  gate is mandatory before "done."

## Build sequence (each independently testable, all on proven ground)

1. **Style-as-data field** (priority): `writeBindEdit` add-prop + ComputerScene
   `variant` bind + panel variant control. Smallest extension of the shipped
   text machine; delivers the style win on a composite item.
2. **Frame-authored style reliability pass**: audit + harden the existing
   instant-style path on a Figma-import frame (where style is richest). Mostly
   verification + gap fixes, no new mechanism.
3. **Structure**: `writeBindStructure` + ComputerScene list-item structure binds
   + panel structure controls (add/delete/move/role).
4. **Full suite + manual gate.**

## Out of scope

- Freeform per-element CSS override on composite internals (the reverted wall).
- Lifting OTHER ComputerScene content (sessions, people, header) to editable data
  — valuable, but a separate content-coverage effort; this spec is style +
  structure on the message surface + frame-authored style.
- Generalizing the declared-editable-surface convention to other composites
  (future; this proves it on ComputerScene first).
- The Cloudflare share 500 (infra, tracked separately).
