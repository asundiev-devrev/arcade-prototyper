# Handoff: Studio frame-generation fidelity from Figma

**Date:** 2026-06-10
**Status:** investigation + partial fixes; no direction chosen
**Purpose:** Neutral handoff. Records what was tried, what was proven, and the
option space — so a fresh session can decide without inheriting this session's
bias. Nothing here is a recommendation.

---

## The triggering problem

A designer ran two Studio prompts of the form:

> "Build an interactive prototype of this new version of the Nav for SoR:
> `<figma URL>`. It's different from the nav template you currently have, and
> that is intentional, so, please, dismiss your template, and implement the
> design I shared precisely."

Both produced poor frames. Reported symptoms: "agent invented an icon and broke
the build, didn't auto-repair" and "despite a clear instruction to implement
the Figma precisely, lots of bugs / clear misalignments."

Projects involved (Studio project dirs under
`~/Library/Application Support/arcade-studio/projects/`):
- `build-an-interactive-prototype-of-this` (Figma node `3532-40693`, also an
  earlier run on `3451-30523`)
- `build-an-interactive-prototype-of-this-2` (node `3532-40693`)

The two Figma nodes render near-identically: a 240px SoR sidebar — top chrome
(collapse + add + search), a "computer" wordmark pill, three labeled sections
(Teams with an expandable Foundations + nested Lobby/Issues/Roadmap/Sprints,
Views, My work), an Explore row, and a footer (avatar + chat button).

Figma file key: `dHEyK3XWnLEWbTBmF7crQ8`.

---

## How Studio generation works (facts established this session)

- The frame generator is a headless `claude` CLI subprocess spawned per turn
  (`studio/server/claudeCode.ts`), tools `Read,Edit,Write,Glob,Grep,Bash`, no
  browser/screenshot tool. Default model Sonnet.
- The project's `CLAUDE.md` (rendered from `studio/templates/CLAUDE.md.tpl`,
  ~794 lines) is the generator's behavioral spec. KIT-MANIFEST.md is injected
  via `--append-system-prompt`.
- On a Figma-URL prompt, `chat.ts` `enrichPromptWithFigmaContext`
  (`server/middleware/chat.ts:425`) appends a `<figma_context>` block built by
  `server/figma/promptBlock.ts` — a COMPACTED summary tree + resolved tokens +
  suggested composites — and attaches a PNG export (scale 2) of the frame.
- The template is explicitly tuned for SPEED: "a working frame in 2 minutes
  beats a perfect plan in 20"; it forbids re-reading Figma and forbids verifying
  own output ("If the frame is wrong, the designer will iterate" —
  `CLAUDE.md.tpl:205`).
- Frames render as same-origin iframes at `/api/frames/:slug/:frame`
  (`server/plugins/frameMountPlugin.ts`).
- Real icon/component barrel: `arcade/components` → `@xorkavi/arcade-gen`
  (`dist/index.d.mts`, 186 exports). Icons the SoR nav needs all EXIST:
  `Window`, `MagnifyingGlassInSquare`, `Bell`, `ChatBubble`/`ChatBubbles`,
  `DotInLeftWindow`, `TwoHumanSilhouettes`, `ChevronDownSmall`,
  `ChevronRightSmall`, `PlusSmall`.

---

## Root causes found (with evidence)

### A. The write-time guardrail was dead in the packaged DMG

Studio runs a `PostToolUse` hook (`validateArcadeImports.mjs`) that blocks
hallucinated `arcade/components` imports with did-you-mean suggestions. In the
installed app the session transcript showed every invocation failing:

```
hook_non_blocking_error  exitCode 127
stderr: /bin/sh: node: command not found
command: node ".../validateArcadeImports.mjs"
```

The packaged app ships no standalone `node` on PATH (Electron runs everything
as node via its own binary + `ELECTRON_RUN_AS_NODE=1`; `electron/bin/figmanage`
already uses that shim). Both write-hooks (`validateArcadeImports`,
`blockImageReshape`) were hardcoded as bare `node <path>` → 127 → claude treats
the hook as a non-blocking failure and runs the Write anyway. So the
icon-hallucination backstop never ran on tester machines.

This is DISTINCT from the prior `import-hook-dead-in-dmg` memory (0.26.1), which
was about WHICH barrel the hook reads. This one is the hook process not
launching at all.

### B. The agent generated blind, and the injected summary is lossy

- Run on project-1 (node 3451): agent DID read the real tree (figmanage depth
  4/5 + PNG) but still mis-mapped icons (used `HorizontalLinesInSquare` for
  `Window`, hand-rolled an SVG instead of `ChatBubble`) and shipped a garbled
  `comp''ter` wordmark.
- Run on project-2 (node 3532): agent made ZERO figmanage calls. It built
  entirely from the injected `<figma_context>` summary (11KB) + the 240px
  thumbnail. The summary is lossy: the `Computer/Logo` wordmark collapsed to a
  cluster of nameless `vector` nodes → agent rendered a tiny `<Computer>` glyph
  → wordmark gone. The summary also lists `Icons/Window` instances on the nested
  rows and an "Inbox (updates)" row — present in the DATA tree but not clearly
  in the rendered picture — and the agent transcribed the tree, not the render.

The unifying root cause: **the agent never sees its own rendered output, so it
cannot resolve conflicts between the Figma data tree and the rendered picture.**

### C. Figma's own first-party codegen has the same limit (and isn't mergeable)

Pulled `get_design_context` for node `3532-40693` (Code Connect disabled,
forceCode). Findings:
- Geometrically excellent: exact px widths, gaps, padding, colors as CSS-var
  tokens, every node present with `data-name` preserving component identity
  (`Icons/Window`, `_Item`, `Navigation Button`, `Computer/Logo`).
- BUT: every icon + the wordmark are `<img src="figma.com/api/mcp/asset/…">`
  URLs that **expire in 7 days** → frames break after a week.
- AND: raw absolute-positioned `<div>`s with escaped CSS-var Tailwind
  (`var(--bg\/neutral\/soft,…)`) → throwaway, not mergeable.
- AND: it ALSO emits the phantom `Icons/Window` on the nested rows — it trusts
  the data tree too. So Figma's own tooling is not pixel-perfect either.

Also corrected two earlier "bug" calls against the agent: the footer name field
is `opacity-0` (hidden) in the real design — dropping it was correct; and the
nested-row icons are genuinely ambiguous (present in data, unclear in render).

---

## Fixes made this session (uncommitted, on `main`, NOT released)

Change surface (uncommitted):
- `package.json` — version 0.31.1 → 0.31.2
- `studio/server/claudeCode.ts` — `hookCommand()` helper; both write-hooks now
  launch via `ELECTRON_RUN_AS_NODE=1 "<process.execPath>" "<hook>"` instead of
  bare `node`. (Fix for root cause A.)
- `studio/__tests__/server/claudeCode.test.ts` — regression test (hook command
  must not be bare `node`; must use runtime + flag). 19/19 pass.
- `studio/server/figma/fidelityDirective.ts` (new) — `detectHiFiIntent()` +
  `buildHiFiDirective()`: when a prompt has a Figma URL AND precise-intent
  phrasing, append a `<high_fidelity_mode>` directive that suspends the speed
  shortcuts, forces a real tree read, treats the PNG as ground truth, and asks
  for a self-review.
- `studio/__tests__/server/figma/fidelityDirective.test.ts` (new) — 10/10 pass.
- `studio/server/middleware/chat.ts` — wires the directive into
  `enrichPromptWithFigmaContext` (gated on URL ∧ intent).
- `studio/templates/CLAUDE.md.tpl` — carve-out on the "do not verify your own
  output" rule, deferring to `<high_fidelity_mode>` when present.
- `studio/CHANGELOG.md` — 0.31.2 entry (hook fix described in product terms).
- `docs/superpowers/plans/2026-06-10-visual-verify-loop.md` — an earlier draft
  plan for the visual loop (option 1 below). Superseded in scope by this doc;
  keep or delete at will.

Full server suite green after these changes: `pnpm run studio:test __tests__/server`
→ 694 passing. Two PRE-EXISTING failures in
`__tests__/lift/shareModalLiftButton.test.tsx` (stale arcade-gen mock missing
`IconButton`/`CrossSmall`) are unrelated to this work and were left alone.

### Observed effect of the fixes (dev mode, project-1 regen, node 3532)

Hi-fi mode fired (confirmed: `high_fidelity_mode` present in transcript; 4
figmanage reads). Result vs the two prior runs: real icons, correct items, no
blank frame, no build crash — a clear step up from "blank/garbled". Remaining
misses against the reference: nested rows have `Window` icons the rendered
reference doesn't emphasize; collapse glyph is a hamburger
(`ThreeBarsHorizontal`) where the design uses a sidebar-panel glyph
(`DotInLeftWindow` exists in the kit); the footer chat button is oversized
(40px vs 28px); wordmark pill slightly narrow. I.e. "structurally right, not
pixel-perfect."

IMPORTANT caveats on these fixes:
- The hook fix (A) was validated by manually running the real hook inside the
  installed `.app` via the Electron-as-node shim → it correctly EXITED 2 and
  blocked a hallucinated import. But it is NOT yet shipped in a DMG.
- The hi-fi directive (B) was only validated in DEV (`pnpm run studio`). Dev
  always had `node`, so it cannot exercise fix A. Middleware does not hot-reload
  — testing either requires a server restart.

---

## The core tension (the thing the next session must resolve)

Studio's stated value: prototypes are built from the REAL component kit, so they
stay honest to production code and can be "lifted" into devrev-web (the
LIFT/handoff story; auto-memory `lift-manifest-consumption-tested` reports
~80% mergeable).

The designer's goal here: prototypes of NEW experiences must be **pixel-perfect**
to a Figma design.

These pull in opposite directions:
- Highest fidelity to an arbitrary Figma is most easily reached with hand-rolled
  markup (raw divs, absolute geometry) — which is throwaway, not mergeable.
- Honest-to-kit output is capped in fidelity by what the kit can express.

Two distinct JOBS hide inside "designers prototype and it must be pixel-perfect":
1. Prototype a NEW experience from an idea (Studio's core; "pixel-perfect" may
   not even apply — there's no reference).
2. Reproduce an EXISTING Figma precisely (these nav prompts; a design-to-code
   job whose accuracy is capped by kit coverage and by whether the agent can
   see/compare its output).

No decision was made on whether Studio should serve job 2 at all, or how.

---

## Option space considered (none chosen — recorded neutrally)

### Option 1 — Visual verify loop
After a hi-fi turn writes a frame: render it → show the agent its own rendered
PNG beside the reference PNG → "fix the differences" → repeat (bounded ~2×).
- Pro: the only mechanism that resolves tree-vs-render conflicts (it's how
  humans do it); pays off on every prompt; keeps the proven LIFT export
  untouched; the same render-and-look pattern Studio's 0.31.1 lift-verify
  already shipped.
- Con: a real multi-process build. Rendering infra is currently DEAD in the DMG
  (puppeteer not installed; playwright is a devDependency only; zero thumbnails
  ever produced). Needs a DMG-safe capture: Electron offscreen `BrowserWindow` +
  `capturePage()` (no new dependency) plus a new server↔Electron IPC channel
  (`electron/viteRunner.ts` currently spawns Vite with stdio only, no ipc).
  Adds ~20–60s/iteration. Dev testing of the loop needs `studio:electron`.
- De-risked this session: **font parity holds.** A rendered frame uses
  `"Chip Text Variable"` (same family as the Figma design); confirmed via a
  Playwright probe (`document.fonts` shows it loaded). So a captured screenshot
  is genuinely comparable to the reference — the agent won't chase phantom font
  diffs. (One CDN font source 403s but a fallback source loads.)
- Draft plan exists at `docs/superpowers/plans/2026-06-10-visual-verify-loop.md`.

### Option 2 — Decouple fidelity from honesty (the designer's idea)
Default output = super-high-fidelity HAND-ROLLED frame (not real components, but
visually exact). Honesty deferred to an on-demand EXPORT that produces the
LIFT-style manifest only when a designer wants to hand off.
- Pro: dissolves the core tension instead of fighting it; raises the fidelity
  ceiling (no kit-coverage cap); honesty cost is paid only at handoff.
- BLOCKER found: the current LIFT export is a SOURCE-IMPORT NAME-SWAP. It parses
  `import { NavSidebar, Button } from …` and looks each name up in a curated
  mapping table (`studio/src/lift/`). It does NOT read rendered output, DOM,
  geometry, or fiber. Hand-rolled `<div>` frames have no kit imports → empty
  manifest → export breaks entirely. So this model REQUIRES reworking the
  export pipeline.
- Possible enabler (unproven): Figma's codegen preserves component identity as
  `data-name` (`Icons/Window`, `Navigation Button`, `Computer/Logo`). If the
  generator carried that Figma component identity through as metadata, export
  could become a TRANSLATION ("this region was a `Navigation Button` → map to
  production") rather than a name-lookup. Not built, not validated.
- Blast radius: largest of all options — touches BOTH the generator's default
  output AND the shipped/tested export. Export-from-hand-rolled is unproven.

### Option 3 — Use Figma first-party codegen for fidelity
Bypass kit reconstruction; use `get_design_context` output as the frame.
- Pro: geometrically closest one-shot.
- Con: expiring asset URLs (frames break in 7 days), throwaway raw-div output,
  NOT mergeable, and still not pixel-perfect (phantom icons). Effectively
  discards everything Studio is for. Recorded for completeness; weak.

### Option 4 — Inputs-only (sharpen the directive, ship what's done)
Keep improving the hi-fi prompt; accept one-shot won't be pixel-perfect; ship
the hook fix + hi-fi mode; treat the rest as designer-iterates-in-chat.
- Pro: lowest cost; the hook fix is a genuine production bug worth shipping
  regardless of the larger direction.
- Con: asymptotic — "closer," never "right." Does not address the blind-
  generation root cause.

### Cross-cutting cheap improvement (independent of 1–4)
"Dismiss your template" was read by the agent as "hand-roll every atom from
`<div>`/`<button>`." But the Figma nav is built from DevRev design-system
components (`_Group`, `_Item` with Leading/Trailing slots) that the kit mirrors.
"Dismiss the template" arguably should mean "don't use the NavSidebar MACRO
layout" — not "rebuild the atoms by hand." Mapping instances → kit leaf
components (or at least matching exact tokens/sizes) recovers leaf-level
fidelity with zero rendering infra. Compatible with options 1, 2, or 4.

---

## Open questions for the next session

1. Should Studio serve "reproduce an existing Figma precisely" as a first-class
   job, or stay focused on "prototype a new experience" and treat exact-repro as
   out of scope / best-effort?
2. Is "pixel-perfect on first shot" even the right bar, vs "fast loop to
   pixel-perfect"? (No human one-shots a pixel-perfect copy.)
3. For option 2: can export be reworked to translate from hand-rolled frames
   carrying Figma component-identity metadata? (Load-bearing; unproven.)
4. Ship sequencing: the hook fix (A) is a clear prod bug — ship it now in 0.31.2
   regardless, or bundle with whatever larger direction wins?
5. Acceptable for dev testing to require `studio:electron` if the visual loop
   (option 1) is chosen?

## Reference: key files

- Generator spawn + hooks: `studio/server/claudeCode.ts`
- Generator spec (template): `studio/templates/CLAUDE.md.tpl`
- Figma context injection: `studio/server/middleware/chat.ts:425`,
  `studio/server/figma/promptBlock.ts`
- Hi-fi directive (new): `studio/server/figma/fidelityDirective.ts`
- Import-validation hook: `studio/server/hooks/validateArcadeImports.mjs`
- LIFT export: `studio/src/lift/` (buildManifest.ts, mappings/, render.ts),
  emitted by `studio/server/plugins/liftEmitPlugin.ts`
- Frame render route: `studio/server/plugins/frameMountPlugin.ts`
  (`/api/frames/:slug/:frame`)
- Dead thumbnail renderer: `studio/server/thumbnails/capture.ts` (puppeteer,
  uninstalled)
- Electron PATH/spawn: `electron/main.ts`, `electron/viteRunner.ts`,
  `electron/bin/figmanage` (the Electron-as-node shim pattern)
- Relevant auto-memories: `import-hook-dead-in-dmg`,
  `lift-manifest-consumption-tested`, `studio-generation-model-default`,
  `feedback_scalable_accuracy`, `figma-export-fiber-walk-pipeline`
