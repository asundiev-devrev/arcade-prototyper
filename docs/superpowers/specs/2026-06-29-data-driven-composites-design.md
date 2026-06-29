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
  data path:
    <… data-arcade-bind="transcript.2.text">Here's a starting outline…</…>
    <… data-arcade-bind="transcript.2.artefact.title">Q3 launch brief</…>
  → the component, which OWNS the render, declares the pixel→data link.
    No fiber-walk, no guessing.

CLICK-TO-EDIT  (Studio — reuses the deterministic write path)
  click a bubble → picker reads the nearest data-arcade-bind (NOT a source/fiber
  walk) → resolves to the frame's transcript[2].text → inline edit → deterministic
  write to the transcript array literal in index.tsx → instant, no LLM, no wall.
```

The thesis proven: the wall was never "editing" — it was that the content
wasn't in the frame. Put it in the frame as data + have the renderer declare the
binding, and click-to-edit is a deterministic frame-array write.

## Decisions locked

- **Lift CONTENT only** (transcript: text + structure + attachments). Behavior
  (`send()`, the ~700ms reply, session switching) stays sealed in the composite.
- **`transcript` becomes a prop**, defaulting to the existing `SEED_TRANSCRIPT`,
  so a bare `<ComputerScene />` is byte-identical to today (no regression).
- **Bind convention:** `data-arcade-bind="transcript.<index>.<field>"` — dotted
  path from the prop root to the edited leaf. A kit-wide convention so future
  data-driven composites reuse it. Stamped on the message text node and the
  artefact title node.
- **Picker gains a bind-first resolve path:** if the clicked node or an ancestor
  carries `data-arcade-bind`, resolve to that data path and skip the
  fiber/source walk; otherwise the existing fiber path is unchanged.
- **Editing surface (v1):** inline TEXT edit of a bound leaf (message text,
  artefact title) → deterministic write to the frame's `transcript` array.
  Structure edits (add/remove/reorder a message, change role) and attachment
  add/remove are enabled by the data shape and writable by the same array-edit
  primitive, but the v1 UI ships TEXT inline-edit first; structure/attachment
  edits land via the data being present + the agent (precise string ops on the
  in-frame array — no composite wall) until a dedicated UI follows.
- **Per-element STYLING is out** (recolor one bubble). That's a visual override,
  not content data — the reverted overlay problem. Not in this experiment.
- **Scope:** ComputerScene + transcript only. sessions (already a prop) and CHATS
  stay as-is. Prove, then generalize.

## Architecture

```
prototype-kit/composites/ComputerScene.tsx
  ├─ transcript?: Message[]  prop (default SEED_TRANSCRIPT) ── content lifted to caller
  └─ render: map transcript → ChatMessages, stamping data-arcade-bind on each leaf

KIT-MANIFEST  ── auto-extracts the new prop (no manual edit) → generator sees `transcript`

generator policy (templates/CLAUDE.md.tpl + the ComputerScene manifest note)
  ── when using ComputerScene for a populated chat, emit the conversation as a
     frame `const transcript = [...]` and pass it: <ComputerScene transcript={transcript} />

studio/src/frame/picker.ts
  ── bind-first resolve: read closest [data-arcade-bind]; if present, post a
     BIND selection {bindPath, frameSlug} instead of a source selection

studio/src/frame/<inline text edit>  (existing in-frame text edit)
  ── on commit, route a bound edit to the new write path

studio/server/codeWriter/  (extend, reparse-guarded)
  ── writeBindEdit(source, bindPath, newText): set the value at the dotted path
     inside the frame's exported `transcript` array literal (TS-AST), preserving
     everything else. Reparse-guard; bail → no write.

studio/server/middleware/visual-edit (existing)  ── carries the bind edit
```

### New / changed units

1. **ComputerScene: `transcript` prop + bind stamping** (`composites/ComputerScene.tsx`)
   - Add `transcript?: Message[]` to `ComputerSceneProps`; default param
     `transcript = SEED_TRANSCRIPT`; seed `useState(transcript)` instead of the
     constant. `state="empty"` still yields `[]`.
   - When rendering each message, stamp the text node with
     `data-arcade-bind={\`transcript.${index}.text\`}` and an artefact title with
     `transcript.${index}.artefact.title`. (Index into the CURRENT transcript
     array as authored — the bind addresses the SOURCE array position, stable
     for the seeded messages; runtime-appended messages from `send()` get NO bind,
     so they're correctly not frame-editable — they're ephemeral interaction
     state, not authored content.)

2. **Bind convention doc** (a short note in the kit + manifest) — the
   `data-arcade-bind="<prop>.<index>.<field>"` contract, so the picker and future
   composites share one rule.

3. **Picker bind-first resolve** (`src/frame/picker.ts`) — in `onClick`, before
   the fiber walk: `const bound = target.closest("[data-arcade-bind]")`; if found,
   post `{ kind:"bind", bindPath: bound.getAttribute("data-arcade-bind"),
   frameSlug }`. The existing fiber/source path is the fallback for unbound nodes.
   A bound selection drives the existing inline-text-edit affordance.

4. **`writeBindEdit`** (`server/codeWriter/bindEdit.ts`, pure, TS-AST) — given the
   frame source, a dotted `bindPath` (`transcript.2.text`), and a new string,
   locate the exported/`const` `transcript` array literal, walk to element
   `[2]`'s `text` property, replace its string-literal value. Reparse-guard the
   result. Returns `{ok, source}` / `{ok:false, reason}`. Wired into the existing
   `/api/visual-edit` batch alongside the class/prop/text writers.

5. **Generator policy** (`templates/CLAUDE.md.tpl` + the ComputerScene manifest
   counterexample block) — instruct: for a populated Computer chat, author the
   conversation as a frame `const transcript = [...]` of `{id, role, text,
   artefact?}` and pass `transcript={transcript}`; do NOT rely on the baked
   default when the designer will want to edit messages. Bare `<ComputerScene/>`
   remains valid for a throwaway scaffold.

## Data flow — edit a message (the ex-impossible case)

1. Generation writes `frames/<slug>/index.tsx` with
   `const transcript = [ … {id:3, role:"user", text:"Build the structure first."} … ]`
   and `<ComputerScene transcript={transcript} />`.
2. ComputerScene renders message 3's bubble with
   `data-arcade-bind="transcript.2.text"` (0-based index 2).
3. Designer clicks the bubble → picker reads the bind → posts
   `{kind:"bind", bindPath:"transcript.2.text"}`.
4. Inline edit → "Build the structure, then the demo." → `/api/visual-edit` with
   the bind edit → `writeBindEdit` sets `transcript[2].text` in the frame's array
   literal → reparse-guard → write → Vite reload.
5. The message is changed, deterministically, in the designer's own frame source.
   No composite edit, no overlay, no LLM, no wall.

## Error handling

- **Reparse fail / path not found** (bindPath doesn't resolve to a string leaf,
  array shape unexpected) → `writeBindEdit` returns `{ok:false}`, file untouched;
  the editor falls back to a scoped agent ask (existing pattern).
- **Runtime-appended messages** (from typing in the live scene) carry no bind →
  not click-editable. Correct: they're ephemeral interaction state, not authored
  content. The seeded `transcript` entries are the editable ones.
- **Bare `<ComputerScene/>` (no transcript prop)** → default `SEED_TRANSCRIPT`
  renders; its bubbles are stamped `transcript.<i>.text` but there is no frame
  `transcript` array to write to → `writeBindEdit` finds no array → `{ok:false}`
  → agent fallback. (The generator policy makes the populated form the default
  for editable prototypes, so this is the throwaway-scaffold case.)
- **No regression:** with `transcript` defaulting to `SEED_TRANSCRIPT`, every
  existing bare `<ComputerScene/>` renders identically.

## Testing

- **ComputerScene prop + render:** `<ComputerScene transcript={X}/>` renders X's
  messages (not the baked seed); bare `<ComputerScene/>` renders the seed
  unchanged; `state="empty"` → no messages. Each seeded bubble carries the
  correct `data-arcade-bind`; runtime-appended messages carry none.
- **`writeBindEdit` (the core unit, pure):** given a frame with a `transcript`
  const array, `writeBindEdit(src, "transcript.2.text", "X")` returns source with
  element 2's `text` = "X" and everything else byte-identical; `…artefact.title`
  path works; a non-existent index/field → `{ok:false}`; a value that would break
  parse → reparse-guard `{ok:false}`; bare-default frame (no array) → `{ok:false}`.
- **Picker bind-first:** a click on a node under `[data-arcade-bind]` posts a
  `bind` selection with the right path; a click on an unbound node still posts the
  existing fiber/source selection (no regression to the fiber path).
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
- **Index-based bind addresses the AUTHORED array position.** Reordering the
  array in source (via a future structure-edit UI) must keep binds in sync — fine
  because the render re-derives binds from the live array each render; the bind is
  computed at render time, never stored. Runtime-appended messages are
  deliberately unbound.
- **This is ONE composite, ONE content type.** Generalizing the data-split to the
  other scene composites + more content types is future work, deliberately out of
  scope until this proof holds. The point of v1 is to validate the pattern cheaply
  after six failures — not to re-author the kit.
- **Generator compliance:** the agent must actually emit the data form. Mitigated
  by the manifest auto-surfacing the prop + an explicit policy line; if the agent
  emits bare `<ComputerScene/>`, editing degrades to the agent path (no crash).
- **Verified by tests + reasoning** until the manual gate; given the history, the
  gate is mandatory before "done."

## Out of scope

- Per-element visual styling (recolor a bubble) — the reverted overlay problem.
- A dedicated structure/attachment editing UI (add/remove/reorder bubbles in
  canvas) — the data shape supports it; the UI is a follow-up. v1 = inline text.
- Lifting sessions/CHATS or other composites — future, after the proof.
- The overlay-tweaks approach (superseded by this spec).
