# Lift Loop — baseline

Running log of per-archetype decision-point counts across the PRs in
[../../../../docs/plans/2026-05-11-lift-manifest-rules-over-tables.md](../../../../docs/plans/2026-05-11-lift-manifest-rules-over-tables.md).
Each row is what the manifest produces against the five archetype fixtures
under [this directory](.).

The metric is documented in [studio/src/lift/metrics.ts](../../../src/lift/metrics.ts).
Each bucket counts a class of "decision point" — something the downstream
agent has to stop and resolve before it can finish the lift. Lower total = less
work left on the reviewer's plate.

| Archetype      | Pre-PR8 | After PR2 | After PR1 | After PR3 | After PR4 | After PR5 | After PR6e |
|----------------|---------|-----------|-----------|-----------|-----------|-----------|------------|
| list-view      | 4       | 4         | 1         | 1         | 1         | 4         | **2**      |
| settings-list  | 11      | 10        | 3         | 3         | 3         | 3         | **2**      |
| settings-form  | 0       | 0         | 0         | 0         | 0         | 2         | **1**      |
| detail         | 2       | 2         | 0         | 0         | 0         | 0         | 0          |
| ad-hoc         | 1       | 1         | 0         | 0         | 0         | 0         | 0          |
| **total**      | **18**  | **17**    | **4**     | **4**     | **4**     | **9**     | **5**      |

PR 5's increase is an accounting correction, not a regression. Four
mapping entries previously pointed at exports that don't exist in
devrev-web (VistaRow→Row, VistaPagination→Pagination, VistaGroupRail→
GroupRail, SettingsRow→SettingsRow). The pre-PR5 decision-point count
undercounted reality because those "mechanical" mappings were lies.
Post-PR5, they're honestly flagged as judgment+n/a.

(PR 3 was a scaffolding split — no metric change expected, and none observed.
The `settings-list` fixture is now classified as `settings-list` instead of
`settings-form`, so its scaffolding checklist drops the form hook + mutation
hook that weren't relevant.)

### Per-bucket, current (after PR1)

| Archetype      | decisionPoints | unmapped | judgment | naMappings | iconsAbsorbed |
|----------------|----------------|----------|----------|------------|---------------|
| list-view      | 1              | 0        | 1        | 0          | 3             |
| settings-list  | 3              | 1        | 1        | 1          | 7             |
| settings-form  | 0              | 0        | 0        | 0          | 0             |
| detail         | 0              | 0        | 0        | 0          | 2             |
| ad-hoc         | 0              | 0        | 0        | 0          | 1             |

`iconsAbsorbed` is informational — those imports are routed through the
`icon_convention` instead of being flagged. Total 13 icons across the
fixture set, all silent now.

## What the numbers say

- **Icons dominate.** `settings-list` has 9 unmapped and `list-view` has 3;
  both are primarily icon imports. PR 1 (conventions section) is expected
  to zero these out entirely by teaching the agent to resolve arcade icons
  against `ICON_TYPES` instead of flagging each one.
- **`settings-form` is already clean.** It uses only Input/Select/Checkbox/Button
  and composites (`SettingsPage`, `SettingsCard`, `SettingsRow`) that already
  have mechanical mappings. Good sanity floor — any PR that raises this fixture's
  count introduced a regression.
- **`ad-hoc` at 1.** Just `CrossSmall` (an icon). Also resolves once conventions land.

## Per-PR log

- **PR 2 (correctness pass).** Fixed incorrect notes (Button `sm` mapping,
  Avatar size tokens, SettingsPage reclassification) and added the missing
  `Breadcrumb` mapping. `settings-list` dropped 11 → 10 as Breadcrumb moved
  from unmapped to structural. Other fixtures unchanged.
- **PR 1 (conventions section).** Icons routed through the icon_convention
  instead of being flagged unmapped. 13 icons absorbed across the fixture
  set; total decision points dropped 17 → 4. Every archetype now sits at
  or below the plan's "< 3 per archetype" target. The 4 remaining points
  are all genuinely structural (VistaRow + FrameLink + Link component).
- **PR 3 (shape split).** Added `settings-list` as a FrameShape distinct
  from `settings-form`. Detection: `SettingsPage` + form-input primitive
  → `settings-form`; `SettingsPage` without form inputs → `settings-list`.
  Scaffolding for `settings-list` is list-query + adapter + query-keys
  + stale-time + route + flag + tracker — no mutation hook, no form hook.
  Metric unchanged, as expected.
- **PR 4 (prior-art anchors).** Added `priorArt: PriorArtEntry[]` to
  `MappingEntry`. Populated on the four highest-leverage structural
  entries — `SettingsPage`, `VistaPage`, `NavSidebar`, `Breadcrumb` —
  pointing at real files under `libs/` in devrev-web. Renderer emits
  `<prior_art><example path=... covers=.../></prior_art>` inside each
  `<mapping>` that has entries. Agent directive now tells the reader to
  open the first example before writing code. Metric unchanged (as
  expected — prior-art is information added to already-counted mappings).
- **PR 5 (drift audit).** New `src/lift/drift.ts` + `pnpm run studio:audit`
  script that compares every mapping against a local devrev-web clone.
  Caught five real bugs in the mapping table: `Tabs→TabList` (actual
  export is `Tabs`), four mappings pointing at exports that never existed
  (`VistaRow→Row`, `VistaPagination→Pagination`, `VistaGroupRail→GroupRail`,
  `SettingsRow→SettingsRow`). Tabs got corrected; the rest reclassified
  to judgment+n/a with notes pointing the reviewer at prior art. Also
  collapsed `TitleBar→Page.Header` / `PageBody→Page.Content` / `VistaHeader→
  ListViewPage.Header` / `VistaToolbar→ListViewPage.Toolbar` to the base
  exports, with subcomponent info moved to slot notes. Metric went up by
  5 — but that's an honest count after catching a systemic lie in the
  prior data.
- **PR 6e (metric dedup).** One-line correction to `computeMetrics` —
  an entry that is both `judgment` AND `production.source="n/a"` now
  counts as ONE reviewer decision, not two. Matches the agent's actual
  behavior (one TODO per entry regardless of bucket fires). Validated
  against both live-run TODO counts:
  - `settings-list` fixture reports 2; agent left 2 TODOs. Exact match.
  - Per-bucket breakdown (judgment/naMappings) is unchanged so
    diagnostic visibility stays.
- **PR 6c (icon color guidance).** Extended the icon_convention's
  `lookup` text to tell the agent: Studio icons take a `color` prop,
  production <Icon> does not, wrap the icon in a parent whose text
  color inherits. Added one anchor demonstrating the pattern. String-
  only change; metric unchanged, as expected. Regression guard test
  asserts the guidance stays in convention text. Addresses the silent-
  drop of `color` surfaced by both 2026-05-12 live-lift runs.
- **PR 6a (token + class patches).** New `src/lift/tokens.ts` with
  `TOKEN_PATCHES` (CSS custom properties) and `CLASS_PATCHES` (Tailwind
  utilities). Each entry carries `sunset_if_absent_from` pointing at
  an arcade-gen stylesheet; the drift audit flags entries whose `studio`
  side no longer exists there. Renderer emits `<tokens alignment="patching">`
  ONLY when patches match the current frame source — the old universal
  `<tokens alignment="aligned">` filler is gone. Three initial patches:
  `--surface-overlay → --bg-surface-overlay`, `rounded-square-x2 →
  rounded-lg`, `rounded-square → rounded-md`. All three fire against
  the real 01-skills-gallery source and were bugs in both live-lift
  validation runs. Metric unchanged.
- **PR 6b (prop-coverage lint + dropped_props rendering).** `MappingEntry`
  gained two optional fields: `knownStudioProps` (a whitelist for the
  coverage lint) and `droppedStudioProps` (props without production
  equivalent, surfaced to the agent). New `propCoverage.test.ts` scans
  every .tsx under fixtures + loop-fixtures and fails if a mapping
  declares `knownStudioProps` but a used prop isn't covered. Catches
  the Avatar `displayName` hallucination class of bug — the lint gives
  the agent a guardrail BEFORE a lift, not a post-lift review. Initial
  coverage populated on Avatar, Tag, Button, IconButton. Two regression
  guards lock in the specific bugs: Avatar lists `name` (not
  displayName); Tag explicitly declares `appearance` as dropped.
  Renderer emits `<dropped_props><prop name=...>{reason}</prop></dropped_props>`
  inside affected mappings; agent directive tells the downstream to drop
  them with a TODO. Verified against real 01-skills-gallery source: the
  Tag mapping now carries `<prop name="appearance">` + `<prop name="icon">`
  with rationale. Metric unchanged (as PR 6 scope called out).
- **PR 6d (overlay convention).** New `OVERLAY_CONVENTION` fires when the
  frame source contains hand-rolled overlay markup (`className` with both
  `fixed` and `inset-0`). Tells the agent to lift to production `<Modal>`
  instead of preserving raw divs. Includes the full Modal compound-
  subcomponent shape (Modal → Modal.Content → Modal.Header →
  Modal.Header.Title / Actions / Description, Modal.Body, Modal.Footer)
  verified against devrev-web's modal.spec.tsx, plus prior-art pointer
  at switch-plan-confirm-dialog.tsx. Detection verified against the real
  02-skill-modal source — manifest now emits the convention block and
  the live-run "kept as raw markup" failure mode is closed. 5 new tests
  for the regex guard (quote variants, token-order insensitivity,
  negative cases). Metric unchanged.
- **PR 7 (pending).** Origin annotations. Pure hygiene.

## 2026-05-12 — First real typecheck against devrev-web

Ran `nx run agent-platform-feature-customize-computer:typecheck-strict` with the v3 lifted files dropped into `libs/agent-platform/feature/customize-computer/src/pages/`.

**Result: 1 error across 728 lines of lifted code (0 in skill-modal, 1 in skills-gallery).**

The one error — [`__lift_v3_skills_gallery.tsx:158`](file:///Users/andrey.sundiev/devrev-web/libs/agent-platform/feature/customize-computer/src/pages/__lift_v3_skills_gallery.tsx#L158):

```
TS2322: Type 'Dispatch<SetStateAction<string>>' is not assignable
to type '(value?: string | undefined) => void'.
```

The agent wrote `<Tabs value={activeTab} onValueChange={setActiveTab}>`. Tabs' `onValueChange` arg is typed `string | undefined`; a plain `useState<string>` setter won't accept that. Fix shape: `onValueChange={(v) => setActiveTab(v ?? "")}`.

**Classification: manifest was silent.** The Tabs mapping's slot-note said "controlled: `value` + `onValueChange`" but didn't flag the optional-arg quirk. Worth addressing in the next revision pass (bundle with the other known gaps — user chose not to ship a 0.16.2 for one finding).

**What got validated:** every other manifest claim the previous session flagged as speculative — `Breadcrumbs.Item href=` (polymorphic), `<Toggle initialChecked/>`, `<Modal size="480">`, `Avatar size="16"`, `Chip variant="neutral"`, `SettingsPage.Header.*` compound shape, `ICON_TYPES.*` enum references — all compile clean. Token patches (`rounded-square-x2 → rounded-lg`, `--surface-overlay → --bg-surface-overlay`) produce valid CSS/utility classes.

Plan target from the doc: *"unnecessary-TODO count < 3 per archetype"*.
All five fixtures now meet it. settings-list is at the ceiling (3), carried
entirely by genuine reviewer calls.

## How to refresh this file

If a PR legitimately changes the numbers (new mappings, new conventions), run:

```sh
UPDATE_LIFT_LOOP=1 pnpm run studio:test liftLoop
```

Then update this table so the doc matches the `expected.json` files.
