# Edit reliability — "an import from a path that doesn't resolve must not reach the frame"

**Date:** 2026-07-16
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Third sibling of the shipped resilient-render (crash class) + dead-token (silent-no-op class) work. This covers the **invalid-import-path class**: the agent imports a REAL symbol from a WRONG path in the `arcade` namespace; the path resolves to nothing → the symbol is undefined → the frame crashes at render.

## The experience goal

> **An `arcade`-namespace import the agent writes always points at a path that resolves. A real symbol from a wrong path is caught and corrected before the turn reports done.**

Live repro (2026-07-16, project `computer-settings`, frame `01-computer-settings`): user asked to replace a hand-rolled control with a dropdown. The agent correctly chose `Select` (no dropdown component exists) — but wrote `import { ChevronDownSmall } from "arcade/components/icons"`. `ChevronDownSmall` **is a real arcade-gen icon**; `LightingBolt` (in a sibling page) is too. The failure is the **path**: `arcade/components/icons` is not an aliased specifier, so it resolves to nothing → `ChevronDownSmall is not defined` → render crash (caught by the shipped resilient-render auto-repair, but it should never have rendered). Two sibling pages (`PlansBilling.tsx`, `WorkflowsTools.tsx`) still carry the same bad import and will crash when their tabs open.

## The valid specifier space (ground truth from `studio/vite.config.ts`)

Frame source may import from EXACTLY these `arcade`-namespace specifiers (the Vite `resolve.alias` list):
- `arcade` (→ prototype-kit barrel)
- `arcade/components` (→ same barrel; re-exports all of `@xorkavi/arcade-gen`, INCLUDING every icon)
- `arcade-studio` (→ studio `src`)
- `arcade-prototypes` (→ prototype-kit)
- `arcade-user/<name>` (→ user-kit composites)

`arcade/components` is `$`-anchored (`/^arcade\/components$/`), so `arcade/components/icons` matches NO alias → unresolvable. And every icon is already re-exported from `arcade/components` (`export * from "@xorkavi/arcade-gen"` in the barrel), so the correct path for `ChevronDownSmall` is `arcade/components` (or `arcade`). There is NO valid `arcade/components/<subpath>`.

## Why the shipped import hook misses this

`studio/server/hooks/validateArcadeImports.mjs` already validates NAMED imports — but only their SYMBOL NAMES, and only for two exact source strings: `TRACKED_SOURCES = ["arcade/components", "arcade-prototypes"]`, filtered by `.includes(src)` (exact match). So `arcade/components/icons` is not tracked at all → the hook never looks at it → the bad path (with real symbols) sails through. The hook checks "is this name real on a known path," never "is this path real."

## Scope decisions (locked with the user)

1. **Validate the whole `arcade` namespace, not just the observed `/icons` subpath** — close the class, not the instance (per [[feedback_scalable_accuracy]]). The valid set is 5 entries; any other `arcade`/`arcade-*`/`arcade/...` specifier is invalid.
2. **Static, at write time, via the existing hook + exit-2 self-correct lane** — same mechanism as the named-import and dead-token checks. No new file, no new surface. The agent self-corrects before the turn reports done.
3. **No false alarms (HARD)** — only `arcade`-namespace specifiers are judged. Relative imports (`./pages/Foo`), bare npm packages (`react`, `@xorkavi/arcade-gen` used by studio's OWN source), and every valid alias pass untouched.
4. **Guidance is specific** — for a symbol that IS re-exported by the barrel (all icons/components are), the message names the correct path (`arcade/components`), not just "invalid path."

## Design — an import-PATH check in the existing hook

All changes in `studio/server/hooks/validateArcadeImports.mjs`.

### The valid-alias set (single source of truth, must not drift from Vite)
Define `VALID_ARCADE_SPECIFIERS` = exact set `{ "arcade", "arcade/components", "arcade-studio", "arcade-prototypes" }` plus the prefix rule `arcade-user/<anything>` is valid. A comment cross-references `studio/vite.config.ts` `resolve.alias` as the authority; if an alias is added there, this set must be updated in lockstep (like the existing DS-consumer-root lockstep note in studio/CLAUDE.md).

### What counts as an `arcade`-namespace specifier to judge
A specifier is IN SCOPE for the path check iff it is `arcade`, or starts with `arcade/`, or starts with `arcade-`. (This deliberately EXCLUDES `@xorkavi/arcade-gen` — that's not the `arcade` namespace, it's the real package studio's own source imports; and it excludes relative/other-package specifiers.)

### The check (`detectInvalidArcadePaths`)
1. **Extract every import SPECIFIER in the file, across all import forms** — named (`import { X } from "..."`), default (`import X from "..."`), namespace (`import * as X from "..."`), and side-effect (`import "..."`). The existing `parseImports` captures only NAMED-import specifiers, so a bad path in a default/namespace/side-effect import would slip a named-only check. Add specifier extraction that covers all forms (a single regex on `from "…"` plus the side-effect `import "…"` form), OR reuse the broader import regexes already in `collectDefinedIdentifiers` (`:446/:459/:463`) which cover named/default/namespace — confirm coverage at plan time.
2. **For each in-scope specifier**, if it is not in `VALID_ARCADE_SPECIFIERS` and does not match the `arcade-user/<name>` rule → a violation.
3. **On ≥1 violation → `exit(2)`** with a message: name the bad specifier, and — when the closest valid specifier is derivable (e.g. `arcade/components/icons` → strip the invalid subpath → `arcade/components`) — name it; else list the valid specifiers. For a symbol known to be re-exported by the barrel, say "import it from `arcade/components`."
4. **Compose with the existing checks:** run alongside `validateImports` (named-symbol check); union all violations into ONE `exit(2)` message; `exit(0)` only when all checks pass. Do not alter the existing named-symbol or the (already-removed-from-main) JSX behavior.

### Fail open
If the file can't be read/parsed, or specifier extraction yields nothing, skip — never block on our own failure (mirrors the existing hook's contract).

### Why this satisfies the decisions
- Whole-namespace, not instance ✅ #1.
- Static, existing exit-2 lane ✅ #2.
- Only `arcade`-namespace specifiers judged; relative/npm/valid-alias untouched ✅ #3 (no false alarms).
- Specific correct-path guidance ✅ #4.

## The motivating bug, traced
Agent writes `import { ChevronDownSmall } from "arcade/components/icons"` → specifier `arcade/components/icons` is in scope (starts `arcade/`), not in `VALID_ARCADE_SPECIFIERS`, not `arcade-user/*` → violation → exit-2: "`arcade/components/icons` is not a valid import path. Import from `arcade/components` — it re-exports all arcade-gen icons and components." Agent rewrites to `arcade/components` → resolves → `ChevronDownSmall` defined → no crash. Turn completes clean.

## Interaction with the shipped features (all independent)
- **Resilient render:** this crash class is what auto-repair CAUGHT in the repro. With this check, the bad path is fixed at write time so the crash (and the reload/hold-last-good dance) never happens. Strictly upstream; no interaction.
- **Dead-token check:** same hook family, orthogonal target (a token VALUE that renders nothing vs. an import PATH that resolves to nothing). Both exit-2 through the same lane; union messages if both fire. (The dead-token check lives in `validateTokenClasses.mjs`; this lives in `validateArcadeImports.mjs` — two hooks, both PostToolUse, already coexisting.)

## Non-goals (explicit)
- **Validating symbol names** on a valid path — already done by the shipped `validateImports`.
- **Non-`arcade` specifiers** — relative imports, npm packages, `@xorkavi/arcade-gen` (studio-own): out of scope; judging them risks false alarms and isn't this bug.
- **Auto-rewriting the import** — the hook flags + guides; the agent rewrites (a validator stays a validator, consistent with the dead-token design).
- **Deep subpath validity** (e.g. is `arcade-user/Foo` a real composite on disk) — the existing barrel/alias machinery + resilient render cover a missing composite; this check only judges the SPECIFIER against the alias set.
- **The two live broken frames** (`PlansBilling.tsx`, `WorkflowsTools.tsx`) — data fix at manual-acceptance, not part of the hook change.

## Files (indicative — confirm at plan time)
| File | Change |
|---|---|
| `studio/server/hooks/validateArcadeImports.mjs` | add `VALID_ARCADE_SPECIFIERS` + the `arcade-user/` rule; add `extractAllImportSpecifiers(source)` (all import forms) + `detectInvalidArcadePaths(specifiers)`; call it in `main()` alongside `validateImports`; union violations into one exit-2; a specific correct-path message + formatter. Comment cross-refs vite.config.ts alias list as the authority. |
| `studio/__tests__/server/hooks/validateArcadeImports.test.ts` | `arcade/components/icons` (real symbol, bad path) → exit 2 naming `arcade/components`; `arcade/components` / `arcade` / `arcade-studio` / `arcade-prototypes` / `arcade-user/Foo` → exit 0; relative `./pages/Foo` + npm `react` + `@xorkavi/arcade-gen` → exit 0 (no false alarm); bad path in a DEFAULT and a NAMESPACE import → exit 2 (proves all-forms coverage); compose with a named-symbol violation → one exit-2 with both. Port `runHook`/`tmpFrame` if not already present. |
| project frames `PlansBilling.tsx` + `WorkflowsTools.tsx` (data, not repo) | fix `"arcade/components/icons"` → `"arcade/components"`. Manual-acceptance step. |

## Open questions (resolve in the plan)
1. **Specifier extraction reuse vs. new regex** — reuse the named/default/namespace regexes in `collectDefinedIdentifiers` (`:446/:459/:463`), or a single purpose-built specifier scan. Confirm all four import forms (named/default/namespace/side-effect) are covered; side-effect `import "..."` has no binding so `collectDefinedIdentifiers` won't have it — likely need one added pattern.
2. **Correct-path suggestion heuristic** — for `arcade/<subpath>` strip to `arcade/components` when the subpath looks like a component/icon path; general fallback is "valid paths are: …". Keep simple (no fuzzy matching); confirm wording.
3. **`arcade-user/` rule exactness** — `arcade-user/<name>` valid; `arcade-user` bare (no name) invalid? Match the Vite regex `/^arcade-user\/(.+)$/` exactly (requires a non-empty name).
4. **Cost** — one more regex pass over the file in an already-spawned PostToolUse hook; negligible vs. the Bedrock round-trip; confirm.
