# Edit reliability — "when the agent says it did it, it did it"

**Date:** 2026-07-17
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Fifth sibling. The prior four keep a broken result off-screen / self-correct bad references. This one targets the class underneath the manual-testing findings: **the agent reports success on a change it did not actually make.** Per the user: *"I'm most concerned about 'said it did, didn't.' We can always improve components — but the agent's behaviour is the key."*

## The experience goal

> **A designer must be able to trust "done." If the agent says it changed something (and reports "Deviations: None"), the change is real. If it couldn't do the ask, or improvised, it says so plainly — it never claims a clean success it didn't deliver.**

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

## Design — two extensions to shipped systems (no new subsystem)

### Part A — a per-component capability/prop contract in the kit manifest
`KIT-MANIFEST.md` + `server/kitManifest.ts` already feed the agent kit knowledge, but describe composites/slots, not primitive-component prop contracts. Add a concise, authoritative **capability section** the agent consumes each turn: for the props-bearing kit primitives an agent commonly reaches for (Select, ToggleGroup, Tabs, Switch, Input, Button, …), list the real prop surface + notable ABSENCES and value shapes, sourced from the real types (`@xorkavi/arcade-gen` `dist/index.d.mts` → the underlying Radix `.d.ts`). At minimum it must state the things agents hallucinate:
- `Select`: single-value; `defaultValue`/`value` are **strings**; **no `multiple`** (the kit has no multi-select control at all).
- (enumerate the analogous gotchas for the other common primitives — the ones with a tempting-but-absent prop or a non-obvious value shape).
This is the "know the limits" half. It is a **static, checked-in** doc/table (like the ADS token seed) — not a live type-introspection at turn time. Keep it small and high-value (the props agents actually get wrong), not an exhaustive dump. Note the maintenance cost honestly: it must be refreshed when the kit's component surface changes (a guard test can diff it against the real `.d.mts` exports to catch drift — see Files).

### Part B — a truthful turn-end self-check (the honesty enforcement)
Extend the deviations contract from "a heading exists" to "the claims are honest." The turn-end discipline (the system-prompt/preamble instruction the agent follows) must require, BEFORE writing the Deviations section:
- **Re-read what you wrote** for this turn's edits.
- **Every kit component/prop/token you used must exist** in the capability contract (Part A) + the kit. If you used a prop or component the kit does NOT have (e.g. `Select multiple`), that is a Deviation — name it: what you were asked, what the kit actually supports, what you did instead.
- **If you could NOT do the literal ask** (the capability doesn't exist — multi-select), you MUST say so: "the kit has no multi-select; I left the Selects single-value / approximated it with X" — NOT "Deviations: None."
- **"Deviations: None" is a claim, not a default** — it is only permitted when the change was fully made using real kit capabilities with no improvisation.

The enforcement is the honest-report DISCIPLINE + (where cheaply checkable) a server-side guard: the existing `deviationsContract.ts` already appends a trailer when the heading is missing; extend the check so that when the turn's edits contain a **known-nonexistent prop/component** (detectable from the capability contract — e.g. `Select` used with `multiple`), a "Deviations: None" claim is FLAGGED — either fed back to the agent (exit-2 self-correct, like the other hooks) or annotated in the trailer so the user sees "the agent claimed no deviations but used `multiple`, which the kit's Select doesn't support." (Decide the exact enforcement strength in the plan — a full prop-typecheck is keystone-adjacent; a targeted "flag the known-hallucinated props" check is bounded and catches this repro.)

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

## Files (indicative — confirm at plan time)
| File | Change |
|---|---|
| `studio/prototype-kit/KIT-MANIFEST.md` (+ `server/kitManifest.ts` if it assembles the fed context) | Part A: add a concise per-primitive capability/prop-contract section (real props + notable absences + value shapes) for the common props-bearing components; lead with the `Select` = single-value / no `multiple` / string `defaultValue` entry. |
| the agent edit-turn system prompt / preamble (`server/deviationsContract.ts` companion — find where the Deviations instruction text is authored; `src/lib/visualEditPreamble.ts` / `server/editContext.ts` are candidates) | Part B: strengthen the turn-end discipline — verify claimed changes against the capability contract before writing Deviations; "None" only when no improvisation; name any invented prop/absent capability as a Deviation. |
| `studio/server/deviationsContract.ts` | Part B enforcement: extend beyond heading-exists — when the turn's edits use a known-nonexistent prop/component (from the capability contract) while claiming "Deviations: None", flag it (exit-2 feedback or trailer annotation). Decide strength in the plan. |
| `studio/__tests__/...` | manifest carries the Select capability entry; a drift-guard test diffs the manifest's claimed props against the real `@xorkavi/arcade-gen` `.d.mts` (catches manifest going stale); the deviations check flags a "Deviations: None" turn that used `Select multiple`; does NOT false-flag a legitimate real-prop change. |

## Open questions (resolve in the plan)
1. **Enforcement strength of Part B** — full prop-typecheck (keystone-adjacent, too big) vs. a targeted "known-hallucinated props" denylist seeded from real repro classes (`Select multiple`, array `defaultValue`, …) that grows over time. Recommend the targeted denylist for v1 — bounded, catches the repro, honest about not being exhaustive.
2. **Where the turn-end discipline text actually lives** — locate the authored Deviations instruction (system prompt vs. preamble vs. picker-instruction) and confirm it's the right insertion point; the picker instruction the user's turn showed ("Deviations: None" as the happy shape) may be reinforcing the false-default and need rewording too.
3. **Manifest scope** — which primitives to cover in v1 (the ones with tempting-absent props / non-obvious value shapes). Start with Select + the components already seen misused (Tabs/ToggleGroup from the earlier session); don't boil the ocean.
4. **Drift guard** — how to keep the capability contract honest against kit upgrades (a test asserting the manifest's per-component props are a subset of the real exported prop types).
