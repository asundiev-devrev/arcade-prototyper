# Handoff — Figma Export (pixel-first v1)

**Date:** 2026-07-02
**Branch:** `feat/figma-export-v1` (pushed to origin, 29 commits ahead of `main`)
**Status:** Working end-to-end. Live-verified on real DevRev frames. NOT merged.
**Full suite:** 1822 passed / 2 skipped. `pnpm run studio:test`.

Read this, then the ledger `.superpowers/sdd/progress.md` (per-round detail), then
the original spec/plan if you need the deep history:
- Spec: `docs/superpowers/specs/2026-06-30-figma-export-agentic-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-figma-export-v1-deterministic.md`

---

## TL;DR — where this landed

"Export to Figma" now rebuilds a selected Studio frame in Figma with **real
pixel fidelity + real components layered on top**. Last live export of the
ComputerScene chat frame: **94 frames, 34 real component instances, 10 vector
icons, 35 bound color variables, 0 failures** — and the screenshot reads as the
actual product (clean panels, real avatars, borders, chat bubbles, composer with
placeholder). It is at or above the html.to.design browser-extension clone on
everything except one illustration (see Known Gaps), and it carries what the
clone fundamentally cannot: real DS component instances + bound color variables.

**The architecture pivoted mid-session** (owner-approved). The original plan was
"deterministic two-tier: mapped components + inferred-auto-layout faithful
render." That produced exports that were *neither* pixel-faithful *nor* reliably
componentized — auto-layout inference re-flowed absolutely-positioned content and
overlapped it. The owner's bar became: **be no worse than the dumb html.to.design
clone (pixel-perfect absolute positioning), then progressively replace pixels
with real components.** That is now the design. Auto-layout inference is captured
in the SLJ but NOT consumed (reserved for a v2 with a verify loop).

---

## How it actually works (verified, current on HEAD)

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
   lives on `globalThis` (survives Vite module reloads — see commit 3463f7b).

### What the serializer captures today (SLJ `ElementStyle`, `slj.ts`)
`fill`, `color`, `fontFamily/fontSize/fontWeight/lineHeight`, `cornerRadius`,
per-corner `corners{tl,tr,br,bl}`, per-side `borders{top,right,bottom,left}`,
`rotation`, `clip`, `shadow`, `opacity`, `svg` (icon vector markup),
`imageData` (canvas→base64 for `<img>`), placeholder text for input/textarea.

---

## CRITICAL gotchas that cost real time this session (do NOT re-learn these)

1. **`curl POST …/to-figma` replays the STORED `SLJ.json` on disk — it does NOT
   re-serialize.** The SLJ is only regenerated when you export through the
   browser UI (a hidden iframe mounts the frame, walks it, POSTs fresh SLJ). If
   you change `fiberWalk.ts`/`exportFrameToSlj.ts`/`slj.ts` and want to see it,
   you MUST re-export via the UI (Playwright: open project → Share → pick frame →
   Export to Figma), or the stale on-disk SLJ silently masks your change. I
   burned a full verify cycle screenshotting a "WS6" result that was actually the
   old SLJ. Confirm with: does the fresh `SLJ.json` carry your new field? (e.g.
   `borders` count > 0, old `stroke` gone).
   - `buildExecuteScript.ts` / `executePlan.ts` changes DON'T need re-serialize
     (they consume the stored SLJ) but DO need a Vite **server restart**
     (middleware doesn't hot-reload).
   - `fiberWalk.ts` / client changes hot-reload in the browser, no restart, but
     DO need a UI re-export to rewrite the SLJ.

2. **Server middleware does not hot-reload.** Any edit under `server/**` →
   `kill $(lsof -ti :5556)` and `pnpm run studio` again.

3. **The Desktop Bridge drops constantly.** Symptoms: export returns `409
   no_bridge` while the plugin looks connected; or the figma-console MCP
   disconnects. Fixes that worked: reload the plugin (Plugins → Development →
   Figma Desktop Bridge, or `figma_reload_plugin`), and after a server restart the
   plugin reconnects to the NEW ws server only after a reload — poll the export a
   few times. The globalThis singleton (3463f7b) fixed the *worst* case (Vite
   spawning multiple ws servers on different ports, plugin connected to an orphan).

4. **Screenshots: two transports, both flaky, use whichever is up.**
   - figma-console MCP `figma_capture_screenshot` (live plugin render, no cloud
     lag) — but disconnects often.
   - **Official Figma MCP `mcp__plugin_figma_figma__get_screenshot`** (fileKey
     `SjUSTwykUm39dzRtj6jxiX`, nodeId from the export's `rootId`) — reads from
     Figma cloud, so the node needs ~20-40s to index after export, and the
     Desktop app must sync to cloud. Returns a short-lived URL; `curl` it to a
     PNG and Read the PNG.
   - The test file is the **DevRev "Arcade Pixel-Fidelity Spike — Full Screen"**
     file, key `SjUSTwykUm39dzRtj6jxiX`.

5. **Figma cold-import is BROKEN for most of the Arcade UI Kit — this is a Figma
   platform wall, not our bug** (see WS3/WS4 below). Do not spend time trying to
   make `importComponentSetByKeyAsync` work for arbitrary components; it silently
   never resolves.

---

## The 15 bugs fixed this session (all live-found, all have tests)

Serializer/tree:
- **f1f9a0a** — walked the STALE root fiber. React double-buffers root fibers;
  the `__reactContainer$` key points at the mount-time fiber whose live tree is
  its `alternate`. Fix: normalize to `FiberRoot.current`. (This caused the very
  first "1×1 empty frame".)
- **b1936ed** — mixed text+element parents dropped their own direct text (HostText
  fibers are invisible to the fiber walk). Added `FiberReader.directText` (reads
  DOM child text nodes).
- **f78211b** — that directText then DUPLICATED text 11× because `hostOf` descends
  `.child`, so every Radix wrapper fiber returned the same host's text. Fix: emit
  only from the fiber that IS the host (`stateNode instanceof Element`).
- **912cb53** — mapped container components (Tabs/Modal/Popover) were pruned like
  leaf widgets, swallowing whole page regions into one text blob. Added
  `container: true` → recurse instead of instance-swap.
- **df7ff29** — 17-deep styleless wrapper chains all named "frame" (unusable layer
  panel). Collapse styleless single-child frames; name layers from
  component/semantic-tag/layout. (Collapse is position-safe because boxes are
  absolute.)
- **473ede1** — hidden nodes (`display:none`, `visibility:hidden`, 0×0) exported as
  stray glyphs (inactive tab panels). Now skipped (root never skipped).

Runtime/transport:
- **2e17c48** — a library not enabled in the target file made
  `importComponentSetByKeyAsync` hang forever (no reject). Bounded with
  `withTimeout`.
- **9ae74ee** — cold imports were slow+serial, and bare-COMPONENT keys hang the
  set-import API. Added parallel pre-warm + `importSetByKey` racing set/comp
  imports + realistic budgets (90s exec).
- **3463f7b** — bridge singleton was module-level; Vite re-eval spawned multiple
  ws servers → plugin connected to an orphan → false `no_bridge`. Moved to
  `globalThis`.

Pixel fidelity (the pivot):
- **31b6cc6** (WS5) — pixel-first: killed layout inference (layout always null),
  added overflow clipping, box-shadow, opacity, image capture (canvas→base64→IMAGE
  fill with an inline ES5 base64 decoder).
- **8ec47b9** (WS1) — SVG vector capture: icons not in the icon map now render as
  real Figma vectors via `createNodeFromSvg` (currentColor + CSS-var resolved,
  20KB cap). Kills the "empty icon" class for ALL ~120 icons, zero mapping.
- **bf00712** (WS2) — wrap only text that was multi-line in the browser (killed
  "Setti ngs" wrapping; Figma font metrics run wider than the browser's).
- **42e5936 / 695c34d / 1f0eb3c** (WS6) — per-side borders + per-corner radius
  (were captured then DROPPED — never plumbed through plan/runtime), CSS rotation
  capture (`offsetWidth/Height` for un-rotated size to dodge the getBoundingClientRect
  bbox trap), input/textarea placeholder text.

Earlier deterministic-plan work (Tasks 2-6, pre-pivot, still live): text
styling capture/carry/apply, radius, DS-gap counts + typed telemetry
(`figma_export_started/succeeded/failed`), setup doc.

---

## Known gaps (honest, in priority order)

1. **Doc-card illustration renders flat.** The "Q3 launch brief" card's layered
   document mockup shows as flat gray bars vs the clone's stacked rotated pages.
   Rotation captured 0° on these — they are almost certainly built with SVG
   `<path>`s or CSS pseudo-elements (`::before`/`::after`) or background-images on
   divs, none of which we capture. **This is the #1 remaining fidelity gap and the
   likely next task.** Options: capture pseudo-element content (hard — not in the
   fiber tree, needs `getComputedStyle(el, '::before')`), or capture div
   background-images (WS5 explicitly skipped these — only `<img>` handled), or
   rasterize stubborn subtrees to a single image via html2canvas-in-the-iframe.
2. **Component mapping stuck at ~17 + cold-import wall (WS3/WS4 BLOCKED).** See
   next section — needs a product decision.
3. **Typography style LINKING not done (WS4).** Raw font/size/weight/lineHeight
   ARE applied (pixels match), but text isn't linked to Figma text styles. Blocked
   by the same cold-import wall (`importStyleByKeyAsync` hangs).
4. Rotation pivot: Figma rotates about top-left, CSS about center — minor drift on
   small rotated cards. Needs `relativeTransform` to fix perfectly.
5. Multi-color-per-side borders keep all widths but only the first side's color.
6. Stray spinner glyph near the frame title; top-right control cluster slightly
   off. Minor.

---

## WS3/WS4 — the cold-import wall (needs an owner decision, do not brute-force)

**Verified fact:** `importComponentSetByKeyAsync` / `importStyleByKeyAsync` NEVER
settle for MOST Arcade UI Kit components (Radio, Toggle, Toast, Menu, Accordion,
text styles) — no error, silent hang 6+ minutes. Button/Checkbox/IconButton
import in ~13ms (they're warm/cached in the file). Toggle resolved once at 42ms
then hung on retry — nondeterministic. Color VARIABLES always import fine (35
bound live). REST confirms every key is valid and live (file
`a2uKnm88LxRXEWAL1kOqeQ`, 874 sets / 5366 components). Root cause: Figma's backend
chokes on cold-importing from a huge library with stale publish records. **Not
fixable from our side.**

Discovery is DONE and saved:
- `.superpowers/sdd/ws3-candidates.json` — 22 component candidates (arcadeGen →
  library key + variant axes + confidence) + 29 text styles (key + font props).
  Keys REST-verified.

**The unblock plan (recommended): a slim "Arcade Export Kit" published Figma file**
(~40 mapped components + one text sample per style), built INSIDE the kit file
where everything is local (nothing to import, nothing hangs), then published once.
Fresh file → fresh publish state → 40 comps instead of 5366 → cold imports should
be fast. **One publish click by the kit owner; ZERO end-user steps.** The owner
REJECTED the alternative (per-file manual sticker-sheet paste) as too cumbersome,
and per-export generation is impossible (same broken import pipe).
Once the slim kit exists: write the 22 map rows in `componentEntries.ts`
(verify each key imports live over the bridge FIRST — the stale-key trap is real),
then wire WS4 typography (computed font/size/weight → text-style key →
`importStyleByKeyAsync` + `setTextStyleIdAsync`, raw props stay as fallback).

---

## How to run / verify (exact steps)

1. `pnpm run studio` from repo root (serves :5556). Middleware changes need a
   full restart.
2. Figma Desktop open on the Pixel-Fidelity Spike file; run the Figma Desktop
   Bridge plugin (Plugins → Development). If exports 409, reload the plugin.
3. Export via UI (regenerates SLJ): Playwright to
   `http://localhost:5556/#/project/<slug>` → wait → click Share → pick frame →
   Export to Figma → wait ~15s.
   - Test frames used: `computer-chat/01-computer` (ComputerScene, the hard one),
     `computer-settings/01-computer-settings`,
     `this-is-computer-s-web-oauth-page/01-figma-1747-21118`.
4. Screenshot: get the export `rootId` from the API response, then
   `mcp__plugin_figma_figma__get_screenshot(fileKey: SjUSTwykUm39dzRtj6jxiX,
   nodeId: <rootId>)` after ~20-40s indexing; `curl` the URL to a PNG; Read it.
5. Compare against the html.to.design clone at node `35:3435` in the same file
   (that's the fidelity bar the owner set).

Repo conventions: pnpm only; Conventional Commits scope `studio/figma-export`;
never `git add -A` (loose scratch/screenshots in root are untracked by design);
`pnpm run studio:test <path>` for one file.

---

## Recommended next moves (in order)

1. **Whole-branch review** (superpowers:requesting-code-review) — 29 commits, many
   are same-file iterative fixes; worth a coherence pass before merge. Watch for:
   the `stroke` field (now superseded by `borders` — check nothing still reads
   it), `inferLayout` now dead-but-captured (confirm intentional), the base64
   decoder in the runtime string, plan double-build (documented deliberate).
2. **Doc-card illustration** (Known Gap #1) — highest-visibility fidelity win.
   Investigate whether it's SVG paths / pseudo-elements / div background-images
   FIRST (inspect the live DOM), then pick capture strategy.
3. **Slim Export Kit decision** with owner → then WS3 map rows + WS4 typography.
4. **Manual gates G1-G5** (real Figma, from the original plan) + packaged-app run.

## Discipline note
Every fix this session was root-caused live (systematic-debugging), TDD'd, and
verified against a real export screenshot — not assumed. Keep that: the
stored-SLJ-vs-fresh-SLJ trap (gotcha #1) means "the test passed" is NOT the same
as "the export changed." Always re-export via UI and screenshot before claiming a
fidelity fix works.
