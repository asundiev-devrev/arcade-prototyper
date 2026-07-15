# Edit reliability — "an edit that renders nothing must not report success"

**Date:** 2026-07-15 (rev. 2 — corrected after adversarial review + repo verification)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Sibling of the shipped resilient-render work (crash class). This covers the **silent-no-op class**: the agent reports a change as done, but the result doesn't change — no crash, no error, nothing caught it.

## The experience goal (what the user cares about)

> **If the tool says it made your change, your change is visible. It never claims success on an edit that renders nothing.**

Live repro that motivated this (2026-07-15, project `implement-this-precisely`, frame `01-figma-4368-19734`): user asked to set the background to `bg/expressive/orange/subtle`. The agent wrote `className="bg-(--bg-orange-subtle)"`, reported success, and **the background did not change.** Root cause: `--bg-orange-subtle` is not a real design-system token (the agent dropped "expressive"; and the correctly-spelled `--bg-expressive-orange-subtle` isn't even shipped in arcade-gen — only blue + yellow expressive families are). `bg-(--bg-orange-subtle)` is *valid Tailwind v4* — it compiles to `background-color: var(--bg-orange-subtle)`. The **class is fine; the variable it references is dead** → resolves to nothing → the paint is a no-op that compiles cleanly and never throws. The agent verified "I wrote the code I intended," never "the reference resolves to something real."

## Scope decisions (locked with the user)

1. **Static, not rendered.** Verify the *code the agent wrote*, not the rendered pixels. Pixel-diff verification is the fidelity-metric keystone — heavy, its own runtime, explicitly OUT (see [[studio-fidelity-metric-keystone]]).
2. **Resolvability only, not intent-matching.** One objective question per reference — *does it resolve to a real definition?* — never "did it match what the user asked." No false alarms is a hard requirement.
3. **Auto-fix silently, like the crash path.** On a dead reference, feed the agent the specific violation and let it self-correct **before the turn reports done**; the user sees only the corrected result. Reuse the existing exit-2 → self-correct lane, don't build a new surface.
4. **Design-token custom properties are the in-scope reference type. Tailwind class-name existence is OUT** (see Non-goals).

## The key realization (why this is small)

There is **already a shipped PostToolUse hook for exactly this family of bug**: `studio/server/hooks/validateTokenClasses.mjs`. It catches the *named-form* token no-op (`text-fg-neutral-medium` — a class that compiles to nothing in Tailwind v4, the "unstyled frame" bug). It already:
- loads the **real, rendered** token set via `loadTokenNames()` → `extractTokenNames(styles.css)` (resolves `@xorkavi/arcade-gen` → `dist/styles.css`, the file every frame actually imports at render — `frameMountPlugin.ts:259`, `main.tsx:3`; present on the packaged DMG),
- parses classNames string-preservingly (`parseClassNames`),
- fails open on unreadable CSS, and
- `process.exit(2)` with a self-correcting message.

**This bug is the exact complement of what that hook already does.** At `validateTokenClasses.mjs:73` the detector does `if (cls.includes("(--") || cls.includes("[")) continue;` — it *skips* the paren/arbitrary form, because a paren-form class is assumed valid. But `bg-(--x)` is only valid **if `--x` resolves.** The repro token slips through precisely because it uses the paren form the hook skips. So the fix is: **stop skipping the paren form blindly — instead, extract the `--x` inside it and verify that token is defined.** Same file, same token set, same exit-2 lane. ~15 lines, not a new hook.

### Correction from review (do not repeat the rev-1 error)
Rev-1 wrongly claimed DS tokens live in `tokens.css` and that `styles.css` "defines zero tokens." **False.** `styles.css` is the minified, rendered stylesheet and defines the full DS token set (e.g. `--core-marmalade-orange-200:#fcecd2`, `--bg-expressive-yellow-subtle`); `tokens.css` is a superset-of-names used only by the server-side Figma-export path and is **never loaded into a rendered frame**. The definition source of truth is **`styles.css`** — which is exactly what `loadTokenNames()` already reads. Verified: `--bg-orange-subtle` → 0 hits in `styles.css` (correctly dead); `--core-marmalade-orange-200` → present. Reusing `loadTokenNames()` gives the correct source for free.

## Design — extend the existing token hook to check paren-form var resolvability

All changes in `studio/server/hooks/validateTokenClasses.mjs`.

### New detector: `detectDeadTokenRefs(source, tokenNames)`
1. **Reference extraction.** Scan the post-edit source for custom-property REFERENCES in both syntactic forms:
   - `(--x)` — Tailwind v4 arbitrary-var shorthand (`bg-(--bg-foo)`, `text-(--fg-foo)`, `border-(--stroke-foo)`).
   - `var(--x)` — inline styles (`style={{ background: "var(--bg-foo)" }}`) and CSS strings. (`[var(--x)]` bracket form contains the same `var(--x)` and is captured by it.)
   Use the source directly (references live *inside* `className="…"` and `style={{…}}` string literals — do NOT strip strings).
2. **Classify DS vs. local.** A reference is a candidate only if its name is **not defined locally in the same file** (an author's own `--my-thing` set inline in a `style`/CSS block is legitimate). "DS-owned" is determined by set membership, not a hand-maintained prefix list: the token is either in `tokenNames` (the loaded `styles.css` set) or it is not. To avoid false-flagging a genuinely author-local var, exempt any `--name` that appears in a `--name:` **definition** within the same file (reuse `extractTokenNames` on the source itself to get the locally-defined set).
3. **Dead reference = referenced, not in `tokenNames`, not locally defined.** Collect one violation per distinct dead reference.
4. **Fail open:** if `tokenNames` is empty (CSS unreadable), return `[]` — never block on our own inability to load the DS (existing contract).

### Wire into `main()`
Run `detectDeadTokenRefs` alongside the existing `detectTokenClassViolations`; union the violations; if any, `exit(2)` with a combined message. Extend `formatTokenClassError` (or add a sibling formatter) so a dead-token violation reads precisely, with **nearest real tokens in the same family** so the agent picks a real one instead of inventing another — e.g. for `--bg-orange-subtle`: "undefined in the design system. Real backgrounds in this family: `--bg-expressive-blue-subtle`, `--bg-expressive-yellow-subtle`. A literal orange: `--core-marmalade-orange-200`." "Same family" = shipped tokens sharing the longest leading name prefix; a simple prefix match over `tokenNames`, **no fuzzy color-distance matcher** (YAGNI).

### Why this satisfies the four decisions
- Static (re-reads written source; no render) ✅ #1.
- Resolvability-only (a `--x` is in the loaded set or not; local + author vars exempt via same-file definition scan → no false alarms) ✅ #2.
- Silent auto-fix via the proven exit-2 lane, before "done" ✅ #3.
- Custom-property references in scope; class-name existence out ✅ #4.

## The correction loop (reuses what exists)
`exit(2)` from this PostToolUse hook returns the stderr message to the agent as a tool error; the agent rewrites with a real token; the hook re-runs on the new write, passes; the turn completes — the user sees only the corrected, visible result. Identical mechanism to the named-form check already shipping in this same file. A dead token is caught **synchronously at write time**, so — unlike the crash class (async `/api/runtime-error` → `dispatchAutoFix`, needed because a crash happens at browser render time) — no dispatch/timer/chat surface is required. The resilient-render HMR-suppression / overlay changes don't interact: a dead token is a no-op, not a crash, so the double-buffer never engages; the corrected write simply lands before "done."

## Immediate one-frame fix (data, separate from the hook change)
The live repro frame stays wrong until re-touched. Ground truth from Figma (`get_variable_defs`, node 4368-19734): the background variable is `BG/Expressive/Orange/Subtle = #fcecd2`, which equals the DS token `--core-marmalade-orange-200`. One-frame correction: `bg-(--bg-orange-subtle)` → `bg-(--core-marmalade-orange-200)` in that frame's `index.tsx:9`. A data fix to one project file; done as the manual-acceptance step, not part of the hook code.

## Non-goals (explicit)
- **Tailwind class-name validation** — Tailwind v4 generates classes on demand from an effectively infinite space (arbitrary values/properties); not statically decidable without running the compiler; would break the no-false-alarm rule. Residual: a misspelled *utility* class (not a var) still silently no-ops. (Note: the *named-form* token utility no-op IS already caught by this hook's existing `detectTokenClassViolations` — so the silent-no-op class is more defended than it first appears.)
- **Rendered/pixel verification** — the fidelity keystone; separate spec.
- **Intent-matching**; **wrong-element / overridden-value** no-ops (real token, no visible effect) — not statically detectable without render.
- **Dynamic references** (`` className={`bg-(--${x})`} ``) — the name isn't a literal; won't match extraction. A silent MISS (not a false alarm), acceptable under #2.
- **Filling the DS gap** — arcade-gen shipping no expressive-orange family is a real kit-vs-Figma coverage gap tracked separately (kit-emit mapping work); this spec makes the agent pick a *real* token, it does not add missing tokens.
- **Phantom edits** (agent writes nothing / wrong file) — separate spec.

## Files (indicative)
| File | Change |
|---|---|
| `studio/server/hooks/validateTokenClasses.mjs` | add `detectDeadTokenRefs(source, tokenNames)` (extract `(--x)` + `var(--x)` refs; exempt same-file-defined vars via `extractTokenNames(source)`; flag refs absent from the loaded `styles.css` token set); call it in `main()` alongside `detectTokenClassViolations`; extend the error formatter with nearest-real-token suggestions (prefix match, no fuzzy matcher). Reuse `loadTokenNames`/`extractTokenNames`/`parseClassNames` — do NOT add a second token loader. |
| `studio/__tests__/server/hooks/validateTokenClasses.test.ts` (or the existing sibling test file) | dead DS ref `bg-(--bg-orange-subtle)` on Edit → exit 2 + names the token + suggests a real one; real ref `bg-(--bg-expressive-yellow-subtle)` → exit 0; author-local `var(--my-x)` where `--my-x:` is defined in the same file → exit 0 (no false alarm); both `(--x)` and `var(--x)` forms detected; unreadable CSS (empty token set) → exit 0 (fail open); ensure the existing named-form tests still pass (union didn't regress them). |
| project frame `01-figma-4368-19734/index.tsx` (data, not code) | one-frame fix: `bg-(--bg-orange-subtle)` → `bg-(--core-marmalade-orange-200)` (Figma ground truth #fcecd2). Manual-acceptance step. |

## Open questions (resolve in the plan)
1. Nearest-real-token suggestion: longest-shared-prefix over `tokenNames` is enough; confirm the message stays short (cap the suggestion list, e.g. top 3).
2. Combined-message shape when BOTH a named-form violation and a dead-ref violation occur in one write — one stderr block, two labeled sections, or sequential. Decide in the plan; keep it one exit-2.
3. Cost: `loadTokenNames()` already parses `styles.css` on every Write/Edit in this shipped hook (the hook is a spawned process per PostToolUse — module-scope caching buys nothing across invocations, so don't add it). Adding a second pass over the same source for `detectDeadTokenRefs` is negligible vs. the Bedrock round-trip; confirm no measurable regression.
