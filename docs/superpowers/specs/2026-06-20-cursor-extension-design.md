# Arcade Studio as a Cursor / VS Code Extension — Design

**Date:** 2026-06-20
**Status:** Approved design, pre-implementation
**Author:** brainstorming session

## Problem

The top churn reason among Arcade Studio beta users, in their words: *"I don't have time to
learn a new tool."* Studio is simple, but it is still a *new* app — a barrier. Designers already
prototype inside Cursor (primarily via Cursor's built-in AI chat). We want to meet them where
they already are by delivering Studio's value as a Cursor / VS Code extension.

The value we are porting is **not** Studio's UI. It is Studio's **DevRev design-system fidelity**:
the generator (claude CLI + `prototype-kit` + arcade-gen + the DS-fidelity instructions) that turns
a sentence into a React frame that looks like real DevRev product UI.

## Goal

Ship a VS Code extension (installs in both Cursor and VS Code) that gives designers Studio-level
prototype generation **inside their editor**, with no separate app to learn.

## Scope

### In scope (v1)
- **DS fidelity** — Cursor/VS Code generates frames at Studio-level quality, using our own engine
  (claude CLI + prototype-kit + DS instructions). The core value.
- **Figma import** — paste a Figma URL → import the screen into the prototype using the kit-emit
  importer (`middleware/figma.ts`), unchanged.
- **Live preview** — frames render live in a webview iframe via Vite HMR, exactly as Studio's
  viewport grid does today.
- **macOS only** — vendored CLIs are arch-specific; matches Studio's current platform support.
- **Direct `.vsix` distribution** — hand the file to beta testers ("Install from VSIX"), mirroring
  Studio's "hand testers a DMG" model. No public marketplace listing in v1.

### Out of scope (v1)
- **Cloudflare share** — dropped. Saves the cloudflared binary (~37M) and the share Worker.
- **Auto-update** — testers reinstall the VSIX. (Future: VS Code's extension-update channel, which
  needs a marketplace listing.)
- **Linux / Windows** — needs platform-specific CLI builds. Future.
- **Production handoff is explicit** — frames live in a hidden storage dir (see below), so the LIFT
  manifest export stays an explicit "export" action, same as Studio today.

## Key decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| What "plugin" means | Full custom VS Code extension (Pencil.dev model), not bound to Cursor's proprietary chat | Unlocks reusing nearly all of Studio; runs in Cursor *and* VS Code |
| Generation engine | **Our own** — extension spawns `claude` CLI exactly like Studio | We fully control fidelity; driving Cursor's native agent can't guarantee Studio-level output |
| Frame storage | **Hidden storage dir** (`globalStorageUri`), like Studio's app-support path | "No new tool" means no file paths / kit installs / git noise for the user. We own the fragile kit environment. Frames are disposable one-offs. |
| CLI + auth | **Bundle CLI + our Bedrock**, like Studio (vendor `claude` + `awscli`, bootstrap AWS SSO) | Proven path; we cover the cost; no per-user setup of the binary |
| Server architecture | **Approach A — embedded localhost server** | Maximal reuse of server + shell + preview; lowest build risk |
| Panel placement | **Editor area (full tab)** | Viewport grid needs width; closest to Studio's spacious layout |
| Code strategy | **Shared core, two shells** | One fidelity engine; Electron host + extension host both consume it; no double-porting of fixes |
| Vite mode | **Dev-mode Vite, like Studio** | Max reuse, zero new build pipeline, identical fidelity, frame-preview HMR comes free |

## Architecture (Approach A)

```
Cursor / VS Code window
├── Extension Host (Node process)
│     • on activate: bootstrap AWS profile → spawn Studio Vite middleware server on a free port
│     • owns: claude CLI subprocess, figma import, AWS SSO bootstrap, frame dir
│     • bundles: claude binary + awscli (vendored, macOS)
│
└── Webview Panel ("Arcade")  ← full editor tab
      • loads http://localhost:PORT  (the Studio React shell, near-unchanged)
      • chat pane + viewport grid + settings; talks /api/* + SSE as today
      • live preview iframe = Vite HMR of frames, identical to Studio
```

The insight: Electron's job was only "boot Vite + show a window." The extension host does the same
job, minus the window chrome. Studio's fidelity guts ride along untouched.

### Reuse vs. new

| Piece | Source | Change |
|---|---|---|
| Vite middleware server (`studio/server/`) | Studio | ~as-is; port becomes dynamic |
| React shell (`studio/src/`) | Studio | ~as-is; relative `/api/*` already works |
| Frame gen (claude CLI + prototype-kit + DS instructions) | Studio | unchanged — the fidelity core |
| Figma import (`middleware/figma.ts` + `figmaCli.ts`) | Studio | unchanged; depends on vendored `figmanage` on PATH |
| Preview (Vite HMR → iframe) | Studio | unchanged |
| Parser (`streamJson.ts`), auth gate, throttle handling | Studio | unchanged |
| **Extension host shim (`extension/extension.ts`)** | **new** | spawns server, opens webview, lifecycle |
| **VSIX packaging** | **new** (replaces electron-builder) | vendors CLIs, bundles built shell + node_modules |
| Electron main / updater / Cloudflare share / Worker | Studio | **dropped** for v1 |

### Shared-core boundary

The seam already exists: Electron only calls `startVite(appRoot)` then points a window at the URL.
Make the contract explicit.

```
core (shared, unchanged fidelity engine)
  studio/server/        middleware, claude spawn, figma, frames
  studio/src/           React shell (relative /api/*, portable)
  studio/prototype-kit/ + arcade-gen   ← the fidelity payload
  studio/vite.config.ts

host adapters (thin, per-target)
  electron/    main.ts + viteRunner.ts  → desktop .dmg   (exists today)
  extension/   extension.ts             → VSIX           (new; ~mirrors viteRunner)
```

Both hosts do the same three things: bootstrap the AWS profile, `startVite` (dynamic port), show a
surface at the resulting URL. `extension.ts` is essentially `main.ts` + `viteRunner.ts` minus window
chrome. Fidelity fixes land in core → both shells inherit them.

**Refactor needed now (small, mechanical):**
- Extract `startVite` so it accepts a **port argument** (today it hardcodes 5556 with `strictPort`).
- Share `bootstrapAwsProfile()` between `electron/main.ts` and `extension/extension.ts`.

## Lifecycle (extension shim)

**Activation** (designer runs "Arcade: Open" / opens the panel):
1. `bootstrapAwsProfile()` — ported from `electron/main.ts`; writes `[profile dev]` if missing, sets
   `AWS_PROFILE=dev`. Idempotent; never clobbers a customized profile.
2. Pick a free port; spawn the Vite middleware server as a child via `process.execPath` (the
   extension host *is* Node — no `ELECTRON_RUN_AS_NODE` needed). Inject the same env Studio injects,
   with `PATH` pointed at the vendored `claude`, `awscli`, and `figmanage`.
3. Wait for server health (`/api/version` 200), then create the webview panel and load
   `http://localhost:PORT`.
4. Webview CSP allows `http://localhost:PORT` and its `ws://` (Vite HMR).

**Singleton:** one server per window. Opening the panel twice reuses the running server.

**Auth gate:** reuse the shell's `StartupAuthGate` / `AuthExpiredNotice` unchanged — already wired to
the `/api/awsLogin` flow. SSO login opens a browser tab; works from the extension host.

**Crash / restart:** if the Vite child dies, show a "Reload Arcade" action that re-runs activation.

**Deactivation / window close:** kill the Vite child, free the port.

**The `node` trap:** Studio's write-hooks died in the DMG because they spawned bare `node` (exit 127;
see memory `studio-hooks-node-not-found-dmg`). In the extension, reuse `process.execPath` for any
hook/subprocess. Carry the fix forward; do not regress.

## Data flow (one turn, end to end)

```
designer types in webview chat
  → POST /api/chat {slug, prompt, images}        (relative URL → localhost server)
  → server spawns claude CLI in frame dir
      • DS-fidelity instructions + prototype-kit + KIT-MANIFEST in context
      • (figma URL? → middleware/figma.ts import first, seeds DESIGN.md)
  → claude writes React frame to hidden frame dir (extension globalStorageUri)
  → Vite HMR detects file → reloads preview iframe in webview
  → SSE /api/chat/stream/:slug replays "Thinking…" + result to chat pane
```

Identical to Studio. Only the outer container changed (webview tab vs. browser tab).

## Packaging (replaces electron-builder)

`vsce package` produces a `.vsix` instead of electron-builder producing a `.dmg`.

**Contents of the VSIX:**
- The Studio React shell + server (`studio/` source), run in **dev-mode Vite** (matches Studio
  exactly). Carries the **repo-root** `node_modules` + the dev server. Note: there is no
  `studio/package.json` — all deps (vite, react, etc.) and the version (root `package.json#version`)
  live at the repo root; `studio/` is source that the root toolchain builds.
- `prototype-kit` **dist** + arcade-gen — the fidelity payload. Must ship built; stale dist surfaces
  as "Element type is invalid" (memory `prototype-kit-dist-vite-cache`).
- Vendored CLIs as bundled resources (macOS): `claude` binary, `awscli` (~217M), and **`figmanage`**
  (npm package + a shell wrapper; required by the in-scope Figma import). `cloudflared` dropped
  (−37M, share is out of scope).
  - **figmanage wrapper is VSIX-native, not the desktop one.** Studio's wrapper (`electron/bin/figmanage`)
    `exec`s the Electron `.app` binary (`Contents/MacOS/Arcade Studio`) — which does **not** exist in a
    VSIX. The packaging step writes a replacement wrapper that runs figmanage's JS entry
    (`node_modules/figmanage/dist/index.js`) via the **host editor's** node binary
    (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`, passed as `ARCADE_NODE_BIN`). Verified by the
    Gatekeeper spike: figmanage runs fine under plain node. This is the `process.execPath` rule
    (Global Constraints) applied to the third binary.
  - **Gatekeeper:** spike verdict **GO without quarantine-stripping** — `claude` and `aws` are
    Developer-ID signed (Anthropic / Amazon), so macOS runs them even with the download quarantine
    xattr. No per-binary notarization or activation-time `xattr` strip needed.

**Build pipeline:** the prereq chain from `studio:pack` carries over unchanged — assets → templates →
`kit:build` → `fetch-cli-deps.sh` (which vendors claude/awscli/figmanage) — then the final step swaps
`electron-builder` for `vsce package`. A new script (e.g. `studio:pack-vsix`) mirrors `studio:pack`
with that one substitution.

**Size:** ~200M+ VSIX. Allowed for side-loaded `.vsix` (no hard limit). Not listed on the public
marketplace in v1 — distribute the file directly to beta testers.

**Version flow:** keep the single source of truth — top-level `package.json#version` → VSIX manifest
+ the `/api/version` middleware response + the Settings footer. No `Info.plist`.

**Dropped from the build:** `electron/`, `electron-builder.yml`, `updater.ts`, the `release.sh`
notarize dance, the Cloudflare Worker.

## Error handling

- **Server won't boot / port held:** port-reclaim logic ported from `viteRunner.ts`; if reclaim
  fails, webview shows "Reload Arcade."
- **Vite child dies mid-session:** detect exit → "Reload Arcade" action.
- **AWS auth expired:** reuse `AuthExpiredNotice` + `StartupAuthGate`, unchanged.
- **Bedrock throttle / `is_error`-on-success:** parser (`streamJson.ts`) already handles both;
  unchanged.
- **Bundled CLI blocked by Gatekeeper:** see Risks #1.

## Testing

- **Reuse the full vitest suite** — core is shared, so all existing tests still guard
  fidelity / parser / middleware behavior.
- **New: extension-host smoke test** — activate → server boots → `/api/version` 200 → webview URL
  resolves. Config-shape discipline like `packaging/scaffold.test.ts` (no full build).
- **Manual gate (non-negotiable):** test the **packaged VSIX** in real Cursor *and* real VS Code, not
  dev mode. Studio's recurring lesson — hooks/imports die only in the packaged artifact (memories
  `studio-hooks-node-not-found-dmg`, `import-hook-dead-in-dmg`). The same trap awaits the VSIX.

## Risks / spikes (ranked, do before building)

1. **Gatekeeper on vendored binaries** — ✅ **RESOLVED (GO).** Spike (`docs/superpowers/scratch/2026-06-20-gatekeeper-spike-finding.md`)
   confirmed `claude` + `aws` are Developer-ID signed and execute from a quarantined side-load dir
   with no strip needed. figmanage runs fine under plain node (drives the VSIX-native wrapper above).
   No per-binary notarization required.
2. **VSIX size** — verify `vsce package` + side-load works at 200M+.
3. **Dynamic port + multi-window** — verify port-pick + reclaim correctness with two windows open.
4. **Webview CSP** — confirm `http://localhost:PORT` + `ws://` HMR is permitted in a webview.

## Open questions / future

- Linux / Windows support (platform CLI builds).
- Auto-update via marketplace listing.
- Re-introducing Cloudflare share once core proves out.
- Whether the extension eventually *replaces* the standalone `.dmg` (decided against for now —
  "shared core, two shells" keeps both alive).
