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
editable panel **without flattening** — no lost behavior. Structural props
(arrays, objects, functions, JSX) stay "Ask AI"; `ReactNode` text-slots are
surfaced as text only when their default is a string literal (see the rule
below).

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
        read literal destructuring defaults FIRST (needed by the ReactNode rule)
        TS-AST parse `<Name>Props` → for each prop, classify by type node:
           string  → {kind:"text"}
           boolean → {kind:"toggle"}
           number  → {kind:"number"}
           "a"|"b" (all string literals) → {kind:"select", values:[…]}
           ReactNode / string|ReactNode → {kind:"text"} ONLY IF its destructuring
              default is a string LITERAL (evidence it's used as text);
              else SKIPPED (no default / JSX default → genuinely structural)
           JSX / Foo[] / {…} / fn / other mixed union → SKIPPED
        EXCLUDE id-like string props (name matches /(^|[a-z])[Ii]d$/, e.g.
           activeSessionId) — free-texting an id silently breaks the scene
        attach {default} (the literal) to each surfaced prop
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
  props (JSX, arrays, objects, functions, unions mixing non-literals) are
  SKIPPED → they remain "Ask AI." Never offer a field that would clobber a
  structural prop with a string.
- **ReactNode-with-string-default rule** (the key nuance): the kit types
  several text-like slots as `React.ReactNode` (e.g. `ComputerScene.userName`,
  `userSubtitle`) so callers MAY pass `<Badge/>Ava` instead of a plain string.
  These are NOT skipped outright: a `ReactNode` (or `string | ReactNode`) prop
  becomes a `text` field ONLY when its destructuring default is a string
  LITERAL — concrete source evidence the prop is used as text in practice. A
  `ReactNode` prop with NO default or a computed/JSX default (e.g.
  `ComputerScene.headerTitle`, defaulted from the active session) is SKIPPED →
  Ask-AI. This rescues `userName`/`userSubtitle` (string defaults) while
  correctly skipping `headerTitle` (computed). Editing `headerTitle` would also
  pin the title and break the click-session-updates-header behavior, so skipping
  it is doubly correct.
- **Exclude id-like string props:** a scalar `string` prop whose name is id-like
  (matches `/(^|[a-z])[Ii]d$/`, e.g. `activeSessionId`) is SKIPPED. It must match
  an existing member of an array-typed prop; free-texting a wrong value silently
  falls back to a different item with NO error (a silent footgun). Such selection
  stays Ask-AI (or a future enum derived from the array — out of scope).
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
  `patchSource.readAttr`/`splice`) — the `prop:<name>` deterministic string-attr
  write via `/api/visual-edit`. The string path is reused UNCHANGED; a `propExpr:`
  variant + a new full-initializer reader are ADDED for expression-valued
  (boolean/number) props — see unit 4, which is the real integration cost.
- **Panel prop rendering** (`InspectorPanel.tsx`) — today renders each prop as a
  single dropdown over `values` with `{name, values}[]` state and a `prop:`-only
  write. This is a real rewrite (new state shape, per-kind widgets, two write
  prefixes, attr/default prefill, UI honesty note) — see unit 5, not a one-line
  tweak.

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
     call `parseCompositeProps`. Returns `[]` on any miss/parse failure.
   - **Do NOT cache prototype-kit results the way arcade-gen does.** arcade-gen's
     `.d.mts` is shipped/immutable so its parse is cached forever; prototype-kit
     composite source is LIVE-EDITED during development. Caching by name would
     make composite edits invisible until a server restart — and Studio's Vite
     middleware does NOT hot-reload (see studio/CLAUDE.md), so this would be a
     silent "my edit didn't show up" trap. Either skip the cache for the composite
     path (a parse-per-request is cheap), or key the cache on the file's mtime.

2. **Richer prop descriptor** — `KitProp2 = { name: string; kind: "text" |
   "toggle" | "number" | "select"; values?: string[]; default?: string }`.
   The existing arcade-gen `KitProp` (`{name, values}`) is adapted to this shape:
   a string-union from arcade-gen becomes `{kind:"select", values}`. The endpoint
   returns `KitProp2[]` uniformly so the panel has one shape.

3. **`kitPropsFor` resolver chain** (`server/codeWriter/kitProps.ts`) — try the
   arcade-gen `.d.mts` reader first (mapped to `kind:"select"`); if it returns
   nothing for the name, fall back to `compositePropsFor`. One unified result.

4. **`propExpr:` write variant + a new full-initializer reader** — the genuinely
   hard integration point (NOT a footnote; verified against the code below). Two
   parts:
   - **`readAttrInitializer(source, hit, propName)` (new, in `patchSource.ts`)** —
     today's `readAttr` (a) BAILS with `dynamic-attr` on any non-string-literal
     initializer (`patchSource.ts:99`) so it can't even FIND an existing
     `count={2}`, and (b) returns only the inside-quotes value span
     (`getStart+1`/`getEnd-1`, `:96-98`). The new reader returns, when the attr
     exists, the FULL initializer span — the `"…"` literal OR the entire `{…}`
     JsxExpression — plus an `insertAttr`/`insertAt` for the absent case (same as
     readAttr). It does NOT bail on expression initializers. Scope of replaceable
     expression shapes for v1: ANY existing initializer span is replaced wholesale
     with the new `{value}` (we overwrite, we don't parse the old expression), so
     `count={anything}` and `state="x"` are both replaceable. `readAttr` itself
     is UNCHANGED (string path keeps working).
   - **`propExpr:<name>` branch in `index.ts`** — alongside `prop:<name>` (string
     form: insert ` name="value"` / replace inside-quotes), add `propExpr:<name>`:
     insert ` name={value}`; replace the FULL initializer span (from
     `readAttrInitializer`) with `{value}`. Reparse-guarded by the existing
     `reparses(out)` check — a malformed expression aborts the whole batch, file
     untouched. The panel chooses the prefix by `kind`: text/select → `prop:`,
     toggle/number → `propExpr:`.

5. **Panel widget-by-kind** (`InspectorPanel.tsx`) — this is a real rewrite of
   the prop section, not a tweak: today the panel hardcodes `{name, values}[]`
   state (`:139`), a single `<select>` widget (`:443-451`), and a `changeProp`
   path that only ever calls `prop:` (`:295-311`). Changes:
   - State shape → `KitProp2[]` (carries `kind`/`default`).
   - Render per `kind`: text→`Input`, toggle→`Switch`, number→`Input type=number`,
     select→existing dropdown.
   - Prefill value = current instance attr value if present, else `default`, else
     empty (placeholder = prop name).
   - On change: text/select → `change("prop:<name>", value)`; toggle/number →
     `change("propExpr:<name>", value)` (value = `"true"`/`"false"` / number text).
   - Header still names the component ("Editing `<ComputerScene>`").
   - **Honesty boundary in the UI (not just prose):** below the prop fields,
     always show a one-line note — "Text content and structure are edited via Ask
     AI" — and keep the "Ask AI to change this" action visible EVEN WHEN props
     exist (today it shows only on empty). This is what stops the
     "panel-feels-broken" regression: a designer who sees `userName`/`state` but
     wants to edit the visible message text ("Help me prep a marketing keynote…",
     a baked-in constant, not a prop) is told where that lives instead of assuming
     the panel is half-working. Empty result → existing "No editable properties —
     use Ask AI to change this."

## Data flow — edit ComputerScene's user name

1. Select the sidebar footer → panel resolves in-frame component `ComputerScene`.
2. `GET /api/kit-props/ComputerScene` → arcade-gen reader returns `[]` →
   `compositePropsFor` reads `composites/ComputerScene.tsx`. ComputerScene's
   actual surface (verified against source):
   - `userName` — typed `ReactNode`, default `"Ava Wright"` (string literal) →
     surfaced as `text` (ReactNode-with-string-default rule).
   - `userSubtitle` — `ReactNode`, default `"DevRev"` → `text`.
   - `chatInputPlaceholder` — `string`, default `"Ask me anything"` → `text`.
   - `userAvatarSrc` — `string`, no default → `text` (empty, placeholder).
   - `state` — `"empty"|"streaming"|"transcript"`, default `"transcript"` →
     `select`.
   - `withCanvasPanel` — `boolean`, no default → `toggle`.
   - SKIPPED: `headerTitle` (ReactNode, computed default), `activeSessionId`
     (id-like string), `sessions` (array), `onOpenSettings` (function).
   So the response is:
   `[{name:"userName",kind:"text",default:"Ava Wright"},
   {name:"userSubtitle",kind:"text",default:"DevRev"},
   {name:"chatInputPlaceholder",kind:"text",default:"Ask me anything"},
   {name:"userAvatarSrc",kind:"text"},
   {name:"state",kind:"select",values:["empty","streaming","transcript"],
   default:"transcript"}, {name:"withCanvasPanel",kind:"toggle"}]`.
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
  asserts:
  - `state` → select, 3 values, default "transcript".
  - `withCanvasPanel` → toggle.
  - `chatInputPlaceholder` → text, default "Ask me anything" (plain `string`).
  - `userAvatarSrc` → text, no default (plain `string`, no default).
  - `userName` → text, default "Ava Wright" — **ReactNode WITH string-literal
    default → surfaced** (the key rule).
  - `headerTitle` → **SKIPPED** — ReactNode with NO/computed default.
  - `activeSessionId` → **SKIPPED** — id-like string (name matches the id regex).
  - `sessions` (array), `onOpenSettings` (function) → SKIPPED.
  - Plus: `interface XProps {…}` form parses same as `type X = {…}`; optional
    `?:` doesn't affect classification; a `ReactNode` prop with a JSX default →
    SKIPPED; an intersection type → parses literal members, skips the rest; a
    `string | number` mixed union → SKIPPED.
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
  prefilled correctly. Two prefill cases BOTH covered (Risk: the no-attr frame
  only exercises the default branch): (a) frame with NO attr → field prefills
  from `default`; (b) frame that DOES set `userName="X"` → field prefills from the
  attr value, NOT the default. Empty props → "No editable properties." Also: the
  "edited via Ask AI" note + Ask-AI action are present EVEN when props exist.
- **Manual gate (HUMAN):** open the ComputerScene frame → panel shows **user name
  (Ava Wright), subtitle (DevRev), chat placeholder (Ask me anything), avatar src
  (empty), state (transcript dropdown), canvas-panel (toggle)** — prefilled with
  the visible/default values. NOT shown (correctly): header title, session id,
  the message texts. Edit user name → "Ada" → applies + persists; switch state →
  "streaming" → applies; toggle canvas panel → applies; the scene STAYS
  interactive (sessions clickable, streaming works). The panel shows the "text
  content / structure → Ask AI" note so the absent message-text editing reads as
  intentional, not broken. No "No editable properties" dead-end for this frame.

## Risks / honest limitations

- **Modest knob count for ComputerScene specifically.** After the rules above,
  ComputerScene yields ~6 fields (userName, userSubtitle, chatInputPlaceholder,
  userAvatarSrc, state, withCanvasPanel) — real but cosmetic-leaning; `state` +
  `withCanvasPanel` are the marquee ones. ComputerScene is close to a worst case
  for this feature (its interesting content is internal data, not props); the
  feature is more clearly valuable for composites with rich string/enum prop
  surfaces. Still net-positive: it turns a permanently-dead panel into a live one
  and removes the "interactive prototype = no panel" cliff. The UI honesty note
  (Ask-AI for text/structure) keeps the modest surface from reading as broken.
- **Only scalar props are editable in the panel.** Internal seed data — the
  actual message texts ("Help me prep a marketing keynote…"), session names —
  is baked inside the composite as module-level constants/state, NOT exposed as
  props, so it stays "Ask AI." This is the honest boundary, and it's now drawn in
  the UI (the note + always-visible Ask-AI), not only in this doc. Surfacing
  internal arrays as editable props is explicitly OUT OF SCOPE (separate, heavier
  design — array-of-objects panel UX).
- **ReactNode-typed text props are a judgment call.** We surface a `ReactNode`
  prop as text ONLY when its default is a string literal. This can be wrong in
  two directions: a prop currently holding JSX but with a string default would
  get a text box that overwrites the JSX (rare — defaults usually match usage);
  and a genuinely-text prop typed `ReactNode` with no default is skipped (false
  negative). Accepted: the string-default signal is the best cheap evidence, and
  both failure modes degrade to Ask-AI, never to a crash or silent corruption
  (reparse-guard catches a broken write).
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
