import { app, Notification } from "electron";
// electron-updater ships as CommonJS. Under ESM, named imports of
// `autoUpdater` fail at runtime ("Named export 'autoUpdater' not
// found"). Default-import the package and destructure.
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;
import { decideApply } from "./applyDecision.js";

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
