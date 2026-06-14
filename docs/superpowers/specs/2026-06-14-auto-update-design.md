# Spec: In-app auto-update for Arcade Studio

**Date:** 2026-06-14
**Status:** Design approved; ready for implementation plan.
**Goal:** Remove the manual "download a new .dmg and replace the old app" burden.
Beta testers should get a new version applied automatically — the standard
macOS auto-update experience — instead of re-installing by hand.

---

## Problem

A working Electron auto-updater ALREADY exists (`electron/updater.ts`:
`electron-updater` with `autoDownload` + `autoInstallOnAppQuit` + a native
"Quit and install" dialog, wired into `electron/main.ts:203`). It is **dormant**
for three reasons:

1. **No update payload.** The mac build (`electron-builder.yml`) emits only a
   `.dmg`. electron-updater applies updates from a `.zip` + a `latest-mac.yml`
   manifest, neither of which is produced.
2. **The release flow doesn't publish them.** Releases are cut by hand
   (`gh release create` per `studio/CLAUDE.md`) and upload only the dmg.
3. **A competing manual path masks the gap.** `studio/src/components/feedback/
   UpdateBanner.tsx` polls `/api/version/check` and shows a "Download" link that
   opens the dmg in a browser for **manual** install — its own comment says
   "user still installs manually … revisit in-app install later." This is the
   burden users actually hit.

So the work is "make the dormant updater real + remove the manual path," not
"build an updater from scratch." Approach chosen: **revive electron-updater**
(the macOS standard, already a dependency) over a custom updater or Sparkle.

## Owner decisions (locked)

- **Update prompt:** native macOS dialog (reuse the one in updater.ts) — no new
  in-app branded modal.
- **Apply timing:** download AND apply automatically (not "prompt then wait").
- **Restart:** applying an Electron update REQUIRES an app restart (it can't
  swap itself while running). Restart automatically, BUT defer the restart while
  a generation turn is in progress so no active work is destroyed.
- **Release flow:** a single scripted release command (not extended manual steps,
  not CI yet).
- **Old banner:** remove it entirely (delete component + `/api/version/check`
  backend). Keep `/api/version` (Settings footer uses it).

---

## Architecture

Three independent units:

### 1. Build & release pipeline

**`electron-builder.yml`** — add a `zip` target to the mac block beside `dmg`:
```yaml
mac:
  target:
    - target: dmg     # human first-install (unchanged)
      arch: arm64
    - target: zip     # auto-update payload — electron-updater reads this
      arch: arm64
```
electron-builder then auto-generates `latest-mac.yml` (version, zip filename,
sha512, size) at pack time.

**`studio/packaging/scripts/release.sh`** (new) — replaces the hand-typed
notarize/staple/rewrap/upload dance in `studio/CLAUDE.md`:
1. `studio:pack` → dmg + zip + `latest-mac.yml` in repo-root `dist/`.
2. Notarize BOTH dmg and zip (`xcrun notarytool submit … --keychain-profile
   arcade-studio-notarize --wait`).
3. Ensure the `.app` is stapled BEFORE the zip is created (Gatekeeper checks the
   extracted app's stapled ticket; a zip itself can't be stapled). If
   electron-builder doesn't staple-then-zip automatically, the script staples
   the `.app` and re-zips. **Verify on first real pack.**
4. `gh release create v$VERSION` to the mirror `asundiev-devrev/
   arcade-studio-releases`, uploading **all three**: dmg, zip, `latest-mac.yml`.

**Correctness invariant:** `latest-mac.yml`'s `sha512` MUST match the uploaded
zip byte-for-byte, or electron-updater rejects the download. Scripting
guarantees manifest + zip come from the same pack run — the manual path cannot.

### 2. Updater behavior (`electron/updater.ts`, reworked)

- Packaged only (dev = no-op, unchanged).
- `checkForUpdates()` on ready + on a ~30-min timer (long sessions still catch a
  release).
- `autoDownload = true` (unchanged). On `update-downloaded`, run the
  apply-decision instead of always showing the Later/Quit dialog:
  - Query the server "is a turn running?" (see unit 3).
  - **idle →** brief native notice ("Updating Arcade Studio to X…"), then
    `quitAndInstall()` (auto-relaunch).
  - **turn running →** hold; poll every ~15s; apply as soon as idle.
  - **defer cap (~30 min) →** fall back to `autoInstallOnAppQuit` so the update
    is never lost to an endless turn.
- `autoInstallOnAppQuit = true` stays as the backstop (quit before the deferred
  restart still applies the update).
- Errors (download/network) → log, retry next check, no user nag.

**Apply-decision is a pure function** for testability:
`decideApply({ turnActive: boolean, deferredMs: number }) → "restart" | "wait"
| "force"` — `"restart"` when idle, `"wait"` when a turn is active and under the
cap, `"force"` (fall back to on-quit) past the cap. The Electron glue (dialog,
quitAndInstall, fetch) stays thin around it.

### 3. Turn-detection endpoint (`studio/server/middleware/turns.ts`, new)

The updater runs in Electron main; the turn registry lives in the Vite server
child. They are joined by stdio pipes only — **no IPC channel exists**. Rather
than add one, the updater polls the server's existing localhost HTTP API:

`GET /api/turns/active` → `{ active: boolean }` — reads the existing turn
registry (`getTurn`, which already tracks `status === "running"` per project).
Electron main constructs `http://127.0.0.1:<vitePort>/api/turns/active` (it knows
the port — it spawned the server). Fetch failure (server down) → treat as
"safe to restart" (a dead server has no active turn).

## Data flow

```
release.sh ─pack→ dmg + zip + latest-mac.yml ─notarize both─ gh release create ─→ mirror repo
                                                                                       │
installed app (Electron main, packaged)                                                │
  ready / 30-min timer → autoUpdater.checkForUpdates() ──poll latest-mac.yml──────────┘
  update-available → autoDownload → update-downloaded
        │
        └→ decideApply: GET 127.0.0.1:<port>/api/turns/active
              idle  → notice → quitAndInstall()  (auto relaunch onto new version)
              busy  → wait 15s, re-poll … (cap 30m → autoInstallOnAppQuit backstop)
```

## Removal

- Delete `studio/src/components/feedback/UpdateBanner.tsx` + its mount in
  `studio/src/App.tsx`.
- Delete `studio/server/middleware/version.ts`'s `/api/version/check` handler
  (keep `/api/version`) + its wiring in `vite.config.ts` + its tests.
- The 0.21 Electron-migration warning in the banner is obsolete (all testers are
  well past 0.21) — drops with the banner, no replacement.

## Error handling

| Failure | Behavior |
|---|---|
| Download/network error | Log, no user nag, retry next check. |
| sha512 mismatch | electron-updater rejects; logged; user stays on current version (safe). |
| Server down when polling turns | Treat as idle → safe to restart. |
| Turn never ends | Defer cap (~30 min) → fall back to apply-on-quit. |
| Quit during deferred wait | `autoInstallOnAppQuit` applies the update. |
| Unsigned/un-notarized build | electron-updater refuses to apply (signature check) — release.sh notarizing both artifacts is what prevents this. |

## Testing

1. **Unit (CI):** `decideApply` truth table (idle→restart, busy→wait,
   past-cap→force); `/api/turns/active` (running→true, idle→false).
2. **Pack-time (manual, once):** run `release.sh` to a THROWAWAY test release;
   confirm dmg + zip + `latest-mac.yml` produced, sha512 matches the zip, both
   notarized, `.app` inside the zip is stapled.
3. **Live update (manual, the real proof):** install version N from dmg; publish
   N+1 via `release.sh`; confirm the installed app auto-downloads, DEFERS across
   a running generation turn, then auto-restarts onto N+1.

**Handoff caveat:** layers 2–3 require real Apple notarization + two real signed
releases against the mirror. Implementation can complete all code + the script
and prove layer 1 in CI; layers 2–3 are a manual verification step that needs
signing credentials. The plan will mark exactly where that handoff is.

## Out of scope (YAGNI)

- In-app branded update modal (native dialog chosen).
- Release notes in the prompt (native dialog doesn't show them; could revisit).
- GitHub Actions CI release (scripted local release chosen; CI is a later option).
- Delta/differential updates (full-zip replace is fine at this scale).
- Intel/universal builds (arm64-only, matching today).
- Rollback UI (electron-updater won't apply a bad signature; downgrade is a
  manual dmg install, acceptable for beta).

## Key files

- `electron/updater.ts` — rework (apply-decision + turn-aware defer).
- `electron/main.ts` — already calls `initUpdater()`; may pass the vite port.
- `electron/viteRunner.ts` — source of the vite port for the turns poll URL.
- `electron-builder.yml` — add zip target.
- `studio/packaging/scripts/release.sh` — new scripted release.
- `studio/CLAUDE.md` — replace the manual release section with the script.
- `studio/server/middleware/turns.ts` — new `/api/turns/active`.
- `studio/server/turnRegistry.ts` — existing `getTurn` (read-only consumer).
- `studio/src/components/feedback/UpdateBanner.tsx` — delete.
- `studio/src/App.tsx` — remove banner mount.
- `studio/server/middleware/version.ts` — remove `/api/version/check`.
