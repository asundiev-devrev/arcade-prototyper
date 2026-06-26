# Props-First Component Editing — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation
**Product:** Arcade Studio (`studio/`)

## Problem

Manual testing of every component-editing approach failed (five times: malformed
prompt → unreachable chip → picker-eats-click → unreachable again → silent revert
→ "everything is a prebuilt component" + detach fiber-not-found). The root cause,
confirmed by inspecting a real generated frame: **generated prototypes are ~95%
nested kit components** (27 component tags vs 1 host element in the test frame).
The premise behind detach/Customize — "click any object, eject it to raw editable
code, edit in place" — fights how these frames are actually built:

- Almost everything the user clicks resolves to a kit component (`!isInFrame`),
  so the panel labels nearly everything "prebuilt component" — accurate but
  useless.
- Detaching a dense component tree either **moves the un-editable wall down one
  level** (now `EntityCard` is the opaque component) or **flattens to frozen divs**
  (loses the kit, no re-render) — and the serialize→fiber-walk crashes on real
  trees (`findComponentFiber` couldn't locate `SettingsPage`).

These prototypes are not drawings to detach — they are **programs composed of
components**. The editable surface of a component is its **props** (which the kit
already declares and the generator already uses), not its frozen internal pixels.

## The model (props-first, agent-for-the-rest)

Editing goes **with the grain** of component composition:

1. **Props are the default edit surface.** Select a component → the panel shows
   its exposed props (variant, size, title, columns…) as editable controls →
   changing one writes the prop attribute **deterministically** (instant, no
   agent). This reuses the existing `kitPropsFor` + `prop:` write machinery.
2. **Everything beyond props → an agent request.** Any change the props don't
   cover (internal padding/color, structure, behavior) goes to the chat as a
   scoped instruction seeded with the selected element. No detach, no eject, no
   fiber-walk, no frozen blobs.
3. **Raw frame-authored elements** (the rare `<div>`/`<h1>` the frame wrote
   directly, `isInFrame`) keep the instant deterministic **style** editing that
   already works.

### Decisions locked

- **Which props when you click something nested:** the panel edits the **nearest
  ancestor component that is in the frame's own `index.tsx`** (resolved via the
  existing owner-chain + `isInFrame`). Clicking the `<aside>` deep inside
  `<SettingsPage>` → edit `<SettingsPage>`'s props (its `sidebar`, `title`,
  `columns`…), because that's the instance the frame actually placed. The panel
  header NAMES which component it's editing so this is never confusing.
- **Everything-else → agent:** one clear control — an "Ask AI to change this"
  action (a small prompt box / button) seeded with the selected element's
  identity — sends a scoped chat instruction. This is the ONLY path for non-prop
  changes on components.
- **Rip out the failed apparatus:** detach, Customize (button + flow + confirm +
  toast), the marker (`markJsxRoot`/`newCustomizeToken`/`data-arcade-customized`),
  `serializeTargetToJsx`, `buildWalkContext`'s `findComponentFiber`, the
  `pick-marked` picker handler, `armReselect`, `resolveCustomizeTarget`, the
  customize endpoint usage from the panel, and all remaining chip remnants. Keep
  the customize *server* endpoint file only if other code needs it (verify;
  otherwise remove). The Phase-A `serializeTargetToJsx`/fiber-walk for FIGMA
  EXPORT stays — only the Customize consumer of it goes.
- **Keep instant style editing** on `isInFrame` raw elements (unchanged).

## What exists today (reused)

- **Kit-prop introspection** (`server/codeWriter/kitProps.ts` `kitPropsFor` +
  `/api/kit-props/:component`) — returns a component's declared string-union
  props. Already used by the panel's prop dropdowns.
- **`prop:` write path** (`server/codeWriter/index.ts` + `patchSource.ts`
  `readAttr`) — writes/replaces a JSX attribute on an in-source component
  instance, deterministically, via the same `/api/visual-edit` endpoint.
- **Owner chain + `isInFrame`** (`picker.ts` `buildOwnerChain`,
  `resolveCustomizeTarget`'s logic — the "nearest in-frame component" resolution
  is reused, even though the Customize *consumer* is removed).
- **The chat send path** (`onSend`) — the agent-for-the-rest channel.
- **Instant style editing** on raw elements (the deterministic write that works).

## Architecture

```
Select element
   │
   ├─ raw frame-authored element (isInFrame) ──→ instant style editing (unchanged)
   │
   └─ component / nested-in-component
          → resolve NEAREST in-frame ancestor component (owner chain + isInFrame)
          → panel header: "Editing <SettingsPage>"
          → PROPS section: editable dropdowns for that component's declared props
          │     change a prop → POST /api/visual-edit (prop:<name> attr write) → instant
          → "Ask AI to change this" → onSend(scoped instruction) → agent (the only non-prop path)
```

### New / changed units

1. **Panel component-mode rewrite** (`InspectorPanel.tsx`) — when the selection
   resolves to a component (not an `isInFrame` raw element):
   - Resolve the **nearest in-frame ancestor component** from the owner chain
     (reuse `resolveCustomizeTarget`'s resolution, rename to something neutral
     like `resolveInFrameComponent`).
   - Header: "Editing `<Name>`" (the resolved in-frame component).
   - **Props section:** fetch `kitPropsFor(Name)`; render editable dropdowns;
     a change writes `prop:<name>` to THAT in-frame instance via the existing
     deterministic `/api/visual-edit` path (instant, emits an applied block).
   - **"Ask AI to change this"** button/box: `onSend` a scoped instruction
     ("In frames/<slug>, change the `<Name>` …" / free-text the user types) for
     anything props don't cover.
   - **No grayed style fields, no Customize button, no chip.** Style fields are
     simply not shown for components (they were never editable on a component
     anyway — that's the agent's job now).

2. **Remove the detach/Customize apparatus** — delete from the panel:
   `runCustomize`, the Customize button, confirm/toast for customize, marker
   usage, `armReselect` dispatch. From `customizeClient.ts`: `serializeTargetToJsx`
   (the Customize consumer), `markJsxRoot`, `newCustomizeToken` (verify no other
   consumer). From `picker.ts`: the `pick-marked` handler. From `FrameCard.tsx`:
   the `armReselect`/`pick-marked` wiring. From `exportFrameToSlj.ts`:
   `findComponentFiber` (only if no remaining consumer). Keep the customize
   server endpoint + `server/customize/*` ONLY if still referenced; otherwise
   remove. Run a grep sweep to confirm no dangling imports.

3. **Nearest-in-frame-component resolution** — the existing
   `resolveCustomizeTarget(ownerChain, frameSlug)` already returns the outermost
   owner whose call-site is in the frame's `index.tsx`. The spec wants the
   **nearest** in-frame ancestor (innermost in-source), not the outermost — for a
   frame whose only in-source component is `<SettingsPage>` they're the same, but
   for a frame with nested in-source components (`<Card><Button/></Card>` both
   authored) clicking inside the Button should edit the Button, not the Card.
   So: resolve the **innermost** owner-chain link that is `isInFrame`. (One-line
   change to the resolver's pick direction; keep the old one if Figma export uses
   it, else replace.)

## Data flow — edit a component prop (the common path)

1. Click the `<aside>` inside `<SettingsPage>`. Owner chain → nearest in-frame
   component = `SettingsPage` (its `<aside>`/sidebar isn't in-frame; `SettingsPage`
   is).
2. Panel: "Editing `<SettingsPage>`" + its props (e.g. `title`, `subtitle`,
   `columns` if declared).
3. Change `columns` → `change("prop:columns", "2")` → `/api/visual-edit` writes
   `columns="2"` (or `{2}`) on the `<SettingsPage>` instance in `index.tsx` →
   instant, frame hot-reloads, applied block + Undo.
4. Want the sidebar styled differently (not a prop) → "Ask AI to change this" →
   `onSend("In frames/<slug>, in <SettingsPage>, make the sidebar …")` → agent.

## Error handling

- **Component has no declared props** (e.g. a host `<aside>`, or a composite
  whose props the kit doesn't expose as string-unions) → the props section shows
  "No editable properties — use Ask AI to change this." The agent path is always
  available. No error.
- **Prop write fails reparse** → the existing `/api/visual-edit` reparse-guard
  aborts (file untouched); the panel falls back to the agent instruction for that
  change. Never writes broken code.
- **No in-frame ancestor at all** (shouldn't happen for a rendered frame, but
  guard) → show only the "Ask AI to change this" path.

## Testing

- **Nearest-in-frame resolution** — given an owner chain with nested in-source
  components, the resolver returns the INNERMOST in-frame one; with only one
  in-source component, returns it; none → null.
- **Component panel rendering** — a component selection shows "Editing `<Name>`"
  + prop dropdowns (when `kitPropsFor` returns props) + "Ask AI to change this";
  a raw in-frame element shows the instant style fields (unchanged).
- **Prop write** — changing a prop dropdown POSTs `prop:<name>` for the resolved
  in-frame component and yields an applied block (reuses the existing
  visual-edit + block tests).
- **Ask AI** — the button sends a scoped `onSend` instruction naming the
  component; nothing else fires.
- **Apparatus removal** — grep confirms no `Customize`/`detach`/`marker`/
  `pick-marked`/`armReselect`/`serializeTargetToJsx`(panel)/`resolveCustomizeTarget`
  references remain except any intentionally-kept Figma-export use; deleted tests
  for the removed features; surviving suites green.
- **Manual gate (HUMAN)** — on a generated frame: click a component → "Editing
  `<Name>`" + its props; change a prop → applies + persists; "Ask AI" → chat turn;
  click a raw element (if any) → instant style edit. No "prebuilt component"
  dead-ends, no detach crash.

## Risks / honest limitations

- **Props are only as rich as the kit exposes.** A component with few declared
  string-union props gives you few knobs; everything else is the agent. That's
  honest — it matches what's actually editable about a component without
  rewriting it.
- **Clicking a deeply-nested element edits its CONTAINER's props, not itself.**
  Mitigated by naming the component in the header ("Editing `<SettingsPage>`") so
  the user understands the scope. Internal targeting of nested elements is the
  agent's job.
- **This abandons direct in-place editing of component internals.** Deliberate —
  five failures proved it fights the frame structure. The agent is the honest
  tool for "change something the component doesn't expose."
- **Verified by tests + reasoning** until the manual gate runs. Given the history
  on this surface, the gate is mandatory before "done."

## Out of scope

- On-canvas resize/move handles.
- Re-introducing detach in any form.
- Reflecting committed-on-disk prop values after a write (picker-snapshot
  limitation, unchanged) — the panel reflects the pending value.
