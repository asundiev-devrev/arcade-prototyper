# Rich Panel — Slice 1c: Token+Raw row redesign — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Part of:** "Rich Editor" Phase 2. Slice 1 = sections + density. Slice 1b =
token-first Color + Typography (applied-class channel). **Slice 1c (this spec):
redesign how token+raw pairings are presented** — the controls shipped as a
column of plain inputs; this makes them preview-led rows, restores typography
raw values, and makes color previews mandatory. Same branch
(`feat/rich-panel-slice1`).

## Why (three pieces of feedback on the shipped 1b panel)

1. **Typography lost its raw values.** The Style picker *replaced* font-size +
   weight entirely. The user wants the raw size/weight visible alongside the
   token (like Color's escape), not token-only.
2. **The token+raw pairing is a dull column of inputs.** design-mode pairs them
   tighter — the preview leads the row, token + raw sit inline. Adopt that.
3. **Color controls show no color.** A `rgb(...)` string (or "— (no token)")
   isn't a preview. Every color row must show a live swatch.

Validated visually with the user (browser mockups): **Model A — the editable
chip** was chosen over a swatch-opens-popover model.

## The control: an editable token/raw chip in a preview-led row

Each editable color/type property is **one row**:

```
[ preview ]  [ editable chip ............. ]
             raw value (dim, beneath)
```

- **preview** (left, 28×28, always present): for color = a swatch filled with
  the live-resolved color; for type = a small `Aa` sample.
- **editable chip** (the primary control): shows the **token name** (e.g.
  "Neutral prominent", "Body small") with a ▾ affordance. It has **two modes**:
  - **token mode** (default): clicking the ▾ / the chip opens the token
    dropdown (the existing `TokenSelect` list). Picking a token sets it.
  - **raw mode**: when the user starts typing in the chip (or there's no
    matching token), the chip becomes a text input accepting a raw value
    (`rgb(...)`, `#hex` for color; `16px`, `600` for type size/weight). Typing a
    raw value writes a raw pending edit (the existing raw `change()` path).
- **raw value line** (dim, beneath): the current computed raw value, shown for
  reference even in token mode (color: `rgb(33,30,32)`; type: `13px · 400`).

This is a real interaction upgrade over 1b's separate token-dropdown + separate
raw-input. One control toggles between the two; both are always legible.

## Per-category specifics

### Color (Text / Fill / Border)
- Swatch **always** shown, filled with the live-resolved color. In token mode it
  resolves the token's value; in raw mode it shows the raw value; "— (no token)"
  state still shows a swatch of the *computed* color (so it's never blank — this
  is the #3 fix: the element HAS a color even if not from a token).
- Chip: token name (or "— (no token)") in token mode; `rgb()/#hex` in raw mode.
- Raw line beneath: the computed `rgb(...)`.

### Typography
- **Style** row: `Aa` sample + editable chip (named type style; raw mode accepts
  nothing useful for the *bundled* style, so the chip's raw mode is **token-only
  here** — the raw size/weight live in their own rows below, restoring them).
- **Restore raw Size + Weight** as their own compact rows beneath Style (this is
  the #1 fix). Size = number field (px); Weight = number field or the named
  weights. These write the existing `fontSize`/`fontWeight` raw pending edits.
  When the user sets a raw size/weight, the type Style chip shows "— (no token)"
  or the still-applied class — both are honest (the element may carry a type
  class AND have an inline size override).
- **Align**: an **icon button group** (left / center / right / justify), NOT a
  `<select>` (matches design-mode). Same for Italic — keep the existing toggle.

## Architecture

| Unit | Change |
|---|---|
| New `EditableTokenChip.tsx` (in inspector/) | The two-mode chip: props `{ tokenValue: string \| null; tokenOptions: {value,label}[]; rawValue: string; onPickToken: (v)=>void; onRawChange: (raw)=>void; ariaLabel; swatch?: string }`. Renders token-mode (a `TokenSelect`-like dropdown) by default; switches to a raw `<input>` on focus-to-type / when no token matches. Encapsulates the mode toggle. Built on the existing TokenSelect for the dropdown half. |
| New `ButtonGroup.tsx` (or extend SegmentedToggle) | Icon button group for alignment. We already have `SegmentedToggle` from slice 1 — reuse it with align icons; no new component if SegmentedToggle fits (it renders icon buttons + active state). Prefer reusing SegmentedToggle. |
| `inspectorControls.tsx` | Maybe a `PreviewRow` helper (preview box + body) to keep the row layout DRY across color + type. |
| `InspectorPanel.tsx` ColorRow | Replace the separate TokenSelect + raw input with one `EditableTokenChip` (swatch always shown). |
| `InspectorPanel.tsx` Typography | Style = `EditableTokenChip` (token-only raw mode); ADD back Size + Weight raw rows beneath; Align = SegmentedToggle with align icons (replace the `<select>`). |
| Preview/commit | UNCHANGED pipelines — token pick → `tok:` pending + preview-class; raw type → raw pending + `node.style.*` preview; commit reads pending. This slice is presentation; the channels from 1b stay. |

No new data model, no new message verbs, no commit change — slice 1c is a
**control-composition redesign** over the 1b channels.

## Swatch resolution (the #3 fix, made robust)

Color swatch ALWAYS resolves to a visible color:
- token mode → `resolveSwatch(token, document.documentElement)` (live var value).
- raw mode / no-token → the element's **computed** color for that slot (already
  in `styles[slot]`, e.g. `rgb(33,30,32)`). So even "— (no token)" shows the
  real current color as the swatch — never a blank/transparent chip for a
  visible element. (Transparent stays transparent only when the computed value
  genuinely is transparent, e.g. a fill of `rgba(0,0,0,0)`.)

## Error handling

- **Chip in raw mode, user clears it** → revert to showing the computed value
  (don't write an empty raw edit; mirror existing `change()` reset-on-empty).
- **Raw value isn't a valid color/number** → still previewed as-is (browser
  ignores invalid inline styles); commit lists it and Claude maps/cleans. No
  hard validation (consistent with 1b).
- **Type Style raw mode** → disabled (the chip is token-only for Style; size/
  weight raw lives in their own rows). Typing in the Style chip filters the
  token list rather than entering a free value.
- Align button group: one always active (the current `textAlign`).

## Testing

- `EditableTokenChip` — token mode shows name + dropdown; picking emits
  onPickToken; switching to raw mode shows an input; typing emits onRawChange;
  swatch reflects the passed swatch color; "— (no token)" shows the computed
  swatch not blank.
- ColorRow — swatch always rendered (even no-token); token pick vs raw type both
  route correctly (tok: vs raw pending).
- Typography — Style chip present; Size + Weight raw rows present and write
  fontSize/fontWeight; Align is a button group (4 buttons, current active),
  emits textAlign on click; the old `<select>` is gone.
- Regression: full suite green; 1b round-trip + commit unchanged.
- **Manual visual gate (mandatory):** screenshot the panel — color rows show
  swatches (incl. no-token), the chip toggles token↔raw, typography shows Style
  + raw size/weight, align is buttons. Compare density/feel to design-mode.

## Key decisions

1. **Editable chip (Model A)** over swatch-popover (Model B) — one control, two
   modes; simpler than an on-demand picker, chosen by the user.
2. **Swatch always shows the live color** — including the no-token case (uses
   computed value) — color previews are now mandatory and never blank.
3. **Typography raw size/weight restored as their own rows** beneath the Style
   token — token AND raw both available (the #1 fix).
4. **Align as an icon button group** (reuse SegmentedToggle), not a select.
5. **Presentation-only** — no change to the 1b token/raw data channels, preview
   messages, or commit; this slice recomposes the controls.

## Out of scope (unchanged from prior slices)
- Spacing/radius token-snapping; Fill gradients/Stroke/Effects/Position;
  toolbar+tabs. Layout + Appearance numeric controls unchanged.
