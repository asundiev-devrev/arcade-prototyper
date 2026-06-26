# Customize (Component Detach) — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)
**Sub-project:** A of 2 (component model & detach). Sub-project B — direct on-canvas manipulation (resize/move handles, arbitrary width) — is deferred to its own spec.

## Problem

The canvas can only directly edit elements the user's frame authored in its own
`index.tsx`. When a designer clicks something that lives inside a prebuilt
component — e.g. a `<div>` deep inside `<ComputerScene>` → `<Agent>` — there is
no reliable way to change it. Phase A surfaced this wall three times: the edit
either bailed silently or produced a malformed AI prompt the agent couldn't act
on. Editing the shared component source is not an option — it would change every
prototype that uses it.

Designers expect Figma's model: if you can select it, you can edit it. The
missing capability is Figma's **detach** — make a prebuilt component fully
editable *in this screen only*, leaving the shared original intact everywhere
else. In the UI this is called **Customize** (designer-friendly; "detach" leaks
mechanism).

## Decisions locked during brainstorming

- **Vocabulary:** the action is **Customize** (never "detach"/"eject"). Voice is
  designer-first, no mechanism leak.
- **Component model = Figma's:** a selected prebuilt component (1) is highlighted
  differently from a plain element, (2) exposes a limited set of editable props,
  (3) can be Customized to edit anything inside.
- **Selection treatment (chosen mockup B):** solid selection ring + a floating
  chip **on the object** reading `💠 Component · Customize` (Customize is a click
  target in the chip). The exposed props remain editable in the inspector panel;
  internal styles show as locked.
- **Customize scope:** the **nearest named component present in the frame's own
  `index.tsx`** — i.e. the component instance actually written in the frame
  source that contains the clicked element. This is a hard constraint of the
  architecture, not a preference: only a component that literally appears in the
  frame source can be spliced/replaced there. Consequences:
    - Generated frames that placed `<Button>`/`<Card>` directly in `index.tsx` →
      Customize expands just that component (surgical).
    - A frame whose source is a single top-level composite (e.g. the computer
      reference frame's lone `<ComputerScene />`) → clicking the deeply-nested
      `<Agent>` Customizes `<ComputerScene>`, because that is the only component
      in the frame source. The clicked element (`<Agent>`'s bubble) then becomes
      an ordinary, directly-editable element *inside* the expanded markup —
      "edit in context." There is no surgical way to lift only `<Agent>` while
      keeping its surroundings intact, because `<Agent>` is authored inside the
      composite's own code, not the frame's.
- **What Customize emits:** a **hybrid rendered snapshot** — serialize the live
  rendered subtree of the targeted top-level-in-source component into static JSX
  with real Tailwind `className`s, leaving still-simple mapped kit primitives
  (Button, Icon) as component references rather than exploding them. Reuses the
  existing fiber-walk serializer. The snapshot includes everything the component
  rendered, so the expanded result looks pixel-identical and nothing appears
  detached.
- **Safety:** confirm dialog before; one-step **Undo** after. Designer-friendly
  copy (exact strings below).
- **Out of scope (sub-project B):** on-canvas resize/move handles, arbitrary
  width (`w-[300px]`), panel-mirrored precision drag.

## Copy (exact, approved)

- **Chip:** `💠 Component · Customize`
- **Panel locked-note:** `💠 Parts of this are prebuilt. Customize to change anything inside.`
- **Confirm dialog title:** `Customize this component?`
- **Confirm dialog body:** `It becomes fully editable in this screen only. The original stays the same everywhere else.`
- **Confirm buttons:** `Cancel` / `Customize`
- **After (toast):** `✓ Now fully editable.` + `Undo`

## What exists today (reused)

- **Picker** (`studio/src/frame/picker.ts`) — resolves a clicked element to its
  source `file:line:column`, `componentName` (nearest named owner), `tagName`.
- **`isInFrame(file, frameSlug)`** (`studio/src/lib/visualEditClient.ts`, Phase A)
  — true when the picked element is authored in the frame's own source; false
  when it resolves to shared kit source. This is the **"is this a component?"**
  signal for the chip.
- **Kit-prop introspection** (`studio/server/codeWriter/kitProps.ts`, Task 9) —
  `kitPropsFor(name)` returns a component's declared string-union props; the
  inspector already renders these as editable dropdowns and grays internal
  styles. Customize reuses this for the "exposed props" half of the model.
- **Fiber-walk serializer** (`studio/src/export/fiberWalk.ts`,
  `fiberTypes.ts`, `slj.ts`) — walks the live rendered React tree in the frame
  iframe, is component-boundary aware (prunes mapped primitives/icons to
  component nodes carrying scalar props; recurses host elements and composites),
  and captures tag, geometry, computed style, text, and scalar props into
  **SLJ** (Studio Layout JSON). Runs client-side in the iframe.
- **Frame write path** — frames are written by the Claude subprocess via
  `/api/chat`; the deterministic code-writer (`server/codeWriter/`) writes frame
  source directly. Frames are static, className-styled prototypes (Studio's own
  inspector states this), so a rendered snapshot ≈ the source for these files.

**Confirmed gaps the fiber walk does NOT cover today:**
- It captures *computed* style, **not the `className` attribute**. JSX emission
  needs the real classes.
- There is **no SLJ→JSX printer** anywhere in the codebase. Net-new.

## Architecture

Customize is a four-stage flow. Two stages are net-new code; two reuse existing
machinery.

```
Select component → [chip: 💠 Component · Customize] → click Customize → confirm
        │                                                                  │
        │ (detection: !isInFrame; resolve the in-source component)         ▼
        │                                              1. SERIALIZE (client, in iframe)
        │                                                 fiber-walk the TARGET component's
        │                                                 (the in-source instance) rendered
        │                                                 subtree → SLJ (+ NEW: capture className)
        │                                                                  │
        │                                                                  ▼
        │                                              2. PRINT (pure)  SLJ → JSX string
        │                                                 (NEW: sljToJsx printer)
        │                                                                  │
        │                                                                  ▼
        │                                              3. SPLICE (server) replace the
        │                                                 in-source component element (e.g.
        │                                                 <ComputerScene .../>) in
        │                                                 frames/<slug>/index.tsx with the
        │                                                 printed JSX (reuse locateJsx + splice
        │                                                 + reparse guard from Phase A)
        │                                                                  │
        │                                                                  ▼
        │                                              4. Vite hot-reloads; toast + Undo
```

### New pieces

1. **`className` capture in the fiber walk.** Extend `FiberReader` with
   `hostClassName(f): string | null` (reads the host DOM node's `class`
   attribute) and add an optional `className` field to the SLJ `ElementNode`.
   This is additive — the Figma export path ignores the new field.

2. **`sljToJsx` printer** (`studio/src/export/sljToJsx.ts`) — pure function:
   SLJ node tree → JSX source string. Host element nodes →
   `<tag className="…">…children…</tag>`; text nodes → their characters;
   component nodes (pruned primitives) → `<Component prop="…">…</Component>`
   using the captured scalar props. Emits idiomatic Tailwind classes (already
   present in `className`), never inline styles. Produces a self-contained JSX
   fragment that renders identically to the snapshot.

3. **`POST /api/customize/:slug`** (`studio/server/middleware/customize.ts`) —
   body `{ frameSlug, targetComponentName, jsx }`: find the JSX element in
   `frames/<slug>/index.tsx` whose tag is `targetComponentName` (the in-source
   component instance, resolved client-side — see "resolving the target" below)
   and replace it with the printed `jsx`. Reuses `locateJsx`, `splice`, the
   re-parse guard, and the all-or-nothing/path-safety model from Phase A's
   code-writer. If the frame source contains more than one instance of that
   component tag, the request also carries the instance's source `line:column`
   (from the picker) to disambiguate; the endpoint matches by position. Imports
   needed by the printed JSX (the kept kit primitives) are reconciled — see Error
   Handling. Returns `{ ok, reason? }`.

4. **Selection chip + Customize UI** (frame overlay + `InspectorPanel`) — when a
   selected element is *not* in-frame (`!isInFrame`), render the `💠 Component`
   chip on the selection box with a `Customize` action; the inspector shows the
   exposed kit props (existing Task-9 UI) plus the locked-note. Customize click →
   confirm dialog → run the flow → toast with Undo.

5. **Undo** — before splicing, snapshot the pre-Customize `index.tsx` (single
   in-memory/disk snapshot keyed by frame). `Undo` restores it. This is the
   seam Phase A flagged (`frameChangeContract.ts` snapshot infra) made concrete
   for one operation; no general undo stack.

### Data flow for detection + resolving the target

The picker returns the clicked element's `componentName` (its nearest named
fiber owner — e.g. `Agent`) and source `file`. An element gets the `💠 Component`
treatment when `!isInFrame(file, frameSlug)` — it resolves to shared component
source, not the frame's own `index.tsx`. In-frame elements keep the normal
Phase-A inspector (no chip).

**Resolving which component to Customize (the in-source target).** The clicked
element's nearest owner (`Agent`) is usually NOT in the frame source — it's
authored inside a composite. Customize must target the **outermost component on
the fiber path between the frame root and the clicked element whose source file
IS the frame's `index.tsx`** — i.e. the component instance the designer actually
wrote (or the generator wrote) into the frame. Concretely, walking the fiber
owner chain from the clicked element up toward the root, the target is the last
named component whose JSX call-site file is `frames/<slug>/index.tsx`.

- Generated frame with `<Card><Button/></Card>` in `index.tsx`, click the
  Button's label → target = `Button` if `<Button>` is in `index.tsx`, else the
  enclosing `Card` — whichever is the in-source instance nearest the click.
- Computer frame with only `<ComputerScene/>` in `index.tsx`, click deep inside →
  the only in-source component on the path is `ComputerScene` → target =
  `ComputerScene`.

This resolution runs client-side (the fiber owners carry `_debugStack`
call-site files, already parsed by the picker for Phase A). The resolved
`targetComponentName` + its `line:column` in `index.tsx` go to the customize
endpoint. The fiber-walk serialization (stage 1) starts from the **target
component's fiber**, not the clicked element's.

## Error handling

- **Snapshot not faithful / printer can't represent a node:** if the fiber walk
  hits a node it can't serialize to valid JSX (e.g. a prop value that isn't a
  scalar and isn't `children`), the printer omits it conservatively and the
  serialize step records a warning. If the resulting JSX fails the server-side
  re-parse guard, the whole Customize **aborts**, the file is untouched, and the
  user sees a calm fallback: "Couldn't customize this automatically — describe
  the change in chat instead." (Routes to the existing chat path.) Never write
  un-parseable TSX.
- **Imports for kept kit primitives:** the printed JSX may reference kit
  components (`Button`, `Icon`) that the frame already imports (the component it
  came from did). The customize endpoint ensures each referenced kit name is
  present in the frame's import from `@xorkavi/arcade-gen`; missing names are
  added. This reuses the import-reconciliation pattern the generator already
  relies on. If a referenced name can't be resolved in the kit, abort (above).
- **Dynamic content frozen:** a rendered snapshot freezes lists/animations into
  their current static form. This is acceptable for these static prototypes and
  is stated to the user implicitly by the result (the markup is now literal).
  Documented as a known limitation, not an error.
- **Re-Customize:** Customizing an already-customized region is a no-op-ish
  normal edit (the region is now plain JSX, in-frame) — the chip won't appear
  because `isInFrame` is now true.

## Testing

Follows Studio's "every fix gets a test" discipline.

- **`sljToJsx` printer** (`__tests__/.../sljToJsx.test.ts`) — table of SLJ node
  → expected JSX string: host element with className + children; text leaf;
  pruned component node with scalar props; nested mix; escaping of text/attribute
  values; a node the printer must conservatively drop.
- **`className` capture** — a fiber-reader fake returns a class attribute; assert
  it lands on the `ElementNode` and survives into the printed JSX.
- **Customize endpoint** (`__tests__/server/customize.test.ts`) — valid request
  splices the printed JSX in place of the component element (mock the code-writer
  primitives); re-parse-failure aborts with the file untouched; import
  reconciliation adds a missing kit name; path-safety honored.
- **Detection** — `isInFrame` drives the chip: a component-internal selection →
  chip shown; an in-frame selection → no chip. (Extends the Phase-A
  `visualEditClient` tests.)
- **Target resolution** — given a fiber owner chain (clicked element → … →
  root) with call-site files, the resolver returns the outermost owner whose
  file is the frame's `index.tsx`: a deep click in an all-composite frame →
  `ComputerScene`; a click on an in-source `<Button>` → `Button`.
- **Undo** — after a Customize, Undo restores the exact pre-Customize source.
- **Full-fidelity manual gate (human, app restart):** Customize a component
  inside the computer frame (click the Agent bubble → resolves to
  `<ComputerScene>`) → the frame renders pixel-identically, the clicked element
  is now a directly-editable element inside the expanded markup,
  `prototype-kit/` is untouched, Undo restores `<ComputerScene/>`. Also test a
  generated frame where a `<Button>`/`<Card>` is in `index.tsx` directly →
  Customize expands just that component. (Unit tests can't prove visual fidelity or
  hot-reload; this gate is required before shipping to testers.)

## Risks / honest limitations

- **Snapshot fidelity is the core risk.** The printed JSX must render identically
  to the live component. Computed-style → className round-tripping is exact only
  because we capture the real `className`; anything styled by the component via
  non-class means (inline style props, CSS-in-JS) won't carry. For these
  className-styled kit prototypes that's expected to be rare; the manual fidelity
  gate is the check.
- **Static freeze** (above) — dynamic behavior is lost on Customize, by design.
- **The Phase-A instant-edit foundation is still unverified on a frame-authored
  element** (every prior smoke test hit the all-kit computer frame). The
  implementation plan must include a real foundation check on a generated frame
  before relying on the in-frame edit path that Customize produces.

## Out of scope for this spec

- On-canvas resize/move handles, arbitrary `w-[…]` sizing, panel-mirrored drag
  (sub-project B).
- A general multi-step undo stack (only single-step Customize undo here).
- Customizing into a separate frame (rejected: breaks edit-in-place).
