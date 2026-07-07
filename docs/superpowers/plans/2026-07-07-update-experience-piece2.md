# Update Experience (Piece 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Studio's silent auto-download-and-restart with a notify-first update flow (tester clicks "Install & restart") and turn the silent boot-failure hang into a visible error screen.

**Architecture:** Electron main owns `electron-updater`; the Vite server serves the React shell; they are **separate processes with no IPC**. So the Vite server is a shared blackboard — main POSTs update state to it, the shell GETs that state to show a prompt, the shell POSTs an install request, and main polls for that request (exactly the pattern `electron/updater.ts` already uses to poll `/api/turns/active`). Boot recovery is main-driven bounded retries then a Vite-independent inline error page.

**Tech Stack:** Electron 33, electron-updater 6.8, Vite 8 middleware (Node http), React 19, `@xorkavi/arcade-gen` (Modal/Button), Vitest 4.

## Global Constraints

- **Package manager: pnpm.** Never `npm`/`yarn`. Run tests via `pnpm run studio:test` (from repo root).
- **Vite middleware does NOT hot-reload.** After editing anything under `server/middleware/*` or `vite.config.ts`, fully restart `pnpm run studio` to test.
- **No new preload / IPC / `contextBridge`.** The BrowserWindow runs `contextIsolation: true`, `nodeIntegration: false`, no preload. All main↔shell communication goes through the Vite server over HTTP. The boot-error page's only privileged action is `window.close()` (a standard web API Electron honors for the main window).
- **`electron-updater` is CommonJS under ESM** — import as `import electronUpdaterPkg from "electron-updater"; const { autoUpdater } = electronUpdaterPkg;` (see current `electron/updater.ts`).
- **`autoUpdater` cannot be imported outside a packaged runtime** (eagerly constructs MacUpdater and throws). Keep all decision logic in electron-free pure modules (mirror `electron/applyDecision.ts`) so it is unit-testable; keep `electron/updater.ts` and `electron/main.ts` as thin glue verified by the manual adversarial gate, NOT by unit tests that import them.
- **Update endpoints are localhost, unauthenticated, tiny** — mirror `studio/server/middleware/turns.ts` (leak nothing but a boolean/version string).
- **Electron main code is compiled by `pnpm exec tsc -p electron/tsconfig.json`** → `electron/dist/*.js`. Assets NOT under `electron/dist/**/*` are not bundled unless added to `electron-builder.yml` `files:` — so prefer inline strings over separate asset files (this is the exact class of the 0.42.0 bug).
- Retain the existing guards in `electron/applyDecision.ts`: `shouldApplyUpdate(current, downloaded)` (loop guard) and `appIsInstallable()` (translocation notice) — do not remove or weaken them.

---

## File Structure

**Create:**
- `electron/bootError.ts` — exports `bootErrorHtml(logPath: string): string` (inline HTML) + `shouldRetryBoot(attempt, maxAttempts): boolean` + `BOOT_MAX_ATTEMPTS`. Pure, electron-free, unit-tested.
- `studio/server/updateRegistry.ts` — in-memory update blackboard (mirror `turnRegistry.ts`). Pure, unit-tested.
- `studio/server/middleware/update.ts` — HTTP endpoints over the registry. Unit-tested.
- `studio/src/lib/updateNotice.ts` — pure decide/format helpers for the shell prompt. Unit-tested.
- `studio/src/components/feedback/UpdateBanner.tsx` — the shell prompt (polls status, Install & restart / Later). Thin React glue.
- Test files alongside each (paths in tasks).

**Modify:**
- `electron/main.ts` — bounded `startVite` retry in `createWindow`; on final failure load the inline error page.
- `electron/updater.ts` — notify-first: on `update-downloaded` POST state to the server instead of auto-applying; poll the server for an install request; apply on demand through the existing turn-aware path.
- `studio/vite.config.ts` — import + register `updateMiddleware()`.
- `studio/src/App.tsx` — mount `<UpdateBanner />`.
- `studio/CHANGELOG.md` — 0.43.0 entry.
- `studio/CLAUDE.md` — bad-build runbook in the release section.

---

## Task 1: Boot recovery — bounded retry + inline error page (Piece 1c)

**Files:**
- Create: `electron/bootError.ts`
- Create: `studio/__tests__/electron/bootError.test.ts`
- Modify: `electron/main.ts` (createWindow, ~lines 82-137)

**Interfaces:**
- Produces: `BOOT_MAX_ATTEMPTS: number` (=2), `shouldRetryBoot(attempt: number, maxAttempts: number): boolean`, `bootErrorHtml(logPath: string): string`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/electron/bootError.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldRetryBoot, bootErrorHtml, BOOT_MAX_ATTEMPTS } from "../../../electron/bootError";

describe("shouldRetryBoot", () => {
  it("retries while under the attempt cap", () => {
    expect(shouldRetryBoot(1, 2)).toBe(true);
  });
  it("stops at the cap", () => {
    expect(shouldRetryBoot(2, 2)).toBe(false);
    expect(shouldRetryBoot(3, 2)).toBe(false);
  });
  it("defaults the cap to 2", () => {
    expect(BOOT_MAX_ATTEMPTS).toBe(2);
  });
});

describe("bootErrorHtml", () => {
  const html = bootErrorHtml("/Users/x/Library/Logs/arcade-studio-electron.log");
  it("names the app and the failure", () => {
    expect(html).toMatch(/Arcade Studio/);
    expect(html.toLowerCase()).toMatch(/couldn.?t start|failed to start/);
  });
  it("shows the log path so a tester can report it", () => {
    expect(html).toContain("/Users/x/Library/Logs/arcade-studio-electron.log");
  });
  it("offers Quit via window.close (no IPC)", () => {
    expect(html).toContain("window.close()");
    expect(html.toLowerCase()).toContain("quit");
  });
  it("escapes the log path into an attribute-safe/text-safe form", () => {
    const evil = bootErrorHtml(`</script><img src=x onerror=alert(1)>`);
    expect(evil).not.toContain("<img src=x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/electron/bootError.test.ts`
Expected: FAIL — `Cannot find module '../../../electron/bootError'`.

- [ ] **Step 3: Write minimal implementation**

Create `electron/bootError.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/electron/bootError.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Wire bounded retry + error page into main.ts**

⚠️ This rewrites `createWindow` and reorders it. The current function (`electron/main.ts:82-137`) runs `startVite` FIRST (throwing on failure), THEN constructs the window; its `webContents.on(...)` listeners sit BETWEEN the deep-link `finalUrl` block and `loadURL`. We invert that: construct the window first, attach listeners immediately after the constructor, then attempt Vite with bounded retries. Replace the WHOLE function body verbatim so ordering is unambiguous — do not apply this as scattered deltas.

First, add the import near the top (after the `initUpdater` import, ~line 6):

```ts
import { shouldRetryBoot, bootErrorHtml, BOOT_MAX_ATTEMPTS } from "./bootError.js";
```

Add a module-level flag next to the existing `mainWindow` / `pendingDeepLink` declarations (`main.ts:63-64`). It gates deep-link delivery so a link arriving during the (now longer, window-exists-but-blank) startup window is stashed, not fired at a blank page:

```ts
let windowReady = false;
```

Then replace the entire `async function createWindow(): Promise<void> { … }` (lines 82-137) with:

```ts
/** Start Vite with bounded retries. Returns the URL, or null after BOOT_MAX_ATTEMPTS
 *  failures (caller then shows the error page instead of hanging — the 0.42.0 fix). */
async function tryStartVite(): Promise<string | null> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    console.log("[main] startVite begin", { appRoot: appRoot(), attempt });
    try {
      const url = await startVite(appRoot());
      console.log("[main] startVite ready", { url, attempt });
      return url;
    } catch (err) {
      console.error("[main] startVite FAILED", { attempt, message: (err as Error)?.message });
      if (!shouldRetryBoot(attempt, BOOT_MAX_ATTEMPTS)) return null;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Load the inline error page (data: URL, no Vite dependency). */
async function showBootError(): Promise<void> {
  if (!mainWindow) return;
  await mainWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(bootErrorHtml(LOG_FILE)),
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Arcade Studio",
    backgroundColor: "#0d0d0d",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Attach diagnostic listeners BEFORE any loadURL so early load failures and
  // renderer console output are captured. If the real (http) page fails to load
  // even though the port answered — Vite child crashed at/after the port check,
  // strictPort reclaim race — fall back to the error page ONCE (guarded so the
  // data: URL load, which does NOT fire did-fail-load, can't recurse).
  let bootErrorShown = false;
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    console.error("[main] did-fail-load", { code, desc, validatedURL });
    if (!bootErrorShown && validatedURL?.startsWith("http")) {
      bootErrorShown = true;
      void showBootError();
    }
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log("[renderer]", { level, message, line, source });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    windowReady = false;
  });

  const url = await tryStartVite();
  if (!url) {
    console.error("[main] Vite failed after retries — showing error page");
    emitBootError();
    await showBootError();
    return;
  }

  const finalUrl = pendingDeepLink
    ? `${url}/#share=${encodeURIComponent(pendingDeepLink)}`
    : url;
  pendingDeepLink = null;
  console.log("[main] loadURL", { finalUrl });
  await mainWindow.loadURL(finalUrl);
  console.log("[main] loadURL completed");
  windowReady = true;
}
```

Also update the `open-url` handler (`main.ts:142-154`) so a deep link only fires into the window once it has actually loaded the app; otherwise stash it. Change its guard from `if (mainWindow) {` to:

```ts
  if (mainWindow && windowReady) {
```

(The `else { pendingDeepLink = url; }` branch is unchanged — `createWindow` consumes `pendingDeepLink` after `tryStartVite` resolves.)

- [ ] **Step 6: Add the `emitBootError` telemetry hook**

`showBootError` above calls `emitBootError()`. Add a thin emitter in `electron/telemetry.ts` mirroring the existing `emitAppShutdown` (see `electron/telemetry.ts:112,125,134`), and import it in `main.ts` alongside `emitAppLaunched`/`emitAppShutdown` (`main.ts:7`):

In `electron/telemetry.ts`, after `emitAppShutdown`:

```ts
export function emitBootError(): void {
  emit({ name: "boot_error_shown", props: { version: appVersion() } });
}
```

(Use the same `emit` + version-source pattern the neighboring emitters use — match their exact signatures; if `appVersion()` isn't the local helper name, use whatever `emitAppLaunched` uses.) In `main.ts`, extend the import:

```ts
import { initMainTelemetry, emitAppLaunched, emitAppShutdown, emitBootError } from "./telemetry.js";
```

If `boot_error_shown` isn't in the telemetry event union type, add it there too (grep `electron/telemetry.ts` for the event-name type).

- [ ] **Step 7: Compile the electron main to verify no type errors**

Run: `pnpm exec tsc -p electron/tsconfig.json`
Expected: exits 0, no errors referencing `main.ts`, `bootError.ts`, or `telemetry.ts`.

- [ ] **Step 8: Commit**

```bash
git add electron/bootError.ts studio/__tests__/electron/bootError.test.ts electron/main.ts electron/telemetry.ts
git commit -m "feat(studio/electron): bounded boot retry + visible error page (Piece 1c)"
```

---

## Task 2: Update-status blackboard on the Vite server (transport)

**Files:**
- Create: `studio/server/updateRegistry.ts`
- Create: `studio/server/middleware/update.ts`
- Create: `studio/__tests__/server/updateRegistry.test.ts`
- Create: `studio/__tests__/server/update-middleware.test.ts`
- Modify: `studio/vite.config.ts` (import ~line 39; register ~line 55)

**Interfaces:**
- Produces (registry): `setPending(version: string): void`, `clearPending(): void`, `requestInstall(): void`, `getUpdateState(): { pendingVersion: string | null; installRequested: boolean }`, `__resetForTest(): void`.
- Produces (middleware): `updateMiddleware()` returning an `(req,res,next)` handler serving:
  - `POST /api/update/available` body `{version:string}` → `setPending` → `204`
  - `POST /api/update/install` → `requestInstall` → `204`
  - `POST /api/update/clear` → `clearPending` → `204` (lets the shell reset a stuck/abandoned install — Finding 6)
  - `GET  /api/update/status` → `200 {pendingVersion, installRequested}`
- Consumes: nothing.

- [ ] **Step 1: Write the failing registry test**

Create `studio/__tests__/server/updateRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  setPending, clearPending, requestInstall, getUpdateState, __resetForTest,
} from "../../server/updateRegistry";

describe("updateRegistry", () => {
  beforeEach(() => __resetForTest());

  it("starts empty", () => {
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });
  it("records a pending version", () => {
    setPending("0.43.0");
    expect(getUpdateState().pendingVersion).toBe("0.43.0");
  });
  it("records an install request", () => {
    setPending("0.43.0");
    requestInstall();
    expect(getUpdateState()).toEqual({ pendingVersion: "0.43.0", installRequested: true });
  });
  it("clearPending resets both fields", () => {
    setPending("0.43.0"); requestInstall(); clearPending();
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/server/updateRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `studio/server/updateRegistry.ts`:

```ts
/**
 * In-memory update blackboard. Electron main and the Vite server are separate
 * processes with no IPC, so the server holds the shared update state:
 *   - main POSTs the downloaded version here (setPending) and polls for an
 *     install request (getUpdateState().installRequested),
 *   - the shell GETs the pending version to prompt, and POSTs an install
 *     request (requestInstall) when the user clicks "Install & restart".
 * Same shape as turnRegistry: tiny, process-local, reset on server restart
 * (main re-POSTs on the next update-downloaded / periodic recheck).
 */
interface UpdateState {
  pendingVersion: string | null;
  installRequested: boolean;
}

const state: UpdateState = { pendingVersion: null, installRequested: false };

export function setPending(version: string): void {
  state.pendingVersion = version;
}

export function clearPending(): void {
  state.pendingVersion = null;
  state.installRequested = false;
}

export function requestInstall(): void {
  state.installRequested = true;
}

export function getUpdateState(): UpdateState {
  return { pendingVersion: state.pendingVersion, installRequested: state.installRequested };
}

/** Test-only: reset module state between tests. */
export function __resetForTest(): void {
  state.pendingVersion = null;
  state.installRequested = false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/server/updateRegistry.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Write the failing middleware test**

Create `studio/__tests__/server/update-middleware.test.ts`.

⚠️ `updateMiddleware` is **async** and the `/available` branch `await`s `readJson` BEFORE `writeHead`. So `invoke` MUST await the handler and every call site MUST await `invoke` — otherwise the status/state assertion reads before the handler's microtask runs and the test races (only the no-`await` branches would pass by accident). The req mock fires `data`/`end` synchronously, which is fine; the fix is awaiting the handler:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { updateMiddleware } from "../../server/middleware/update";
import { __resetForTest, getUpdateState, setPending } from "../../server/updateRegistry";

async function invoke(method: string, url: string, body?: unknown) {
  const handler = updateMiddleware();
  const chunks: string[] = [];
  let statusCode = 0;
  const req: any = {
    method,
    url,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === "data" && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (event === "end") cb();
      return req;
    },
  };
  const res: any = {
    writeHead(code: number) { statusCode = code; return res; },
    end(s?: string) { if (s) chunks.push(s); },
  };
  let nextCalled = false;
  await handler(req, res, () => { nextCalled = true; });
  return { statusCode, body: chunks.join(""), nextCalled };
}

describe("updateMiddleware", () => {
  beforeEach(() => __resetForTest());

  it("GET /api/update/status returns the current state", async () => {
    setPending("0.43.0");
    const r = await invoke("GET", "/api/update/status");
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ pendingVersion: "0.43.0", installRequested: false });
  });

  it("POST /api/update/available records the version", async () => {
    const r = await invoke("POST", "/api/update/available", { version: "0.43.0" });
    expect(r.statusCode).toBe(204);
    expect(getUpdateState().pendingVersion).toBe("0.43.0");
  });

  it("POST /api/update/install sets installRequested", async () => {
    setPending("0.43.0");
    const r = await invoke("POST", "/api/update/install");
    expect(r.statusCode).toBe(204);
    expect(getUpdateState().installRequested).toBe(true);
  });

  it("passes through unrelated routes", async () => {
    const r = await invoke("GET", "/api/something-else");
    expect(r.nextCalled).toBe(true);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm run studio:test __tests__/server/update-middleware.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the middleware**

Create `studio/server/middleware/update.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { setPending, requestInstall, clearPending, getUpdateState } from "../updateRegistry";

/** Read and JSON-parse a request body; {} on empty/invalid. */
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(Buffer.from(c)));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString() || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

/**
 * Update-status blackboard endpoints. Localhost, unauthenticated, tiny — same
 * posture as turnsMiddleware. Bridges the no-IPC gap between Electron main (the
 * updater) and the React shell. See updateRegistry.ts.
 */
export function updateMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && url === "/api/update/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getUpdateState()));
      return;
    }
    if (req.method === "POST" && url === "/api/update/available") {
      const body = await readJson(req);
      if (typeof body.version === "string" && body.version.length > 0) {
        setPending(body.version);
      }
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/update/install") {
      requestInstall();
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/update/clear") {
      clearPending();
      res.writeHead(204); res.end();
      return;
    }
    return next?.();
  };
}
```

Add a fifth test to `update-middleware.test.ts` (inside the `describe`) for the clear route:

```ts
  it("POST /api/update/clear resets pending state", async () => {
    setPending("0.43.0");
    const r = await invoke("POST", "/api/update/clear");
    expect(r.statusCode).toBe(204);
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm run studio:test __tests__/server/update-middleware.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 9: Register the middleware in vite.config.ts**

In `studio/vite.config.ts`, add the import next to the version/turns imports (near line 39):

```ts
import { updateMiddleware } from "./server/middleware/update";
```

And register it next to `turnsMiddleware()` (near line 55):

```ts
      server.middlewares.use(turnsMiddleware());
      server.middlewares.use(updateMiddleware());
```

- [ ] **Step 10: Commit**

```bash
git add studio/server/updateRegistry.ts studio/server/middleware/update.ts studio/__tests__/server/updateRegistry.test.ts studio/__tests__/server/update-middleware.test.ts studio/vite.config.ts
git commit -m "feat(studio/server): update-status blackboard endpoints (transport for notify-first updates)"
```

---

## Task 3: Notify-first updater (main side)

**Files:**
- Modify: `electron/updater.ts` (whole file — rewrite the apply path; keep helpers)

**Interfaces:**
- Consumes: `decideApply`, `shouldApplyUpdate`, `DEFER_CAP_MS` from `./applyDecision.js`; `/api/update/available`, `/api/update/status`, `/api/update/install` from Task 2.
- Produces: no new exports needed by other tasks (re-exports of `decideApply`/`DEFER_CAP_MS`/`ApplyContext` stay for compatibility).

**Behavior change:** on `update-downloaded`, DO NOT call `applyWhenIdle`. Instead POST the version to the server (`/api/update/available`) and start a poll loop watching `/api/update/status` for `installRequested`. When install is requested, run the existing turn-aware `applyWhenIdle` → `quitAndInstall`. Set `autoInstallOnAppQuit = false` so nothing installs without the tester's explicit click ("Notify, tester chooses"). Keep `autoDownload = true` (so install is instant), and keep the `shouldApplyUpdate` + `appIsInstallable` guards at the `update-downloaded` gate.

- [ ] **Step 1: Make four surgical, non-contiguous edits to `electron/updater.ts`**

⚠️ Do NOT delete any block wholesale. In particular, `POLL_MS` (line 121), `applying` (127), `translocationNoticeShown` (131), and `isTurnActive` (137-146) sit BETWEEN `initUpdater` and `applyWhenIdle` — they are NOT in the file's "top" — and the new code below references all of them. Leave them and the body of `applyWhenIdle` (151-186) in place. Apply only these four edits:

(a) In `initUpdater`, change the two autoUpdater flags:

```ts
  autoUpdater.autoDownload = true;
  // Notify-first: NEVER auto-restart or auto-apply-on-quit. The update applies
  // only when the tester clicks "Install & restart" (→ /api/update/install →
  // the poll loop below → applyWhenIdle). Download stays eager so the click is
  // instant.
  autoUpdater.autoInstallOnAppQuit = false;
```

(b) Replace the entire `autoUpdater.on("update-downloaded", …)` handler with:

```ts
  autoUpdater.on("update-downloaded", (info) => {
    if (applying) return;

    // Loop guard: never offer/apply a version that isn't strictly newer than
    // what we're running (see applyDecision.shouldApplyUpdate).
    const current = app.getVersion();
    if (!shouldApplyUpdate(current, info.version)) {
      console.warn(`[updater] downloaded ${info.version} not newer than ${current} — ignoring (loop guard)`);
      return;
    }

    // If the app can't be replaced in place (translocated / read-only), applying
    // would loop. Surface the actionable notice, don't offer an install.
    if (!appIsInstallable()) {
      console.warn(`[updater] ${info.version} downloaded but app is not installable in place — skipping`);
      if (!translocationNoticeShown && Notification.isSupported()) {
        translocationNoticeShown = true;
        new Notification({
          title: "Move Arcade Studio to Applications to update",
          body: "An update is ready but can't install from the current location. Drag Arcade Studio into your Applications folder, then reopen it.",
        }).show();
      }
      return;
    }

    // Notify-first: publish the pending version to the shell (via the server
    // blackboard) and wait for the tester to request the install. Do NOT apply.
    console.log(`[updater] ${info.version} downloaded — offering to the shell`);
    void postUpdateAvailable(info.version);
    watchForInstallRequest(info.version);
  });
```

(c) Replace `applyWhenIdle`'s trigger. `applyWhenIdle` itself (the turn-aware defer + `quitAndInstall`) stays AS-IS, but it is now called from the install-request watcher, not the download handler. Add these helpers after `isTurnActive` (reusing the same `http`/`fetch` approach `isTurnActive` uses — Electron main has global `fetch`):

```ts
/** Base URL of the local Vite server (same host/port isTurnActive uses). */
const SERVER = "http://127.0.0.1:5556";

/** Tell the shell (via the server blackboard) that an update is ready. Best
 *  effort — if the server isn't up yet the periodic recheck re-emits
 *  update-downloaded and we retry. */
async function postUpdateAvailable(version: string): Promise<void> {
  try {
    await fetch(`${SERVER}/api/update/available`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
  } catch {
    /* server not ready — recheck will retry */
  }
}

/** Poll the server for the tester's "Install & restart" click. Once seen, run
 *  the turn-aware apply exactly once. */
let installWatchTimer: ReturnType<typeof setInterval> | null = null;
function watchForInstallRequest(version: string): void {
  if (installWatchTimer) return; // already watching
  installWatchTimer = setInterval(() => {
    void (async () => {
      try {
        const res = await fetch(`${SERVER}/api/update/status`);
        if (!res.ok) return;
        const body = (await res.json()) as { installRequested?: boolean };
        if (body.installRequested && !applying) {
          applying = true;
          if (installWatchTimer) { clearInterval(installWatchTimer); installWatchTimer = null; }
          console.log(`[updater] install requested for ${version} — applying when idle`);
          void applyWhenIdle(version, 0);
        }
      } catch {
        /* transient — keep polling */
      }
    })();
  }, POLL_MS);
  installWatchTimer.unref?.();
}
```

(d) In `applyWhenIdle`, the `decision === "restart"` branch already re-checks `isTurnActive` and calls `autoUpdater.quitAndInstall()` — leave it unchanged. The `"force"` branch's comment mentions `autoInstallOnAppQuit`; update that comment since we set it false now:

Change:
```ts
  if (decision === "force") {
    // A turn outlasted the cap — stop waiting. autoInstallOnAppQuit (set in
    // initUpdater) means the update still applies on the next quit.
    console.log(`[updater] ${version} deferred past cap; will apply on quit`);
    return;
  }
```
to:
```ts
  if (decision === "force") {
    // A turn outlasted the cap — stop waiting and apply now anyway. The tester
    // asked to install; a wedged turn shouldn't hold the update hostage forever.
    // (autoInstallOnAppQuit is false, so we must apply explicitly.)
    console.log(`[updater] ${version} deferred past cap; applying now`);
    autoUpdater.quitAndInstall();
    return;
  }
```

⚠️ **Behavior change to flag (not a bug):** this ENDS any generation still running after `DEFER_CAP_MS` (30 min) once the tester has clicked Install. Previously the `force` branch returned and applied only on the next natural quit, so a long-but-healthy generation was never killed. Now it is. That is intentional — a wedged turn must not hold the update hostage — but `DEFER_CAP_MS` was tuned for the old apply-on-quit semantics. The 0.43.0 CHANGELOG entry (Task 5) must state: "if a generation runs longer than 30 minutes after you click Install & restart, Studio installs anyway and ends that generation."

(c-retry) The `update-downloaded` event can fire before Vite is serving (main starts `createWindow` and `initUpdater` concurrently). A single failed `postUpdateAvailable` then relies on the periodic recheck — which is **30 min** (`RECHECK_MS`, updater.ts:111) — so the offer could be invisible for half an hour (Finding 11). Give `postUpdateAvailable` a short bounded retry so an early-boot POST that races Vite still lands within seconds. Replace its body with:

```ts
async function postUpdateAvailable(version: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${SERVER}/api/update/available`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 5000)); // wait for Vite, then retry
  }
  // Gave up — the 30-min recheck re-emits update-downloaded as a last resort.
}
```

(f) Telemetry (Finding 8): just before `void applyWhenIdle(version, 0)` in `watchForInstallRequest`, emit an `update_applied` event via the same `emit` helper `electron/telemetry.ts` uses (import it into `updater.ts`). Add `update_applied` to the telemetry event union if it's a closed type. This mirrors how main already emits `emitAppLaunched`/`emitAppShutdown`.

(e) Wire the dead `clearPending` so a failed/abandoned install can be reset (Finding 6). `applyWhenIdle`'s only non-quitting terminal exit is the `force` branch (now quits) and the `wait` reschedule; the real stuck case is `quitAndInstall()` failing to swap+relaunch (translocation slips the guard, ShipIt fails) — the app keeps running the OLD version with `installRequested` latched true, so the shell's "Updating…" modal (Task 4) would hang forever. The shell-side 60s escape in `UpdateBanner` (Task 4 Step 5, `INSTALL_TIMEOUT_MS`) is the user-facing fix; to also reset server state so the prompt can return, the escape POSTs `/api/update/clear`. That endpoint is added in Task 2 — it maps to the already-defined `clearPending`. No `updater.ts` change needed for (e); it's the wiring that makes `clearPending` reachable instead of dead code. Document the residual caveat: after a failed swap, main has latched `applying=true` and cleared its watch timer, so it won't re-offer THIS version until the server/app restarts or a newer version downloads — acceptable degradation given auto-rollback was cut.

- [ ] **Step 2: Type-check the electron main**

Run: `pnpm exec tsc -p electron/tsconfig.json`
Expected: exits 0. (No unit test here — importing `updater.ts` constructs `autoUpdater` and throws outside a packaged runtime; the pure decisions it uses are already tested in `applyDecision.test.ts`. This path is proven by the Task 6 manual gate.)

- [ ] **Step 3: Commit**

```bash
git add electron/updater.ts
git commit -m "feat(studio/electron): notify-first updater — offer install, apply on tester request"
```

---

## Task 4: Shell "Update available" prompt

**Files:**
- Create: `studio/src/lib/updateNotice.ts`
- Create: `studio/__tests__/lib/updateNotice.test.ts`
- Create: `studio/src/components/feedback/UpdateBanner.tsx`
- Modify: `studio/src/App.tsx` (import ~line 7; mount ~line 91 next to `<WhatsNewModal />`)

**Interfaces:**
- Consumes: `GET /api/update/status` → `{ pendingVersion, installRequested }`; `POST /api/update/install`.
- Produces (lib): `type UpdateStatus = { pendingVersion: string | null; installRequested: boolean }`; `shouldPrompt(status: UpdateStatus | null, dismissedVersion: string | null): boolean`.

- [ ] **Step 1: Write the failing lib test**

Create `studio/__tests__/lib/updateNotice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldPrompt } from "../../src/lib/updateNotice";

describe("shouldPrompt", () => {
  it("no status → no prompt", () => {
    expect(shouldPrompt(null, null)).toBe(false);
  });
  it("no pending version → no prompt", () => {
    expect(shouldPrompt({ pendingVersion: null, installRequested: false }, null)).toBe(false);
  });
  it("pending version, not dismissed → prompt", () => {
    expect(shouldPrompt({ pendingVersion: "0.43.0", installRequested: false }, null)).toBe(true);
  });
  it("pending version already dismissed → no prompt", () => {
    expect(shouldPrompt({ pendingVersion: "0.43.0", installRequested: false }, "0.43.0")).toBe(false);
  });
  it("a NEWER pending version after dismissing an older one → prompt again", () => {
    expect(shouldPrompt({ pendingVersion: "0.44.0", installRequested: false }, "0.43.0")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/lib/updateNotice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lib**

Create `studio/src/lib/updateNotice.ts`:

```ts
/**
 * Pure logic for the "Update available" prompt. The shell polls
 * /api/update/status; this decides whether to show the prompt given what the
 * user has dismissed. "Later" dismisses the CURRENT pending version only, so a
 * subsequent, newer release prompts again.
 */
export interface UpdateStatus {
  pendingVersion: string | null;
  installRequested: boolean;
}

export function shouldPrompt(
  status: UpdateStatus | null,
  dismissedVersion: string | null,
): boolean {
  if (!status || !status.pendingVersion) return false;
  return status.pendingVersion !== dismissedVersion;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/lib/updateNotice.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Implement the UpdateBanner component**

Create `studio/src/components/feedback/UpdateBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";
import { shouldPrompt, type UpdateStatus } from "../../lib/updateNotice";
import { track } from "../../lib/telemetry/renderer";

/**
 * Notify-first update prompt. Electron main downloads an update in the
 * background and publishes it to the server blackboard (/api/update/status).
 * We poll that; when a new version is pending and not yet dismissed, we ask the
 * tester. "Install & restart" POSTs /api/update/install — main sees it, applies
 * when idle, and relaunches. "Later" dismisses just this version (persisted, so
 * a reload doesn't re-nag; a NEWER version still prompts).
 *
 * Mounted once at the app root. No auto-restart ever happens without the click.
 */
const POLL_MS = 15_000;
/** If the install doesn't relaunch the app within this window, quitAndInstall
 *  likely couldn't swap the bundle. Re-enable the UI + reset server state so the
 *  tester isn't stuck behind a frozen "Updating…" (Finding 6 — no auto-rollback,
 *  so degrade gracefully). */
const INSTALL_TIMEOUT_MS = 60_000;
/** Persist dismissal so a shell reload doesn't re-prompt the same version. */
const DISMISSED_KEY = "arcade-studio:update-dismissed";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(
    () => window.localStorage.getItem(DISMISSED_KEY),
  );
  const [installing, setInstalling] = useState(false);
  const [installStalled, setInstallStalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/update/status");
        if (!res.ok) return;
        const body = (await res.json()) as UpdateStatus;
        if (!cancelled) setStatus(body);
      } catch {
        /* server momentarily unavailable — try next tick */
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const open = !installing && shouldPrompt(status, dismissed);
  const version = status?.pendingVersion ?? "";

  // Telemetry: fire once when the prompt first becomes visible for a version.
  useEffect(() => {
    if (open && version) track({ name: "update_offered", props: { version } });
  }, [open, version]);

  const dismiss = () => {
    if (version) {
      window.localStorage.setItem(DISMISSED_KEY, version);
      track({ name: "update_dismissed", props: { version } });
    }
    setDismissed(version);
  };

  const install = async () => {
    track({ name: "update_install_clicked", props: { version } });
    setInstalling(true);
    try {
      await fetch("/api/update/install", { method: "POST" });
    } catch {
      /* main also polls; the click is recorded server-side on retry */
    }
    // If we're still here after the timeout, the swap+relaunch didn't happen.
    window.setTimeout(() => setInstallStalled(true), INSTALL_TIMEOUT_MS);
  };

  const cancelStalledInstall = async () => {
    try { await fetch("/api/update/clear", { method: "POST" }); } catch { /* best effort */ }
    setInstalling(false);
    setInstallStalled(false);
    setDismissed(version); // don't immediately re-prompt this version
  };

  if (installing) {
    return (
      <Modal.Root open onOpenChange={() => { /* not dismissable mid-install */ }}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{installStalled ? "Update didn't start" : "Updating…"}</Modal.Title>
            <Modal.Description>
              {installStalled
                ? `Version ${version} couldn't install just now. You can keep using this version and try again later.`
                : `Installing version ${version} and restarting.`}
            </Modal.Description>
          </Modal.Header>
          {installStalled && (
            <Modal.Footer>
              <Button variant="primary" onClick={cancelStalledInstall}>Keep using this version</Button>
            </Modal.Footer>
          )}
        </Modal.Content>
      </Modal.Root>
    );
  }

  if (!open) return null;

  return (
    <Modal.Root open onOpenChange={(v) => { if (!v) dismiss(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Update available — {version}</Modal.Title>
          <Modal.Description>A newer version of Arcade Studio is ready to install.</Modal.Description>
        </Modal.Header>
        <Modal.Footer>
          <Button variant="tertiary" onClick={dismiss}>Later</Button>
          <Button variant="primary" onClick={install}>Install &amp; restart</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
```

⚠️ **Verify two imports against real code before finishing this step** (grep, don't assume): (1) `track` is imported from `../../lib/telemetry/renderer` with signature `track({ name, props })` — confirm the path and that the event names `update_offered` / `update_install_clicked` / `update_dismissed` are added to the telemetry event union (grep the events type in `studio/src/lib/telemetry/`); if the union is closed, add them. (2) `window.setTimeout` returns a number in the DOM lib — fine in the shell (unlike the Node `ReturnType<typeof setInterval>` used in electron code).

- [ ] **Step 6: Mount it in App.tsx**

In `studio/src/App.tsx`, add the import near the `WhatsNewModal` import (line 7):

```tsx
import { UpdateBanner } from "./components/feedback/UpdateBanner";
```

And mount it next to `<WhatsNewModal />` (line 91):

```tsx
        <WhatsNewModal />
        <UpdateBanner />
```

- [ ] **Step 7: Run the lib test + type-check the shell**

Run: `pnpm run studio:test __tests__/lib/updateNotice.test.ts`
Expected: PASS.
Run: `pnpm exec tsc -p studio/tsconfig.json 2>&1 | grep -E "UpdateBanner|updateNotice" || echo "no new errors"`
Expected: `no new errors` (pre-existing unrelated errors elsewhere are fine — see 0.42.1 session).

- [ ] **Step 8: Commit**

```bash
git add studio/src/lib/updateNotice.ts studio/__tests__/lib/updateNotice.test.ts studio/src/components/feedback/UpdateBanner.tsx studio/src/App.tsx
git commit -m "feat(studio/shell): notify-first Update available prompt + Updating state"
```

---

## Task 5: Docs — changelog + bad-build runbook

**Files:**
- Modify: `studio/CHANGELOG.md` (add `## [0.43.0]` above `## [0.42.1]`)
- Modify: `studio/CLAUDE.md` (release section — add runbook)
- Modify: `package.json` (`version` → `0.43.0`)

- [ ] **Step 1: Add the changelog entry**

In `studio/CHANGELOG.md`, insert directly under `## [Unreleased]`:

```markdown
## [0.43.0] — 2026-07-07

### Changed
- **Updates now ask before restarting.** When a new version is ready, Studio shows an "Update available" prompt and waits — it installs and restarts only when you click "Install & restart". No more surprise restarts mid-work. (It still downloads quietly in the background so the install is instant.)

### Fixed
- **No more silent freeze on a bad launch.** If Studio's local server can't start, the app now shows a clear "couldn't start" screen with the log location and a Quit button, instead of hanging invisibly and retrying forever.
```

- [ ] **Step 2: Bump the version**

In `package.json`, change `"version": "0.42.1"` to `"version": "0.43.0"`.

- [ ] **Step 3: Add the bad-build runbook to studio/CLAUDE.md**

In `studio/CLAUDE.md`, in the "Releasing a new version" section, append:

```markdown
### If a shipped build won't boot

1. Confirm from a tester's `~/Library/Logs/arcade-studio-electron.log` (look for repeated `startVite FAILED` / `ERR_MODULE_NOT_FOUND`).
2. Fix forward — there is no auto-roll-back (see `docs/superpowers/specs/2026-07-07-update-experience-and-hotfix-design.md` for why it's unsound on signed macOS apps).
3. Cut the release with `release.sh` (the packaging guard `runtime-deps.test.ts` must pass).
4. **Post the manual `.dmg` link to the tester channel**, not just the auto-update publish — an app that can't boot may never pull the auto-update (a tester force-quits the blank window before the background download finishes).
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm run studio:test`
Expected: all pass (the two intentional `[ERROR]` fixture lines from broken-frame tests are not failures — see the 0.42.1 session).

- [ ] **Step 5: Commit**

```bash
git add studio/CHANGELOG.md studio/CLAUDE.md package.json
git commit -m "docs(studio): 0.43.0 changelog + bad-build runbook; bump version"
```

---

## Task 6: Manual adversarial gate (the acceptance test)

**No code.** This is the verification that matters — unit tests can't exercise the Electron glue. Do NOT skip; a screenshot of a working update proves nothing about the failure paths.

- [ ] **Step 1: Notify-first happy path — must actually RELAUNCH on the new version (Finding 10).**
  Package (`pnpm run studio:pack`), launch the built `.app`. With a newer version published to the mirror, confirm: the app boots normally, then within ~30s an "Update available — vX" prompt appears (NOT an automatic restart). Click **Later** → prompt dismisses, app keeps running. Reload the shell (Cmd-R) → prompt does NOT return for the same version (localStorage persistence, Finding 9). Relaunch the app fresh → prompt returns. Click **Install & restart** → "Updating…" shows, app quits AND **relaunches running the new version** (check the Settings footer / `/api/version` shows vX, not just that it quit — `before-quit` does `app.exit(0)`, and this gate confirms ShipIt still completes the swap; Finding 10). Verify via log: `offering to the shell` → `install requested` → `update_applied` → `applying`.

- [ ] **Step 2: Turn-aware defer.**
  Start a generation, then click **Install & restart** mid-turn. Confirm the app does NOT quit until the turn finishes (log: `applyWhenIdle` waits), then applies and relaunches on the new version.

- [ ] **Step 3: Visible boot failure (the 0.42.0 mode).**
  Package a deliberately broken build (temporarily move `typescript` back to devDependencies, `pnpm run studio:pack`, then restore). Launch the `.app`. Confirm: main retries `startVite` at most 2 times (log: `attempt: 1`, `attempt: 2`), then the **error screen** renders (dark card, "Arcade Studio couldn't start", the log path, a Quit button) instead of a blank hang, and `boot_error_shown` is emitted. Click **Quit** → app exits cleanly. Restore `typescript` to dependencies afterward.

- [ ] **Step 4: Slow-but-healthy boot does not false-fail.**
  Confirm a normal (sometimes slow, port-reclaiming) boot still reaches the app within the 2-attempt budget and does NOT show the error screen. (The per-attempt `startVite` already has a 30s timeout; the bound is on attempts, not a shorter deadline.)

- [ ] **Step 5: `loadURL`-failure fallback (Finding 7).**
  Harder to force deterministically; if reproducible, confirm that a Vite process that answers the port check but then dies before the page loads triggers `did-fail-load` → the error page (not a blank window). If not reproducible in the session, note it as covered-by-code-review with the `bootErrorShown` guard.

- [ ] **Step 6: Stalled-install escape (Finding 6).**
  Simulate a non-relaunching install if feasible (e.g. run from a translocated/read-only path so `quitAndInstall` can't swap). Confirm the "Updating…" modal flips to "Update didn't start" after ~60s with a **Keep using this version** button, that clicking it dismisses and the app stays usable, and that `/api/update/clear` reset the server state (next `GET /api/update/status` shows `installRequested:false`).

- [ ] **Step 7: Record the outcome** in the PR description with the log excerpts, explicitly noting the Step 1 relaunch-verified result and which of Steps 5–6 were reproduced vs code-review-covered.

---

## Self-Review notes

- **Spec coverage:** 1c (Task 1), 2a notify-first (Tasks 2–4), transport (Task 2), shell UI (Task 4), 2b visible-failure recovery + runbook (Tasks 1 & 5), testing strategy incl. false-recovery guard (Task 6 step 4). Auto-roll-back intentionally absent (cut in spec).
- **Deviation from spec, noted:** the error page is an INLINE HTML string (`bootError.ts`) loaded via a `data:` URL, not a bundled `.html` asset. Rationale: a separate asset under `electron/` is not in the electron-builder `files` glob (`electron/dist/**/*` only) — shipping it would risk the exact "asset missing from the packaged app" bug we just fixed in 0.42.1. Inline is bundling-proof and unit-testable. Same visible behavior; Quit still via `window.close()`, no IPC.
- **`autoInstallOnAppQuit` decision:** set to `false` (strict "tester chooses" — the user's selected option). Documented in Task 3.
- **Type consistency:** `UpdateStatus`/`{pendingVersion, installRequested}` shape identical across registry, middleware, lib, and component. `setPending`/`requestInstall`/`getUpdateState`/`clearPending` names consistent.

## Adversarial review (2026-07-07) — 11 findings, all folded in

Reviewed against the real code before any implementation. Resolutions:
- **F1 (test races the async handler):** `invoke()` + all call sites made `async`/`await` in Task 2's middleware test.
- **F2 (destructive umbrella edit deletes the declarations it says to keep):** Task 3 Step 1 reworded to four surgical, non-contiguous edits with exact line anchors; nothing deleted wholesale.
- **F3 (createWindow layout mismatch):** Task 1 Step 5 rewritten as a full verbatim `createWindow` body — window first, listeners right after the constructor, Vite gated after.
- **F4 (deep link dropped during longer startup):** added `windowReady` flag; `open-url` guard is now `mainWindow && windowReady`.
- **F5 (force-branch now kills a >30min turn):** kept the required code change; flagged the behavior shift in Task 3d and the 0.43.0 CHANGELOG.
- **F6 (dead `clearPending` → stuck "Updating…"):** added `POST /api/update/clear` + a 60s `INSTALL_TIMEOUT_MS` escape ("Keep using this version") in `UpdateBanner`; residual caveat documented.
- **F7 (`loadURL` failure → blank window):** `did-fail-load` now loads the error page once, guarded so the `data:` URL can't recurse.
- **F8 (no telemetry):** `update_offered`/`update_install_clicked`/`update_dismissed` in the shell; `boot_error_shown` + `update_applied` in main.
- **F9 ("Later" re-nags on reload):** dismissal persisted to `localStorage` (`arcade-studio:update-dismissed`), mirroring WhatsNewModal.
- **F10 (must verify relaunch, not just quit):** Task 6 Step 1 now asserts the app relaunches on the new version (both idle + force paths), confirming `app.exit(0)` doesn't abort the ShipIt swap.
- **F11 (30-min re-offer gap if early POST races Vite):** `postUpdateAvailable` given a 5×5s bounded retry.

Verified-fine by the review (kept as-is): `127.0.0.1:5556` hardcode, `window.close()` quit path, `LOG_FILE` scope, version/changelog format, `Modal.*`/`Button` API, the `applying` guard, `installWatchTimer` needing no explicit cleanup (unref'd), and the pure-logic tests being real behavior tests.
