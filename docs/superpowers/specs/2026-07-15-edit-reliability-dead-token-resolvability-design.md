# Edit reliability — "an edit that renders nothing must not report success"

**Date:** 2026-07-15 (rev. 3 — reframed on Figma-as-source-of-truth after a second adversarial review + user direction)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Sibling of the shipped resilient-render work (crash class). This covers the **silent-no-op class**: the agent reports a change as done, but the result doesn't change — no crash, no error, nothing caught it.

## The experience goal (what the user cares about)

> **If the tool says it made your change, your change is visible. It never claims success on an edit that renders nothing.**

Live repro (2026-07-15, project `implement-this-precisely`, frame `01-figma-4368-19734`): user asked to set the background to `bg/expressive/orange/subtle`. The agent wrote `className="bg-(--bg-orange-subtle)"`, reported success, and **the background did not change.** `bg-(--bg-orange-subtle)` is valid Tailwind v4 (compiles to `background-color: var(--bg-orange-subtle)`); the **class is fine, the variable is dead** → resolves to nothing → silent no-op that compiles and never throws.

## The reframe that corrects two prior revisions (user direction: "take it from Figma")

Rev-1/rev-2 tried to validate references against arcade-gen's shipped CSS (`styles.css`). Two adversarial reviews proved that source is **an incomplete mirror of the real design system**, which lives in **Figma**:

- `BG/Expressive/Orange/Subtle = #fcecd2` is a **real DS token in Figma** (confirmed via `get_variable_defs` on node 4368-19734). arcade-gen simply doesn't export an expressive-orange family (only blue + yellow). So the user asked for a token that genuinely exists — the tool's local knowledge was just too narrow to honor it.
- Validating against `styles.css` alone therefore both **misses** (a real Figma token the kit lacks looks "dead") and **false-alarms** (see below).

**The shipped precedent for exactly this case already exists:** `server/figma/kitTokens.ts::resolveKitTokenVar` — when a bound Figma variable has no matching kit token, it **falls back to the literal Figma hex value** ("never a dead var that paints nothing"). This spec generalizes that principle to the edit path.

## Scope decisions (locked with the user)

1. **Static, not rendered.** Verify the code the agent wrote, not pixels. (Pixel verification = the fidelity keystone, separate — see [[studio-fidelity-metric-keystone]].)
2. **Resolvability only, not intent-matching.** One objective question per reference: *does this `--x` resolve to a real definition/value?* No false alarms is a HARD requirement.
3. **Auto-fix silently, like the crash path.** Dead reference → feed the agent the specific violation + the real Figma value → it self-corrects before the turn reports done. Reuse the existing exit-2 → self-correct lane.
4. **Design-token custom-property references in scope. Tailwind class-name existence OUT** (infinite/on-demand space — Non-goals).
5. **Source of truth = Figma, mirror = local CSS.** The resolvable set is the union of all **render-time** local sources PLUS the **per-frame Figma token map** captured at import.
6. **Capture scope = tokens used in this frame** (user choice). At import, persist the name→value map for tokens actually bound in the imported node (`resolveTokens`'s `tokens.colors`, already computed — zero extra fetch). Accepted gap: a real Figma token the agent introduces later that was NOT in the original node is unknown to the map and falls through to the local-CSS check.

## Two false-alarm bugs the reviews proved (must fix — the hard no-false-alarms rule)

Verified against the repo:
1. **The resolvable set must be ALL render-time sources, not just `styles.css`.** A frame imports THREE stylesheets at render (`frameMountPlugin.ts:259-261`): `@xorkavi/arcade-gen/styles.css` + `arcade-studio/styles/tailwind.css` (a `@theme` block defining `--shadow-elevation-02`, `--radius-bubble`, `--spacing-gutter`, `--height-control-*`, …) + `arcade-studio/styles/arcade-gen-patches.css` (`--component-bubble-*`). Plus the project's `theme-overrides.css` and same-file local defs. Validating against `styles.css` alone false-flags a valid frame — proven: an existing frame uses `var(--shadow-elevation-02)` (a real `@theme` token, 0 hits in `styles.css`); ~8/47 real frames would be flagged. **The resolvable set = styles.css ∪ tailwind.css @theme ∪ arcade-gen-patches.css ∪ project theme-overrides.css ∪ same-file local defs ∪ per-frame Figma token map.**
2. **Local-def extraction must handle React object-key syntax.** The existing `extractTokenNames` regex (`/--([a-z0-9-]+)\s*:/`) requires the colon immediately after the name — it does NOT match `{ "--x": v }` or `{ ["--x"]: v }` (a `"`/`]` sits between name and colon), the standard React way to set a CSS var. So an author's own inline-style var is NOT captured as locally-defined → false-flagged. The local-def scan must match the quoted/bracketed object-key forms too.

## Design — two parts

### Part A — capture the per-frame Figma token map at import (name → value)

At Figma import, `resolveTokens` (`server/figmaIngest.ts:270`) already yields `tokens.colors: Record<figmaVarName, hexValue>` for tokens bound in the imported node. Persist that map **per-frame**, beside the generated frame, in a shape the edit-time hook can read offline (e.g. a `figma-tokens.json` sidecar in the frame dir, or a field in the frame's LIFT manifest — confirm the exact carrier at plan time; `LIFT.json`'s currently-empty `tokenPatches`/`valueMap` are candidate homes). Keys are normalized to the kit custom-property form via the existing `figmaVarNameToKitToken` (`BG/Expressive/Orange/Subtle → --bg-expressive-orange-subtle`), values are the literal Figma color. This is the offline record of "what real DS tokens/values this frame legitimately uses," paid once at import, zero edit-path latency, no Enterprise/live dependency when editing.

### Part B — validate references at edit time (extend the shipped token hook)

Extend `studio/server/hooks/validateTokenClasses.mjs` (already a PostToolUse Write/Edit hook that catches the *named-form* token no-op and self-corrects via exit-2). Add a paren/var-form resolvability check, scoped to generated frame files only:

1. **Build the resolvable set** (fail open — empty → skip): normalize-and-union the token NAMES from all render-time sources listed above, PLUS the per-frame Figma map keys.
2. **Build the Figma value map** for this frame: `--x → hexValue` from the persisted sidecar.
3. **Extract every `--custom-property` reference** in the post-edit source via `(--x)` / `var(--x)` (one regex covers `bg-(--x)`, `var(--x)`, `[var(--x)]`), requiring ≥1 internal hyphen so JS `(--i)` is never captured.
4. **Classify each reference:**
   - **Resolvable** (in the render-time set, incl. project overrides + local defs) → OK.
   - **Real-in-Figma but absent from rendered CSS** (in the per-frame Figma value map, not in the render-time set) → NOT a silent success, but NOT a plain typo either: the token is real, the kit just doesn't ship it. Per the `resolveKitTokenVar` precedent, exit-2 instructing the agent to **use the literal Figma value** (e.g. `bg-[#fcecd2]` arbitrary value, or an inline style) — the shipped "hex fallback, never a dead var" behavior, applied at edit time.
   - **Dead everywhere** (not resolvable, not in the Figma map) → a typo/hallucination → exit-2 flagging it, with nearest-real suggestions drawn from the render-time set ∪ Figma map (so a mangled `--bg-orange-subtle` is answered with the real `--bg-expressive-orange-subtle = #fcecd2`).
5. **Fail open** at every step (unreadable CSS/sidecar → skip that source; empty resolvable set → skip the check).

The exact end-state the agent writes (arbitrary-value `bg-[#fcecd2]` vs. inline style vs. defining the token in `theme-overrides.css`) follows the shipped hex-fallback precedent = **literal value**; do NOT auto-mutate other files from the hook (a validator must not write). The agent performs the correction; the hook re-validates.

### Why this satisfies the decisions
- Static (re-reads written source + offline sidecar; no render) ✅ #1.
- Resolvability-only; local + author + Figma-real vars all exempt → no false alarms ✅ #2.
- Silent exit-2 self-correct before "done" ✅ #3.
- Custom-property refs in scope; class names out ✅ #4.
- Figma is truth; local CSS is the mirror; per-frame Figma map bridges the gap ✅ #5.
- Map = tokens used in this frame ✅ #6.

## The motivating bug, traced end-to-end on this design
Agent writes `bg-(--bg-orange-subtle)` → extracted ref `bg-orange-subtle` → not in render-time set, not in the Figma map (the map has `--bg-expressive-orange-subtle`, the *un*-mangled name) → **dead everywhere → exit-2**, message: "`--bg-orange-subtle` is undefined; the real Figma token for this frame's background is `--bg-expressive-orange-subtle` (#fcecd2), which the kit doesn't ship — use `bg-[#fcecd2]`." Agent rewrites, hook passes, turn completes with a visible orange background. No more "I did it" over an unchanged frame.

## Correction loop
Identical mechanism to the named-form check already shipping in this file: `exit(2)` returns the message as a tool error; the agent rewrites; the hook re-runs and passes; the turn completes showing only the corrected result. Synchronous at write time (a dead token is a no-op, not a browser crash), so no dispatch/timer/chat surface and no interaction with the resilient-render HMR/overlay changes.

## Immediate one-frame fix (data, separate from the code change)
The live repro frame stays wrong until re-touched. `--bg-orange-subtle` → `bg-[#fcecd2]` (the Figma value for `BG/Expressive/Orange/Subtle`) in that frame's `index.tsx:9`. A data fix to one project file, done at manual-acceptance; not committed to the repo.

## Non-goals (explicit)
- **Tailwind class-name validation** — infinite/on-demand space; not statically decidable without the compiler; would break no-false-alarms. Residual: a misspelled *utility* class (not a var) still silently no-ops. (The *named-form* token utility no-op IS already caught by this hook's existing check.)
- **Rendered/pixel verification** — fidelity keystone; separate.
- **Intent-matching**; **wrong-element / overridden-value** no-ops — not statically detectable.
- **Full-file Figma token pull** — capture is node-scoped (#6); a later-introduced token outside the original node is a known gap.
- **Live Figma lookup on the edit path** — rejected for latency + Enterprise-gating of the Variables REST API; capture happens once at import instead.
- **Hook writing to other files** (e.g. auto-appending to theme-overrides.css) — a validator stays a validator; the agent does the correction.
- **Filling the arcade-gen coverage gap** (shipping an expressive-orange family) — a real kit-vs-Figma gap tracked separately (kit-emit mapping work).
- **Phantom edits** — separate spec.

## Files (indicative — confirm exact carriers at plan time)
| File | Change |
|---|---|
| `studio/server/figmaIngest.ts` (or the frame-authoring path in `server/middleware/lift.ts` / `liftEmitPlugin.ts`) | Part A: persist the per-frame Figma token map (`tokens.colors`, keys normalized via `figmaVarNameToKitToken`, values = Figma hex) as a sidecar the edit hook can read. Reuse existing `resolveTokens` output; do not add a fetch. |
| `studio/server/hooks/validateTokenClasses.mjs` | Part B: build the FULL render-time resolvable set (styles.css ∪ tailwind.css @theme ∪ arcade-gen-patches.css ∪ project theme-overrides.css ∪ same-file local defs ∪ per-frame Figma map); fix local-def extraction to match React object-key syntax; add `extractTokenRefs` + `detectDeadTokenRefs` (real-in-Figma → suggest literal value; dead-everywhere → suggest nearest real); wire into `main()` alongside the existing named-form check; frame-files-only scope. Reuse `loadTokenNames`/`extractTokenNames`/`parseClassNames`; fail open throughout. |
| `studio/server/figma/kitTokens.ts` | Possibly expose a shared normalizer/helper (`figmaVarNameToKitToken` already exists) so import-capture and edit-validation agree on the `--x` key form. |
| `studio/__tests__/server/hooks/validateTokenClasses.test.ts` | dead-everywhere ref → exit 2 + nearest suggestion; real-in-Figma-map ref → exit 2 suggesting the literal value; render-time-set refs (incl. a `@theme` token like `--shadow-elevation-02` and a project-override token) → exit 0 (no false alarm); React object-key local var `{ "--x": v }` referenced via `var(--x)` → exit 0; both `(--x)`/`var(--x)` forms; fail-open on unreadable sources. Port the `runHook`/`tmpFrame` harness from `validateArcadeImports.test.ts` and write files under a `/projects/<slug>/frames/<id>/` path (so the frame-file scope matches); this hook reads `new_string`, so the integration case uses `Write` with full content (NOT an Edit relying on disk read). |
| `studio/__tests__/server/figmaIngest.test.ts` (or the ingest test) | Part A: an imported node with a bound variable persists the normalized name→value entry. |
| project frame `01-figma-4368-19734/index.tsx` (data, not code) | one-frame fix: `bg-(--bg-orange-subtle)` → `bg-[#fcecd2]`. Manual-acceptance step. |

## Open questions (resolve in the plan)
1. **Exact per-frame carrier for the Figma map** — new `figma-tokens.json` sidecar in the frame dir, vs. populating `LIFT.json.tokenPatches`/`valueMap`. Confirm which the frame-authoring path can write and the hook can locate from `file_path`.
2. **Value form the agent should emit** for a real-in-Figma/absent-from-kit token — the spec picks the shipped precedent (literal value, `bg-[#hex]`). Confirm the message wording drives that, not a dead re-spelling.
3. **Nearest-real suggestion ranking** — leading-segment prefix over (render-time set ∪ Figma map); cap the list; no fuzzy color matcher (YAGNI).
4. **Cost** — the hook is a spawned process per PostToolUse (module-scope cache doesn't persist across invocations); parsing 3 CSS files + one small sidecar per edit is negligible vs. the Bedrock round-trip; confirm no measurable regression.
