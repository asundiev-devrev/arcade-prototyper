/** How long to keep deferring the update restart while a turn stays active
 *  before falling back to apply-on-quit. 30 minutes: long enough for any real
 *  generation, short enough that the update isn't lost to a wedged turn. */
export const DEFER_CAP_MS = 30 * 60 * 1000;

export interface ApplyContext {
  /** Is a generation turn currently running (from /api/turns/active)? */
  turnActive: boolean;
  /** How long we have already been deferring the restart, in ms. */
  deferredMs: number;
}

/**
 * Decide what to do with a downloaded update:
 *  - "restart": apply now (quitAndInstall) — the app is idle.
 *  - "wait": a turn is running and we are under the defer cap — poll again later.
 *  - "force": a turn has outlasted the cap — stop waiting, fall back to
 *    autoInstallOnAppQuit so the update applies on the next quit.
 * Pure (no Electron imports) so it is unit-testable.
 */
export function decideApply(ctx: ApplyContext): "restart" | "wait" | "force" {
  if (!ctx.turnActive) return "restart";
  if (ctx.deferredMs >= DEFER_CAP_MS) return "force";
  return "wait";
}

/**
 * Compare two `0.x.y` semver strings. >0 if a>b, <0 if a<b, 0 if equal.
 * Missing/non-numeric segments sort as 0. Not a full semver impl (no
 * pre-release tags) — Studio versions are plain `MAJOR.MINOR.PATCH`.
 */
export function compareVersions(a: string, b: string): number {
  const seg = (v: string) =>
    (v ?? "").split(".").slice(0, 3).map((p) => {
      const n = Number.parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Should we quitAndInstall a downloaded update?
 *
 * ONLY when the downloaded version is strictly NEWER than the running one.
 * This is the guard that breaks the restart loop: when quitAndInstall can't
 * actually swap the app on disk (the app runs from a read-only / translocated
 * path, or the relaunch races the old instance's port), the relaunched process
 * finds the SAME version still "available", applies again, and loops — users
 * see the app restart every minute and get bounced through the AWS sign-in gate
 * each time. Refusing to apply a version we're already running (or older) makes
 * the loop impossible: a failed swap just means we keep running the current
 * version, no restart. Equal / older / empty versions all return false.
 */
export function shouldApplyUpdate(currentVersion: string, downloadedVersion: string): boolean {
  if (!downloadedVersion || !currentVersion) return false;
  return compareVersions(downloadedVersion, currentVersion) > 0;
}
