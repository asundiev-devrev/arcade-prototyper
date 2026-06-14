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
