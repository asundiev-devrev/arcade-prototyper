# Figma Export — Hybrid (capture layout + swap real components) — design

**Date:** 2026-06-09
**Status:** Design approved. Pivot from the all-ours pipeline (Slice 0 #8 / mapping #9 / consumer #10 / widen PR #11).
**Author:** Andrey + Claude (brainstorming session)
**Parent specs:** `2026-06-05-figma-export-design.md`, `2026-06-08-figma-export-widen-design.md`

## Why this exists — the decisive findings

The widen work (PR #11) proved we *can* produce real 0.3 component instances from a
live frame (52 instances: Chat Item ×30 with real titles, ChatBubble ×13 with real
text, Button, IconButton, Menu, plus bound color variables). But the **layout** our
own executor builds is broken — footer overlaps the session list, a stray Button
floats mid-canvas, the header clips. Root cause: reconstructing CSS layout
(absolute position + overflow + auto-layout) in the Figma plugin API is hard, and
it's the bulk of our maintenance burden.

Meanwhile, **flat-frame HTML→Figma converters nail layout for free.** Spike (2026-06-09)
captured the same Computer-with-panel frame with both `generate_figma_design`
(Figma-native) and html.to.design's MCP. Both produced **pixel-faithful, 1:1-coordinate
layouts** (sidebar 256 / container 752 / panel 272 — exact match to our SLJ) — but as
**flat frames with no design-system components** (Figma's own tool output says so
verbatim: "raw frames instead of design system components"). This is exactly the
"bubbles + black rectangles" class the user has seen — *except the layout is correct.*

**The inversion:** they're great at the part we're bad at (layout), we're the only
ones who can do the part they can't (real DS components). So: **let the converter
build the layout; we swap recognized flat frames for real 0.3 instances on top.**
This is also Figma's own recommended pattern (the capture tool literally suggests
"replace frames in this capture with design system components").

## The model (decided)

**Capture for layout + swap for components.** Three roles:

1. **Capture engine = layout scaffold.** `generate_figma_design` is the default
   (already connected in-session, no extra OAuth). Engine-agnostic: the swap takes a
   *captured Figma node id*, so html.to.design's MCP is a drop-in alternative.
   Produces the pixel-faithful flat-frame tree.
2. **Our fiber walk = identity source.** The existing serializer
   (`exportFrameToSlj.ts` → SLJ) already produces a component manifest: name + box +
   props + text + variant + token for every recognized 0.3 primitive. **Reused
   unchanged.**
3. **Swap pass = new core.** Takes (captured node, our manifest), mutates the captured
   tree in place — replacing matched flat frames with real instances.

**This deletes our hardest, most-broken code** (the executor's frame-building /
absolute-position / overflow / auto-layout reconstruction) and keeps only our edge
(component identity + variant + text-property + token binding).

## Spike findings (2026-06-09) — what the design is built on

Ran against the live captures in file `a2uKnm88LxRXEWAL1kOqeQ`
(html.to.design capture node `9281:2584`, Figma-native node `9304:8`):

- **Layout fidelity: Figma-native ≈ html.to.design (tie).** Both pixel-faithful, both
  flat-frame, same minor source-frame quirks. Engine choice is a non-decision for
  quality → spec engine-agnostic, default to Figma-native.
- **Coordinates are 1:1 with our SLJ.** No scaling transform needed.
- **Geometry-match is clean for DISCRETE components.** Matching our manifest boxes to
  their flat frames by edge-distance:
  - `ComputerSidebar.Item @ (8,148,239,36)` → their frame `(8,148,239,36)` — **boxError 0**
  - `New Chat Button @ (12,58,112,28)` → their `FrameLink (12,58,113,28)` — error 1
  - `IconButton(History) @ (132,52,40,40)` → their `(133,52,40,40)` — error 2
- **Geometry-match FAILS for the transcript.** `ChatBubble @ (272,64,400,409)` ≈ their
  `Container (272,150,400,590)` — **boxError 353**; the converter groups bubble
  content/padding differently than our fiber. Bubbles are the highest-count,
  highest-value component → they need a different strategy (below).
- **Their node names are only partially ours** (`WindowChrome`, `FrameLink` survive;
  bubbles become `List Item`/`Paragraph`, rows become generic). So matching is by
  **geometry**, not by their names. Names are at most a tiebreak (out of scope v1).

## Architecture — swap the front, delete the layout back

```
[Capture engine]  generate_figma_design (default) / html.to.design (drop-in)
       │  flat-frame tree in Figma (node id) — pixel-faithful layout, 1:1 coords
       ▼
[REUSED] fiber walk → component manifest        studio/src/lib/exportFrameToSlj.ts → SLJ
       │  name + box + props + text + variant + token   (UNCHANGED)
       ▼
[NEW] swapPlan(manifest, captureNodes) — PURE
       │  per-region: discrete = geometry match; transcript = container-replace
       │  → SwapOp[]
       ▼
[NEW] executeSwap(ops, bridge) — mutates the captured tree in place
       ▼  real 0.3 instances dropped into their layout
   Figma
```

**Reused unchanged:** fiber walk, SLJ contract, `componentMap`, `iconMap`, `tokenMap`,
the variant resolution + text-property + token-binding logic (the proven parts of #9–#11).

**Deleted (dead after this pivot):** the layout half of the consumer —
`planSlj.ts`'s frame/box emission and `executeFigmaOps.ts`'s `createFrame` /
positioning / parent-resolution. We no longer build frames; we swap into theirs. (The
component-instance + setText + bindVariable logic moves into `executeSwap`.)

**New units (small, focused, mirror the existing pure-plan/effectful-exec split):**

- `studio/src/export/figma/captureTree.ts` — read a captured Figma node via the Bridge
  → normalized `CaptureNode[] = {id, name, type, box, parentId, text}` (frame-relative
  boxes). The one Bridge-read unit.
- `studio/src/export/figma/swapPlan.ts` — **PURE.** `(manifest, captureNodes) →
  SwapOp[]`. Houses the geometry matcher + the region splitter. Fully unit-testable
  with no Bridge.
- `studio/src/export/figma/executeSwap.ts` — apply `SwapOp[]` over the Bridge:
  instance-from-local-node (the proven import-hang workaround), set component property,
  bind variable, reparent/inject, remove replaced flat frame. Best-effort per op.

## The geometry matcher (the one subtle algorithm)

Pair our component → their flat frame:

- **Score** = `|Δleft| + |Δright| + |Δtop| + |Δbottom|` (edge-distance sum). Lower = better.
- **Candidate filter:** only their nodes whose area is within **±25%** of ours (kills
  matching a 12px dot to a 400px bubble).
- **Accept** the best candidate iff `score ≤ 8px` AND the next-best is `> 4px` worse
  (ambiguity guard). Verified: real discrete matches score 0–2 and are unambiguous.
- **Reject → leave their flat frame untouched** if over threshold or ambiguous. Never
  force a wrong swap. (This is what catches the bubble case before it does damage.)

Threshold (8) and ambiguity gap (4) are the testable knobs.

## Per-region swap strategy

The matcher runs only on the **discrete** region. The **transcript** is special-cased.

- **Discrete region** (sidebar rows, New Chat, history/chrome buttons, panel items,
  header actions, menu): for each manifest component, run the geometry matcher against
  the capture nodes. On accept → emit `replaceWithInstance` (create the real 0.3
  instance, position/size to the matched node's box + parent, set label via component
  property, bind tokens, remove the matched flat frame).
- **Transcript region**: find the capture's transcript **container** (the node whose
  box matches our transcript region box, e.g. `(256,48,1200,832)`). Emit
  `injectInstances`: remove the container's flat children, create our ChatBubble
  instances as children positioned by our manifest boxes **relative to the container**.
  (v2 already positioned bubbles correctly — reuse that geometry.)
- **Unmatched components**: leave their flat frame as-is. Graceful degrade — the result
  is never worse than a pure capture.

## SwapOp shape (the contract between plan and exec)

```ts
type SwapOp =
  | { op: "replaceWithInstance"; targetNodeId: string; componentSetKey: string;
      variant?: Record<string,string>; box: Box; parentNodeId: string;
      text?: { propName?: string; characters: string };
      binds?: { field: "fill"|"stroke"; variableKey: string }[] }
  | { op: "injectInstances"; containerNodeId: string; clearChildren: boolean;
      instances: Array<{ componentSetKey: string; variant?: Record<string,string>;
        box: Box; text?: { propName?: string; characters: string } }> }
```

`swapPlan` returns `SwapOp[]`; `executeSwap` applies them. Same pure-plan / effectful-exec
split as `planSlj`/`executeFigmaOps`, so test patterns carry over.

## Error handling

Every op independent + best-effort (mirrors the current executor). Failed match → leave
flat frame. Failed instance-create → leave flat frame + log. Never leaves a half-broken
node. **Worst case = the pure capture, which is already good.** No op may delete a flat
frame before its replacement instance is confirmed created.

## Testing

- `swapPlan.ts` is **pure** → unit tests on real fixtures: a dump of the capture's
  `CaptureNode[]` (from node `9281:2584`) + our manifest. Assert: discrete components
  matched (boxError ≤ 8), bubbles routed to `injectInstances` not `replaceWithInstance`,
  over-threshold/ambiguous nodes left untouched, area filter + ambiguity guard fire.
- Geometry matcher gets its own table tests (clean match, over-threshold reject,
  ambiguous reject, area-filter reject).
- `executeSwap` tested with a **fake bridge** (same pattern as
  `executeFigmaOps.test.ts`): asserts op→bridge-call mapping, best-effort on failure,
  no flat-frame removal before instance confirmed.
- One **live end-to-end run**, screenshot-verified against the Studio render.

## Scope

**In:** `captureTree` reader; `swapPlan` (pure) + geometry matcher + region splitter;
`executeSwap`; delete the dead layout code (`planSlj` frame emission +
`executeFigmaOps` createFrame/positioning); one live screenshot-verified run on the
Computer-with-panel frame.

**Out (YAGNI):**
- The Studio UI button / tester-facing capture trigger (separate follow-up).
- The capture-engine wiring choice (engine-agnostic — swap takes a node id).
- Multi-frame batch export.
- Matching the long tail of unmatched components (they degrade to flat frames, fine).
- Name-hint matching (geometry is sufficient; revisit only if geometry proves weak).

## Done =

The same Computer-with-panel frame: capture → swap → visibly shows a real sidebar
(real Chat Item rows with real titles + avatars), real ChatBubble instances with their
REAL message text, real Button / IconButton / Menu chrome — all sitting in the
converter's faithful pixel layout (no footer overlap, no stray floating button, no
clipped header). Screenshot-verified against the Studio render. No region renders worse
than the pure capture.

## Risks

- **Transcript container identification.** The container-replace hinges on finding the
  right capture node for the transcript region by box. If the converter nests it
  unexpectedly, the bubble injection misses. Mitigation: match the container by our
  transcript region box with the same tolerance; fall back to leaving flat bubbles
  (degrade, not break). Verify in the plan against the real capture.
- **Capture engine drift.** A converter changing its output structure could shift boxes.
  Mitigation: geometry tolerance + engine-agnostic input (swap a node id, re-capture
  anytime). The matcher's reject path means drift degrades to flat frames, never wrong
  swaps.
- **Instance-from-key still hangs cross-file.** Reuse the proven local-node instancing
  workaround in `executeSwap` (resolve component-set key → local node id, instance from
  the variant child). In-file variable import is fast (~12ms), confirmed in #11.
- **Coupling to a captured-node input.** The swap assumes a capture already exists in
  the file. Acceptable: the capture step is a documented precondition (UI wiring is a
  separate follow-up).
