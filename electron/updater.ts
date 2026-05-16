import { app, dialog } from "electron";
// electron-updater ships as CommonJS. Under ESM, named imports of
// `autoUpdater` fail at runtime ("Named export 'autoUpdater' not
// found"). Default-import the package and destructure.
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;

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
    void dialog
      .showMessageBox({
        type: "info",
        title: "Update available",
        message: `Arcade Studio ${info.version} is ready to install.`,
        detail: "The update will be applied when you quit. Quit now to install immediately.",
        buttons: ["Quit and install", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  // Kick off the check. electron-updater handles fetching the
  // latest-mac.yml manifest from GitHub Releases.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] checkForUpdates failed:", err);
  });
}
