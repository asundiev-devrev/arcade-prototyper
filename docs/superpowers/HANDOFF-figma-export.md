# Handoff — Figma Export (pixel-fidelity)

**Last updated:** 2026-07-02 (session 3)
**Branch:** `feat/figma-export-v1` (pushed; latest `7651141`)
**Status:** Working end-to-end. NOT merged. **Step-1 pixel fidelity IN PROGRESS —
first real pixel win landed this session (doc-card fan restored), but the
center-pivot render is not yet re-diffed against the clone.** Export suite: 195
passed (`pnpm run studio:test studio/__tests__/export/`).

> **SESSION 3 TL;DR (2026-07-02):** Fixed the headline gap #1 (flat-gray
> doc-card). Root cause: the stacked-pages illustration fans via the standalone
> CSS `rotate` property (Tailwind v4 `rotate-[Ndeg]`), which the serializer never
> read (it only parsed `transform: matrix()`). Zero rotation captured → pages
> stacked flat → white front page covered the pink layers → flat gray. Fixed
> capture + the center-vs-top-left pivot mismatch (Figma pivot verified live).
> A real export brought the fan back with pink peeking through. **Next agent:
> restart Studio (server change!), re-export, pixel-diff the center-pivot result
> vs clone `35:3435`.** Full detail in the SESSION 3 section below.

> **READ THIS FIRST — the mandate (do not drift from it):**
>
> 1. **Pixel-perfect FIRST.** Build a pixel-perfect snapshot of the Arcade Studio
>    frame (like html.to.design / Figma's own clone extension do). Only once that
>    is perfected do we progressively replace pixels with mapped components.
> 2. **Component mapping is deterministic and comes LATER.** We don't guess Studio→
>    library mappings; we map them directly. But not until pixels are right.
> 3. **The bar is html.to.design.** If we can't match that clone's pixel fidelity,
>    we shouldn't ship this at all. The clone is the metric.
>
> **The reference files (same Figma file `SjUSTwykUm39dzRtj6jxiX`):**
> - html.to.design clone (THE BAR): node `35:3435`
> - Real Arcade frame render (ground truth): screenshot the live frame at
>   `http://localhost:5556/api/frames/computer-chat/01-computer`
> - Session-2 export (pre-fix baseline): node `51:6808`
> - Session-3 export (rotation-capture fix, fan restored, BUT built with the OLD
>   top-left pivot — center-pivot fix landed after this render): node `53:8757`
> - Test project: `~/Library/Application Support/arcade-studio/projects/computer-chat`

---

## SESSION 3 (2026-07-02) — first step-1 pixel win: doc-card fan restored

**Outcome: gap #1 (the flat-gray doc-card illustration) root-caused and fixed.**
This is the first genuine step-1 pixel improvement across all three sessions.
Committed as `7651141`, pushed. NOT yet re-diffed against the clone with the
final pivot math — that's the next agent's first move.

### What was actually wrong (root cause, evidence-first)

Session 3 did what sessions 1–2 skipped: **inspected the live doc-card DOM** with
Playwright `browser_evaluate` before touching code, and screenshotted all three
references (clone `35:3435`, session-2 export `51:6808`, real frame) side by side.

The stacked-pages illustration is 3 "paper" cards fanned at slight angles
(`4deg / -3deg / -6deg`). The fan is the WHOLE illustration — it's what lets the
pink alpha layers (`rgba(255,52,45,0.16 / 0.12)`) peek out from behind the wide
white front page. The DOM proved those angles come from the **standalone CSS
`rotate` property** (Tailwind v4's `rotate-[Ndeg]`), with `transform: none`.

The serializer's `rotationDegrees()` only parsed `transform: matrix(...)`. It
never read the `rotate` property → captured **zero** rotation → pages stacked
axis-aligned → the wide white front page fully covered the pink layers → flat
gray. **This was a capture bug, and the SLJ confirmed it: all the layers were
present, just un-rotated.** (Contrast session 2, which wrongly concluded "stale
screenshot / non-bug" from a pixel-blind probe.)

A second, coupled bug surfaced once rotation was captured: **pivot mismatch.**
CSS rotates about the element CENTER (the default `transform-origin`); Figma
rotates about the node's TOP-LEFT origin. Verified empirically via the live
bridge (`figma_execute`: rotate a rect, read `relativeTransform` → translation
stays at the top-left, `[e,f]` = origin). Left uncorrected, the fan scatters.

### The fix (committed `7651141`)

- **`studio/src/export/fiberWalk.ts`**
  - `rotationDegrees(transform, rotate)` now sums BOTH the `transform` matrix and
    the standalone `rotate` property. New `cssRotatePropertyDegrees()` parses
    deg/rad/grad/turn and ignores 3D (x/y-axis) rotations (not in-plane spins).
  - For a rotated node, emit the **un-rotated frame's true top-left**
    (`center − halfSize`, center taken from the rotated bbox) instead of the
    rotated bbox top-left, so the runtime can place + center-rotate it.
- **`studio/src/export/figma/buildExecuteScript.ts`**
  - Rotated frames are now placed via **`relativeTransform`** built to pivot about
    the frame's CENTER: `origin (e,f) = center − R·(w/2, h/2)`. Replaces the old
    `f.rotation = -deg` (which spun about the top-left and drifted the card).
- **Tests** (`fiberWalk-transform.test.ts`, `buildExecuteScript-borders.test.ts`):
  `rotate`-property path, matrix+property summing, 3D-axis skip, `rotate:none`
  default, and center-preservation of the rotated frame. Mock now decodes
  rotation from `relativeTransform` like real Figma. All 195 export tests pass.

### What is PROVEN vs NOT (be honest, per the mandate)

- **PROVEN on pixels:** the `rotate`-property capture. After the serializer fix,
  a fresh UI re-export regenerated the SLJ with `rotation: 4/-3/-6` on the pages
  and correct un-rotated sizes, and a real Figma export (`53:8757`) **brought the
  fan back — the pink layers now peek through.** No longer flat gray.
- **NOT yet proven:** the center-pivot math. The `53:8757` render was built with
  the OLD top-left pivot (the pivot fix + relativeTransform landed AFTER that
  export), so its fan is too wide / scatters. The center-pivot version has NOT
  been rendered in real Figma or diffed against the clone yet.

### NEXT AGENT — do this first (exact steps)

1. **Restart Studio** — `buildExecuteScript.ts` is server-side middleware and
   does NOT hot-reload (gotcha #2). `kill $(lsof -ti :5556)` then `pnpm run
   studio`. Confirm the PID started AFTER commit `7651141`.
2. **Re-export** through the UI (Share → pick "Computer: Chat" → Export to Figma).
   The `fiberWalk.ts` change already rewrote the SLJ this session, but re-export
   anyway to be safe (gotcha #1). Bridge must be running in Figma Desktop.
3. **Screenshot the new export node + pixel-diff vs clone `35:3435`.** Confirm the
   fan is now TIGHT (matches the clone) rather than scattered. That closes gap #1.
4. Then move to the next capturable-primitive gap (icon "+" placeholders, text
   overflow at the right edge) — same evidence-first loop.

### Minor known issue found (not blocking, not fixed)

The SLJ duplicates each page node (each pink layer appears twice, nested, same
box/fill). Harmless for pixels — both copies rotate identically — but it's a
serializer wrapper-collapse edge case worth cleaning up eventually.

---

## SESSION 2 (2026-07-02) — what happened, honestly

**Outcome: the latest export (`51:6808`) is visually identical to the pre-session
baseline.** No pixel-fidelity progress. Here is exactly why, so the next agent
does not repeat it.

### The drift (the mistake to avoid)

The mandate is **step-1 pixel fidelity**. Instead this session shipped two
**failure-path fallbacks that belong to step 2** and are invisible on a healthy
file:

- **Color floor** (commit `39f009c`): token-colored borders/fills now carry a raw
  color fallback so they never render black/invisible when a Figma *variable*
  can't be bound. Only fires when variable binding FAILS.
- **Component floor** (same commit): when a mapped component's library can't
  cold-import, render a faithful box (fill+label+icon) instead of nothing. Only
  fires when `importComponentSetByKeyAsync` returns null.

**Why the export looks identical:** on the test file the Arcade library IS enabled,
so every component imported fine (metadata for `51:6808` is full of `<instance>`
nodes) and every color variable bound fine. **Both fallbacks are no-ops by
construction when nothing fails.** The work hardens tester machines / non-Enterprise
plans (real, but step 2), and does nothing for the pixel bar.

### The root reasoning error (so it isn't repeated)

1. Session correctly identified the real step-1 gaps vs the clone (see below).
2. Built a **deterministic runtime probe** (`studio/scripts/runtime-probe.mts`)
   that runs the real Figma runtime string against a *recording mock* — no bridge.
   Useful, BUT it proves *which nodes get built*, **NOT whether pixels render
   correctly**.
3. The probe showed the doc-card's pink layers *exist as nodes* → session wrongly
   concluded "flat-gray is a stale screenshot, non-bug." **A pixel-blind
   instrument was used to dismiss a pixel problem.**
4. Then chased bugs the probe *could* see without a bridge (border-black,
   component-vanish) — **streetlight effect: optimized for what the instrument
   could measure, not what the mandate asked for.**

**Lesson for next agent:** the ONLY valid fidelity metric is a **pixel diff of the
real Figma render against the clone / real frame**. Node-count / node-existence
probes cannot tell you if the picture is right. Do not let them.

### What session 2 actually changed (committed, tested, adversarially reviewed)
- `studio/src/export/slj.ts`: `SljDocument.tokens` (token→raw color dict);
  `ComponentNode.fallbackStyle` + `iconSvg`.
- `studio/src/lib/exportFrameToSlj.ts`: `captureTokenValues()`, `iconSvgFor()`.
- `studio/src/export/fiberWalk.ts`: capture fallbackStyle + icon svg at prune time.
- `studio/src/export/figma/executePlan.ts`: `resolveColorValue` (emit variable key
  AND raw floor), `buildFallbackFrame`, `PlanBorderSide`, `PlanInstance.fallback`.
- `studio/src/export/figma/buildExecuteScript.ts`: `bindFill(node,varKey,rawColor)`
  paints raw floor then binds; `applyBorders` async, skips (never black) when no
  paint; instance path renders `node.fallback` on import failure.
- `studio/scripts/runtime-probe.mts`: the deterministic probe (keep it — it's a
  good inner-loop tool, just NOT a fidelity metric).
- Spec: `docs/superpowers/specs/2026-07-02-figma-export-pixel-floor.md`.

**These are fine to keep** (they harden step 2 and fix a real minor black-border
bug), but they are **not the mandate** and did not move the pixel bar.

---

## THE ACTUAL OPEN PROBLEM (start here) — step-1 pixel fidelity

Compare our export to the clone (`35:3435`) and the real frame. Known gaps where
we are BELOW the clone:

1. ~~**Doc-card "Q3 launch brief" illustration renders flat gray.**~~ **FIXED in
   session 3 (commit `7651141`).** Root cause was NOT a render bug — it was a
   capture bug: the fan comes from the standalone CSS `rotate` property (Tailwind
   `rotate-[Ndeg]`), which the serializer never read, so all pages captured with
   zero rotation and stacked flat. Capture + center-pivot both fixed. Fan proven
   restored in a real export; the final center-pivot render still needs a
   pixel-diff vs the clone (see the SESSION 3 section — next agent's first step).
2. **Icons in reaction rows / some buttons show as "+" placeholders** vs the clone's
   real glyphs (on files where icon swap doesn't resolve). **← now the top open gap.**
3. ~~**Rotation pivot drift**~~ **FIXED session 3.** Rotated frames now placed via
   `relativeTransform` that pivots about the center (Figma's top-left pivot verified
   live). Pending the same pixel-diff confirmation as gap #1.
4. Stray spinner glyph near the frame title; top-right control cluster slightly off.
5. **Text overflows the right edge** on the assistant messages (no wrap at the
   narrower frame width) — observed in the session-3 side-by-side. Investigate next.

**Where we already MATCH or BEAT the clone:** real avatar photos (clone shows gray
circles), the composer bar + "Ask me anything" placeholder (a genuine session-1
fix, verified present), font sizes/weights/colors, per-side borders, per-corner radius.

### Recommended approach for the next session (aligned to the mandate)
1. **Set up the pixel metric FIRST.** Render our export in real Figma → screenshot →
   diff against the clone `35:3435` (and the real frame). Make "worse than the clone"
   a visible number. Do NOT proceed on node-existence evidence.
2. **Fix the doc-card** (gap #1) as the first pixel win — it's a rendering bug on
   already-captured primitives, so it's pure step-1. Reproduce in real Figma,
   isolate which property (alpha/clip/z-order/transform) is wrong, fix, re-diff.
3. **Sweep for other capturable-primitives-that-render-wrong** the same way. Only
   when the pixel snapshot matches the clone do you touch component mapping (step 2).

---

## How it works (verified, current on HEAD) — carried from session 1

1. **Browser serializer** (`studio/src/lib/exportFrameToSlj.ts` +
   `studio/src/export/fiberWalk.ts`): walks the frame iframe's live React fiber
   tree, reads computed styles/boxes via a `FiberReader`, emits an SLJ document.
   Boxes are ABSOLUTE page coordinates (`getBoundingClientRect`).
2. **Plan builder** (`studio/src/export/figma/executePlan.ts`):
   `sljToExecutePlan` → `{frame, root}`. Node kinds: `frame`, `instance`, `text`,
   `svg`, `image`. Mapped arcade-gen components → `instance` (by published key);
   everything else → faithful `frame`/`text`/`svg`/`image`.
   **`PlanFrame.layout` is always `null`** — pixel-first, absolute positioning.
3. **Runtime builder** (`studio/src/export/figma/buildExecuteScript.ts`): emits a
   Plugin-API script as an embedded **ES5-ish string** (no arrows/optional
   chaining — it runs in Figma's plugin sandbox). Positions every node by
   `box − parentOffset`.
4. **Transport** (`studio/server/middleware/figmaExport.ts` +
   `studio/server/figmaBridge/wsServer.ts`): Studio middleware sends the script
   over a WebSocket to a Figma **Desktop Bridge plugin** (reuses the existing
   `figma-console-mcp` plugin). One `EXECUTE_CODE` round trip. Bridge singleton
   lives on `globalThis` (survives Vite module reloads — commit 3463f7b).

### What the serializer captures today (SLJ `ElementStyle`, `slj.ts`)
`fill`, `color`, `fontFamily/fontSize/fontWeight/lineHeight`, `cornerRadius`,
per-corner `corners{tl,tr,br,bl}`, per-side `borders{top,right,bottom,left}`,
`rotation`, `clip`, `shadow`, `opacity`, `svg` (icon vector markup),
`imageData` (canvas→base64 for `<img>`), placeholder text for input/textarea.
**Session 2 added:** `tokens` dict (name→raw color), `ComponentNode.fallbackStyle`,
`ComponentNode.iconSvg`.

### What is NOT captured (the long tail — relevant if a step-1 gap needs it)
`background-image` on divs, CSS gradients, pseudo-elements (`::before/::after`),
CSS `filter`/`backdrop-filter`, `mask`/`clip-path`, non-rotation transforms
(scale/skew/translate), `text-decoration`/`letter-spacing`/`text-transform`/
`text-align`/italic, blend modes, `outline`, `<img>` object-fit. **Note:** the
doc-card gap #1 does NOT need any of these — it's plain divs — so fix the rendering
first before assuming a capture gap.

---

## CRITICAL gotchas that cost real time (do NOT re-learn these)

1. **`curl POST …/to-figma` replays the STORED `SLJ.json` on disk — it does NOT
   re-serialize.** The SLJ is only regenerated by exporting through the browser UI
   (hidden iframe mounts the frame, walks it, POSTs fresh SLJ). If you change
   `fiberWalk.ts`/`exportFrameToSlj.ts`/`slj.ts`, you MUST re-export via the UI
   (Playwright: open project → Share → pick frame → Export to Figma) or the stale
   on-disk SLJ silently masks your change. **Session 2 lost a full cycle to this:
   fixes were committed but the user's export ran against a stale server + stale
   SLJ and showed baseline.** Confirm the fresh `SLJ.json` mtime is NOW and carries
   your new field.
   - `buildExecuteScript.ts` / `executePlan.ts` changes consume the stored SLJ (no
     re-serialize needed) but DO need a Vite **server restart**.
   - `fiberWalk.ts` / client changes hot-reload in the browser, no restart, but DO
     need a UI re-export to rewrite the SLJ.
2. **Server middleware does not hot-reload.** Any edit under `server/**` (or the
   src the middleware imports at boot) → `kill $(lsof -ti :5556)` and
   `pnpm run studio` again. **A stale server will run OLD code and look like your
   fix did nothing.** Always confirm the running server started AFTER your commit.
3. **The Desktop Bridge drops constantly.** Export returns `409 no_bridge` while the
   plugin looks connected. Fix: reload the plugin (Plugins → Development → Figma
   Desktop Bridge). After a server restart the plugin reconnects to the NEW ws
   server only after a reload — poll a few times. **The bridge write path requires
   the plugin to be manually Run in Figma Desktop — an agent cannot do this; ask
   the user.**
4. **Screenshots: two transports, both flaky.**
   - `mcp__plugin_figma_figma__get_screenshot(fileKey: SjUSTwykUm39dzRtj6jxiX,
     nodeId: <rootId>)` — reads Figma cloud; node needs ~20-40s to index after
     export; returns a short-lived URL; `curl` it to PNG and Read it. (Most reliable.)
   - figma-console MCP `figma_capture_screenshot` — live plugin render, but
     disconnects often.
5. **Figma cold-import is BROKEN for most of the Arcade UI Kit** —
   `importComponentSetByKeyAsync`/`importStyleByKeyAsync` silently never settle for
   most components (Radio/Toggle/Toast/Menu/text-styles) on files where the kit
   library is stale/huge. Button/Checkbox/IconButton import warm (~13ms). This is a
   Figma platform wall, NOT our bug. (Session 2's component floor is the mitigation,
   but that's step 2.) The current test file `SjUSTwykUm39dzRtj6jxiX` HAS the library
   enabled, so imports succeed there.

---

## Bugs fixed across both sessions (all live-found, all have tests)

**Session 1** (serializer/tree + runtime + the pixel-first pivot):
- `f1f9a0a` walked the STALE root fiber (React double-buffers; use `FiberRoot.current`).
- `b1936ed` mixed text+element parents dropped direct text (added `FiberReader.directText`).
- `f78211b` directText DUPLICATED 11× (emit only from the fiber that IS the host).
- `912cb53` mapped container components pruned like leaves (added `container:true`).
- `df7ff29` 17-deep styleless wrapper chains (collapse styleless single-child frames).
- `473ede1` hidden nodes exported as stray glyphs (skip display:none/visibility:hidden/0×0).
- `2e17c48` library-not-enabled made imports hang forever (bounded `withTimeout`).
- `9ae74ee` cold imports slow+serial (parallel pre-warm + racing set/comp imports).
- `3463f7b` bridge singleton spawned multiple ws servers (moved to `globalThis`).
- `31b6cc6` (WS5) pixel-first pivot: killed layout inference, added clipping, shadow,
  opacity, image capture.
- `8ec47b9` (WS1) SVG vector capture for all ~120 icons, zero mapping.
- `bf00712` (WS2) wrap only text that was multi-line in the browser.
- `42e5936 / 695c34d / 1f0eb3c` (WS6) per-side borders + per-corner radius (were
  captured then dropped), CSS rotation capture, input/textarea placeholder text.

**Session 2** (`39f009c`): color floor (token→variable+raw fallback, never black),
component floor (fallback box on cold-import failure). *Both step-2 failure-path
hardening — see the honesty section above.*

---

## Known gaps (honest, priority order for the mandate)

0. **VERIFY the session-3 fix** — re-export with the center-pivot code (server
   restart!) and pixel-diff vs the clone. Until that's done, gaps #1/#3 below are
   "fixed pending confirmation," not closed.
1. ~~Doc-card illustration flat gray~~ **FIXED session 3** (`rotate`-property capture
   + center-pivot). Fan proven restored; center-pivot render pending pixel-diff (#0).
2. **Icon "+" placeholders** on files without icon-set resolution. **← top open gap.**
3. ~~Rotation pivot drift~~ **FIXED session 3** (`relativeTransform` center-pivot).
4. **Text overflows the right edge** on assistant messages at the narrower frame
   width (no wrap). New gap spotted session 3.
5. Multi-color-per-side borders keep all widths but only the first side's color.
6. Stray spinner glyph near title; top-right control cluster slightly off.
7. SLJ duplicates each rotated page node (harmless — identical rotation — but a
   serializer wrapper-collapse edge case).
8. Typography style LINKING not done (raw font/size/weight applied; not linked to
   Figma text styles). Blocked by the same cold-import wall. **Step 2.**
9. Component mapping stuck at ~17 + cold-import wall. **Step 2 — do not touch until
   pixels match the clone.**

---

## How to run / verify (exact steps)

1. `pnpm run studio` from repo root (serves :5556). **Middleware changes need a full
   restart; confirm the server PID started AFTER your latest commit.**
2. Figma Desktop open on the Pixel-Fidelity Spike file (`SjUSTwykUm39dzRtj6jxiX`);
   run the Figma Desktop Bridge plugin (Plugins → Development). **This is a manual
   step; if you're an agent, ask the user to do it.** If exports 409, reload the plugin.
3. Export via UI (REGENERATES SLJ — mandatory after any serializer change):
   Playwright to `http://localhost:5556/#/project/computer-chat` → Share → pick
   frame → Export to Figma → wait ~15s. **Verify `SLJ.json` mtime is NOW.**
4. Screenshot: get `rootId` from the export response, then
   `mcp__plugin_figma_figma__get_screenshot(fileKey: SjUSTwykUm39dzRtj6jxiX,
   nodeId: <rootId>)` after ~20-40s; `curl` the URL to PNG; Read it.
5. **DIFF against the clone `35:3435` — that is the metric. Not node counts.**
6. The deterministic probe `pnpm tsx studio/scripts/runtime-probe.mts <SLJ.json>
   [--json] [--live-maps]` is a fast inner loop for "what nodes get built / are any
   black / do any vanish" — but it is NOT a fidelity metric. Do not conclude
   pixel-correctness from it.

Repo conventions: pnpm only; Conventional Commits scope `studio/figma-export`; never
`git add -A` (loose scratch/screenshots in root are untracked by design);
`pnpm run studio:test <path>` for one file.

---

## Discipline note (the meta-lesson from session 2)

Every fix must be verified against a **real Figma render diffed to the clone** before
claiming a fidelity win. The stored-SLJ-vs-fresh-SLJ trap (gotcha #1) + the
stale-server trap (gotcha #2) mean "the test passed" and "the probe shows nodes" are
NOT the same as "the exported picture improved." Session 2's entire miss traces to
trusting a pixel-blind instrument over the pixel bar the owner set. **Stay on the
mandate: pixel-perfect snapshot first, measured against html.to.design, then components.**
