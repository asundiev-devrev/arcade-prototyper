# Map what's mappable (Arcade → arcade-gen), pixel-faithful for the rest

**Date:** 2026-07-09 (third rewrite — after establishing the two-generation reality)
**Status:** draft for adversarial review
**Branch:** TBD (sibling of `feat/figma-fidelity-eject`)

## The problem, correctly framed

Designers report Studio prototypes "look broken" (Paulina/Arthur, 2026-07-09). Live
investigation of the flagged nav screen (file `JztJjqt3i6uFwB6r4dfewz`, node `328-14859`)
found 1,121 component instances, only ~3% recognised by Studio's mapping table.

But that 3% is **not** a straightforward bug, and earlier drafts of this spec were wrong
to treat it as one. The real situation, established by inspecting the actual node tree
and the source libraries:

- **DevRev has two LIVE production generations**, not one canonical library:
  - **Arcade** → everything Computer-related. Mirrored in code by `arcade-gen` (a
    code-only prototyping library; **no Figma equivalent** — the ADS file's `[0.3]`
    sets are its design-side counterpart).
  - **DLS** → Apps / SoR products. This is real production, not deprecated.
- **Real screens are always a mixture** (owner: "designers never build screens
  correctly; it's always a mixture"). The flagged screen is mostly **deprecated DLS**
  (angle-bracket sets `<Button>`, `<Chip>` from files literally named "…Deprecated").
- A designer using DLS may be **intentionally correct** — it's what their product ships.

**The consequence that fixes the design:** Studio can only honestly promise
production-translatable code for the target it can emit — `arcade-gen` ≈ the **Arcade**
generation. Mapping a DLS component to arcade-gen would emit code that Apps/SoR
production **cannot use** — worse than a div, because it looks right but targets the
wrong stack. So:

> **Map what we can map (Arcade → arcade-gen). Everything else is bespoke,
> pixel-faithful floor.** Never cross generations.

Low coverage on a DLS-heavy screen is therefore the **correct** answer, not a failure.
The "looks broken" symptom on those screens is a **floor-quality** problem, not a
mapping-coverage problem — a different fix (see Piece 2).

## Precision-first (unchanged, load-bearing)

A wrong component is worse than an honest div — a mislabel is confidently-wrong code that
gets merged. So recognition stays **100%-certain key matching**; unmapped → faithful div,
never a shape-guess and never a cross-generation guess. This is why "map only Arcade" is
right: Arcade→arcade-gen is a true correspondence; DLS→arcade-gen is not.

## What's verified (not assumed)

- Recognition already works the right way: `matchKit(setKey, setName)` matches by
  published key, falls back to faithful markup (`kitMappings.ts`); the emitter recurses
  into unmapped containers so inner mappable leaves are still caught (`kitEmit.ts`).
- `figmanage components list-file-components <fileKey>` enumerates a file's published
  components + keys (verified: ADS returns 5,366 components).
- **The ADS file contains 29 Arcade `[0.3]` component sets. Studio's table maps ~13 of
  them.** The gap is concrete and finite — completing it is enumeration, not one-row-
  at-a-time curation. Missing sets with real arcade-gen twins include: `Banners`→Banner,
  `Split Button`→SplitButton, `Text Area`→TextArea, `Multi/Single Select Field`,
  `Number Field`, `Selectors`(checkbox/radio), `Segmented Control`, `Accordion`,
  `Links`→Link, `Shortcut`→KeyboardShortcut.
- arcade-gen exports 177 components — every base primitive twin exists.
- The engine already computes `matchedInstances` / `totalInstances` / `unmatchedSets`
  and logs them via `formatCoverage` (`kitEmitBranch.ts`).

## Design — three pieces

### Piece 1 — Complete the Arcade `[0.3]` → arcade-gen table (the coverage fix)

1. Enumerate the ADS `[0.3]` generation (29 sets) via `list-file-components`.
2. For each, add its published set key → arcade-gen twin to `SET_KEY_TO_KIT`. Where a set
   is a Radix-portal compound already deliberately omitted (`Menu`, `Modal`, `Popover`,
   `Select` shell — see the existing `NON_RENDERABLE_KIT_EXPORTS` note in kitMappings),
   keep it omitted. Where there is **no** arcade-gen twin, explicitly record "no twin →
   faithful floor" (honest gap).
3. Keep the rename map (Counter≡Badge, Chip≡Tag, Toggle≡Switch) — ADS names ≠ arcade-gen
   names.
4. `scripts/sync-ads-mapping.ts` (**new**) re-runs enumeration and reports Arcade sets
   present in ADS but missing from the table — so drift is caught, not hand-audited.

This only ever adds **Arcade-generation** keys. DLS/deprecated keys are never added.

### Piece 2 — Harden the pixel-faithful floor (the "looks broken" fix for DLS screens)

For DLS/Apps screens the floor is the **majority** path, so its quality IS the fidelity.
"Looks broken" on those screens lives here, not in mapping. Scope of this piece:

- Confirm the floor reproduces the classes that make DLS components look wrong as divs:
  corner radius, borders, fills, icon children, multi-run text. (Investigate against a
  DLS-heavy screen; fix by class, per `feedback_scalable_accuracy` — not per screen.)
- This is investigation-led: enumerate which unmapped-component visual properties the
  floor currently drops, fix that class. Explicitly NOT pixel-diffing against Figma
  (composite tree-expansion trap) and NOT a vision judge (subjectivity trap) — both
  killed in prior reviews.

### Piece 3 — Honest TWO-BAR coverage report (not one misleading %)

A single coverage % is misleading: for a DLS screen, **low is correct**. So report two
independent bars, both deterministic, precision-safe:

- **Arcade recall** — of the Arcade-generation instances present, what fraction did we
  map? Target ~100%. This is the number that must stay high; a drop = a table gap.
- **Composition** — "N mapped to Arcade components · M rendered pixel-faithful (DLS/other/
  deprecated)." Descriptive, not scored. Tells the designer *why* a screen is mostly
  faithful divs (it's a DLS screen) without implying failure.

Surface it by promoting the existing `formatCoverage` line into the kit-emit branch's
user trailer, split into these two bars. **Dropped** (per prior adversarial review):
the "un-recognisable leaves" bucket (noise/subjectivity), the invert-export-table idea
(export table is a superset, not same keys), and any JSONL "regression signal" unless a
reader is added.

Distinguishing Arcade-generation from DLS/other for the two-bar split: by **source
library** (which file/library key a set belongs to), enumerated once — NOT by name
(generation is not readable from the set name; only the deprecated angle-bracket sets are
name-obvious).

### Piece 3b — Icon-tier name normalisation (safe recall, unchanged from prior draft)

Normalise separator/case drift for the **icon** name-tier only ("Icons / Plus" ≡
"Icons/Plus"). Do NOT loosen the generic non-icon `SET_NAME_TO_KIT` tier (holds `Button`,
`Avatar`, `Images` — case-insensitive there risks mislabelling an arbitrarily-named
frame).

## Why this scales

Coverage on Arcade work becomes "how completely we mirror the Arcade generation" — a
finite 29-set target, enumerable, kept current by the sync script. Coverage is *correctly*
partial on DLS/Apps work, and those screens are served by a hardened faithful floor. No
generation crossing, no shape-guessing, no mislabels — ever.

## Explicit non-goals

- **No DLS → arcade-gen mapping.** Gated on the arcade↔DLS token migration Konstantin is
  building; a dual-target Studio is a fast-follow that rides that work, not this spec.
- No shape-based classification (owner-rejected; mislabel risk).
- No pixel-diff / vision-judge fidelity metric (killed by two prior adversarial rounds).

## Scope (files)

| File | Change |
|---|---|
| `server/figma/kitMappings.ts` | add Arcade `[0.3]` keys to `SET_KEY_TO_KIT`; keep rename map; icon-tier name normalisation |
| `scripts/sync-ads-mapping.ts` | **new** — enumerate ADS `[0.3]`, report present-but-unmapped Arcade sets + no-twin list |
| `server/figma/kitEmit.ts` | per-kit count map; tag each unmatched instance's source-library bucket for the two-bar split |
| `server/figma/kitEmitBranch.ts` | promote `formatCoverage` into a two-bar user trailer |
| `__tests__/server/figma/*` | new Arcade keys match (fixture from live tree); two-bar split correct; icon normalisation; no cross-generation map |

## Tests

- New Arcade `[0.3]` keys recognise their instances (live-tree fixtures).
- A DLS/deprecated key is NOT mapped to an arcade-gen component (stays floor).
- Two-bar report: Arcade recall vs composition computed correctly on a mixed fixture.
- Icon-name normalisation matches drift; generic non-icon tier NOT loosened.
- Full suite green (`pnpm run studio:test`).

## Manual acceptance

- Re-run a mixed real screen: Arcade-generation components render as real arcade-gen
  components; DLS/deprecated render pixel-faithful (not mislabelled, not broken-looking
  after Piece 2).
- Trailer shows both bars honestly ("mapped N Arcade · M pixel-faithful").
- `sync-ads-mapping` lists any Arcade `[0.3]` set still unmapped.

## Open questions (for review)

1. **Piece 2 scope.** "Harden the floor" is investigation-led and could balloon. Should
   this spec ship Piece 1 + 3 (the deterministic, bounded coverage work) and spin Piece 2
   into its own investigation once the two-bar report quantifies how much of a DLS screen
   the floor actually mishandles? (Likely yes — measure before hardening.)
2. **Source-library detection** for the two-bar split — is the library key reliably on
   each componentSet in the REST payload, or does it need a second lookup?
3. ADS `[0.3]` set keys — harvest via `list-file-components` (the 29 sets), confirm each
   twin before adding.
```
