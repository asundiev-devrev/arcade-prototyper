import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// updater.ts can't be imported here — its electron-updater `autoUpdater` getter
// eagerly constructs MacUpdater and throws outside a packaged runtime. So we
// assert against the source text, like the packaging config guards.
//
// Regression guard for the notify-first update flow silently breaking: Electron
// main talks to the local Vite server to publish "update available" and to poll
// the install request. Vite binds to whatever `localhost` resolves to — on
// current macOS/Node that is IPv6 `[::1]` ONLY. A hardcoded `127.0.0.1` (IPv4)
// fetch gets connection-refused, so the POST fails, the shell never learns an
// update is pending, and no banner ever appears. The updater MUST use
// `localhost` (matching viteRunner.ts).
// vitest runs from the repo root (process.cwd()); electron source is there.
const src = readFileSync(resolve(process.cwd(), "electron/updater.ts"), "utf8");

describe("updater local-server host", () => {
  it("talks to the Vite server via localhost, not a hardcoded 127.0.0.1", () => {
    // The SERVER base URL must be localhost.
    expect(src).toContain('const SERVER = "http://localhost:5556"');
    // No 127.0.0.1 in CODE (comments explaining the bug are allowed): strip
    // block/line comments, then assert the loopback IPv4 literal is absent.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("127.0.0.1");
    // And no fetch should target a raw IPv4 loopback.
    expect(code).not.toMatch(/fetch\(\s*["'`]http:\/\/127\.0\.0\.1/);
  });
});
