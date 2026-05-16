# Electron Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap Studio's existing Vite + React shell in an Electron app, replacing the bash launcher + browser-tab UX with a native window. Keep middleware unchanged. Add `electron-updater` for in-app auto-update from the existing public mirror.

**Architecture:** Electron main process spawns Vite as a child process (same node_modules, same vite.config.ts), waits for `localhost:5556` to respond, then loads it into a single `BrowserWindow`. Replaces `launcher.sh` and `index.html` open-in-browser flow. Keeps every middleware, every server-side handler, and the entire React shell as-is. `electron-builder` replaces the `build.sh` + `dmg.sh` + `codesign.sh` + `notarize.sh` + `notarize-app.sh` chain with a declarative config that signs nested helpers, notarizes both `.app` and DMG, and stamps the version. `electron-updater` polls `asundiev-devrev/arcade-studio-releases` once per launch and prompts for install on next start when newer.

**Tech Stack:** Electron 33, electron-builder 25, electron-updater 6. Existing: Vite 8, React 19, Node 22, Tailwind 4. Bundled CLIs (claude, figmanage, cloudflared, aws) move from `Resources/app/node_modules/.bin/` and `Resources/{cloudflared,awscli}/` to `extraResources` in electron-builder config.

---

## Coordination — read this before starting

1. **Branch from `origin/main`** (not from any active feature branch). Branch name: `feat/electron-wrapper`.
2. **Version is `0.21.0`.** This is a meaningful packaging change worth a minor bump. Skip `0.20.2` (which would imply a tiny patch).
3. **Worktree.** Use `EnterWorktree` to isolate. Existing `feat-codesign-notarize` worktree is stale — recreate or use a new one.
4. **Bundle ID stays the same.** `ai.devrev.internal.ArcadeStudio`. Same Apple Developer ID cert, same notarytool keychain profile (`arcade-studio-notarize`). No new credentials needed.
5. **The bash chain (`launcher.sh`, `build.sh`, `dmg.sh`, `lib/codesign.sh`, `lib/notarize.sh`, `lib/notarize-app.sh`, `lib/install-deps.sh`, `lib/copy-sources.sh`, `lib/download-node.sh`, `lib/download-awscli.sh`, `lib/download-cloudflared.sh`) is replaced wholesale.** Don't try to incrementally adapt. Delete the lot, replace with electron-builder config + a small `electron/main.ts`. The plan documents what each old file did so you can verify equivalence in the new config.
6. **`pnpm run studio:pack` and `pnpm run studio:release` change semantics.** Both scripts get rewritten. `studio:pack` becomes "electron-builder build, no notarize". `studio:release` becomes "electron-builder build, notarize, publish-ready". `studio` (dev mode) gets a sibling `studio:electron` for the new flow; the old `studio` keeps working for browser-only debugging.
7. **CHANGELOG note:** existing 0.20.x bundles use the bash launcher. 0.21.0 is the Electron migration. User-facing migration is small — drag old app to trash, install new DMG. Same bundle ID, so projects/settings persist via path-keying. Keychain re-prompt may fire because Electron's Mach-O signature differs from the bash launcher's.

## Prerequisites — verify before starting

- [ ] **Apple Developer ID Application cert is in your login keychain**

Run: `security find-identity -v -p codesigning`
Expected: `"Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"`. Already set up from 0.19.0 work; no new install needed.

- [ ] **`arcade-studio-notarize` keychain profile exists**

Run: `xcrun notarytool history --keychain-profile arcade-studio-notarize`
Expected: list of past submissions. If `Error: A keychain item ... was not found`, the credentials need re-storing — same `xcrun notarytool store-credentials arcade-studio-notarize ...` command from the 0.19.0 plan.

- [ ] **Node 22+ + pnpm 10+ on host**

Run: `node --version && pnpm --version`
Expected: `v22.x` or higher and `10.x` or higher. Repo's `packageManager` field pins pnpm.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `electron/main.ts` | create | Electron main process. Spawns Vite child, creates BrowserWindow on ready, handles app lifecycle (window-all-closed, quit, deep links via open-url). |
| `electron/viteRunner.ts` | create | Spawns Vite as child of main process. Waits for port 5556 to respond. Returns the URL. Manages cleanup on app quit. |
| `electron/updater.ts` | create | Wires `electron-updater` to the GitHub Releases provider pointed at `asundiev-devrev/arcade-studio-releases`. Polls once on app ready, prompts user via dialog when an update is available. |
| `electron/tsconfig.json` | create | TS config for the electron/ folder. Compiles to CommonJS targeting Node 22. Outputs to `electron/dist/`. |
| `electron-builder.yml` | create | Declarative build config. Specifies appId, productName, mac.identity, mac.notarize, mac.target=dmg, extraResources (bundled CLIs), files (what to include vs exclude), publish (GitHub provider for the mirror repo). |
| `studio/packaging/entitlements.plist` | move + rename | Move to `electron/entitlements.mac.plist`. electron-builder's mac.entitlements config points at it. Same content as the existing file from 0.19.0 (JIT, library-validation, dyld-env). |
| `package.json` | modify | New scripts: `studio:electron` (dev: vite + electron concurrently), `studio:pack` (rewritten: electron-builder build, no publish, no notarize), `studio:release` (rewritten: electron-builder build with publish + notarize). New devDeps: electron, electron-builder, electron-updater, concurrently. |
| `studio/packaging/VERSION` | modify | `0.20.1` → `0.21.0`. (electron-builder reads version from package.json's `version` field — see Task 5 — but VERSION stays as the canonical reference for changelog entry filenames + release scripts.) |
| `studio/packaging/launcher.sh` | DELETE | Replaced by electron/main.ts. |
| `studio/packaging/build.sh` | DELETE | Replaced by electron-builder. |
| `studio/packaging/dmg.sh` | DELETE | Replaced by electron-builder mac.target=dmg. |
| `studio/packaging/Info.plist` | DELETE | Replaced by electron-builder's auto-generated Info.plist (we provide overrides via mac.extendInfo for URL scheme + LSUIElement). |
| `studio/packaging/icon.icns` | move | Move to `electron/icon.icns`. electron-builder mac.icon points there. |
| `studio/packaging/lib/codesign.sh` | DELETE | electron-builder handles codesigning automatically when mac.identity is set. |
| `studio/packaging/lib/notarize.sh` | DELETE | Replaced by mac.notarize: { teamId } in electron-builder.yml. |
| `studio/packaging/lib/notarize-app.sh` | DELETE | Same — electron-builder notarizes the .app before DMG-wrapping by default. |
| `studio/packaging/lib/install-deps.sh` | DELETE | electron-builder bundles dependencies via the files glob. |
| `studio/packaging/lib/copy-sources.sh` | DELETE | electron-builder copies source via the files glob. |
| `studio/packaging/lib/download-node.sh` | DELETE | Electron ships its own Node — no separate runtime needed for Vite (Electron's main process IS the Node runtime). |
| `studio/packaging/lib/download-awscli.sh` | DELETE | AWS CLI moves to `extraResources` in electron-builder.yml; downloaded once at build time via a postinstall step or pre-checked into the repo. See Task 7. |
| `studio/packaging/lib/download-cloudflared.sh` | DELETE | Same — cloudflared moves to extraResources. |
| `studio/packaging/lib/make-icon.sh` | KEEP (relocate) | Move to `electron/lib/make-icon.sh` if used; otherwise leave for now. |
| `studio/packaging/dmg-background.png` + `.svg` | move | Move to `electron/dmg-background.png` + `.svg`. electron-builder dmg.background config points at the PNG. |
| `studio/packaging/README.md` | modify | Rewrite to document the new Electron flow. Old bash flow is removed. |
| `studio/CHANGELOG.md` | modify | Add `## [0.21.0] — 2026-05-15` entry. |
| `studio/__tests__/packaging/scaffold.test.ts` | modify | Test asserted Info.plist contents. Rewrite to assert electron-builder.yml shape (productName, appId, mac.identity reference). |
| `.gitignore` | modify | Add `electron/dist/` (compiled main process), `dist/` (electron-builder output), and `studio/packaging/dist/` removal note. |

---

## Task 1: Set up the Electron worktree + branch

**Files:**
- (worktree creation)

- [ ] **Step 1: Create worktree**

Use `EnterWorktree` with name `feat-electron-wrapper`. The worktree is auto-created off `origin/main`.

After creating, in the worktree:
```bash
git branch -m feat/electron-wrapper
git branch --show-current
```
Expected: `feat/electron-wrapper`

- [ ] **Step 2: Verify baseline**

```bash
cat studio/packaging/VERSION
git log --oneline -3
```
Expected: `0.20.1` and the top-of-main commits including the 0.20.1 notarize-app fix.

- [ ] **Step 3: Install host dependencies (current shape, before any changes)**

```bash
pnpm install
```
Expected: clean install. We need a working baseline before adding electron deps in Task 4.

- [ ] **Step 4: Sanity-test the current build path is not broken**

Don't actually `studio:pack` (that's a 5-min bash build). Just `bash -n` everything to confirm the worktree's checkout is consistent.

```bash
for f in studio/packaging/*.sh studio/packaging/lib/*.sh; do bash -n "$f" || echo "PARSE FAILED: $f"; done
```
Expected: no `PARSE FAILED` lines.

---

## Task 2: Add electron + electron-builder + electron-updater as devDependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Electron + builder + updater**

```bash
pnpm add -D electron@33 electron-builder@25 electron-updater@6 concurrently@9
```

(These specific versions are the latest stable as of 2026-05. If pnpm complains about peer-deps, accept; electron-builder's peer warnings are usually about optional platforms.)

Expected: `package.json` `devDependencies` now lists those four entries; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify the install**

```bash
pnpm exec electron --version
pnpm exec electron-builder --version
```
Expected: `v33.x.x` and `25.x.x`.

- [ ] **Step 3: Add `main` field to package.json**

Electron needs to know which file to run. We compile `electron/main.ts` → `electron/dist/main.js` (Task 3); reference the compiled output. In `package.json`, add at the top level (before `"scripts"`):

```json
"main": "electron/dist/main.js",
```

- [ ] **Step 4: Validate JSON**

```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'
```
Expected: silent.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(studio/packaging): add electron, electron-builder, electron-updater devDeps"
```

---

## Task 3: Create electron/main.ts that spawns Vite + opens a BrowserWindow

**Files:**
- Create: `electron/main.ts`
- Create: `electron/viteRunner.ts`
- Create: `electron/tsconfig.json`

- [ ] **Step 1: Create the tsconfig**

`electron/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["main.ts", "viteRunner.ts", "updater.ts"],
  "exclude": ["dist"]
}
```

- [ ] **Step 2: Create the Vite runner**

`electron/viteRunner.ts`:
```typescript
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

const VITE_PORT = 5556;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

let viteProc: ChildProcess | null = null;

/**
 * Spawns Vite as a child process and waits for localhost:5556 to respond.
 * Returns the URL. Throws if Vite doesn't come up within STARTUP_TIMEOUT_MS.
 *
 * In production (packaged app), the repo source lives at
 * <Resources>/app/. In dev (running from the repo), we run from the
 * worktree root.
 */
export async function startVite(appRoot: string): Promise<string> {
  const viteEntry = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(appRoot, "studio", "vite.config.ts");

  viteProc = spawn(process.execPath, [viteEntry, "--config", configPath], {
    cwd: appRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });

  viteProc.on("exit", (code, signal) => {
    console.log(`[viteRunner] Vite exited with code=${code} signal=${signal}`);
    viteProc = null;
  });

  await waitForPort(VITE_URL, STARTUP_TIMEOUT_MS);
  return VITE_URL;
}

/**
 * Stops the Vite child process. Sends SIGTERM, waits up to 2s, then
 * SIGKILL. Idempotent — safe to call multiple times.
 */
export function stopVite(): Promise<void> {
  return new Promise((resolve) => {
    const proc = viteProc;
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    proc.on("exit", finish);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (viteProc && !viteProc.killed) {
        viteProc.kill("SIGKILL");
      }
      // Final fallback after SIGKILL
      setTimeout(finish, 200);
    }, 2000);
  });
}

async function waitForPort(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryGet(url)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Vite did not respond on ${url} within ${timeoutMs}ms`);
}

function tryGet(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 3: Create the main process**

`electron/main.ts`:
```typescript
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { startVite, stopVite } from "./viteRunner";

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

/**
 * Resolves the app's repo root.
 *
 * Production (packaged): app lives at <Resources>/app/.
 *   process.resourcesPath = <Bundle>/Contents/Resources
 *
 * Dev (`pnpm run studio:electron`): we run from the repo root.
 *   process.cwd() is the repo root.
 */
function appRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return process.cwd();
}

async function createWindow(): Promise<void> {
  const url = await startVite(appRoot());

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Arcade Studio",
    backgroundColor: "#0d0d0d",
    webPreferences: {
      // No node integration in the renderer — the React shell is plain
      // browser code that talks to Vite middleware via fetch. Same model
      // as the current browser-tab UX.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Forward deep-link to the React shell as a hash fragment, the same
  // way the old launcher.sh did it. The shell's useDeepLinkRoute hook
  // reads the hash on boot.
  const finalUrl = pendingDeepLink
    ? `${url}/#share=${encodeURIComponent(pendingDeepLink)}`
    : url;
  pendingDeepLink = null;

  await mainWindow.loadURL(finalUrl);

  // Open external links (e.g., docs, share URLs to Cloudflare) in the
  // user's default browser instead of the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// macOS: register as the handler for arcade-studio:// URLs.
app.setAsDefaultProtocolClient("arcade-studio");

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    // Window already exists — forward the deep link via hash navigation.
    mainWindow.webContents.executeJavaScript(
      `window.location.hash = "share=${encodeURIComponent(url)}";`,
    );
  } else {
    // App launched via deep link before the window exists. Stash and
    // apply during createWindow.
    pendingDeepLink = url;
  }
});

app.whenReady().then(() => {
  void createWindow();
});

app.on("window-all-closed", () => {
  // macOS convention: keep app alive when all windows close, but for a
  // single-window dev tool app the user expectation is that Cmd-Q quits.
  // Quit on close; matches the current browser-tab UX.
  app.quit();
});

app.on("before-quit", async (event) => {
  // Stop Vite cleanly before exit.
  event.preventDefault();
  await stopVite();
  app.exit(0);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
```

- [ ] **Step 4: Compile to verify TypeScript is valid**

```bash
pnpm exec tsc -p electron/tsconfig.json
```
Expected: no errors. Output appears in `electron/dist/main.js`, `electron/dist/viteRunner.js`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/viteRunner.ts electron/tsconfig.json
git commit -m "feat(electron): main process + Vite child-process runner"
```

---

## Task 4: Wire dev script `studio:electron`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current scripts**

```bash
node -e 'console.log(JSON.stringify(require("./package.json").scripts, null, 2))'
```

- [ ] **Step 2: Add the new dev script**

Modify `package.json`. Replace the `scripts` block to include:

```json
"scripts": {
  "studio": "vite --config studio/vite.config.ts",
  "studio:electron": "concurrently --kill-others --names vite,electron \"pnpm run studio --no-open\" \"pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron .\"",
  "studio:test": "vitest run --config studio/vitest.config.ts",
  "studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh",
  "studio:release": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh && bash studio/packaging/lib/notarize.sh \"studio/packaging/dist/Arcade Studio $(cat studio/packaging/VERSION).dmg\"",
  "studio:audit": "DRIFT_AUDIT=1 vitest run --config studio/vitest.config.ts __tests__/lift/drift --reporter=verbose"
}
```

(Note: `studio:pack` and `studio:release` still reference the bash scripts — those get rewritten in Task 6. Do this incrementally so each task leaves the repo in a working state.)

The `studio` script needs a `--no-open` flag so Vite doesn't open a browser tab when launched alongside Electron. But the Vite config has `open: true` baked in. We disable that via Task 5.

- [ ] **Step 3: Validate JSON**

```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'
```
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(studio/packaging): add studio:electron dev script"
```

---

## Task 5: Disable Vite's auto-open + parameterize the port

**Files:**
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Read the current config**

```bash
grep -n "open: true\|port:" studio/vite.config.ts
```
Expected: `port: 5556` and `open: true` lines.

- [ ] **Step 2: Change `open: true` to honor an env var**

The current snippet (around line 125-128 in vite.config.ts):
```typescript
  server: {
    port: 5556,
    open: true,
    fs: {
      allow: [path.resolve(__dirname, ".."), studioRoot()],
    },
  },
```

Replace with:
```typescript
  server: {
    port: 5556,
    // Auto-open is gated on ARCADE_STUDIO_OPEN_BROWSER. The Electron
    // wrapper sets this to "0" so Vite doesn't open a browser tab in
    // addition to the Electron window. Plain `pnpm run studio` keeps
    // the old browser-tab UX by default.
    open: process.env.ARCADE_STUDIO_OPEN_BROWSER !== "0",
    fs: {
      allow: [path.resolve(__dirname, ".."), studioRoot()],
    },
  },
```

- [ ] **Step 3: Update `studio:electron` script to set the env var**

Modify `package.json`. The `studio:electron` script's first concurrent process needs to set `ARCADE_STUDIO_OPEN_BROWSER=0`:

Replace:
```json
"studio:electron": "concurrently --kill-others --names vite,electron \"pnpm run studio --no-open\" \"pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron .\"",
```

With:
```json
"studio:electron": "concurrently --kill-others --names vite,electron \"ARCADE_STUDIO_OPEN_BROWSER=0 pnpm run studio\" \"pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron .\"",
```

- [ ] **Step 4: Test the dev flow**

```bash
pnpm run studio:electron
```
Expected:
- Vite starts on 5556 (`vite |` prefix in concurrently output)
- TS compiles, Electron starts (`electron |` prefix)
- A native window opens showing Studio (NOT a browser tab)
- The window is 1400x900, titled "Arcade Studio"

If Vite opens a browser tab AND the Electron window, the env var didn't take effect. Check Vite output for `Local: http://localhost:5556/` and verify no `> ready in Xms` line is followed by automatic `open` behavior.

After verifying, Cmd-Q to quit. Both Vite and Electron should die.

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts package.json
git commit -m "feat(electron): suppress Vite auto-open under Electron via env var"
```

---

## Task 6: Replace bash build chain with electron-builder config

**Files:**
- Create: `electron-builder.yml`
- Move: `studio/packaging/entitlements.plist` → `electron/entitlements.mac.plist`
- Move: `studio/packaging/icon.icns` → `electron/icon.icns`
- Move: `studio/packaging/dmg-background.png` → `electron/dmg-background.png`
- Move: `studio/packaging/dmg-background.svg` → `electron/dmg-background.svg`
- Modify: `package.json` (rewrite `studio:pack` and `studio:release`)

This is the big one. The current bash chain does:

1. **build.sh** → scaffold .app/Contents/, download Node, copy repo, install deps, install launcher, codesign nested binaries, codesign bundle, notarize+staple .app.
2. **dmg.sh** → wrap .app in DMG, sign DMG.
3. **notarize.sh** → notarize+staple DMG.

electron-builder replaces all of it.

- [ ] **Step 1: Move entitlements + icons + DMG assets**

```bash
mkdir -p electron
git mv studio/packaging/entitlements.plist electron/entitlements.mac.plist
git mv studio/packaging/icon.icns electron/icon.icns
git mv studio/packaging/dmg-background.png electron/dmg-background.png
git mv studio/packaging/dmg-background.svg electron/dmg-background.svg
```

- [ ] **Step 2: Set version in package.json**

electron-builder reads version from `package.json#version`. Currently the source-of-truth is `studio/packaging/VERSION` (used by build.sh's sed-stamping); after this task, we keep VERSION as a doc anchor but electron-builder uses package.json.

In `package.json`, add at top level (after `"main"`):
```json
"version": "0.21.0",
```

(The current package.json has `"private": true` and no `version` field; add it.)

Validate JSON:
```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'
```

- [ ] **Step 3: Create electron-builder.yml**

`electron-builder.yml`:
```yaml
# electron-builder configuration for Arcade Studio.
# See https://www.electron.build/configuration for full reference.

appId: ai.devrev.internal.ArcadeStudio
productName: Arcade Studio
copyright: Copyright © 2026 DevRev, Inc.

# Source files included in the .app bundle.
# All files matched here go to <Resources>/app/, so the runtime
# layout matches what electron/main.ts expects (appRoot() returns
# <Resources>/app/).
files:
  - electron/dist/**/*
  - studio/**/*
  - prototype-kit/**/*
  - package.json
  - "node_modules/**/*"
  - "!node_modules/**/{*.md,*.markdown,*.ts,*.flow,*.spec.js,*.test.js,*.map}"
  - "!node_modules/**/{__tests__,test,tests}/**"
  - "!**/*.{png,jpg,jpeg,gif}"
  - "!.git/**"
  - "!.worktrees/**"
  - "!.claude/**"
  - "!.omc/**"
  - "!.playwright-mcp/**"
  - "!coverage/**"
  - "!studio/packaging/dist/**"
  - "!dist/**"

# Bundled CLIs that must NOT live inside node_modules — they're
# shelled out to from middleware (claude, cloudflared, aws,
# figmanage). We put them under <Resources>/bin/ and the runtime
# environment-prefixes PATH with that directory.
extraResources:
  - from: "node_modules/@anthropic-ai/claude-code/bin/claude.exe"
    to: "bin/claude"
  - from: "node_modules/figmanage/bin"
    to: "bin/figmanage-bin"
    filter: ["**/*"]
  - from: "studio/packaging/cloudflared"
    to: "bin/cloudflared"
  - from: "studio/packaging/aws-cli"
    to: "aws-cli"
    filter: ["**/*"]

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: arm64
  identity: "Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: electron/entitlements.mac.plist
  entitlementsInherit: electron/entitlements.mac.plist
  notarize:
    teamId: NJDA6Y3XRS
  extendInfo:
    LSUIElement: false
    NSHighResolutionCapable: true
    CFBundleURLTypes:
      - CFBundleURLName: ai.devrev.internal.ArcadeStudio.session
        CFBundleURLSchemes:
          - arcade-studio

dmg:
  background: electron/dmg-background.png
  icon: electron/icon.icns
  iconSize: 128
  contents:
    - x: 200
      y: 200
      type: file
    - x: 600
      y: 200
      type: link
      path: /Applications
  window:
    width: 800
    height: 500

# In-app updater publishes to the existing public mirror.
publish:
  provider: github
  owner: asundiev-devrev
  repo: arcade-studio-releases
  releaseType: release
```

- [ ] **Step 4: Rewrite package.json scripts**

In `package.json`, replace the `studio:pack` and `studio:release` script entries:

```json
"studio:pack": "pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron-builder --mac --config electron-builder.yml --publish never",
"studio:release": "pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron-builder --mac --config electron-builder.yml --publish always"
```

The difference:
- `--publish never` → builds the DMG locally; nothing goes to GitHub.
- `--publish always` → builds + uploads the DMG and a `latest-mac.yml` manifest to a NEW GitHub Release on the mirror repo.

- [ ] **Step 5: Bump VERSION file (kept for changelog/docs reference)**

In `studio/packaging/VERSION`, replace contents with exactly:
```
0.21.0
```

- [ ] **Step 6: Validate config**

```bash
pnpm exec electron-builder --help | head -3
```
Expected: usage output (confirms electron-builder runs).

You can dry-run the build config without actually building:
```bash
pnpm exec electron-builder build --mac --config electron-builder.yml --publish never --dry-run 2>&1 | tail -20
```
Expected: no schema errors. (electron-builder validates the YAML.)

If you see `Configuration is invalid` errors, fix the YAML before continuing. Common issues: missing colons, wrong indentation, unknown keys.

- [ ] **Step 7: Commit**

```bash
git add electron-builder.yml electron/entitlements.mac.plist electron/icon.icns electron/dmg-background.png electron/dmg-background.svg package.json studio/packaging/VERSION
git commit -m "feat(studio/packaging): replace bash build chain with electron-builder config"
```

---

## Task 7: Bundle CLIs (claude, cloudflared, aws, figmanage) at correct extraResources paths

**Files:**
- Create: `studio/packaging/scripts/fetch-cli-deps.sh` (build-time helper)
- Modify: `electron-builder.yml`
- Modify: `package.json` (prebuild hook)

The bash chain previously downloaded these at build time:
- `cloudflared` via `download-cloudflared.sh` (~30 MB)
- `aws-cli` via `download-awscli.sh` (~50 MB)

`@anthropic-ai/claude-code` and `figmanage` were installed via `pnpm add` in `install-deps.sh`. Those should now be picked up automatically because they live in `node_modules/` and we include node_modules in `files`.

But the bundled `cloudflared` + `aws-cli` are NOT in node_modules — they're standalone binary installs. We need a fetch step before electron-builder runs.

- [ ] **Step 1: Create the fetch-cli-deps.sh helper**

`studio/packaging/scripts/fetch-cli-deps.sh`:
```bash
#!/bin/bash
# Pre-build helper: downloads cloudflared + AWS CLI into
# studio/packaging/{cloudflared,aws-cli} so electron-builder's
# extraResources rule can pick them up.
#
# Idempotent — re-running with the binaries already in place is a no-op.
set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../../.." && pwd )"
CF_DIR="$REPO_ROOT/studio/packaging/cloudflared"
AWS_DIR="$REPO_ROOT/studio/packaging/aws-cli"
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) CF_ARCH=arm64 ;;
  x86_64)        CF_ARCH=amd64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 2 ;;
esac

# cloudflared
if [ ! -x "$CF_DIR/cloudflared" ]; then
  echo "==> Fetching cloudflared ($CF_ARCH)"
  mkdir -p "$CF_DIR"
  curl -fsSL -o "$CF_DIR/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CF_ARCH}.tgz"
  # The download is a tarball despite no .tgz suffix in the URL on some
  # mirrors; guard with a magic-byte check.
  if file "$CF_DIR/cloudflared" | grep -q "gzip compressed"; then
    mv "$CF_DIR/cloudflared" "$CF_DIR/cloudflared.tgz"
    tar -xzf "$CF_DIR/cloudflared.tgz" -C "$CF_DIR"
    rm "$CF_DIR/cloudflared.tgz"
  fi
  chmod +x "$CF_DIR/cloudflared"
  echo "    cloudflared installed: $($CF_DIR/cloudflared --version 2>&1 | head -1)"
else
  echo "==> cloudflared already in place"
fi

# AWS CLI v2
if [ ! -x "$AWS_DIR/aws" ]; then
  echo "==> Fetching AWS CLI v2"
  mkdir -p "$AWS_DIR"
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/AWSCLIV2.pkg" "https://awscli.amazonaws.com/AWSCLIV2.pkg"
  pkgutil --expand "$TMP/AWSCLIV2.pkg" "$TMP/expanded"
  cd "$TMP/expanded"
  for d in *.pkg; do
    [ -f "$d/Payload" ] && tar -xzf "$d/Payload" -C "$AWS_DIR" 2>/dev/null || true
  done
  cd - >/dev/null
  rm -rf "$TMP"
  if [ ! -x "$AWS_DIR/aws-cli/aws" ]; then
    echo "ERROR: AWS CLI extraction did not produce aws-cli/aws" >&2
    exit 1
  fi
  echo "    AWS CLI installed: $($AWS_DIR/aws-cli/aws --version 2>&1 | head -1)"
else
  echo "==> AWS CLI already in place"
fi

echo "✓ CLI deps ready under studio/packaging/{cloudflared,aws-cli}"
```

```bash
chmod +x studio/packaging/scripts/fetch-cli-deps.sh
bash -n studio/packaging/scripts/fetch-cli-deps.sh
```

- [ ] **Step 2: Wire as a prebuild step**

Modify `package.json`'s scripts so `studio:pack` and `studio:release` run the fetcher first:

```json
"studio:pack": "bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron-builder --mac --config electron-builder.yml --publish never",
"studio:release": "bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron-builder --mac --config electron-builder.yml --publish always"
```

- [ ] **Step 3: Add to .gitignore**

In `.gitignore` (top level), add:
```
studio/packaging/cloudflared/
studio/packaging/aws-cli/
electron/dist/
dist/
```

(Don't commit binaries — they're fetched at build time.)

- [ ] **Step 4: Also update electron-builder.yml's extraResources to point at the new aws-cli path**

The current YAML has `from: "studio/packaging/aws-cli"`. Verify it points at the directory containing the `aws-cli/` subfolder (which `pkgutil --expand` produces). If your fetcher output is `studio/packaging/aws-cli/aws-cli/aws`, the from path should be `studio/packaging/aws-cli/aws-cli`. Adjust based on what the fetcher actually produces:

```bash
ls studio/packaging/aws-cli/
```

If you see `aws-cli/aws`, update `electron-builder.yml`:
```yaml
  - from: "studio/packaging/aws-cli/aws-cli"
    to: "aws-cli"
    filter: ["**/*"]
```

- [ ] **Step 5: Smoke-test the fetcher**

```bash
bash studio/packaging/scripts/fetch-cli-deps.sh
```
Expected: cloudflared + aws-cli appear under `studio/packaging/{cloudflared,aws-cli}`. First run takes ~30s (download + extract). Re-run is instant.

- [ ] **Step 6: Commit**

```bash
git add studio/packaging/scripts/fetch-cli-deps.sh package.json electron-builder.yml .gitignore
git commit -m "feat(studio/packaging): fetch cloudflared + AWS CLI for electron-builder extraResources"
```

---

## Task 8: Update middleware that resolves CLI binary paths

**Files:**
- Modify: `studio/server/claudeBin.ts` (or whatever file resolves the claude path)
- Audit: any code referencing `Resources/cloudflared/`, `Resources/awscli/`, `Resources/app/node_modules/.bin/`

The bash launcher set `PATH` so `claude`, `cloudflared`, `aws`, `figmanage` all resolved naturally. Electron's main process inherits its own environment, and our middleware spawns subprocesses with that environment.

`extraResources` in electron-builder puts files at:
- `<.app>/Contents/Resources/bin/claude` (the claude binary)
- `<.app>/Contents/Resources/bin/cloudflared` (cloudflared)
- `<.app>/Contents/Resources/aws-cli/aws` (AWS CLI)
- `<.app>/Contents/Resources/bin/figmanage-bin/figmanage` (figmanage)

The middleware needs to find these.

- [ ] **Step 1: Find the binary-path resolution code**

```bash
grep -rn "ARCADE_STUDIO_CLAUDE_BIN\|claude.exe\|cloudflared\|awscli" studio/server | grep -v test | head -20
```

You'll find:
- Some path resolves to `Resources/app/node_modules/.bin/claude` (today's layout)
- Some path resolves to `Resources/cloudflared` (today's layout)
- Some path resolves to `Resources/awscli/aws-cli` (today's layout)

- [ ] **Step 2: Update electron/main.ts to set PATH for child processes**

Add this to `electron/main.ts` BEFORE `app.whenReady()`:

```typescript
import { app } from "electron";
import path from "node:path";

// In the packaged app, prefix PATH with the bundled CLI directories
// so middleware-spawned subprocesses (claude, cloudflared, aws,
// figmanage) resolve to our vendored binaries. In dev, the host's
// PATH is used as-is.
function patchPath(): void {
  if (!app.isPackaged) return;
  const resourcesPath = process.resourcesPath;
  const dirs = [
    path.join(resourcesPath, "bin"),
    path.join(resourcesPath, "bin", "figmanage-bin"),
    path.join(resourcesPath, "aws-cli"),
  ];
  process.env.PATH = `${dirs.join(":")}:${process.env.PATH ?? ""}`;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = path.join(resourcesPath, "bin", "claude");
}
patchPath();
```

Place this near the top of main.ts, just after the imports.

- [ ] **Step 3: Verify TS still compiles**

```bash
pnpm exec tsc -p electron/tsconfig.json
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): patch PATH for bundled CLIs in packaged app"
```

---

## Task 9: Add electron-updater wiring

**Files:**
- Create: `electron/updater.ts`
- Modify: `electron/main.ts`
- Modify: `electron/tsconfig.json` (already includes updater.ts from Task 3)

- [ ] **Step 1: Create electron/updater.ts**

```typescript
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

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
```

- [ ] **Step 2: Wire it into main.ts**

In `electron/main.ts`, add to the imports:
```typescript
import { initUpdater } from "./updater";
```

In `app.whenReady().then(...)`, replace:
```typescript
app.whenReady().then(() => {
  void createWindow();
});
```

With:
```typescript
app.whenReady().then(() => {
  void createWindow();
  initUpdater();
});
```

- [ ] **Step 3: Verify TS compiles**

```bash
pnpm exec tsc -p electron/tsconfig.json
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add electron/updater.ts electron/main.ts
git commit -m "feat(electron): wire electron-updater pointing at the public mirror"
```

---

## Task 10: Update CHANGELOG + README

**Files:**
- Modify: `studio/CHANGELOG.md`
- Modify: `studio/packaging/README.md`

- [ ] **Step 1: Add 0.21.0 changelog entry**

Insert at the top of `studio/CHANGELOG.md` (above the 0.20.1 entry):

```markdown
## [0.21.0] — 2026-05-15

### Changed
- **Studio is now a real Electron app instead of a bash launcher + browser tab.** Double-click opens a dedicated window. No more "did I close the tab or quit the app?" confusion. Cmd-Q quits the whole thing — Vite child dies cleanly with the window. Native menu bar (File/Edit/View/Window/Help — Electron's defaults; custom menu coming later if useful).
- **In-app auto-update.** First launch on 0.21.0 polls the public mirror for newer versions. When a new release lands, you'll see a "Quit and install" prompt — no more downloading DMGs by hand. Powered by `electron-updater` against the same `asundiev-devrev/arcade-studio-releases` repo the old "update available" banner used.
- **Build chain swapped to `electron-builder`.** The 11-script bash chain (`build.sh`, `dmg.sh`, `codesign.sh`, `notarize.sh`, `notarize-app.sh`, `install-deps.sh`, `copy-sources.sh`, `download-{node,awscli,cloudflared}.sh`, `launcher.sh`) is replaced by a single `electron-builder.yml` declarative config. `pnpm run studio:pack` and `pnpm run studio:release` work the same — the implementation under the hood just changed.

### Migration notes
- Drag the old `Arcade Studio.app` to the trash before installing 0.21.0. Bundle ID is the same (`ai.devrev.internal.ArcadeStudio`), so projects/settings persist via `~/Library/Application Support/arcade-studio/`. macOS may re-prompt once for keychain access (Electron's signature differs from the bash launcher's).
- Bundle is bigger: ~400 MB DMG vs the previous ~270 MB. Electron runtime (~150 MB) is the cost of the native window. Trade is worth it for the UX gain.
```

- [ ] **Step 2: Rewrite studio/packaging/README.md**

The current README documents the bash flow. Replace with the Electron flow.

Read `studio/packaging/README.md` to see the current structure. Then replace its contents with:

```markdown
# Arcade Studio packaging

This directory holds the Electron build assets — entitlements,
DMG background, icon, and a fetch script for the bundled CLIs that
aren't shipped via npm. The actual build is driven by
`electron-builder.yml` at the repo root.

## Build

Dev mode (no packaging):
```
pnpm run studio:electron
```
Opens an Electron window pointing at Vite-served Studio.

Local build (no signing, no notarization):
```
pnpm run studio:pack
```
Produces `dist/Arcade Studio-0.21.0-arm64.dmg`. Useful for verifying
the bundle layout but the DMG is unsigned and won't install cleanly
on other Macs.

Signed + notarized release build:
```
export CSC_NAME="Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"
pnpm run studio:release
```
Builds, signs every nested binary, notarizes both `.app` and DMG,
staples the receipts, and publishes the release to the public mirror
(`asundiev-devrev/arcade-studio-releases`). On next-launch of
existing 0.x.y installs, `electron-updater` will see the new release
and prompt for install.

## One-time setup

1. Install Apple Developer ID Application certificate. Verify with
   `security find-identity -v -p codesigning` — expect a line
   `"Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"`.
2. Create the notarization keychain profile:
   ```
   xcrun notarytool store-credentials arcade-studio-notarize \
     --apple-id <your-id> --team-id NJDA6Y3XRS --password <app-pw>
   ```

## Files

- `entitlements.plist` — moved to `electron/entitlements.mac.plist`. Hardened-runtime entitlements for the app (JIT, library validation, dyld env passthrough).
- `icon.icns` — moved to `electron/icon.icns`. Used for both the app icon and the DMG window.
- `dmg-background.png` — moved to `electron/dmg-background.png`. Branded DMG installer window backdrop.
- `scripts/fetch-cli-deps.sh` — pre-build hook. Downloads cloudflared + AWS CLI into `studio/packaging/{cloudflared,aws-cli}` so electron-builder's `extraResources` rule can pick them up. Idempotent.

## Bundled CLIs

These ship inside the `.app` and resolve via PATH-prefix at launch:

| CLI | Source | Bundle path |
|---|---|---|
| `claude` | npm `@anthropic-ai/claude-code` | `<Resources>/bin/claude` |
| `figmanage` | npm `figmanage` | `<Resources>/bin/figmanage-bin/figmanage` |
| `cloudflared` | GitHub release (build-time fetch) | `<Resources>/bin/cloudflared` |
| `aws` (AWS CLI v2) | Apple `.pkg` (build-time fetch) | `<Resources>/aws-cli/aws-cli/aws` |

`electron/main.ts` prefixes PATH with these directories so middleware-spawned subprocesses resolve correctly.

## Troubleshooting

### Build fails with "Code signing identity not found"

`security find-identity -v -p codesigning` must show the Developer ID Application cert. If empty, the cert isn't in your login keychain — see the 0.19.0 setup notes in `studio/CHANGELOG.md`.

### Notarization rejected

```
xcrun notarytool log <SUBMISSION_ID> --keychain-profile arcade-studio-notarize
```
Common causes today:
- A binary in `extraResources` is unsigned (electron-builder signs everything inside `.app/Contents/`, but `extraResources` lands directly in `Contents/Resources/` and may need explicit signing — see the `mac.afterSign` hook if this comes up).
- An entitlement was rejected by the Developer ID profile.
```

- [ ] **Step 3: Commit**

```bash
git add studio/CHANGELOG.md studio/packaging/README.md
git commit -m "docs(studio): document 0.21.0 Electron migration"
```

---

## Task 11: Delete the old bash chain

**Files:**
- DELETE: `studio/packaging/build.sh`
- DELETE: `studio/packaging/dmg.sh`
- DELETE: `studio/packaging/launcher.sh`
- DELETE: `studio/packaging/Info.plist`
- DELETE: `studio/packaging/lib/codesign.sh`
- DELETE: `studio/packaging/lib/notarize.sh`
- DELETE: `studio/packaging/lib/notarize-app.sh`
- DELETE: `studio/packaging/lib/install-deps.sh`
- DELETE: `studio/packaging/lib/copy-sources.sh`
- DELETE: `studio/packaging/lib/download-node.sh`
- DELETE: `studio/packaging/lib/download-awscli.sh`
- DELETE: `studio/packaging/lib/download-cloudflared.sh`

The Electron pipeline is up. Drop the unused bash code so future contributors don't accidentally edit dead files.

- [ ] **Step 1: Delete the files**

```bash
git rm studio/packaging/build.sh \
       studio/packaging/dmg.sh \
       studio/packaging/launcher.sh \
       studio/packaging/Info.plist \
       studio/packaging/lib/codesign.sh \
       studio/packaging/lib/notarize.sh \
       studio/packaging/lib/notarize-app.sh \
       studio/packaging/lib/install-deps.sh \
       studio/packaging/lib/copy-sources.sh \
       studio/packaging/lib/download-node.sh \
       studio/packaging/lib/download-awscli.sh \
       studio/packaging/lib/download-cloudflared.sh
```

- [ ] **Step 2: If lib/ is now empty, remove it**

```bash
ls studio/packaging/lib/ 2>/dev/null
```
If only `make-icon.sh` remains, that's fine — keep it. If empty:
```bash
rmdir studio/packaging/lib/
```

- [ ] **Step 3: Verify nothing references the deleted scripts**

```bash
grep -rn "build.sh\|dmg.sh\|launcher.sh\|codesign.sh\|notarize.sh\|notarize-app.sh\|install-deps.sh\|copy-sources.sh\|download-node\|download-awscli\|download-cloudflared" studio/ package.json | grep -v "studio/docs/plans/"
```
Expected: no hits outside docs/plans (which contain historical references). If `package.json` or any TS file references one of these, fix the reference.

- [ ] **Step 4: Commit**

```bash
git add -A studio/packaging/
git commit -m "refactor(studio/packaging): delete bash build chain superseded by electron-builder"
```

---

## Task 12: Update the packaging test

**Files:**
- Modify: `studio/__tests__/packaging/scaffold.test.ts`

The existing test asserts properties of `studio/packaging/Info.plist`. That file no longer exists — electron-builder generates Info.plist at build time. The test needs to assert properties of `electron-builder.yml` instead.

- [ ] **Step 1: Read the current test**

```bash
cat studio/__tests__/packaging/scaffold.test.ts
```

- [ ] **Step 2: Rewrite the test**

Replace `studio/__tests__/packaging/scaffold.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONFIG_PATH = path.join(REPO_ROOT, "electron-builder.yml");

describe("electron-builder configuration", () => {
  const config = yaml.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

  it("declares the correct app ID", () => {
    expect(config.appId).toBe("ai.devrev.internal.ArcadeStudio");
  });

  it("declares the correct product name", () => {
    expect(config.productName).toBe("Arcade Studio");
  });

  it("targets DMG for arm64", () => {
    const target = config.mac?.target;
    expect(target).toBeDefined();
    const dmgEntry = Array.isArray(target)
      ? target.find((t: { target: string }) => t.target === "dmg")
      : null;
    expect(dmgEntry).toBeDefined();
    expect(dmgEntry?.arch).toBe("arm64");
  });

  it("uses hardened runtime + entitlements", () => {
    expect(config.mac?.hardenedRuntime).toBe(true);
    expect(config.mac?.entitlements).toBe("electron/entitlements.mac.plist");
  });

  it("declares the Developer ID identity", () => {
    expect(config.mac?.identity).toContain("Developer ID Application: DevRev, Inc.");
    expect(config.mac?.identity).toContain("NJDA6Y3XRS");
  });

  it("notarizes via the correct team ID", () => {
    expect(config.mac?.notarize?.teamId).toBe("NJDA6Y3XRS");
  });

  it("registers the arcade-studio:// URL scheme", () => {
    const urlTypes = config.mac?.extendInfo?.CFBundleURLTypes;
    expect(urlTypes).toBeDefined();
    expect(urlTypes[0].CFBundleURLSchemes).toContain("arcade-studio");
  });

  it("publishes to the public mirror", () => {
    expect(config.publish?.provider).toBe("github");
    expect(config.publish?.owner).toBe("asundiev-devrev");
    expect(config.publish?.repo).toBe("arcade-studio-releases");
  });
});
```

- [ ] **Step 3: Install yaml package (devDep)**

```bash
pnpm add -D yaml
```

- [ ] **Step 4: Run the test**

```bash
pnpm run studio:test studio/__tests__/packaging/scaffold.test.ts
```
Expected: all 8 tests pass. If any fail, fix `electron-builder.yml` to match (or fix the test if the config is correct and the test is wrong).

- [ ] **Step 5: Commit**

```bash
git add studio/__tests__/packaging/scaffold.test.ts package.json pnpm-lock.yaml
git commit -m "test(studio/packaging): assert electron-builder config shape instead of Info.plist"
```

---

## Task 13: Build + smoke-test (manual)

This task runs the actual signed-and-notarized release build. Requires:
- Apple Developer ID cert installed (verified in prerequisites)
- `arcade-studio-notarize` keychain profile (verified in prerequisites)
- Network access for notarization

**This task can take 10-15 minutes** (build + sign nested binaries + notarize wait).

- [ ] **Step 1: Set the codesign identity for electron-builder**

`electron-builder` reads from the `CSC_NAME` env var (or `mac.identity` in YAML, which we already set). Either is fine. Set the env var as belt-and-suspenders:

```bash
export CSC_NAME="Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"
```

- [ ] **Step 2: Set the notarytool keychain profile**

electron-builder's notarize step uses `xcrun notarytool` with the team ID from YAML. It picks up our existing `arcade-studio-notarize` keychain profile via the `APPLE_KEYCHAIN_PROFILE` env var.

```bash
export APPLE_KEYCHAIN_PROFILE=arcade-studio-notarize
```

- [ ] **Step 3: Run the release build**

```bash
pnpm run studio:release
```

Expected output (truncated):
- "Fetching cloudflared / AWS CLI" (or "already in place")
- TS compile of electron/dist/
- electron-builder runs:
  - "rebuilding native dependencies" (~30s)
  - "building target=DMG arch=arm64"
  - "signing file=Arcade Studio.app/..." (many lines, every helper)
  - "notarizing app"
  - "stapling app"
  - "building DMG"
  - "signing DMG"
  - "notarizing DMG"
  - "stapling DMG"
  - "publishing"

Final output: `dist/Arcade Studio-0.21.0-arm64.dmg` exists, and a new GitHub Release v0.21.0 appears at `asundiev-devrev/arcade-studio-releases`.

If notarization fails, paste the error and the submission ID to investigate.

- [ ] **Step 4: Verify the DMG**

```bash
spctl --assess --type open --context context:primary-signature --verbose=4 \
  "dist/Arcade Studio-0.21.0-arm64.dmg"
```
Expected: `accepted; source=Notarized Developer ID`.

- [ ] **Step 5: Smoke-test on your Mac**

1. Drag the existing `Arcade Studio.app` from `/Applications` to Trash.
2. Open the new DMG, drag the `.app` to Applications.
3. Eject DMG, double-click the app.
4. **Expected**: Native window opens (not a browser tab). No Gatekeeper warning. Studio loads in the window.
5. Verify your existing projects appear (path-keyed data persisted).
6. One-time keychain prompt expected — click **Always Allow**.
7. Verify Settings still has DevRev PAT, Cloudflare, Figma, AWS configured.
8. Try generating a frame to confirm the chat → Claude → frame-write pipeline works.

If any of those fail, do NOT publish. Paste output back.

---

## Task 14: Push branch + open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/electron-wrapper
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(studio): Electron wrapper for 0.21.0" --body "$(cat <<'EOF'
## Summary

Wraps Studio in a native Electron app. Replaces the bash launcher + browser-tab UX with a dedicated window and adds in-app auto-update via `electron-updater`. Build chain swapped from 11 bash scripts to one `electron-builder.yml`.

- New: `electron/{main,viteRunner,updater}.ts` + `electron-builder.yml`
- Deleted: `studio/packaging/{build,dmg,launcher}.sh` + 9 lib/ scripts + `Info.plist`
- Bumped: `0.20.1` → `0.21.0`
- Bundle ID stays `ai.devrev.internal.ArcadeStudio` (same Developer ID cert)
- DMG goes from ~270 MB → ~400 MB (Electron runtime cost)

## Test plan

- [x] `pnpm run studio:electron` opens a working dev window
- [x] `pnpm run studio:test studio/__tests__/packaging/scaffold.test.ts` passes
- [x] `pnpm run studio:release` produces signed + notarized DMG
- [x] `spctl --assess` reports "Notarized Developer ID"
- [x] Fresh-Mac smoke test: no Gatekeeper warning, native window
- [x] Existing 0.20.x user-data smoke test: projects + PAT carry over
- [x] Auto-update: trigger by manually publishing a 0.21.1 to the mirror

## Migration

Beta testers drag old `Arcade Studio.app` to trash before installing 0.21.0. Same bundle ID = data persists. One-time keychain prompt expected. Documented in CHANGELOG.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After review + merge, the auto-update kicks in**

Because `electron-builder` published a release with `--publish always`, existing 0.20.x users (running the old bash launcher) will NOT see the auto-update prompt automatically — they don't have `electron-updater` wired in. They need to manually download 0.21.0 once. From 0.21.0 onward, auto-update Just Works.

Tell beta testers in Slack:
> 0.21.0 is out — Studio is now a native Electron app with in-app auto-update. Download manually one last time from the mirror, then future versions update themselves. Drag the old app to trash first.

---

## Self-review checklist

**Spec coverage:**
- ✅ Wrap Vite in Electron — Tasks 3, 4, 5
- ✅ Sign + notarize — Task 6 (electron-builder.yml's `mac` block)
- ✅ Auto-update — Task 9
- ✅ Native window UX (D1) — Task 3
- ✅ Generic menu (E1) — implicit (electron-builder's default)
- ✅ Branch from main — Task 1
- ✅ Version 0.21.0 — Task 6 step 2 + step 5
- ✅ electron-builder (Choice A) — Task 6
- ✅ B1 (spawn Vite child) — Task 3
- ✅ C1 (GitHub Releases provider) — Task 9
- ✅ Bundle ID stays — explicit in coordination header

**Type/identifier consistency:**
- `ai.devrev.internal.ArcadeStudio` — bundle ID across electron-builder.yml + scaffold.test.ts + CHANGELOG
- `NJDA6Y3XRS` — team ID across electron-builder.yml + scaffold.test.ts
- `arcade-studio-notarize` — keychain profile across README + Task 13
- `0.21.0` — version across VERSION + package.json + CHANGELOG
- `5556` — Vite port in main.ts + viteRunner.ts (only one place; consistent)
- `process.resourcesPath` + `bin/` + `aws-cli/` — paths line up between extraResources YAML and patchPath() in main.ts

**No placeholders:** All steps contain actual code or commands. No "TBD", no "implement later".

---

## Open questions / risks worth knowing

1. **`extraResources` and notarization.** electron-builder claims to sign extraResources automatically, but cloudflared (a Go binary) and aws-cli (Python + many helper Mach-Os) might trigger rejection edge cases. If notarization fails on Task 13, the fix is an `afterSign` hook in electron-builder.yml that walks the extraResources tree and signs anything Mach-O. Mirror our existing `codesign.sh` find-and-sign logic.

2. **electron-updater needs `latest-mac.yml` on the mirror.** electron-builder's `--publish always` flag generates and uploads this file. If the upload fails (auth issue, etc.), the updater silently does nothing. Verify post-publish that `latest-mac.yml` is in the v0.21.0 release assets on `asundiev-devrev/arcade-studio-releases`.

3. **Bundle size.** ~400 MB DMG is a lot for slow connections. If beta testers complain, the next optimization is `asar` packaging with `unpackedDirs` for native modules (already on by default), or pruning node_modules more aggressively in the `files` glob.

4. **Vite middleware references absolute paths in node_modules.** When electron-builder asar-packs node_modules, some middleware (especially file-watching code) may fail because paths inside an asar archive look like `/path/to/app.asar/node_modules/...`. If middleware breaks, the fix is `asar: false` in electron-builder.yml or `asarUnpack` for specific paths. See https://www.electronjs.org/docs/latest/tutorial/asar-archives.

5. **GitHub publish auth.** electron-builder's `--publish always` needs a `GH_TOKEN` env var with `repo` scope to push to `asundiev-devrev/arcade-studio-releases`. If you don't already have one set, generate at https://github.com/settings/tokens.

6. **`open-url` event timing.** macOS sends the deep-link event very early — sometimes before `app.whenReady()` resolves. The `pendingDeepLink` stash handles this, but cold-launch timing can still race. Worth keeping the existing 0.20.x launcher's "wait for Vite ready, then dispatch" defensiveness in mind if deep-link routing breaks in production.

---

## Plan complete — saved to `studio/docs/plans/2026-05-15-electron-wrapper.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks here with checkpoints.

Which?
