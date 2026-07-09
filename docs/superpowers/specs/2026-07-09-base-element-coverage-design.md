# Maximise Arcade recognition + notify on hand-rolls

**Date:** 2026-07-09 (final — after live data + two adversarial rounds)
**Status:** ready for implementation plan
**Branch:** TBD (sibling of `feat/figma-fidelity-eject`)

## Decision

Two live component generations at DevRev: **Arcade** (Computer products; mirrored in code
by `arcade-gen`; ADS Figma file `[0.3]` sets are its design side) and **DLS** (Apps/SoR).
Studio's deterministic import maps **Arcade → arcade-gen by published key**, and everything
else (deprecated Arcade, DLS, utility/product/local libraries) stays **bespoke
pixel-faithful floor** — never cross generations (a wrong component is worse than an honest
div; a mislabel is confidently-wrong code that gets merged).

Two workstreams:
1. **Maximise Arcade recognition** — capture 100% of the Arcade slice on every screen.
   This compounds: as ADS adoption grows, the same engine recognises more, automatically.
2. **Explicitly notify** the user which base elements were hand-rolled as static pixels
   (i.e. won't transfer to production) — bar the layout.

## Why this is the right target (live data, DS Observatory, 15 hottest files, May–Jul 2026)

- Component usage: **Arcade ~22%** (per-file 3–43%), **DLS ~0%**, **other/deprecated/local
  ~78%**.
- **No happy path and no fully-bespoke path exist — every real file is a mixture**, Arcade
  a strong minority. Optimise for the realistic path; it's the only one.
- Hottest files are Computer/Agent-Studio work — arcade-gen's exact target. **DLS is not in
  the active set → drop dual-target entirely.** Arcade-only aims at where activity is.
- The real "competition" for coverage is the 78% *other* (deprecated Arcade, "Slots and
  Utilities", "Button Group", archived migrations, product-local) — mostly NOT cleanly
  mappable to current arcade-gen, so faithful-floor is the honest answer for it.
- Ceiling, stated honestly: even perfect Arcade mapping recognises ~15–43% today; the rest
  stays static. Not a failure — the shape of the input. It rises with ADS adoption.

## What's verified in code (not assumed)

- Recognition matches by published key: `matchKit(setKey,setName)` (`kitMappings.ts`),
  falls back to faithful markup; the emitter recurses into unmapped containers so inner
  mappable instances are still caught (`kitEmit.ts`).
- **Source-library identity IS resolvable.** DS Observatory classifies every instance by
  its source-file key (`node-classifier.ts:55-58`) via a component-key→file-key map. So an
  ADS-key allowlist can deterministically answer "is this instance Arcade?" — the earlier
  "uncomputable" worry was about *set-key-only* matching; the component-key path works.
- **Adding a `SET_KEY_TO_KIT` row is NOT sufficient.** The `emit()` switch has a bespoke
  `case` per component (prop/variant/child translation); an unknown kit name hits `default`,
  which backs out the match (`matchedInstances--`, `kitEmit.ts:1162-1167`) → static div.
  So each new twin needs a **row + emit case**.
- Compound namespace objects (`Accordion`, `Radio`, `ToggleGroup`, `Menu`, `Modal`,
  `Popover`, `Select`-shell) are in `NON_RENDERABLE_KIT_EXPORTS` — emitting `<Accordion/>`
  white-screens the frame; they need dotted-sub-component cases or stay omitted.
- **`NumberField` and `SegmentedControl` do NOT exist in arcade-gen** → no-twin → floor.
- `arcade-gen` exports 177 components; simple renderable twins that DO exist and lack a
  case today: `Banner`, `TextArea`, `Link`, `KeyboardShortcut`, `SplitButton`.
- Coverage counters already exist (`matchedInstances`/`totalInstances`/`unmatchedSets`) and
  `formatCoverage` already formats them — but it's **console-only** (`kitEmitBranch.ts:396`);
  the user trailer is `narrate(trailer)` (`:414-420`).
- **Live precision bug to fix regardless:** `SET_NAME_TO_KIT["Button"]` (`kitMappings.ts:61`)
  matches ANY set *named* "Button" by name → a DLS/other "Button" emits as arcade-gen
  `<Button>` = the exact cross-generation mislabel this spec forbids.

## Workstream 1 — Maximise Arcade recognition

### 1a. Harvest the Arcade `[0.3]` set keys (curation, honestly)
ADS has 29 `[0.3]` sets; Studio maps ~13. `list-file-components` returns *component* keys +
node ids, **not the *set* keys** `SET_KEY_TO_KIT` uses (the original 13 were plugin-bridge
captured). Harvest paths, in order of preference:
- Resolve set keys from a `get-nodes` payload (components→componentSetId→set key) run over
  the ADS `[0.3]` sets — no bridge needed. **Verify this yields the set key** (Task 0).
- Fallback: the plugin bridge, one set at a time (proven, slower).
Record each set's key → arcade-gen twin, or **"no twin → floor"** (Number Field,
Segmented Control, anything without a real export). Confirm the CANONICAL `[0.3]` key per
concept — reject the `[DLS]`/`[DEPRECATED]`/`[0.2]` same-named twins (the export table's
curation notes show these collisions exist; a wrong harvest = a mislabel).

### 1b. Add row + emit case per twin — telemetry-gated priority
- **Gate on real usage:** read a window of the existing `unmatchedSets` logs from real
  imports first, and prioritise the Arcade sets that actually appear — don't build all 16
  on spec.
- **Simple renderable twins first:** `Banner`, `TextArea`, `Link`, `KeyboardShortcut`,
  `SplitButton` — each = one `SET_KEY_TO_KIT` row + one `emit()` case with its variant map.
- **Compounds** (`Accordion`, `Radio`/Selectors, `ToggleGroup`, portal `Menu`/`Modal`/
  `Popover`/`Select`): either a dotted-sub-component case (like `Breadcrumb.Root`/
  `Select.Trigger`) OR keep in `NON_RENDERABLE_KIT_EXPORTS` (floor). Default to floor unless
  usage justifies the sub-component work.
- **No-twin:** explicit floor, listed so it's a known gap, not a silent miss.

### 1c. Fix the cross-generation mislabel hole
Remove or tightly scope `SET_NAME_TO_KIT["Button"]` (and audit the other generic non-icon
name entries — `Avatar`, `Images`) so a non-Arcade set named "Button" is NOT emitted as an
arcade-gen Button. Key-tier matching is unaffected (certain); only the loose name-tier is
the risk.

## Workstream 2 — Explicit hand-roll notification

Promote the coverage summary from console into the **user-facing trailer**, framed as
transferability. Deterministic, from existing counters — no new judgment:

> **Recognised N Arcade design-system components.** M elements were rendered as static
> pixels (not design-system, won't transfer to production): [top unmatched sets]. Layout is
> always hand-built.

- **"Bar the layout" is satisfied by construction:** only `INSTANCE` nodes count toward the
  M list — raw frames/text/containers (layout) are never reported. An unmatched INSTANCE is
  a component the designer deliberately placed, so reporting it is honest, not a guess.
- Icons are excluded from the "static pixels" alarm (they map or fall to faithful SVG,
  which renders fine) — report component-class unmatched sets, using the existing
  `unmatchedSets` grouping.
- This is the missing feedback loop: it tells the truth about transferability, makes "use
  ADS" concrete, and rewards Arcade usage — without nagging or blocking.

## Explicitly dropped (per two adversarial reviews)

- **"Arcade recall %" bar** — circular/low-information (an unmapped Arcade set is invisible
  to the denominator; trends to ~100% by construction). Keep the descriptive composition
  line only.
- **`sync-ads-mapping` auto-enumerate** — blocked: `list-file-components` returns component
  keys, not set keys; can't auto-diff against `SET_KEY_TO_KIT`. Harvest is 1a.
- **"Un-recognisable leaves" bucket** — noise (dominated by legitimate text/labels);
  reintroduces the "what should have been a component" guess. Workstream 2 counts only
  instances instead.
- **Floor-hardening (Piece 2 of the prior draft)** — deferred until the notification
  quantifies what the floor actually mishandles; measure before hardening.
- **DLS → arcade-gen mapping** — gated on Konstantin's arcade↔DLS token migration; a
  dual-target Studio is a fast-follow, not this spec.

## Scope (files)

| File | Change |
|---|---|
| `server/figma/kitMappings.ts` | add harvested Arcade `[0.3]` set keys; fix/scope `SET_NAME_TO_KIT["Button"]`; route compounds to `NON_RENDERABLE_KIT_EXPORTS` or sub-component |
| `server/figma/kitEmit.ts` | new `emit()` cases + variant maps per added twin |
| `server/figma/kitEmitBranch.ts` | promote `formatCoverage` into the user trailer (transferability framing) |
| `__tests__/server/figma/*` | new twins recognise+emit (live-tree fixtures); a non-Arcade "Button" is NOT mapped; trailer line; compounds don't reach bare JSX |

## Tests

- Each new Arcade `[0.3]` key recognises its instances AND emits the real component (not a
  backed-out div) — fixtures from the live nav tree.
- A non-Arcade set named "Button" stays faithful markup (mislabel guard).
- Compound twins never emitted as bare `<X/>` (white-screen guard).
- Notification lists unmatched component sets, excludes layout/text, excludes icons.
- Full suite green (`pnpm run studio:test`).

## Manual acceptance

- Re-run a real mixed screen: Arcade components render as real arcade-gen; unmatched
  components render pixel-faithful; trailer honestly names what stayed static.
- Confirm a deprecated/DLS "Button" is NOT silently upgraded to an arcade-gen Button.

## Open questions (for the plan)

1. **Task 0:** does `get-nodes` over the ADS `[0.3]` sets yield the published *set* keys
   (via components→componentSetId)? If not, harvest falls back to the plugin bridge.
2. Which compounds earn dotted-sub-component emit cases vs stay floor — decide from the
   `unmatchedSets` usage data, not up front.
