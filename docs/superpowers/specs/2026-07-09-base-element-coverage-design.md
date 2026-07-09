# Recognise the library designers actually draw in (ADS → arcade-gen)

**Date:** 2026-07-09 (rewritten after live evidence + adversarial review)
**Status:** draft for review
**Branch:** TBD (sibling of `feat/figma-fidelity-eject`)

## The one finding that reframes everything

Ran the deterministic kit-emit engine's matching against the real nav screen a
designer flagged as "looks broken" (file `JztJjqt3i6uFwB6r4dfewz`, node `328-14859`).
Result, verified live:

- **1,121 real component instances** — the screen is cleanly built, almost nothing
  detached or hand-drawn.
- **Only 34 (3%) match by key. 78% unmatched.**
- The unmatched instances are base primitives: `<Button>`, `<Chip>`, `<Badge>`,
  `<Icon Button>`, `<Text>`, `<Input>`. Their published keys are **different keys** than
  the curated ones (e.g. `<Button>` = `f2c7f80a7cca…`, curated `Button` = `0b87fe4f…`).

**Root cause:** the recognition table (`kitMappings.ts`) was built from the *"Arcade UI
Kit v0.3"* Figma file. But designers draw from the **"Arcade Design System" (ADS)**
file — a different file with different component keys. arcade-gen is a code-only
prototyping library with **no Figma equivalent**, so it was never the right source; the
0.3 kit was a stand-in with the wrong keys. So the components designers actually use go
unrecognised → fall back to hand-rolled divs → "looks broken."

This kills two earlier framings (memories `figma-kit-emit-engine`,
`figma-import-componentization-dial`): coverage was never a "add a row at a time" dial —
it was **pointed at the wrong source file.** It is also NOT the shape-matching route (no
guessing — these are clean instances with certain identity) and NOT a floor gap.

## The reframe

The engine's job — "the brain" — is a mapping between:

> **Arcade Design System (Figma, what designers draw)  →  arcade-gen (code, what
> production translates to).**

Today it's mapped from the wrong Figma file. Re-point it at ADS and recognition should
jump across *every* screen any designer draws, because they all instantiate from that
one shared library. This is the same work that satisfies both goals: it's the **visual
fix** Paulina needs (recognised components render correctly, not as broken divs) AND the
**"keep the brain" / production-handoff** value (mergeable code).

Precision-first is preserved: this stays 100%-certain **key** matching. A wrong
component is worse than an honest div, so unmapped → div, never a guess.

## What's confirmed feasible

- `figmanage components list-file-components <file-key>` exists (verified) → the ADS file
  can be **enumerated programmatically**: every published component + its key. So the
  mapping table can be *generated* from ADS, not hand-typed.
- The matching path itself is unchanged and already correct (`matchKit` by key). We're
  changing **what keys it holds**, not how it matches.

## Design

### Piece 1 — Re-source the recognition table from ADS (the fix)

1. Enumerate ADS published components (`list-file-components <ADS-key>`) → `{key, name}`
   list.
2. For each ADS base component, map its key → the arcade-gen primitive it corresponds to
   (Button→Button, Chip→Tag, Counter→Badge, Toggle→Switch, User Avatar→Avatar,
   Icon Button→IconButton, Text field→Input, …). arcade-gen was built to mirror the
   design system, so the base primitives have twins; components with **no arcade-gen
   equivalent are explicitly marked "→ faithful div"** (honest gap, not a guess).
3. Regenerate `SET_KEY_TO_KIT` from this ADS mapping. Keep the rename map
   (Counter≡Badge, Chip≡Tag, Toggle≡Switch) since ADS names ≠ arcade-gen names.
4. Store the ADS file key as a constant; a small script (`scripts/sync-ads-mapping.ts`)
   re-runs enumeration so the table stays current as ADS grows — one command, not manual
   curation.

**Validation gate (decides whether this works):** after re-sourcing, re-run the nav
screen. Coverage of base primitives should jump from 3% toward near-total. If most ADS
base components turn out to have **no** arcade-gen twin, the reframe relabels the gap
instead of closing it — that's the risk to disprove first, cheaply, before building the
sync tooling. Run the enumeration + a manual key-by-key twin check on ADS base
components as **step 0**.

### Piece 2 — Coverage report (deterministic, precision-safe) — TRIMMED

The prior draft over-built this; adversarial review confirmed ~80% already ships
(`formatCoverage` already counts recognised vs unmatched instances and logs it every
import — `kitEmitBranch.ts`). So Piece 2 is only:

- **Promote the existing `formatCoverage` line into the user-facing trailer**, with the
  unmatched-set backlog: "Recognised 47 design-system components. 6 unmatched: [Card ×13,
  Reaction ×13, …] — rendered as plain markup." Hand-composed into the kit-emit branch's
  own trailer (it controls its trailer directly; this is NOT the LLM deviations
  contract — that's a separate path, don't wire it).
- **Add a per-kit count map** (small new counter; today only a total exists) so the
  recognised line can name what it found.

**Explicitly dropped** (per review — they reintroduce the subjectivity that killed prior
metrics or duplicate existing data):
- ❌ "Un-recognisable leaves" bucket — dominated by ordinary text/labels; it's the
  "what *should* have been a component?" guess in disguise.
- ❌ New "non-primitive setName denylist" — the export table already classifies
  composites by key; reuse it if needed.
- ❌ JSONL "regression signal" framing — the kit-emit path writes no metrics row today
  and nothing reads coverage. Only add a row if we also add a reader; otherwise don't
  call it a signal.

### Piece 3 — Name-tier normalisation — ICON TIER ONLY

Normalise separator/case drift ("Icons / Plus" ≡ "Icons/Plus") **only for the icon
name-tier**, which is safe (icon names are specific). Do **not** loosen the non-icon
`SET_NAME_TO_KIT` tier — it holds generic words (`Button`, `Avatar`, `Images`) where
case-insensitive matching could mislabel an arbitrarily-named frame. (Correcting the
prior draft's "pure win, no precision cost" — false for the generic tier.)

## Why this scales to infinite designs

Coverage becomes "how completely we mirror the one shared library designers draw from,"
not "how many screens/components we pre-mapped." One ADS enumeration lifts recognition on
*every* screen. The report makes the remaining gaps visible and honest, with zero
mislabel risk.

## Scope (files)

| File | Change |
|---|---|
| `server/figma/kitMappings.ts` | regenerate `SET_KEY_TO_KIT` from ADS keys; keep rename map; icon-tier name normalisation |
| `scripts/sync-ads-mapping.ts` | **new** — enumerate ADS, emit the key→primitive table + "no-twin" list |
| `server/figma/kitEmit.ts` | per-kit count map (small) |
| `server/figma/kitEmitBranch.ts` | promote `formatCoverage` + unmatched backlog into the trailer |
| `__tests__/server/figma/*` | ADS-key fixtures match; icon-name normalisation; recognised/unmatched counts; trailer line |

## Tests

- Re-sourced `SET_KEY_TO_KIT` recognises the real nav-screen `<Button>`/`<Chip>`/`<Badge>`
  keys (fixture from the live tree).
- Icon-name normalisation matches drift; generic non-icon names NOT loosened.
- Per-kit counts correct; trailer line renders recognised + unmatched.
- No instance emitted as the wrong primitive.
- Full suite green (`pnpm run studio:test`).

## Manual acceptance

Re-run nav (`JztJjqt3i6uFwB6r4dfewz` / `328-14859`):
- Base-primitive recognition jumps from 3% toward near-total.
- The previously-broken grey buttons / chips / badges render as real components.
- Trailer honestly lists what stayed unmatched.

## Open questions (for review)

1. **The one risk to disprove first:** do ADS base components actually have arcade-gen
   twins, or will many map to "no equivalent"? Step 0 enumeration answers it before any
   build.
2. ADS file key — obtain from the design team / a known ADS URL.
3. Enterprise-only APIs? `list-file-components` is standard REST (not the
   Enterprise-gated variables API), so enumeration should work on the current plan —
   confirm.
```
