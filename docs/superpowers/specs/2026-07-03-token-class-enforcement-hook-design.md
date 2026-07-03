# Token-class enforcement hook — design

Date: 2026-07-03
Branch: `feat/figma-fidelity-eject` (or a fresh branch)
Status: design — pending user review (recommended detection rule chosen on best judgment while user was away; re-confirm before implementation)

## Problem

A generated frame (`implement-this-design-precisely-3/01-navigation-digest`) rendered almost
entirely unstyled — flat text, no colors, no backgrounds — despite being a "really simple"
design. Root cause, verified against real files:

The agent wrote design-token utility classes in the **named form**:
`text-fg-neutral-medium`, `bg-surface-shallow`, `bg-intelligence-prominent`,
`border-stroke-neutral-subtle`, `text-fg-neutral-prominent`, `text-system-small`.

Tailwind v4 + arcade-gen do NOT define those utilities. The kit exclusively uses the
**CSS-variable paren form**: `text-(--fg-neutral-prominent)`, `bg-(--surface-overlay)`,
`bg-(--bg-intelligence-prominent)`. Confirmed: the named form appears NOWHERE in the real kit
source (`prototype-kit/composites/*.tsx`); the paren form appears 100+ times.

Consequence: every color/surface/stroke class the agent wrote compiled to **nothing** — silent
no-op — so all color and background vanished. Typography survived only because
`text-body-small`, `text-body`, `text-caption` ARE real named utilities (23+ uses in the kit).
Net: correct text sizes, zero color → the flat broken render.

This is a generation-quality failure the prompt cannot reliably prevent (the user has observed
the agent ignore prompt guidance repeatedly this session). The template lists token *names*
(`--fg-neutral-medium`) but never the *class syntax* (`text-(--fg-neutral-medium)`), so the
agent guessed the conventional Tailwind form and lost.

### Why a hook, not (only) a prompt fix

The user explicitly distrusts prompt guidance — this session showed the agent ignore
"read text from the tree", "use composites", etc. A PostToolUse hook is a **deterministic
gate**: it inspects every Write/Edit and can exit 2 to BLOCK a frame that would render broken,
forcing correction in the same turn. It does not rely on the agent choosing to obey. Studio
already uses this exact seam for import validation (`validateArcadeImports.mjs`), which reliably
catches hallucinated import names. This extends the same mechanism to token-class syntax.

## Goals

1. A frame that uses an un-compilable token class (`text-fg-*`, `bg-surface-*`,
   `bg-intelligence-*`, `border-stroke-*` — the "named" forms that map to a real token but never
   render) is BLOCKED at write time, with a did-you-mean hint pointing at the paren form.
2. Normal Tailwind (`flex`, `px-4`, `text-body-small`), genuinely-custom hand-rolled markup, and
   arbitrary-bracket values (`bg-[#hex]` — off-system but DOES render) are NOT flagged.
3. Works on a beta tester's DMG (fail-open if the token source can't be resolved), same
   robustness contract as the import validator.
4. Template fix: show the exact paren-class syntax as first-line defense.

## Non-goals

- Fixing the agent hand-rolling a whole Computer screen instead of using `ComputerScene`
  (Problem B, observed in the same frame) — separate composite-adherence issue, follow-up.
- Fixing hallucinated text content or borderless-vs-boxed layout (earlier gates) — different
  layers.
- Blocking arbitrary-bracket classes (`bg-[#FAF9F9]`, `text-[17px]`). They compile and render;
  they're merely off-system. Blocking them risks fighting a deliberate exact-value choice, and
  the template already discourages them. Out of scope for THIS hook.

## Architecture

Mirror `server/hooks/validateArcadeImports.mjs` — same shape, same wiring, same robustness.

### New file: `studio/server/hooks/validateTokenClasses.mjs`

Pure functions + a `main()` that reads the PostToolUse stdin payload, exits 0 (pass) or 2
(block). Fails open on any parse/resolution error — a broken hook must never wedge generation.

**Load the valid token set (source of truth):**
- Resolve `@xorkavi/arcade-gen/dist/styles.css` via `createRequire(import.meta.url).resolve`
  (the package main → `dist/`, then `styles.css`). This file is present on every machine incl.
  the packaged DMG (verified: it holds all `--fg-*`/`--surface-*`/… definitions).
- Extract every custom-property NAME defined there: regex `/--([a-z0-9-]+)\s*:/g` →
  a `Set` of token names (`fg-neutral-medium`, `surface-shallow`, `bg-intelligence-prominent`, …).
- If the file can't be resolved or yields zero tokens → **fail open** (return no violations),
  exactly like the import validator's empty-barrel guard.

**Detect broken classes (the Option-1 rule):**
- Parse `className="…"` / `className={"…"}` string literals from the written source (same
  extraction style as the import parser — regex over the source text; good enough, fail-open on
  parse trouble).
- For each whitespace-separated class token, test against the "named token utility" shape:
  a known Tailwind color-ish prefix followed by a token-like tail:
  `/^(?:text|bg|border|fill|ring|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret|placeholder)-([a-z][a-z0-9-]*)$/`
  → candidate tail = capture group.
- A class is a **violation** iff: the tail (or the tail with a leading group like `fg-`,
  `surface-`, `bg-`, `stroke-`, `control-`, `intelligence-`, `info-`, `success-`, `warning-`,
  `alert-`, `neutral-`) **matches a real token name in the Set** AND the class is NOT itself a
  real utility. In other words: "you clearly meant token X, but wrote it in the form that
  doesn't compile." Example: `text-fg-neutral-medium` → tail `fg-neutral-medium` ∈ token Set →
  violation → suggest `text-(--fg-neutral-medium)`.
- Explicitly PASS: `text-body-small`/`text-caption`/`text-title-*` (real typography utilities —
  their tails are NOT in the token Set, so the rule naturally skips them), `flex`, `px-4`,
  `gap-2`, arbitrary brackets `bg-[…]` (the `[` fails the tail regex), and any class whose tail
  isn't a real token (genuinely custom / net-new → not our business).

**Emit + block:**
- One violation per (class) with the paren-form suggestion: `text-fg-neutral-medium` →
  `text-(--fg-neutral-medium)`. Message mirrors the import validator's tone: "these token
  classes compile to nothing in Tailwind v4; use the CSS-variable form. This hook runs on every
  Write/Edit and will block again until fixed."
- `process.exit(2)` when violations exist; `exit(0)` otherwise.

### Wiring: `studio/server/claudeCode.ts`

Register alongside `VALIDATE_ARCADE_IMPORTS_HOOK` in the inline `--settings` hooks block
(PostToolUse → Write|Edit). Same `hookCommand()` invocation via `process.execPath` +
`ELECTRON_RUN_AS_NODE=1` (per auto-memory `studio-hooks-node-not-found-dmg` — bare `node` is
absent on testers).

### Template fix: `studio/templates/CLAUDE.md.tpl`

In the "Styling rules" / token section, add the exact class syntax + a worked example, so the
prompt is a correct first line of defense (the hook is the backstop):

```
Colors/surfaces/strokes use the CSS-VARIABLE class form, NOT a named utility:
  ✓ text-(--fg-neutral-prominent)   bg-(--surface-shallow)   border-(--stroke-neutral-subtle)
  ✗ text-fg-neutral-prominent       bg-surface-shallow       border-stroke-neutral-subtle   ← compile to NOTHING
Typography stays a named utility: text-body, text-body-small, text-title-2 (these DO exist).
```

## Testing

Unit (`__tests__/server/hooks/validateTokenClasses.test.ts`), pure-function level — mirror
`validateArcadeImports.test.ts`:
- `text-fg-neutral-medium`, `bg-surface-shallow`, `bg-intelligence-prominent`,
  `border-stroke-neutral-subtle` → each a violation, each suggests the correct paren form.
- `text-body-small`, `text-caption`, `text-title-2`, `flex`, `px-4`, `gap-2`,
  `text-(--fg-neutral-prominent)`, `bg-(--surface-overlay)`, `bg-[#FAF9F9]`, `hover:bg-black/5`
  → NONE flagged.
- Fail-open: empty/again-unresolvable token set → zero violations (never blocks).
- The real broken frame's className soup (paste a representative subset) → flags exactly the
  color/surface/stroke classes, leaves the typography + layout classes alone.
- `main()` exit-code test: violations → exit 2; clean → exit 0; malformed stdin → exit 0.

Integration: the wiring test in `claudeCode` hook-registration (assert the new hook is in the
PostToolUse settings block, invoked via execPath).

## Manual acceptance

Re-generate the navigation design on a restarted server. The frame must render WITH colors
(sidebar tinted, text in the right greys, intelligence-violet avatar badge) — i.e. the token
classes now resolve. If the agent still writes the named form, the hook must block + it
self-corrects to the paren form within the turn (visible in the transcript).

## Files touched

- `studio/server/hooks/validateTokenClasses.mjs` — NEW.
- `studio/server/claudeCode.ts` — register the hook.
- `studio/templates/CLAUDE.md.tpl` — paren-class syntax + worked example.
- `studio/__tests__/server/hooks/validateTokenClasses.test.ts` — NEW.
- `studio/__tests__/server/claudeCode-*.test.ts` (or wherever hook registration is asserted) —
  extend to cover the new hook.

## Open decision (re-confirm with user)

Detection rule aggressiveness — chose **Option 1** (flag only token-prefix classes whose tail is
a real token; leave arbitrary brackets alone) on best judgment while the user was away. If the
user prefers Option 2 (also block arbitrary brackets), the `[`-fails-the-regex PASS becomes a
BLOCK and the non-goal is removed. Confirm before implementation.
