# Lift Manifest — PR 6 revision after live-run validation

**Status:** plan
**Supersedes:** the PR 6 scope in
[2026-05-11-lift-manifest-rules-over-tables.md](2026-05-11-lift-manifest-rules-over-tables.md)
("Token patch table").
**Prerequisite:** PRs 1–5 of that plan are landed.

## Why revise

The original PR 6 was a single-task item: add a token patch table for the
`--surface-overlay` → `--bg-surface-overlay` migration window. Two live lift
validations (against `01-skills-gallery` and `02-skill-modal`) now surfaced a
broader set of concrete gaps that PR 6 can address together with better
leverage than the token table alone.

All four items below are grounded in specific agent behaviors from the
validation runs — not speculation.

## Observed behaviors (evidence)

Signals from `tmp/lift-experiment-v2/skills-gallery.tsx` and
`tmp/lift-experiment-v2/skill-modal.tsx`:

1. **Avatar `displayName` hallucination** (run 2). The manifest's Avatar
   slot note says *"Prop names usually match; treat non-trivial prop
   differences as the reviewer's decision."* The agent read that as license
   to guess a prop name pattern from other DS libraries — it invented
   `displayName` where production uses `name`. The code is broken; the
   agent self-flagged the uncertainty in its summary but still shipped it.
2. **Icon `color` prop unrepresentable** (run 1). Studio passes
   `color="#2563eb"` or `color="var(--fg-neutral-subtle)"` to icons.
   Production `<Icon>` does not accept `color`. The `icon_convention` is
   silent on this. Two TODOs got left on run 1 for this reason.
3. **`Chip.appearance` dropped silently** (both runs). Studio's Tag has
   `intent` + `appearance="tinted"`. Mapping maps `intent → variant` but
   says nothing about `appearance`. Agent dropped it silently both times.
4. **Tailwind utility class drift** (both runs). `rounded-square-x2` and
   `rounded-square` passed through verbatim. Devrev-web's Tailwind config
   likely doesn't resolve them — the agent had no signal to check because
   `<tokens alignment="aligned">` only promises CSS custom properties
   carry across.
5. **Hand-rolled overlay → Modal** (run 2). The skill-modal frame is
   visually a dialog. Studio's generator authored the overlay with raw
   divs (no `Modal` composite in arcade). Production has `Modal` in
   raw-design-system. The agent noted the possibility, then shipped the
   raw divs — correct per instructions, wrong per design intent.
6. **Judgment overcounting** (run 2). A single judgment entry with N call
   sites gets `N × 2` decision-points in the metric (1 per call site for
   the judgment tag, 1 for the n/a tag). The agent produces `1 × 1` TODO
   regardless of call-site count. Metric overcounts judgment, so PR-gate
   thresholds are noisy.

## What the revised PR 6 changes

Four independent sub-PRs, each small. Keep the original token-patch scope
as 6a; add 6b–6d based on the findings above.

### 6a. Token patch table (original scope, unchanged)

Still useful, still load-bearing during the token-unification migration.
Exact behavior documented in the 2026-05-11 doc, section *"Self-sunsetting
token patches"*. No revision.

One small addition from run findings: the patch table should also carry
**Tailwind utility class patches**. `rounded-square-x2` → `rounded-lg`,
`rounded-square` → `rounded-md`, and any others surfaced by
`arcade-gen`. Same `sunset_if_absent_from` mechanism. Rendered as
`<class_patch studio="rounded-square-x2" production="rounded-lg"/>` inside
the existing `<tokens>` block when at least one patch applies to the
current frame.

### 6b. Prop-coverage enforcement

**The problem:** mapping entries that cover some Studio props and leave
others unspoken invite the agent to guess. Today the only contract is
"`propDeltas` describes translations" — silent props fall through with no
signal.

**The change:** every `MappingEntry` declares its prop handling
explicitly.

```ts
export interface MappingEntry {
  // ... existing fields
  /**
   * Studio props the mapping knows about. Props NOT in this list that
   * the source frame actually uses get a per-call-site TODO injected
   * during render. Prevents the "invent a name that pattern-matches DS
   * conventions" failure mode (Avatar.displayName hallucination, run 2).
   */
  knownStudioProps: string[];
}
```

`propDeltas` stays. `knownStudioProps` is the broader set: everything the
mapping's author has considered. A delta has `from` in `knownStudioProps`;
so does an identity pass-through the author deliberately kept. Silence is
the signal that the author never thought about that prop.

**Render behavior:** when the renderer sees a studio import, it has no
visibility into the frame's JSX props (we don't parse JSX). So the guard
is enforced at the mapping-table level: a lint test asserts that every
prop referenced anywhere in the Studio frame source files (scan with a
regex for `<Tag ` + prop names) is covered by the mapping for `Tag`. The
lint flags new props the mapping author hasn't triaged.

**Scope:** populate `knownStudioProps` for the three mappings where
coverage matters today: `Avatar` (size, name, image, status, context,
shape), `Tag → Chip` (intent, appearance, children — `appearance`
explicitly acknowledged as "dropped, no production equivalent"), and
`Button`/`IconButton` (already well-covered; adding the list is cheap).

### 6c. Icon `color` convention + anchor mapping

**The problem:** Studio icons accept `color`. Production icons don't.
`icon_convention` is silent.

**The change:** append to `ICON_CONVENTION.lookup`:

> If the Studio call site passes `color` to the icon, do NOT forward it
> to the production `<Icon>` — production icons inherit color from
> `currentColor`. Set color on a parent element via `style` or a Tailwind
> text-color utility, or surface to the reviewer if the Studio value is
> a raw hex (non-token) that doesn't have a clear production equivalent.

Plus one anchor example:

> `<LightingBolt color="var(--fg-neutral-subtle)"/>` →
> `<span style={{ color: "var(--fg-neutral-subtle)" }}><Icon iconType={ICON_TYPES.ACTION_LIGHTNING}/></span>`

Data-only. No code changes beyond a string in `conventions.ts`.

### 6d. Overlay-shape mapping + detection

**The problem:** `02-skill-modal` is visually a dialog; production has
`Modal`; the agent didn't use it because no mapping or convention said to.
Studio's generator won't change — it prefers hand-rolled overlays.

**The change:** new convention block. A fourth convention
(`overlay_convention`) trigger-fires when the frame source contains the
pattern `className=\"fixed inset-0 ...\"` or equivalent full-screen
overlay markup.

```ts
export const OVERLAY_CONVENTION: Convention = {
  tag: "overlay_convention",
  rule:
    "Frames that hand-roll an overlay (fixed inset-0 + backdrop + " +
    "centered card) should be lifted to <Modal> from " +
    "@devrev-web/design-system/shared/raw-design-system, not preserved " +
    "as raw divs.",
  lookup:
    "Modal composes Modal.Content / Modal.Header / Modal.Footer / " +
    "Modal.Close. Map Studio's header row → Modal.Header, the centered " +
    "card body → Modal.Content, the footer row (with action buttons) → " +
    "Modal.Footer, and the close icon → Modal.Close.",
  anchors: [
    // Populate with 1–2 real devrev-web Modal consumers; verify via grep
    // at curation time.
  ],
};
```

Detection: scan the frame source text for
`/className=["'][^"']*\bfixed\b[^"']*\binset-0\b/`. Cheap regex, no JSX
parsing. If it matches, include `OVERLAY_CONVENTION` in `applicableConventions`.

**Scope:** ship the convention + detection + one or two anchor files.

### 6e. Metric: count judgment by entry, not by delta

**The problem:** a single judgment mapping with N call sites inflates
`decisionPoints` linearly with N. An agent reading the manifest sees
one rule, one TODO to leave — but the metric pretends it's N.

**The change:** `computeMetrics` counts each distinct `MappingEntry`
with `translationClass === "judgment"` exactly once — regardless of how
many times it appears in `mappings[]`. Same for `naMappings`. The
`mappings[]` array deduplicates by identity (`findMapping` returns the
same reference for the same import, so the current count already sums
references — dedupe via `new Set(manifest.mappings)`).

This is a one-line change in `metrics.ts` (`new Set(m.mappings)` +
iterate). Baselines for `settings-list` and `list-view` may drop by 1–2.
Lock the new baselines.

## Non-goals for PR 6

- **Origin annotations** (the other "PR 7" item from the original plan).
  Still worthwhile, still pure hygiene, still no coupling to the live
  findings. Keep as its own small PR 7.
- **Auto-generating mapping entries from arcade-gen source.** Out of
  scope. The default-mapping-convention already absorbs the steady-state
  case.
- **Parsing JSX to enforce prop coverage at the call-site level.**
  Regex-based mapping-table lint is enough for the cases we care about
  (Avatar, Tag, Button).
- **Running the live lifts as a PR gate.** The cost/latency/variance is
  wrong for CI. Keep them as manual validation after major PRs.

## Rollout

Order matters because 6e changes the metric baseline. Order:

1. **6e first** — dedupe judgment counting. Re-lock baselines.
   Everything after this runs against the corrected metric.
2. **6c** (icon color) — tiny, string-only.
3. **6b** (prop coverage + lint) — the biggest correctness win; catches
   the Avatar hallucination class of bug before it reaches a lift.
4. **6a** (token + utility class patches) — touches render + tokens; low
   risk.
5. **6d** (overlay convention) — unfamiliar detection path, so last. If
   the regex misfires on a frame that isn't really a modal, the worst
   case is a harmless extra convention block — easy to tune.

Each sub-PR re-runs the fixture lift loop and holds (or beats) the
post-6e baseline. After all five land, run both validation lifts again
(`01-skills-gallery` and `02-skill-modal`) and diff against the
`tmp/lift-experiment-v2/` files on disk. Expected concrete wins:

- `skills-gallery.tsx` run: 5 TODOs → 3 (two icon `color` TODOs absorbed
  by 6c; tailwind utility classes corrected by 6a).
- `skill-modal.tsx` run: 2 TODOs → 1 (Avatar `displayName`
  hallucination caught by 6b lint before render; overlay composed from
  `Modal` via 6d; `Link` still unmapped).

## What we intentionally leave unfixed

- **`Link`** stays unmapped. Agents on both runs correctly flagged it;
  the default-mapping-convention caught the dead-end. Proper fix belongs
  in a mapping entry, but nobody's proposed the production target yet
  (agent guessed `Button variant="tertiary" unsafeMutation="proxy-link"`,
  which is a reviewer call). Wait for a DS team decision before
  codifying.
- **`FrameLink`** stays judgment+n/a. It's honestly a reviewer decision —
  react-router Link vs. button onClick depends on the host app's routing
  policy, which the manifest shouldn't assume.
- **Metric undercounting vs. reality (run 1).** Two TODOs the metric
  doesn't see because it can't read JSX (`color`, `appearance`). 6b
  and 6c address the root causes; the metric stays noisy but not wrong
  in direction.
