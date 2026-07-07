# Arcade Studio — Update experience redesign + 0.42.0 boot hotfix

**Date:** 2026-07-07
**Status:** Approved (brainstorm), pending spec review
**Author:** Andrey + Claude

## Problem

Beta testers experience the version-update flow as "the app crashes, hangs for a
long while in the background as if broken, then may or may not relaunch on the
new version." One tester's (the author's) current 0.42.0 install does not open
at all.

### Root cause (diagnosed from `~/Library/Logs/arcade-studio-electron.log`)

The shipped **0.42.0 build cannot boot**, and the auto-updater faithfully
delivered that broken build. Two compounding layers:

1. **The build is broken — missing runtime dependency.**
   `studio/server/codeWriter/*.ts` (index, kitProps, reorder, locateJsx,
   patchSource) `import ts from "typescript"` at module top-level. Those modules
   are statically imported by live middleware
   (`studio/server/middleware/visualEdit.ts`, `kitProps.ts`), which
   `studio/vite.config.ts` imports at config-load time. So loading the Vite
   config eagerly requires `typescript`.

   `typescript` is a **devDependency** in the root `package.json`.
   `electron-builder.yml` bundles `node_modules/**/*` but the packaged app's
   `node_modules/typescript` is **absent** (verified: `MISSING` in the installed
   app). Vite crashes at config load with
   `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'`, exits code 1, and
   never serves `localhost:5556`. The BrowserWindow has nothing to load.

   Regression window: the `codeWriter` runtime reach landed with the
   canvas-editing work (`visualEdit` middleware, commits `f1c04f7` /
   `6b2fddc`); the `typescript` top-level import came in with the same effort
   (`30da577`, `3078782`). The canvas-editing *feature* was later parked
   (`b8cb015`) but the middleware → codeWriter → `typescript` import chain
   remained live, so the dead dependency shipped in 0.42.0.

2. **The failure is invisible and self-perpetuating.**
   `electron/main.ts` `app.on("activate")` / window recreation plus repeated
   `createWindow()` calls re-run `startVite`, which dies the same way every
   time. The log shows **117 `startVite begin` attempts in one day**. Nothing
   surfaces to the user — no error window, no notice. It reads as a frozen /
   broken app.

### Secondary (follow-up, NOT in scope)

The log also warns: `You are using Node.js 20.18.3. Vite requires Node.js
version 20.19+ or 22.12+`. This is a warning, not the crash cause (Vite still
started parsing the config before dying on the missing module). Tracked as a
follow-up engine bump, deliberately excluded here to keep the hotfix small.

## Decisions (from brainstorm)

- **Update arrival:** *Notify, tester chooses.* No silent download-and-restart.
  A prompt appears; the tester clicks "Install & restart" when ready.
- **Bad-build recovery:** *Auto-roll-back + notice.* If a freshly-installed
  build fails to boot, Studio restores the previous working version, relaunches,
  and tells the tester what happened.

## Scope split

Two independently shippable pieces. Piece 1 unblocks the dead install
immediately; Piece 2 is the experience redesign.

---

## Piece 1 — Hotfix the broken build (ship as 0.42.1)

Three root-cause changes.

### 1a. Ship the missing runtime dependency

Move `typescript` from `devDependencies` to `dependencies` in the root
`package.json`. It is genuinely required at runtime by the visual-edit / kit-prop
middleware path, so it must be in the production dependency set that
electron-builder bundles.

**Rationale over alternatives:** we could instead make the `codeWriter` imports
dynamic / lazy so the config load doesn't pull `typescript` unless a visual-edit
request actually fires — but that only defers the same crash to the first
visual-edit call, and the feature legitimately needs the library. Bundling it is
the correct fix. (A lazy-import refinement can be a later optimization to trim
bundle weight; not required for correctness.)

### 1b. Build-time guard against missing runtime deps

Add a packaging test under `studio/__tests__/packaging/` that fails the build if
a package imported at runtime by server code is not present in the production
dependency set (`dependencies`, not `devDependencies`).

- Minimal, deterministic form: assert that the specific known runtime deps
  reachable from `vite.config.ts` server middleware (starting with `typescript`)
  are declared in `dependencies`. This mirrors the existing
  `scaffold.test.ts` "pure config check, no build" pattern.
- This closes a recurring class: a hidden/misclassified dependency white-screened
  0.34.0 before (`react-day-picker`, see memory `arcade-gen-undeclared-deps`).

### 1c. Replace the silent boot-failure hang with a visible failure

In `electron/main.ts`, when `startVite` rejects (Vite never came up), stop
silently retrying into a black hole. Instead:

- Load a **static local error page** into the BrowserWindow (bundled HTML, no
  Vite dependency) that states the app failed to start, shows the log file path
  (`~/Library/Logs/arcade-studio-electron.log`), and offers a **Retry** button
  and a **Quit** button.
- Bound automatic retries: at most **N (=2)** quick `startVite` attempts with a
  short backoff before showing the error page, rather than unbounded recreation.
- This is the "just stop the silent hang" safety net and also the surface the
  Piece 2 roll-back hooks into.

**Ship:** bump `package.json#version` to `0.42.1`, add `studio/CHANGELOG.md`
entry, run `studio:test`, package a real DMG, and cut the release via
`studio/packaging/scripts/release.sh` (notarize both artifacts — see memory
`studio-dmg-notarize-both-artifacts`).

**Interim unblock for the author (no release needed):** `pnpm run studio` from
the repo runs the working studio against the same project data. Also, the
installed app's `node_modules` is writable and copying the repo's
`node_modules/typescript` into
`/Applications/Arcade Studio.app/Contents/Resources/app/node_modules/` unblocks
that one machine — but this breaks the code signature and is a stopgap only; the
real fix is 0.42.1.

---

## Piece 2 — The new update experience

### 2a. Notify, tester chooses (replaces auto-apply)

Current `electron/updater.ts` sets `autoDownload = true`,
`autoInstallOnAppQuit = true`, and on `update-downloaded` runs a turn-aware
`applyWhenIdle` → `quitAndInstall` on its own. Change to a **notify-first** flow:

- Keep background *download* (so "Install & restart" is instant), but **never
  auto-restart**. On `update-downloaded`, surface an in-app **"Update available
  — vX.Y.Z"** prompt in the Studio shell (not just an OS notification), with
  **Install & restart** and **Later** actions.
- **Install & restart** triggers `quitAndInstall` (guarded by the existing
  turn-aware defer so an in-flight generation isn't killed) and shows a brief
  **"Updating…"** state.
- The existing loop-guard (`shouldApplyUpdate`) and translocation /
  not-installable notice (`appIsInstallable`) are retained.

**Transport:** the shell needs to learn about the pending update. Main process
holds updater state; expose it to the renderer via a localhost endpoint the shell
already polls (mirror `/api/version` / `/api/turns/active` pattern), e.g. a small
`/api/update/status` the main process feeds, or an existing IPC-less bridge
consistent with how turns are polled. Reuse the established pattern; do not invent
a new channel shape (see memory / studio conventions).

### 2b. Auto-roll-back on a bad build

The core robustness win. Before installing an update, preserve the current
working bundle; after the update, verify it actually boots; if not, restore.

- **Snapshot:** on a successful, stable boot of the *current* version, record
  it as "last known good" (LKG) — e.g. keep a copy/reference of the working
  `.app` (or its version + a restorable artifact) under the writable per-user
  storage dir (`ARCADE_STUDIO_ROOT`). Precise mechanism (retain previous DMG /
  zip payload vs. copy the bundle) decided in the plan; constraint: restore must
  work without network and without re-notarization surprises.
- **Post-update health check:** after an update installs and relaunches, the new
  version must reach a "booted OK" checkpoint (Vite served + window loaded)
  within a timeout. Record success → new LKG.
- **Failure → revert:** if the new version hits the Piece 1c boot-failure path
  (Vite never serves) or fails the health check within the timeout, Studio
  **automatically restores the LKG version, relaunches it, and shows a notice**:
  *"That update didn't start correctly — restored your previous version."*
- **Guard against revert loops:** a restored version must not immediately try to
  re-apply the same failed update. Track the failed target version and suppress
  re-applying it (analogous to the existing `shouldApplyUpdate` loop guard);
  require the tester's explicit "Install & restart" to retry, or a newer version.

## Interfaces / units (for the plan to break down)

- **`electron/main.ts`** — bounded boot retries; static error page load on
  failure; boot-OK checkpoint signal for health check.
- **static error page** — bundled HTML asset, Vite-independent (new file under
  `electron/`).
- **`electron/updater.ts`** — notify-first (drop auto-apply-on-idle as the
  default path); expose pending-update state; install-on-demand; drive
  snapshot / health-check / revert.
- **new pure module** (electron-free, vitest-able, mirrors `applyDecision.ts`) —
  roll-back decision logic: given (current version, failed target, LKG present?)
  → {install | revert | block-retry}. Keep Electron glue thin around it.
- **shell UI** — "Update available" prompt + "Updating…" + "restored previous
  version" notice; consumes update status via the reused localhost/polling
  channel.
- **packaging test** — Piece 1b runtime-dependency guard.

## Testing strategy

- **Piece 1b guard + roll-back decision module + boot-retry bound:** unit tests
  (pure modules; `packaging/` config-shape test), run in `studio:test`.
- **The hard, adversarial gate (do NOT eyeball-only):** deliberately package a
  **known-broken build** (e.g. one with `typescript` stripped again) and confirm
  end-to-end that Studio (a) shows the visible failure instead of hanging, and
  (b) under Piece 2, auto-restores the previous version and shows the notice.
  This is the acceptance test for the whole effort — a passing screenshot of a
  *working* update proves nothing about the failure path.
- **Real N→N+1 live update** through the mirror repo, as done for 0.34→0.35→0.36,
  to confirm the notify-first prompt + on-demand install path works against real
  GitHub Releases + notarized artifacts.

## Out of scope

- Node engine bump for the Vite version warning (follow-up).
- Reviving the parked canvas-editing feature (unrelated; its middleware is what
  surfaced the dep, but we fix the dep, not the feature).
- Windows/Linux update paths (macOS-only product).

## Related memory

- `studio-auto-update` — how the current updater + release.sh work; restart-loop
  history and the `shouldApplyUpdate` / `appIsInstallable` guards.
- `arcade-gen-undeclared-deps` — prior white-screen from a misclassified runtime
  dep; motivates Piece 1b.
- `studio-dmg-notarize-both-artifacts` — release notarization requirement.
- `studio-hooks-node-not-found-dmg`, `import-hook-dead-in-dmg` — prior
  "works in dev, dead in DMG" class; test the `.app`, not dev.
