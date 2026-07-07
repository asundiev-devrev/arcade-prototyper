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

## Decisions (from brainstorm + adversarial review)

- **Update arrival:** *Notify, tester chooses.* No silent download-and-restart.
  A prompt appears; the tester clicks "Install & restart" when ready.
- **Bad-build recovery:** *Visible failure + fast forward-hotfix + manual .dmg
  fallback.* If a freshly-installed build fails to boot, Studio shows a clear
  error screen (never a silent hang), pointing at the log and offering Quit. We
  recover by shipping a forward hotfix (this team's routine practice — 0.26.1,
  0.31.2, 0.34→0.36) and, for anyone already stranded, a manual .dmg re-download
  link posted to the tester channel.

  **Why not auto-roll-back (the original brainstorm choice):** an adversarial
  review of this spec (2026-07-07) established it is unsound for a signed macOS
  app and buys little here. Confirmed from the shipped code + platform facts:
  (1) `electron-updater@6.8.3` has **no rollback primitive** — its macOS
  Squirrel install overwrites `/Applications/Arcade Studio.app` in place, so the
  previous bundle is gone from disk; restoring requires proactively retaining a
  full **~1.1 GB** copy (asar is disabled → `node_modules` ships uncompressed)
  on every stable boot. (2) Hand-restoring a hardened-runtime, notarized,
  stapled bundle risks the "app is damaged" Gatekeeper failure this team already
  has scars from (memory `studio-dmg-notarize-both-artifacts`). (3) The revert
  logic would live *inside* the new version, so it only runs when the new
  version boots far enough to run it — it guards against "main boots, Vite dies"
  (today's bug) but not against a worse future build; it protects against the
  last war. (4) A slow-but-healthy boot could trip a health-check timeout and
  false-revert a good update, silently pinning the tester to the old version.
  Roll-back only wins when you can't ship a forward fix fast — and this team
  can. Visible-failure + fast-hotfix delivers the real goal ("a tester is never
  stranded on a frozen, silent app") without ever swapping a signed bundle.

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

### 1b. Guard against missing runtime deps — two layers

The failure class is "present in the repo, **absent from the packaged `.app`**"
(electron-builder prunes devDeps; pnpm's symlinked store makes the gap invisible
in dev). A `package.json`-only assertion proves *intent* but never proves the
`.app` actually bundled the dep — the layer where the bug lived. So two tests,
per the adversarial review (Finding 6):

- **Layer 1 — cheap config-shape guard (in `studio:test`).** Under
  `studio/__tests__/packaging/`, statically enumerate the packages imported at
  runtime by server code reachable from `vite.config.ts` (today: `typescript`;
  derive the list rather than hardcode a single name) and assert each is in
  `dependencies`, not `devDependencies`. Mirrors `scaffold.test.ts`
  (pure config check, no build). Fast regression guard.
- **Layer 2 — real bundle check (release gate).** After `studio:pack` produces
  the `.app`, grep the packaged `node_modules` for the known runtime deps and
  fail the release if any is missing. This is the only test that actually
  catches "stripped from the bundle" — the exact 0.42.0 failure — and honors the
  "test the `.app`, not dev" lesson (memories `studio-hooks-node-not-found-dmg`,
  `import-hook-dead-in-dmg`).

Do NOT claim class-closure from Layer 1 alone: a name-list assertion would not
have caught the earlier `react-day-picker` white-screen (memory
`arcade-gen-undeclared-deps`). Layer 2 is what closes the class.

### 1c. Replace the silent boot-failure hang with a visible failure

In `electron/main.ts`, when `startVite` rejects (Vite never came up), stop
silently retrying into a black hole (the log shows 117 attempts in a day).
Instead:

- **Main-driven auto-retry, bounded.** Main retries `startVite` at most **N (=2)**
  times with a short backoff. If a retry succeeds, `loadURL` swaps the window to
  the real app. This replaces the unbounded window-recreation loop.
- **On final failure, load a static local error page** into the BrowserWindow
  (bundled HTML asset under `electron/`, no Vite dependency) stating the app
  failed to start, showing the log path
  (`~/Library/Logs/arcade-studio-electron.log`), and offering **Quit**.
- **No "Retry" button.** Per the review (Finding 5): the window runs with
  `contextIsolation: true`, `nodeIntegration: false`, and there is **no preload
  script anywhere in `electron/`** — so a static page has no channel to call back
  into main. Quit is free (`window.close()` → `window-all-closed` → `app.quit()`).
  Retry is handled by MAIN's automatic backoff above, not a renderer button, so
  no IPC/preload bridge is introduced. (If a manual Retry button is ever wanted,
  it must be scoped as a separate preload/`contextBridge` deliverable — out of
  scope here.)
- This is purely the "stop the silent hang" safety net. It does NOT hook into any
  roll-back mechanism (there is none — see Decisions).

**Ship:** bump `package.json#version` to `0.42.1`, add `studio/CHANGELOG.md`
entry, run `studio:test`, package a real DMG, and cut the release via
`studio/packaging/scripts/release.sh` (notarize both artifacts — see memory
`studio-dmg-notarize-both-artifacts`).

**Reaching already-broken 0.42.0 installs (per Finding 4).** Auto-update may NOT
reliably self-heal 0.42.0 → 0.42.1: a tester on the broken build sees a blank
window and likely force-quits within seconds, so the background download never
finishes and `autoInstallOnAppQuit` has nothing to install. (Mechanically the
path exists — main survives the Vite crash, `autoDownload` fetches, install
happens on quit — but it's a patience gamble, and 1c's error screen ships IN
0.42.1, not in the broken 0.42.0.) Therefore **0.42.1 MUST be published as a
manual `.dmg` link to the tester channel**, not only via the auto-updater. This
is the reliable path for anyone already stranded.

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

### 2b. Bad-build recovery — visible failure, not roll-back

There is **no auto-roll-back** (rationale in Decisions). Recovery is the
combination already specified plus a documented process:

- **Visible failure (Piece 1c)** guarantees a stranded tester sees a clear error
  screen + log path + Quit, never a silent frozen window. This is the single
  behavioral change that delivers "never stranded on a frozen app."
- **Fast forward-hotfix** is the recovery path for the bad build itself — the
  team's routine practice. Requires the Piece 1b Layer-2 bundle check to run in
  the release gate so a boot-breaking packaging regression is caught *before*
  publish, not by testers.
- **Manual `.dmg` fallback** (Finding 4): every release is also posted as a
  direct `.dmg` link to the tester channel, so anyone whose auto-update can't
  self-heal (e.g. stuck on a build that won't boot) has a reliable manual path.

**Runbook (document in `studio/CLAUDE.md` release section):** on a bad-build
report — (1) confirm via `~/Library/Logs/arcade-studio-electron.log`, (2) fix
forward, (3) `release.sh` (Layer-2 gate must pass), (4) post the manual `.dmg`
link to testers alongside the auto-update publish.

## Interfaces / units (for the plan to break down)

- **`electron/main.ts`** — bounded (N=2) `startVite` retries with backoff;
  on final failure `loadURL` the static error page; on retry success `loadURL`
  the real app. No IPC/preload added.
- **static error page** — bundled HTML asset, Vite-independent (new file under
  `electron/`); informational + Quit only (no Retry button — no preload exists).
- **`electron/updater.ts`** — notify-first: keep `autoDownload`, DROP
  auto-apply-on-idle as the default; on `update-downloaded` expose
  pending-update state instead of calling `applyWhenIdle`; add an
  install-on-demand entry point invoked by the shell's "Install & restart".
  Retain `shouldApplyUpdate` loop-guard + `appIsInstallable` translocation notice.
- **new pure module** (electron-free, vitest-able, mirrors `applyDecision.ts`) —
  if any non-trivial decision logic remains (e.g. gating install-on-demand behind
  turn-active defer), keep it here so it's unit-testable; otherwise the notify
  path is thin enough to live in `updater.ts`. (No roll-back decision module —
  that mechanism is cut.)
- **shell UI** — "Update available — vX.Y.Z" prompt (Install & restart / Later)
  + "Updating…" state; consumes update status via the reused localhost/polling
  channel.
- **update-status transport** — main holds updater state; expose to the shell via
  a localhost endpoint the shell already polls (mirror `/api/version` /
  `/api/turns/active`), e.g. `/api/update/status`. Reuse the established pattern;
  do not invent a new channel shape.
- **packaging tests** — Piece 1b Layer 1 (config-shape, in `studio:test`) +
  Layer 2 (packaged-`.app` bundle grep, release gate).

## Testing strategy

- **Unit (in `studio:test`):** Piece 1b Layer-1 config-shape guard; bounded
  boot-retry logic; any extracted notify/defer decision (pure module).
- **The hard, adversarial gate (do NOT eyeball-only):** deliberately package a
  **known-broken build** (e.g. one with `typescript` stripped again) and confirm
  end-to-end that Studio (a) attempts N bounded retries then (b) shows the
  visible error screen instead of hanging, and (c) Quit exits cleanly. A passing
  screenshot of a *working* update proves nothing about the failure path.
- **False-recovery guard (Finding 3):** also test a **slow-but-healthy** boot
  (simulate the viteRunner port-reclaim / near-30s startup path) and confirm the
  bounded retry does NOT prematurely give up on a good build. (No revert exists
  to false-trigger, but the retry bound must still tolerate legitimate slow boots.)
- **Layer-2 bundle check runs at release** against the real packaged `.app`.
- **Real N→N+1 live update** through the mirror repo, as done for 0.34→0.36, to
  confirm the notify-first prompt + install-on-demand path works against real
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
