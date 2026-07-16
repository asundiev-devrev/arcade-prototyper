# Edit reliability — "an edit that renders nothing must not report success"

**Date:** 2026-07-16 (rev. 4 — ADS-as-source-of-truth, after three revisions each killed by a completeness flaw a review caught, then resolved by verifying against the real ADS Figma file)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Sibling of the shipped resilient-render work (crash class). This covers the **silent-no-op class**: the agent reports a change as done, but the result doesn't change — no crash, no error, nothing caught it.

## The experience goal (what the user cares about)

> **If the tool says it made your change, your change is visible. It never claims success on an edit that renders nothing.**

Live repro (project `implement-this-precisely`, frame `01-figma-4368-19734`): user asked to set the background to `bg/expressive/orange/subtle`. The agent wrote `className="bg-(--bg-orange-subtle)"`, reported success, and **the background did not change.** `bg-(--bg-orange-subtle)` is valid Tailwind v4 (compiles to `background-color: var(--bg-orange-subtle)`); the **class is fine, the variable is dead** → resolves to nothing → silent no-op that compiles and never throws.

## What three prior revisions + adversarial reviews established (don't repeat them)

1. **The check must not validate against arcade-gen's shipped CSS** (`styles.css`/`tokens.css`) — those are an **incomplete mirror** of the design system. Validating against them both misses real tokens the kit doesn't ship AND false-flags valid frames.
2. **The design system's source of truth is the ADS Figma file** (`a2uKnm88LxRXEWAL1kOqeQ`, "Arcade Design System"). Verified directly via the Figma Desktop Bridge:
   - `BG/Expressive/Orange/Subtle = #FCECD2` **is a real ADS token** — exactly what the user asked for. arcade-gen simply doesn't export an expressive-orange family. So the user requested a genuine token; the tool's local knowledge was too narrow.
   - The 5 tokens a review feared were "false alarms" (`surface-canvas`, `surface-default`, `fg-critical-prominent`, `bg-interactive-primary-resting`, `surface-overlay-hovered`) are **absent from ADS too** — genuinely dead names invented by the LLM. Flagging them is CORRECT; they are the silent-no-op bug, just previously unnoticed.
3. **The ADS variable set is pullable on ANY plan** via the Figma Desktop Bridge (`figma-console` MCP / the studio's `getVariables` CLI path) — NOT gated on the Enterprise Variables REST API. So an ADS-sourced check is buildable without an Enterprise dependency.
4. **This collapses the design to ONE part.** Earlier revisions built a per-frame, node-scoped Figma token map to work around the wrong (incomplete) source. With ADS as the complete source, no per-frame map is needed: one cached ADS token table covers **every** frame regardless of origin (Figma-imported, LLM-authored, hand-edited).

## Scope decisions (locked with the user)

1. **Static, not rendered.** Verify the code the agent wrote, not pixels. (Pixel verification = the fidelity keystone, separate — see [[studio-fidelity-metric-keystone]].)
2. **Resolvability only, not intent-matching.** One objective question per reference: *does this `--x` resolve to a real token?* No false alarms is a HARD requirement — now satisfiable because "real" = "in ADS," the complete set.
3. **Auto-fix silently, like the crash path.** Dead reference → feed the agent the specific violation + (when the token is real-in-ADS) its value → self-correct before the turn reports done. Reuse the existing exit-2 → self-correct lane.
4. **Design-token custom-property references in scope. Tailwind class-name existence OUT** (infinite/on-demand space — Non-goals).
5. **Source of truth = the ADS Figma file.** The resolvable set = ADS token names ∪ the frame's actual render-time local defs (project `theme-overrides.css` + same-file local vars). Local CSS (arcade-gen) is NOT the authority; it's a subset of ADS.

## The two classes the check distinguishes (both from the ADS table)

Given a referenced `--x` on a generated frame:
- **Real in ADS.** The token exists in the design system. Two sub-cases, both fine to allow-with-guidance:
  - arcade-gen **ships** it (it's in the kit CSS) → resolvable → OK, no action.
  - arcade-gen does **not** ship it (e.g. `--bg-expressive-orange-subtle`) → the reference is dead *at render* but the token is REAL. exit-2 telling the agent the real ADS value (`#FCECD2`) so it emits a rendering form (per the shipped `resolveKitTokenVar` "hex fallback, never a dead var" precedent — literal value, or define the token in the project's `theme-overrides.css` which is imported last and wins the cascade).
- **Not in ADS at all** (e.g. `--bg-orange-subtle`, `--surface-canvas`) → a typo/hallucination → exit-2 flagging it with nearest-real ADS suggestions (so the mangled `--bg-orange-subtle` is answered with the real `--bg-expressive-orange-subtle = #FCECD2`).

Either way: **no silent success on an edit that renders nothing**, and no wrong-token guessing (the real value is in the table).

## Design — one cached ADS table + one edit-time check

### Part A — a cached ADS token table (name → value), refreshed on a cadence

- A new module pulls the ADS file's color variables (name + resolved Light/Dark value) via the existing `getVariables`/Desktop-Bridge path, normalizes each name to the kit custom-property form via the existing `figmaVarNameToKitToken` (`BG/Expressive/Orange/Subtle → --bg-expressive-orange-subtle`), and writes a small JSON table to a writable, hook-readable location under `studioRoot()` (e.g. `studioRoot()/ads-tokens.json`; confirm exact path at plan time — must be readable by the spawned `.mjs` hook and survive across turns).
- The ADS file key is a new named constant (`a2uKnm88LxRXEWAL1kOqeQ`); it is NOT referenced anywhere today.
- **Refresh cadence:** pull on a TTL (e.g. once per day / on server boot if stale) — NOT on the edit path. The table is the offline authority the hook reads; a live pull never blocks an edit. **Staleness is the accepted cost** (a token added to ADS today may not be known until the next refresh) — far more tractable than mirroring incomplete files, because ADS is the complete truth.
- **Fail open / bootstrap:** if the table is missing or unreadable (never pulled, or the pull failed), the check falls back to the render-time local set only (today's behavior for that portion) or skips — it must NEVER block generation on an absent/failed ADS pull. Ship a checked-in seed table so the feature works before the first live pull.

### Part B — edit-time resolvability check (extend the shipped token hook)

Extend `studio/server/hooks/validateTokenClasses.mjs` (already a PostToolUse Write/Edit hook that catches the *named-form* token no-op and self-corrects via exit-2). Add a paren/var-form resolvability check, scoped to generated frame files only:

1. **Build the resolvable NAME set** (fail open — empty → skip that source): ADS table names ∪ project `theme-overrides.css` defs ∪ same-file local defs. (arcade-gen CSS names are a subset of ADS, so ADS covers them; include them too if cheap for belt-and-braces.)
2. **Load the ADS value map** (`--x → #hex`) from the table for messaging.
3. **Extract every `--custom-property` reference** in the post-edit source via `(--x)` / `var(--x)` (one regex covers `bg-(--x)`, `var(--x)`, `[var(--x)]`), requiring ≥1 internal hyphen so JS `(--i)` is never captured.
4. **Fix local-def extraction to match React object-key syntax** (`{ "--x": v }`, `{ ["--x"]: v }`) — the existing `extractTokenNames` regex requires an immediate colon and misses these, which would false-flag an author's own inline var. (Proven bug from a prior review.)
5. **Classify + exit-2** per "the two classes" above (real-in-ADS-kit-absent → value guidance; not-in-ADS → typo + nearest-real). Real-in-ADS-and-kit-shipped, or resolvable locally → OK.
6. **Fail open** at every step (unreadable table/CSS → skip that source; empty resolvable set → skip the check). Frame-files-only scope for the NEW check; the existing named-form check keeps its broader `.tsx` scope.

The hook never writes other files (a validator stays a validator); the agent performs the correction; the hook re-validates on the next write.

### Why this satisfies the decisions
- Static; no render ✅ #1.
- Resolvability-only against the COMPLETE set (ADS) → real tokens never false-flagged, invented ones caught ✅ #2 (the completeness fix).
- Silent exit-2 self-correct before "done" ✅ #3.
- Custom-property refs in scope; class names out ✅ #4.
- ADS is the authority; local CSS is a subset ✅ #5.
- One table, all frames (no per-frame map) ✅ (design collapse).

## The motivating bug, traced end-to-end
Agent writes `bg-(--bg-orange-subtle)` → extracted ref `bg-orange-subtle` → not in ADS table, not in local defs → **not-in-ADS → exit-2**: "`--bg-orange-subtle` is not a design-system token. The real token for a subtle orange background is `--bg-expressive-orange-subtle` (#FCECD2), which the kit doesn't ship — use `bg-[#FCECD2]` (or define `--bg-expressive-orange-subtle` in theme-overrides.css)." Agent rewrites, hook passes, turn completes with a visible orange background. No more "I did it" over an unchanged frame — and the correction is the value the user actually asked for.

## Correction loop
Identical mechanism to the named-form check already shipping in this file: `exit(2)` returns the message as a tool error; the agent rewrites; the hook re-runs and passes; the turn completes showing only the corrected result. Synchronous at write time (a dead token is a no-op, not a browser crash), so no dispatch/timer/chat surface and no interaction with the resilient-render HMR/overlay changes.

## Immediate one-frame fix (data, separate from the code change)
The live repro frame stays wrong until re-touched. `--bg-orange-subtle` → `bg-[#FCECD2]` (the ADS value for `BG/Expressive/Orange/Subtle`) in that frame's `index.tsx:9`. A data fix to one project file, done at manual-acceptance; not committed to the repo.

## Non-goals (explicit)
- **Tailwind class-name validation** — infinite/on-demand space; not statically decidable without the compiler; would break no-false-alarms. Residual: a misspelled *utility* class (not a var) still silently no-ops. (The *named-form* token utility no-op IS already caught by this hook's existing check.)
- **Rendered/pixel verification** — fidelity keystone; separate.
- **Intent-matching**; **wrong-element / overridden-value** no-ops — not statically detectable.
- **Live ADS pull on the edit path** — rejected for latency; the table is pulled on a cadence off the edit path.
- **Per-frame node-scoped token map** — obviated by the complete ADS table (earlier revisions' workaround for the wrong source).
- **Hook writing to other files** (auto-appending to theme-overrides.css) — the agent does the correction; the validator only flags + guides.
- **`new_string`-only miss:** the hook reads the Edit's `new_string`, not the whole file, so a dead token written by an EARLIER edit whose later edit doesn't touch that line is not re-seen. Acknowledged limitation inherited from the existing hook; the dominant case (the edit that introduces the dead token) IS caught. Widening to whole-file re-read on Edit is a possible follow-up, out of scope here.
- **Filling the arcade-gen coverage gap** (shipping an expressive-orange family) — a real kit-vs-ADS gap tracked separately (kit-emit mapping work).
- **Phantom edits** — separate spec.

## Files (indicative — confirm exact carriers at plan time)
| File | Change |
|---|---|
| `studio/server/figma/adsTokens.ts` (new) | Part A: pull ADS color variables (via `getVariables`/Desktop Bridge), normalize names via `figmaVarNameToKitToken`, write `studioRoot()/ads-tokens.json` (name→value); TTL refresh off the edit path; the ADS file-key constant; fail-open + a checked-in seed. |
| server boot / a refresh trigger (`vite.config.ts` apiPlugin boot block, where other stale-refreshes live) | schedule/kick the ADS table refresh on boot when stale (mirrors `refreshStaleClaudeMd`). |
| `studio/server/hooks/validateTokenClasses.mjs` | Part B: build resolvable set = ADS table ∪ theme-overrides ∪ same-file local defs; fix local-def extraction for React object-key syntax; add `extractTokenRefs` + `detectDeadTokenRefs` (real-in-ADS-kit-absent → value guidance; not-in-ADS → nearest-real); wire into `main()` alongside the existing named-form check; frame-files-only scope; fail open. |
| `studio/server/figma/kitTokens.ts` | reuse `figmaVarNameToKitToken` so pull-time and edit-time agree on the `--x` key form. |
| `studio/__tests__/server/figma/adsTokens.test.ts` (new) | pull→normalize→write produces `--bg-expressive-orange-subtle → #FCECD2`; fail-open on pull error; TTL/staleness. |
| `studio/__tests__/server/hooks/validateTokenClasses.test.ts` | not-in-ADS ref (`--bg-orange-subtle`, `--surface-canvas`) → exit 2 + nearest suggestion; real-in-ADS-kit-absent (`--bg-expressive-orange-subtle`) → exit 2 with the #FCECD2 value guidance; kit-shipped/local-override/`@theme`-style token → exit 0; React object-key local var → exit 0 (no false alarm); both `(--x)`/`var(--x)` forms; fail-open on missing table. Port `runHook`/`tmpFrame` from `validateArcadeImports.test.ts`, writing files under a `/projects/<slug>/frames/<id>/` path; integration cases use `Write` with full content (the hook reads `new_string`, not disk). |
| project frame `01-figma-4368-19734/index.tsx` (data, not code) | one-frame fix: `bg-(--bg-orange-subtle)` → `bg-[#FCECD2]`. Manual-acceptance step. |

## Open questions (resolve in the plan)
1. **Exact table path + seed** — `studioRoot()/ads-tokens.json` readable by the spawned `.mjs` hook; ship a checked-in seed (the ADS color set as of authoring) so the feature works pre-first-pull, and confirm the hook resolves the path in both dev and packaged app.
2. **Refresh trigger + TTL** — boot-if-stale (like `refreshStaleClaudeMd`) vs. a periodic job; pick a TTL (a day?) and confirm a failed pull leaves the last good table in place (never truncates to empty).
3. **Value form the agent should emit** for a real-in-ADS/kit-absent token — literal `bg-[#hex]` vs. defining the token in `theme-overrides.css` (theme-correct, survives light/dark). The message should offer the theme-correct route first; confirm wording in the plan.
4. **Namespace/property sanity** — do we validate only that the name exists in ADS, or also that its namespace matches the utility (a `--fg-*` used as a `bg-` value)? The shipped `resolveKitTokenVar` does namespace disambiguation; decide whether the edit check mirrors it or stays name-existence-only (YAGNI leans name-existence for v1).
5. **Cost** — the hook is a spawned process per PostToolUse; reading one JSON table + 1-2 CSS files per edit is negligible vs. the Bedrock round-trip; confirm.
