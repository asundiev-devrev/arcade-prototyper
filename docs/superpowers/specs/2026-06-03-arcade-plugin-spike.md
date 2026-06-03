# Arcade-as-Computer-plugin — de-risk spike

> **Status:** spike spec (throwaway code, no production commits). Companion to
> `2026-06-02-distributing-arcade-via-skill-publisher.md` (Option C). Goal: find
> out, with the least code, whether the plugin path "has legs" before anyone
> commits to it.

## The one question this spike answers

**Can a standalone Computer desktop plugin (Electron app) both (1) run our arcade
compiler and (2) render the resulting interactive prototype — on a normal Mac, no
core-Computer-team changes?**

If yes → Option C is real, and Arcade-in-Computer can ship without the core team.
If no → fall back to hosted sidecar (B) + the core-team conversation.

Everything else about Option C (distribution to other users, Applied AI support,
polish) is downstream of this. Don't touch it until this passes.

## Why this is the crux

Our compiler (`studio/server/cloudflare/bundler.ts` → `buildFrameBundle`, wrapped
by `packFromSource`) pulls **heavy, partly-native** dependencies:

- `esbuild` (native binary)
- `@tailwindcss/node` + `@tailwindcss/oxide` (Tailwind v4; oxide is a native Rust addon)
- `@xorkavi/arcade-gen` (the component kit) + font fetching

The plugin builder's own examples (`execution-graph`) are **light** — Electron +
nothing else. Nobody has run a toolchain this heavy inside one of these plugins.
The native bits (oxide, esbuild) are the risk: they must resolve against the
plugin's Electron/Node, not a system Node. That's the thing the spike proves.

## Pre-reqs (have these ready, don't build them)

- `packFromSource` already works in this repo (proven; `studio/server/sidecar/`).
- The plugin builder SKILL.md + reference plugin are cloned for reference:
  `devrev/aai-custom-computer-capabilities` → `3-computer-capabilities-nxt/`
  (`plugin-builder/SKILL.md`, `execution-graph/scripts/`).
- A Mac with Computer desktop installed (for the later bridge step only).

## Spike stages — stop at the first failure, report, don't push through

### Stage 0 — Does the compiler even run outside Studio's Vite? (fastest, do first)

The cheapest possible check, no Electron yet. Run `packFromSource` from a bare
Node script in a scratch dir that has ONLY the sidecar deps installed (esbuild,
@tailwindcss/node, @tailwindcss/oxide, the kit) — NOT the full studio dev
environment.

- **Pass:** emits the self-contained HTML (same as the sidecar test).
- **Fail:** missing-dep / native-resolve error → tells us exactly which dep is the
  problem before we add Electron's complexity. Record the error verbatim.

> This isolates "does the packer stand alone" from "does it stand alone *inside
> Electron*." If Stage 0 fails, Stage 1 can't pass — fix or report here.

#### Stage 0 RESULT (run 2026-06-03): PASS, with two findings

- **Core pass:** `packFromSource` runs under plain Node (via `tsx`, no Vite) and
  emits valid self-contained HTML in ~390ms. The compiler does **not** depend on
  Vite — foundational risk cleared.
- **Finding 1 — the kit is private.** `@xorkavi/arcade-gen` is **not** on public
  npm; it's on **GitHub Packages** (`@xorkavi:registry=https://npm.pkg.github.com`,
  token-gated). A clean `npm install` 404s without an `.npmrc` + a packages token.
  → Any plugin bundling the compiler needs **private-registry credentials at build
  time**, and the install can't run on an arbitrary machine without them. Also note
  a version trap: `^1.0.0` floats up to `1.1.1` which requires **React 19**; the
  working repo pins `1.0.0` + React 18 — pin exact to reproduce.
- **Finding 2 — the compiler reads Studio *source*, not just packages.**
  `buildFrameBundle` reads three paths from the live repo tree, resolved relative
  to its own file location:
  - `studio/prototype-kit/` (composites/templates + `arcade-components.tsx` shim)
  - `studio/src/styles/` (`tailwind.css` entry + `arcade-gen-patches.css`)
  - `<repo>/node_modules` (for esbuild's resolution + `nodePaths` fallback)
  → A portable bundle must **carry these source slices**, not just `node_modules`.
  The real Option-C task is therefore: *package compiler + private-registry auth +
  Studio source slices into a portable bundle* — a build-engineering job, bigger
  than "drop the compiler in a plugin," but tractable.

**Implication for Stage 1:** the in-Electron test must reproduce the isolated env
(GH-packages `.npmrc` + token, exact kit `1.0.0`, React 18) AND point the bundler
at the carried source slices (or run it against a copy of the repo tree). The
native-ABI question (oxide/esbuild under Electron) is unchanged and remains the gate.

### Stage 1 — Compiler inside Electron's runtime (THE decisive stage)

Scaffold a throwaway Electron app (copy the shape from `execution-graph/scripts/`:
`package.json`, `main.js`). Add the sidecar deps to its `package.json`. In the
Electron **main** process, on launch, call `packFromSource` with a hardcoded test
frame and write the HTML to disk.

The risk concentrated here: **native modules (oxide, esbuild) must load under
Electron's Node ABI**, which differs from system Node. This commonly needs an
`electron-rebuild` step or prebuilt binaries.

- **Pass:** Electron main produces the packed HTML. → the compiler lives in a
  plugin. Biggest unknown cleared.
- **Fail (native ABI):** record the exact module + error. Mitigations to note (do
  NOT chase now): `electron-rebuild`, or run the compiler in a bundled system-Node
  **child process** the plugin spawns (the SKILL.md shows plugins use
  `child_process` freely — this is a viable fallback and arguably cleaner: the
  plugin owns a little Node sidecar process, not in-Electron compilation).

### Stage 2 — Render the prototype in the plugin window

Point the Electron `BrowserWindow` at the HTML from Stage 1 (the **interactive**
variant — run it through `make-interactive.mjs` first, as the real flow does).
Confirm it renders full-size with the arcade styling + the Annotate/View comment
bar, and that a comment can be typed + committed (we already proved the comment
composer works under a plain sandbox; here it's an Electron window, *more*
permissive, so this should be strictly easier).

- **Pass:** the full prototype + comment bar render and accept a comment in the
  plugin's own window. → Option C bypasses the read-only canvas entirely.
- **Fail:** note what broke (likely nothing — Electron windows are more capable
  than the canvas sandbox, not less).

### Stage 3 — Bridge a comment back to Computer (proves the loop, lowest priority)

Use the documented file bridge (`~/.devrev/panel-bridge/` + `emit.js`) + the
`postToComputer` flow from the SKILL.md to send a "regenerate with this comment"
message into Computer's chat. This is the only stage that needs Computer running.

- **Pass:** a comment from the plugin lands as a message in Computer → the
  comment→regenerate loop is real end-to-end, plugin-hosted.
- **Fail:** the render+compile still stand (Stages 1–2); the bridge is a known,
  documented mechanism — treat a failure here as wiring, not architecture.

## Gate

**Stage 1 is the gate.** If the compiler runs in (or beside, via child process)
the plugin, Option C has legs and is worth a real plan. Stages 2–3 are
high-confidence follow-through. If Stage 1 can't be made to pass even with the
child-process fallback, Option C is dead and we're back to hosted-sidecar (B).

## What this spike does NOT cover (deliberately)

- Distribution of a built plugin to other people (open question 6 in the dist doc).
- Applied AI team's willingness to support a heavy-toolchain plugin (open q 7).
- Cross-platform (plugins are macOS-only; fine for internal beta).
- Polish, packaging, auto-update, the kit-update story.

These only matter if the gate passes. Don't pre-solve them.

## Effort estimate

- Stage 0: ~30 min (bare Node script + a scratch `npm install`).
- Stage 1: ~half a day (scaffold Electron, wrestle native deps — the rebuild/
  child-process fork is where time goes).
- Stage 2: ~1–2 hours (point a window at a file).
- Stage 3: ~half a day (bridge wiring, needs Computer running).

Stages 0–1 alone (≈ one focused day) answer "does it have legs." Do those, report,
then decide on 2–3.
