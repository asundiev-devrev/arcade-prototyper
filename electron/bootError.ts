/**
 * Boot-failure recovery helpers. Kept electron-free so they unit-test without a
 * packaged runtime. When Vite can't be brought up, main.ts retries a bounded
 * number of times then shows bootErrorHtml — replacing the old unbounded,
 * invisible retry loop (117 startVite attempts in a day; the 0.42.0 hang).
 */

/** Max startVite attempts before we give up and show the error page. */
export const BOOT_MAX_ATTEMPTS = 2;

/** Should we try startVite again? `attempt` is the number of attempts ALREADY
 *  made (1 after the first failure). */
export function shouldRetryBoot(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts;
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A self-contained error page shown when Studio's local server won't start.
 * Inline (no bundled asset, no Vite) so it can NEVER itself be the thing that's
 * missing from the packaged app. Quit uses window.close() — a standard web API
 * Electron honors for the main window — so no preload/IPC bridge is needed.
 */
export function bootErrorHtml(logPath: string): string {
  const safePath = escapeHtml(logPath);
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Arcade Studio</title>
<style>
  html,body{height:100%;margin:0}
  body{background:#0d0d0d;color:#e8e8e8;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center}
  .card{max-width:440px;padding:32px;text-align:center}
  h1{font-size:18px;margin:0 0 12px}
  p{color:#a8a8a8;margin:0 0 16px}
  code{display:block;background:#1a1a1a;color:#c8c8c8;padding:10px 12px;border-radius:8px;font-size:12px;word-break:break-all;margin:0 0 20px}
  button{background:#f2c94c;color:#111;border:0;border-radius:999px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}
</style></head>
<body>
  <div class="card">
    <h1>Arcade Studio couldn't start</h1>
    <p>The app's local server didn't come up. Quitting and reopening often clears it. If it keeps happening, send this log file:</p>
    <code>${safePath}</code>
    <button onclick="window.close()">Quit</button>
  </div>
</body>
</html>`;
}
