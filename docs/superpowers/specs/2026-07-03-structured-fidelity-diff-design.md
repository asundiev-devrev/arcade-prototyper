# Fidelity checks + vision-judge diff — the measurement layer for Figma-precise generation

Date: 2026-07-03 (rewritten after adversarial review killed the tree-alignment premise)
Branch: `feat/figma-fidelity-eject` (or a fresh `feat/fidelity-metric`)
Status: **SUPERSEDED / SHELVED (2026-07-03)** — do not implement as written.

## Why superseded (two adversarial rounds)

Two independent adversarial reviews killed this design across both drafts (v1 tree-alignment,
v2 three-tier). The render-dependent layer does not earn its cost and would produce FALSE
fidelity signals on the product's own composite-based designs. Verified findings:

- **The one genuinely-new Tier-1 check (composite-used) misfires on both cited frames.**
  precisely-3's prompt is bare ("Implement this design precisely: <url>") → `detectComposeBaseIntent`
  is false → the check can't fire (the acceptance criterion was unsatisfiable). precisely-2 DOES
  trigger, but eject rewrites the frame to import `./ComputerScene` LOCALLY, so a barrel-import
  check false-flags a correctly-ejected frame. Confirmed against the real prompts + ejectComposite.
- **Tier 2 "count sanity" reintroduces the v1 killer** — composites expand one element into ~100+
  DOM nodes with no Figma-tree counterpart, so kind-count correspondence is false by design →
  faithful composite frames flagged as "too many elements" → inverted score.
- **Tier 2 "required text present" is direction-blind + truncatable** — false-flags intended
  content changes and correctly-omitted hidden nodes; misses reordered/reworded text; and its
  reference set comes from the CAPPED compact tree, which truncates on exactly the dense frames
  that hallucinate (the root cause it exists to catch).
- **Tier 3 vision judge is v1's killed subjectivity with a JSON hat** — structured output makes a
  hallucinated diff more ACTIONABLE, not more true; no ground-truth check on the judge; it would
  drive the verify loop to degrade good frames (June-10 Risk #3, unresolved).
- **Tiers 2-3 ride on unbuilt capture infra + a font-parity problem** with a documented history
  of biting (ChipText 403). Most of the spec is gated on an unproven risk.

**Decision:** ship the DETERMINISTIC core only — the token-class enforcement hook (spec
`2026-07-03-token-class-enforcement-hook-design.md`) + the existing import validator. Those are
exact, already-proven, and fix the actual observed bug (unstyled frame). The render-based tiers,
vision judge, and verify-loop wiring are SHELVED until there's evidence the deterministic layer
is insufficient. This document is kept for the reasoning, not for implementation.

Corrections the reviews surfaced (for whoever revisits this): Playwright + Chromium ARE installed
(dev capture works today — the spec's "not installed" claim was stale); an optional `figmaNodeUrl`
on `frameSchema` is safe to add (zod tolerates it, no migration) but does NOT enable full
historical recompute (needs live PAT + unchanged node + compilable frame). If the composite-used
check is ever revived, derive "expected composite" from the ejected-file presence or the
classifier match — NOT `detectComposeBaseIntent` — and detect the LOCAL import, not the barrel.

---

## Problem

Studio's "implement this Figma design precisely" turns are verified by a human eyeballing a
screenshot. Every fix this session was validated that way: the user looked and said "still
broken." There is **no automated fidelity signal** — so the agent can't reliably self-correct
(it "checks its work" by eyeballing, which it does badly: hallucinated brief text, boxed an
input that should be borderless, wrote token classes that compile to nothing), and we can't tell
whether a change helped.

## What the first draft got wrong (and why this is a rewrite)

The first version proposed a **structured tree-vs-DOM diff**: align the Figma `CompactNode` tree
to the rendered DOM region-by-region (bbox-IoU + kind) and diff matched pairs. An adversarial
review killed the premise, verified against the repo:

- **The two trees do not structurally correspond — by design.** `fidelityDirective.ts:144-145`
  MANDATES a faithful frame "build the novel macro layout yourself from a bare div + flex" and
  swap leaves for kit components (whose internal DOM is arbitrary). A composite like
  `ComputerScene` (23.7 KB) expands one JSX element into a sidebar+header+rows subtree with no
  Figma-layer counterpart. So the metric would have **penalized exactly the frames the product
  defines as good** — its signal was anti-correlated with the directive.
- **Coordinate normalization was invalid.** Frames reflow responsively (widths 375/1024/1440/
  1920, `server/types.ts:9`); a uniform root-bbox scale factor mis-predicts every non-sidebar
  position → false diffs. The capture width wasn't even specified.
- **Regression tracking was unsupported.** `frameSchema` (`server/types.ts:5-10`) has no
  Figma-node field and the ingest cache is 1-hour TTL — nothing lets you recompute a historical
  frame's fidelity.

The salvage the review pointed to, and this rewrite adopts: **drop tree-alignment entirely.**
Keep the checks that need no correspondence (they're the ones that actually caught the real
bugs), and make the genuinely-visual part an honest model judgment, not a fake measurement.

## The inverted design: three tiers, hardest-to-fake first

```
                                    needs render?   deterministic?
Tier 1  static source checks         no             yes   ← cheapest, exact
Tier 2  rendered DOM checks          yes (DOM read) yes   ← text/presence, no alignment
Tier 3  vision-judge visual diff     yes (PNG)      no    ← color/layout, structured output
```

The three compose into one `FidelityReport { checks[], visualRows[], score, coverageNote }`.
Tiers 1-2 are exact and carry most of the value; Tier 3 is a judgment call, clearly labeled.

### Tier 1 — static source checks (no render, deterministic)

Run on the generated frame's source text. These are pure functions, fastest, most reliable:

- **Token classes compile** — the un-renderable `text-fg-*` / `bg-surface-*` named forms. THIS
  IS ALREADY THE ENFORCEMENT HOOK (`2026-07-03-token-class-enforcement-hook-design.md`). The
  report *reads its verdict*; it doesn't reimplement it.
- **Composite used when expected** — on a compose-base turn (`detectComposeBaseIntent`), did the
  frame actually import/use the named composite, or hand-roll it? (The precisely-3 navigation
  frame hand-rolled a whole Computer screen instead of `ComputerScene` — this catches that.)
- **Closed-world imports** — only `arcade` / `arcade/components` / `arcade-prototypes` / `react`
  (the existing import validator already enforces; report reads it).

### Tier 2 — rendered DOM checks (needs render, deterministic, NO alignment)

Drive the frame in a headless browser, read the DOM. These need the render but NOT tree-matching
— they're position-independent set/substring facts. These are the two checks that caught the
real session bugs:

- **Required text present / wrong text absent.** Collect the reference's text strings from the
  Figma tree's `text.content` fields (we already have them). Assert each appears somewhere in
  the frame's `document.body.textContent` (normalized). MISSING or SUBSTITUTED reference text →
  a check row. This catches the hallucinated brief ("Service Desk" instead of "Service
  Blueprint", "Kieran" instead of "Amrita") — position-independent, no matcher.
- **No un-renderable / broken boxes.** Scan the DOM for zero-size visible elements, elements
  overflowing the viewport, and elements whose computed background is `rgba(0,0,0,0)` where the
  frame clearly intends a surface. Deterministic structural sanity, not design-matching.
- **Reference region count sanity (coarse presence, not alignment).** Compare *counts* by kind
  (how many text blocks / images / buttons the Figma tree has vs the DOM has) as a coarse
  completeness signal — a frame with 2 text blocks where the design has 12 is obviously
  incomplete. This is a set-cardinality check, NOT per-region matching.

### Tier 3 — vision-judge visual diff (needs render, model judgment, structured output)

The genuinely-visual properties (color, spacing, "is the input borderless", overall layout) are
NOT deterministically checkable without the false-correspondence trap. Instead of pretending to
measure them, ask the model — but force **structured output**, not a free-text verdict:

- Capture the rendered frame PNG + attach the Figma reference PNG (already ingested).
- Prompt: "Compare these two. Return a JSON array of concrete visual differences, each
  `{ region, property, expected, actual, severity }`. Only report differences a designer would
  call wrong — not rendering/anti-aliasing noise. If they match, return `[]`."
- Parse into `visualRows: DiffRow[]`.

This is the June-10 verify-loop's compare step, upgraded from `VERDICT: MATCH|DIFFERS` (its own
Risk #3: subjective, hallucination-prone) to a **structured, located** list the agent can act on
row-by-row. It's still a model judgment — labeled as such — but structured beats a vibe, and it
doesn't fabricate a tree correspondence that doesn't exist. Bounded: the loop acts only on
`severity: structural` rows, and stop conditions cap damage.

## Score + regression tracking (honest this time)

- **Score is a byproduct, secondary.** `score` = weighted pass rate of Tier 1-2 checks (exact)
  plus a discount for Tier 3 structural rows. Tier 1-2 dominate because they're reliable; Tier 3
  nudges. NOT coverage-multiplied against a fake alignment (the killed design's inverted signal).
- **Persistence for regression tracking (fixes S2):** add an optional `figmaNodeUrl` field to
  `frameSchema` (`server/types.ts`), written when a frame is generated from a Figma URL. This is
  the frame→node link the first draft lacked — it lets a later run re-ingest the reference and
  recompute the score. Append `{ score, tier1Pass, tier2Pass, visualRowCount }` to the existing
  generation-metrics log (`metricsLogPath`). Now "did change X help?" is answerable across runs.

## Consumption

1. **Verify loop:** after a hi-fi turn writes a frame, run Tiers 1-3. Feed the failed checks +
   `structural` visual rows to a scoped fix turn ("these specific things differ: [rows]. Fix
   them."). Stop when Tier 1-2 pass and no structural visual rows remain, or MAX attempts. This
   is the June-10 loop with the compare step replaced by `FidelityReport`. Reuse its shell,
   gating, wall-clock caps.
2. **Regression signal:** score + tier pass-rates to the metrics log.
3. **NOT a blocking gate on the main turn** — fire-after-turn like the drift check; a low score
   drives the fix loop, doesn't fail generation.

## Render capture (the one new infra piece — reuse June-10, build early, de-risk first)

Tiers 2-3 need the frame driven in a browser. Reuse the June-10 `captureFrame` design:
- **Packaged DMG:** Electron offscreen `BrowserWindow` (no new dep) — capture PNG +
  `executeJavaScript` for the DOM read. Requires the IPC channel June-10 specs
  (`electron/viteRunner.ts` stdio + relay) — NOT yet built.
- **Dev:** Playwright (`page.evaluate` + screenshot). NOTE: `playwright` is a listed
  devDependency but **not currently installed** — `pnpm exec playwright install` is a
  prerequisite; if absent, capture fails open with a narration and Tiers 2-3 are skipped (Tier 1
  still runs, needs no render).
- **De-risk BEFORE building the tiers:** June-10 Risk #2 (offscreen fonts 403 → computed
  styles/colors differ from the designer's view → false diffs, and the ChipText-403 problem is
  real per memory `figma-import-text-fidelity`). Task 0 of any plan: prove the offscreen/
  Playwright capture loads the SAME fonts + token CSS as the visible viewport. If it doesn't,
  Tier 3's color judgment and Tier 2's background checks are poisoned — fix capture parity first
  or the whole layer is untrustworthy.

## Testing

- **Tier 1** (pure): composite-used detector on the precisely-3 frame → flags hand-rolled; on a
  composite frame → passes. Token-class + import checks: read from the existing hooks' logic
  (don't duplicate).
- **Tier 2** (jsdom, no browser needed for the logic): given a DOM fixture + a reference text
  set, missing/substituted text → check rows; present text → pass. The REAL precisely-2 text
  ("Service Desk" vs reference "Service Blueprint") → flagged. Zero-size / overflow scan on a
  fixture. Count-sanity on a deliberately-incomplete fixture.
- **Tier 3** (mocked model): given a stub judge returning known rows, the report parses + routes
  `structural` vs `minor`. The prompt is pinned (asks for JSON, says ignore AA noise, `[]` on
  match). No live model call in tests.
- **Score:** worked examples; Tier 1-2 dominate; incomplete frame scores low via Tier-2 count
  sanity, NOT via a fake alignment coverage.
- **Persistence:** `figmaNodeUrl` round-trips through `frameSchema`; metrics row appends.
- **Capture backend selection** (env-based), mocked. **Font-parity** is a manual gate, not a
  unit test.
- Full suite green.

## Manual acceptance

Regenerate precisely-3 (navigation) and precisely-2 (purple):
- Tier 1 flags the hand-rolled Computer screen (composite not used) on precisely-3.
- Tier 2 flags the hallucinated brief text on precisely-2 and the missing reference lines.
- Tier 3 returns structural rows for the white-instead-of-purple sidebar (pre token-hook) and
  the boxed-vs-borderless input.
- After the token-class hook + a fix pass, the report shows those resolved (Tier 1-2 pass, score
  up). Confirm the verify loop, fed these, drives the fixes within its cap.
Font-parity gate passes (offscreen render colors == visible-viewport colors).

## Relationship to the enforcement hook

Complementary, ship the hook first (smaller, self-contained, already spec'd):
- **Hook** = Tier 1's token-class check as a *blocking write-time gate* — the frame can't even be
  saved with un-compilable classes.
- **This report** *reads* Tier 1 results (incl. the hook's domain) and adds Tiers 2-3. The hook
  prevents; the report measures + drives the loop.

## Files

- `server/verify/captureFrame.ts` — NEW (June-10 design; PNG + DOM read).
- `server/verify/fidelityReport.ts` — NEW (orchestrates the 3 tiers → `FidelityReport`).
- `server/verify/staticChecks.ts` — NEW (Tier 1: composite-used, reads hook/import verdicts).
- `server/verify/domChecks.ts` — NEW (Tier 2: text-present, zero-size/overflow, count sanity).
- `server/verify/visionJudge.ts` — NEW (Tier 3: prompt + parse structured rows).
- `server/types.ts` — add `figmaNodeUrl?` to `frameSchema` (persistence).
- `electron/main.ts` + `electron/viteRunner.ts` — IPC + offscreen capture (June-10).
- `server/middleware/chat.ts` — wire report into the hi-fi post-turn path + metrics log.
- `server/metrics.ts` — extend `TurnMetric` with fidelity fields.
- Tests under `__tests__/server/verify/*` incl. the real precisely-2/-3 fixtures.

## Open decisions (for review)

1. **Ship Tiers 1-2 first, add Tier 3 (vision judge) later?** Tiers 1-2 are deterministic + carry
   the text/composite/structure signal with zero model risk. Tier 3 is the fuzzy part. Strong
   case to prove 1-2 standalone (report to metrics log + verify loop) before adding the judge.
   Recommended: 1-2 first.
2. **Score formula weights** — pin in review.
3. **Does the vision judge run the SAME model as generation, or a fixed one** for consistency of
   the regression signal?
4. **Font-parity de-risk (Task 0)** — acceptable to block the whole feature on proving offscreen
   capture fidelity first?
