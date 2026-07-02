# Figma Export — the Pixel-Floor principle + measurement engine

**Date:** 2026-07-02
**Branch:** `feat/figma-export-v1`
**Status:** Core principle implemented + adversarially reviewed. Real-Figma
acceptance gate BLOCKED on the bridge plugin (manual Run in Figma Desktop).

---

## The one idea

**An export must never lose something the browser painted.** For every visual
(a color, a border, a component), bind the high-fidelity Figma construct (a DS
color *variable*, a DS *component instance*) as an *enhancement* — but always
carry a faithful raw fallback *underneath*, so if the enhancement can't be
built, the pixel is still there. **Fidelity is the ceiling; the raw pixel is the
floor. We never fall through the floor to black or to nothing.**

This is the same principle the owner set for the whole feature ("build a
pixel-perfect snapshot first, then progressively replace pixels with
components") — applied consistently to *every* layer, not just the top-level
frame.

## Why this session existed

Prior rounds chased per-frame visual complaints from screenshots. Two of the
three complaints this session started with (doc-card renders flat gray; composer
bar missing) turned out to be **stale screenshots** — the runtime already builds
those correctly. Only a *measured* approach caught that. The lesson: eyeballing
one frame's screenshot is not a fidelity metric; it misleads.

## The measurement engine (what makes accuracy scalable)

`studio/scripts/runtime-probe.mts` — runs the REAL Figma-plugin runtime string
(`buildExecuteScript`) against a RECORDING mock of the Figma API, fed a real
stored `SLJ.json`. Deterministic, no bridge. Emits a flat inventory of every
node the runtime would create (fills, strokes, positions, effects, text).

**What it proves:** what nodes/fills/geometry the runtime emits from a given SLJ
— enough to catch whole classes of runtime bug (dropped nodes, black fills,
mis-positioning, vanished components) without touching Figma.

**What it does NOT prove (honesty boundary, per adversarial review):** actual
pixel fidelity. A second HTML/JS renderer diffed against the browser would be a
self-fulfilling tautology (it agrees with the browser, tells you nothing about
Figma) and is BLIND to Figma-only failures (wider text metrics/wrap, variant
mismatch, cold-import). **The only honest fidelity metric is: real pipeline →
real Figma → screenshot → diff against the real Arcade frame render.** That is
the acceptance gate; it needs the bridge.

Use the probe as the fast inner loop; use real-Figma as the acceptance gate.

## What was fixed (all root-caused via the probe, TDD, adversarially reviewed)

### 1. Color pixel-floor (fills, borders, text)
- **Root cause:** capture resolves raw colors → design-token *names* and
  discards the raw value. Downstream, a token with no bindable Figma variable
  (Variables API is **Enterprise-only**) black-defaulted (borders) or vanished
  (fills), because the runtime's `parseColor` defaults unknown strings to opaque
  black. The fill pipeline had a token→variable path; borders/others did not.
- **Fix:** carry a `tokens` dict (name→raw value) on the SLJ. The plan emits
  BOTH a variable key (fidelity) AND a raw floor color. The runtime paints the
  raw floor first, then binds the variable on top. If the bind fails, the raw
  color remains. **Black is never emitted by construction** — a color with
  neither a raw value nor a successful bind is *skipped*, not blacked.

### 2. Component pixel-floor (the biggest defect)
- **Root cause:** mapped components are pruned to a bare instance reference. When
  the DS library can't cold-import (the documented WS3/WS4 "Figma platform wall"
  — silent hang/fail for MOST of the kit on MOST files), the runtime did a bare
  `return` → **the component drew NOTHING.** Measured: `fail=34, instances=0` on
  the chat frame — 34 components vanished. This is the pixel-first principle run
  backwards: prune the pixels, bet everything on the import.
- **Fix (Option A+, chosen over full-subtree capture after adversarial review):**
  at prune time, capture a FLAT fallback — the primitive's own box + style
  (fill/border/radius/shadow) + its label text + its glyph SVG. The plan attaches
  this as `PlanInstance.fallback`. The runtime, on set-import failure ONLY
  (before any instance node is created — so never a double-render), renders the
  fallback: a faithful colored/bordered/labeled/icon'd box instead of nothing.
- **Why NOT full-subtree capture:** Radix overlay primitives (Select/Menu) hide
  content via `opacity:0`+transform that the hidden-node skip misses; capturing
  their subtree yields ghost dropdowns overlapping the page — worse than nothing,
  and invisible to the deterministic harness. The flat fallback's output shape is
  fixed and fully validatable locally.

## Honesty boundary / known residuals (adversarially confirmed)

- **Legacy on-disk SLJs** (written before this change, no `tokens`/`fallbackStyle`)
  degrade partially: a text color that is a token-with-key can still go black if
  the variable import fails (frames/borders are safe — they skip). This affects
  only the stale-SLJ debug/curl path; every *fresh* UI export re-serializes with
  the new capture, so real users are covered. Not worsened by this change.
- **Gotcha #1 still governs:** the stored `SLJ.json` only regenerates on a UI
  re-export. All probe measurements on the stored SLJ under-report the new
  capture (fallbackStyle/iconSvg/tokens) until a fresh export runs.

## BLOCKED — the acceptance gate

Both Figma write paths (figma-console MCP bridge; Studio's own `figmaBridge`
ws server) require the Desktop Bridge / Arcade export plugin to be **manually
Run inside Figma Desktop** — an action an agent can't perform. ws server listens
on :9223 but no plugin client is connected. This gates:
1. A fresh SLJ re-export carrying the new `fallbackStyle`/`iconSvg`/`tokens`.
2. The real-Figma pixel diff (the only honest acceptance metric).

**To unblock:** in Figma Desktop, Plugins → Development → run the Arcade export /
Desktop Bridge plugin, then re-export `computer-chat/01-computer` via the Studio
UI and screenshot node vs the real frame render.

## Tests added
- `executePlan-borders`: token→key+raw floor; unmapped-token floor; legacy skip.
- `buildExecuteScript-borders`: bind on success; **raw floor kept when import fails** (never black).
- `executePlan`: fallback frame attach (box+fill+label+icon svg); omit when nothing to show.
- `buildExecuteScript-instance-fallback`: fallback renders on cold-import wall; no double-render.
- Full suite: 1832 passed / 2 skipped.
