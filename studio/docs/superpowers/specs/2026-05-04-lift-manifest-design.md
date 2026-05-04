# Lift Manifest — design spec

Status: draft, pending review
Scope: Arcade Studio (not the skill at repo root)
Owner: @asundiev

## 1. Problem

Arcade Studio generates prototypes against `@xorkavi/arcade-gen`, a bespoke LLM-friendly design system. Prototypes look like DevRev's production app but share no code with it. Today an engineer shown a Studio prototype rebuilds from scratch, guessing how the UI should translate into production `raw-design-system` + `arcade-theme` code, because the prototype carries no translation information.

The cost is asymmetric: DevRev has ~300 engineers and ~15–20 designers. Every hour a Studio prototype saves a designer is multiplied by the number of engineers who then re-derive the same thing unaided. Any tool that makes Studio output *mechanically* legible to an engineer (or the engineer's coding agent) compounds that asymmetry in our favor.

Studio's structural advantage over v0 / Lovable / Figma Make is that its output is written against a *known, small, closed-world* component and token vocabulary. Mapping that vocabulary onto production is a small, owned, bounded piece of work. That is the opportunity this spec targets.

## 2. Goal

For every Studio frame, emit a **Lift Manifest** — a structured, self-contained handoff artifact that an engineer (and their Claude Code agent) can use inside `devrev-web` to produce a correctly-structured feature scaffold, without starting from a screenshot.

The manifest does not turn a prototype into a shippable feature. It:

- Replaces guessing with a specified mapping from Studio primitives/composites → production equivalents.
- Flags the production scaffolding that a frame lacks by definition (data layer, adapters, routing, feature flags, telemetry).
- Keeps designers' generation loop unchanged.

Out of scope for this spec (explicitly reserved for later rungs):

- Studio running a transpile / automated lift itself.
- Studio pushing branches or opening PRs.
- A Claude Code skill / CLI inside `devrev-web` that consumes manifests automatically. *(The manifest is designed so such a skill is easy to add later, but it must be useful to a human engineer with no tooling beyond copy-paste first.)*

## 3. Non-goals

- Replacing `arcade-gen`. arcade-gen stays. It is the LLM-optimized flavor of the design system and is the correct generation target.
- Porting Studio's `prototype-kit` composites into production. We map *against existing production patterns*, we don't add to them.
- Fidelity guarantees. A lifted frame is a **scaffold**, not a finished feature.
- Solving token drift. Tokens are being aligned separately; this spec assumes alignment.

## 4. The manifest, concretely

One manifest per frame. Lives alongside the frame, surfaced through Studio's UI.

### 4.1 Location and format

- File: `projects/<slug>/frames/<frame>/LIFT.md` (Markdown, human-readable, agent-readable).
- Regenerated on every frame write. Cheap — it's computed from the frame's imports, not from model output.
- Reachable from Studio's UI on the frame via a "Copy lift manifest" action and via a public URL when a project is shared to Vercel.

Markdown, not JSON, because the primary consumer is a human engineer pasting it into a Claude Code session. A machine-readable companion (`LIFT.json`) ships alongside for the future automated-lift rung; same source of truth, rendered two ways.

### 4.2 Sections

1. **Intent summary** — 2–4 sentences. What the frame is, what it's trying to be. Taken from the prompt that generated the frame (first user turn) plus the filename slug. This is for the agent's context window, not for the engineer.

2. **Frame inventory** — a table of every arcade primitive and every prototype-kit composite the frame imports. For each:
   - Studio import (e.g. `Button` from `arcade/components`, `NavSidebar` from `arcade-prototypes`)
   - Production equivalent (`Button` from `raw-design-system`, `Nav` compound from `raw-design-system`)
   - Prop deltas (size-map table, renamed enums, slot-vs-child differences)
   - Translation class: `mechanical` / `structural` / `judgment`
   - If `judgment`: 1-line note on what the engineer or their agent has to decide

3. **Composite mapping details** — expanded notes for any composite in use. E.g. `NavSidebar` in Studio is flat; production `Nav` uses compound subcomponents with Slots. Not prose — a short before/after skeleton per composite, drawn from the curated mapping table (see §5).

4. **Token alignment note** — one paragraph: "Tokens are aligned. CSS custom property names carry across." If a token is ever *not* aligned, it appears here as an explicit exception list. We expect this section to stay empty in steady state.

5. **Production scaffolding checklist** — the real work the frame doesn't cover. Generated from the frame's detected shape (detail page / list view / settings form / modal flow / ad-hoc). Each item is a concrete thing to do, scoped to the target `libs/<domain>/...` path pattern, *not* prose advice:

   - `useDL<Entity>` data-layer hook in `libs/<domain>/shared/data-layer/src/`
   - Adapter `<entity>GetResponseToUI<Entity>Response` in `libs/<domain>/adapters/`
   - Query keys in `libs/<domain>/shared/data-layer/src/keys.ts`
   - Stale time entry in `STALE_TIMES_IN_MS`
   - Route registration
   - Feature flag gate via `useFeatureFlag`
   - Event tracker wiring via `useEventTracker` + `track(EventType.X, ...)`

   Items can be marked as "N/A for this frame shape" by the detector. The checklist is auto-ticked where possible; the remaining items are what the engineer and their agent divide between them.

6. **Figma backlink** — if the frame is linked to a Figma node (Studio already tracks this), include the URL. Grounding, nothing more.

7. **Screenshot link** — a preview PNG served by Studio. Grounding, nothing more.

8. **Agent prompt snippet** — a copy-ready block the engineer pastes into their Claude Code session inside `devrev-web`. Contains the manifest content plus short directives ("apply mechanical rewrites, flag structural rewrites as TODOs, leave judgment calls as comments"). This is the bridge between "document" and "action" — and the seam where rung 2 plugs in later.

### 4.3 Shape detection

The scaffolding checklist depends on the frame's *shape*. Shape is inferred from which templates/composites the frame uses:

- Frame imports `VistaPage` → list-view shape → checklist includes list data layer, filter state, pagination.
- Frame imports `SettingsPage` → settings-form shape → checklist includes form hook, validation, optimistic update.
- Frame imports `AppShell` only, with custom children → ad-hoc shape → checklist is generic (data fetch + route entry) with a "consider whether this fits an existing Tier-2/3 template" note.
- Detail shape detection by heuristic: Header + tabs + content body → detail shape.

Shape detection is a switch statement, not a model call. Small surface, quick to extend.

## 5. The mapping table

The manifest is only as good as the mapping between Studio and production. This is the central asset.

- Lives in `studio/src/lift/mappings/` as a set of TypeScript modules (one per composite, one combined file for primitives).
- Structure: an array of entries; each entry has `{ studio: { source, name }, production: { source, name }, propDeltas: [...], slots: [...], translationClass, notes }`.
- Imported both by the manifest generator (to render per-frame sections) and by the future rung-2 transpiler.
- Curated by hand, not generated from types. Generation would invite false positives — the whole point is that this is an informed, judgment-laden mapping.

Coverage:

- **All arcade-gen primitives actually reachable from generated frames.** That's the union of what `arcade-components.tsx` re-exports and what composites themselves use. Not the full arcade-gen API.
- **All prototype-kit composites in `studio/prototype-kit/composites/` and `studio/prototype-kit/templates/`.** Currently ~19 composites + 2 templates per the pipeline audit.

Maintenance discipline:

- A test (`__tests__/lift/mapping-coverage.test.ts`) fails if `arcade-components.tsx` or a prototype-kit composite exports something not present in the mapping table. This keeps the table honest as arcade-gen and the kit evolve.
- A changelog entry in `studio/CHANGELOG.md` is required whenever the mapping table changes meaningfully, so engineers using lift manifests know the ground shifted.

## 6. UX surfaces in Studio

### 6.1 In the Studio shell

- The frame detail view grows a small "Lift to devrev-web" action (button or menu item) that:
  1. Copies the manifest markdown to the clipboard, and
  2. Shows a toast: *"Open devrev-web and paste into Claude Code. [Learn more →]"*

- The settings modal does not need a new section. No configuration — the manifest always exists.

### 6.2 In the shared Vercel preview

When a project is shared to Vercel, the manifest is reachable at a stable URL under the share (`/lift/<frame>.md`). This means an engineer can open a shared prototype, grab its manifest, without needing Studio installed.

### 6.3 Nothing changes for the generator

The generator doesn't know the manifest exists. It continues to produce frames the same way. The manifest is derived *from* the frame after it's written.

## 7. Architecture

### 7.1 Where the work lives

All new code is inside `studio/`:

- `studio/src/lift/` — manifest data types, shape detector, markdown/JSON renderer. Pure functions, trivially testable.
- `studio/src/lift/mappings/` — the mapping table modules.
- `studio/server/plugins/liftEmitPlugin.ts` — a Vite plugin that writes `LIFT.md` and `LIFT.json` next to a frame whenever the frame changes on disk. This is the source of truth: the files on disk are the manifest.
- `studio/server/middleware/lift.ts` — a thin middleware exposing `/api/lift/<slug>/<frame>.md` and `.json` by reading the files the plugin wrote. Used by Studio's UI action and by anything outside the filesystem that wants a manifest.
- `studio/server/vercel/bundler.ts` — extended to include the already-emitted `LIFT.md` / `LIFT.json` in Vercel share bundles.

### 7.2 Where the work does *not* live

- Not in `arcade-gen`. The mapping is Studio's concern, not the component library's.
- Not in `devrev-web`. Not yet. Rung 2 (a lift skill inside devrev-web) is a separate future project. The current rung's success criterion is that a human engineer with Claude Code and no lift skill installed can usefully consume a manifest.

### 7.3 How it plugs into the existing Studio pipeline

The only integration point is the frame filesystem. `liftEmitPlugin.ts` watches the same project directory already watched by the frame-mount plugin. When a frame is written, it reads the frame, imports the mapping table, runs shape detection, and emits `LIFT.md` + `LIFT.json`. No changes to `chat.ts`, the Claude CLI subprocess, or the generator prompt.

Any coupling between the generator and the manifest would be a mistake — the generator should stay generic, and the manifest should stay a side-effect of what was generated.

## 8. Testing

- **Mapping coverage test** (described in §5) — the highest-value test. Prevents silent drift.
- **Shape detector unit tests** — for each shape (list / settings / detail / ad-hoc), feed a representative fixture frame and assert the expected shape + checklist.
- **Manifest snapshot tests** — for 3–5 fixture frames covering the representative shapes, snapshot the rendered markdown. Snapshots catch unintended changes to the document format.
- **Integration test** — hit `/api/lift/<slug>/<frame>.md` against a fixture project and assert the response is non-empty and contains expected sections.

We don't test the *quality* of translations automatically. That's the job of the first three real lift attempts (see §10).

## 9. Open questions for review

1. **Manifest scope per project vs. per frame.** The spec assumes per-frame. A project-level manifest (covering the whole prototype) might be more useful for larger prototypes that span multiple pages. Proposal: start with per-frame, add a project-level rollup later if it turns out engineers want to lift a whole prototype in one go.
2. **Ownership of the mapping table.** The spec puts it in `studio/` initially. If the design-system team wants in early (likely once this proves out), the table can move to a co-owned location with no API change for consumers. Worth flagging to the DS team so they're not surprised when we ask.
3. **What to do when a frame uses an arcade primitive with no production equivalent.** Current answer: mark the entry `judgment`, surface an explicit note in the manifest, leave it for the engineer. Better answer *might* exist — e.g. automatic suggestion of the closest fit — but that's speculation without data from real lifts.

## 10. Success criteria

This rung is successful if **three real lifts happen and each one confirms or updates the mapping table.** Specifically:

- An engineer at DevRev takes a Studio-shared frame, opens devrev-web, pastes the manifest into Claude Code, and ends with a local branch containing a scaffold they'd rather finish from than rebuild from Figma.
- For each of those three lifts, any gap found in the mapping table is closed in the same PR.
- After three lifts, we reassess: does the workflow warrant rung 2 (automated lift inside devrev-web), or does the manifest-alone version carry most of the value?

No dashboards, no adoption metrics, no success theater. Three honest lifts, three honest retros.

## 11. What rung 2 would look like (for reference, not in scope)

Kept short so nothing in this spec forecloses on it:

- A Claude Code skill inside devrev-web: `/lift-frame <studio-frame-url>`.
- Fetches `LIFT.json` + the frame source from the Studio project or Vercel share.
- Applies mechanical rewrites automatically, leaves structural ones as scaffolded TODOs, preserves judgment flags as code comments.
- Drops files into the right `libs/<domain>/feature/<name>/` location, generates data-layer/adapter stubs at the right paths, opens a local branch.

Everything in the present spec is compatible with this. The `LIFT.json` artifact and the mapping-table TypeScript modules are the interface rung 2 plugs into.
