# Export prototypes to Figma — design

**Date:** 2026-06-05
**Status:** Design approved. First slice = thin end-to-end vertical (Slice 0); full
serializer (#1), mapping (#2), consumer (#3) follow. Hardened against an
adversarial review pass (2026-06-05) — see "Adversarial-review corrections".
**Author:** Andrey + Claude (brainstorming session)

## Problem

Beta-testers want to push their Studio prototypes back into Figma. Today they
use the `html.to.figma` plugin (Builder.io / div Riots): it reads a rendered
page and rebuilds it in Figma as plain rectangles + text. It works for "get
the pixels into Figma" but recognises **no components** — the result is a flat
pile of shapes with frozen colors, no design-token bindings, and weak layout.

Studio has an advantage `html.to.figma` structurally cannot have: **every
prototype is built from our own closed component kit** (`arcade/components` =
`@xorkavi/arcade-gen`, and `arcade-prototypes` = the prototype-kit composites).
We know the component identity of everything on screen. So our export can place
**real DevRev library component instances**, bound to the **real design
tokens**, inside **editable auto-layout** — a categorically better artifact
than a DOM dump.

## Goal

Let a designer take a generated frame and land it in Figma as:
- Real instances of the published DevRev/arcade-gen Figma library components,
  with their variant/props carried across — not rectangles.
- Auto-layout frames (padding / gap / direction / alignment preserved) so the
  result is editable and reflows — not absolute-positioned pixels.
- Colors/strokes/radii bound to Figma **variables** where they trace back to a
  design token — not frozen hex.
- A graceful **auto-layout-frame fallback** for any component we have not yet
  mapped to a Figma key, so every frame exports fully from day one and upgrades
  to real instances as mapping coverage grows.

## Key decisions (locked during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Export approach | **Component-aware** (real instances + token→variable binding) | The whole value prop; feasible because everything is built from our kit. |
| Figma library | **A published DevRev component library exists** | Confirmed. Real instances need component keys to import against; a published library provides stable keys. |
| Delivery path | **Bridge now, plugin later** | Phase 1 proves the JSON→instances mapping cheaply via the `figma-console` Bridge (no plugin to build/publish). Phase 2 wraps the *same JSON contract* in a shippable Figma plugin for testers. |
| Why not figmanage/REST | **REST can't create nodes** | The Figma REST API is read-only for document nodes. Writing design into Figma *requires a plugin/Bridge*. figmanage (a REST wrapper) cannot write. This is also why `html.to.figma` needs a plugin. |
| Layout model | **Auto-layout** (infer from flex/stack) | Editable + reflows; matches how DevRev components are built; the core of "more powerful than html.to.figma". Absolute geometry rides along only as fallback. |
| Unmapped components | **Auto-layout-frame fallback** | Nothing is ever missing; mapped components upgrade to true instances over time. Never block; never leave visible holes. |
| Component correlation | **Stamp `data-*` attributes** at the kit boundary (render-time) | Exact + robust + works for real-data frames (e.g. the Computer chat pulling live DevRev messages). Rejected: React-fiber walk (fragile, depends on React internals) and TSX-AST-align (breaks on conditionals/loops/real data). |
| Serialization source | **Rendered frame at runtime** (in the iframe) | Auto-layout inference needs real geometry; only runtime has both the live DOM *and* the stamped component identity to correlate them. Also makes dynamic/real-data frames export correctly. |

## The durable artifact: Studio Layout JSON (SLJ)

A versioned, component-aware tree describing one rendered frame. It is the
contract both the Phase-1 Bridge consumer and the Phase-2 plugin consume
unchanged. Everything else in the feature is a producer or a consumer of SLJ.

```jsonc
{
  "slj": 1,                         // schema version
  "frame": { "slug": "01-settings", "project": "settings-page",
             "width": 1440, "mode": "light" },
  "root": { /* node */ }
}
```

A **node** is one of two kinds:

### Component node — a recognised kit component
```jsonc
{
  "kind": "component",
  "component": "ChatBubble",        // kit name (from data-arcade-component)
  "source": "arcade/components",    // or "arcade-prototypes"
  "props": { "variant": "receiver", "tail": false },  // serialized props/variant
  "box": { "x": 0, "y": 0, "width": 320, "height": 64 },  // frame-relative geometry
  "layout": { "mode": "vertical", "gap": 8,
              "padding": [12, 16, 12, 16], "align": "start" },
  "children": [ /* nodes — e.g. the text inside the bubble */ ]
}
```

### Element node — plain DOM (the connective tissue between components)
```jsonc
{
  "kind": "element",
  "tag": "div",                     // or "text", "img"
  "box": { "x": 0, "y": 0, "width": 320, "height": 64 },
  "layout": { "mode": "horizontal", "gap": 6, "padding": [0,0,0,0], "align": "center" },
  "style": {
    "fill": "--bg-neutral-soft",    // TOKEN REF when resolvable, else "#RRGGBB"
    "cornerRadius": 8,
    "stroke": { "color": "--stroke-neutral-subtle", "width": 1 }
    // text nodes additionally carry:
    // "characters", "fontFamily", "fontSize", "fontWeight", "lineHeight", "color"
  },
  "children": [ /* nodes */ ]
}
```

### Principles baked into the schema
1. **Token references, not raw hex, wherever possible.** When a computed color
   traces back to a `--fg-*` / `--bg-*` / `--stroke-*` custom property, emit the
   token name. This is what lets the Figma side bind a *variable* instead of a
   frozen color — the thing `html.to.figma` cannot do. Raw value only when the
   token cannot be resolved.
2. **Layout is primary, coordinates are fallback.** Every container carries
   inferred auto-layout (`mode`/`gap`/`padding`/`align`). `box` geometry rides
   along for the fallback path and for sanity-checking, not as the primary
   placement instruction.
3. **Component nodes keep their children.** A `ChatBubble` node still contains
   its text node, so the consumer can place the instance *and* set
   text/overrides where needed.

**Known schema gaps (review finding) — accepted for v1, planned for v1.1.** The
v1 `style` object omits several visual properties real composites use:
`opacity`, `zIndex`/stacking, `overflow`/clipping, per-corner `borderRadius`,
and `boxShadow`/effects. v1 captures fill, single-value cornerRadius, stroke,
and text properties only. Because the schema is versioned and both consumers
read it, adding these is a clean **v1.1 additive bump** during #3 once the
Figma-side need for each is concrete — not a breaking change. Listed here so
they aren't silently dropped.

---

## Decomposition

Too large for one spec. The SLJ contract is the seam between pieces. The
adversarial review made one structural change: **the first slice is a thin
end-to-end vertical (Slice 0), not the full serializer** — because a
serializer-only #1 ships nothing visible in Figma and leaves the riskiest
assumptions (token recovery, Bridge write, component-key import) unproven until
late, when a wrong SLJ contract is expensive to fix.

| # | Piece | Delivers | Depends on |
|---|---|---|---|
| **0** | **Thin vertical** | ONE component (`ChatBubble`) stamped → serialized → minimal Bridge call → ONE real instance appears in Figma | — (de-risks the whole chain) |
| **1** | **SLJ contract + runtime serializer** | describe any rendered frame as correct component-aware SLJ (all components, layout inference, token refs) | Slice 0 proved the contract |
| **2** | **Figma mapping + token-variable table** | kit component+variant → Figma component key + variant props; token → Figma variable; defines the fallback | #1's vocabulary |
| **3** | **Bridge consumer (then plugin)** | turns SLJ into real Figma nodes (instances + auto-layout + frame fallback) for all frames | #1 + #2 |

**Slice 0 is the first build.** It touches one thread through every layer so the
hard parts fail fast. #1–#3 widen each layer afterward; each gets its own spec.

### Slice 0 — thin vertical (the first build)

Prove the entire chain on the smallest surface:
1. **Stamp** `ChatBubble` (and only it) with `data-arcade-*` via the chosen
   transform (see corrected mechanism below).
2. **Serialize** a one-bubble frame to SLJ (one component node + its text child).
3. **Recover** the bubble's fill/text token from the live iframe CSSOM (proves
   the value→token approach, not disk reads).
4. **Bridge write:** resolve `ChatBubble`'s published Figma component key, call
   `importComponentByKeyAsync` + `createInstance`, set the `variant` property,
   set the text, place it in one auto-layout frame.
5. **Done =** one real `ChatBubble` *instance* (not a rectangle) appears in a
   Figma file, correct variant + text, via the figma-console Bridge.

If any link can't be made to work on one component, we learn it now — before
building breadth.

**This spec details Slice 0 + sub-project #1.** #2 and #3 are scoped below.

---

## Sub-project #1 — SLJ contract + runtime serializer (DETAILED)

Three moving parts.

### A. Component stamping (build/dev-time transform)

Frames import kit components only through the `arcade` / `arcade-prototypes`
aliases (already enforced by the import-validation hook
`server/hooks/validateArcadeImports.mjs`). We add one transform at those alias
boundaries that wraps each kit component so its **root rendered DOM node**
carries:
- `data-arcade-component="ChatBubble"`
- `data-arcade-source="arcade/components"`
- `data-arcade-props='{"variant":"receiver","tail":false}'` — JSON, serializable
  props only (strings/numbers/booleans/plain objects; functions, React nodes,
  and other non-serializable props are omitted).

This runs in **both** render paths the discovery mapped:
- dev: the `frameMountPlugin` virtual module (`virtual:arcade-studio-frame.tsx`)
- share: the `cloudflare/bundler.ts` entry

so a frame exports identically whether previewed or shared. It is **render-time**,
so a real-data frame (Computer chat pulling live DevRev messages) stamps
correctly — the rejected TSX-AST approach could not handle conditionals, loops,
or runtime data.

**Stamping mechanism — decided (adversarial review corrected the original lean).**
The shim-wrapper route does NOT work as a general mechanism: `arcade-components.tsx`
wraps only `Button` and `IconButton`, while everything else flows through
`export * from "@xorkavi/arcade-gen"` **unwrapped**. Wrapping all ~186 exports
by hand is infeasible (most are icons) and still wouldn't reliably land an
attribute on the *root DOM node* of every component (prop-spread varies; some
swallow unknown props). Therefore:

- **Use a build/dev-time JSX transform**, not shim wrappers. The transform runs
  over frame source (where every kit component is a JSX element from a known
  alias) and injects `data-arcade-*` props at the call site. This is robust
  across all component shapes and does not require per-component wrappers.
- **Compound + decoration components need explicit handling** (review finding):
  - Compound members (`ChatMessages.Agent`, `ChatMessages.Thoughts`,
    `ChatInput.SendButton`) are real call sites and get stamped like any other
    JSX element.
  - Some composites render **multiple top-level siblings or absolutely-positioned
    decorations** (e.g. `Thoughts` renders a pill *and* a detached
    `ThoughtCloudDecoration` SVG at `bottom:-6,left:-6`). The stamped attribute
    lands on the component's outer wrapper; the serializer (Part B) treats
    absolutely-positioned descendants as separate geometry nodes under that
    component, not as part of its auto-layout.
- **Slice 0 validates this on `ChatBubble` first** (single clean root), then #1
  widens to compound/decoration cases with the rule above.

**Prop serialization is intentionally lossy for ReactNode props** (review
finding): props like `thoughts={<ChatMessages.Thoughts .../>}` cannot round-trip
as data — they are omitted from `data-arcade-props`. That is acceptable because
the ReactNode *renders* into the DOM and is captured structurally by the walk
(as child nodes); only the prop-level binding is lost, not the visual content.
The plan documents this as deliberate.

### B. The DOM walk (runtime, inside the iframe)

A serializer script walks the live DOM tree:
- At each node, read `getComputedStyle` for geometry + visual style.
- If the node has `data-arcade-component` → emit a **component node** (identity
  from the attribute, geometry from the DOM, props from `data-arcade-props`).
- Else → emit an **element node**.
- **Auto-layout inference:** from each container's computed `display`,
  `flex-direction`, `gap`, `padding`, `justify-content`, `align-items` derive
  `{mode, gap, padding, align}`. Flex containers map directly. A non-flex
  container whose children form a clean single-axis stack gets an inferred
  auto-layout; **"genuinely irregular" must be defined operationally** (review
  finding) — at minimum: any child with `position: absolute`/`fixed`, any
  detected sibling bounding-box overlap, negative margins (e.g.
  `-space-x-1.5`), or non-monotonic child offsets along the axis → the container
  is marked `layout: null` and its children carry absolute geometry for the
  fallback path. Pseudo-element decorations (`::before` gutters) are not in the
  DOM and are not captured; where they carry meaning (the ComputerMessage
  sprite gutter) the component mapping (#2) accounts for it, not the serializer.
- **Token resolution — corrected (review finding).** `getComputedStyle` returns
  the **resolved `rgb()`/px value, not the `var(--token)` reference** — once the
  browser computes a token the name is gone. And the token CSS is **not a local
  repo file**: `@xorkavi/arcade-gen` is an external npm package; there is no
  `arcade-gen/src/tokens/generated/*.css` on disk to read. So:
  - The serializer runs **inside the iframe**, where `DevRevThemeProvider` has
    injected the token custom properties into the live CSSOM. It builds a
    **value→token reverse index** by reading the resolved value of each known
    token name off `:root` (`getComputedStyle(root).getPropertyValue('--fg-...')`)
    at serialize time — no disk access, correct for the current light/dark mode.
  - **Collisions are expected** (multiple tokens resolve to the same hex;
    semantic aliases). The reverse index maps value → *candidate* token names;
    the emitted SLJ carries the candidate set (or the raw value when the set is
    empty/ambiguous), and **disambiguation is the consumer/mapping's job (#2)**,
    informed by which property the value is used for (fill vs stroke vs text).
  - The list of token names to probe comes from the injected sheet itself
    (enumerate `--fg-*`/`--bg-*`/`--stroke-*`/`--surface-*`/`--corner-*` custom
    properties present on `:root`), so it stays current with arcade-gen without
    a vendored copy.

### C. Trigger + transport

An **"Export to Figma"** action (next to the existing Share action) drives it.
The runtime walk must happen *inside* the iframe where the DOM + tokens live, so:
1. Studio shell asks the frame iframe to serialize (`postMessage`).
2. The iframe runs the DOM walk and returns the SLJ (`postMessage` back).
3. The shell hands it to a new server endpoint
   `GET/POST /api/projects/:slug/export/:frame.slj.json` (mirrors the existing
   LIFT endpoint shape in `server/middleware/lift.ts`).
4. That stored JSON is what the Bridge (Phase 1) or plugin (Phase 2) consumes.

### Sub-project #1 scope (widen the serializer — after Slice 0)

Slice 0 proves the chain on `ChatBubble`. #1 then widens the **serializer** to
all kit components and the full SLJ contract. Still does NOT touch Figma beyond
what Slice 0 established.

**In scope:** produce and validate *correct SLJ* for any frame — all component
identities, props, nested structure, auto-layout inference (with the
`layout: null`/absolute fallback), and token refs (candidate sets).

**Out of scope for #1 (deferred):**
- Images-as-fills handling — defer to #3 when the Figma-side need is concrete.
- Interaction / prototyping-link export — static layout only.
- v1.1 style properties (opacity, z-index, overflow, per-corner radius, shadows).

**Done =** for representative frames (a settings page, a vista list, the
Computer chat with real data), the emitted SLJ has correct component identities,
props, nested structure, inferred auto-layout, and token refs — including
correct handling of the compound/decoration cases (Part A) and irregular
containers (Part B).

### Verification (#1)

- Snapshot tests against known fixture frames (reuse the `__tests__/lift`
  fixture pattern): assert the SLJ tree for each fixture has the expected
  component identities, props, layout inference, and token refs.
- A real-data frame (Computer chat) in the fixture set proves runtime
  correlation works where source-parsing would fail.
- A fixture that exercises absolute decorations + negative margins (the
  `Thoughts` cloud) asserts the `layout: null` fallback fires correctly.
- Manual: run "Export to Figma" on a live frame, inspect the stored
  `.slj.json`.

> **Note on #1's "Done" being non-visual (review finding):** #1 validates SLJ
> *structure*, not Figma output — which is fine precisely because **Slice 0
> already proved the visual round-trip** on one component. Without Slice 0 this
> would be the dangerous "looks done but unproven" gap the review flagged; with
> it, #1 is safe to verify by snapshot alone.

---

## Sub-projects #2 and #3 (scoped, detailed later)

### #2 — Figma mapping + token-variable table
- The new load-bearing knowledge: `kit component + variant/props → Figma
  component key + variant properties`, and `design token → Figma variable`.
- Seeds available: 13 Figma node IDs already in kit source comments (e.g.
  ChatMessages → `161:9716`, `_Thoughts` set `6064:65430`) across 8 composites,
  in the "Untitled" prototype and "C - May Release" files; and
  `src/lift/figma-token-values.json` (hand-curated token→hex).
- **node ID ≠ published component key (review finding, BLOCKER for #3).** The
  IDs in kit comments are *file-internal node IDs* (`161:9716`).
  `importComponentByKeyAsync` requires the **published component key** (a long
  hash) from a *published* library — a different identifier. #2 must resolve
  node ID → published key (read the published library's components via the API,
  match by name/node, record the key). **Verify the library is actually
  published and keys are obtainable before #3 starts.**
- **Variable binding requires the variables to already exist in the target file
  (review finding).** `setBoundVariableForPaint` binds to a variable that must
  be present — so the DevRev library must publish **variables**, not just
  components. #2 must confirm variable publishing; if absent, either get them
  published or degrade token→variable binding to plain resolved colors for v1.
- **Variant mapping is per-component, not guaranteed clean (review finding).**
  Our prop `variant="receiver"` does not necessarily equal a Figma variant
  property of the same name/value. #2 carries an explicit prop→variant-property
  map per component, not a blanket assumption.
- Defines the **fallback contract**: what an unmapped component degrades to
  (a styled auto-layout frame built from its element children).
- Open question: standalone table vs. extend the LIFT mapping tables
  (`src/lift/mappings/`) with Figma columns. LIFT today is purely
  studio→production with zero Figma refs.
- Note: `figmaCli.ts`/`figmanage` is **read-only and cannot fetch variables for
  write-binding** in a way #3 needs — #3's variable work goes through the Bridge
  (`figma.variables.*`), not figmanage.

### #3 — Bridge consumer (then plugin)
- Phase 1: a script the `figma-console` Bridge executes — walks SLJ, calls
  `importComponentByKeyAsync` + `createInstance` for mapped components, sets
  variant properties, builds auto-layout frames, binds variables
  (`setBoundVariableForPaint`), and renders the auto-layout-frame fallback for
  unmapped nodes. Note: `claudeCode.ts:143` currently *blocks* figma-console
  because the Bridge isn't running on tester machines — Phase 1 is an
  internal/dogfood path that requires Figma desktop + Bridge plugin + MCP
  connection live.
- Phase 2: wrap the identical SLJ contract in a shippable Figma plugin (one-time
  install, fetches/pastes SLJ, same node-building logic) so beta-testers don't
  need the Bridge/MCP setup.
- Handles images-as-fills (`figma.createImage`) and font loading
  (`loadFontAsync`) — the items deferred from #1.

## Risks / watch-items

- **Stamping mechanism** — JSX transform (not shim wrappers); compound +
  absolutely-positioned-decoration components need the explicit handling in
  Part A. Validated on `ChatBubble` in Slice 0, widened in #1.
- **Token recovery is lossy** — `getComputedStyle` returns resolved values, not
  token names; the value→token reverse index has collisions. Mitigated by
  reading live CSSOM + deferring disambiguation to #2 by property context.
- **Auto-layout inference quality** on irregular/overlapping layouts — the
  `layout: null` + absolute-geometry fallback must be clean, not produce broken
  half-auto-layout. Operational definition of "irregular" is in Part B.
- **Published-library key discovery** (#2 BLOCKER): node ID ≠ published key.
  Confirm the library is published, components AND variables, and keys
  obtainable, before #3.
- **Bridge setup burden** (#3 Phase 1) — internal only until the Phase-2 plugin
  exists.

## Adversarial-review corrections (2026-06-05)

A 4-lens adversarial pass (24 challenges, 22 verified: 3 real, 16
partially-valid, 3 dismissed) changed the design as follows. Recorded so the
rationale isn't lost:

1. **First slice is now a thin end-to-end vertical (Slice 0)**, not the full
   serializer — the riskiest links (token recovery, Bridge write, key import)
   are proven on one component before building breadth.
2. **Stamping = JSX transform, not shim wrappers** — `arcade-components.tsx`
   wraps only 2 of ~186 exports; a wrapper can't stamp every component's root.
3. **Token resolution reads the live iframe CSSOM, not disk** — arcade-gen
   tokens are an external npm package (no local `tokens/*.css`), and
   `getComputedStyle` returns resolved `rgb()` not `var()`. Value→token reverse
   index with collisions resolved downstream by property context.
4. **Compound + decoration components** (`ChatMessages.Agent`, `.Thoughts`,
   `ThoughtCloudDecoration` SVG, `::before` gutters, negative-margin overlaps)
   get explicit serializer handling; absolutely-positioned descendants become
   separate geometry nodes, not auto-layout members.
5. **node ID ≠ published component key**, and **variable binding needs variables
   published in the target file** — both are #3 blockers gated on confirming the
   library's publish state.
6. **SLJ schema gaps** (opacity, z-index, overflow, per-corner radius, shadows)
   acknowledged for a v1.1 additive bump.
7. **figmanage cannot write** — confirmed; all writes go through the Bridge.

## Non-goals (whole feature, v1)

- Round-trip / re-import (Figma edits back into Studio).
- Exporting interactions, prototyping links, or animations.
- Pixel-perfect parity over editability — we choose editable auto-layout.
