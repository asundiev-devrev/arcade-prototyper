# Icon Swap — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)
**Builds on:** the rich element editor (target editor, overlay, rich panel
slices 1/1b/1c — shipped 0.41.0). This adds one more inspector capability:
**swap a selected icon for a different one from the arcade library.**

## Why

Generated prototypes use arcade icon components (`<Bell/>`, `<PlusSmall/>`, and
often a placeholder glyph the generator drops in). Today, changing an icon means
describing it in chat. Use-case: select a nav row with a placeholder icon, swap
it to the right one from the library — visually, in the panel.

## Grounding (verified)

- Frame icons are arcade-gen **components** (`<Bell size=… />`), not inline SVGs.
  "The icon" = the JSX element + its `@xorkavi/arcade-gen` import.
- An **icon catalog already exists**: `studio/prototype-kit/assets-catalog.json`,
  served at `/api/assets`, consumed by the Assets panel via
  `useAssetsCatalog.ts` (`IconItem { name, category, tags, svg }`). 124 icons.
  The icon **`name` IS the component name** (`ArrowDownTray`); `svg` is the inline
  markup; `tags` drive search. This one source powers detection, preview, and the
  picker grid.

## Decisions (from brainstorming)

1. **Detect by catalog-name match.** The picker resolves the element's component
   name; if it's in the catalog icon list, it's a swappable icon.
2. **Offer the contained icon.** Picked element IS a catalog icon → swap it;
   contains **exactly one** catalog icon (descendant) → swap that (handles the
   realistic "clicked the nav row, not the glyph" case); contains **zero or
   multiple** → no Icon section.
3. **Searchable icon-grid popover** to pick the replacement — reuse the Assets
   catalog (thumbnails + type-to-filter).
4. **Preview by swapping the rendered SVG in place** — inject the chosen icon's
   `svg` into the icon node's innerHTML in the iframe (throwaway, instant).
5. **Commit via the existing Claude preamble** — a "replace `<Old/>` at line:col
   with `<New/>` and update the arcade-gen import" instruction. Claude does the
   component rename + import fix. No new server endpoint.

## Experience

Pick an element. If it is (or contains exactly one) catalog icon, the inspector
shows an **Icon** section: the current icon's glyph + name, and a **Replace**
control that opens a searchable grid of library icons. Pick one → the glyph in
the frame swaps live. Commit rewrites the source (component + import) alongside
any other pending edits. No icon → no Icon section (panel unchanged otherwise).

## Architecture

### Detection (rides the existing pick snapshot)

`frame/inspector.ts` `capture()` already returns the source location +
`appliedTokens`. Add an **`icon`** field to the report:
`{ name: string; nodeFound: boolean }` or undefined.
- Resolve the **icon node**: if the picked node's component name is a catalog
  icon, the icon node is itself; else scan descendants for arcade icon
  components and, if **exactly one** is a catalog icon, that's the icon node;
  zero/multiple → no icon.
- "Is a catalog icon" = the rendered element traces to a catalog icon name. In
  the DOM, an arcade icon renders as an `<svg>` (the component's output). The
  reliable signal available in-iframe is the component name via the React fiber
  (the picker already reads fibers for source resolution) OR a stamped marker.
  **Approach:** reuse the picker's fiber walk to read the component
  `displayName`/`name` of the node (and of single-icon descendants), match
  against the catalog name set (passed into the iframe, or matched shell-side).
  Report `icon.name` = the matched catalog name, and retain the icon node ref
  (like the edit node) for preview.
- The catalog name set must be available to the matcher. Simplest: the shell
  already has the catalog; the iframe reports the **candidate component name(s)**
  it found, and the SHELL decides "is it a catalog icon" against the loaded
  catalog. So `capture()` reports `iconCandidate: string | null` (the component
  name of the icon node, self or single descendant), and the panel resolves it
  against `useAssetsCatalog`'s icon list → shows the section iff matched.

### Pending model + the icon node

- A new pending key **`iconSwap`** (like `typeStyle` — a non-style pending key;
  widen `PendingEdits` to include it). Value = the chosen new icon name.
- The iframe retains the **icon node** (the resolved svg-bearing element) keyed
  by editId, so preview can target it even when it's a descendant of the picked
  node.

### Preview

New message `arcade-studio:preview-icon { editId, svg }` → `inspector.ts`
replaces the icon node's `innerHTML` with the chosen icon's `svg` (preserving the
element's own classes/size). Tracked so reset restores the original markup
(snapshot the original `innerHTML` at capture, like the style channel snapshots
original values). Cleared on discard/commit (`all`/`editId` reset already exists
— extend it to restore icon markup too).

### Commit

`visualEditPreamble`: when `iconSwap` is pending, emit:
> "Replace the `<OldName />` icon at line:col with `<NewName />`, and update the
> `@xorkavi/arcade-gen` import to import `NewName` (remove `OldName` if it's no
> longer used)."

`OldName` = the detected catalog icon name; `NewName` = the picked one. Rides the
existing batch → `onSend`. No new endpoint.

### Components

| Unit | Responsibility |
|---|---|
| `frame/inspector.ts` | Resolve the icon node (self / single catalog-icon descendant) via fiber name; report `iconCandidate` + retain the icon node + its original innerHTML; handle `preview-icon` (swap innerHTML) + restore on reset. |
| `editSessionContext` | `iconCandidate` on the selection (mirror in both StyleSnapshot copies if it lives there, OR on `ElementSelection`); `iconSwap` pending key (PendingEdits union). |
| catalog access | reuse `useAssetsCatalog` (icons: `{name, svg, tags}`). A small helper to look up an icon's svg by name + the name set for matching. |
| `IconGridPopover.tsx` (new) | searchable grid of catalog icons (svg thumbnails + name + tag filter); reuses Assets icon rendering; emits the chosen name. |
| `IconSwapSection.tsx` (new) | shows current icon glyph + name + a "Replace" trigger opening the popover; on pick → set `iconSwap` pending + post `preview-icon`. |
| `InspectorPanel` | render `<Section title="Icon">` with IconSwapSection **iff** the focused element's `iconCandidate` matches a catalog icon. |
| `visualEditPreamble` | serialize the `iconSwap` instruction (component + import). |

## Data flow

Pick → `capture()` reports `iconCandidate` (icon node's component name) + retains
the icon node + original innerHTML → panel matches it against the catalog → if
matched, Icon section shows the current glyph. Replace → pick from grid →
`iconSwap` pending = new name + post `preview-icon {editId, svg}` → iframe swaps
the icon node's innerHTML → live. Commit → preamble emits the component+import
swap → `onSend` → source rewritten → frame HMR re-renders the real component.
Discard/reset → restore original innerHTML + clear pending.

## Error handling

- **No icon / multiple icons** in the picked element → no `iconCandidate` → no
  Icon section (silent; not an error).
- **iconCandidate not in catalog** (an arcade component that isn't a catalog
  icon, or a non-arcade svg) → no section (matched-only).
- **Preview svg missing** for a chosen icon → skip the innerHTML swap (the grid
  only lists catalog icons, all of which have svg — defensive only).
- **Commit with only an icon swap** (no other pending) → still a valid turn
  (preamble non-empty) → onSend. Phantom-edit retry inherited.
- **Same icon picked** (new == old) → no pending change (reset that key).

## Testing

- `inspector.ts` icon resolution — picked node IS a catalog-ish component →
  reports its name; picked node with exactly one icon descendant → reports the
  descendant's name; zero/multiple → null. `preview-icon` swaps the icon node's
  innerHTML; reset restores the original.
- catalog helper — svg-by-name lookup; name set membership.
- `IconGridPopover` — renders icons, filters by tag/name, emits chosen name.
- `IconSwapSection` — shows current glyph; replace sets iconSwap pending + posts
  preview-icon; same-icon is a no-op.
- `visualEditPreamble` — `iconSwap` pending → component+import swap instruction.
- `InspectorPanel` — Icon section appears only when iconCandidate matches the
  catalog; absent otherwise.
- Regression: full suite green; existing inspector behavior unchanged.
- **Manual visual gate (mandatory):** pick a nav row with a placeholder icon →
  Icon section shows; open grid, search, pick a new icon → glyph swaps live in
  the frame; Commit → frame source uses the new component + import. Pick a
  non-icon element → no Icon section.

## Key decisions

1. **Catalog-name detection** (exact, reuses the existing catalog) over svg/size
   heuristics.
2. **Offer the contained icon** (self or single descendant) — matches how users
   actually click (the row, not the 16px glyph).
3. **Searchable grid popover** reusing the Assets catalog — icons need visual
   thumbnails, not a name dropdown.
4. **Preview = innerHTML SVG swap** — instant + throwaway; the real component
   swap is the commit's job (can't hot-swap a React component in the live iframe).
5. **Commit via Claude preamble** — the component rename + import fix is exactly
   Claude's strength and reuses the whole pipeline; a deterministic JSX/import
   rewrite is brittle (aliases, grouped imports, multi-use).

## Out of scope

- Multi-icon disambiguation (picked element contains >1 catalog icon → no section
  this round).
- Swapping non-arcade / inline `<svg>` graphics.
- Icon color / size (the existing color + spacing controls handle those).
- Adding NEW icons to the catalog (library is fixed to what arcade-gen ships).
