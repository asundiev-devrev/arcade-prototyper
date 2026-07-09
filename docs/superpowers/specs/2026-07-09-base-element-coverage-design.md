# Base-element coverage — recognise every primitive, hand-roll honestly, never mislabel

**Date:** 2026-07-09
**Status:** draft for adversarial review
**Branch:** TBD (sibling of `feat/figma-fidelity-eject`)

## The goal, restated as a metric

Arcade Studio's reason to exist is not "generate a screen from Figma" (designers can
do that elsewhere) — it's **prototypes that translate to production code.** From that
lens, the success metric is not pixel-match. It is:

> **Base-element coverage** — of the base UI elements in a generated frame (button,
> avatar, tag, badge, input, select, checkbox, switch, icon-button, icon), what
> fraction render as *real arcade-gen primitives* vs hand-rolled `<div>`/`<svg>`.

Layout may be hand-rolled and imperfect — that is an **acceptable sacrifice** (the
owner's explicit position). A hand-rolled base element is the **failure**, because it
is the thing that will not translate to production.

### The precision-over-recall inversion (the core principle)

A hand-rolled div is an *honest gap* — a developer sees it isn't systemised and fixes
it. A **mislabelled** base element (a Chip emitted as a `Tag`, a display field emitted
as an `Input`) is *confidently-wrong production code that gets merged.* Therefore:

> **A wrong component is worse than an honest div.** Recognition must be
> precision-first: recognise with certainty, hand-roll honestly, never guess.

This is the axis every decision below is judged on. It also matches the pixel-floor
principle already in the codebase (never lose a painted visual; bind only as
enhancement) — extended from *visual* to *identity*.

## What already exists (verified in code, 2026-07-09)

- `server/figma/kitMappings.ts` — the import recognition table. Three tiers inside
  `matchKit(setKey, setName)`, checked in order: (1) `SET_KEY_TO_KIT` published
  component-set key, (2) `ICON_SET_NAME_TO_KIT` icon set name, (3) `SET_NAME_TO_KIT`
  non-icon set name. Unmatched → faithful static markup.
- `src/export/figma/componentEntries.ts` — the *export* table (code→Figma). It uses
  the **same published keys** as the import table. **These are two hand-maintained
  copies of one ~15-primitive library snapshot** — so "auto-derive the import table by
  inverting the export table" is a **non-starter for coverage** (they already carry the
  same keys). It only helps *drift* (see Follow-ups).
- `kitEmit.ts` gates every match on `n.type === "INSTANCE"` (identity comes from
  `componentId` resolved through the REST payload's `components`/`componentSets` maps).
  It **recurses into** unmapped `GROUP`/`INSTANCE`/`FRAME`/`COMPONENT` nodes with
  children (line ~750), so an unmapped composite container still has its inner base
  elements matched.
- A per-run coverage log already exists (`matchedInstances`, "top-unmatched sets").
- `NON_RENDERABLE_KIT_EXPORTS` guard prevents emitting compound namespace objects
  (`Sidebar`, `Modal`, `Select`…) as bare elements (they white-screen the frame).

## The actual ceiling (verified, not assumed)

Recognition requires **a component instance whose identity is in the table.** Three
things therefore never become primitives, and this is the real coverage tail:

1. **Fully-detached / drawn elements** — a "button" built from a rectangle + text, or
   an exploded instance. **No `componentId` at all → no key AND no name.** The
   name-tier cannot save these (the code comment's "detached copies keep the name"
   refers to *local/unpublished instances*, which still carry a `componentId` → set
   name; a truly exploded frame carries neither).
2. **Local/unpublished instances** whose set *name* matches a primitive but whose key
   isn't the published one — caught by tiers 2–3 **only if the exact name string is
   listed.** Naming drift ("Icons / Plus" vs "Icons/Plus") misses.
3. **Instances of non-primitive components** — out of scope by design (owner: base
   primitives only; composites stay hand-rolled layout).

The ~15 base primitives are *already* in the table by key. So for a designer who uses
the **published library**, gold-path coverage is likely already high — the "41%"
headline on the nav test is misleading because its denominator counted **composite
sub-parts** (`_Item ×6`, `_Group Label ×4`) that are **not base primitives** and
should not count against base-element coverage.

## Design

Three pieces. Piece 1 is the keystone (it makes the KPI real and honest); pieces 2–3
lift the numerator without ever risking a mislabel.

### Piece 1 — Base-element coverage report (deterministic, the keystone)

Make the KPI real, measured, and surfaced. This is the narrowly-scoped, deterministic
version of the "fidelity metric" that was killed twice — it dodges both prior killers:
it does **not** diff against Figma pixels (composite tree-expansion trap) and it does
**not** use a vision judge (subjectivity trap). It counts identities we already resolve.

**Honest about the denominator.** "What *should* have been a component" is itself the
recognition problem — you cannot deterministically know a drawn rectangle "should" be a
Button. So the report is a **list, not primarily a percentage**:

- **Recognised base elements** (certain): `[Button ×2, Avatar ×5, Tag ×1, IconButton ×6, …]`
  — instances matched to a base primitive. This is exact.
- **Unmatched instances** (the coverage backlog): `[setName ×count]` for instances that
  resolved to an identity but no primitive mapping — already logged today; now
  surfaced. Distinguishes "unlisted primitive-ish set" (fixable by a row) from
  "genuine composite" via a small non-primitive setName denylist.
- **Un-recognisable leaves** (the honest tail): leaf nodes with **no `componentId`**
  that carry text or a single vector (i.e. *could* be a hand-built primitive) —
  reported as "N elements hand-rolled, not matchable to a system component."

**Surfaced two ways:**
1. **A `### Deviations`-style line in the turn output** — "4 base elements couldn't be
   matched to system components: [list]. They render faithfully but as plain markup."
   Turns silent failure into a visible to-do (matches the existing deviations contract).
2. **Logged to the generation-metrics JSONL** — `{ recognised: {...counts},
   unmatchedSets: [...], unrecognisableLeaves: N }` per Figma-import turn. This is the
   **regression signal**: "did change X raise recognised / lower unmatched?" — the
   thing the keystone memory says is missing, now answerable, deterministically.

A secondary rough `recognisedInstances / allInstances` percentage MAY be logged, but
**explicitly caveated** as denominator-inflated by composites — never shown as *the*
score.

### Piece 2 — Widen the reliable tiers (precision-safe recall)

Lift the numerator only through signals that stay certain:

- **Name normalisation for tiers 2–3.** Match set names case-insensitively and
  tolerant of separator/spacing drift ("Icons / Plus" ≡ "Icons/Plus" ≡ "icons/plus").
  This is still a *name* match (reliable), just not brittle to punctuation. Pure win,
  no precision cost.
- **Keep the key tier (tier 1) as the gold path, unchanged.** It's 100% certain.

Explicitly **not** here: enlarging the primitive set (owner scoped to base primitives),
mapping composites (stays hand-rolled layout).

### Piece 3 — Shape fallback: deferred to advisory-only, never silent

Shape-based guessing (pill+label → Button) is **rejected as a silent classifier** — the
owner's exact concern: chips, tags, inputs, selects look alike on the surface and behave
differently in code, so a shape guess risks the mislabel that violates the core
principle. It survives only in a tightly-bounded form, and **off by default**:

- Only for **unambiguous** shapes with essentially one primitive interpretation (a
  circle whose fill is an image → `Avatar` is near-certain; a pill-with-label is
  **ambiguous → stays a div**).
- When it does fire, it is **always flagged** as a low-confidence deviation ("guessed
  Avatar from shape — verify"), never emitted as a clean unflagged component.
- Ambiguity is resolved toward the **div** (honest gap), never toward a guess.

Recommendation: **do not build shape-matching in this pass.** Ship pieces 1–2, let the
coverage report quantify how much of the real tail is un-recognisable leaves, and only
then decide if the flagged-Avatar-only case earns its complexity.

## Why this scales to infinite designs

Coverage stops being "how many screens we pre-mapped" and becomes "how well we recognise
base primitives with certainty" — a fixed ~15-element target, plus a measured, honest
account of what we couldn't recognise. The report makes every future change measurable
and every gap visible, without ever emitting production code that lies about identity.

## Scope (files)

| File | Change |
|---|---|
| `server/figma/coverageReport.ts` | **new** — build the recognised / unmatched / un-recognisable report from the plan the emitter already walks |
| `server/figma/kitMappings.ts` | name normalisation in `matchKit`; small non-primitive setName denylist for the backlog split |
| `server/figma/kitEmit.ts` | collect the three buckets during the existing tree walk; emit the report |
| `server/figma/kitEmitBranch.ts` | surface the deviations line; write the metrics row |
| `server/metrics.ts` | extend the turn metric with coverage fields |
| `__tests__/server/figma/*` | fixtures: recognised counts, unmatched split, un-recognisable leaves, name-normalisation matches, denominator caveat |

## Tests

- `matchKit` name normalisation: "Icons / Plus" and "icons/plus" both resolve; a
  non-primitive name does not.
- Coverage report on a fixture tree: correct recognised counts; unmatched split
  (unlisted-set vs composite); un-recognisable leaf count (no `componentId`, has
  text/vector).
- Deviations line renders only when there are unmatched/un-recognisable elements.
- Metrics row round-trips.
- Composite container inflation is *excluded* from the recognised list (leaf-only).
- Full suite green (`pnpm run studio:test`).

## Manual acceptance

Run the real nav screen (file `JztJjqt3i6uFwB6r4dfewz`, node `328-14859`):
- Recognised list names the real primitives (buttons, avatars, tags, icon-buttons, send).
- Composite sidebar rows appear in *unmatched*, not counted against base coverage.
- Any hand-built element appears in un-recognisable leaves with an honest count.
- No instance is emitted as the wrong primitive (spot-check the deviations line).

## Follow-ups (explicitly out of scope)

- **Table drift guard.** Since import and export tables hand-duplicate the same keys, a
  test asserting the shared keys agree would catch drift. Not coverage — hygiene.
- **Live library sync.** Auto-refresh the key table from the published library file
  (needs the rename/alias map: Badge≡Counter, Tag≡Chip, Switch≡Toggle). Keeps tier 1
  current as the library grows; does not raise today's ceiling.
- **Upstream nudge.** The genuine coverage tail is designers drawing detached/hand-built
  elements. The honest lever there is partly cultural (use the library), measured by
  Piece 1's un-recognisable-leaf count — not matcher heroics.
```
