# Plan: Figma kit-emit engine — speed + quality levers

**Date:** 2026-06-13
**Status:** Plan. Engine is live + working (`studio/server/figma/{kitEmit,kitMappings,kitEmitBranch}.ts`),
imports any Figma URL deterministically, no LLM. This plan is the next round:
make it faster to feel instant, and raise output quality from "pixel-faithful
screenshot" to "editable, theme-correct, lift-able prototype."

**Measured baseline (instrumented, cold full board):**
| step | before | after parallelize (shipped) |
|---|---|---|
| getNode (fetch+parse 6.3–13MB) | 3.0s | 2.0s |
| export SVG urls | 2.3s | overlapped |
| export PNG urls | 2.7s | overlapped |
| download 44 assets | 0.8s | 0.8s |
| emit JSX | <5ms | <5ms |
| **total** | **8.8s** | **4.4s** |

Warm re-import (figmanage disk cache hot): 5–12s observed → mostly the getNode
re-fetch. Already-shipped win: SVG+PNG exports run concurrently (`Promise.all`).

---

## Guiding principle

Two bars must BOTH hold (unchanged from the engine's charter): **pixel-fidelity
to the Figma** AND **real kit components where the design uses them**. Every
lever below is checked against "does it keep both?" Speed must not cost
fidelity; quality must not cost the kit-coverage metric.

Verification is non-negotiable and dual: screenshot diff for fidelity, source
grep (kit instance count, token usage, flex vs absolute) for the structural
bars. A screenshot can't prove tokens or kit components — those are source facts.

---

## Phase A — Speed: make it feel instant (target ~2.5s perceived)

### A1. Prefetch reuse — warm `getNode` on URL paste  ★ highest leverage
**Problem:** the 2s `getNode` sits on the critical path of the turn, paid after
the user hits Send. But Studio ALREADY fires `/api/figma/ingest` when the user
*pastes* a Figma URL (`server/middleware/figma.ts:27`) — for the old generator.
That prefetch caches a compacted tree, NOT the raw node the kit-emit branch
needs, so kit-emit re-fetches from scratch.

**Fix:** have the ingest prefetch also stash the raw `getNode` payload (keyed
`fileKey:nodeId`) in a short-TTL cache the kit-emit branch reads first. The 2s
fetch is then paid while the user is still typing/reviewing → turn drops to
~2.5s (export + download only).

**Files:** `figmaIngest.ts` (already has disk+memory cache machinery — add a raw
payload alongside the IngestResult, or a sibling cache), `kitEmitBranch.ts`
(read cache before `getNode`), `figma.ts` ingest handler (ensure raw is cached).
**Risk:** low — pure cache read, falls through to live fetch on miss.
**Effort:** S. **Impact:** ~2s off perceived latency.

### A2. Asset cache across imports
**Problem:** re-importing the same node re-exports + re-downloads all 44 assets.
The figmanage *node* fetch is disk-cached (warm turns prove it) but asset SVG/PNG
exports are not explicitly reused.
**Fix:** key exported assets by `fileKey:nodeId:format:scale` on disk; on a hit,
skip the Figma export+download and point the emitter at the existing file. Assets
are immutable per node version, so this is safe until the Figma file changes
(invalidate on file `lastModified`, already in the get-nodes payload).
**Files:** `kitEmitBranch.ts` (asset dir lookup before export), small cache index.
**Risk:** low. **Effort:** S. **Impact:** re-imports ~1s; iteration feels instant.

### A3. Progressive frame write (optional, evaluate after A1/A2)
**Idea:** write `index.tsx` immediately with the layout + kit components, then
let assets stream in as `<img>` srcs resolve (Vite hot-reloads each). User sees
structure in ~1s, images fill in over the next 2s.
**Risk:** medium — partial-render flicker, watcher race (index.tsx must not load
before at least the referenced files exist or React 404s the import).
**Effort:** M. **Impact:** better *perceived* speed, same total. Only pursue if
A1+A2 don't get us under the feel-instant bar. Likely SKIP.

### A4. Bounded `getNode` payload (investigate, low priority)
13MB for a busy node — most of it is full vector geometry we re-export as images
anyway. figmanage `get-nodes` has no "without geometry" flag today (verified:
only `--depth`). `--depth` risks dropping nested instances we map. Park unless
profiling shows parse (not network) dominates. **Effort:** M, **uncertain payoff.**

---

## Phase B — Quality: change the *character* of the output

These are the levers that move it from "throwaway screenshot in code" to "a
prototype a designer can edit and an engineer can lift."

### B1. Design tokens instead of raw hex  ★ highest quality lever
**Problem:** emitter bakes literal `#ff0000` / `rgba(...)` for every fill,
stroke, text color (`grep token kitEmit.ts` = 0). The frame:
- doesn't follow light/dark theme (hardcoded colors)
- is off-palette / not honest to the design system
- is harder to lift (production uses token classes/vars, not hex)

`resolveTokens.ts` ALREADY maps a bound fill → its Figma variable name (e.g.
`surface/default`) using the `getVariables` payload — built for the old path,
unused by kit-emit.

**Fix:** kit-emit fetches `getVariables` (parallel with getNode, ~free) and,
where a node's fill/stroke is bound to a variable, emits the kit's CSS-var /
token class (`var(--bg-neutral-soft)` or the Tailwind token) instead of hex.
Raw hex stays the fallback for unbound values (and gets a warning so we can grow
coverage). Keeps fidelity (same rendered color) AND gains theme-correctness +
lift-ability.
**Files:** `kitEmitBranch.ts` (fetch variables), `kitEmit.ts` (fill/stroke/text
color → token lookup), reuse `resolveTokens` logic or its variable-name reader.
**Risk:** medium — need the Figma-var-name → kit-token mapping; partial coverage
must degrade to hex, never to a wrong color. **Effort:** M. **Impact:** large —
this is the difference between honest and throwaway output.

### B2. Auto-layout → flexbox (not just absolute)  ★ second quality lever
**Problem:** every node is `position:absolute` at its Figma x/y. Pixel-perfect
on first render, but: not responsive, breaks on longer text / locale changes,
and reads as machine-generated (un-editable) to a designer who opens it.
`compactTree` already extracts `layoutMode`/`itemSpacing`/padding/align from
auto-layout frames — the raw nodes carry it; the emitter ignores it.

**Fix:** when a frame node has `layoutMode !== NONE`, emit a flex container
(`display:flex; flex-direction; gap; padding; align/justify`) and let children
flow, instead of absolute-positioning each. Absolute stays the fallback for
non-auto-layout frames (free-form canvases). Most DevRev designs are
auto-layout, so coverage is high.
**Trade-off to manage:** flex output may drift a few px from the Figma vs the
exact absolute copy. Mitigation: keep absolute as an option; measure diff per
frame; only flex where auto-layout data is present and confident.
**Files:** `kitEmit.ts` (container emit path: branch on layoutMode).
**Risk:** medium — fidelity could regress on edge cases; gate behind measurement.
**Effort:** M–L. **Impact:** large — editable, robust, honest layout.

### B3. Typography → kit type tokens
Text currently inline `fontSize/fontWeight/lineHeight` px. Where Figma text is
bound to a type style, emit the kit's typography token/class. Same pattern as B1.
**Effort:** S–M (after B1). **Impact:** medium — consistency + lift-ability.

---

## Phase C — Coverage: more kit, less hand-rolled

Each row raises the kit-instance metric and shrinks static markup. The matching
machinery already exists; this is curation + emit cases.

### C1. Add emit cases for the rest of `componentEntries.ts`
Today kit-emit handles Button, IconButton, Checkbox, Switch, Tabs, Avatar/Group,
Badge, Tag, icons. Missing emit cases for mapped sets: **Input, Select, Tooltip,
Menu, Modal, Breadcrumb, Popover**. Add each (props + slot handling).
**Files:** `kitEmit.ts` switch, `kitMappings.ts` rows.
**Risk:** low. **Effort:** M (one case at a time). **Impact:** higher coverage on
form-heavy / dialog-heavy screens.

### C2. Full variant-axis translation
Currently translate Variant + Size for buttons. Extend to all axes the kit
exposes (state, disabled, intent, appearance) per `componentEntries.ts`
valueMaps, reversed (Figma variant → arcade-gen prop). **Effort:** M. **Impact:**
correct component STATES, not just shapes.

### C3. Mapping coverage telemetry
Log per-import: total instances, kit-matched, kit %, top unmatched set names.
Surface in dev console + (optionally) a one-line trailer. Turns "coverage" from
a guess into a tracked number; the unmatched list is the curation backlog.
**Files:** `kitEmit.ts` (already returns counts), `kitEmitBranch.ts` log.
**Effort:** S. **Impact:** makes quality measurable over time.

---

## Phase D — Robustness & maintainability

### D1. Generalize the SVG-glyph fallback (from this session's bugs)
Three real bugs found importing node 30:11416: blank IconButton when glyph
unmapped, hidden alt-glyph picked over visible, loose slot bbox distorting
export. Fixed for IconButton/Button. **Generalize:** ANY unmapped leaf
icon/vector that fails to map should export as SVG rather than render blank —
no glyph ever vanishes regardless of mapping coverage. **Effort:** S. **Impact:**
no silent blank icons, ever.

### D2. Mapping hygiene test against the real barrel
Current test checks icon-name shape (regex) + key shape (40-hex). Strengthen:
assert every `ICON_SET_NAME_TO_KIT` / component value is an ACTUAL export of
`@xorkavi/arcade-gen` (import the barrel, check). Prevents a mapping pointing at
a non-existent kit component → runtime build break in a tester's frame.
**Files:** `__tests__/server/figma/kitEmit.test.ts`. **Effort:** S. **Impact:**
catches dead mappings at CI, not on a tester's machine.

### D3. Golden-frame snapshot test
Snapshot the emitted `index.tsx` for a checked-in fixture board (the
`41Jsf6...` node payloads we already have in /tmp → move to fixtures). Any emit
regression shows as a diff. **Effort:** M. **Impact:** locks in fidelity/coverage
against future refactors.

### D4. Effect/fill coverage gaps
Not handled today: multiple stacked fills, inner shadow, layer blur, blend modes.
Add where they appear in real designs (driven by D3 fixtures + telemetry, not
speculatively). **Effort:** M. **Impact:** medium, design-dependent.

### D5. No silent truncation
Broken-node export recursion caps at 3 passes; the depth/node caps in
`compactTree` (DEPTH_CAP 12, MAX_NODES 500) can drop content on huge boards.
Ensure anything dropped is logged + surfaced in the turn trailer ("imported N of
M panels"), never silently. **Effort:** S. **Impact:** honesty on big imports.

---

## Recommended sequencing

1. **A1 + A2** (speed) — small, low-risk, gets to ~2.5s. Ship first; immediate
   user-felt win.
2. **B1** (tokens) — highest quality lever; makes output honest + theme-correct.
3. **D1 + D2** (robustness) — cheap, prevent regressions before adding more.
4. **B2** (auto-layout) — biggest quality change; gate behind per-frame diff
   measurement since it trades a little fidelity for editability.
5. **C1/C2/C3** (coverage) — incremental, ongoing; telemetry (C3) first so we
   curate against real unmatched data.
6. **B3, D3, D4, D5** — polish + lock-in.

## Owner decisions (2026-06-14) — locked

1. **Auto-layout (B2): flex where confident, absolute fallback.** Emit flexbox
   when a frame's auto-layout data is present and confident; absolute-position
   free-form frames. Accept small px-drift, gated by per-frame diff measurement.
   → B2 proceeds as written; do NOT ship the absolute-only opt-in variant.
2. **Tokens (B1): decide token form AFTER a code check.** Inspect how arcade-gen
   frames + the lift pipeline consume tokens (CSS vars vs Tailwind token classes)
   and pick whichever lifts cleanest. First task of B1 is this check, then emit.
3. **Speed bar: ~2.5s via A1+A2 is the target. SKIP A3** (progressive render) —
   not worth the watcher-race / flicker risk for perceived-only gain.
