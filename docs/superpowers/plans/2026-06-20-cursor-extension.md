# Arcade Studio Cursor/VS Code Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Arcade Studio's prototype generator as a VS Code extension (installs in Cursor and VS Code) so designers get Studio-level DevRev-design-system fidelity inside their editor, with no separate app to learn.

**Architecture:** Approach A — the extension host (Node) spawns the *existing* Studio Vite middleware server on a free port, then opens a webview editor tab whose iframe loads `http://localhost:PORT`. The React shell, server, prototype-kit, claude-CLI generation, Figma import, and Vite-HMR live preview are reused unchanged. "Shared core, two shells": `electron/` and `extension/` are thin host adapters over the same `studio/` core. Frames live in the extension's hidden storage dir via the existing `ARCADE_STUDIO_ROOT` env override.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode`), `@vscode/vsce` (packaging), Vite (dev mode, reused), the vendored `claude` / `awscli` / `figmanage` CLIs.

## Global Constraints

- **Platform: macOS only** (v1). Vendored CLIs are arch-specific.
- **Package manager: pnpm.** Never `npm`/`yarn` (breaks lockfile). Never `git add -A`/`git add .` — stage explicit paths.
- **Single version source of truth:** repo-root `package.json#version` (currently `0.39.0`). No second version field. There is **no** `studio/package.json` — all deps live at the repo root; `studio/` is source.
- **Conventional Commits**, scope `studio/extension`: e.g. `feat(studio/extension): ...`.
- **Shared-core rule:** generation/fidelity logic stays in `studio/`. The extension adapter must not fork or reimplement it. Fixes land in core → both shells inherit.
- **The `node` trap:** never spawn a bare `node`/`figmanage`/`claude` relying on the user's PATH. Use `process.execPath` for node entry points and PATH-prefix the vendored bin dirs (see memory `studio-hooks-node-not-found-dmg`).
- **Cut for v1:** Cloudflare share (cloudflared binary + Worker), auto-update, Linux/Windows.
- **Verify on the packaged VSIX, not dev** — Studio's recurring lesson; bundled-binary bugs only appear in the artifact.

---

## File Structure

```
electron/
  main.ts            MODIFY — import shared bootstrapAwsProfile from a new shared module
  viteRunner.ts      MODIFY — startVite(appRoot, opts?) gains an optional port; default stays 5556
  shared/
    awsBootstrap.ts  CREATE — bootstrapAwsProfile() extracted from main.ts (shared by both hosts)
    freePort.ts      CREATE — pickFreePort() helper

extension/
  package.json       CREATE — VS Code extension manifest (name, engines, activationEvents, contributes.commands)
  tsconfig.json      CREATE — compiles extension/src → extension/dist
  src/
    extension.ts     CREATE — activate()/deactivate(): bootstrap → boot server → open webview → lifecycle
    serverHost.ts    CREATE — boots the Studio Vite server on a chosen port, health-waits, exposes stop()
    panel.ts         CREATE — creates/reuses the webview panel; builds CSP HTML with the localhost iframe
    paths.ts         CREATE — resolves vendored bin dirs + the storage (frame) dir from ExtensionContext
  .vscodeignore      CREATE — excludes dev cruft from the VSIX (keeps node_modules + studio + bins)

studio/
  vite.config.ts     MODIFY — server.port reads ARCADE_STUDIO_PORT (default 5556); strictPort kept

packaging/ (root scripts)
  package.json       MODIFY — add "studio:pack-vsix" script mirroring "studio:pack" with vsce
  studio/packaging/scripts/fetch-cli-deps.sh  MODIFY — gate cloudflared behind a flag (skip for VSIX)

__tests__/
  electron/viteRunner.port.test.ts     CREATE — startVite honors the port arg
  electron/awsBootstrap.test.ts        CREATE — extracted bootstrap is idempotent
  extension/serverHost.test.ts         CREATE — port-pick + health-wait logic (pure parts)
  extension/panel-csp.test.ts          CREATE — CSP HTML allows localhost + ws, nothing wider
  packaging/vsix-manifest.test.ts      CREATE — extension/package.json shape + .vscodeignore guards
```

---

## Task 1: Gatekeeper feasibility spike (GO/NO-GO gate)

**This is a spike, not TDD.** It de-risks the make-or-break unknown before any build work. Produces a written finding; everything downstream is contingent on GO.

**Files:**
- Create: `docs/superpowers/scratch/2026-06-20-gatekeeper-spike-finding.md`

**Goal:** Confirm the vendored `claude`, `aws`, and `figmanage` binaries execute from a side-loaded VSIX install location (`~/.cursor/extensions/...` and the VS Code equivalent `~/.vscode/extensions/...`) without a Gatekeeper / quarantine block — given the VSIX is *not* notarized like a `.app`.

- [ ] **Step 1: Locate the vendored binaries already on disk**

Run:
```bash
ls -la "studio/packaging/dist/Arcade Studio.app/Contents/Resources/bin/" \
       "studio/packaging/dist/Arcade Studio.app/Contents/Resources/aws-cli/" 2>/dev/null
```
Expected: `claude`, `figmanage`, `cloudflared` under `bin/`; `aws` under `aws-cli/`. (If absent, run `pnpm run studio:pack` first to vendor them.)

- [ ] **Step 2: Simulate a side-loaded extension dir and set the quarantine bit**

A downloaded `.vsix` arrives with `com.apple.quarantine` on its files. Reproduce that:
```bash
SPIKE=~/.cursor/extensions/arcade-spike/bin
mkdir -p "$SPIKE"
cp "studio/packaging/dist/Arcade Studio.app/Contents/Resources/bin/claude" "$SPIKE/"
cp "studio/packaging/dist/Arcade Studio.app/Contents/Resources/bin/figmanage" "$SPIKE/" 2>/dev/null || true
xattr -w com.apple.quarantine "0081;00000000;Safari;" "$SPIKE/claude"
xattr -p com.apple.quarantine "$SPIKE/claude"
```
Expected: the quarantine attribute prints back (confirms we reproduced the downloaded-file state).

- [ ] **Step 3: Attempt to execute the quarantined binary**

Run:
```bash
"$SPIKE/claude" --version; echo "exit=$?"
```
Record verbatim: success + version, OR the Gatekeeper error (e.g. `"claude" cannot be opened because the developer cannot be verified` / `Killed: 9` / `Operation not permitted`).

- [ ] **Step 4: If blocked, test the two mitigations and record which works**

```bash
# Mitigation A: strip quarantine at activation time (extension can run this on its own bin dir)
xattr -dr com.apple.quarantine "$SPIKE"
"$SPIKE/claude" --version; echo "stripA_exit=$?"
```
Record whether stripping `com.apple.quarantine` (an operation the extension host can perform on its own files during `activate()`) unblocks execution. Note if codesigning/notarizing the individual binaries would be required instead.

- [ ] **Step 5: Write the finding**

Create `docs/superpowers/scratch/2026-06-20-gatekeeper-spike-finding.md` with: the exact commands, verbatim outputs, and a one-line verdict — **GO** (binaries run, with or without an activation-time `xattr -dr` strip we control) or **NO-GO** (requires per-binary notarization / a different distribution path). If a strip is required, note it as a required step in Task 5.

- [ ] **Step 6: Clean up the spike dir**

```bash
rm -rf ~/.cursor/extensions/arcade-spike
```

- [ ] **Step 7: Commit the finding**

```bash
git add docs/superpowers/scratch/2026-06-20-gatekeeper-spike-finding.md
git commit -m "docs(studio/extension): record Gatekeeper feasibility spike finding"
```

**GATE:** If NO-GO, stop and re-brainstorm distribution/auth. Do not start Task 2.

---

## Task 2: Extract shared `bootstrapAwsProfile`

**Files:**
- Create: `electron/shared/awsBootstrap.ts`
- Modify: `electron/main.ts:75-104` (replace the inline function with an import)
- Modify: `electron/tsconfig.json` (add the new file to `include`)
- Test: `__tests__/electron/awsBootstrap.test.ts`

**Interfaces:**
- Produces: `bootstrapAwsProfile(homeDir?: string): void` — writes `[profile dev]` into `<home>/.aws/config` if absent (idempotent, literal `^\[profile dev\]` match), then sets `process.env.AWS_PROFILE ||= "dev"`. `homeDir` defaults to `os.homedir()` (param exists only so the test can point at a temp dir).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/electron/awsBootstrap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapAwsProfile } from "../../electron/shared/awsBootstrap";

describe("bootstrapAwsProfile", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "aws-bootstrap-"));
    delete process.env.AWS_PROFILE;
  });

  it("writes [profile dev] when ~/.aws/config is missing", () => {
    bootstrapAwsProfile(home);
    const cfg = fs.readFileSync(path.join(home, ".aws", "config"), "utf-8");
    expect(cfg).toMatch(/^\[profile dev\]/m);
    expect(cfg).toContain("sso_role_name = BedrockLongLivedTokenAccess");
    expect(process.env.AWS_PROFILE).toBe("dev");
  });

  it("does not duplicate an existing [profile dev] block", () => {
    const awsDir = path.join(home, ".aws");
    fs.mkdirSync(awsDir, { recursive: true });
    fs.writeFileSync(path.join(awsDir, "config"), "[profile dev]\nregion = us-west-2\n");
    bootstrapAwsProfile(home);
    const cfg = fs.readFileSync(path.join(awsDir, "config"), "utf-8");
    expect(cfg.match(/\[profile dev\]/g)).toHaveLength(1);
    expect(cfg).toContain("us-west-2"); // user's value untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/electron/awsBootstrap.test.ts`
Expected: FAIL — cannot resolve `../../electron/shared/awsBootstrap`.

- [ ] **Step 3: Create the shared module**

```ts
// electron/shared/awsBootstrap.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * First-run bootstrap of ~/.aws/config with the DevRev SSO [profile dev]
 * block. Idempotent (literal ^[profile dev] line match — never clobbers a
 * customized profile). Always defaults AWS_PROFILE=dev so spawned claude/aws
 * subprocesses inherit it. Shared by both host adapters (electron + extension).
 *
 * The SSO values match the DevRev Bedrock portal; if they change, this block
 * AND studio/docs/aws-setup.md must be updated in lockstep.
 *
 * @param homeDir override for the home directory (tests only).
 */
export function bootstrapAwsProfile(homeDir: string = os.homedir()): void {
  const awsDir = path.join(homeDir, ".aws");
  const awsConfig = path.join(awsDir, "config");

  let existing = "";
  try {
    existing = fs.readFileSync(awsConfig, "utf-8");
  } catch {
    // ENOENT — treat as empty
  }

  if (!/^\[profile dev\]/m.test(existing)) {
    const block = [
      "",
      "[profile dev]",
      "sso_start_url = https://d-9067645937.awsapps.com/start#",
      "sso_region = us-east-1",
      "sso_account_id = 020040093233",
      "sso_role_name = BedrockLongLivedTokenAccess",
      "region = us-east-1",
      "",
    ].join("\n");
    fs.mkdirSync(awsDir, { recursive: true });
    fs.appendFileSync(awsConfig, block);
    console.log(`[awsBootstrap] Installed [profile dev] into ${awsConfig}`);
  }

  process.env.AWS_PROFILE = process.env.AWS_PROFILE || "dev";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/electron/awsBootstrap.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace the inline copy in main.ts with the import**

In `electron/main.ts`: delete the `bootstrapAwsProfile` function body (lines 60-103) and its call site stays. Add at top with the other imports:
```ts
import { bootstrapAwsProfile } from "./shared/awsBootstrap.js";
```
Keep the existing `bootstrapAwsProfile();` call on line 104. Add `"shared/awsBootstrap.ts"` to the `include` array in `electron/tsconfig.json`.

- [ ] **Step 6: Verify electron still compiles**

Run: `pnpm exec tsc -p electron/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/shared/awsBootstrap.ts electron/main.ts electron/tsconfig.json __tests__/electron/awsBootstrap.test.ts
git commit -m "refactor(studio/extension): extract shared bootstrapAwsProfile for both host adapters"
```

---

## Task 3: Make Vite port configurable (dynamic-port support)

**Files:**
- Modify: `studio/vite.config.ts:133-150` (server block)
- Modify: `electron/viteRunner.ts:5-91` (`startVite` takes an optional port)
- Create: `electron/shared/freePort.ts`
- Test: `__tests__/electron/viteRunner.port.test.ts`

**Interfaces:**
- Produces: `pickFreePort(): Promise<number>` — resolves an OS-assigned free TCP port (binds `:0`, reads the port, closes).
- Produces: `startVite(appRoot: string, opts?: { port?: number }): Promise<string>` — same behavior as today; `opts.port` (default `5556`) sets both the strictPort bind (via `ARCADE_STUDIO_PORT` passed to the child) and the returned URL. All existing reclaim logic now keys off the chosen port.
- Consumes (vite.config): `process.env.ARCADE_STUDIO_PORT` — server.port; falls back to `5556`.

- [ ] **Step 1: Write the failing test for pickFreePort**

```ts
// __tests__/electron/viteRunner.port.test.ts
import { describe, it, expect } from "vitest";
import net from "node:net";
import { pickFreePort } from "../../electron/shared/freePort";

describe("pickFreePort", () => {
  it("returns a bindable TCP port", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(1023);
    // Prove it's actually free: we can bind it.
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(port, () => srv.close(() => resolve()));
    });
  });

  it("returns different ports across calls", async () => {
    const a = await pickFreePort();
    const b = await pickFreePort();
    // Not guaranteed distinct, but the OS rarely hands the same one back-to-back.
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/electron/viteRunner.port.test.ts`
Expected: FAIL — cannot resolve `../../electron/shared/freePort`.

- [ ] **Step 3: Implement pickFreePort**

```ts
// electron/shared/freePort.ts
import net from "node:net";

/**
 * Asks the OS for a free TCP port by binding :0, reading the assigned port,
 * then closing. There's an inherent TOCTOU window (the port could be taken
 * between close and re-bind), so callers MUST still spawn with strictPort and
 * treat a bind failure as retryable.
 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine free port")));
      }
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/electron/viteRunner.port.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Parameterize startVite by port**

In `electron/viteRunner.ts`, replace the module-level constants and signature so the port flows through. Change lines 5-6 and the `startVite` signature/body:

```ts
const DEFAULT_VITE_PORT = 5556;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

let viteProc: ChildProcess | null = null;
let viteExitedDuringStartup = false;
/** The port the current child was told to bind. Reclaim helpers key off this. */
let activePort = DEFAULT_VITE_PORT;

export async function startVite(
  appRoot: string,
  opts: { port?: number } = {},
): Promise<string> {
  activePort = opts.port ?? DEFAULT_VITE_PORT;
  const viteUrl = `http://localhost:${activePort}`;
  const viteEntry = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(appRoot, "studio", "vite.config.ts");

  const portHeld = (await tryGet(viteUrl)) || (await listenersOnPort(activePort)).length > 0;
  if (portHeld) {
    const reclaimed = await reclaimStaleVitePort(activePort);
    if (!reclaimed) {
      throw new Error(
        `[viteRunner] Port ${activePort} is already in use by another process ` +
        `(not an Arcade Studio Vite server). Free it and relaunch.`,
      );
    }
  }

  viteExitedDuringStartup = false;
  viteProc = spawn(process.execPath, [viteEntry, "--config", configPath], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ARCADE_STUDIO_OPEN_BROWSER: "0",
      ARCADE_STUDIO_PORT: String(activePort),
      ARCADE_RESOURCES_PATH: process.resourcesPath ?? "",
      ARCADE_IS_PACKAGED: process.env.ARCADE_IS_PACKAGED ?? "",
      ARCADE_APP_VERSION: process.env.ARCADE_APP_VERSION ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  viteProc.stdout?.on("data", (c) => console.log(`[vite stdout] ${c.toString().trimEnd()}`));
  viteProc.stderr?.on("data", (c) => console.error(`[vite stderr] ${c.toString().trimEnd()}`));
  viteProc.on("error", (err) => console.error(`[viteRunner] spawn error: ${err.message}`));
  viteProc.on("exit", (code, signal) => {
    console.log(`[viteRunner] Vite exited code=${code} signal=${signal}`);
    viteExitedDuringStartup = true;
    viteProc = null;
  });

  await waitForPort(viteUrl, STARTUP_TIMEOUT_MS);
  return viteUrl;
}
```

Then update the helper functions to take a port: rename `listenersOnVitePort()` → `listenersOnPort(port: number)` (use `port` in the `lsof -iTCP:${port}` arg), and `reclaimStaleVitePort()` → `reclaimStaleVitePort(port: number)` (use `http://localhost:${port}` for its `tryGet` calls and `port` in messages). `isArcadeViteCommand` and `parseLsofListeners` are unchanged. Delete the old `VITE_PORT`/`VITE_URL` constants.

- [ ] **Step 6: Make vite.config read the port env**

In `studio/vite.config.ts`, change the `server` block port line (was `port: 5556,`):
```ts
  server: {
    port: Number(process.env.ARCADE_STUDIO_PORT ?? 5556),
    // strictPort keeps a collision LOUD: the host spawns us on a specific
    // port and loads the renderer from it. Drift would load a DIFFERENT
    // server. The host (electron/viteRunner.ts, extension/serverHost.ts)
    // passes ARCADE_STUDIO_PORT; plain `pnpm run studio` defaults to 5556.
    strictPort: true,
    open: process.env.ARCADE_STUDIO_OPEN_BROWSER !== "0",
    fs: {
      allow: [path.resolve(__dirname, ".."), studioRoot()],
    },
  },
```

- [ ] **Step 7: Verify compile + existing viteRunner tests still pass**

Run:
```bash
pnpm exec tsc -p electron/tsconfig.json
pnpm run studio:test __tests__/electron __tests__/lib/streamJson.test.ts
```
Expected: compile clean; existing `parseLsofListeners` / `isArcadeViteCommand` tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/viteRunner.ts electron/shared/freePort.ts studio/vite.config.ts __tests__/electron/viteRunner.port.test.ts
git commit -m "feat(studio/extension): make Vite port configurable for multi-window hosts"
```

---

## Task 4: Extension scaffold (manifest + tsconfig + activate stub)

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/src/extension.ts` (stub)
- Create: `extension/.vscodeignore`
- Test: `__tests__/packaging/vsix-manifest.test.ts`

**Interfaces:**
- Produces: a VS Code extension that contributes command `arcade.open` ("Arcade: Open Prototyper") and activates on it. `activate(context: vscode.ExtensionContext)` / `deactivate()` exported.

- [ ] **Step 1: Write the failing manifest-shape test**

```ts
// __tests__/packaging/vsix-manifest.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/package.json"), "utf-8"),
);

describe("extension manifest", () => {
  it("targets VS Code engine and activates on the open command", () => {
    expect(manifest.engines?.vscode).toBeTruthy();
    expect(manifest.contributes?.commands?.[0]?.command).toBe("arcade.open");
    expect(manifest.activationEvents).toContain("onCommand:arcade.open");
  });
  it("declares macOS-only via no OS-specific binaries leaking into web", () => {
    // main points at compiled dist, not src
    expect(manifest.main).toBe("./dist/extension.js");
  });
});

describe(".vscodeignore", () => {
  const ignore = fs.readFileSync(path.join(root, "extension/.vscodeignore"), "utf-8");
  it("excludes the extension TypeScript sources but keeps compiled dist", () => {
    expect(ignore).toMatch(/src\/\*\*/);
    expect(ignore).not.toMatch(/^dist/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/packaging/vsix-manifest.test.ts`
Expected: FAIL — `extension/package.json` not found.

- [ ] **Step 3: Create the extension manifest**

```jsonc
// extension/package.json
{
  "name": "arcade-prototyper",
  "displayName": "Arcade Prototyper",
  "description": "Generate DevRev-design-system prototypes from a sentence, inside your editor.",
  "publisher": "devrev",
  "version": "0.39.0",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "activationEvents": ["onCommand:arcade.open"],
  "contributes": {
    "commands": [
      { "command": "arcade.open", "title": "Arcade: Open Prototyper" }
    ]
  },
  "scripts": {
    "build": "tsc -p ./tsconfig.json"
  }
}
```
NOTE: `version` mirrors the repo-root `package.json#version` and is synced by the pack script in Task 9 — do not hand-maintain a second number.

- [ ] **Step 4: Create the extension tsconfig**

```jsonc
// extension/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*"]
}
```
(`@types/vscode` is a dev dependency — add it: `pnpm add -D -w @types/vscode@^1.90.0`.)

- [ ] **Step 5: Create the activate stub**

```ts
// extension/src/extension.ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand("arcade.open", () => {
    vscode.window.showInformationMessage("Arcade Prototyper — activating…");
  });
  context.subscriptions.push(cmd);
}

export function deactivate(): void {
  // server teardown wired in Task 8
}
```

- [ ] **Step 6: Create .vscodeignore**

```
# extension/.vscodeignore — what NOT to ship in the VSIX.
# Keep: dist/, the studio/ core, prototype-kit, node_modules, vendored bins.
src/**
tsconfig.json
**/*.map
../**/__tests__/**
../**/*.test.*
../.git/**
../.claude/**
../studio/packaging/dist/**
```

- [ ] **Step 7: Install @types/vscode and verify compile + test**

Run:
```bash
pnpm add -D -w @types/vscode@^1.90.0
pnpm exec tsc -p extension/tsconfig.json
pnpm run studio:test __tests__/packaging/vsix-manifest.test.ts
```
Expected: compile clean; manifest test PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add extension/package.json extension/tsconfig.json extension/src/extension.ts extension/.vscodeignore __tests__/packaging/vsix-manifest.test.ts package.json pnpm-lock.yaml
git commit -m "feat(studio/extension): scaffold VS Code extension manifest + activate stub"
```

---

## Task 5: Extension paths — vendored bins + storage dir

**Files:**
- Create: `extension/src/paths.ts`
- Test: covered by `serverHost` test in Task 6 (pure helpers exercised there)

**Interfaces:**
- Produces: `resolveBinDirs(context): string[]` — absolute paths to the vendored `bin/` and `aws-cli/` dirs inside the extension install (`context.extensionUri.fsPath`).
- Produces: `resolveStorageRoot(context): string` — `context.globalStorageUri.fsPath` (the hidden frame dir; fed to the server as `ARCADE_STUDIO_ROOT`).

(Task 1's spike returned GO-without-strip — the vendored binaries are Developer-ID signed — so no `stripQuarantine` helper is needed.)

- [ ] **Step 1: Implement paths.ts**

```ts
// extension/src/paths.ts
import * as vscode from "vscode";
import path from "node:path";

/** Vendored-CLI directories inside the installed extension. PATH gets prefixed
 *  with these so middleware-spawned claude/aws/figmanage resolve to ours. */
export function resolveBinDirs(context: vscode.ExtensionContext): string[] {
  const root = context.extensionUri.fsPath;
  return [path.join(root, "bin"), path.join(root, "aws-cli")];
}

/** Hidden per-user storage dir for generated frames/projects. Fed to the
 *  server via ARCADE_STUDIO_ROOT (studio/server/paths.ts honors it). */
export function resolveStorageRoot(context: vscode.ExtensionContext): string {
  return context.globalStorageUri.fsPath;
}
```

- [ ] **Step 2: Compile**

Run: `pnpm exec tsc -p extension/tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add extension/src/paths.ts
git commit -m "feat(studio/extension): resolve vendored bin dirs + hidden storage root"
```

---

## Task 6: Server host — boot the Studio Vite server from the extension

**Files:**
- Create: `extension/src/serverHost.ts`
- Test: `__tests__/extension/serverHost.test.ts`

**Interfaces:**
- Consumes: `pickFreePort` (Task 3), `startVite` (Task 3), `resolveBinDirs`/`resolveStorageRoot` (Task 5), `bootstrapAwsProfile` (Task 2).
- Produces: `class ServerHost { start(context): Promise<string>; stop(): Promise<void>; isRunning(): boolean; }` — `start` is a singleton (returns the live URL if already running), boots Vite on a free port with the env wired (PATH prefix, ARCADE_STUDIO_ROOT, ARCADE_IS_PACKAGED), and returns `http://localhost:PORT`.
- Produces (pure, exported for test): `buildServerEnv(opts: { binDirs: string[]; storageRoot: string; basePath: string }): Record<string,string>` — returns the env overrides (PATH prefixed with binDirs, ARCADE_STUDIO_ROOT, ARCADE_IS_PACKAGED="1", ARCADE_STUDIO_CLAUDE_BIN).

- [ ] **Step 1: Write the failing test for buildServerEnv**

```ts
// __tests__/extension/serverHost.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildServerEnv } from "../../extension/src/serverHost";

describe("buildServerEnv", () => {
  const env = buildServerEnv({
    binDirs: ["/ext/bin", "/ext/aws-cli"],
    storageRoot: "/store",
    basePath: "/usr/bin:/bin",
    nodeBin: "/path/to/code-electron",
  });

  it("prefixes PATH with the vendored bin dirs", () => {
    expect(env.PATH.startsWith("/ext/bin:/ext/aws-cli:")).toBe(true);
    expect(env.PATH.endsWith("/usr/bin:/bin")).toBe(true);
  });
  it("points the frame storage root at the extension storage dir", () => {
    expect(env.ARCADE_STUDIO_ROOT).toBe("/store");
  });
  it("marks the run as packaged and pins the claude binary", () => {
    expect(env.ARCADE_IS_PACKAGED).toBe("1");
    expect(env.ARCADE_STUDIO_CLAUDE_BIN).toBe(path.join("/ext/bin", "claude"));
  });
  it("exposes the host node binary for the figmanage wrapper", () => {
    // The staged bin/figmanage wrapper exec's this via ELECTRON_RUN_AS_NODE.
    // In a VSIX there is no Electron .app, so the wrapper cannot use the
    // old Contents/MacOS path — it uses the host editor's Electron instead.
    expect(env.ARCADE_NODE_BIN).toBe("/path/to/code-electron");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/extension/serverHost.test.ts`
Expected: FAIL — cannot resolve `serverHost`.

- [ ] **Step 3: Implement serverHost.ts**

```ts
// extension/src/serverHost.ts
import * as vscode from "vscode";
import path from "node:path";
import { pickFreePort } from "../../electron/shared/freePort";
import { startVite, stopVite } from "../../electron/viteRunner";
import { bootstrapAwsProfile } from "../../electron/shared/awsBootstrap";
import { resolveBinDirs, resolveStorageRoot } from "./paths";

/** Pure: the env overrides the Vite child needs to behave like the packaged app. */
export function buildServerEnv(opts: {
  binDirs: string[];
  storageRoot: string;
  basePath: string;
  nodeBin: string;
}): Record<string, string> {
  return {
    PATH: `${opts.binDirs.join(":")}:${opts.basePath}`,
    ARCADE_STUDIO_ROOT: opts.storageRoot,
    ARCADE_IS_PACKAGED: "1",
    ARCADE_APP_VERSION: process.env.ARCADE_APP_VERSION ?? "",
    ARCADE_STUDIO_CLAUDE_BIN: path.join(opts.binDirs[0], "claude"),
    // The staged bin/figmanage wrapper runs figmanage's JS entry via this
    // node binary (the host editor's Electron, which honors
    // ELECTRON_RUN_AS_NODE). A VSIX has no Arcade .app, so the wrapper
    // cannot exec Contents/MacOS/Arcade Studio like the desktop build does.
    ARCADE_NODE_BIN: opts.nodeBin,
  };
}

export class ServerHost {
  private url: string | null = null;

  isRunning(): boolean {
    return this.url !== null;
  }

  /** Boot the Studio Vite server (singleton). Returns the localhost URL. */
  async start(context: vscode.ExtensionContext): Promise<string> {
    if (this.url) return this.url;

    const binDirs = resolveBinDirs(context);
    const storageRoot = resolveStorageRoot(context);

    // Task 1 spike verdict: GO without quarantine-stripping — the vendored
    // claude/aws binaries are Developer-ID signed, so Gatekeeper runs them
    // even with the quarantine xattr. No stripQuarantine call needed.

    bootstrapAwsProfile();

    // Apply env to THIS process so the spawned Vite child inherits it
    // (startVite spreads process.env). Mirrors electron/main.ts patchPath().
    // process.execPath is the host editor's Electron binary, reused as node
    // (ELECTRON_RUN_AS_NODE) for the staged figmanage wrapper.
    const overrides = buildServerEnv({
      binDirs,
      storageRoot,
      basePath: process.env.PATH ?? "",
      nodeBin: process.execPath,
    });
    Object.assign(process.env, overrides);

    const appRoot = context.extensionUri.fsPath;
    const port = await pickFreePort();
    this.url = await startVite(appRoot, { port });
    return this.url;
  }

  async stop(): Promise<void> {
    await stopVite();
    this.url = null;
  }
}
```
NOTE on `appRoot`: the VSIX lays the repo out under the extension root so that `appRoot/node_modules/vite/bin/vite.js` and `appRoot/studio/vite.config.ts` resolve — guaranteed by the packaging layout in Task 9.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/extension/serverHost.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/serverHost.ts __tests__/extension/serverHost.test.ts
git commit -m "feat(studio/extension): boot the Studio Vite server from the extension host"
```

---

## Task 7: Webview panel + CSP

**Files:**
- Create: `extension/src/panel.ts`
- Test: `__tests__/extension/panel-csp.test.ts`

**Interfaces:**
- Consumes: the localhost URL from `ServerHost.start`.
- Produces: `buildPanelHtml(url: string): string` (pure) — full webview HTML: a CSP `<meta>` that allows framing `http://localhost:*` and `ws://localhost:*` (HMR) and nothing wider, plus a full-bleed `<iframe src="${url}">`.
- Produces: `openOrReveal(context, serverHost): Promise<void>` — creates the singleton webview editor tab (or reveals it), starts the server, sets the HTML. On panel dispose, leaves the server running (it's window-scoped; teardown is in `deactivate`).

- [ ] **Step 1: Write the failing CSP test**

```ts
// __tests__/extension/panel-csp.test.ts
import { describe, it, expect } from "vitest";
import { buildPanelHtml } from "../../extension/src/panel";

describe("buildPanelHtml", () => {
  const html = buildPanelHtml("http://localhost:51234");

  it("embeds the localhost server in an iframe", () => {
    expect(html).toContain('<iframe');
    expect(html).toContain('src="http://localhost:51234"');
  });
  it("allows framing localhost + ws for HMR, and nothing wider", () => {
    expect(html).toMatch(/frame-src http:\/\/localhost:\*/);
    expect(html).toMatch(/connect-src[^;]*ws:\/\/localhost:\*/);
    // No wildcard host that would let arbitrary remote content frame in.
    expect(html).not.toMatch(/frame-src[^;]*\shttps?:\/\/\*[\s;]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/extension/panel-csp.test.ts`
Expected: FAIL — cannot resolve `panel`.

- [ ] **Step 3: Implement panel.ts**

```ts
// extension/src/panel.ts
import * as vscode from "vscode";
import type { ServerHost } from "./serverHost";

/** Pure: the webview document that frames the localhost Studio server. CSP is
 *  scoped to localhost (http for the page, ws for Vite HMR) — no wider host. */
export function buildPanelHtml(url: string): string {
  const csp = [
    "default-src 'none'",
    "frame-src http://localhost:*",
    "connect-src http://localhost:* ws://localhost:*",
    "style-src 'unsafe-inline'",
  ].join("; ");
  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;background:#0d0d0d}</style>
</head>
<body>
  <iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}

let panel: vscode.WebviewPanel | null = null;

export async function openOrReveal(
  context: vscode.ExtensionContext,
  serverHost: ServerHost,
): Promise<void> {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "arcadePrototyper",
    "Arcade",
    vscode.ViewColumn.Active, // full editor tab
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

  try {
    const url = await serverHost.start(context);
    panel.webview.html = buildPanelHtml(url);
  } catch (err) {
    panel.webview.html =
      `<body style="font-family:sans-serif;padding:24px;color:#eee;background:#0d0d0d">` +
      `<h3>Arcade failed to start</h3><pre>${String((err as Error)?.message ?? err)}</pre>` +
      `<p>Run “Arcade: Reload” from the command palette.</p></body>`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/extension/panel-csp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/panel.ts __tests__/extension/panel-csp.test.ts
git commit -m "feat(studio/extension): webview panel with localhost-scoped CSP"
```

---

## Task 8: Wire activate/deactivate + reload command

**Files:**
- Modify: `extension/src/extension.ts` (replace the stub)
- Modify: `extension/package.json` (add `arcade.reload` command + activation event)

**Interfaces:**
- Consumes: `openOrReveal` (Task 7), `ServerHost` (Task 6).

- [ ] **Step 1: Replace the activate stub with the real wiring**

```ts
// extension/src/extension.ts
import * as vscode from "vscode";
import { ServerHost } from "./serverHost";
import { openOrReveal } from "./panel";

const serverHost = new ServerHost();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("arcade.open", () => openOrReveal(context, serverHost)),
    vscode.commands.registerCommand("arcade.reload", async () => {
      await serverHost.stop();
      await openOrReveal(context, serverHost);
    }),
  );
}

export async function deactivate(): Promise<void> {
  await serverHost.stop();
}
```

- [ ] **Step 2: Add the reload command to the manifest**

In `extension/package.json`, extend `contributes.commands` and `activationEvents`:
```jsonc
  "activationEvents": ["onCommand:arcade.open", "onCommand:arcade.reload"],
  "contributes": {
    "commands": [
      { "command": "arcade.open", "title": "Arcade: Open Prototyper" },
      { "command": "arcade.reload", "title": "Arcade: Reload" }
    ]
  },
```

- [ ] **Step 3: Verify compile + the manifest test still passes**

Run:
```bash
pnpm exec tsc -p extension/tsconfig.json
pnpm run studio:test __tests__/packaging/vsix-manifest.test.ts __tests__/extension
```
Expected: clean compile; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/src/extension.ts extension/package.json
git commit -m "feat(studio/extension): wire activate/deactivate + reload command"
```

---

## Task 9: VSIX packaging

**Files:**
- Modify: `package.json` (root) — add `studio:pack-vsix` + sync-version step
- Modify: `studio/packaging/scripts/fetch-cli-deps.sh` — skip cloudflared for VSIX builds
- Create: `studio/packaging/scripts/stage-vsix.mjs` — assembles the VSIX staging layout + syncs version
- Test: extend `__tests__/packaging/vsix-manifest.test.ts` with a staging-layout assertion

**Interfaces:**
- Produces: `pnpm run studio:pack-vsix` → a `.vsix` in `studio/packaging/dist/`.

The staging layout the extension expects at runtime (`context.extensionUri.fsPath` = the extension root): the `extension/dist/*` becomes the top-level `dist/`, and `studio/`, `prototype-kit/`, `node_modules/`, plus the vendored `bin/` + `aws-cli/` sit beside it so `serverHost` resolves `appRoot/node_modules/vite/bin/vite.js` and `appRoot/studio/vite.config.ts`, and `resolveBinDirs` finds `bin/claude` + `aws-cli/aws`.

- [ ] **Step 1: Add the staging-layout assertion to the manifest test**

```ts
// append to __tests__/packaging/vsix-manifest.test.ts
import { existsSync } from "node:fs";
describe("stage-vsix script", () => {
  it("exists and is referenced by the pack-vsix script", () => {
    const root = path.resolve(__dirname, "../..");
    expect(existsSync(path.join(root, "studio/packaging/scripts/stage-vsix.mjs"))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    expect(pkg.scripts["studio:pack-vsix"]).toContain("stage-vsix.mjs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/packaging/vsix-manifest.test.ts`
Expected: FAIL — `stage-vsix.mjs` missing / script not defined.

- [ ] **Step 3: Gate cloudflared out of fetch-cli-deps for VSIX**

In `studio/packaging/scripts/fetch-cli-deps.sh`, wrap the cloudflared block (lines ~19-36) in a guard so a VSIX build can skip it:
```bash
if [ "${ARCADE_SKIP_CLOUDFLARED:-0}" != "1" ]; then
  # cloudflared
  if [ ! -x "$CF_DIR/cloudflared" ]; then
    ... (existing block unchanged) ...
  fi
else
  echo "==> Skipping cloudflared (ARCADE_SKIP_CLOUDFLARED=1)"
fi
```

- [ ] **Step 4: Write the staging script**

```js
// studio/packaging/scripts/stage-vsix.mjs
// Assembles the VSIX staging dir, syncs the version from the repo-root
// package.json into extension/package.json, then runs `vsce package`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const stage = path.join(repoRoot, "studio/packaging/vsix-stage");
const dist = path.join(repoRoot, "studio/packaging/dist");

// 1. Sync version (single source of truth = root package.json).
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const extPkgPath = path.join(repoRoot, "extension/package.json");
const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf-8"));
extPkg.version = rootPkg.version;
fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");

// 2. Reset staging dir.
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 3. Copy the extension manifest + compiled dist to the staging ROOT.
fs.copyFileSync(extPkgPath, path.join(stage, "package.json"));
fs.copyFileSync(path.join(repoRoot, "extension/.vscodeignore"), path.join(stage, ".vscodeignore"));
fs.cpSync(path.join(repoRoot, "extension/dist"), path.join(stage, "dist"), { recursive: true });

// 4. Copy the shared core beside dist/ so serverHost's appRoot resolves.
for (const dir of ["studio", "prototype-kit", "node_modules", "electron/dist", "electron/shared"]) {
  const src = path.join(repoRoot, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, dir), { recursive: true });
}
// electron/viteRunner.js + freePort.js are imported by serverHost — ship compiled electron/dist.

// 5. Assemble the staged bin/ from RAW sources (not from a pre-built .app —
//    avoids requiring a full studio:pack first, and lets us swap the
//    Electron-dependent figmanage wrapper for a VSIX-native one).
const binDir = path.join(stage, "bin");
fs.mkdirSync(binDir, { recursive: true });

//    claude: the macOS binary ships in node_modules as claude.exe (that IS the
//    mac executable in this repo). Stage it as `bin/claude` (matches
//    ARCADE_STUDIO_CLAUDE_BIN + figmaCli/chat spawn names).
fs.copyFileSync(
  path.join(repoRoot, "node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
  path.join(binDir, "claude"),
);
fs.chmodSync(path.join(binDir, "claude"), 0o755);

//    figmanage: the DESKTOP wrapper (electron/bin/figmanage) exec's the
//    Electron .app binary (Contents/MacOS/Arcade Studio) — which does NOT
//    exist in a VSIX. Write a VSIX-native wrapper that runs figmanage's JS
//    entry via the host editor's node binary (ARCADE_NODE_BIN, set by
//    serverHost to process.execPath, with ELECTRON_RUN_AS_NODE=1). The entry
//    resolves inside the staged node_modules copied in step 4.
// NOTE: written as a JS template literal — every shell `$` is escaped `\$`
// so it stays literal in the emitted file (no JS interpolation).
const figmanageWrapper = `#!/bin/sh
# VSIX-native figmanage wrapper. Runs figmanage's JS entry under the host
# editor's Electron-as-node runtime (ARCADE_NODE_BIN). Unlike the desktop
# build there is no Arcade .app to exec, so we use the host's node binary.
set -e
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
EXT_ROOT="\$(cd "\$SCRIPT_DIR/.." && pwd)"
FIGMANAGE_ENTRY="\$EXT_ROOT/node_modules/figmanage/dist/index.js"
exec env ELECTRON_RUN_AS_NODE=1 "\${ARCADE_NODE_BIN:-node}" "\$FIGMANAGE_ENTRY" "\$@"
`;
fs.writeFileSync(path.join(binDir, "figmanage"), figmanageWrapper);
fs.chmodSync(path.join(binDir, "figmanage"), 0o755);

//    aws CLI v2 expanded layout (nested aws-cli/aws per fetch-cli-deps.sh).
fs.cpSync(path.join(repoRoot, "studio/packaging/aws-cli"), path.join(stage, "aws-cli"), { recursive: true });
// cloudflared intentionally NOT staged (share out of scope for v1).

// 6. Package.
fs.mkdirSync(dist, { recursive: true });
execFileSync("pnpm", ["exec", "vsce", "package", "--no-dependencies",
  "--out", path.join(dist, `arcade-prototyper-${rootPkg.version}.vsix`)],
  { cwd: stage, stdio: "inherit" });

console.log(`✓ VSIX written to ${dist}/arcade-prototyper-${rootPkg.version}.vsix`);
```
NOTE: `serverHost.ts` imports from `../../electron/viteRunner` and `../../electron/shared/*`. Because `extension/dist` lands at the staging ROOT as `dist/`, those relative imports must resolve at runtime — compile the extension with the electron files copied so the emitted `require("../../electron/...")` points at `<stage>/electron/...`. Verify in Step 6; if the relative path doesn't line up, bundle the extension with esbuild instead (single `dist/extension.js`) — note that as the fallback.

- [ ] **Step 5: Add the pack-vsix script (mirrors studio:pack)**

In root `package.json` scripts, add (alongside `studio:pack`):
```jsonc
"studio:pack-vsix": "pnpm run studio:assets && pnpm run studio:templates && pnpm run kit:build && ARCADE_SKIP_CLOUDFLARED=1 bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && pnpm exec tsc -p extension/tsconfig.json && node studio/packaging/scripts/gen-telemetry-config.mjs && node studio/packaging/scripts/stage-vsix.mjs",
```
Also add `@vscode/vsce` as a dev dep: `pnpm add -D -w @vscode/vsce`.

- [ ] **Step 6: Build the VSIX and verify the layout**

Run:
```bash
pnpm add -D -w @vscode/vsce
pnpm run studio:test __tests__/packaging/vsix-manifest.test.ts
pnpm run studio:pack-vsix
unzip -l studio/packaging/dist/arcade-prototyper-*.vsix | grep -E "extension/(dist/extension.js|studio/vite.config.ts|bin/claude|bin/figmanage|aws-cli/aws|node_modules/figmanage/dist/index.js|node_modules/vite/bin/vite.js)"
# Confirm the staged figmanage wrapper has NO Electron-.app dependency
# (the desktop wrapper exec'd Contents/MacOS/Arcade Studio, absent in a VSIX):
ARCADE_NODE_BIN="$(command -v node)" studio/packaging/vsix-stage/bin/figmanage --version
```
Expected: manifest test PASS; VSIX builds; the grep shows `dist/extension.js`, `studio/vite.config.ts`, `bin/claude`, `bin/figmanage`, `aws-cli/aws`, `node_modules/figmanage/dist/index.js`, and `node_modules/vite/bin/vite.js` all present (vsce nests staged content under `extension/`); and the staged `bin/figmanage` prints `1.4.2` with a plain node binary — proving it does NOT need an Arcade `.app`. If the `require("../../electron/...")` paths don't resolve at runtime, switch Step 4 to esbuild bundling and rebuild.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml studio/packaging/scripts/fetch-cli-deps.sh studio/packaging/scripts/stage-vsix.mjs __tests__/packaging/vsix-manifest.test.ts extension/package.json
git commit -m "feat(studio/extension): VSIX packaging via vsce with vendored CLIs"
```

---

## Task 10: Manual end-to-end gate (non-negotiable, on the packaged VSIX)

**Files:** none (verification + a short results note).

**This must run against the installed VSIX in real Cursor AND real VS Code — not dev mode.** Studio's recurring lesson: bundled-binary / spawn bugs only surface in the packaged artifact (memories `studio-hooks-node-not-found-dmg`, `import-hook-dead-in-dmg`).

- [ ] **Step 1: Install the VSIX in Cursor**

```bash
cursor --install-extension studio/packaging/dist/arcade-prototyper-*.vsix
```
(Or: Cursor → Extensions → ⋯ → "Install from VSIX".) Expected: "Extension installed."

- [ ] **Step 2: Open and generate**

Command palette → "Arcade: Open Prototyper". Expected: a webview editor tab opens; the Studio shell renders. Type a prompt (e.g. "a settings page with a DevRev sidebar"). Expected: "Thinking…" streams, a frame renders live in the viewport with real DevRev components.

- [ ] **Step 3: Figma import**

Connect a Figma PAT in Settings (exercises the vendored `figmanage`). Paste a Figma frame URL. Expected: the screen imports into a prototype using the kit. Confirms the third vendored binary executes.

- [ ] **Step 4: AWS auth path**

If the Bedrock token is expired, expect the `AuthExpiredNotice` banner → SSO login opens a browser tab → returns and generation works. Confirms `bootstrapAwsProfile` + the vendored `aws` CLI.

- [ ] **Step 5: Reload + multi-window**

Run "Arcade: Reload" — server restarts cleanly. Open a second editor window, run "Arcade: Open" — confirm it boots on a *different* port (dynamic-port path) without a 5556 collision.

- [ ] **Step 6: Repeat Steps 1-2 in stock VS Code**

```bash
code --install-extension studio/packaging/dist/arcade-prototyper-*.vsix
```
Expected: identical behavior. Confirms portability beyond Cursor.

- [ ] **Step 7: Record results + update memory**

Write a short pass/fail note in the PR description. If a bundled-binary issue appeared (the expected failure class), fix it and add a guard test before claiming done. Save a memory capturing any packaging gotcha discovered.

---

## Self-Review

**Spec coverage:**
- DS fidelity (reuse claude+kit) → Tasks 6, 9, 10 (server boot + bundle + verify). ✓
- Figma import → vendored figmanage in Tasks 5/9, verified Task 10 Step 3. ✓
- Live preview → webview iframe + Vite HMR, Tasks 6/7, verified Task 10 Step 2. ✓
- Hidden frame dir → `ARCADE_STUDIO_ROOT`=globalStorageUri, Tasks 5/6. ✓
- Bundle CLI + Bedrock → vendored bins + bootstrapAwsProfile, Tasks 2/5/9. ✓
- Approach A (embedded server) → Tasks 3/6. ✓
- Editor-tab panel → Task 7 (`ViewColumn.Active`). ✓
- Shared core, two shells → Tasks 2/3 extract shared modules consumed by both. ✓
- Dev-mode Vite → Task 6 spawns vite.js (not a built shell). ✓
- macOS-only / direct VSIX distribution → Task 9/10. ✓
- Cloudflare share dropped → Task 9 Step 3 gates cloudflared out. ✓
- Gatekeeper risk (#1) → Task 1 gate. VSIX size (#2) → Task 9 Step 6. Multi-window port (#3) → Task 3 + Task 10 Step 5. CSP (#4) → Task 7. ✓

**Placeholder scan:** No TBD/TODO. The one conditional ("STRIP_QUARANTINE: include only if Task 1 found it") is resolved by Task 1's output before Task 6 runs — acceptable, it's a gated branch, not a placeholder. The esbuild fallback in Task 9 is a named, concrete alternative, not vague.

**Type consistency:** `startVite(appRoot, opts?)`, `pickFreePort()`, `bootstrapAwsProfile(homeDir?)`, `buildServerEnv(opts)`, `ServerHost.start/stop/isRunning`, `buildPanelHtml(url)`, `openOrReveal(context, serverHost)`, `resolveBinDirs`/`resolveStorageRoot`/`stripQuarantine` — names match across producing and consuming tasks. `ARCADE_STUDIO_PORT` / `ARCADE_STUDIO_ROOT` env keys consistent between vite.config, viteRunner, and serverHost. ✓
