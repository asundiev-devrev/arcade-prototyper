# Figma Export — Widen to Primitive-Level Real Components — design

**Date:** 2026-06-08
**Status:** Design approved. Follow-on to Slice 0 (#8), mapping #2 (#9), consumer #3 (#10) — all merged. This addresses the fidelity gap those exposed.
**Author:** Andrey + Claude (brainstorming session)
**Parent spec:** `docs/superpowers/specs/2026-06-05-figma-export-design.md`

## Why this exists — the decisive findings

#3 shipped and round-tripped a real frame to Figma, but the live result was **a
column of chat bubbles + black rectangles**, nothing like the real Arcade Studio
UI. Two live runs confirmed it. Root-causing it surfaced findings that reframe
the whole feature:

1. **Only 1 of ~48 kit components is stamped** (ChatBubble). Everything else
   serialized as anonymous `<div>`s → rebuilt as plain rectangles. The DevRev
   chrome (sidebar, header, panel, input) was unidentified boxes.
2. **The Studio kit and the Figma 0.3 library are NOT the same component set.**
   The kit has ~25 page-level *composites* (`ComputerSidebar`, `ComputerScene`,
   `VistaPage`, `SettingsPage`) that **do not exist as Figma components** — they
   are Studio-only assemblies. The 0.3 library has *primitives* (Button, Bubble,
   `Computer Item`, `Computer Avatar`, `Icons/*`) but not the composites. Probe
   confirmed: searching "computer sidebar" in 0.3 → 0 results; only fragments
   (`Computer Item`, `Computer Avatar`, `_Computer Header`).
   **Consequence: "real components" can only ever mean the PRIMITIVE layer.** The
   composite layer is frames no matter what — which is exactly how the 0.3
   library itself is structured (its composites are frames of primitives too).
3. **Double-structure bug.** A real component instance already contains its own
   internals; the serializer also walked *into* the DOM of that component,
   emitting the instance PLUS frames redrawing its insides — junk.
4. **Icons lost.** 45 svg/path/circle nodes (chevrons, send arrow, plus,
   avatars' marks) — 0 captured.
5. **Text mis-targeted.** `setText` hit hidden template text nodes → bubbles
   showed placeholder copy, not the real messages.

**Node-makeup audit of a real frame (682 nodes):** 15 components (2%), 319 text
(47%), ~250 structural div/span/p/li, 45 icon nodes (7%), 364 token-bound fills.
The content is mostly real (text + its containers), not throwaway — so widening
is worth it; the gap is identification + icons + pruning, not "it's all noise".

## The model (decided)

**Map to primitives + assemble in frames.** Mirror how the 0.3 library is built:
- **Primitives** (Button, Bubble, Computer Item, Computer Avatar, Chip/Counter/
  Toggle, Input, icons) → real Figma component **instances**.
- **Composites** (ComputerSidebar, the transcript, the panel) → auto-layout
  **frames** that *contain* those real primitive instances.
- Recognize primitives **at any nesting depth**, including composite sub-parts
  (`ComputerSidebar.Item` → `Computer Item`) and `.map`-generated rows.

## Key decisions (locked during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Component model | Primitives = instances; composites = frames-of-instances | The 0.3 library has primitives, not page composites. This is the only coherent model + matches the library's own structure. |
| Prune rule | **Prune-with-text** | At a mapped primitive: emit instance, extract its text for override, STOP descending. Kills the double-structure rectangle pile; the instance brings its own internals; only its text is needed. |
| Icons | Map to real **`Icons/*`** 0.3 set | The library has a full Icons set. arcade-gen icons have names (`PlusSmall`, `ChevronDownSmall`) → resolve to `Icons/<Name>`. Real icon instances, not flattened vectors. |
| Composite internals | **Map every recognizable primitive, any depth** | Maximal fidelity: the sidebar frame fills with real `Computer Item`/`Computer Avatar` instances, the `.map`-rows become real instances. |
| Serializer input | **Runtime React fiber walk** | Reads the resolved component tree natively — names + props + nesting, sub-parts AND `.map`-over-data rows free, no per-component stamp maintenance. The decisions above (sub-parts, dynamic rows, prune) all need the resolved tree; static AST can't see `.map(data)`, hand-wrappers miss sub-parts. Needs bundler `keepNames`. |

## Architecture — swap the front, reuse the back

```
[NEW] fiber walk (in iframe at render)
        │  read React fiber: component name + props + children, data resolved
        │  prune-with-text at mapped primitives
        ▼
   SljNode tree   (the EXISTING contract from studio/src/export/slj.ts)
        │
        ▼  [REUSED UNCHANGED]
   planFigmaOps (#1)  →  componentMap + tokenMap + NEW iconMap (#2)  →  executeFigmaOps (#3)  →  Figma
```

**New units:**
- `studio/src/export/figma/fiberWalk.ts` — walk the rendered frame's React fiber
  tree → produce the existing `SljNode` shape. Component fibers whose
  `type.name`/displayName matches a known kit component → `ComponentNode`
  (with serializable props); host fibers (div/span/text/svg) → `ElementNode`.
  **Prune-with-text:** when a fiber is a mapped primitive, emit the component
  node, walk ONLY to collect its text (set as the node's text/override), and do
  NOT emit its internal structure as children.
- `studio/src/export/figma/iconMap.ts` — arcade-gen icon name → `Icons/*` Figma
  component key (+ size variant). A sibling to `componentEntries.ts`, captured
  Bridge-assisted.
- Bundler change: `keepNames: true` in the esbuild config
  (`frameMountPlugin.ts` + `cloudflare/bundler.ts`) so fiber `type.name`
  survives.

**Reused unchanged:** the `SljNode` contract, `planFigmaOps`,
`executeFigmaOps`, `componentMap`, `tokenMap`.

**Extended:** `componentEntries.ts` grows to cover composite sub-parts
(`Computer Item`, `Computer Avatar`, the header/logo fragments) + the new icon
map. The planner gains an `icon` node path (or treats icons as components).

## Fiber-walk spike — PROVEN (2026-06-08)

Ran the make-or-break spike on the live Computer-with-panel frame. Result:
**decisive success, far richer than the DOM serializer.**

- Fiber reachable via the DOM node's `__reactFiber$…` key; walk works.
- **815 fiber nodes, 310 component fibers, 69 distinct component names** (vs the
  DOM audit's 15 components + ~600 anonymous divs).
- **Names survive the dev bundler** (esbuild, minify off): `ChatBubble`×30,
  `IconButton`×8, `Avatar`×5, `Button`×3, `ComputerHeader`, `ComputerPage`,
  `Markdown`×30, and icons BY NAME — `PlusSmall`, `ChevronLeftSmall`,
  `DotInLeftWindow`, `Document`, `Clock`, `AgentStudio`.
- **`.map`-over-data rows resolve free**: `Item`×34 (the sidebar session/chat
  rows = `ComputerSidebar.Item`) and `ChatBubble`×30 — exactly what static AST
  could not do.
- **Real props present**: `IconButton{variant,size}`, icon `{size}`,
  `DotInLeftWindow{size}`, etc.

**Verdict: fiber walk is validated as the serializer front-end.** Risk
downgraded from "highest, spike first" to "proven on dev build". Three smaller
findings to handle in the plan (below).

## Open questions for the plan (resolve before/at build)

- **Forwardref / Radix wrapper names.** ~6 fibers came back as `(obj
  component)` and some as bare `Root`/`Group`/`MenuProvider`/
  `DropdownMenuProvider` (Radix internals). The walk needs: (a) better name
  extraction for forwardRef/memo (`type.render.name`), (b) a skip-list for Radix
  provider/internal wrappers (treat as transparent containers, descend through).
- **Compound sub-part names are bare.** `Item`×34 resolves but as `"Item"`, not
  `"ComputerSidebar.Item"` — confirm no name collision across composites, and
  decide how the mapping keys them (likely need a displayName convention on kit
  compound sub-parts, e.g. `ComputerSidebar.Item.displayName = "ComputerSidebar.Item"`).
- **`keepNames` for production bundles.** Dev (minify off) preserves names; the
  Cloudflare/minified path needs `keepNames: true`. Confirm + measure size.
- **Prune boundary for composites.** A composite (ComputerSidebar) is NOT a
  mapped primitive, so we descend into it (good — that's how we reach its
  Computer Item rows). Confirm the walk distinguishes "mapped primitive → prune"
  from "composite/host → descend".
- **Icon size variants.** `Icons/*` sets have Size=12/16/24/32; map from the
  arcade-gen icon's rendered size.
- **Text extraction from a pruned subtree.** Define "the component's text" — the
  concatenated visible text, or the primary label node? (The #3 T6 finding:
  lowest-depth `[0]` was wrong for Bubble.) Likely: collect all visible TEXT
  fibers under the primitive, join, set as the instance's main text property.
- **Composite sub-part stamping vs fiber names.** Compound components
  (`ComputerSidebar.Item`) — does the fiber carry a usable name? If the function
  is anonymous, fiber walk needs a displayName convention on kit sub-parts.

## Scope

**In:** fiber-walk serializer producing SljNode; prune-with-text; icon map +
icon node handling; widened componentEntries (primitives + sub-parts); keepNames;
a full-frame live run that visibly produces the real two-pane UI with real
primitive instances + icons + correct text.

**Done =** the same Computer-with-panel frame, exported live, visibly shows: a
real sidebar (real Computer Item rows, New Chat Button, avatars, icons), real
ChatBubble instances with their REAL message text, real header/input chrome —
recognizably Arcade Studio, with the primitive layer as real components and only
the composite shells as frames. Screenshot-verified against the Studio render.

## Non-goals

- Page composites as real Figma components (they don't exist in 0.3 — out of our
  hands; tracked as "get composites added to 0.3" if ever pursued).
- The shippable plugin (still later; reuses planner+executor+fiberWalk).
- Pixel-exact parity — editable real primitives in faithful frames is the bar.
- Images-as-fills, prototyping links, v1.1 style props (carry over from #3).

## Risks

- **Fiber-internals dependency** (biggest) — React version / bundler changes
  could break the walk. Mitigation: spike first; keep the DOM-stamp serializer
  as a fallback path if fiber access proves fragile.
- **`keepNames` bundle-size cost** — minor; measure.
- **Mapping breadth** — widening componentEntries to all primitives + sub-parts
  is real curation work (Bridge-assisted, like #2). The `[0.2]`/ambiguous
  handling from #2 carries over.
- **Prune correctness** — pruning too aggressively could drop a genuinely-custom
  child a composite placed inside a primitive slot; the text-extraction pass must
  not miss slotted content. Test on the real frame.
