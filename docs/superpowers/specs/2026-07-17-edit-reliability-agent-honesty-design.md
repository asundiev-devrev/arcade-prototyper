# Edit reliability — "when the agent says it did it, it did it"

**Date:** 2026-07-17 (rev. 2 — re-pointed at the CORRECT code layers after adversarial review found all three rev-1 insertion points wrong)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Fifth sibling. The prior four keep a broken result off-screen / self-correct bad references. This one targets the class underneath the manual-testing findings: **the agent reports success on a change it did not actually make.** Per the user: *"I'm most concerned about 'said it did, didn't.' We can always improve components — but the agent's behaviour is the key."*

## The experience goal

> **A designer should be able to trust "done." When the agent says it changed something (and reports "Deviations: None"), that claim should be real — and when it improvised or couldn't do the ask, it says so plainly rather than faking a clean success.**

**Honest coverage bound (adversarial-review Important):** this feature does NOT make the agent incapable of ever lying. Part C (the hard write-time check) catches a BOUNDED denylist of known-invented props/shapes (seeded from real repros); an un-enumerated hallucination on an un-covered component still passes. Parts A (know-limits manifest) + B (honest-report discipline) push the long tail softly. So the realistic claim is "the known false-success classes are caught hard; the rest is nudged, not guaranteed" — not "the agent never claims a success it didn't deliver." The general guarantee is the render-verify keystone, out of scope.

## Live repro (root-caused, confirmed against code)

Project `computer-settings`, frame `01-computer-settings`. User asked to change three `Select` controls in `Preferences.tsx` to **multi-select**. arcade-gen's `Select` is Radix-based: `Select.Root` has **no `multiple` prop**, and `defaultValue?: string` (a string, NOT an array — verified in `@radix-ui/react-select` `index.d.ts:25`). The agent wrote `<Select.Root multiple defaultValue={["india"]}>` on all three and reported:

> "Changed all three Select controls in Preferences to multi-select mode. **### Deviations: None.**"

Two failures, one root:
- `multiple` → an unknown prop, silently ignored → no multi-select happened (it doesn't exist in the kit). **"said it did, didn't."**
- `defaultValue={["india"]}` → an ARRAY where the contract wants a STRING → that Select is now broken at runtime.

**The behavioral root cause:** the agent's turn-end summary ("Changed X. Deviations: None") is asserted from **what it INTENDED**, never checked against **what the kit can actually do** or **what it actually wrote**. It "knew" `multiple` from native `<select>`/other libraries, never checked arcade-gen's Select, and defaulted to "Deviations: None." Confirmed: the shipped `deviationsContract.ts` only verifies a `### Deviations` HEADING EXISTS (`hasDeviationsSection` = a regex for the header) — it never checks the content is TRUE. And `KIT-MANIFEST.md` documents composites/slots but carries no per-component PROP contract the agent could have checked `multiple`/`defaultValue`-shape against.

## Scope decision (locked with the user)

Fix the **agent's behavior**, not the component. Two mechanisms (user chose BOTH):
1. **Know the limits (prevent):** give the agent an authoritative per-component capability/prop contract so it knows BEFORE trying that `Select` has no `multiple` and `defaultValue` is a string — and answers "the kit's Select is single-value; there's no multi-select — here's the closest / want me to fake it visually?" instead of inventing a prop.
2. **Verify before claiming done (detect):** the turn-end discipline must require the agent to CHECK each claimed change against the real capability contract + what it wrote, and honestly report as a **Deviation** anything it improvised (invented prop, substituted component, couldn't fulfill), rather than "Deviations: None."

Explicitly OUT: the general "did the pixels change" render-verify keystone (separate, heavy). This spec is behavioral — cheaper and directly on the user's priority.

## Design — three changes at the CORRECT layers (all in-repo, verified)

Rev-1 named three insertion points; adversarial review + direct code-verification proved ALL THREE wrong. The strategy (know-limits + verify-before-claiming) is right; the layers are corrected here.

### Part A — a primitives capability/prop block, RENDERED by the manifest generator (not hand-edited)
**Correction:** `prototype-kit/KIT-MANIFEST.md` is AUTO-GENERATED (`server/kitManifest.ts` `writeManifest`, regenerated on every studio `buildStart` via `kitManifestPlugin.ts:47`; the file header literally says "DO NOT edit by hand"). A hand-added section is wiped on next boot. Also: `Select` is an **arcade-gen primitive**, NOT in the manifest at all (the manifest only enumerates prototype-kit composites/templates). So Part A is NOT a hand edit to the `.md`.
- Add the capability block to the manifest RENDERER: `renderManifestMarkdown` (`kitManifest.ts:302`) emits a new static "Primitive capabilities" section built from a small checked-in table IN `kitManifest.ts` (source of truth), so it survives regeneration and ships into the agent's context automatically (the manifest reaches EVERY turn via `--append-system-prompt`, `claudeCode.ts:313` — verified: edit turns see it).
- The table lists, for the props-bearing primitives agents reach for (Select, ToggleGroup, Tabs, Switch, Input, Button — start with the ones already seen misused), the real prop surface + notable ABSENCES + value shapes. Lead entry (the repro): **`Select` — single-value; `value`/`defaultValue` are STRINGS; there is NO `multiple` prop and NO multi-select control in the kit.**
- Keep it small + high-value (the props agents actually hallucinate), not an exhaustive dump. This is the "know the limits" half — soft prevention (the append-system-prompt region is "obeyed more loosely" per `claudeCode.ts:14`), so the HARD guarantee is Part C.

### Part B — reword the turn-end honesty contract at its REAL source (`CLAUDE.md.tpl`), and stop training the "None." default
**Correction:** the Deviations contract is NOT in `visualEditPreamble.ts`/`editContext.ts` (rev-1's guess — both merely mention it in passing; the picker preamble contains the word "Deviations" ZERO times, so rev-1's Open-Q2 premise was false). It is authored in **`studio/prototype-kit/templates/CLAUDE.md.tpl` §"Response shape" (lines 68-112)**, rendered into each project's `CLAUDE.md` and loaded from the spawn cwd — the "obeyed harder" instruction source (`editContext.ts`, `claudeCode.ts:19`).
- **Line 75 actively trains the bug:** *"Even a trivial edit gets `### Deviations\n\nNone.` appended"* presents `None.` as the happy-path default. Reword so **`None.` is a VERIFIED claim, not a template default**: `None.` is permitted ONLY when every component/prop/token used exists in the kit AND the literal ask was fulfilled with no improvisation. If you used a prop/component the kit doesn't have, or couldn't do the ask (e.g. the kit has no multi-select), that is a Deviation — state what was asked, what the kit supports, what you did instead. "Uncertainty counts as a deviation" (line 101) already exists — extend that spirit to "invented capability / unfulfilled ask counts as a deviation, never None."
- This is the strong behavioral lever (cwd `CLAUDE.md`, obeyed hard). Still soft (LLM instruction-following), so Part C is the backstop.

### Part C — a fourth PostToolUse hook: the HARD guarantee (AST-detect invented props at write time)
**Correction:** rev-1 assigned enforcement to `deviationsContract.ts` — which sees only the agent's NARRATION text + per-file HASHES (`chat.ts:768` `narrationTexts`; `frameChangeContract` stores `{hash,size}`, discards content). It CANNOT see `<Select.Root multiple>` in the written `.tsx`. Enforcement must live where the written source is readable: the PostToolUse hook layer (`validateArcadeImports.mjs`/`validateTokenClasses.mjs` read the edited file from disk + `ts.createSourceFile` AST-walk + `exit(2)` self-correct — verified).
- Add a fourth hook `studio/server/hooks/validateComponentProps.mjs`, registered alongside the others (`claudeCode.ts:276`, `Write|Edit` matcher). It AST-walks the written frame source for a **bounded denylist of known-invented props/shapes** on kit components — seeded from real repro classes: `Select`/`ToggleGroup`/`Tabs` with a `multiple` prop; a `defaultValue`/`value` given an ARRAY literal where the contract wants a string. On a hit → `exit(2)` with a self-correct message ("`Select` has no `multiple` prop and `defaultValue` is a string, not an array; the kit has no multi-select — leave it single-value or approximate + note it as a Deviation"). Fail open; frame-files-only scope; mirror the shipped hooks' structure.
- **Scope honesty (Open Q1):** this is a targeted denylist, NOT a general prop typechecker (that's keystone-adjacent). It catches the repro + its class and grows by adding rows, exactly like `kitMappings`/the token seed. State plainly: it does NOT catch every possible invented prop — un-enumerated hallucinations still pass. That's the accepted v1 boundary; Parts A+B (prevention + honest-report discipline) cover the long tail softly.

## Why this matches the user's priority
- Behavior-first: the agent stops claiming false success; when it can't do a thing, it says so (the "said it did, didn't" fix).
- Doesn't wait on the component or the render keystone — a manifest + a turn-contract change, both extending shipped systems.
- The broken-Select half is a downstream symptom of the same behavior (inventing a prop); once the agent stops inventing `multiple`/array-`defaultValue`, that frame doesn't break either.

## The motivating bug, traced
User asks for multi-select → Part A tells the agent "Select is single-value, no `multiple`" → agent does NOT write `<Select.Root multiple>`; instead it either approximates and reports the approximation as a Deviation, or says "the kit has no multi-select control — the Selects stay single-value; want me to fake the look?" → the user gets the truth, not a false "done, no deviations," and the frame isn't broken by an invented prop.

## Non-goals (explicit)
- **Render/pixel verification** ("did the result visibly change") — the fidelity keystone; separate.
- **Full static prop typechecking** of every component/prop — keystone-adjacent; Part B targets the *known-hallucinated* surface (real, bounded), not a general typechecker.
- **Adding multi-select (or any component) to the kit** — the user was explicit: fix behavior, not components. Kit gaps are tracked separately.
- **The other three shipped hooks** (import-path, dead-token, class-form) — unchanged; this is a distinct class (prop/capability honesty).
- **Phantom edits** (wrote nothing at all) — the existing `phantomEditRetry.ts` path; related but separate.

## Files (indicative — confirm at plan time; all verified against the real repo)
| File | Change |
|---|---|
| `studio/server/kitManifest.ts` | Part A: a checked-in `PRIMITIVE_CAPABILITIES` table (Select/ToggleGroup/Tabs/Switch/Input/Button → real props + absences + value shapes) + render it as a new "Primitive capabilities" section in `renderManifestMarkdown` (`:302`). Survives regeneration; ships to every turn via the manifest append-system-prompt. Lead row: Select = single-value / string `value`+`defaultValue` / NO `multiple`. |
| `studio/prototype-kit/templates/CLAUDE.md.tpl` (§"Response shape", ~`:73-75`) | Part B: reword so `### Deviations … None.` is a VERIFIED claim, not the appended default — `None.` only when every component/prop/token used is real AND the literal ask was fulfilled; an invented prop / absent capability / unfulfilled ask is a Deviation, never None. (Do NOT touch `deviationsContract.ts` for prop-detection — it's narration+hash-only, structurally can't see the written prop.) |
| `studio/server/hooks/validateComponentProps.mjs` (NEW) + `studio/server/claudeCode.ts` (`:276` register a 4th PostToolUse `Write|Edit` hook) | Part C: AST-walk the written frame source (read from disk + `ts.createSourceFile`, mirroring `validateArcadeImports.mjs`) for the bounded denylist — `multiple` prop on Select/ToggleGroup/Tabs; array literal for a string-typed `value`/`defaultValue`. Hit → `exit(2)` self-correct. Fail open; frame-files-only. |
| `studio/__tests__/server/hooks/validateComponentProps.test.ts` (+ manifest + template tests) | Part C: `<Select.Root multiple>` → exit 2 naming the real contract; `defaultValue={["x"]}` → exit 2 (array-where-string); a legit `<Select.Root defaultValue="x">` → exit 0 (no false alarm); fail-open on unreadable. Part A: a drift-guard — the `PRIMITIVE_CAPABILITIES` "no `multiple`"/"string defaultValue" facts for Select match the REAL type (resolve `@xorkavi/arcade-gen` `.d.mts` → `SelectPrimitive.SelectProps` → `@radix-ui/react-select` `index.d.ts:defaultValue?: string`); the transitive-type resolution is nontrivial (see Open Q3) — at minimum assert component NAMES exist as exports, and hand-verify the prop facts with a comment citing the radix `.d.ts` line. |

## Open questions (resolve in the plan)
1. **Part C denylist v1 contents** — seed from the confirmed repro classes: `multiple` on Select/ToggleGroup/Tabs (none support it); an ARRAY literal passed to `value`/`defaultValue` on a Select. Grows by adding rows as new false-success classes surface (like `kitMappings` / the token seed). Bounded, not a general typechecker — stated in the goal bound.
2. **`CLAUDE.md.tpl` reword wording** — the `None.`-as-default line (`:75`) is the lever. Confirm the reworded rule reads clearly for the model AND doesn't over-trigger deviations on legitimate clean edits (a real clean edit should still say `None.`). The existing "Uncertainty counts as a deviation" (`:101`) is the tone to match.
3. **Drift-guard depth** — asserting the manifest's prop facts ⊆ the real types requires resolving `@xorkavi/arcade-gen` `.d.mts` → Radix `SelectProps` (a separate package, `Omit`/generics). Full transitive resolution is heavy; v1 recommendation: assert component NAMES are real exports (cheap) + a hand-authored comment in `PRIMITIVE_CAPABILITIES` citing the source `.d.ts` line for each "absence" fact, so a reviewer can re-verify. Decide whether deeper automated resolution is worth it.
4. **Regeneration ordering** — confirm the Part-A section rendered from `kitManifest.ts` lands in the committed `KIT-MANIFEST.md` after a normal `writeManifest`/boot, so the checked-in artifact and the runtime-fed manifest agree (don't leave the repo's `.md` diverging from what the generator now emits).
