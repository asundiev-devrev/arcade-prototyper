# Data-Driven Composites — Lift Baked Content into Editable Frame Data — Design

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)
**Scope:** Validate the pattern on ONE composite (ComputerScene) + ONE content
type (the chat transcript) before generalizing.

## Problem

Six editing approaches failed in a row (detach → props-first → auto-expand →
props-panel → overlay-tweaks). Every one died on the same wall: a generated
prototype that uses a "scene" composite is one line — `<ComputerScene />` — and
the content a designer wants to edit (the chat messages) is **baked inside the
shipped composite as module constants** (`SEED_TRANSCRIPT`). There is no
location in the frame's own source to edit, so click-to-edit, props, overlays,
and commit-to-code all hit the same dead end.

The root cause, named by the designer: **the composites are built wrong.** A
scene composite fuses three different things into one sealed box:

1. **Structure** — the sidebar/header/transcript/input layout.
2. **Content** — the actual messages/sessions, baked as internal constants.
3. **Behavior** — clicking a session switches it; typing streams a reply.

Only **behavior** genuinely needs sealing (it's interaction logic a designer
won't hand-edit). **Content** was sealed by accident — and that is exactly what
designers want to edit. The fix is at generation/authoring, not at the editing
layer: **lift content out of the sealed component into editable frame data**,
so editing a message becomes a normal frame-source edit.

This is NOT the failed overlay approach (superseded by this spec). It removes
the wall instead of tunneling under it.

## Precedent (why this is small, not a rewrite)

The pattern is already half-built in ComputerScene:

- `sessions` is ALREADY a data prop (`sessions = DEFAULT_SESSIONS`,
  `ComputerScene.tsx:207`). The kit author already proved content-as-prop works.
- The KIT-MANIFEST **auto-extracts the props type from source**
  (`server/kitManifest.ts`) — adding a `transcript` prop auto-surfaces it to the
  generator with zero manifest editing.
- The generator already accepts overrides on ComputerScene.

The gap is narrow: the **transcript** (`SEED_TRANSCRIPT`, `ComputerScene.tsx:134`)
is a baked module constant, NOT a prop; and the generator emits bare
`<ComputerScene />` so nothing lands in the frame. This spec closes that gap and
adds the bind bridge that makes click-to-edit resolve to the lifted data.

## The chain (data → render → bind → click → write)

```
GENERATION  (generator-policy change)
  agent emits the conversation AS DATA in the frame:
    const transcript = [
      { id: 1, role: "user", text: "Help me prep a marketing keynote…" },
      { id: 2, role: "assistant", text: "Here's a starting outline…",
        artefact: { tag: "DOC", title: "Q3 launch brief" } },
      { id: 3, role: "user", text: "Build the structure first." },
      …
    ];
    export default () => <ComputerScene transcript={transcript} />;
  → the editable content now lives IN THE FRAME, not baked in the kit.

RENDER + BIND  (kit change — the bridge)
  ComputerScene maps transcript → bubbles and STAMPS each rendered node with its
  data path — addressed by the message's STABLE id, not array index:
    <… data-arcade-bind="transcript[id=2].text">Here's a starting outline…</…>
    <… data-arcade-bind="transcript[id=2].artefact.title">Q3 launch brief</…>
  → the component, which OWNS the render, declares the pixel→data link.
    No fiber-walk, no guessing. id-addressing survives reorder/delete (index would not).

CLICK-TO-EDIT  (Studio — NEW commit path keyed by bind, not by source coords)
  click a bubble → picker reads the nearest data-arcade-bind (NOT a source/fiber
  walk) → posts a {kind:"bind", bindPath} selection → inline edit → routes to
  writeBindEdit, which finds the transcript entry with that id in index.tsx and
  replaces its text → reparse-guard → instant, no LLM, no wall.
```

The thesis proven: the wall was never "editing" — it was that the content
wasn't in the frame. Put it in the frame as data + have the renderer declare the
binding, and click-to-edit is a deterministic frame-array write.

## Decisions locked

- **Lift CONTENT only** (the transcript text + per-message structure + the
  artefact attachment). Behavior (`send()`, the ~700ms reply, session switching)
  stays sealed in the composite.
- **`transcript` becomes a prop**, defaulting to the existing `SEED_TRANSCRIPT`,
  so a bare `<ComputerScene />` renders identically — BUT see the streaming fix
  below: the lift is only regression-free after that change.
- **Streaming-signal fix (prerequisite):** today `showStreaming` is computed by
  the reference-identity check `messages === SEED_TRANSCRIPT`
  (`ComputerScene.tsx:253`). Once a frame passes `transcript={…}`, `messages` is
  the caller's array and that check is always false → `state="streaming"`
  silently breaks for every populated frame. FIX FIRST: track streaming by an
  explicit signal (e.g. `messages.length === initialTranscript.length` captured
  at mount, or a dedicated `streamedRef`), not array identity. This change lands
  before / with the prop lift.
- **`state` × `transcript` interaction (defined):** `state="empty"` wins → the
  scene renders no messages regardless of a passed `transcript` (empty state is a
  layout choice). For `state="transcript"` (default) or `"streaming"`, the passed
  `transcript` seeds the messages; `"streaming"` additionally shows the working
  agent turn after the seed.
- **Bind convention:** `data-arcade-bind="transcript[id=<id>].<field>"` —
  addressed by the message's STABLE `id`, NOT its array index. Index binds break
  under reorder/delete; id binds survive (the render re-derives the bind from
  each message's id every render — the bind is never stored). A kit-wide
  convention so future data-driven composites reuse it. Stamped on the message
  text node and the artefact title node. Runtime-appended messages (from typing
  in the live scene) get NO bind — they're ephemeral interaction state, correctly
  not frame-editable.
- **Picker gains a bind-first resolve path:** if the clicked node or an ancestor
  carries `data-arcade-bind`, post a `{kind:"bind", bindPath, frameSlug}`
  selection and skip the fiber/source walk; otherwise the existing fiber path is
  unchanged.
- **Selection model gains a discriminant (in scope — NOT a localized change):**
  the selection types today are flat `{file,line,column}` records consumed
  positionally in ~8 places (`PickerSelection`, `ElementSelection`,
  `EditedElement`, `addOrFocus`, the `text-changed` handler, `applyFieldEdit`,
  `buildSingleEdit`/`ElementEdit`, `writeBatch`). Adding a `bind` selection means
  threading a discriminated union (`{kind:"source",…} | {kind:"bind",…}`) through
  all of them. This is the bulk of the work and is explicitly in scope.
- **Commit path for a bound edit is NEW, not a reuse.** The in-frame
  contenteditable UX (double-click → edit text → `text-changed` message) IS
  reused. But the existing commit pipeline hard-gates on
  `isInFrame(sel.file,…)` + `locateJsx(line,column)` (JSX-only, source-coord
  keyed) — a composite-internal bubble fails `isInFrame` (its fiber resolves to
  `prototype-kit/composites/ComputerScene.tsx`, a local-aliased source, NOT the
  frame). A bound edit must BYPASS that gate and route by `bindPath` to
  `writeBindEdit`. The `text-changed` handler gets a bind branch.
- **Editing surface (v1) — user-facing promise is "retype any message":** inline
  TEXT edit of a bound leaf (message text, artefact title) → deterministic write
  to the frame's `transcript` array. Structure edits (add/remove/reorder, change
  role) + attachment add/remove are made POSSIBLE by the data shape but are NOT
  in v1's UI and NOT claimed to work via the text primitive — they're a follow-up
  (a dedicated structure UI), and until then route through the agent (precise
  string ops on the in-frame array — no composite wall). v1 advertises "retype a
  message," not "edit your conversation," to avoid the expectation-gap that sank
  prior attempts.
- **Generator default flips to the populated form:** the current policy pushes
  bare `<ComputerScene/>` (the seeded reference frame is bare;
  `templates/CLAUDE.md.tpl` tells the agent to copy it). That must be REVERSED:
  make `<ComputerScene transcript={[...]}/>` the documented default for a
  populated chat, update the seeded `00-computer-reference` frame to the data
  form, AND inline the `Message` shape (`{id, role, text, artefact?}`) into the
  manifest/policy — the manifest auto-extractor surfaces the prop NAME but not the
  `Message` type, so the agent would otherwise guess the shape. Without this the
  feature reaches ~0% of generated frames.
- **Per-element STYLING is out** (recolor one bubble). That's a visual override,
  not content data — the reverted overlay problem. Not in this experiment.
- **Scope:** ComputerScene + transcript only. sessions (already a prop) and CHATS
  stay as-is. Prove, then generalize.

## Architecture

```
prototype-kit/composites/ComputerScene.tsx
  ├─ FIRST: replace `messages === SEED_TRANSCRIPT` streaming check with a non-identity signal
  ├─ transcript?: Message[]  prop (default SEED_TRANSCRIPT) ── content lifted to caller
  └─ render: map transcript → ChatMessages, stamping data-arcade-bind (BY id) on each leaf

KIT-MANIFEST  ── auto-extracts the prop NAME (no manual edit); the Message SHAPE
                 must be inlined into the policy/manifest note (extractor omits it)

generator policy (templates/CLAUDE.md.tpl + the seeded 00-computer-reference frame)
  ── FLIP the default: populated `<ComputerScene transcript={transcript}/>` with the
     conversation as a frame `const transcript = [...]` becomes the documented form;
     update the bare reference frame + the copy-and-mutate guidance

studio/src/frame/picker.ts + the selection model
  ── bind-first resolve: read closest [data-arcade-bind]; if present, post a
     {kind:"bind", bindPath, frameSlug} selection. Requires a discriminated
     selection union threaded through the ~8 consumers (see decisions).

studio/src/frame inline text edit (contenteditable UX reused) + text-changed handler
  ── NEW bind branch in the commit path: a bound edit BYPASSES isInFrame+locateJsx
     and routes by bindPath to writeBindEdit (the existing path is JSX-coord-keyed
     and would skip a composite-internal node)

studio/server/codeWriter/bindEdit.ts  (new writer, reparse-guarded)
  ── writeBindEdit(source, bindPath, newText): NEW AST target (not JSX-coord) —
     find the frame's `const transcript` ArrayLiteral, the element whose `id`
     matches the bindPath's id, walk to its `<field>` string-literal, replace it.
     Reparse-guard; bail → {ok:false}. New request variant + dispatch branch in
     the /api/visual-edit batch (ElementEdit has no bindPath field today).
```

### New / changed units

1. **ComputerScene: streaming-fix + `transcript` prop + bind stamping**
   (`composites/ComputerScene.tsx`)
   - PREREQUISITE: replace the `showStreaming = state==="streaming" && messages
     === SEED_TRANSCRIPT` identity check (`:253`) with a non-identity signal so
     `state="streaming"` works for populated frames (e.g. a `streamedRef` set
     once, or compare against the captured initial length). Without this, passing
     `transcript` silently breaks streaming.
   - Add `transcript?: Message[]` to `ComputerSceneProps`; default param
     `transcript = SEED_TRANSCRIPT`; seed `useState(...)` from it.
     `state="empty"` → `[]` (empty wins over a passed transcript).
   - When rendering each SEEDED message (one whose `id` is in the authored
     transcript), stamp the text node with
     `data-arcade-bind={\`transcript[id=${m.id}].text\`}` and an artefact title
     with `transcript[id=${m.id}].artefact.title`. Bind by **id**, not index —
     survives reorder/delete. Runtime-appended messages (ids not in the authored
     set) get NO bind.

2. **Bind convention doc** (a short note in the kit + manifest) — the
   `data-arcade-bind="<prop>[id=<id>].<field>"` contract, so the picker and future
   composites share one rule.

3. **Selection-model discriminant + picker bind-first resolve**
   (`src/frame/picker.ts`, `editSessionContext.tsx`, `visualEditClient.ts`,
   `InspectorPanel.tsx`, `FrameCard.tsx`) — introduce a discriminated selection
   union `{kind:"source", file,line,column} | {kind:"bind", bindPath, frameSlug}`
   and thread it through the ~8 consumers. In `onClick`, before the fiber walk:
   `const bound = target.closest("[data-arcade-bind]")`; if found, post the bind
   selection. Unbound nodes take the existing source path unchanged.

4. **`writeBindEdit`** (`server/codeWriter/bindEdit.ts`, pure, TS-AST) — given the
   frame source, a `bindPath` (`transcript[id=2].text`), and a new string: locate
   the frame's `const transcript` ArrayLiteral, find the element whose `id`
   property equals the bindPath's id, walk to its `<field>` (`text` or
   `artefact.title`) string-literal, replace its value. Reparse-guard. Returns
   `{ok, source}` / `{ok:false, reason}`. This is a NEW AST target (the existing
   writers are JSX-coord keyed via `locateJsx`); it needs a new request variant +
   a dispatch branch in `applyEditsToSource`/`writeBatch` (today's `ElementEdit`
   has no `bindPath`).

5. **Generator default flip** (`templates/CLAUDE.md.tpl` + the seeded
   `00-computer-reference` frame + the ComputerScene manifest note) — make the
   POPULATED form the documented default: author the conversation as a frame
   `const transcript = [...]` of `{id, role, text, artefact?}` and pass
   `transcript={transcript}`. Update the bare reference frame to the data form and
   the copy-and-mutate guidance. INLINE the `Message` shape into the note (the
   manifest extractor surfaces the prop name but not the `Message` type). Bare
   `<ComputerScene/>` stays valid for a throwaway scaffold (degrades to agent edit).

## Data flow — edit a message (the ex-impossible case)

1. Generation writes `frames/<slug>/index.tsx` with
   `const transcript = [ … {id:3, role:"user", text:"Build the structure first."} … ]`
   and `<ComputerScene transcript={transcript} />`.
2. ComputerScene renders message id 3's bubble with
   `data-arcade-bind="transcript[id=3].text"`.
3. Designer clicks the bubble → picker reads the bind → posts
   `{kind:"bind", bindPath:"transcript[id=3].text"}`.
4. Inline edit → "Build the structure, then the demo." → `/api/visual-edit` with
   the bind edit → `writeBindEdit` finds the transcript element with `id:3` and
   sets its `text` → reparse-guard → write → Vite reload.
5. The message is changed, deterministically, in the designer's own frame source.
   No composite edit, no overlay, no LLM, no wall.

## Error handling

- **Reparse fail / id or field not found** (bindPath's id absent from the array,
  field not a string leaf, array shape unexpected) → `writeBindEdit` returns
  `{ok:false}`, file untouched; the editor falls back to a scoped agent ask
  (existing pattern).
- **Runtime-appended messages** (from typing in the live scene) carry no bind →
  not click-editable. Correct: ephemeral interaction state, not authored content.
- **Bare `<ComputerScene/>` (no transcript prop)** → default `SEED_TRANSCRIPT`
  renders; its bubbles ARE stamped (by id) but there is no frame `transcript`
  array → `writeBindEdit` finds no array → `{ok:false}` → agent fallback. The
  flipped generator default makes the populated form normal; this is the
  throwaway-scaffold case.
- **No regression:** with `transcript` defaulting to `SEED_TRANSCRIPT` AND the
  streaming-signal fix in place, every existing bare `<ComputerScene/>` renders
  identically including `state="streaming"`.

## Testing

- **Streaming-fix regression (prerequisite):** a populated
  `<ComputerScene transcript={X} state="streaming"/>` still shows the streaming
  agent turn (the old `=== SEED_TRANSCRIPT` check would silently fail this); bare
  `<ComputerScene state="streaming"/>` unchanged.
- **ComputerScene prop + render:** `<ComputerScene transcript={X}/>` renders X's
  messages (not the baked seed); bare `<ComputerScene/>` renders the seed
  unchanged; `state="empty"` → no messages even with a passed transcript. Each
  seeded bubble carries `data-arcade-bind="transcript[id=<id>].<field>"`;
  runtime-appended messages carry none.
- **`writeBindEdit` (the core unit, pure):** given a frame with a `const
  transcript` array, `writeBindEdit(src, "transcript[id=3].text", "X")` returns
  source with the element whose `id:3` having `text:"X"` and everything else
  byte-identical; `transcript[id=2].artefact.title` works; a missing id / missing
  field → `{ok:false}`; reordering the array first then editing by id still hits
  the right element (id, not position); a value that would break parse →
  reparse-guard `{ok:false}`; bare-default frame (no `const transcript`) →
  `{ok:false}`.
- **Selection discriminant + picker bind-first:** a click under
  `[data-arcade-bind]` posts a `{kind:"bind", bindPath}` selection; an unbound
  click posts the existing `{kind:"source", file,line,column}` (no regression);
  downstream consumers branch on `kind` correctly.
- **Bound commit path:** a `text-changed` on a bound selection routes to
  `writeBindEdit` (NOT the `isInFrame`/`locateJsx` path) and yields an applied
  block; a `text-changed` on a source selection still uses the JSX path.
- **Round-trip via /api/visual-edit:** a bind edit batch writes the frame array
  and yields an applied block.
- **Manual gate (HUMAN):** generate a Computer chat prototype → it emits
  `<ComputerScene transcript={[...]}/>` with the conversation as frame data →
  click a message → edit its text inline → it changes, persists, no LLM; the scene
  stays interactive (sessions clickable, typing still streams a reply). Editing
  the SAME message again works. This is the exact thing six approaches couldn't do.

## Risks / honest limitations

- **The bind is the load-bearing bridge.** If ComputerScene doesn't stamp a node,
  that node isn't click-editable — coverage is exactly what the composite binds.
  v1 binds message text + artefact title; everything else falls back to the agent.
  Honest and bounded; no silent-wrong (an unbound click takes the existing path).
- **id-based bind, frozen at pick time.** Binds address the message `id`, so they
  survive array reorder/delete (unlike index). The posted selection carries a
  frozen `bindPath` string; if the array's ids change between pick and commit
  (only possible via an agent structure-edit mid-session — there's no v1 reorder
  UI), `writeBindEdit` returns `{ok:false}` (id gone) → agent fallback. No
  silent-wrong. A bind-path staleness story (analogous to `shiftSelectionsBelow`)
  is a follow-up if a structure UI lands.
- **Generator compliance is load-bearing — and fights an entrenched default.** The
  current policy actively pushes bare `<ComputerScene/>` (the seeded reference is
  bare; the agent is told to copy it). The fix is NOT a single prompt line — it's
  flipping the documented default + the seeded reference frame + inlining the
  `Message` shape (the manifest extractor omits it). If the agent still emits
  bare, editing degrades to the agent path (no crash) — but the feature's reach
  equals the agent's compliance, so the policy flip is essential, not optional.
- **v1 ships "retype a message," not "edit your conversation."** Add/remove/
  reorder/role/attachment edits are possible from the data shape but NOT in v1's
  UI — they route through the agent. Stated plainly to avoid the expectation-gap
  that sank prior attempts.
- **This is ONE composite, ONE content type.** Generalizing to the other scene
  composites + more content types is future work, deliberately out of scope until
  this proof holds. v1 validates the pattern cheaply after six failures.
- **Verified by tests + reasoning** until the manual gate; given the history, the
  gate is mandatory before "done."

## Out of scope

- Per-element visual styling (recolor a bubble) — the reverted overlay problem.
- A dedicated structure/attachment editing UI (add/remove/reorder bubbles, change
  role, add/remove attachment in canvas) — the data shape makes it POSSIBLE; the
  UI is a follow-up. v1 = inline TEXT edit of a bound leaf only. A bind-path
  staleness story (sync binds across a structure edit) lands with that UI.
- Lifting sessions/CHATS or other composites — future, after the proof.
- The overlay-tweaks approach (superseded by this spec).
