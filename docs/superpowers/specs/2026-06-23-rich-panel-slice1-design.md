# Rich Editor — Phase 2 Slice 1: Panel shell + Layout + Appearance — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Part of:** "Rich Editor" — borrowing design-mode's editor UX.
- Phase 1 (shipped): the DOM-highlighting overlay.
- **Phase 2 (this work): the rich properties panel**, built in category **slices** that share one collapsible-section shell. **Slice 1 (this spec): the shell + Layout + Appearance.** Later slices: Fill, Stroke, Effects, Position, Typography.

## Why

Studio's current inspector panel has three flat sections (Typography / Color /
Spacing) with plain native inputs. design-mode's panel is far richer and more
polished: collapsible sections (Position / Layout / Appearance / Fill / Stroke /
Effects), each with grouped controls — a layout-mode segmented toggle, a
box-model grid, alignment affordances, opacity/corner-radius, etc. We are
rebuilding Studio's panel toward that vocabulary, slice by slice, so each slice
ships and demos on its own while sharing the collapsible-section shell.

Slice 1 delivers the **reusable section shell** plus the two highest-frequency
sections for prototype editing — **Layout** (box model + sizing + layout mode)
and **Appearance** (opacity + corner radius). These are mostly numeric, so they
avoid the trickiest CSS→token mappings (gradients/shadows/clip-path) that gate
later slices.

## Locked decisions (from brainstorming, carried into every slice)

1. **Build, not reskin** — these are real new controls, not restyled old ones.
2. **design-mode's structure, arcade tokens** — adopt design-mode's layout,
   density, collapsible-section composition and control affordances, but paint
   with arcade-gen design tokens + Studio theme (respects light/dark, feels
   native). Do NOT import design-mode's `--dm-*` CSS variables.
3. **Token-first controls wearing slick pickers** — controls look polished
   (design-mode field styling, segmented toggles) but the committed output is
   token-idiomatic. Live preview stays raw CSS (`node.style.*`); Claude maps to
   Tailwind/tokens at commit. Unchanged from v1/v2.
4. **No dead chrome** — no toolbar buttons or tabs that lead nowhere. Only build
   affordances backed by a real feature. (Toolbar + Layers/Changes tabs deferred
   until features exist.)
5. **Replace as each slice lands** — a new section replaces the overlapping old
   one when it ships, so the panel always has exactly one home per property.
   **Slice 1's Layout section replaces the current Spacing section.** Typography
   and Color sections stay untouched this slice (their slices come later).
6. **Commit unchanged** — sections feed the existing `pending` batch in
   `editSessionContext`; Commit serializes via `buildVisualEditPreamble` →
   `onSend` → Claude. No new commit path, no new server endpoint.

## Scope — Slice 1

**In:**
- **`Section` shell** — a reusable collapsible section: header (icon + title +
  collapse chevron), collapsed/expanded state (local, defaults expanded), body
  slot. Matches design-mode's section rhythm (icon left, title, chevron right).
- **Layout section** (replaces current Spacing):
  - Layout-mode segmented toggle: **Free / flex-row / flex-col / grid** → writes
    `display` (+ `flexDirection` for the flex modes).
  - W / H number fields + aspect-lock toggle (lock keeps W:H ratio while typing).
  - min-W / max-W / min-H / max-H number fields.
  - margin + padding: uniform field each, with an **expand-to-4-sides** toggle
    revealing top/right/bottom/left (feeds the existing margin*/padding* pending
    fields).
  - gap field (shown when layout mode is flex/grid).
- **Appearance section:**
  - opacity (% number field).
  - corner radius (number field) + **expand-to-per-corner** toggle (4 corners).

**Out (later slices / deferred):**
- Position (static/relative/absolute + alignment grid + rotate/flip), Fill,
  Stroke, Effects, Typography-as-new-section.
- Toolbar (nudge/duplicate/delete/comment/screenshot), Layers/Design/Changes tabs.
- Gradients, shadows, clip-path, filters (Fill/Effects slices — the hard mappings).
- Resize handles on the overlay (still deferred from Phase 1).

## Data model — extend StyleSnapshot

Slice 1 adds fields the current snapshot lacks. Same extension pattern as v2's
`gap` addition — widen the snapshot, no new pipeline:

New `StyleSnapshot` fields (added to BOTH the shell copy in
`editSessionContext.tsx` AND the structural re-declaration in
`frame/inspector.ts` — the field lists must stay identical, the documented
contract):

```
minWidth, maxWidth, minHeight, maxHeight, display, flexDirection,
opacity, borderRadius
```

Each must be:
- read in `readStyleSnapshot` via `getComputedStyle` (`cs.minWidth`, `cs.display`,
  `cs.flexDirection`, `cs.opacity`, `cs.borderRadius`, …),
- added to `STYLE_FIELDS` in `inspector.ts` so live preview applies them
  (`node.style[field] = value`),
- given a human label in `visualEditPreamble.ts` `LABELS` so commit lists them,
  with the preamble's existing instruction steering Claude to idiomatic Tailwind
  (`min-w-*`, `max-w-*`, `min-h-*`, `max-h-*`, `flex`/`flex-col`/`grid`,
  `opacity-*`, `rounded-*`).

`display`/`flexDirection` are non-px enum values — `toNumberInput`/
`fromNumberInput` must NOT be applied to them (they pass through as-is, like the
existing `fontWeight`/`textAlign`/`fontStyle` enum fields).

## Architecture

| Unit | Location | Responsibility |
|---|---|---|
| `Section.tsx` | new, `studio/src/components/inspector/` | Reusable collapsible section: props `{ title, icon, defaultOpen?, children }`; local open state; header (icon + title + chevron) styled with arcade tokens; body shown when open. The shell every future slice reuses. |
| `controlHelpers.ts` (or `inspectorControls.tsx`) | new, same dir | Shared control primitives + the `change()`/`fieldValue()`/`toNumberInput`/`fromNumberInput` logic currently inline in `InspectorPanel`, lifted out so sections share them. A `NumberField`, `SegmentedToggle`, `ExpandableSpacing` styled to design-mode's density with arcade tokens. |
| `LayoutSection.tsx` | new, same dir | The Layout section: layout-mode toggle, W/H + aspect-lock, min/max, margin/padding uniform+expand, gap. Consumes `useEditSession` + control helpers. |
| `AppearanceSection.tsx` | new, same dir | The Appearance section: opacity, corner radius + per-corner expand. |
| `InspectorPanel.tsx` | modify | Compose `<Section>`-wrapped Layout + Appearance; **remove the old Spacing block**; keep Typography + Color (unchanged) wrapped in `Section` shells too for visual consistency; keep header, edited-elements list, Commit/Discard, resize. |
| `editSessionContext.tsx` | modify | Add the 8 new `StyleSnapshot` fields. |
| `frame/inspector.ts` | modify | Add the 8 fields to its `StyleSnapshot` + `STYLE_FIELDS` + `readStyleSnapshot`. |
| `visualEditPreamble.ts` | modify | Add the 8 `LABELS` entries. |
| icons | from design-mode `icons.ts` (MIT) | Copy the SVG strings the sections use (layout-grid, the 4 layout-mode glyphs, aspect-lock, expand/scan, palette/appearance). Add to a small `inspectorIcons.ts`; attribute in `THIRD-PARTY.md` (already exists). |

**Aspect-lock behavior:** when locked, editing W computes H from the original
W:H ratio (and vice-versa), writing both to pending + previewing both. Ratio is
captured from the element's snapshot at lock time.

**Expand toggles** (margin/padding/corner-radius) are **local UI state** in the
section (not pending) — they only control whether the 4-up inputs are visible;
the underlying pending fields (marginTop/…, the 4 radii) are what commit reads.

## Data flow (unchanged from v2)

Control change → `change(editId, field, value)` updates `pending` + posts
`arcade-studio:preview {editId, field, value}` to the frame → `inspector.ts`
applies `node.style[field]`. Commit → `buildVisualEditPreamble(batch, frameRel)`
(now including the new fields) → `onSend`. Live preview raw CSS, commit
token-idiomatic.

## Error handling

- **Enum fields** (`display`, `flexDirection`) never go through px parsing.
- **Aspect-lock with zero/auto dimension**: if the snapshot W or H isn't a
  finite px (e.g. `auto`), lock is a no-op for that axis (don't divide by zero).
- **gap field** only renders when layout mode is flex/grid (reading the
  effective `display`/pending) — hidden otherwise (gap has no effect on block).
- **Collapsed section**: collapsing hides controls but does NOT clear their
  pending values (collapse is view-only).
- Everything else inherits v2 (vanished node, commit-reads-pending, phantom-edit
  retry).

## Testing

- `Section.tsx` — open/collapse toggles body visibility; defaultOpen respected.
- Control helpers — `NumberField` strips/re-adds px; `SegmentedToggle` selects;
  `toNumberInput`/`fromNumberInput` unchanged; enum fields bypass px parsing.
- `LayoutSection` — layout-mode toggle writes `display`(+`flexDirection`);
  aspect-lock computes the paired dimension; expand reveals 4-up; gap hidden
  unless flex/grid. (arcade-gen mocked per studio test discipline.)
- `AppearanceSection` — opacity + radius write pending; per-corner expand.
- `editSessionContext` / `inspector` / `visualEditPreamble` — the 8 new fields
  present in snapshot, STYLE_FIELDS, LABELS (extend existing tests).
- Regression: full suite green; the old Spacing-section assertions in
  `InspectorPanel.test.tsx` updated to the new Layout section (assert new
  behavior, don't weaken).
- Manual e2e: hover/select → panel shows collapsible Layout + Appearance;
  toggle layout mode, lock aspect, expand margins, set opacity/radius → live
  preview; Commit → token-based source (`flex`, `p-4`, `opacity-*`, `rounded-*`).

## Key decisions

1. **Slice the rich panel by category; ship Layout+Appearance first** — highest
   edit-frequency, mostly numeric (easiest mappings), and delivers the shared
   section shell.
2. **Replace overlapping old sections per slice** — Layout replaces Spacing now;
   no duplicate property homes at any point.
3. **Widen StyleSnapshot, reuse the pipeline** — same proven pattern as v2 gap.
4. **Section shell + control helpers are shared units** — future slices add only
   their section file, not new plumbing.
5. **design-mode structure, arcade tokens; token-first controls** — native look,
   idiomatic commits, slick affordances.

## Out-of-scope / future slices (recorded)

- Slice 2: Fill (token-first color swatches + the gradient/image parsing logic
  worth porting from design-mode).
- Slice 3: Stroke + Effects (borders, shadows, blur; the filter/shadow mappings).
- Slice 4: Position (static/relative/absolute + alignment grid + rotate/flip).
- Slice 5: Typography as a design-mode-style section (replacing the current one).
- Then: toolbar + tabs once features back them; resize handles.
