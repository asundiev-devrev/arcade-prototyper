import { app, Notification } from "electron";
import fs from "node:fs";
// electron-updater ships as CommonJS. Under ESM, named imports of
// `autoUpdater` fail at runtime ("Named export 'autoUpdater' not
// found"). Default-import the package and destructure.
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;
import { decideApply, shouldApplyUpdate } from "./applyDecision.js";

/**
 * Can quitAndInstall actually replace the app bundle on disk? It can't when:
 *  - the app runs from a read-only path (Gatekeeper App Translocation runs the
 *    DMG/quarantined copy from a randomized read-only mount), or
 *  - the .app dir isn't writable by us (installed somewhere we can't modify).
 *
 * In those cases quitAndInstall relaunches the SAME copy, the new process
 * re-finds the update, and it loops forever (the user sees endless restarts +
 * AWS re-sign-in). We detect it and DECLINE to enter the apply path, telling
 * the user to move the app to /Applications instead of silently looping.
 *
 * Heuristic: the bundle path contains "/AppTranslocation/", OR the bundle dir
 * is not writable. Best-effort — any error → assume installable (today's
 * behavior) so we never block a legitimate update.
 */
function appIsInstallable(): boolean {
  try {
    const appPath = app.getPath("exe"); // …/Arcade Studio.app/Contents/MacOS/Arcade Studio
    if (appPath.includes("/AppTranslocation/")) return false;
    // The .app bundle root is three levels up from the exe. Writability there
    // is what quitAndInstall needs to swap the bundle.
    const bundleRoot = appPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
    fs.accessSync(bundleRoot, fs.constants.W_OK);
    return true;
  } catch {
    return true; // unknown → don't block updates
  }
}

// The turn-aware apply decision lives in a standalone, electron-free module
// so it is unit-testable under vitest (importing this file pulls in
// electron-updater, which eagerly constructs MacUpdater and throws outside a
// packaged runtime). Re-exported here so Task 4's glue can use it directly.
export { decideApply, DEFER_CAP_MS } from "./applyDecision.js";
export type { ApplyContext } from "./applyDecision.js";

/**
 * Initializes electron-updater with the GitHub Releases provider.
 *
 * The publisher in electron-builder.yml pushes new releases to
 * asundiev-devrev/arcade-studio-releases. The updater polls that
 * repo's latest-mac.yml on app ready and downloads in the background.
 *
 * On dev (unpackaged), this is a no-op — autoUpdater refuses to run
 * outside a packaged build, which is what we want.
 */
export function initUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] update available: ${info.version}`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (applying) return;

    // Loop guard: NEVER restart into a version we're already running (or older).
    // If quitAndInstall couldn't swap the bundle last time, the relaunched
    // process re-receives this same event — applying again would loop forever
    // (endless restarts + AWS re-sign-in). Refusing a non-newer version means a
    // failed swap is harmless: we just keep running the current version.
    const current = app.getVersion();
    if (!shouldApplyUpdate(current, info.version)) {
      console.warn(`[updater] downloaded ${info.version} is not newer than running ${current} — not applying (loop guard)`);
      return;
    }

    // If the app can't be replaced in place (translocated / read-only path),
    // quitAndInstall would relaunch the same copy and loop. Surface an
    // actionable notice instead of restarting into the same version forever.
    if (!appIsInstallable()) {
      console.warn(`[updater] ${info.version} downloaded but app is not installable in place (translocated/read-only) — skipping auto-apply`);
      if (!translocationNoticeShown && Notification.isSupported()) {
        translocationNoticeShown = true;
        new Notification({
          title: "Move Arcade Studio to Applications to update",
          body: "An update is ready but can't install from the current location. Drag Arcade Studio into your Applications folder, then reopen it.",
        }).show();
      }
      return;
    }

    applying = true;
    void applyWhenIdle(info.version, 0);
  });

  // Kick off the check. electron-updater handles fetching the
  // latest-mac.yml manifest from GitHub Releases.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] checkForUpdates failed:", err);
  });

  // Re-check every 30 minutes so a long-lived session still picks up a release
  // published after launch. unref so the timer never keeps the app alive.
  const RECHECK_MS = 30 * 60 * 1000;
  const timer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[updater] periodic checkForUpdates failed:", err);
    });
  }, RECHECK_MS);
  timer.unref?.();
}

/** Poll interval while waiting for an active turn to finish. */
const POLL_MS = 15 * 1000;

/** Guards against stacked apply chains: the periodic recheck re-emits
 *  update-downloaded for the cached update, which would otherwise spawn a
 *  second applyWhenIdle chain (resetting the defer cap + scheduling another
 *  quit). Once we commit to applying, we never re-enter. */
let applying = false;

/** One-shot guard so the "move to Applications" notice doesn't fire on every
 *  re-check while the app stays in a non-installable location. */
let translocationNoticeShown = false;

/** Ask the local server whether a generation turn is running. On any error
 *  (server not up, fetch failed) we treat the app as idle — a dead server has
 *  no active turn, so restarting is safe. The Vite server always runs on 5556
 *  (see electron/viteRunner.ts VITE_PORT). */
async function isTurnActive(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:5556/api/turns/active");
    if (!res.ok) return false;
    const body = (await res.json()) as { active?: boolean };
    return body.active === true;
  } catch {
    return false;
  }
}

/** Apply the downloaded update, deferring the restart while a turn is running.
 *  Decision delegated to the pure decideApply(); this function is the Electron
 *  glue (notice + quitAndInstall + polling). */
async function applyWhenIdle(version: string, deferredMs: number): Promise<void> {
  const turnActive = await isTurnActive();
  const decision = decideApply({ turnActive, deferredMs });

  if (decision === "wait") {
    setTimeout(() => void applyWhenIdle(version, deferredMs + POLL_MS), POLL_MS);
    return;
  }

  if (decision === "force") {
    // A turn outlasted the cap — stop waiting. autoInstallOnAppQuit (set in
    // initUpdater) means the update still applies on the next quit.
    console.log(`[updater] ${version} deferred past cap; will apply on quit`);
    return;
  }

  // decision === "restart": idle → apply now with a brief notice, then relaunch.
  console.log(`[updater] applying ${version} now`);
  if (Notification.isSupported()) {
    new Notification({
      title: "Updating Arcade Studio",
      body: `Installing version ${version}…`,
    }).show();
  }
  // Re-check after the notice delay: a prompt submitted in this window would
  // start a turn we must not kill. If so, resume waiting instead of quitting.
  setTimeout(() => {
    void (async () => {
      if (await isTurnActive()) {
        void applyWhenIdle(version, deferredMs + POLL_MS);
      } else {
        autoUpdater.quitAndInstall();
      }
    })();
  }, 1200);
}
