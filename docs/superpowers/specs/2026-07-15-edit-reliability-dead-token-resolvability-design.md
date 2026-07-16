# Edit reliability — "an edit that renders nothing must not report success"

**Date:** 2026-07-16 (rev. 5 — the resolvable set is the UNION of a checked-in ADS color seed + the kit CSS + project/local defs; live-pull machinery dropped. Corrects rev-4's two verified flaws: normalization is lossy so neither source alone is complete, and the studio's variable pull is Enterprise-gated → null in production.)
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
3. **Neither the ADS Figma set NOR arcade-gen's CSS is complete alone — the authority is their UNION** (verified, rev-4's flaw):
   - `figmaVarNameToKitToken` (the ADS-name → `--x` normalizer) lowercases + splits on `/` and whitespace but **does NOT split camelCase**, so ADS `FG/Neutral/onProminent` → `--fg-neutral-onprominent`, but the kit ships `--fg-neutral-on-prominent`. **7 real kit-shipped tokens** (`--fg-{neutral,alert,info,success,warning,intelligence}-on-prominent`, `--bg-neutral-transparent`) are NOT derivable from normalized ADS names, and real composites reference them (`ChatInput.tsx`, `VistaGroupRail.tsx`). ADS-only would false-flag them.
   - Conversely, arcade-gen ships no expressive-orange family, so kit-CSS-only misses the user's actual token.
   - **So the resolvable set MUST be the union: ADS color names ∪ kit CSS names ∪ project theme-overrides ∪ same-file local defs.** The existing `loadTokenNames()` (parses the kit `styles.css`) already provides the kit half for free.
4. **The studio's variable pull is Enterprise-gated → NULL in production** (verified, rev-4's flaw): `server/figmaCli.ts::getVariables` runs `figmanage variables list-local` = the Variables REST API = **Enterprise-only**; on the standard plan the users are on it returns null (its own docstring + [[figma-variables-enterprise-only]] confirm). The studio's own `figmaBridge` is export/write-only (no variable read) and the `figma-console` MCP is disallowed in the generator. **So a live ADS pull cannot work in production.** The ADS half of the union ships as a **checked-in seed constant** (the ~90 ADS semantic color names + values, captured at authoring via the Desktop Bridge). No live-pull, no TTL, no boot-refresh — that machinery would be dead code on a standard plan.
5. **This collapses the design to ONE static table + one check.** No per-frame node-scoped map (rev-3's workaround for the wrong source); no pull infrastructure (rev-4's dead-in-production machinery). One in-repo union covers **every** frame regardless of origin.

## Scope decisions (locked with the user)

1. **Static, not rendered.** Verify the code the agent wrote, not pixels. (Pixel verification = the fidelity keystone, separate — see [[studio-fidelity-metric-keystone]].)
2. **Resolvability only, not intent-matching.** One objective question per reference: *does this `--x` resolve to a real token?* No false alarms is a HARD requirement — now satisfiable because "real" = "in the union," the complete set.
3. **Auto-fix silently, like the crash path.** Dead reference → feed the agent the specific violation + (when the token is real-in-ADS) its value → self-correct before the turn reports done. Reuse the existing exit-2 → self-correct lane.
4. **Design-token custom-property references in scope. Tailwind class-name existence OUT** (infinite/on-demand space — Non-goals).
5. **Two sets, not one:** the RESOLVABLE (renders) set = kit CSS ∪ project theme-overrides ∪ same-file local defs; the ADS seed is a SEPARATE classification oracle for references that fail the resolvable set. Neither ADS nor the kit CSS is complete alone (rev-4): ADS carries the expressive-orange family the kit lacks (→ the seed's job); the kit CSS carries the `*-on-prominent`/`transparent` tokens lossy ADS-name normalization drops (→ the resolvable set's job). Conflating them (seed inside resolvable) silently accepts kit-absent tokens = the bug.

## The resolvable set (the UNION) and the two classes the check distinguishes

**Two DIFFERENT sets — do not conflate (this was a rev-5 self-contradiction the plan review caught):**
- **RESOLVABLE set = what actually renders** = `kit CSS names (loadTokenNames) ∪ project theme-overrides defs ∪ same-file local defs`. A reference in this set paints something. **The ADS seed is NOT in the resolvable set** — the whole point is that ADS knows tokens the kit doesn't ship, which do NOT render.
- **ADS seed = the classification oracle** (`--x → #hex`, ~90 rows). Consulted ONLY for references that FAILED the resolvable set — to decide "real DS token" vs "typo" and to supply the value in the message.

Given a referenced `--x`:
- **Resolvable** (in the render set) → OK, no action. Includes kit-shipped tokens (via `loadTokenNames`), ADS tokens the kit ALSO ships (they're in the kit CSS), project-override tokens, and the author's own inline vars.
- **Not resolvable, but in the ADS seed** (real DS token the kit doesn't ship — e.g. `--bg-expressive-orange-subtle`) → dead *at render* but REAL. exit-2 telling the agent the real ADS value (`#FCECD2`) so it emits a rendering form (per the shipped `resolveKitTokenVar` "hex fallback, never a dead var" precedent — prefer defining the token in the project's `theme-overrides.css`, imported last, wins the cascade AND stays theme-reactive; else literal `bg-[#FCECD2]`). **This lane is why the seed must NOT be in the resolvable set** — if it were, this token would pass and silently render nothing (the exact bug).
- **Not resolvable AND not in ADS** (e.g. `--bg-orange-subtle`, `--surface-canvas`) → typo/hallucination → exit-2 flagging it with nearest-real suggestions.

**Suggestion caveat (honest):** nearest-real is a leading-segment prefix hint, so a mangled `--bg-orange-subtle` surfaces other `bg-*` names, NOT the semantically-right `--bg-expressive-orange-subtle` (shares only the `bg` segment, tied with many). The agent re-derives the right token from the user's intent + the message; the message does NOT claim to name the exact target for a typo. (The value-bearing correction is exact only for the seed-hit lane above.)

Either way: **no silent success on an edit that renders nothing**, and no wrong-token guessing (the real value is in the seed).

## Design — a checked-in ADS seed unioned with the kit CSS, one edit-time check

### Part A — a checked-in ADS color seed (name → value)

- A checked-in JSON/TS constant in the repo (e.g. `studio/server/figma/ads-color-seed.json`) holding the ~90 ADS semantic color tokens: each ADS name normalized to the kit `--x` form via the existing `figmaVarNameToKitToken`, mapped to its Light value (Dark too if cheap). Captured at authoring time via the Figma Desktop Bridge (the full set is in the spec's source material). **No live pull, no TTL, no boot-refresh** — the studio's `getVariables` is Enterprise-gated (returns null in production), so pull machinery would be dead code (rev-4 flaw #4).
- The ADS file key (`a2uKnm88LxRXEWAL1kOqeQ`) is recorded in a comment as the seed's provenance/refresh source; refreshing the seed is a manual dev step (re-pull via the Bridge, regenerate the constant), not a runtime path. Because it's checked in, it's readable by the spawned `.mjs` hook in both dev and the packaged app with no filesystem-permission or first-run concerns.
- **This is a static mirror by design** — but of the COMPLETE semantic-color set (unioned with the live kit CSS), not the incomplete kit-only set that caused the bug. Seed staleness (a color token added to ADS after authoring) is the accepted cost; the kit-CSS half (`loadTokenNames`) stays live, so any token the kit ships is always resolvable regardless of seed age.

### Part B — edit-time resolvability check (extend the shipped token hook)

Extend `studio/server/hooks/validateTokenClasses.mjs` (already a PostToolUse Write/Edit hook that catches the *named-form* token no-op and self-corrects via exit-2). Add a paren/var-form resolvability check, scoped to generated frame files only:

1. **Build the resolvable NAME set = the union** (fail open — a source that won't load contributes nothing): `loadTokenNames()` (kit CSS, already shipping) ∪ ADS seed names ∪ project `theme-overrides.css` defs ∪ same-file local defs. The kit-CSS union is **load-bearing, not optional** — it carries the 7 `*-on-prominent`/`transparent` tokens that lossy ADS normalization drops (rev-4 flaw #1). If the union is empty (all sources failed), skip the check.
2. **Load the ADS value map** (`--x → #hex`) from the seed, for the correction message only.
3. **Extract every `--custom-property` reference** in the post-edit source via `(--x)` / `var(--x)` (one regex covers `bg-(--x)`, `var(--x)`, `[var(--x)]`), requiring ≥1 internal hyphen so JS `(--i)` is never captured.
4. **Fix local-def extraction to match React object-key syntax.** The existing `extractTokenNames` regex requires `--name` immediately followed by `:`, so it misses `{ "--x": v }` and `{ ["--x"]: v }` (a `"`/`]` sits between name and colon) — the standard React way to set a CSS var → an author's own inline var would false-flag. Add a definitions scan that also matches the quoted/bracketed object-key forms (regex pinned in the plan). The default project `theme-overrides.css` is empty, so this scan is the ONLY guard against author-local-var false alarms — it must land.
5. **Classify + exit-2** per "the two classes" above (real-in-ADS-but-unresolvable → value guidance, prefer theme-overrides; not-in-ADS → typo + nearest-real). Resolvable in the union → OK.
6. **Fail open** at every step (unreadable seed/CSS → that source contributes nothing; empty union → skip). Frame-files-only scope for the NEW check; the existing named-form check keeps its broader `.tsx` scope.

The hook never writes other files (a validator stays a validator); the agent performs the correction; the hook re-validates on the next write.

### Why this satisfies the decisions
- Static; no render ✅ #1.
- Resolvability-only against the COMPLETE union (ADS seed + live kit CSS) → real tokens (incl. `*-on-prominent`) never false-flagged, invented ones caught ✅ #2 (the completeness fix, both halves).
- Silent exit-2 self-correct before "done" ✅ #3.
- Custom-property refs in scope; class names out ✅ #4.
- Union is the authority; neither source alone is complete ✅ #5.
- One static seed + live kit CSS, all frames (no per-frame map, no pull infra) ✅ (design collapse).

## The motivating bug, traced end-to-end
Agent writes `bg-(--bg-orange-subtle)` (mangled) → ref `bg-orange-subtle` → not in the resolvable set (kit CSS / overrides / local) AND not in the ADS seed (the real name is `bg-expressive-orange-subtle`) → **typo → exit-2** flagging it with nearest-real `bg-*` hints. Agent, using the user's intent + its DS knowledge, rewrites to the correct `bg-(--bg-expressive-orange-subtle)` → ref not resolvable BUT in the ADS seed → **real-but-kit-absent → exit-2 with `#FCECD2`** → agent defines it in `theme-overrides.css` (or `bg-[#FCECD2]`) → resolvable → hook passes → visible orange. Two exit-2 rounds worst case; either way, **no "I did it" over an unchanged frame.**

## Correction loop
Identical mechanism to the named-form check already shipping in this file: `exit(2)` returns the message as a tool error; the agent rewrites; the hook re-runs and passes; the turn completes showing only the corrected result. Synchronous at write time (a dead token is a no-op, not a browser crash), so no dispatch/timer/chat surface and no interaction with the resilient-render HMR/overlay changes.

## Immediate one-frame fix (data, separate from the code change)
The live repro frame stays wrong until re-touched. `--bg-orange-subtle` → `bg-[#FCECD2]` (the ADS value for `BG/Expressive/Orange/Subtle`) in that frame's `index.tsx:9`. A data fix to one project file, done at manual-acceptance; not committed to the repo.

## Non-goals (explicit)
- **Tailwind class-name validation** — infinite/on-demand space; not statically decidable without the compiler; would break no-false-alarms. Residual: a misspelled *utility* class (not a var) still silently no-ops. (The *named-form* token utility no-op IS already caught by this hook's existing check.)
- **Rendered/pixel verification** — fidelity keystone; separate.
- **Intent-matching**; **wrong-element / overridden-value** no-ops — not statically detectable.
- **Any live ADS pull (edit-path OR cadence)** — the studio's `getVariables` is Enterprise-gated → null in production, so the ADS half ships as a checked-in seed refreshed manually by a dev via the Desktop Bridge. Not a runtime dependency.
- **Per-frame node-scoped token map** — obviated by the complete union (earlier revisions' workaround for the wrong source).
- **Hook writing to other files** (auto-appending to theme-overrides.css) — the agent does the correction; the validator only flags + guides.
- **`new_string`-only miss:** the hook reads the Edit's `new_string`, not the whole file, so a dead token written by an EARLIER edit whose later edit doesn't touch that line is not re-seen. Acknowledged limitation inherited from the existing hook; the dominant case (the edit that introduces the dead token) IS caught. Widening to whole-file re-read on Edit is a possible follow-up, out of scope here.
- **Filling the arcade-gen coverage gap** (shipping an expressive-orange family) — a real kit-vs-ADS gap tracked separately (kit-emit mapping work).
- **Phantom edits** — separate spec.

## Files (indicative — confirm exact carriers at plan time)
| File | Change |
|---|---|
| `studio/server/figma/ads-color-seed.json` (new, checked in) | Part A: the ~90 ADS semantic color tokens, names normalized via `figmaVarNameToKitToken`, → Light (+Dark) value. Provenance comment names the ADS file key + "regenerate via Desktop Bridge". Includes `--bg-expressive-orange-subtle: #FCECD2`. |
| `studio/server/hooks/validateTokenClasses.mjs` | Part B: build resolvable UNION = `loadTokenNames()` (kit CSS, load-bearing) ∪ ADS seed names ∪ theme-overrides ∪ same-file local defs; fix local-def extraction for React object-key syntax; add `extractTokenRefs` + `detectDeadTokenRefs` (real-in-ADS-seed-but-unresolvable → value guidance; not-in-union → nearest-real); load the ADS seed value map for messaging; wire into `main()` alongside the existing named-form check; frame-files-only scope; fail open. |
| `studio/server/figma/kitTokens.ts` | reuse the exported `figmaVarNameToKitToken` for seed generation so the seed's `--x` keys match the kit form. (No behavior change; the camelCase-lossiness is COVERED by unioning kit CSS, not by changing this normalizer — changing it risks the kit-emit path that also uses it.) |
| `studio/__tests__/server/hooks/validateTokenClasses.test.ts` | not-in-union ref (`--bg-orange-subtle`, `--surface-canvas`) → exit 2 + nearest suggestion; ADS-seed-real-but-kit-absent (`--bg-expressive-orange-subtle`) → exit 2 with the #FCECD2 value guidance; kit-shipped token incl. a `*-on-prominent` (e.g. `--fg-neutral-on-prominent`, present in styles.css) → exit 0 (guards the rev-4 false-alarm regression); project-override token → exit 0; React object-key local var `{ "--x": v }` referenced via `var(--x)` → exit 0 (no false alarm); both `(--x)`/`var(--x)` forms; fail-open on empty union. Port `runHook`/`tmpFrame` from `validateArcadeImports.test.ts`, writing files under a `/projects/<slug>/frames/<id>/` path; integration cases use `Write` with full content (the hook reads `new_string`, not disk). |
| project frame `01-figma-4368-19734/index.tsx` (data, not code) | one-frame fix: `bg-(--bg-orange-subtle)` → `bg-[#FCECD2]`. Manual-acceptance step. |

## Open questions (resolve in the plan)
1. **Seed carrier + hook path resolution** — `.json` beside the hook vs. a `.mjs`-exported constant the hook imports; confirm the spawned `.mjs` hook can read/import it in both dev and packaged app (a `require`/`readFileSync` relative to the hook's own dir is safest — mirror how `loadTokenNames` resolves the kit CSS).
2. **`*-on-prominent` regression guard is REQUIRED, not nice-to-have** — a test that a real kit token invisible to normalized ADS (`--fg-neutral-on-prominent`) resolves via the kit-CSS union → exit 0. This is the rev-4 flaw; the test locks it closed.
3. **Value form the agent should emit** for an ADS-real/kit-absent token — the message offers the theme-correct `theme-overrides.css` definition FIRST (survives light/dark), literal `bg-[#hex]` as the quick alternative. Confirm wording.
4. **Namespace/property sanity** — validate only name-existence in the union, or also that the namespace matches the utility (a `--fg-*` used as a `bg-` value)? YAGNI leans name-existence for v1; note the `resolveKitTokenVar` precedent exists if needed later.
5. **Object-key regex** — pin the exact definitions-scan regex for `{ "--x": v }` / `{ ["--x"]: v }` in the plan; it's the sole author-local-var false-alarm guard.
6. **Cost** — spawned process per PostToolUse; reading the seed + kit CSS + 1-2 files per edit is negligible vs. the Bedrock round-trip; confirm.
