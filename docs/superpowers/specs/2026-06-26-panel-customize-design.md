# Panel-Based Customize — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)

## Problem

Manual testing showed component editing is completely dead, via two coupled bugs
both rooted in the **floating Customize chip inside the iframe**:

1. **Component style edits silently revert.** Select a kit component (e.g.
   `<Button>`), change a style field, hit "Done" → the change vanishes. Root
   cause: `applyFieldEdit` (`InspectorPanel.tsx`) bails on `!isInFrame(sel.file,
   targetFrame)` — a component's source is `prototype-kit/…`, not the frame — so
   the deterministic writer never writes; the change is only a throwaway iframe
   preview, which "Done" (`discard` → `preview-reset`) wipes.
2. **The Customize chip is unreachable.** The intended escape (chip → Customize →
   eject to editable code) can't be clicked: the chip floats in the iframe and
   the cursor/focus lands on the selected object below it.

This is the **fourth** failure of the chip-in-iframe mechanism (earlier:
malformed prompt, unreachable, picker-eats-click). The mechanism fights the
picker, the focus model, and the iframe boundary at once. Per systematic
debugging, repeated failures in one mechanism = stop patching, change the
architecture.

## The change

**Move Customize out of the iframe and into the inspector panel** — the right
pane, outside the iframe, where the designer already looks and clicks. No
picker, no focus fight, no z-index war.

### Decisions locked during brainstorming

- **Customize lives in the panel header**, as a normal button, when the selected
  element is a component (`!isInFrame`). The floating in-iframe chip + its
  picker workarounds are removed.
- **Pre-customize style fields are grayed** with a clear "Customize this
  component to edit its styles" line. The component's own declared props
  (variant/size — Task-9 kit-prop dropdowns) stay **editable** (those apply
  without customizing, via the prop-attr path… see "Props caveat").
- **Customize flow:** confirm dialog → brief "Customizing…" panel state → eject
  (serialize the component's rendered subtree into editable JSX in the frame,
  the existing customize endpoint) → frame hot-reloads → **auto-reselect** the
  now-editable element so its style fields go live (grays lift).
- **Auto-reselect is marker-based:** the customize write tags the ejected root
  with a stable `data-arcade-customized="<token>"`; after reload the picker
  re-finds that node and re-selects it.
- **Confirm copy** reuses the approved Customize strings (title/body/buttons).

### Props caveat (honest scope note)

Today the kit-prop dropdowns (variant/size) route through `change("prop:…")` →
`applyFieldEdit`, which ALSO bails on `!isInFrame`. So component **prop** edits
currently revert too, same as style edits. This spec makes prop edits work the
intended way: a prop change on a component is a deterministic **attribute** edit
on the component instance *as written in the frame* — but the instance may be
inside a shared composite (not in the frame source), in which case a prop edit
also requires Customize first. To keep v1 honest and simple: **before Customize,
ALL fields (props + styles) are read-only/grayed for a component whose instance
isn't in the frame source; after Customize, everything is editable.** If the
component instance IS directly in the frame's `index.tsx` (e.g. a `<Button>` the
frame authored), its declared props are editable immediately (prop-attr write to
that in-frame instance) and only deep styles need Customize. The panel decides
per selection using the existing `isInFrame` + the owner-chain target
resolution.

## What exists today (reused / changed)

- **InspectorPanel** (`src/components/inspector/InspectorPanel.tsx`) — the panel;
  `applyFieldEdit` (the deterministic write), the kit-prop section, `discard`.
  CHANGED: add the Customize header/affordance; gray fields pre-customize; run
  the customize flow; drop the chip-driven `customize-request` path.
- **Customize machinery** (`src/lib/customizeClient.ts` `serializeTargetToJsx`,
  `server/customize/*`, `/api/customize/:slug`) — the eject. Reused as-is; gains
  a marker on the ejected root.
- **resolveCustomizeTarget** (`src/frame/resolveCustomizeTarget.ts`) — picks the
  in-source component to eject. Reused.
- **Picker / overlay** (`src/frame/picker.ts`, `overlay/overlays.ts`) — the
  in-iframe chip (`showComponentChip`/`hideComponentChip`) and the FrameCard
  `customize-request` listener + the picker's chip-ignore guard are REMOVED (the
  chip no longer exists). The picker's element selection + the
  `data-arcade-customized` re-find are added.
- **FrameCard** (`src/components/viewport/FrameCard.tsx`) — the
  `show/hide-component-chip` posts + `customize-request` forward are removed.
  Add: after a customize reload, request a re-pick of the marked node.

## Architecture

```
Select element
   │
   ├─ in-frame (authored) ──→ style fields LIVE (deterministic write as today)
   │
   └─ component (!isInFrame OR instance not in frame source)
          → panel shows: editable props (if instance in-frame) + GRAYED styles
            + "Customize to edit" + [Customize] button in the header
                 │ click Customize
                 ▼
            confirm dialog → panel "Customizing…"
                 │
                 ▼
            serializeTargetToJsx (mark ejected root data-arcade-customized=token)
                 │  POST /api/customize/:slug  (splice + reparse-guard + snapshot)
                 ▼
            frame hot-reloads → FrameCard re-picks the data-arcade-customized node
                 → auto-reselect → style fields LIVE → grays lift
```

### New / changed units

1. **Customize affordance in the panel** (`InspectorPanel.tsx`) — when the
   focused selection is a component (decided via `isInFrame` + the owner-chain
   resolving an in-source target), render a header row: "💠 This is a prebuilt
   component" + a **Customize** button. Style fields render grayed (opacity +
   `pointer-events:none`) with the note "Customize this component to edit its
   styles." Props editable only if the instance is in-frame.

2. **Customize flow in the panel** (`InspectorPanel.tsx`) — Customize click →
   `useDialogs().confirm` (approved copy) → set a local "customizing" flag (panel
   shows "Customizing…") → `resolveCustomizeTarget(ownerChain, frameSlug)` →
   `serializeTargetToJsx(iframe, target)` → `postCustomize(...)`. On `{ok:true}`,
   the frame reloads; clear the customizing flag. On failure → toast (reuse the
   existing fallback copy) and clear the flag.

3. **Marker on the ejected root** (`server/customize/*` + `serializeTargetToJsx`)
   — the printed JSX's root element gets `data-arcade-customized="<token>"` (a
   short unique token generated client-side, passed in the payload, written by
   the splice). The token lets the post-reload picker find exactly the ejected
   element.

4. **Auto-reselect after reload** (`FrameCard.tsx` + `picker.ts`) — after a
   successful customize, FrameCard waits for the frame reload (the existing
   project-watch → reload path) then posts a new picker message
   `arcade-studio:pick-marked` with the token; the picker finds
   `[data-arcade-customized="<token>"]`, resolves its selection (now a
   frame-authored node), and posts `frame-picked` as usual → the panel
   re-selects it, style fields live. The marker attribute is then stripped on
   first re-pick (one-shot) so it doesn't pollute the source long-term —
   OR left in (harmless data-attr); chosen: **leave it** (simpler, harmless,
   and lets a later edit/undo cycle still find it).

5. **Remove the chip path** — delete `showComponentChip`/`hideComponentChip`
   usage from FrameCard, the `customize-request` listener, and the picker's
   chip-ignore guard (added in the last fix) since the chip is gone. Keep the
   overlay's selection box (the normal pick highlight) — only the Customize chip
   is removed.

## Data flow — customize a component (the fixed path)

1. Select a `<Button>` inside `<ComputerScene>`. Panel: grayed styles +
   "Customize to edit" + Customize button (props grayed too, since the Button
   instance is inside a composite, not the frame source).
2. Click Customize → confirm → "Customizing…".
3. `resolveCustomizeTarget` → `ComputerScene` (the in-source instance);
   `serializeTargetToJsx` produces JSX with the root marked
   `data-arcade-customized="cz-7f3a"`; `postCustomize` splices it into
   `index.tsx`.
4. Frame reloads. FrameCard posts `pick-marked: "cz-7f3a"`. Picker finds the
   node, resolves a now-in-frame selection, posts `frame-picked`.
5. Panel re-selects: the element is now frame-authored → style fields LIVE.
   Editing padding now writes deterministically and persists (no revert).

## Error handling

- **Customize fails** (serialize throw, postCustomize !ok) → clear "Customizing…",
  toast the existing fallback ("Couldn't customize this automatically — describe
  the change in chat instead."). Frame untouched (reparse-guard + all-or-nothing
  already guarantee this).
- **Marker not found after reload** (eject changed structure unexpectedly) →
  the auto-reselect is best-effort: if `pick-marked` finds nothing, no re-select
  happens; the user clicks the element manually. A `console.warn`, no error
  toast (the customize itself succeeded).
- **Grayed fields** can't emit edits (pointer-events:none), so the silent-revert
  path is closed by construction for pre-customize components.

## Testing

- **Panel component-mode rendering** — a focused selection that is a component
  (`!isInFrame`) renders the Customize button + grayed style fields + the note;
  an in-frame selection renders live fields, no Customize button. (Component
  test.)
- **Grayed fields don't write** — a style control in component-mode is disabled
  / can't call `applyFieldEdit`.
- **Customize flow** — clicking Customize calls confirm; on confirm, calls
  `serializeTargetToJsx` + `postCustomize` with a payload carrying the marker
  token; on `{ok:false}` shows the fallback, clears customizing. (Mock serialize
  + network.)
- **Marker in printed JSX** — `serializeTargetToJsx` (or the splice) includes
  `data-arcade-customized="<token>"` on the root of the emitted JSX.
- **Auto-reselect** — picker, given a DOM with `[data-arcade-customized=token]`,
  resolves + posts `frame-picked` for that node on `pick-marked`.
- **Chip removal** — the `show-component-chip`/`customize-request`/chip-ignore
  code is gone; existing chip tests are removed/replaced (legit — the chip no
  longer exists), the normal pick/selection-box tests stay green.
- **Regression** — visual-edit, customize endpoint, inspector, frame suites stay
  green; the deterministic in-frame edit path (the part that works) is unchanged.

## Risks / honest limitations

- **Auto-reselect fidelity** — the marker must survive the serialize→splice→
  reload round-trip and re-resolve to a valid selection. Best-effort with a
  manual-click fallback; the manual gate must verify the re-select actually fires
  and the style fields go live.
- **Marker left in source** — `data-arcade-customized` stays in the frame's
  `index.tsx`. Harmless (a data-attr), but it's visible in the code and ships if
  the prototype is exported. Acceptable for v1; could strip on a later edit.
- **Props-before-customize** — for a component whose instance is inside a
  composite, even variant/size require Customize first (can't attr-edit a node
  that isn't in the frame source). Honest, but means "change the button variant"
  on a computer-frame Button needs a Customize. Documented.
- **The whole flow is still only test+reasoning-verified** until the manual gate
  runs — and component editing specifically has failed every prior manual gate,
  so this one is mandatory before claiming done.

## Out of scope

- On-canvas resize/move handles (deferred phase).
- Stripping the marker attribute from source (left in for v1).
- Auto-customize-on-edit (rejected — explicit Customize per earlier decision).
