# Structured fidelity diff — the measurement layer for Figma-precise generation

Date: 2026-07-03
Branch: `feat/figma-fidelity-eject` (or a fresh `feat/fidelity-metric`)
Status: design — pending adversarial review, then user review

## Problem

Studio's "implement this Figma design precisely" turns are verified by a human eyeballing a
screenshot. Every fix this session (routing, digest race, node caps, eject, module-graph, CSS
load order, token-class syntax) was validated the same way: the user looked at the render and
said "still broken." There is **no automated signal for fidelity** — so:

- The agent can't reliably self-correct: it "checks its work" by eyeballing, which it does badly
  (hallucinated brief text, boxed an input that should be borderless, wrote token classes that
  compile to nothing).
- We can't tell whether a change *helped*: "did the token-class hook improve fidelity?" is
  currently unanswerable except by manually regenerating and squinting.

The June-10 `visual-verify-loop.md` plan (never built) adds a render→compare→fix loop, but its
"compare" is **the agent looking at two PNGs and emitting `VERDICT: MATCH|DIFFERS`** — still
subjective (its own Risk #3: "Sonnet must reliably spot real diffs without inventing them").
That loop needs a **measurement** to be trustworthy. This spec is that measurement.

## Key idea: structured tree-vs-DOM diff, NOT image pixel-diff

Naïve visual regression (pixel-diff two PNGs) is a trap here: fonts, anti-aliasing, and
sub-pixel shifts produce false diffs everywhere, and a raw diff can't say *what* is wrong or
*where*. We avoid it entirely because **we already have the structure on both sides**:

- **Reference side (Figma):** the ingested `CompactNode` tree already carries, per region:
  `name`, `bbox [x,y,w,h]` (real Figma px, relative to frame origin), `style.fill`,
  `style.stroke`, `style.radius`, `text.content`, `component` identity, `children`. Cached
  per-node by `figmaIngest`. (Verified in `server/figma/types.ts`.)
- **Rendered side (the generated frame):** the frame is live DOM. Every element exposes
  `getBoundingClientRect()` + `getComputedStyle()` — readable by driving the frame URL in a
  headless browser (`browser_evaluate` already does this; used repeatedly this session).

So the diff is **structured node-tree vs structured DOM**, matched region-by-region, comparing
only things that are **exact and meaningful**: bounding box, fill/background color, text
content, presence/absence, border/radius. This gives *located* results ("sidebar fill #FAF9F9
vs ref #5800E6") and sidesteps pixel noise.

The rendered PNG is still captured — but for the agent to *look at* and for the human, NOT as
the diff basis. The diff basis is the two structured trees.

## Goals

1. Produce a **located, region-level diff report** for a generated frame vs its Figma
   reference: a list of `{ region, property, expected, actual, severity }` rows.
2. Roll the rows up into a single **fidelity score (0-1)** as a byproduct — for regression
   tracking ("0.61 → 0.88 after the token-class fix"), not as the primary output.
3. Feed the located report into the verify loop so the agent fixes **specific** differences,
   replacing the subjective `VERDICT` vibe-check.
4. Be honest about coverage: report what it could NOT align/compare (unmatched regions), never
   silently score 1.0 on a region it skipped.

## Non-goals

- Pixel-perfect image comparison. We compare structure, not pixels.
- Scoring text *rendering* (font hinting, kerning). We compare text *content* + gross box; the
  agent's PNG view covers the rest.
- Fixing generation quality directly — this is the *measurement*; the verify loop + hooks are
  the actuators. This spec makes them measurable.
- Optimizing prompts automatically (DSPy-style). Out of scope; the metric is a prerequisite for
  any future optimization, not the optimization itself. See memory `studio-fidelity-metric-keystone`.

## Architecture

Four units, each independently testable.

```
Figma ingest (exists)         generated frame (DOM)
  CompactNode tree               │ driven in headless browser
        │                        ▼
        │                 [1] DOM extractor → RenderNode tree
        ▼                        │
  [2] normalize both trees to a common ComparableRegion shape
        │                        │
        └──────────┬─────────────┘
                   ▼
        [3] region matcher  (align ref regions ↔ rendered regions
                             by position + role; report unmatched)
                   ▼
        [4] differ  → DiffReport { rows[], score, coverage }
                   ▼
     consumed by: verify loop (located fixes) + metrics log (score)
```

### Unit 1 — DOM extractor (`server/verify/domExtract.ts`)

A function serialized into the headless page (via the capture backend, below) that walks the
rendered frame's DOM and returns a `RenderNode` tree:

```ts
interface RenderNode {
  role: string;          // tag + semantic hint: "aside", "button", "text", "img", "svg"
  text?: string;         // trimmed textContent for leaf text nodes
  bbox: [number, number, number, number]; // getBoundingClientRect, frame-relative
  fill?: string;         // computed background-color (rgb→hex), or color for text
  stroke?: string;       // computed border-color when border width > 0
  radius?: number;       // computed border-radius px
  children: RenderNode[];
}
```

- Coordinates normalized to the frame's own origin (subtract the root element's rect), matching
  the reference tree's frame-relative convention.
- Skips zero-size + `display:none` nodes (mirrors `compactTree`'s zero-size prune) so both sides
  agree on "visible".
- Collapses styleless single-child wrappers (mirror compactTree's passthrough collapse) so the
  two trees have comparable granularity — otherwise the DOM is far deeper than the Figma tree
  and matching fails.

### Unit 2 — normalize to `ComparableRegion`

Both `CompactNode` (Figma) and `RenderNode` (DOM) map to one shape so the matcher/differ are
source-agnostic:

```ts
interface ComparableRegion {
  key: string;                 // stable id for reporting (name or role+index)
  bbox: [number, number, number, number];
  fill?: string;               // hex, lowercased, alpha-normalized
  stroke?: string;
  radius?: number;
  text?: string;               // normalized whitespace
  kind: "container" | "text" | "icon" | "image" | "control";
  children: ComparableRegion[];
}
```

- **Color normalization is load-bearing:** Figma fills may be tokens-resolved-to-hex or raw;
  DOM computed colors are `rgb()`/`rgba()`. Normalize both to lowercased `#rrggbb` (+ separate
  alpha) so `#5800E6` == `rgb(88,0,230)`. A mismatch here = false diffs, so it gets its own
  unit test with known pairs.
- Figma px and CSS px are the same unit at scale 1 (the frame renders 1:1), so bboxes are
  directly comparable — but the frame may render at a different *outer* size than the Figma
  node. Normalize by the ratio of root bbox to Figma root bbox before comparing child positions.

### Unit 3 — region matcher (`server/verify/matchRegions.ts`)

The hard part. Aligns reference regions ↔ rendered regions. Greedy, structural:

- Walk both trees together depth-first. At each level, match children by **best overlap of
  normalized bbox + compatible `kind`** (IoU over a threshold), tie-broken by text similarity
  for text nodes and by order.
- A ref region with no rendered match → `MISSING` row (design has it, frame doesn't).
- A rendered region with no ref match → `EXTRA` row (frame invented it — e.g. the boxed input
  the reference didn't have).
- Matched pairs pass to the differ.
- **Coverage is reported**: `matched / totalRef`. A frame that "matches" 4 of 20 ref regions
  scores low on coverage even if those 4 are perfect — prevents a partial build from scoring
  high. NEVER silently ignore unmatched regions.

Matching is inherently imperfect; the spec accepts that and surfaces it (coverage %, unmatched
lists) rather than pretending precision.

### Unit 4 — differ (`server/verify/fidelityDiff.ts`)

For each matched pair, emit rows for properties that differ beyond a tolerance:

```ts
interface DiffRow {
  region: string;         // "sidebar", "header/title", "input"
  property: "bbox" | "fill" | "stroke" | "radius" | "text" | "presence";
  expected: string;       // "#5800E6", "x=592", "Present the Service Blueprint…"
  actual: string;         // "#FAF9F9", "x=657", "Present the Service Desk…"
  severity: "structural" | "minor";
}
interface DiffReport {
  rows: DiffRow[];
  score: number;          // 0-1, weighted; byproduct
  coverage: number;       // matched/totalRef
  unmatchedRef: string[]; // MISSING
  unmatchedRendered: string[]; // EXTRA
}
```

- **Tolerances:** bbox off by ≤ ~4px = ignore; fill must match exactly (color is the #1 observed
  failure — the purple bug); text compared normalized, flagged `structural` if content differs
  (the hallucinated-brief bug), `minor` if only whitespace/truncation.
- **Severity:** `structural` = wrong/missing/extra region, wrong color, wrong text content.
  `minor` = small position/size/radius drift. The loop acts on `structural` first.
- **Score:** weighted — `structural` misses cost more than `minor`; multiply by `coverage` so an
  incomplete build can't score high. Exact formula pinned in a test with worked examples; the
  score is deliberately secondary to the rows.

### Render capture (reuse June-10 plan, `server/verify/captureFrame.ts`)

The extractor + PNG both need the frame driven in a browser. Reuse the June-10 design verbatim:
- **Packaged DMG:** Electron offscreen `BrowserWindow` (no new dep) → capturePage + evaluate the
  extractor.
- **Dev:** Playwright (already a devDependency) → same.
- Fail-open with a narration if no backend (metric skipped, turn still completes).

This is the one genuinely new infra piece; it's shared with the verify loop, so it's built once.

## How it's consumed

1. **Verify loop (replaces the vibe-verdict):** after a hi-fi turn writes a frame, capture +
   diff. If `rows` has `structural` entries, feed them to a scoped fix turn: "these specific
   regions differ from the design: [rows]. Fix them." Stop when no `structural` rows remain or
   MAX attempts. The agent fixes *located* items, not vibes. (The June-10 loop shell + gating +
   caps are reused; only the compare step changes from `VERDICT` to `DiffReport`.)
2. **Regression signal:** append `score` + `coverage` to the generation-metrics log (existing
   `metricsLogPath`). Now "did change X help?" is answerable across an eval set.
3. **NOT a blocking gate on the main turn** — fire-after-turn like the drift check; a low score
   drives the fix loop, it doesn't fail the generation.

## Relationship to the enforcement hook (parallel track, ships together)

The token-class enforcement hook (spec `2026-07-03-token-class-enforcement-hook-design.md`) is
the **deterministic** half: it blocks un-compilable token classes at write time — a fact-check
that needs no render. The structured diff is the **visual** half: it catches wrong colors,
positions, missing/extra regions, wrong text — things only visible once rendered. They're
complementary:

- Hook: "this class won't render" — cheap, exact, pre-render, blocks.
- Diff: "this rendered region is the wrong color / in the wrong place / says the wrong thing" —
  post-render, drives the fix loop.

Both feed the same goal (measured fidelity) from opposite ends. Build order: hook first (small,
self-contained, already spec'd), then the diff (larger, needs the capture infra).

## Testing

Pure units are the bulk; the capture backend is the only hard-to-test seam (fake it).

- **Color normalize:** `#5800E6` == `rgb(88,0,230)`; alpha handled; token-hex == computed-rgb.
- **DOM extractor:** given a fixture HTML string (jsdom), returns the expected `RenderNode` tree;
  zero-size + `display:none` skipped; styleless wrapper collapsed.
- **normalize:** a `CompactNode` and a `RenderNode` describing the same region → identical
  `ComparableRegion` (proves source-agnostic).
- **matcher:** ref+rendered trees that align → correct pairs; a missing region → `MISSING`; an
  extra region → `EXTRA`; coverage math.
- **differ:** the REAL precisely-3 failure — reference tree vs the extracted broken DOM → must
  emit `fill` structural rows (white vs purple) for sidebar/surfaces and NOT flag the correct
  typography. The REAL precisely-2 case → `text` structural row (Service Desk vs Blueprint) +
  `EXTRA` row (boxed input). These two are the acceptance fixtures — the metric must catch
  exactly what the human caught.
- **score:** worked examples pin the formula; incomplete build (low coverage) can't score high.
- **capture backend selection:** env-based (Electron vs Playwright vs skip), mocked.
- Full suite green.

## Manual acceptance

Regenerate precisely-3 (navigation) and precisely-2 (purple). The DiffReport must:
- flag the sidebar/surface fill mismatches on a broken run, and show them RESOLVED (score up,
  rows gone) once the token-class hook + a fix pass land;
- flag the hallucinated brief text as a `text` structural row;
- flag a boxed input as `EXTRA` / the borderless region as `MISSING`.
Then confirm the verify loop, fed these rows, drives the agent to fix them within its attempt
cap — and the score rises measurably.

## Files

- `server/verify/captureFrame.ts` — NEW (shared with verify loop; June-10 design).
- `server/verify/domExtract.ts` — NEW (in-page DOM walker).
- `server/verify/comparable.ts` — NEW (normalize both sides + color normalize).
- `server/verify/matchRegions.ts` — NEW (alignment).
- `server/verify/fidelityDiff.ts` — NEW (rows + score + coverage).
- `electron/main.ts` + `electron/viteRunner.ts` — IPC + offscreen capture (June-10).
- `server/middleware/chat.ts` — wire diff into the hi-fi post-turn path + metrics log.
- Tests under `__tests__/server/verify/*` incl. the two real-failure acceptance fixtures.

## Open decisions (for review)

1. **Score formula weights** (structural vs minor, coverage multiplier) — pin in review.
2. **bbox tolerance** (~4px proposed).
3. **Ship the diff standalone first** (report to metrics log, human reads it) **before** wiring
   it into the verify-loop auto-fix? Lower risk: prove the metric is trustworthy before letting
   it drive automated edits. Recommended.
4. **Reuse vs rebuild** compactTree's collapse/prune logic for the DOM side — share the
   heuristics or reimplement for DOM? (Shared constants, separate walkers, likely.)
