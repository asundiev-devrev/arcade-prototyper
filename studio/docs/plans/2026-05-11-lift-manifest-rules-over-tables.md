# Lift Manifest — rules + anchors + discovery

**Status:** plan, not yet executed
**Supersedes in part:** [2026-05-05-lift-manifest-followups.md](2026-05-05-lift-manifest-followups.md) items #4 and #5 (still open there)
**Trigger:** hand-lifted `01-skills-gallery` into devrev-web on 2026-05-11 and
observed 10 distinct failure modes in the current manifest.

## The problem

Today's manifest is built around a **curated lookup table**: primitives.ts +
composites.ts enumerate every known Studio→production mapping, and anything
outside the table emits as `<unmapped/>` with *"surface to reviewer."*

Two forces break this model:

1. **Accuracy decays silently.** One `propDelta` note ("A Studio frame never
   uses sm") was flatly wrong for the first real lift — the rule outlived the
   reality it described. Tokens claim `alignment="aligned"` while
   `--surface-overlay` is actually `--bg-surface-overlay` in production today.
2. **The target system grows.** arcade-gen adds new icons, new primitives,
   new composites. devrev-web does the same. Every addition becomes a
   maintenance debt on the mapping table, and a gap the agent can't bridge.

The live lift exposed both: 7 of 9 imports in the sample frame were icons,
all marked `<unmapped/>`. A curated icon table would close that gap — and
go stale the week arcade-gen ships a new icon set.

## The shift

Change what the manifest is responsible for. Instead of an exhaustive
**lookup table**, the manifest teaches **conventions** (how Studio primitives
map to production patterns) and includes **anchors** (a few examples to
ground the agent), then delegates **discovery** to the agent at lift time.

The agent is already sitting inside devrev-web with grep and Read. It can
find the production equivalent of an unknown icon name faster than a human
can update a table.

### Rule of thumb for adding an entry

> Would a thoughtful agent with grep, the conventions section, and a prior-art
> anchor get this wrong?

If no — don't add it. Entries exist only when the mapping can't be inferred
from the conventions. This keeps the table small and self-limiting.

## Architecture

Three content types in the manifest, in order of preference:

### 1. Conventions (flexible, ~10 entries, rare updates)

How classes of Studio primitives map to production patterns, stated as
rules the agent can apply to anything it hasn't seen before.

```xml
<icon_convention>
  <rule>arcade icons translate to &lt;Icon iconType={ICON_TYPES.X} size="..."/&gt;
  from '@devrev-web/shared/ui-icons'.</rule>
  <lookup>ICON_TYPES is defined in libs/shared/ui-icons/src/icon/types.ts.
  For each arcade icon in this frame, grep that enum for the closest semantic
  match. If no close match, surface to reviewer.</lookup>
  <anchors>Bell → NOTIFICATION, TrashBin → DELETE, PlusSmall → BASE_ADD</anchors>
</icon_convention>
```

Conventions don't enumerate; they teach. New icons in arcade-gen don't
invalidate the convention — the agent grep-resolves them at lift time.

Initial conventions to carry:
- `<icon_convention>` — arcade icons → `Icon + ICON_TYPES`
- `<chrome_convention>` — `NavSidebar`/`TitleBar`/`AppShell` are app-shell
  concerns, drop at the page boundary, reconcile sidebar data with the
  router-level `Nav`
- `<default_mapping_convention>` — for any `<unmapped/>` arcade primitive,
  the default assumption is that the same symbol exists in
  `@devrev-web/design-system/shared/raw-design-system`. Verify with grep;
  if absent, surface to reviewer. (Replaces today's cold-path
  "surface to reviewer" response with a warm path that succeeds most of
  the time.)

### 2. Anchors (a handful per area, stable pointers)

Real paths in the target repo that show the production pattern in use. Not
authoritative data the manifest owns — just *"go read this file."*

```xml
<prior_art>
  <example path="libs/settings/feature/computer-settings/src/pages/preferences/preferences-page.tsx"
           covers="SettingsPage, Breadcrumbs, Icon conventions"/>
</prior_art>
```

The agent directive: *"When a mapping has `<prior_art>`, read the first
example before writing the output."*

Anchors fail loud: the specifier-existence test (Tier 4.1 in the prior
analysis, kept) catches dead paths. Curate 1–3 per composite mapping. One
path answers more questions than a paragraph of prose.

### 3. Mappings (specific, only when rules don't cover it)

Reserved for cases where the convention + grep can't get the right answer:
- shape changes that the agent couldn't infer (e.g., Studio's `SettingsPage`
  prop-slots → production's compound subcomponents)
- counterintuitive renames (`Tag` → `Chip`, `Tabs.Trigger` → `Tabs.Item`)
- prop-value mappings that aren't string-identical

Current mapping tables shrink. Icon mappings disappear entirely. Composite
mappings that say "same shape, same props" collapse into the default
convention. What's left is the genuinely-structural stuff.

## Resilience infrastructure

Conventions-first reduces the rigidity tax but doesn't eliminate it —
specifier drift, missing anchors, and token migration all still need
visibility. Three mechanisms:

### Drift audit

A script runnable against a reference devrev-web clone:

- For every `<mapping>` entry, resolve the production specifier and confirm
  the named export still exists. Flag breakage.
- For every `<prior_art>` anchor, confirm the file still exists. Flag rot.
- For every `<anchor>` icon example, confirm `ICON_TYPES.X` still exists
  in the enum. Flag typos or renamed icons.
- For every arcade-gen export under `studio/prototype-kit/arcade-components.tsx`,
  confirm there's either a mapping OR a convention that covers it. Flag
  genuine gaps.

Runs weekly in CI against a pinned devrev-web SHA. Files a GitHub issue when
drift is detected. No auto-fix — a human decides — but the silent decay
stops being silent.

### Self-sunsetting token patches

For the current migration window, token renames (`--surface-overlay` →
`--bg-surface-overlay`, `rounded-square-x2` → `rounded-lg`) live in a
dedicated patch table:

```ts
// tokens.ts
export const TOKEN_PATCHES = [
  { studio: "--surface-overlay", production: "--bg-surface-overlay",
    sunset_if_absent_from: "arcade-gen/styles.css" },
  // ...
];
```

The drift audit removes entries whose `studio` side no longer exists in
arcade-gen. Patch table shrinks itself as the migration completes; when
empty, the `<tokens>` element stops rendering (resolves followup #5 in
the 2026-05-05 doc).

### Origin annotations

Every `propDelta` and `slotNote` carries a (non-rendered) `origin` field:

```ts
{ from: "size", to: "size", valueMap: { sm: "S", md: "M", lg: "L" },
  origin: "2026-05-11: corrected after live-lift found sm in source frame" }
```

Not surfaced to the agent — this is hygiene for the humans maintaining
`primitives.ts`. A stale rule is easy to recognize when its origin is a
year old and references a no-longer-live concern.

## Validation: the lift loop

How we measure that the manifest is getting better instead of just
changing shape.

Maintain a small fixture set spanning the real archetypes:

- `list-view` — a VistaPage-shaped frame
- `settings-list` — `01-skills-gallery` (the one that surfaced this plan)
- `settings-form` — a form-shaped settings frame (to be picked)
- `detail` — a detail page with breadcrumbs + content
- `ad-hoc` — something the detector can't classify

For each fixture, define the target output: the lifted file, with every
known correct shape/prop/import. Mark every genuine-reviewer-decision spot
with a `// TODO(lift:reviewer): …` comment.

The metric:

> After each PR, rerun the agent-driven lift against all five fixtures.
> Count the TODOs in the agent's output that do NOT match the expected
> reviewer-decision TODOs. That's the *unnecessary-TODO count* — the thing
> this plan is trying to drive toward zero.

Gate each PR on the count not regressing. Target: after this plan lands,
unnecessary-TODO count < 3 per archetype.

This is a thin fixture set, not a full integration test — but it's the
first time the manifest has a quantitative usability signal.

## Ordering & rollout

Independent PRs, each with a test and a re-run of the lift loop:

1. **Conventions section.** Adds `<icon_convention>`, `<chrome_convention>`,
   `<default_mapping_convention>` to renderer. Populates three anchors
   per convention. Removes the "unmapped — surface to reviewer" fallback
   in favor of the default convention.
2. **Correctness pass on existing mappings.** Fix the Button/IconButton
   `sm` bug, reclassify `SettingsPage` and `Avatar` from mechanical to
   structural, add the missing Breadcrumbs entry, drop identity value
   maps (followup #3 from 2026-05-05).
3. **Shape split: `settings-form` vs `settings-list`.** New detector case,
   right-sized scaffolding for each. Sample frame stops getting form-hook
   scaffolding it doesn't need.
4. **Prior-art anchors on composites.** Each composite mapping gets 1–3
   real devrev-web paths. Renderer emits them inside the mapping.
5. **Drift audit script.** Resolves specifiers and anchors against a
   pinned devrev-web clone; reports orphans and gaps. Wire to weekly CI
   once it's green.
6. **Token patch table.** `tokens.ts` with `sunset_if_absent_from` field;
   renderer emits `<tokens>` only when patches apply to the current frame.
7. **Origin annotations.** Add `origin` field to types; backfill in
   `primitives.ts`/`composites.ts` as a hygiene pass. Not rendered.
8. **Fixture set + lift loop.** Five fixtures, expected outputs, TODO-count
   metric. First run establishes the baseline; subsequent runs gate PRs.

Each step re-runs the lift loop. A step that raises unnecessary-TODO count
goes back to the drawing board.

## Out of scope

- **Rebuilding the primitives table from scratch.** The existing table is
  ~80% right; conventions absorb the icon portion and the correctness pass
  fixes the rest.
- **A token drift detector.** Per-token CSS parsing against live devrev-web
  is overkill. The patch table + sunset field is enough for the migration
  window.
- **Building production composites for Studio primitives that have no
  equivalent** (ChatInput, CanvasPanel, ComputerHeader). These stay as
  `judgment` entries; the manifest's job is to say *"no mapping — decide,"*
  not to invent one.
- **AST-based import parsing.** The current regex handles the generator's
  output reliably; replacing it adds a dependency without solving any
  observed bug.
