# Figma Export — Icon Capture & Swap — design

**Date:** 2026-06-09
**Status:** Design approved. Follow-up B from `2026-06-09-figma-export-fidelity-followups.md`. Builds on the hybrid swap (PR #11).
**Author:** Andrey + Claude (brainstorming session)

## Why this exists — the decisive finding

The hybrid swap creates real IconButton/Button instances, but they render the 0.3
component's **default placeholder glyph** (`Icons/Plus`, the circular plus), not the
real icon from the frame (chevrons, history clock, send arrow, add-collaborator). Root
cause: the fiber walk **prunes at the IconButton** and records only its text, never the
identity of the icon inside it — so the manifest has no idea which glyph to set.

**Two make-or-break facts proven live (2026-06-09):**

1. **The fiber exposes the icon.** Under every IconButton/Button fiber, the icon is the
   first named arcade-gen component child: `ChevronLeftSmall`, `ChevronRightSmall`,
   `ChevronDownSmall`, `Clock`, `HumanSilhouetteWithPlus`, `DotInLeftWindow`/`Right`,
   `ArrowUpSmall` (send), `PlusSmall`. So we can capture it at prune time.
2. **The icon is set by swapping the child node, NOT a component property.** The 0.3
   Icon Button's icon prop is type **`SLOT`** (`Icon#880:9`), which `setProperties`
   cannot set. But the created instance contains a named `Icons/*` INSTANCE child, and
   `iconChild.swapComponent(targetVariant)` works. **`importComponentByKeyAsync` fails**
   for the `Icons/*` keys (same library drift that deprecated the nav page) — so the
   target must be resolved by **local node**, then pick the Size-matched variant
   COMPONENT, then `swapComponent`. Proven end-to-end: `Icons/Plus` → swapped →
   `Icons/Chevron.left`.

## The model (decided)

**Capture icon identity at prune time; swap the icon child node at execution.**

```
fiber walk (prune at IconButton)         →  also scan subtree for first icon-mapped child
   ManifestComponent { ..., icon?: "ChevronLeftSmall" }
        │
   planSwap  →  replaceWithInstance { ..., icon?: { setKey } }   (key via existing iconMap)
        │
   executeSwap  →  after create: find inner Icons/* child, resolve setKey → LOCAL node →
                   Size-matched variant → iconChild.swapComponent(variant)
```

Reuses the existing `iconMap`/`iconEntries` (built in the widen work). The plan stays
pure + portable (carries the key); the executor maps key→local node (same pattern the
component-set swap already uses via its `LOCAL` map).

## Architecture — the four touch points

**1. `studio/src/export/slj.ts` — `ComponentNode` gains `icon?: string`.**
The arcade-gen icon name captured at prune (optional; absent for non-icon components).

**2. `studio/src/export/fiberWalk.ts` — capture at prune.**
`WalkCtx` gains `iconNameFor(fiber): string | null` — returns the arcade-gen name of the
first icon-mapped descendant, or null. The live impl (in `exportFrameToSlj.ts`) walks the
fiber subtree, applies `fiberName` + `findIconMapping`, returns the first hit. In
`walkFiber`'s prune branch (currently lines 75–84), call `ctx.iconNameFor(f)` and set
`icon` on the emitted ComponentNode when non-null. Keeps `fiberWalk` pure/testable (the
resolver is injected, like `isComponent`/`resolveColor`).

**3. `studio/src/export/figma/swapOps.ts` — carry it.**
- `ManifestComponent` gains `icon?: string`.
- `flattenManifest` reads `node.icon` off the ComponentNode onto the manifest entry.
- `SwapOp.replaceWithInstance` gains `icon?: { setKey: string }`.

**4a. `studio/src/export/figma/swapPlan.ts` — resolve the key.**
`SwapPlanMaps` gains `findIconSetKey(arcadeGenIconName): string | null` (the live impl
wraps `findIconMapping` → `figma.componentSetKey`, null when unmapped/ambiguous). In the
discrete `replaceWithInstance` emission, if `comp.icon` resolves to a key, attach
`icon: { setKey }`.

**4b. `studio/src/export/figma/executeSwap.ts` — swap the child.**
`SwapBridge` gains `setIconChild(instanceNodeId: string, iconSetKey: string): Promise<void>`.
After `createInstance` + `positionNode` (+ text) for a `replaceWithInstance` op that has
`icon`, call `bridge.setIconChild(id, op.icon.setKey)`. The live impl: find the inner
`Icons/*` INSTANCE child of the created instance; resolve `iconSetKey` → local node id
(via a key→localNodeId map, same as component sets); pick the variant COMPONENT whose
`Size` is nearest the child's rendered size (default `16`); `iconChild.swapComponent(target)`.
Best-effort: a missing child / unresolvable key / failed swap is caught and logged, the
instance keeps its default icon (no worse than today).

## Data flow (one IconButton)

```
fiber: IconButton > … > ChevronLeftSmall
  prune → ComponentNode { component:"IconButton", props:{variant:"tertiary",size:"sm"}, icon:"ChevronLeftSmall" }
  flatten → ManifestComponent { component:"IconButton", icon:"ChevronLeftSmall", box, props }
  plan → replaceWithInstance { componentSetKey: ICON_BUTTON, variant:{Variant:Tertiary,Size:Small}, icon:{ setKey: ICONS_CHEVRON_LEFT } }
  exec → createInstance(IconButton, Tertiary/Small) → setIconChild(id, ICONS_CHEVRON_LEFT)
         → finds inner Icons/* child, resolves key→local Icons/Chevron.left set, Size=16 variant, swapComponent
```

## Error handling

Every step degrades, never breaks: icon not in `iconMap` → no `icon` on the op → no swap →
default glyph (today's behavior). Icon child not found in the created instance, or the
local set unresolvable, or `swapComponent` throws → caught in `setIconChild`, logged,
instance keeps default. Icon capture failing in the walk → `icon` stays undefined.

## Testing

- **Pure units (fixtures, node env):**
  - `fiberWalk` test: a fake fiber with an icon-mapped child + an `iconNameFor` stub →
    asserts the emitted ComponentNode carries `icon`.
  - `swapOps` test: `flattenManifest` surfaces `icon` from a ComponentNode; a
    ComponentNode without an icon yields `icon: undefined`.
  - `swapPlan` test: a manifest component with `icon:"ChevronLeftSmall"` + a
    `findIconSetKey` stub → the `replaceWithInstance` op carries `icon:{setKey}`; an
    unmapped icon (stub returns null) → op has no `icon`.
- **Executor (fake bridge):** `executeSwap` calls `setIconChild(id, setKey)` exactly for
  ops that carry `icon`, after create/position; a throwing `setIconChild` is caught
  (op still counts as replaced, failure noted) and does NOT prevent the instance.
- **Live run:** re-run the hybrid swap on the Computer-with-panel frame; IconButtons show
  real glyphs (chevron-left/right nav arrows, clock history, send arrow, add-collaborator,
  New Chat plus). Screenshot-verified.

## Scope

**In:** `icon` on ComponentNode + manifest + plan op; `iconNameFor` capture in the walk;
`findIconSetKey` in plan maps; `setIconChild` in executor (local-node resolve + Size
variant + swapComponent); reuse `iconMap`/`iconEntries`; unit tests; one live screenshot
run.

**Out (YAGNI / blocked):**
- The #2 nav re-curation (sidebar `Chat Item` deprecated) — blocked on the DS owner;
  separate. Icons *inside* the deprecated Chat Item rows are out until #2 lands.
- Widening `iconEntries` to every glyph — only the icons present in the test frame need
  coverage; ambiguous/missing ones degrade. Widen opportunistically.
- Icon Size *Style* axis (Small/Large) — leave to set default unless a mapping needs it.
- Token binding, live UI entrypoint, transcript overflow (tracked elsewhere on PR #11).

## Done =

The Computer-with-panel frame, re-swapped, shows IconButtons with their **real glyphs**
instead of the default circular plus — chevrons on the nav arrows, clock on history, send
arrow on the input, add-collaborator in the header, the New Chat plus. Screenshot-verified
against the Studio render. Icons with no `iconMap` entry degrade silently to the default
(no regression).

## Risks

- **`iconMap` coverage / library drift.** Some `Icons/*` keys may be stale like the nav
  sets. Mitigation: the executor resolves by **local node** (not key import), and a failed
  resolve degrades to the default glyph. Re-confirm the handful of keys the test frame
  needs during the live run; fix any stale ones in `iconEntries.ts`.
- **Icon-child discovery.** Assumes the created IconButton contains exactly one `Icons/*`
  INSTANCE child. If a variant nests it differently, `findOne` still finds it by the
  `Icons/` name prefix; if not found, degrade. Verify on the live frame.
- **Size match.** Most icons are 16; nearest-Size pick with a 16 default covers the frame.
