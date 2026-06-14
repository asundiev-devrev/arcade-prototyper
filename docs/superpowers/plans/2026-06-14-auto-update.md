# In-app Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arcade Studio update itself — download a new version in the background and apply it automatically (deferring the required restart while a generation turn is running) — instead of forcing beta testers to manually download a new .dmg.

**Architecture:** Revive the dormant `electron-updater` already wired into the app. Three units: (1) the mac build emits a `zip` + `latest-mac.yml` and a scripted release publishes them notarized to the mirror repo; (2) `electron/updater.ts` auto-downloads then auto-restarts, but defers the restart while a turn is active, decided by a pure `decideApply` function; (3) a new `GET /api/turns/active` endpoint lets the Electron main process (no IPC channel to the server child) poll whether a turn is running over localhost HTTP. The old manual `UpdateBanner` + `/api/version/check` are removed.

**Tech Stack:** Electron, electron-updater ^6.8.3, electron-builder ^25.1.8, TypeScript, Vitest, macOS notarytool, gh CLI.

**Spec:** `docs/superpowers/specs/2026-06-14-auto-update-design.md`

**Commands:** tests run from repo root: `pnpm run studio:test <path-relative-to-studio>`. Known pre-existing failures to IGNORE: `__tests__/components/home/hero-prompt-input.test.tsx` and the relay/`wsServer` port-flake tests — unrelated, fail under parallel load.

---

## File Structure

- `studio/server/turnRegistry.ts` — MODIFY: add `hasActiveTurn()` (registry-wide "is any turn running"). The `turns` map is module-private, so the read must live here.
- `studio/server/middleware/turns.ts` — CREATE: `turnsMiddleware()` serving `GET /api/turns/active` → `{ active: boolean }`.
- `studio/vite.config.ts` — MODIFY: register `turnsMiddleware()`; remove nothing here yet.
- `electron/updater.ts` — MODIFY: extract pure `decideApply()`, add turn-aware deferred restart, periodic re-check.
- `electron-builder.yml` — MODIFY: add `zip` target to the mac block.
- `studio/packaging/scripts/release.sh` — CREATE: scripted notarized release (dmg + zip + latest-mac.yml).
- `studio/CLAUDE.md` — MODIFY: replace the manual release section with the script.
- `studio/src/components/feedback/UpdateBanner.tsx` — DELETE.
- `studio/src/App.tsx` — MODIFY: remove the `UpdateBanner` import + mount.
- `studio/server/middleware/version.ts` — MODIFY: remove the `/api/version/check` handler + `checkForUpdate` + cache (keep `/api/version` and `/api/changelog`).
- `studio/__tests__/server/middleware/versionCheck.test.ts` — DELETE (tests the removed handler).
- `studio/__tests__/server/turnRegistry.test.ts` — MODIFY/CREATE: test `hasActiveTurn`.
- `studio/__tests__/server/middleware/turns.test.ts` — CREATE.
- `electron/__tests__/decideApply.test.ts` (or co-located vitest) — CREATE: `decideApply` truth table. NOTE: electron/ has no test setup today; Task 3 addresses where this runs.

---

## Task 1: `hasActiveTurn()` in the turn registry

**Files:**
- Modify: `studio/server/turnRegistry.ts` (the `turns` map is defined at line 37; `getTurn` at 175)
- Test: `studio/__tests__/server/turnRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `studio/__tests__/server/turnRegistry.test.ts` (create the file with this content if it does not exist):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  startTurn,
  hasActiveTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";

describe("hasActiveTurn", () => {
  beforeEach(() => __resetTurnRegistryForTests());

  it("is false when no turns exist", () => {
    expect(hasActiveTurn()).toBe(false);
  });

  it("is true while a turn is running", () => {
    startTurn("proj-a", { prompt: "x", run: () => { /* never ends */ } });
    expect(hasActiveTurn()).toBe(true);
  });

  it("is false after the only turn finishes", () => {
    startTurn("proj-a", {
      prompt: "x",
      run: ({ end }) => { end({ ok: true }); },
    });
    expect(hasActiveTurn()).toBe(false);
  });

  it("is true if ANY of several turns is running", () => {
    startTurn("proj-done", { prompt: "x", run: ({ end }) => end({ ok: true }) });
    startTurn("proj-live", { prompt: "y", run: () => { /* never ends */ } });
    expect(hasActiveTurn()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/turnRegistry.test.ts`
Expected: FAIL — `hasActiveTurn` is not exported.

- [ ] **Step 3: Implement `hasActiveTurn`**

In `studio/server/turnRegistry.ts`, add directly after the `getTurn` function (around line 177):

```typescript
/**
 * Registry-wide check: is ANY project's turn currently running? Used by the
 * Electron auto-updater (over /api/turns/active) to defer an update restart
 * while a generation is in flight. The `turns` map is module-private, so this
 * read must live here.
 */
export function hasActiveTurn(): boolean {
  for (const turn of turns.values()) {
    if (turn.status === "running") return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/turnRegistry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/server/turnRegistry.ts studio/__tests__/server/turnRegistry.test.ts
git commit -m "feat(studio/updater): hasActiveTurn() registry-wide check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `GET /api/turns/active` middleware

**Files:**
- Create: `studio/server/middleware/turns.ts`
- Modify: `studio/vite.config.ts` (imports near line 7-39; registration near line 59)
- Test: `studio/__tests__/server/middleware/turns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/middleware/turns.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { turnsMiddleware } from "../../../server/middleware/turns";
import { startTurn, __resetTurnRegistryForTests } from "../../../server/turnRegistry";

let server: http.Server;
let port: number;

beforeEach(async () => {
  __resetTurnRegistryForTests();
  server = http.createServer((req, res) => {
    turnsMiddleware()(req, res, () => {
      res.writeHead(404);
      res.end("not handled");
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});
afterEach(() => {
  server.close();
  __resetTurnRegistryForTests();
});

async function get(path: string) {
  const res = await fetch(`http://localhost:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /api/turns/active", () => {
  it("returns active:false when idle", async () => {
    const r = await get("/api/turns/active");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ active: false });
  });

  it("returns active:true while a turn runs", async () => {
    startTurn("p", { prompt: "x", run: () => { /* never ends */ } });
    const r = await get("/api/turns/active");
    expect(r.body).toEqual({ active: true });
  });

  it("passes non-matching routes to next()", async () => {
    const r = await get("/api/something-else");
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/turns.test.ts`
Expected: FAIL — cannot import `turnsMiddleware`.

- [ ] **Step 3: Implement the middleware**

Create `studio/server/middleware/turns.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { hasActiveTurn } from "../turnRegistry";

/**
 * GET /api/turns/active → { active: boolean }
 *
 * Read-only view of whether ANY generation turn is currently running. The
 * Electron auto-updater (a separate process with no IPC channel to this
 * server) polls this before applying a downloaded update, so it can defer the
 * required restart until the user's work is done. Intentionally tiny and
 * unauthenticated — it leaks no data, just a boolean, on localhost.
 */
export function turnsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.method === "GET" && (req.url === "/api/turns/active" || req.url?.startsWith("/api/turns/active?"))) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: hasActiveTurn() }));
      return;
    }
    return next?.();
  };
}
```

- [ ] **Step 4: Register in vite.config.ts**

In `studio/vite.config.ts`, add the import beside the other middleware imports (near line 15):

```typescript
import { turnsMiddleware } from "./server/middleware/turns";
```

And register it beside `versionMiddleware()` (near line 59):

```typescript
      server.middlewares.use(turnsMiddleware());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/turns.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/turns.ts studio/__tests__/server/middleware/turns.test.ts studio/vite.config.ts
git commit -m "feat(studio/updater): GET /api/turns/active endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `decideApply()` pure function + electron test setup

**Files:**
- Modify: `electron/updater.ts`
- Create: `electron/tsconfig` already exists; tests run via the studio vitest config. Place the test at `studio/__tests__/electron/decideApply.test.ts` so it runs in the existing suite (electron/ has no standalone test runner; the function is pure TS and importable).
- Test: `studio/__tests__/electron/decideApply.test.ts`

NOTE: `decideApply` must be exported from `electron/updater.ts` and import nothing from `electron` (keep it pure) so the studio vitest can import it without an Electron runtime.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/electron/decideApply.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decideApply, DEFER_CAP_MS } from "../../../electron/updater";

describe("decideApply", () => {
  it("restarts immediately when no turn is active", () => {
    expect(decideApply({ turnActive: false, deferredMs: 0 })).toBe("restart");
  });

  it("waits while a turn is active and under the defer cap", () => {
    expect(decideApply({ turnActive: true, deferredMs: 0 })).toBe("wait");
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS - 1 })).toBe("wait");
  });

  it("forces apply-on-quit once a turn outlasts the defer cap", () => {
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS })).toBe("force");
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS + 1 })).toBe("force");
  });

  it("restarts when idle even if previously deferred past the cap", () => {
    expect(decideApply({ turnActive: false, deferredMs: DEFER_CAP_MS + 9999 })).toBe("restart");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/electron/decideApply.test.ts`
Expected: FAIL — `decideApply` / `DEFER_CAP_MS` not exported.

- [ ] **Step 3: Add the pure function to `electron/updater.ts`**

At the TOP of `electron/updater.ts` (before `initUpdater`), add:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/electron/decideApply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/updater.ts studio/__tests__/electron/decideApply.test.ts
git commit -m "feat(studio/updater): pure decideApply() for turn-aware restart

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Wire decideApply into the updater (turn-aware auto-restart)

**Files:**
- Modify: `electron/updater.ts` (the `update-downloaded` handler at lines 32-48; the file imports `app, dialog` at line 1)

NOTE: this is Electron glue around the already-tested `decideApply`. It is exercised by the manual live-update test (Task 8), not a unit test — mocking `autoUpdater` + `BrowserWindow` + `fetch` here would test the mock, not the behavior. Keep the glue thin.

- [ ] **Step 1: Replace the update-downloaded handler**

In `electron/updater.ts`, change the import line 1 to include `Notification`:

```typescript
import { app, dialog, Notification } from "electron";
```

Replace the entire `autoUpdater.on("update-downloaded", …)` block (lines 32-48) with:

```typescript
  autoUpdater.on("update-downloaded", (info) => {
    void applyWhenIdle(info.version, 0);
  });
```

Then add these helpers below the `initUpdater` function (still inside the module):

```typescript
/** Poll interval while waiting for an active turn to finish. */
const POLL_MS = 15 * 1000;

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
  // Small delay so the notice paints before the app quits.
  setTimeout(() => autoUpdater.quitAndInstall(), 1200);
}
```

- [ ] **Step 2: Add periodic re-check in initUpdater**

In `electron/updater.ts`, inside `initUpdater()`, after the existing
`autoUpdater.checkForUpdates().catch(...)` call (line 52-54), add:

```typescript
  // Re-check every 30 minutes so a long-lived session still picks up a release
  // published after launch. unref so the timer never keeps the app alive.
  const RECHECK_MS = 30 * 60 * 1000;
  const timer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[updater] periodic checkForUpdates failed:", err);
    });
  }, RECHECK_MS);
  timer.unref?.();
```

- [ ] **Step 3: Typecheck the electron build**

Run: `pnpm exec tsc --noEmit -p electron/tsconfig.json`
Expected: no new errors in `electron/updater.ts`.

- [ ] **Step 4: Re-run the decideApply test (unaffected, sanity)**

Run: `pnpm run studio:test __tests__/electron/decideApply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/updater.ts
git commit -m "feat(studio/updater): auto-apply update, defer restart while a turn runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Add the `zip` target to the mac build

**Files:**
- Modify: `electron-builder.yml` (mac block at lines 62-67; `target:` list at 65-67)

- [ ] **Step 1: Add zip beside dmg**

In `electron-builder.yml`, change the mac `target:` list (lines 65-67) from:

```yaml
  target:
    - target: dmg
      arch: arm64
```

to:

```yaml
  target:
    - target: dmg     # human first-install
      arch: arm64
    - target: zip     # auto-update payload — electron-updater reads this + latest-mac.yml
      arch: arm64
```

- [ ] **Step 2: Verify the config still parses (packaging scaffold test)**

Run: `pnpm run studio:test __tests__/packaging/scaffold.test.ts`
Expected: PASS. If the scaffold test asserts the exact target list, update that assertion to include `zip`.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "feat(studio/updater): emit zip target for electron-updater payload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Scripted notarized release

**Files:**
- Create: `studio/packaging/scripts/release.sh`
- Modify: `studio/CLAUDE.md` (release section, around the manual notarize/staple/rewrap steps)

NOTE: this script wraps the manual dance documented in `studio/CLAUDE.md`. It cannot be unit-tested — it shells out to electron-builder, notarytool, and gh. It is verified by the manual pack-time test (Task 8). Write it defensively: fail fast on any non-zero step (`set -euo pipefail`), and echo each phase.

- [ ] **Step 1: Write the script**

Create `studio/packaging/scripts/release.sh`:

```bash
#!/usr/bin/env bash
#
# Cut a notarized auto-updatable release of Arcade Studio.
#
# Produces dmg + zip + latest-mac.yml, notarizes BOTH artifacts, staples the
# .app, and publishes all three to the public mirror repo so the in-app
# auto-updater (electron-updater) can find and apply the update.
#
# Prereqs (same as the old manual flow in studio/CLAUDE.md):
#   - notarytool keychain profile "arcade-studio-notarize" set up
#   - gh authenticated with access to asundiev-devrev/arcade-studio-releases
#   - run from the repo root
#
# Usage:  bash studio/packaging/scripts/release.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
MIRROR="asundiev-devrev/arcade-studio-releases"
DIST="dist"
APP="$DIST/mac-arm64/Arcade Studio.app"
DMG="$DIST/Arcade Studio-${VERSION}-arm64.dmg"
ZIP="$DIST/Arcade Studio-${VERSION}-arm64-mac.zip"
YML="$DIST/latest-mac.yml"

echo "==> Releasing Arcade Studio ${VERSION}"

# 1. Build dmg + zip + latest-mac.yml (no auto-publish; we publish manually
#    after notarizing). --publish never matches studio:pack.
echo "==> Packing (dmg + zip)…"
pnpm run kit:build
bash studio/packaging/scripts/fetch-cli-deps.sh
pnpm exec tsc -p electron/tsconfig.json
node studio/packaging/scripts/gen-telemetry-config.mjs
pnpm exec electron-builder --mac --config electron-builder.yml --publish never

for f in "$DMG" "$ZIP" "$YML"; do
  [ -f "$f" ] || { echo "ERROR: expected build artifact missing: $f"; exit 1; }
done

# 2. Staple the .app FIRST (Gatekeeper checks the extracted app's ticket; a zip
#    can't be stapled). electron-builder notarizes nothing (notarize:false), so
#    we notarize the dmg, then staple the .app, then RE-ZIP the stapled app so
#    the zip the updater downloads contains a stapled app.
echo "==> Notarizing dmg…"
xcrun notarytool submit "$DMG" --keychain-profile arcade-studio-notarize --wait
echo "==> Stapling .app…"
xcrun stapler staple "$APP"
xcrun stapler staple "$DMG"

# 3. Re-zip the now-stapled .app, replacing electron-builder's zip, and
#    recompute latest-mac.yml's sha512/size so the manifest matches the zip we
#    actually ship. (ditto produces the same archive format electron-updater
#    expects.)
echo "==> Re-zipping stapled .app…"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

echo "==> Rewriting latest-mac.yml sha512/size for the stapled zip…"
node studio/packaging/scripts/rewrite-latest-mac.mjs "$ZIP" "$YML" "$VERSION"

# 4. Notarize the (stapled-app) zip too, so Gatekeeper accepts the updated app.
echo "==> Notarizing zip…"
xcrun notarytool submit "$ZIP" --keychain-profile arcade-studio-notarize --wait

# 5. Publish dmg + zip + latest-mac.yml to the mirror.
echo "==> Publishing v${VERSION} to ${MIRROR}…"
NOTES_FILE="$(mktemp)"
awk "/^## \\[${VERSION}\\]/{f=1;next} /^## \\[/{f=0} f" studio/CHANGELOG.md > "$NOTES_FILE" || true
gh release create "v${VERSION}" \
  "$DMG" "$ZIP" "$YML" \
  --repo "$MIRROR" \
  --title "Arcade Studio ${VERSION}" \
  --notes-file "$NOTES_FILE" \
  --latest
rm -f "$NOTES_FILE"

echo "==> Done. v${VERSION} published with dmg + zip + latest-mac.yml."
```

- [ ] **Step 2: Write the manifest-rewrite helper**

Create `studio/packaging/scripts/rewrite-latest-mac.mjs`:

```javascript
#!/usr/bin/env node
// Recompute latest-mac.yml's sha512 + size for a (re-zipped, stapled) artifact.
// electron-updater verifies the downloaded zip against the manifest's sha512;
// re-zipping the stapled .app changes the bytes, so the manifest MUST be
// rewritten to match or the update is rejected.
//
// Usage: node rewrite-latest-mac.mjs <zipPath> <ymlPath> <version>
import fs from "node:fs";
import crypto from "node:crypto";

const [, , zipPath, ymlPath, version] = process.argv;
if (!zipPath || !ymlPath || !version) {
  console.error("usage: rewrite-latest-mac.mjs <zipPath> <ymlPath> <version>");
  process.exit(1);
}

const bytes = fs.readFileSync(zipPath);
const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
const size = bytes.length;
const zipName = zipPath.split("/").pop();

// electron-updater's latest-mac.yml shape (the fields it actually reads).
const yml = `version: ${version}
files:
  - url: ${zipName}
    sha512: ${sha512}
    size: ${size}
path: ${zipName}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`;
fs.writeFileSync(ymlPath, yml);
console.log(`[rewrite-latest-mac] ${zipName} sha512=${sha512.slice(0, 12)}… size=${size}`);
```

NOTE on `releaseDate`: `new Date()` here runs at release time in a one-shot script (not a resumable workflow), so it is fine.

- [ ] **Step 3: Make the script executable + smoke-parse it**

Run:
```bash
chmod +x studio/packaging/scripts/release.sh
bash -n studio/packaging/scripts/release.sh && echo "release.sh syntax OK"
node --check studio/packaging/scripts/rewrite-latest-mac.mjs && echo "rewrite-latest-mac.mjs syntax OK"
```
Expected: both "OK" lines.

- [ ] **Step 4: Update studio/CLAUDE.md**

In `studio/CLAUDE.md`, replace the manual "Notarize + staple manually" + "Publish a release" steps with:

```markdown
4. **Cut the release with the scripted command:**
   ```
   bash studio/packaging/scripts/release.sh
   ```
   This builds dmg + zip + latest-mac.yml, notarizes both artifacts, staples
   the .app, rewrites the manifest sha512 to match the stapled zip, and
   publishes all three to the public mirror (asundiev-devrev/arcade-studio-releases).
   The zip + latest-mac.yml are what the in-app auto-updater consumes; the dmg
   is for first-install. Reads the version from package.json#version and the
   notes from the matching studio/CHANGELOG.md section.

   `pnpm run studio:release` is still NOT safe (it skips manual notarize) — use
   the script above.
```

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/scripts/release.sh studio/packaging/scripts/rewrite-latest-mac.mjs studio/CLAUDE.md
git commit -m "feat(studio/updater): scripted notarized release (dmg + zip + manifest)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Remove the manual UpdateBanner + /api/version/check

**Files:**
- Delete: `studio/src/components/feedback/UpdateBanner.tsx`
- Modify: `studio/src/App.tsx` (import at line 7; mount at line 118)
- Modify: `studio/server/middleware/version.ts` (remove `/api/version/check`, `checkForUpdate`, `compareSemver`, cache, `UpdateCheckResult`, `GITHUB_RELEASES_URL`, `UPDATE_CHECK_TTL_MS`; KEEP `/api/version`, `/api/changelog`, `readVersion`, `logVersionOnBoot`)
- Delete: `studio/__tests__/server/middleware/versionCheck.test.ts`

- [ ] **Step 1: Remove the banner mount from App.tsx**

In `studio/src/App.tsx`, delete the import (line 7):
```typescript
import { UpdateBanner } from "./components/feedback/UpdateBanner";
```
and delete the mount (line 118):
```typescript
      <UpdateBanner />
```

- [ ] **Step 2: Delete the banner component + its test**

Run:
```bash
git rm studio/src/components/feedback/UpdateBanner.tsx
git rm studio/__tests__/server/middleware/versionCheck.test.ts
```

- [ ] **Step 3: Strip /api/version/check from version.ts**

In `studio/server/middleware/version.ts`:
- Delete `GITHUB_RELEASES_URL`, `UPDATE_CHECK_TTL_MS`, `UpdateCheckCache`, `updateCheckCache`, `UpdateCheckResult`, `compareSemver`, and `checkForUpdate` (the whole update-check apparatus).
- In `versionMiddleware()`, delete the entire `if (req.method === "GET" && url === "/api/version/check") { … }` block.
- Keep `/api/version`, `/api/changelog`, `readVersion`, `readChangelog`, `logVersionOnBoot`, and the path constants.

- [ ] **Step 4: Verify nothing else imports the removed symbols**

Run:
```bash
grep -rn "version/check\|checkForUpdate\|UpdateCheckResult\|UpdateBanner" studio/src studio/server studio/__tests__ | grep -v node_modules
```
Expected: no matches (empty output). If any remain, remove those references.

- [ ] **Step 5: Typecheck + run the version middleware's surviving tests**

Run:
```bash
pnpm exec tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -E "version\.ts|App\.tsx|UpdateBanner" || echo "no type errors in touched files"
pnpm run studio:test __tests__/server/middleware/version.test.ts 2>&1 | tail -4 || echo "no version.test.ts — fine"
```
Expected: no type errors in touched files; any surviving version test passes.

- [ ] **Step 6: Commit**

```bash
git add studio/src/App.tsx studio/server/middleware/version.ts
git commit -m "refactor(studio/updater): remove manual UpdateBanner + /api/version/check

Auto-update replaces the manual download path. Keeps /api/version (Settings
footer) and /api/changelog.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Full suite + manual release/update verification (HANDOFF)

**Files:** none (verification).

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: green EXCEPT the known pre-existing failures (`hero-prompt-input.test.tsx`; relay/`wsServer` port-flake). New tests (turnRegistry, turns, decideApply) all pass; no NEW failures.

- [ ] **Step 2: Typecheck both projects**

Run:
```bash
pnpm exec tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -vE "pre-existing" | tail
pnpm exec tsc --noEmit -p electron/tsconfig.json
```
Expected: no new errors in touched files.

- [ ] **Step 3: MANUAL — pack-time artifact check (needs signing creds)**

This requires Apple notarization credentials and cannot run in CI. Hand off to the maintainer (or run with their machine/creds):

```bash
bash studio/packaging/scripts/release.sh   # to a throwaway test tag if possible
```
Verify in `dist/`:
- `Arcade Studio-<v>-arm64.dmg`, `Arcade Studio-<v>-arm64-mac.zip`, `latest-mac.yml` all exist.
- `shasum -a 512 "dist/Arcade Studio-<v>-arm64-mac.zip" | xxd -r -p | base64` matches the `sha512` in `latest-mac.yml`. (Or trust `rewrite-latest-mac.mjs`, which computes it from the same bytes.)
- `xcrun stapler validate "dist/mac-arm64/Arcade Studio.app"` → "The validate action worked!"
- Both dmg and zip notarytool submissions returned `status: Accepted`.

- [ ] **Step 4: MANUAL — live self-update (the real proof)**

1. Install version N from the dmg (drag to /Applications, launch).
2. Bump `package.json#version` to N+1, add a CHANGELOG entry, run `release.sh`.
3. Launch the installed N. Within ~the check interval it should auto-download N+1 in the background.
4. Start a generation turn; confirm the restart is DEFERRED until the turn finishes (watch the launcher log for `[updater] … deferred`/`applying`).
5. Let it idle → confirm the "Updating Arcade Studio" notice + automatic relaunch onto N+1 (check the Settings footer version).

- [ ] **Step 5: Final commit (if any doc tweaks fall out of verification)**

```bash
git add -A studio/ electron/ docs/
git commit -m "docs(studio/updater): record auto-update verification results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Notes on sequencing & risk

- Tasks 1-4 (server endpoint + updater logic) and Task 5 (zip target) are independent of Task 7 (banner removal) — but do Task 7 last among the code tasks so the app keeps a working update path until auto-update is in place.
- Tasks 6 + 8's manual steps are the genuine end-to-end proof and require Apple signing creds. Everything else (logic, endpoint, config, removal) is fully verifiable in CI before that handoff.
- The release.sh re-zip step (staple .app → ditto re-zip → rewrite manifest sha512) is the load-bearing correctness detail: electron-builder's own zip is made BEFORE the staple, so shipping it would deliver an unstapled app whose manifest hash wouldn't match after re-zipping. Verify on the first real pack (Task 8 Step 3) — if electron-builder is found to staple-then-zip on its own, the re-zip + rewrite steps can be dropped.
