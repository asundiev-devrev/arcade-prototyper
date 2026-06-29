# Interactive-Composite Props Panel — Design

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)

## Problem

The auto-expand feature flattens slot-layout templates (SettingsPage) into
editable host markup. But the highest-value prototypes are **self-contained
interactive composites** — `ComputerScene` is a complete working chat app
(clickable sessions, streaming, live input) rendered from one line:
`<ComputerScene />`. Flattening such a composite to markup would destroy its
interactivity, so auto-expand deliberately doesn't touch it. The result the
designer hit: selecting anything in a ComputerScene frame shows
**"No editable properties — use Ask AI to change this."** The edit panel is
effectively always dead for the interactive prototypes people most want to
start from.

The reframe (from the designer): if "editable" requires flattening, then every
interactive prototype has a permanently useless panel. **But editable ≠
flattened.** An interactive composite's editable surface is its **props**. The
panel just isn't surfacing them — for two concrete reasons found in the code:

1. **`kitPropsFor` reads only arcade-gen's `.d.mts`.** prototype-kit composites
   (`ComputerScene`, the page templates) have no shipped declarations, so they
   return zero props.
2. **It keeps only string-union props** (dropdowns). Text, boolean, and number
   props are dropped even when present.

Yet `ComputerScene` already exposes a real, deterministic prop surface:
`headerTitle`, `userName`, `userSubtitle`, `chatInputPlaceholder` (text),
`state` (`"empty"|"streaming"|"transcript"`, a union), `withCanvasPanel`
(boolean). All write deterministically via the existing props-first `prop:`
path **and keep the prototype fully interactive**.

## Goal

Make the panel surface the **scalar props** of any resolved in-frame composite
(prototype-kit OR arcade-gen), rendered as the right widget per type and
prefilled with the component's default, so interactive composites get a live
editable panel **without flattening** — no lost behavior. Non-scalar/structural
props (ReactNode, arrays, objects) stay "Ask AI."

## The model (props are the editable surface)

```
Select element in frame
   │  panel resolves nearest in-frame component (unchanged: resolveInFrameComponent)
   ▼
panel fetches /api/kit-props/<Name>            ── richer response
   │
   ├─ Name ∈ arcade-gen  → existing .d.mts string-union reader (UNCHANGED)
   │
   └─ Name ∉ arcade-gen  → NEW prototype-kit source reader:
        locate composites/<Name>.tsx then templates/<Name>.tsx
        TS-AST parse `<Name>Props` → for each SCALAR prop:
           string  → {kind:"text"}
           boolean → {kind:"toggle"}
           number  → {kind:"number"}
           "a"|"b" (all string literals) → {kind:"select", values:[…]}
           ReactNode / JSX / Foo[] / {…} / fn / mixed union → SKIPPED
        read literal destructuring defaults → {default}
   ▼
panel renders one widget per prop by `kind`, prefilled with current attr value
   else the parsed default (computed default → empty + placeholder)
   │  edit → string/select: change("prop:<name>")  | boolean/number: change("propExpr:<name>")
   ▼
/api/visual-edit  prop: → attr="value"   |  propExpr: → attr={value}   (reparse-guarded)
   → write on the in-frame instance → Vite reload (interactivity preserved)
```

## Decisions locked during brainstorming

- **Approach A — parse composite `.tsx` source directly** (not generate `.d.ts`,
  not a hand-curated allow-list). Reuses the existing TS-AST + `/api/kit-props`
  endpoint + deterministic `prop:` write. No build step. Works for any resolved
  composite, not just curated ones.
- **Prop types surfaced:** text (string) + toggle (boolean) + number + select
  (string-union). The four scalar kinds.
- **Scalar-only honesty rule:** a prop is an editable field ONLY if its type is
  a scalar (string / boolean / number / all-string-literal union). Structural
  props (ReactNode, JSX, arrays, objects, functions, unions mixing non-literals)
  are SKIPPED → they remain "Ask AI." Never offer a field that would clobber a
  structural prop with a string.
- **Defaults: prefill from the component.** Read literal destructuring defaults
  (`userName = "Ava Wright"`) and show them, so the panel mirrors the screen.
  A computed/absent default (e.g. `headerTitle` derived from the active session)
  can't be read → field shows empty with the prop name as placeholder (no faked
  value).
- **Current frame value wins.** If the frame already set the attr, show that;
  fall back to the parsed default only when the attr is absent. The field always
  reflects what's actually rendering.
- **Scope:** applied uniformly to ANY resolved in-frame component the arcade-gen
  reader returns nothing for. No special-casing ComputerScene.

## What exists today (reused)

- **`resolveInFrameComponent`** (`src/frame/resolveInFrameComponent.ts`) — panel
  already resolves the nearest in-frame component name. UNCHANGED.
- **`/api/kit-props/:component`** (`server/middleware/kitProps.ts`) +
  **`kitPropsFor`** (`server/codeWriter/kitProps.ts`) — the endpoint + arcade-gen
  `.d.mts` reader. The arcade-gen path is UNCHANGED; the new reader is an added
  branch.
- **Props-first write path** (`server/codeWriter/index.ts`,
  `patchSource.readAttr`/`splice`) — the `prop:<name>` deterministic attribute
  write via `/api/visual-edit`. Reused; extended with a `propExpr:` variant for
  expression-valued (boolean/number) props.
- **Panel prop rendering** (`InspectorPanel.tsx`) — today renders each prop as a
  dropdown over `values`. Extended to switch widget by `kind`.

## New / changed units

1. **`server/codeWriter/compositeProps.ts` (new)** — the prototype-kit source
   reader.
   - `parseCompositeProps(source: string, componentName: string): KitProp2[]`
     (pure): TS-AST parse `<Name>Props` (both `type X = {…}` and `interface X {…}`
     forms). For each property signature, classify the type node into a scalar
     `kind` or skip. Read the component function's parameter destructuring for
     literal defaults. Returns the richer prop descriptors. Pure + unit-tested.
   - `compositePropsFor(componentName): KitProp2[]` — resolve
     `prototype-kit/composites/<Name>.tsx` then `templates/<Name>.tsx` (name
     validated `^[A-Z][A-Za-z0-9]*$`; closed-world, no traversal), read the file,
     call `parseCompositeProps`, cache. Returns `[]` on any miss/parse failure.

2. **Richer prop descriptor** — `KitProp2 = { name: string; kind: "text" |
   "toggle" | "number" | "select"; values?: string[]; default?: string }`.
   The existing arcade-gen `KitProp` (`{name, values}`) is adapted to this shape:
   a string-union from arcade-gen becomes `{kind:"select", values}`. The endpoint
   returns `KitProp2[]` uniformly so the panel has one shape.

3. **`kitPropsFor` resolver chain** (`server/codeWriter/kitProps.ts`) — try the
   arcade-gen `.d.mts` reader first (mapped to `kind:"select"`); if it returns
   nothing for the name, fall back to `compositePropsFor`. One unified result.

4. **`propExpr:` write variant** (`server/codeWriter/index.ts`) — alongside the
   existing `prop:<name>` (string form: writes `name="value"`), add
   `propExpr:<name>` (expression form: writes `name={value}` on insert; on
   replace, replaces the attribute's value INCLUDING its `{…}`/quotes with
   `{value}`). Reparse-guarded by the existing `reparses(out)` check — a bad
   expression aborts the whole batch, file untouched. The panel chooses the
   prefix by `kind`: text/select → `prop:`, toggle/number → `propExpr:`.
   - NOTE: the existing replace branch splices into the value span of a string
     attr. The `propExpr` replace must replace the FULL attribute initializer
     (string literal `"x"` OR JSX expression `{x}`) with `{value}`. `readAttr`
     must expose the full-initializer span for this; if it currently only spans
     inside the quotes, extend it (or add a sibling reader) — flagged as the one
     real integration point.

5. **Panel widget-by-kind** (`InspectorPanel.tsx`) — render per `kind`:
   text→`Input`, toggle→`Switch`, number→`Input type=number`, select→existing
   dropdown. Prefill value = current instance attr value if present, else
   `default`, else empty (placeholder = prop name). On change: text/select →
   `change("prop:<name>", value)`; toggle/number → `change("propExpr:<name>",
   value)` (value = `"true"`/`"false"` / the number text). Header still names the
   component ("Editing `<ComputerScene>`"). Empty result → existing "No editable
   properties — use Ask AI to change this."

## Data flow — edit ComputerScene's user name

1. Select the sidebar footer → panel resolves in-frame component `ComputerScene`.
2. `GET /api/kit-props/ComputerScene` → arcade-gen reader returns `[]` →
   `compositePropsFor` reads `composites/ComputerScene.tsx` → returns e.g.
   `[{name:"headerTitle",kind:"text"}, {name:"userName",kind:"text",
   default:"Ava Wright"}, {name:"userSubtitle",kind:"text",default:"DevRev"},
   {name:"chatInputPlaceholder",kind:"text",default:"Ask me anything"},
   {name:"state",kind:"select",values:["empty","streaming","transcript"],
   default:"transcript"}, {name:"withCanvasPanel",kind:"toggle"}]` (sessions,
   onOpenSettings, userAvatarSrc-if-not-scalar… skipped).
3. Panel renders text fields (userName prefilled "Ava Wright"), a state dropdown
   (prefilled "transcript"), a canvas-panel toggle.
4. Edit userName → "Ada Lovelace" → `change("prop:userName", "Ada Lovelace")` →
   `/api/visual-edit` writes `userName="Ada Lovelace"` on the `<ComputerScene>`
   instance → reload. Scene still fully interactive.
5. Toggle withCanvasPanel on → `change("propExpr:withCanvasPanel", "true")` →
   writes `withCanvasPanel={true}`.

## Error handling (all degrade to today's behavior — never worse than Ask-AI)

- Source file not found / unreadable / no `<Name>Props` / unparseable → `[]` →
  "No editable properties." No crash.
- A single prop's type node is unclassifiable → skip that prop, keep the rest
  (per-prop, not all-or-nothing).
- `propExpr` value that breaks parse → existing reparse-guard aborts the batch,
  file untouched.
- Closed-world read: only `prototype-kit/{composites,templates}/<Name>.tsx`,
  `Name` matched `^[A-Z][A-Za-z0-9]*$`. No path traversal, no arbitrary reads.
- arcade-gen and prototype-kit can't collide: the composite reader runs ONLY when
  the arcade-gen reader returns nothing for that name.

## Testing

- **`parseCompositeProps` unit (core):** a `ComputerSceneProps`-shaped fixture →
  asserts `state`→select with the 3 values + default, `headerTitle`→text (no
  default — computed), `userName`→text default "Ava Wright",
  `withCanvasPanel`→toggle, and that `sessions` (array), `onOpenSettings`
  (function), and any `ReactNode` prop are SKIPPED. Plus: `interface XProps {…}`
  form; optional `?:`; a computed-default prop → no `default`; an intersection
  type → parses the literal members, skips the rest; a `string | ReactNode`
  union → skipped.
- **`kitPropsFor` chain:** `ComputerScene` → composite reader props;
  `Button` (arcade-gen) → unchanged string-union (now shaped as `kind:"select"`);
  an unknown name → `[]`.
- **Endpoint:** `/api/kit-props/ComputerScene` returns the scalar descriptors
  with kinds + defaults.
- **`propExpr` write:** inserting `propExpr:withCanvasPanel=true` on a
  `<ComputerScene />` yields `<ComputerScene withCanvasPanel={true} />` and
  parses; replacing an existing `state="x"` via `prop:state` still works;
  a `propExpr` replace of an existing `count={2}` → `count={5}`. Reparse-guard
  aborts a malformed expression.
- **Panel render:** mixed-kind props → text/toggle/number/select widgets, each
  prefilled correctly (attr value > default > empty); empty → "No editable
  properties."
- **Manual gate (HUMAN):** open the ComputerScene frame → panel shows header
  title / user name / subtitle / placeholder / state / canvas-panel, prefilled
  with the visible values; edit user name → applies + persists; toggle canvas
  panel → applies; the scene STAYS interactive (sessions clickable, streaming
  works). No "No editable properties" dead-end for this frame.

## Risks / honest limitations

- **Only scalar props are editable in the panel.** Internal seed data — the
  actual message texts ("Help me prep a marketing keynote…"), session names —
  is baked inside the composite as data/state, NOT exposed as scalar props, so it
  stays "Ask AI." This is the honest boundary: the panel edits what the composite
  exposes. Surfacing internal arrays as editable props is explicitly OUT OF SCOPE
  (separate, heavier design — array-of-objects panel UX).
- **Computed defaults can't be prefilled.** A prop whose default is derived at
  runtime shows empty (placeholder only). Acceptable — better than faking.
- **Parser is source-shape-bound.** It handles the kit's actual conventions
  (`type X = {…}` / `interface`, destructuring defaults). A composite written in
  an unusual style may surface fewer props; it degrades to Ask-AI, never crashes.
- **Verified by tests + reasoning** until the manual gate; given the history on
  this surface, the gate is mandatory.

## Out of scope

- Surfacing internal arrays/objects (sessions, transcript) as editable props.
- On-canvas handles.
- Auto-expand changes (interactive composites are intentionally NOT flattened;
  this spec is the complement — props for the composites auto-expand skips).
- Editing arcade-gen primitives' non-union props (this targets the resolved
  in-frame composite; primitives are typically nested and reached via Ask-AI).
