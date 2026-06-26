# Frame Auto-Expand (Composites → Flat Editable Frames) — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)
**Sub-project:** #1 of 2. #2 (fix the "Ask AI to change this" prompt to take real input) is a separate, smaller spec to follow.

## Problem

Generated frames are nearly opaque: the generator is instructed to prefer
composites ("composites… are LAW"; `templates/CLAUDE.md.tpl`), so a "page with
cards and a save button" comes out as a single `<SettingsPage sidebar={…}
title="My Cards">…</SettingsPage>`. The designer clicks anything and the whole
page resolves to one component (`SettingsPage`) with **no editable props of its
own that matter** — props-first editing showed "No editable properties" + a
useless "Ask AI to change this." Five editing approaches failed against this; the
honest root cause is **generation output**, not the editing layer:

> A full-page composite is a great *scaffold* for fast generation, but a terrible
> *final artifact* — once the frame exists, staying a single opaque composite
> means there's no easy way to modify it.

The fix is at generation: keep composites for fast scaffolding, but **expand the
frame into flat, editable code** (primitives + raw markup authored directly in
`index.tsx`) before the designer edits it. Then the **instant style editing that
already works on frame-authored elements** simply applies — no detach, no
props-only dead-end.

## The model (generate → auto-expand)

1. **Generate fast with composites** (unchanged). The generator may use
   `<SettingsPage>`, `<ComputerPage>`, etc. to scaffold the page quickly.
2. **Auto-expand after generation.** A post-generation step rewrites the frame's
   `index.tsx`, replacing each top-level full-page composite instance with its
   **flat equivalent** (the composite's own outer chrome inlined as
   primitives + raw markup, with the props/children the frame passed dropped into
   their slots). The frame the designer sees is flat and editable.
3. **Expansion source — the composite carries its own expansion** (the Figma
   analogy: a Figma component stores its layers; "detach" reads them out). Each
   full-page composite exports an authored `expand(props) => string` that returns
   its flat JSX for the given props. Deterministic, kit-owned, accurate — no
   runtime fiber-walk (which crashed), no partial-eval of arbitrary JSX.
4. **AI-expand fallback.** A composite with no authored `expand` → the
   post-generation step runs a scoped AI pass that rewrites that instance into
   flat markup. Best-effort; replaced by an authored expansion later.

Result: frames arrive flat → existing instant style editing on frame-authored
elements works → the whole prior editing investment finally pays off.

### Decisions locked during brainstorming

- **When/how:** generate with composites, **auto-expand after** generation (not
  flat-from-the-start, not expand-on-first-edit).
- **Expansion source:** the composite **carries its own expansion** as an
  authored `expand(props) => flatJsxString` (one source of truth beside the
  component; deterministic; kit-owned).
- **Fallback:** composites without an authored `expand` → **AI-expand** (a scoped
  generation pass). Keeps every frame editable; honest reliability split
  (authored = deterministic, AI = best-effort).
- **Scope of "full-page composites":** the 4 templates today —
  `SettingsPage`, `ComputerPage`, `VistaPage`, `BuilderPage`
  (`prototype-kit/templates/`). Author expansions for these; smaller composites
  (cards, rows) are NOT expanded (they're already fine-grained and editable as
  the children the frame authored).

## Key structural fact (shapes the expansion)

The full-page templates take **`ReactNode` props/children**, not scalars
(`SettingsPage`: `sidebar`, `breadcrumb`, `children` are all `ReactNode`). So the
frame source ALREADY contains the editable inner JSX — the `<NavSidebar>`, the
`<SettingsCard>` stack — as the values passed in. **The opaque part is only the
template's own OUTER CHROME** (title bar, sidebar split, body wrapper) that
`SettingsPage` renders internally and the designer can't see/edit.

Therefore expansion = **inline the template's outer chrome as flat markup, and
drop the already-authored `ReactNode` props/children into their slots.** The
passed-in `sidebar`/`children` JSX is moved verbatim (it was always editable);
only the wrapper becomes editable too.

## Architecture

```
Generation turn (chat.ts) writes frames/<slug>/index.tsx (composites)  ── unchanged
        │  (post-turn, after the afterSnapshot/diff at chat.ts:710)
        ▼
AUTO-EXPAND PASS (new, server-side, on the changed frame files)
   for each top-level full-page composite instance in index.tsx:
     │  parse index.tsx (TS AST), find <SettingsPage …>…</…>
     │  extract its props + children as SOURCE SUBSTRINGS (the JSX the frame passed)
     ├─ authored expansion exists (kit's SettingsPage.expand) ──→ expand(propsSrc) → flat JSX → splice in place (reparse-guard)
     └─ no authored expansion ──→ AI-expand pass (scoped prompt) rewrites that instance → flat JSX → splice (reparse-guard)
        ▼
   frame is now flat editable code → Vite reload → designer edits with the existing instant style path
```

### New / changed units

1. **Authored expansion convention** (kit, `prototype-kit/`) — each full-page
   template exports `expand(props: { [slot]: string }) => string`: given the
   SOURCE TEXT of each prop/child the frame passed (e.g. `sidebar` = the
   `<NavSidebar>…</NavSidebar>` substring, `title` = `"My Cards"`, `children` =
   the body JSX substring), returns the flat JSX string — the template's outer
   chrome written as primitives + raw markup with the slot substrings inlined.
   The kit author writes this once per template, byte-faithful to what the
   template renders. Exported alongside the component (a sibling export, kept in
   the same file/module as the template so they can't drift). Start with
   `SettingsPage`; add the other 3 templates.

2. **Expand-source extractor** (`studio/server/expand/extractInstance.ts`) — pure
   TS-AST: given `index.tsx` source + a target component tag, find the top-level
   instance, return `{ tag, propsSrc: Record<string,string>, childrenSrc: string,
   elementStart, elementEnd }` (prop values + children as verbatim source
   substrings, plus the splice range). Reuses the Phase-A AST helpers
   (`locateJsx`, attribute/children readers, `splice`).

3. **Expansion registry + apply** (`studio/server/expand/expandFrame.ts`) — maps
   a tag → its authored `expand` (imported from the kit) or null; `expandFrame
   (source): { source, changed }` finds each top-level full-page-composite
   instance, calls its authored `expand(propsSrc)` (or marks it for AI fallback),
   splices the flat JSX over the instance, reparse-guards (never writes
   un-parseable TSX), and returns the rewritten source. All-or-nothing per
   instance: a failed expand leaves that instance as-is.

4. **AI-expand fallback** (`studio/server/expand/aiExpand.ts` or reuse the chat
   subprocess) — for an instance whose tag has no authored expansion, run a
   scoped Claude pass: "rewrite this `<Tag …>` instance in
   frames/<slug>/index.tsx into the equivalent flat layout using arcade
   primitives + raw markup, preserving the visual result; do not change anything
   else." Best-effort; reparse-guarded.

5. **Post-generation hook** (`studio/server/middleware/chat.ts`, near the
   post-turn snapshot at ~710) — after a generation turn writes/changes a frame,
   run `expandFrame` on each changed `index.tsx`. If it changed the source, write
   it back (triggers the normal Vite reload). Fire after the turn's frame writes,
   before the designer interacts. Guard: only run on frames that actually contain
   a full-page composite (cheap tag scan first).

### Generator policy (small change)

The generator stays composite-first (fast scaffolding). It is NOT asked to write
flat — the expand pass handles that. One addition to `CLAUDE.md.tpl`: note that
full-page composites are auto-expanded post-generation, so the generator should
keep using them normally (no behavior change for the subprocess; this is
documentation so future edits don't "optimize" the composite away).

## Data flow — expand a SettingsPage frame

1. Generation writes `index.tsx` = `<SettingsPage sidebar={<NavSidebar…>}
   title="My Cards" subtitle="…">{<SettingsCard…>…}</SettingsPage>`.
2. Post-turn hook runs `expandFrame(source)`. Extractor finds the `SettingsPage`
   instance, captures `propsSrc = { title: '"My Cards"', subtitle: '"…"',
   sidebar: '<NavSidebar…>…</NavSidebar>', … }` and `childrenSrc =
   '<SettingsCard…>…'` as verbatim substrings.
3. Registry has `SettingsPage.expand` → returns the flat outer chrome (the title
   bar div, the sidebar-split layout, the body wrapper) with the slot substrings
   inlined — the `<NavSidebar>` and `<SettingsCard>` JSX moved into place
   verbatim.
4. `expandFrame` splices the flat JSX over the `<SettingsPage>` element,
   reparse-guards, writes `index.tsx`. Vite reloads.
5. The designer now sees the same page, but `index.tsx` is flat: the title is a
   real `<h1>`, the cards are right there. Clicking the title → it's
   frame-authored → **instant style editing works**.

## Error handling

- **Authored expand throws / returns un-parseable** → reparse-guard rejects;
  that instance is left as the composite (frame still renders, just not
  flattened). Logged.
- **AI-expand fails / unavailable** → instance left as the composite (graceful
  degrade to today's props/Ask-AI editing for that instance). No crash, no broken
  frame.
- **No full-page composite in the frame** (already flat, or only small
  composites) → expand pass is a no-op (cheap tag scan short-circuits).
- **Never write un-parseable TSX** — every splice reparse-guarded; all-or-nothing
  per instance.
- **Idempotent** — once expanded, the frame has no top-level full-page composite,
  so re-running expand is a no-op (won't double-expand).

## Testing

- **Extractor** — given an `index.tsx` with `<SettingsPage title="X"
  sidebar={<A/>}>…children…</SettingsPage>`, returns the correct propsSrc
  substrings, childrenSrc, and splice range; handles self-closing,
  no-children, expression vs string props.
- **Authored expand (SettingsPage)** — `SettingsPage.expand({title:'"X"',
  sidebar:'<A/>', children:'<C/>'})` returns flat JSX containing the title text,
  the sidebar substring, and the children substring in the template's layout;
  the result PARSES (TS) and references only kit primitives + host tags.
- **expandFrame** — a frame with a top-level SettingsPage → expanded flat (no
  `<SettingsPage>` remains, body present); a frame with no full-page composite →
  unchanged; an expand that would break parse → instance left as-is; idempotent
  (second run = no change).
- **AI-fallback routing** — a composite tag with no registered expansion → routed
  to the AI path (mock it); authored tag → never hits AI.
- **Post-gen hook** — after a (mocked) generation turn that writes a SettingsPage
  frame, expandFrame runs and the persisted index.tsx is flat. Doesn't run when
  no full-page composite is present.
- **Manual gate (HUMAN)** — generate "a page with cards and a save button" → the
  frame renders identically BUT clicking the title/a card/the button selects a
  frame-authored element with **instant editable style fields** (not "No editable
  properties"). prototype-kit/ untouched. The composite is gone from index.tsx.

## Risks / honest limitations

- **Authoring burden:** someone writes `expand()` for each of the 4 full-page
  templates, byte-faithful to the rendered output. Bounded (4 today), kit-owned,
  one-time per template. This is the real cost — stated plainly. The AI fallback
  covers anything not yet authored.
- **Drift risk:** an authored `expand` can drift from the component if the
  template changes but `expand` isn't updated. Mitigation: keep `expand` in the
  same file as the component; a kit test renders both and compares (out of scope
  for v1 mechanism, noted as a follow-up — v1 ships the mechanism + the
  SettingsPage expansion + AI fallback).
- **AI-expand non-determinism** for un-authored composites — best-effort, may not
  be byte-perfect; acceptable as a fallback that's progressively replaced by
  authored expansions.
- **Expansion latency:** the post-gen pass adds time (a splice for authored; a
  second AI turn for fallback). Authored = fast; AI fallback = a generation
  pass's worth. Acceptable post-generation (the designer is already waiting on
  the turn).
- **Verified by tests + reasoning** until the manual gate; given the history, the
  gate is mandatory.

## Out of scope

- Sub-project #2: fixing "Ask AI to change this" to take real input (separate
  spec). NOTE: after auto-expand, far less is left as an un-editable component,
  so #2's surface shrinks — but it still matters for the AI-fallback'd or
  genuinely-component cases.
- Authoring expansions for the non-full-page composites (cards/rows) — not
  needed; they're already editable as authored children.
- A kit render-parity test for `expand` vs the component (follow-up).
- On-canvas handles.
