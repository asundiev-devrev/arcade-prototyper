# Rich Panel — Slice 1b: Token-first Color + Typography controls — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Part of:** "Rich Editor" Phase 2. Slice 1 shipped the section shell + Layout +
Appearance (density grid). **Slice 1b (this spec): make the Color and Typography
controls token-first** — surface arcade design-system tokens in the controls
themselves, not just at commit time. Same branch (`feat/rich-panel-slice1`).

## Why

The brainstorm decided "token-first controls wearing slick pickers." Slice 1
delivered the commit-time half — Commit sends raw values to Claude, which
rewrites source using arcade tokens. But the **controls still show/take raw
values**: Text/Fill/Border show `rgb(33,30,32)`, font styling shows `13` +
`400`. The user expects to *pick* `fg-neutral-prominent` from a swatch and
`Body medium` from a type list — not type hex/px. That control-time surfacing is
the gap this slice closes, for the two categories that have real arcade
catalogs: **color** and **typography**.

## The key architectural decision: read the APPLIED CLASS, not computed style

A control needs to show what's *currently* set. Two ways, one viable:

- **Reverse-map computed style → token** (`rgb(33,30,32)` → "is this
  `--fg-neutral-prominent`?"): **rejected.** Unreliable — browser rounding,
  many tokens share a value, inheritance. A guess that's wrong looks worse than
  no answer.
- **Read the element's literal applied CSS class** (`node.classList`):
  **chosen.** Arcade-generated frames carry the token *in the className* —
  verified across 32 real frames: `text-(--fg-neutral-subtle)` (×18),
  `text-(--fg-neutral-prominent)` (×12), `border-(--stroke-neutral-subtle)`,
  `bg-(--surface-canvas)`, and type styles `text-body-medium`,
  `text-title-large`, `text-body-small`. The token is *there*, exact, not
  guessed.

So this slice adds a **second data channel** to the inspector pipeline:
alongside the existing computed-style snapshot, `capture()` also reads the
applied arcade token classes. Preview = toggle classes in the iframe (arcade CSS
is loaded there, so `classList.add("text-body-medium")` renders + reverses
cleanly). Commit = emit the exact picked token class. No Claude guessing for
these two categories.

**Honest limitation:** exact only when the element *carries* the class on
itself. If text is styled by a parent (CSS inheritance) or the element isn't
system-styled, its own classList has no `text-*`/color token → the control shows
**"— (no token)"**, never a wrong guess. Raw escape hatches remain for those.

## Scope

**In:**
- **Color controls** (Text / Fill / Border in the Color section): a token
  dropdown of curated arcade color tokens (grouped fg / bg / stroke / surface)
  with a small swatch per option + the token name; the applied token shows
  selected; a raw hex/rgb escape field remains below for non-token values.
- **Typography control:** a single **Style** dropdown of named arcade type
  tokens (`text-body`, `text-body-medium`, `text-body-small`,
  `text-body-bold`, `text-body-large-bold`, `text-title-large`, …, sourced from
  arcade CSS) **replacing** the separate Font-size + Weight numeric fields
  (which fight the bundled type token). Align + Italic stay as plain controls
  (they're orthogonal, not part of the type token).
- **Applied-class channel:** `capture()` reads token classes; preview toggles
  classes; commit emits classes.

**Out (later / unchanged):**
- Spacing / size token-snapping — arcade has no spacing-scale CSS vars; stays
  numeric, commit maps via Claude. Separate follow-up.
- Corner radius token dropdown — small arcade set exists (`--corner-square`…);
  deferred to keep this slice to the two big catalogs. Stays numeric this slice.
- Layout + Appearance numeric controls — unchanged from slice 1.
- Fill gradients / stroke / effects — later slices.

## Catalogs (curated, sourced from arcade-gen CSS — NOT hand-maintained)

- **Color:** the `--fg-*`, `--bg-*`, `--stroke-*`, `--surface-*` tokens from
  `@xorkavi/arcade-gen/dist/styles.css` (~55), **excluding** `--component-*`
  (those are internal component recipes, not user color choices). Each entry =
  `{ token: "--fg-neutral-prominent", className: "text-(--fg-neutral-prominent)" / "bg-(...)" / "border-(...)" , swatch: resolved-hex }`. The className prefix
  (`text-`/`bg-`/`border-`) depends on which Color field (Text/Fill/Border).
- **Type:** the named `text-*` style classes arcade ships (`text-body`,
  `text-body-medium`, `text-body-small`, `text-body-bold`,
  `text-body-large-bold`, `text-title-large`, plus the raw scale `text-xs/sm/base/lg`).
  Each = `{ className, label }` (e.g. `text-body-medium` → "Body medium").

**Catalog source:** a build-time or load-time read of arcade's CSS so the lists
track the design system, not a frozen hardcoded copy. (Implementation detail for
the plan — likely a small generated module or a parse of the loaded stylesheet.)

## Architecture

| Unit | Change |
|---|---|
| `frame/inspector.ts` `capture()` + `StyleSnapshot` | Add an `appliedTokens` field: `{ color?: string; backgroundColor?: string; borderColor?: string; typeStyle?: string }` — each the arcade token class found on the node's `classList` (or undefined). Read via classList scan at capture time. |
| `editSessionContext.tsx` | Mirror the `appliedTokens` field on its `StyleSnapshot` copy (identical lists contract). Pending edits gain the ability to carry a token-class change (see pending model below). |
| New `tokenCatalog.ts` | The curated color + type catalogs (sourced from arcade CSS), with helpers `colorTokens()`, `typeTokens()`, and `classNameForColor(token, slot)`. |
| New `TokenSelect.tsx` (in inspectorControls or beside) | A dropdown showing token options (swatch + name for color; label for type) + a "— (no token)" empty state + a raw escape input slot. Emits the chosen class (or raw value). |
| `InspectorPanel` Color + Typography sections | Color: each of Text/Fill/Border becomes a `TokenSelect` (applied token preselected) + raw field. Typography: Style `TokenSelect` replaces Font-size + Weight; Align + Italic unchanged. |
| Preview path | A token change posts a new `arcade-studio:preview-class` message `{ editId, slot, className, prevClassName }`; `inspector.ts` swaps the class on the node (remove prev token class for that slot, add new). Raw-value edits keep using the existing `preview` (node.style) path. |
| Commit (`visualEditPreamble`) | When a pending edit is a token class, the preamble instructs Claude to apply that exact class (e.g. "set the text color class to `text-(--fg-success-prominent)`") rather than mapping a raw value. Raw edits unchanged. |

### Pending model

A pending entry for color/type is now **either** a raw value (existing) **or** a
token class. Simplest representation: extend the pending value to optionally be a
tagged token, e.g. store the className string and mark token-classes distinctly
(a `tok:` prefix, or a parallel `pendingTokens` map). The plan picks the exact
shape; the contract is: commit must know whether to emit a class or map a raw
value, and preview must know whether to toggle a class or set node.style.

## Data flow

**Capture:** pick → `capture()` reads computed styles (as today) AND scans
`classList` for arcade token classes → snapshot carries both. Controls preselect
the applied token (or show "— (no token)").

**Edit (token):** user picks a color/type token → pending records the token
class → post `preview-class` → `inspector.ts` removes the old token class for
that slot, adds the new → frame restyles live (arcade CSS already loaded).

**Edit (raw escape):** user types hex in the color escape field → existing
`preview` (node.style) path, existing raw pending.

**Commit:** `buildVisualEditPreamble` lists token-class edits as explicit class
instructions, raw edits as value mappings → `onSend`. Frame source rewritten;
overrides cleared.

## Error handling

- **No applied token on the element** → control shows "— (no token)"; picking a
  token still works (adds the class); raw escape still works.
- **Element styled by parent (inheritance)** → its own classList has no token →
  "— (no token)" (correct: we don't claim a token the element doesn't carry).
- **Token class removed live then frame re-renders** → preview is class-toggle on
  the live node; on HMR/commit the source is authoritative (commit reads pending,
  not the DOM) — same invariant as slice 1.
- **Catalog parse fails / token not resolvable to a swatch** → show the token
  name without a swatch chip (degrade, don't crash).

## Testing

- `tokenCatalog` — parses arcade CSS into color + type lists; excludes
  `--component-*`; `classNameForColor` builds the right prefix per slot.
- `inspector.ts` classList scan — extracts the arcade token class for each slot
  from a node's className; returns undefined when absent; the class-toggle
  preview removes the old token class and adds the new (jsdom).
- `TokenSelect` — renders options + swatches; preselects the applied token;
  "— (no token)" empty state; emits chosen class; raw escape emits raw value.
- `InspectorPanel` Color/Typography — Style dropdown replaces size+weight;
  color dropdowns present; raw escape present; commit serializes a token-class
  edit as a class instruction (extend the existing preamble test).
- Regression: full suite green; slice-1 Layout/Appearance untouched.
- **Manual e2e (the real gate — visual):** pick a `text-body-medium` element →
  Style shows "Body medium" selected; pick `text-title-large` → frame restyles
  live; pick an element with no type class → "— (no token)"; color dropdown
  shows the applied `--fg-*` token with swatch; Commit → source uses the exact
  token class. Screenshot-verify the dropdowns look like design-mode's
  palette/style pickers, not raw fields.

## Key decisions

1. **Read applied class, never reverse-map computed style** — exact, grounded in
   real frames (the token is literally in the className); the fuzzy guess is
   rejected.
2. **Type token replaces size+weight** — arcade type styles bundle
   size/weight/line-height; a single Style picker is true to the system.
   Off-system size/weight tweaking is intentionally not offered this slice.
3. **Second data channel (applied classes) beside computed styles** — preview by
   class-toggle, commit by class emission; raw escape keeps the style channel.
4. **Catalogs sourced from arcade CSS, not hardcoded** — track the design system.
5. **"— (no token)" over a wrong guess** — honest empty state when the element
   carries no token class.

## Out-of-scope / future (recorded)
- Spacing/size token-snapping (Tailwind scale stepper).
- Corner-radius token dropdown.
- Fill gradients/images, Stroke, Effects, Position sections.
- Toolbar + Layers/Changes tabs.
