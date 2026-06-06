# Figma Export — Sub-project #3: Bridge Consumer (SLJ → Figma) — design

**Date:** 2026-06-06
**Status:** Design approved. Final sub-project of the Figma-export feature. Follows
Slice 0 (PR #8, merged) + #2 component/token mapping (PR #9, merged).
**Author:** Andrey + Claude (brainstorming session)
**Parent spec:** `docs/superpowers/specs/2026-06-05-figma-export-design.md`
**Mapping spec:** `docs/superpowers/specs/2026-06-06-figma-export-mapping-design.md`

## Problem

Slice 0 proved a single `ChatBubble` round-trips end-to-end; #2 built the
lookup knowledge (component keys, token→variable map, role disambiguation).
#3 is the consumer that ties it together: walk an SLJ tree, and *build it in
Figma* — real arcade-gen component instances, design tokens bound to Figma
variables, unmapped components degraded to styled auto-layout frames. This is
the piece that makes "export any frame to Figma" actually work.

## Key decisions (locked during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Delivery | **Bridge consumer script** (figma-console MCP) | Reuses everything; cheapest path to "export any frame works". Internal/dogfood (needs Bridge+MCP live). Shippable plugin is a separate later effort. |
| Logic split | **Pure planner + thin executor** | Planner (SLJ + maps → ops) is unit-testable with zero Figma — critical given the Bridge's disconnect/latency friction. Only the thin executor touches the Bridge. The future plugin reuses the SAME planner, swapping only the executor. |
| Fallback | **Styled auto-layout frame from DOM, then recurse children** | Nothing lost; mapped descendants still become real instances; only the unmapped wrapper is a plain frame. Matches the parent spec's fallback contract. |
| Import latency | **Import-once cache + async-poll batch** | Slice 0 showed cross-file `importComponentByKeyAsync` is slow (>30s, beats the tool cap). Executor dedupes distinct keys, imports each once up front (async-kick + poll), caches `key→component`; `createInstance` is then a fast local clone. No manual file prep. |
| Done bar | **One rich multi-component frame** | A single frame exercising mapped instances + an unmapped fallback + nesting + ≥1 bound variable (the Computer chat) covers every code path once. Planner unit tests carry breadth; one live frame proves the wiring. |

## Architecture

Two pure-ish units + a thin Bridge boundary + an orchestrator-run driver.

```
SLJ (from #1 serializer)  +  #2 maps (componentMap, tokenMap, disambiguate)
        │
        ▼
   planFigmaOps()  ── PURE ──▶  FigmaOp[]   (flat, ordered, typed operations)
        │
        ▼
   executeFigmaOps(ops, bridge)  ── thin ──▶  real Figma nodes
        │                                      (import-once cache; synthetic→real id map)
        ▼
   Result { rootNodeId, perOp[], summary }
```

- **`studio/src/export/figma/planSlj.ts`** — `planFigmaOps(slj, maps): FigmaOp[]`.
  Pure. The brain. No Figma, no I/O.
- **`studio/src/export/figma/executeFigmaOps.ts`** —
  `executeFigmaOps(ops, bridge): Promise<Result>`. Thin. The hands. `bridge` is
  an injected interface; tests pass a fake that records calls.
- **Orchestrator driver** (run inline by Claude, not committed as app code) —
  fetches a frame's saved `SLJ.json`, calls the planner, runs the executor over
  the live figma-console MCP, screenshots the result.

## Operation vocabulary

The planner emits a **flat, ordered** list. Flat (not nested) so the executor
is a trivial loop; parent/child is expressed by planner-assigned synthetic ids.

```ts
import type { Box, Layout, TextNodeHint } from "./types"; // Layout/Box from slj.ts; TextNodeHint from figma/types.ts

export type FigmaOp =
  | { op: "createFrame"; id: string; parent: string | null;
      layout: Layout | null; box: Box }
  | { op: "createInstance"; id: string; parent: string;
      componentKey: string; variant?: Record<string, string> }
  | { op: "setText"; target: string;            // a previously-created id
      textNodeHint: TextNodeHint; characters: string }
  | { op: "bindVariable"; target: string;
      field: "fill" | "stroke"; variableKey: string }
  | { op: "setFill"; target: string;            // raw color when no variable resolved
      field: "fill" | "stroke"; color: string };

export type FigmaPlan = { rootId: string; ops: FigmaOp[] };
```

- **`id`** — planner-assigned synthetic id (`"n0"`, `"n1"`, …). The executor
  records `synthetic id → real Figma node id` so later ops (`setText`,
  `bindVariable`, `setFill`, and any child's `parent`) resolve to the right node.
  This is how a flat list encodes the tree.
- **`parent`** — synthetic id to `appendChild` into; `null` = the root export
  frame the executor creates first.
- Ops are **topologically ordered**: a node's create-op precedes any op
  targeting it or its descendants.

### How SLJ node kinds map to ops

- **Component node, mapped** (`findComponentMapping` returns a `mapped` entry) →
  `createInstance` (key + variant computed from the entry's `valueMap` applied to
  the SLJ `props`) + `setText` (when the entry has a `textNode` hint AND the
  node's subtree carries text) + `bindVariable`/`setFill` for resolved fills.
- **Component node, ambiguous/unmapped** (`null` or `status:"ambiguous"`) →
  `createFrame` (fallback, auto-layout from the node's own `layout`/`box`) +
  recurse children (mapped descendants still become real instances).
- **Element node** → `createFrame` (auto-layout from `layout`) or a text node
  (tag `"text"`); fills via the token flow below.

### Token → op flow (ties #2 together)

For each color on a node, with its role (`fill` from a frame bg, `text` from a
text node's color, `stroke` from a border):
1. `resolveTokenForRole(tokenIndex.lookup, resolvedValue, role)` → a token name
   (or the raw value).
2. If a token name: `tokenNameToVariableKey(name)` → a Figma variable key →
   emit **`bindVariable`**.
3. Else (raw value, or no key): emit **`setFill`** with the raw color.

This is the "editable, theme-aware" payoff — bound Figma variables, not frozen
colors — wherever #2 can resolve them.

## Executor

`executeFigmaOps(ops, bridge)` — the only Bridge-touching code.

1. **Import phase.** Scan ops for distinct `componentKey`s. Import each ONCE via
   async-kick + poll (Slice 0's proven workaround: fire
   `importComponentByKeyAsync`, stash status on `globalThis`, poll until done —
   beats the 30s per-call cap). Cache `key → imported component`. (Variable
   keys for `bindVariable` are imported the same way, cached separately.)
2. **Execute phase.** Loop ops in order; per op call the matching Bridge
   primitive, recording `synthetic id → real node id`:
   - `createFrame` → `figma.createFrame()`; set `layoutMode`/padding/gap/align
     from `layout` (or absolute place from `box` when `layout` is null);
     `appendChild` to the parent's real node.
   - `createInstance` → `cache.get(key).createInstance()` + `setProperties(variant)`;
     append.
   - `setText` → resolve the text node via the hint (`lowest-depth` = shallowest
     TEXT descendant; `by-name` = by layer name), set `characters`.
   - `bindVariable` → cached variable; `setBoundVariableForPaint`.
   - `setFill` → plain paint.
3. **Return** `Result { rootNodeId, perOp: {op,ok,error?}[], summary }` where
   `summary` counts instances / fallback frames / bound variables / failures —
   for an honest export report.

**The `bridge` interface is injected.** Real implementation wraps the
figma-console MCP (`figma_execute` + the typed tools); tests pass a **fake** that
records calls and returns synthetic node ids. So the executor's *logic* (import
dedup, id-mapping, op ordering, error capture) is tested without a live Bridge.

## Testing

- **Planner (exhaustive, zero Figma):**
  - mapped component → `createInstance` with the right key + variant valueMap
    applied to props.
  - ambiguous/unmapped → `createFrame` fallback + children recursed (a fallback
    wrapper with a mapped child still yields the child's `createInstance`).
  - element node → frame (auto-layout from `layout`) / text node.
  - token resolves → `bindVariable` with the right variable key; unresolved →
    `setFill` raw. Role threaded correctly (text color → text role).
  - nesting → correct `parent` synthetic ids + topological order (parent create
    precedes child ops).
  - the Computer-chat fixture SLJ → expected op list (snapshot).
- **Executor (fake bridge):** distinct keys imported exactly once (dedup); ops
  run in order; synthetic→real id mapping threads to later ops; an op that errors
  is recorded in `perOp`, not thrown (one bad node doesn't abort the frame).
- **One live frame (the done bar):** a real Computer-chat frame → saved SLJ →
  planner → executor over the live figma-console Bridge → screenshot shows real
  bubble *instances* + an unmapped wrapper as a fallback frame + a bound variable,
  all in auto-layout.

**Done =** the planner is exhaustively unit-tested; the executor's import-cache +
id-mapping + error handling are tested with a fake bridge; and ONE rich
multi-component frame round-trips SLJ→Figma live, verified by screenshot.

## Risks / watch-items

- **Bridge flakiness** (disconnects, port shuffling) — only the live driver run
  is exposed; all logic is tested off-Bridge, so flakiness costs a re-run, not
  re-work.
- **Import latency at scale** — mitigated by import-once cache; if a frame has
  many distinct components the upfront import batch is still the slow step
  (acceptable, one-time per run).
- **Popover's broken variant defs** (#2 note) — instancing it may fail; the
  executor records the error per-op and continues (the frame still exports).
- **`setText` node-targeting** — `lowest-depth` is a heuristic; a component whose
  label isn't the shallowest TEXT node needs a `by-name` hint in #2's entry.
  Surfaced by the live frame; fix is a #2 entry tweak, not #3 code.
- **Auto-layout vs absolute** — when SLJ `layout` is null (irregular), the
  executor absolute-places from `box`; mixed auto/absolute siblings inside one
  Figma frame can look off. Acceptable for v1; noted.

## Non-goals (#3)

- The shippable Figma plugin (separate effort; reuses the planner).
- Images-as-fills (`figma.createImage`) — deferred; needs the SLJ to carry image
  data (a #1 follow-up).
- Interaction / prototyping-link export.
- v1.1 SLJ style props (opacity, z-index, overflow, per-corner radius, shadows).
- Composite-level component mappings (#2 did primitives first).
