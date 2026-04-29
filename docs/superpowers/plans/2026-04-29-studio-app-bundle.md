# Arcade Studio `.app` Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a double-clickable `Arcade Studio.app` (distributed as unsigned `.dmg`) that bundles Node, studio source, all npm dependencies, and `figmanage` (Figma's REST-based CLI), and boots the Vite dev server transparently so a DevRev designer can "drag to Applications → double-click → start using studio."

**Architecture:** A plain macOS `.app` is a directory with a fixed layout. We produce `dist/Arcade Studio.app/Contents/{MacOS,Resources,Info.plist}` via a bash build script. `Resources/node/` holds a downloaded Node.js tarball; `Resources/app/` holds the full `arcade-prototyper` repo with pre-installed `node_modules` (which includes `figmanage` as a local dep, plus `@anthropic-ai/claude-code`). `MacOS/Arcade Studio` is a bash launcher that prepends `Resources/app/node_modules/.bin` to `PATH`, waits for port 5556, and starts Vite. Ad-hoc code-signing (`codesign --sign -`) is applied at the end of the build so Gatekeeper on Apple Silicon doesn't mark the app as "damaged" — first-launch still requires the user to right-click → Open once, which is documented.

**Before packaging work begins**, this plan completes a small Figma CLI migration: studio today has a half-migrated state where the agent prompt uses `figmanage` (REST) but `server/figmaCli.ts` still shells out to the legacy `devrev/figma-cli` CDP bridge. The migration (tasks M1–M4) rewrites `figmaCli.ts` to call `figmanage`, deletes `figmaTabSelector.ts` (a CDP helper that becomes moot), and adds an in-app "Connect Figma" button so a fresh bundle user can authenticate without leaving Studio.

**Tech Stack:** macOS `.app` layout, bash build scripts, Node.js darwin-arm64 standalone distribution, `hdiutil` for DMG creation, `codesign` for ad-hoc signing, vitest for build-script assertions, `figmanage` CLI (published on npm) for Figma REST access.

---

## Scope

**In scope:**
- Figma CLI migration (tasks M1–M4): replace the legacy `figma-cli` CDP bridge with `figmanage`; remove `figmaTabSelector.ts`; add a "Connect Figma" UI flow.
- Build tooling at `studio/packaging/` that produces `dist/Arcade Studio.app` and `dist/Arcade Studio.dmg`.
- Bundled Node runtime (arm64 only in v1; x64/universal deferred).
- Pre-installed `node_modules` for the repo and studio, including `figmanage` and `@anthropic-ai/claude-code`.
- Launcher script that starts Vite in the background, opens `http://localhost:5556` once the port is live, and persists logs to `~/Library/Logs/arcade-studio.log`.
- "Already running" short-circuit: re-double-clicking the app just re-opens the browser tab.
- Ad-hoc `codesign` pass so the app does not get quarantined as "damaged."
- Gitignore for `dist/`.
- An internal-users README with the "right-click → Open" first-launch instruction.

**Explicitly out of scope (separate plans):**
- Background AWS SSO refresh keeper (Plan A).
- One-command `curl | sh` installer (Plan B).
- AWS CLI bundling or auto-`aws configure sso` (Plan B).
- Electron wrapper (alternative to this plan; explicitly chosen against).
- Apple Developer signing / notarization (deferred; acceptable for internal-only distribution).
- Intel (x64) and universal binaries (deferred; most DevRev laptops are Apple Silicon).
- Auto-update mechanism.

## Assumptions verified against the codebase

- `studio/vite.config.ts` hardcodes port 5556 and has `open: true` — Vite itself will open the browser once ready, but the launcher also force-opens so a user who closed the tab gets a fresh one. (vite.config.ts:67)
- `studio/server/claudeBin.ts` resolves Claude via `<repoRoot>/node_modules/.bin/claude` and falls back to `$PATH`. The bundle installs `@anthropic-ai/claude-code` into that location so no `$PATH` assumption is needed. (claudeBin.ts:20)
- `studio/server/paths.ts::studioRoot()` uses `~/Library/Application Support/arcade-studio/` — independent of where the `.app` is installed. Projects persist across app reinstalls. (paths.ts:11)
- `node_modules/.bin/claude` is absent in the current checkout, confirming the bundle must install `@anthropic-ai/claude-code` during the build.
- `package.json` at repo root has `playwright` as a devDep; `install-deps.sh` sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to avoid the 300 MB Chromium download during the bundle build.
- `studio/server/figmaCli.ts` currently spawns `node ~/figma-cli/src/index.js` (the legacy CDP binary); this is what migration task M1 rewrites.
- `studio/server/middleware/figma.ts` is the only consumer of `figmaCli.ts` at runtime; no `studio/src/` code calls `/api/figma/*` endpoints directly (confirmed by codebase search).
- `studio/templates/CLAUDE.md.tpl` already instructs the agent to use `figmanage reading get-nodes` and `figmanage export nodes` via Bash — so after migration the in-studio endpoints and the agent both standardize on figmanage.
- `figmanage` is published on npm as the `figmanage` package and installs a `figmanage` executable into `node_modules/.bin/`.

## File Structure

```
studio/
├── server/
│   ├── figmaCli.ts               # M1: rewritten to call `figmanage`
│   ├── figmaTabSelector.ts       # M3: deleted (CDP-only, now moot)
│   └── middleware/figma.ts       # M1/M2: endpoints reshape to take fileKey, new /auth/login
│
├── src/
│   └── components/shell/         # M4: "Connect Figma" button + status surface
│
└── packaging/
    ├── README.md                 # Internal install instructions; Gatekeeper workaround
    ├── build.sh                  # Main entry: produces dist/Arcade Studio.app
    ├── dmg.sh                    # Wraps the .app in a .dmg via hdiutil
    ├── launcher.sh               # Installed to Contents/MacOS/Arcade Studio
    ├── Info.plist                # .app metadata (name, bundle id, version)
    ├── icon.icns                 # Placeholder app icon
    ├── lib/
    │   ├── download-node.sh      # Fetches and extracts the Node tarball
    │   ├── copy-sources.sh       # Copies repo into Contents/Resources/app/
    │   ├── install-deps.sh       # Runs pnpm install + installs claude-code + figmanage
    │   └── codesign.sh           # Ad-hoc signs the bundle
    └── dist/                     # Build output (gitignored)
        ├── Arcade Studio.app/
        └── Arcade Studio.dmg

studio/__tests__/packaging/
└── build.test.ts                 # Asserts bundle structure after running build.sh
```

Each script is invokable standalone with a documented arg contract so individual steps can be debugged without re-running the whole build.

---

## Task 1: Scaffold packaging directory and gitignore

**Status:** ✅ Complete (commit `fad23dd`)

Scaffolded `studio/packaging/README.md`, added `studio/packaging/dist/` to `.gitignore`, added a vitest scaffold test.

---

## Task 2: Info.plist and icon

**Status:** ✅ Complete (commit `735b2ec`)

Created `studio/packaging/Info.plist` with DevRev bundle metadata and `studio/packaging/icon.icns` (placeholder generated via `lib/make-placeholder-icon.sh`).

---

## Task 3: Node runtime download script

**Status:** ✅ Complete (commit `2611d7d`)

Created `studio/packaging/lib/download-node.sh` that fetches Node 22.11.0 darwin tarball for a given arch. Test exercises a real download end-to-end.

---

## Task M1: Rewrite `figmaCli.ts` to call `figmanage`

**Files:**
- Modify: `studio/server/figmaCli.ts`
- Modify: `studio/__tests__/server/figmaCli.test.ts`

**Background:** The current `figmaCli.ts` spawns `node ~/figma-cli/src/index.js <subcommand>` for every call. The legacy CDP-based `figma-cli` is being retired in favor of `figmanage` (REST API, no Figma Desktop dependency). This task swaps the shell invocations.

**figmanage CLI surface mapping:**

| Today (legacy)                                         | After migration (figmanage)                             |
|--------------------------------------------------------|---------------------------------------------------------|
| `daemonStatus()` — `daemon status`                     | `figmaWhoami()` — `figmanage whoami`                    |
| `getNode(nodeId)` — `get <nodeId>`                     | `getNode(fileKey, nodeId)` — `figmanage reading get-nodes <file-key> <node-id> --json` |
| `nodeTree(nodeId, depth)` — `node tree <nodeId> -d N`  | `nodeTree(fileKey, nodeId, depth)` — `figmanage reading get-nodes <file-key> <node-id> --depth <N> --json` |
| `exportNodePng(nodeId, outFile, scale)` — `export node …` | `exportNodePng(fileKey, nodeId, outFile, scale)` — `figmanage export nodes <file-key> <node-id> --format png --scale <N> --json` → parse URL → `fetch` → save to `outFile` |
| `parseFigmaUrl(url)` — already exists, no change needed | (unchanged — still extracts `fileId` + `nodeId`)       |

The signatures now all take a `fileKey` because figmanage is stateless (no Desktop tab context).

- [ ] **Step 1: Update the existing test to reflect the new signatures**

Open `studio/__tests__/server/figmaCli.test.ts`. The existing test of `parseFigmaUrl` still passes unchanged. Add tests for the new callable functions by mocking `node:child_process.spawn`.

Replace the file contents with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import * as childProcess from "node:child_process";
import { parseFigmaUrl, figmaWhoami, getNode, nodeTree } from "../../server/figmaCli";

function mockSpawn(stdout: string, code = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutEmitter = new EventEmitter();
  (proc as any).stdout = stdoutEmitter;
  (proc as any).stderr = new EventEmitter();
  queueMicrotask(() => {
    stdoutEmitter.emit("data", Buffer.from(stdout));
    proc.emit("close", code);
  });
  return proc;
}

describe("parseFigmaUrl", () => {
  it("extracts file id and node id from a Figma URL", () => {
    const r = parseFigmaUrl("https://www.figma.com/design/AbC123/My-file?node-id=1038-14518");
    expect(r).toEqual({ fileId: "AbC123", nodeId: "1038:14518" });
  });
  it("returns null for non-Figma url", () => {
    expect(parseFigmaUrl("https://example.com/x")).toBeNull();
  });
});

describe("figmaCli (figmanage bridge)", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnSpy = vi.spyOn(childProcess, "spawn");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("figmaWhoami returns authenticated true when figmanage whoami exits 0", async () => {
    spawnSpy.mockImplementation(
      () => mockSpawn(JSON.stringify({ user: { email: "a@b.com" } }), 0) as any,
    );
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith(
      "figmanage",
      expect.arrayContaining(["whoami"]),
      expect.anything(),
    );
  });

  it("figmaWhoami returns authenticated false when figmanage whoami exits non-zero", async () => {
    spawnSpy.mockImplementation(() => mockSpawn("not logged in", 1) as any);
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(false);
  });

  it("getNode calls `figmanage reading get-nodes <fileKey> <nodeId> --json`", async () => {
    spawnSpy.mockImplementation(() => mockSpawn(JSON.stringify({ name: "Button" }), 0) as any);
    const r = await getNode("FILEKEY", "1:2");
    expect(r).toEqual({ name: "Button" });
    expect(spawnSpy).toHaveBeenCalledWith(
      "figmanage",
      ["reading", "get-nodes", "FILEKEY", "1:2", "--json"],
      expect.anything(),
    );
  });

  it("nodeTree passes --depth when specified", async () => {
    spawnSpy.mockImplementation(() => mockSpawn(JSON.stringify({ name: "root" }), 0) as any);
    await nodeTree("FILEKEY", "1:2", 4);
    expect(spawnSpy).toHaveBeenCalledWith(
      "figmanage",
      ["reading", "get-nodes", "FILEKEY", "1:2", "--depth", "4", "--json"],
      expect.anything(),
    );
  });
});
```

Run: `pnpm studio:test server/figmaCli`
Expected: FAIL — `figmaWhoami` / new signatures not implemented yet.

- [ ] **Step 2: Rewrite `studio/server/figmaCli.ts`**

Replace the file contents with:

```ts
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface ParsedFigmaUrl { fileId: string; nodeId: string; }

export function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("figma.com")) return null;
    const m = u.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    const nodeParam = u.searchParams.get("node-id");
    if (!m || !nodeParam) return null;
    return { fileId: m[1], nodeId: nodeParam.replace(/-/g, ":") };
  } catch { return null; }
}

async function runFigmanage(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("figmanage", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (c) => { stdout += c.toString(); });
    proc.stderr!.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export interface FigmaWhoamiResult {
  authenticated: boolean;
  user?: { email?: string; handle?: string };
}

export async function figmaWhoami(): Promise<FigmaWhoamiResult> {
  const r = await runFigmanage(["whoami", "--json"]);
  if (r.code !== 0) return { authenticated: false };
  try {
    const parsed = JSON.parse(r.stdout);
    return { authenticated: true, user: parsed?.user };
  } catch {
    // `figmanage whoami` may print plain text on success in some versions —
    // any non-zero is "not authenticated"; exit 0 without parseable JSON is
    // still "authenticated."
    return { authenticated: true };
  }
}

export async function getNode(fileKey: string, nodeId: string): Promise<unknown> {
  const r = await runFigmanage(["reading", "get-nodes", fileKey, nodeId, "--json"]);
  if (r.code !== 0) throw new Error(`figmanage get-nodes failed (${r.code}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export async function nodeTree(fileKey: string, nodeId: string, depth = 3): Promise<unknown> {
  const r = await runFigmanage(["reading", "get-nodes", fileKey, nodeId, "--depth", String(depth), "--json"]);
  if (r.code !== 0) throw new Error(`figmanage get-nodes (tree) failed (${r.code}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export async function exportNodePng(
  fileKey: string,
  nodeId: string,
  outFile: string,
  scale = 2,
): Promise<string> {
  const r = await runFigmanage([
    "export", "nodes", fileKey, nodeId,
    "--format", "png",
    "--scale", String(scale),
    "--json",
  ]);
  if (r.code !== 0) throw new Error(`figmanage export failed (${r.code}): ${r.stderr}`);

  // `figmanage export nodes --json` returns an object mapping nodeId → URL.
  // Shape: { "<nodeId>": "<https://...>", ... }
  let parsed: Record<string, string>;
  try { parsed = JSON.parse(r.stdout); }
  catch { throw new Error(`figmanage export returned unparseable JSON: ${r.stdout.slice(0, 200)}`); }

  const url = parsed[nodeId] ?? Object.values(parsed)[0];
  if (typeof url !== "string") {
    throw new Error(`figmanage export produced no URL for node ${nodeId}`);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, buf);
  return outFile;
}

/**
 * Spawn `figmanage login` as a child process. The command opens a browser
 * for OAuth and stores credentials in the OS keychain. Returns a handle that
 * streams stdout/stderr lines via the `onLine` callback and resolves when
 * the child exits. Used by the `/api/figma/auth/login` endpoint.
 */
export interface FigmaLoginHandle {
  stop: () => void;
  done: Promise<{ code: number; ok: boolean }>;
}

export function figmaLoginStream(onLine: (line: string) => void): FigmaLoginHandle {
  const proc = spawn("figmanage", ["login"], { stdio: ["ignore", "pipe", "pipe"] });
  const push = (chunk: Buffer | string) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line) onLine(line);
    }
  };
  proc.stdout!.on("data", push);
  proc.stderr!.on("data", push);
  const done = new Promise<{ code: number; ok: boolean }>((resolve) => {
    proc.on("close", (code) => resolve({ code: code ?? 1, ok: code === 0 }));
    proc.on("error", () => resolve({ code: 1, ok: false }));
  });
  return {
    stop: () => { try { proc.kill("SIGTERM"); } catch {} },
    done,
  };
}
```

Delete any import of `os` from the top — no longer needed now that `figmaCliDir()` is gone.

Run: `pnpm studio:test server/figmaCli`
Expected: PASS — all the tests (parseFigmaUrl + 4 new figmanage tests) green.

- [ ] **Step 3: Commit**

```bash
git add studio/server/figmaCli.ts studio/__tests__/server/figmaCli.test.ts
git commit -m "refactor(studio): rewrite figmaCli to call figmanage instead of legacy figma-cli"
```

---

## Task M2: Update `middleware/figma.ts` for the new signatures + add `/api/figma/auth/login`

**Files:**
- Modify: `studio/server/middleware/figma.ts`
- Modify: `studio/__tests__/server/middleware/figma.test.ts`

**New endpoint shapes:**

| Endpoint                         | Before                  | After                                                        |
|----------------------------------|-------------------------|--------------------------------------------------------------|
| `GET /api/figma/status`          | daemon-connected check  | `figmaWhoami()` — `{ authenticated: boolean, user?: {...} }` |
| `GET /api/figma/node/:fileKey/:nodeId` | (old: `/node/:nodeId`) | New path: requires `fileKey`; calls `getNode(fileKey, nodeId)` |
| `GET /api/figma/tree/:fileKey/:nodeId?d=N` | (old: `/tree/:nodeId`) | New: requires `fileKey`                                      |
| `POST /api/figma/export`         | body: `{nodeId, outFile, scale}` | body: `{fileKey, nodeId, outFile, scale}`           |
| `POST /api/figma/auth/login`     | —                       | **NEW** — spawns `figmanage login` and streams output over SSE |

- [ ] **Step 1: Rewrite the middleware test**

Replace `studio/__tests__/server/middleware/figma.test.ts` with:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { figmaMiddleware } from "../../../server/middleware/figma";
import * as cli from "../../../server/figmaCli";

let server: http.Server; let port: number; let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-figma-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  vi.spyOn(cli, "figmaWhoami").mockResolvedValue({ authenticated: true, user: { email: "a@b.com" } });
  vi.spyOn(cli, "getNode").mockResolvedValue({ name: "Button" });
  vi.spyOn(cli, "nodeTree").mockResolvedValue({ name: "root" });
  server = http.createServer(figmaMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  vi.restoreAllMocks();
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/figma", () => {
  it("status returns figmanage whoami result", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ authenticated: true, user: { email: "a@b.com" } });
  });

  it("status returns 200 with authenticated:false when unauthenticated", async () => {
    (cli.figmaWhoami as any).mockResolvedValueOnce({ authenticated: false });
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  it("reads a node by fileKey + nodeId", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/node/FILEKEY/1:2`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Button" });
    expect(cli.getNode).toHaveBeenCalledWith("FILEKEY", "1:2");
  });

  it("tree endpoint requires fileKey in the path", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/tree/FILEKEY/1:2?d=4`);
    expect(res.status).toBe(200);
    expect(cli.nodeTree).toHaveBeenCalledWith("FILEKEY", "1:2", 4);
  });

  it("export requires fileKey in the body", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: "1:2", outFile: "/etc/evil.png", scale: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("rejects export outFile outside the projects root with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: "F1", nodeId: "1:2", outFile: "/etc/evil.png", scale: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_path");
  });

  it("rejects malformed JSON body with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });
});
```

Run: `pnpm studio:test middleware/figma`
Expected: FAIL — middleware still uses old `daemonStatus` and old URL shapes.

- [ ] **Step 2: Rewrite `studio/server/middleware/figma.ts`**

Replace the file with:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { figmaWhoami, getNode, nodeTree, exportNodePng, figmaLoginStream } from "../figmaCli";
import { projectsRoot } from "../paths";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isInsideProjectsRoot(absPath: string): boolean {
  const root = projectsRoot();
  const rel = path.relative(root, absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function figmaMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/figma")) return next?.();
    try {
      if (url === "/api/figma/status") {
        return send(res, 200, await figmaWhoami());
      }

      // SSE endpoint: spawn `figmanage login`, stream stdout lines, close on exit.
      if (req.method === "POST" && url === "/api/figma/auth/login") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const handle = figmaLoginStream((line) => {
          res.write(`data: ${JSON.stringify({ kind: "line", line })}\n\n`);
        });
        req.on("close", () => handle.stop());
        const result = await handle.done;
        res.write(`data: ${JSON.stringify({ kind: "end", ...result })}\n\n`);
        res.end();
        return;
      }

      // GET /api/figma/node/:fileKey/:nodeId
      const nodeMatch = url.match(/^\/api\/figma\/node\/([^/]+)\/([^?]+)(?:\?.*)?$/);
      if (req.method === "GET" && nodeMatch) {
        return send(res, 200, await getNode(decodeURIComponent(nodeMatch[1]), decodeURIComponent(nodeMatch[2])));
      }

      // GET /api/figma/tree/:fileKey/:nodeId?d=N
      const treeMatch = url.match(/^\/api\/figma\/tree\/([^/]+)\/([^?]+)(?:\?d=(\d+))?/);
      if (req.method === "GET" && treeMatch) {
        return send(
          res, 200,
          await nodeTree(
            decodeURIComponent(treeMatch[1]),
            decodeURIComponent(treeMatch[2]),
            Number(treeMatch[3] ?? 3),
          ),
        );
      }

      if (req.method === "POST" && url === "/api/figma/export") {
        let buf = ""; for await (const c of req) buf += c;
        let parsed: { fileKey?: string; nodeId?: string; outFile?: string; scale?: number };
        try { parsed = JSON.parse(buf); }
        catch {
          return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
        }
        const { fileKey, nodeId, outFile, scale } = parsed;
        if (!fileKey || !nodeId || !outFile) {
          return send(res, 400, { error: { code: "bad_request", message: "fileKey, nodeId, outFile required" } });
        }
        const resolved = path.resolve(outFile);
        if (!isInsideProjectsRoot(resolved)) {
          return send(res, 400, { error: { code: "invalid_path", message: "outFile must be within the projects root" } });
        }
        const out = await exportNodePng(fileKey, nodeId, resolved, scale);
        return send(res, 200, { path: out });
      }

      send(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (err: any) {
      send(res, 500, { error: { code: "figma_error", message: err.message } });
    }
  };
}
```

Run: `pnpm studio:test middleware/figma`
Expected: PASS — all middleware tests green.

Also run the **full** studio test suite to catch anything else that imported the old symbols:
Run: `pnpm studio:test`
Expected: PASS — 141+ tests green. If anything fails, it's likely an import referencing `daemonStatus` from `figmaCli`; fix those references to use `figmaWhoami` instead.

- [ ] **Step 3: Commit**

```bash
git add studio/server/middleware/figma.ts studio/__tests__/server/middleware/figma.test.ts
git commit -m "refactor(studio): reshape /api/figma endpoints for figmanage (fileKey required, add /auth/login)"
```

---

## Task M3: Delete `figmaTabSelector.ts` and its chat integration

**Files:**
- Delete: `studio/server/figmaTabSelector.ts`
- Modify: `studio/server/middleware/chat.ts` (remove the `ensureFigmaFileSelected` call)
- Modify: `studio/ARCHITECTURE.md` (remove the three lines mentioning the CDP tab selector)

The tab selector only made sense with the CDP-based legacy CLI where multiple open Figma Desktop tabs could confuse node lookups. With figmanage (REST, stateless, takes `fileKey` explicitly), the concept is moot.

- [ ] **Step 1: Delete the server file**

```bash
git rm studio/server/figmaTabSelector.ts
```

- [ ] **Step 2: Remove the chat-middleware integration**

Open `studio/server/middleware/chat.ts`. Remove the import line:

```ts
import { ensureFigmaFileSelected } from "../figmaTabSelector";
```

Find the single call site (around line 146):

```ts
const sel = await ensureFigmaFileSelected(prompt);
```

Delete that line and any subsequent block that references `sel` (the variable name). Read the surrounding context carefully to make sure you also remove any log or event emission driven by `sel` — `grep -n "sel" studio/server/middleware/chat.ts` before editing to find all references.

- [ ] **Step 3: Remove references from ARCHITECTURE.md**

In `studio/ARCHITECTURE.md` remove these three lines (match by content; line numbers may drift):
- `│    ensureFigmaFileSelected → CDP on localhost:9222                         │` (inside an ASCII diagram)
- The bullet `- `ensureFigmaFileSelected(prompt)` — if the prompt contains a Figma URL, uses CDP …`
- The table row `| \`figmaTabSelector.ts\`   | \`ensureFigmaFileSelected(prompt)\` — CDP tab management on \`localhost:9222\` |`

Leave the surrounding structure intact; don't collapse empty rows.

- [ ] **Step 4: Run the test suite**

Run: `pnpm studio:test`
Expected: PASS. If `chat.test.ts` references `ensureFigmaFileSelected` in mocks, remove those too.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figmaTabSelector.ts studio/server/middleware/chat.ts studio/ARCHITECTURE.md
git commit -m "refactor(studio): delete figmaTabSelector — obsolete after figmanage migration"
```

---

## Task M4: In-app "Connect Figma" button

**Files:**
- Create: `studio/src/components/shell/FigmaConnectButton.tsx`
- Create: `studio/__tests__/components/FigmaConnectButton.test.tsx`
- Modify: `studio/src/components/shell/StudioHeader.tsx` (render the button)

The packaged Studio .app cannot pre-authenticate users to Figma. A fresh user hits `GET /api/figma/status` and sees `{ authenticated: false }`. The button opens an SSE connection to `POST /api/figma/auth/login` (which spawns `figmanage login`; figmanage opens a browser OAuth flow and stores the token in the OS keychain). Status polls resume on completion.

- [ ] **Step 1: Write a failing test**

Create `studio/__tests__/components/FigmaConnectButton.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FigmaConnectButton } from "../../src/components/shell/FigmaConnectButton";

describe("FigmaConnectButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows 'Connect Figma' when unauthenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: false }),
    }) as any;
    render(<FigmaConnectButton />);
    await waitFor(() => expect(screen.getByText(/Connect Figma/i)).toBeTruthy());
  });

  it("shows connected user email when authenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: true, user: { email: "test@example.com" } }),
    }) as any;
    render(<FigmaConnectButton />);
    await waitFor(() => expect(screen.getByText(/test@example.com/)).toBeTruthy());
  });
});
```

Run: `pnpm studio:test FigmaConnectButton`
Expected: FAIL — component does not exist.

- [ ] **Step 2: Write the component**

Create `studio/src/components/shell/FigmaConnectButton.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@xorkavi/arcade-gen";

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "connected"; email?: string }
  | { kind: "error"; message: string };

export function FigmaConnectButton() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [loggingIn, setLoggingIn] = useState(false);

  async function refreshStatus() {
    try {
      const res = await fetch("/api/figma/status");
      if (!res.ok) { setStatus({ kind: "error", message: `status ${res.status}` }); return; }
      const body = await res.json();
      if (body.authenticated) {
        setStatus({ kind: "connected", email: body?.user?.email });
      } else {
        setStatus({ kind: "disconnected" });
      }
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? String(err) });
    }
  }

  useEffect(() => { void refreshStatus(); }, []);

  async function startLogin() {
    setLoggingIn(true);
    try {
      // figmanage login opens a browser and writes a token to the keychain.
      // The endpoint streams output via SSE; we just wait for `end`.
      const res = await fetch("/api/figma/auth/login", { method: "POST" });
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // SSE frames delimited by blank lines. Look for kind:"end".
          const chunk = decoder.decode(value);
          if (/"kind":"end"/.test(chunk)) break;
        }
      }
      await refreshStatus();
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? String(err) });
    } finally {
      setLoggingIn(false);
    }
  }

  if (status.kind === "loading") {
    return <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>Figma…</span>;
  }
  if (status.kind === "connected") {
    return (
      <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
        Figma: {status.email ?? "connected"}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <Button variant="tertiary" size="sm" onClick={() => void refreshStatus()}>
        Figma error — retry
      </Button>
    );
  }
  return (
    <Button variant="tertiary" size="sm" onClick={() => void startLogin()} disabled={loggingIn}>
      {loggingIn ? "Connecting…" : "Connect Figma"}
    </Button>
  );
}
```

Run: `pnpm studio:test FigmaConnectButton`
Expected: PASS.

- [ ] **Step 3: Render the button in `StudioHeader`**

Open `studio/src/components/shell/StudioHeader.tsx`. The component currently accepts `right` as a prop for right-side content. We don't want to change the API, so instead the `ProjectList` route (at `studio/src/routes/ProjectList.tsx`) passes `<FigmaConnectButton />` alongside `AppSettingsButton`. Edit `ProjectList.tsx`:

Add import:
```tsx
import { FigmaConnectButton } from "../components/shell/FigmaConnectButton";
```

Change the header render from:
```tsx
right={
  <>
    <AppSettingsButton />
    <Button variant="primary" onClick={() => void createProject()} disabled={creating}>
      + New project
    </Button>
  </>
}
```
to:
```tsx
right={
  <>
    <FigmaConnectButton />
    <AppSettingsButton />
    <Button variant="primary" onClick={() => void createProject()} disabled={creating}>
      + New project
    </Button>
  </>
}
```

Run: `pnpm studio:test`
Expected: PASS — all tests still green.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/shell/FigmaConnectButton.tsx studio/__tests__/components/FigmaConnectButton.test.tsx studio/src/routes/ProjectList.tsx
git commit -m "feat(studio): in-app Connect Figma button (figmanage login flow)"
```

---

## Task 4: Launcher shell script

**Files:**
- Create: `studio/packaging/launcher.sh`
- Create: `studio/__tests__/packaging/launcher.test.ts`

The launcher runs inside `Contents/MacOS/Arcade Studio`. It determines the bundle root from its own path, puts the bundled Node **and** `node_modules/.bin/` on `PATH` (so both `node` and `figmanage` resolve without any other setup), starts Vite in the background, waits for port 5556, opens the default browser, then `wait`s on Vite so the `.app` shows as running in the Dock.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/launcher.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const launcher = path.resolve(__dirname, "..", "..", "packaging", "launcher.sh");

describe("launcher.sh", () => {
  it("exists and is executable", () => {
    expect(existsSync(launcher)).toBe(true);
    const mode = statSync(launcher).mode & 0o111;
    expect(mode).not.toBe(0);
  });

  it("resolves bundle root from BASH_SOURCE", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("BASH_SOURCE");
  });

  it("exports bundled Node on PATH", () => {
    expect(readFileSync(launcher, "utf-8")).toMatch(/PATH="[^"]*node\/bin/);
  });

  it("puts node_modules/.bin on PATH so figmanage resolves", () => {
    expect(readFileSync(launcher, "utf-8")).toMatch(/node_modules\/\.bin/);
  });

  it("short-circuits when port 5556 is already in use", () => {
    const body = readFileSync(launcher, "utf-8");
    expect(body).toContain("5556");
    expect(body).toMatch(/lsof.*5556/);
  });

  it("logs to ~/Library/Logs/arcade-studio.log", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("Library/Logs/arcade-studio.log");
  });
});
```

Run: `pnpm studio:test packaging/launcher`
Expected: FAIL — launcher.sh does not exist.

- [ ] **Step 2: Write `launcher.sh`**

Create `studio/packaging/launcher.sh`:

```bash
#!/bin/bash
# Arcade Studio launcher — runs inside Contents/MacOS/ of the .app bundle.
# Starts the Vite dev server with the bundled Node runtime, opens the browser,
# and keeps the process alive so the .app shows as running in the Dock.
set -euo pipefail

# Resolve the bundle root (the .app folder) from this script's own path.
# launcher.sh lives at <App>/Contents/MacOS/Arcade Studio — so two "../"
# lands at Contents/, and one more at the .app.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES="$SCRIPT_DIR/../Resources"
APP_DIR="$RESOURCES/app"
NODE_BIN="$RESOURCES/node/bin"
LOCAL_BIN="$APP_DIR/node_modules/.bin"

# $NODE_BIN first so `node` resolves to the bundled runtime.
# $LOCAL_BIN second so `figmanage`, `vite`, and `claude` all resolve from
# the bundle's node_modules without the host having them installed globally.
export PATH="$NODE_BIN:$LOCAL_BIN:$PATH"

# Point claudeBin.ts at the vendored install; belt-and-suspenders alongside
# $LOCAL_BIN on $PATH.
export ARCADE_STUDIO_CLAUDE_BIN="$LOCAL_BIN/claude"

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/arcade-studio.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# If port 5556 is already bound, assume a previous launch is still running.
# Just open the browser against the existing server and exit.
if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
  log "Port 5556 already in use — opening existing server"
  open "http://localhost:5556"
  exit 0
fi

log "Starting Vite from $APP_DIR"
cd "$APP_DIR"

# Vite has `open: true` in its config, so it opens the browser itself once
# listening. We still run `open` below as a safety net for cases where the
# user closed the tab — idempotent.
"$NODE_BIN/node" ./node_modules/.bin/vite --config studio/vite.config.ts >> "$LOG_FILE" 2>&1 &
VITE_PID=$!

# Wait up to 30s for the port to be ready, then open the browser defensively.
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
    open "http://localhost:5556"
    break
  fi
  sleep 0.5
done

# Stay attached so macOS shows the app as running and quitting it kills Vite.
trap 'log "Shutting down"; kill "$VITE_PID" 2>/dev/null || true; exit 0' TERM INT
wait "$VITE_PID"
```

Make it executable: `chmod +x studio/packaging/launcher.sh`

Run: `pnpm studio:test packaging/launcher`
Expected: PASS — all six assertions green.

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/launcher.sh studio/__tests__/packaging/launcher.test.ts
git commit -m "feat(studio/packaging): add app launcher script"
```

---

## Task 5: Source copy + dependency install scripts

**Files:**
- Create: `studio/packaging/lib/copy-sources.sh`
- Create: `studio/packaging/lib/install-deps.sh`
- Create: `studio/__tests__/packaging/install-deps.test.ts`

Copying: rsync the repo (excluding `.git`, `node_modules`, `dist/`, `studio/packaging/dist/`, screenshots) into `Contents/Resources/app/`.

Installing: inside the copied tree, run `pnpm install --frozen-lockfile` using the *bundled* Node, then install `@anthropic-ai/claude-code` so `node_modules/.bin/claude` resolves and `figmanage` so `node_modules/.bin/figmanage` resolves. The bundled Node is used so the install doesn't depend on the host's Node version.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/install-deps.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

const packaging = path.resolve(__dirname, "..", "..", "packaging");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

describe("copy-sources.sh + install-deps.sh", () => {
  it("copies repo without node_modules, .git, or dist", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-copy-"));
    try {
      execSync(
        `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}"`,
        { stdio: "inherit" },
      );
      expect(existsSync(path.join(tmp, "package.json"))).toBe(true);
      expect(existsSync(path.join(tmp, "studio", "src", "main.tsx"))).toBe(true);
      expect(existsSync(path.join(tmp, ".git"))).toBe(false);
      expect(existsSync(path.join(tmp, "node_modules"))).toBe(false);
      expect(existsSync(path.join(tmp, "studio", "packaging", "dist"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(
    "install-deps creates bin/vite, bin/claude, and bin/figmanage",
    { timeout: 300_000 },
    () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-install-"));
      try {
        execSync(
          `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}/app"`,
          { stdio: "inherit" },
        );
        execSync(
          `bash "${path.join(packaging, "lib", "install-deps.sh")}" "${tmp}/app"`,
          { stdio: "inherit" },
        );
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "vite"))).toBe(true);
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "claude"))).toBe(true);
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "figmanage"))).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
```

Run: `pnpm studio:test packaging/install-deps`
Expected: FAIL — scripts do not exist.

- [ ] **Step 2: Write `copy-sources.sh`**

Create `studio/packaging/lib/copy-sources.sh`:

```bash
#!/bin/bash
# Usage: copy-sources.sh <repo-root> <target>
# Copies the arcade-prototyper repo into <target>, excluding build artifacts,
# git data, existing node_modules, and screenshot scratch files.
set -euo pipefail

SRC="${1:?repo root required}"
DST="${2:?target required}"

mkdir -p "$DST"

rsync -a \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "studio/packaging/dist" \
  --exclude "dist" \
  --exclude ".omc" \
  --exclude ".playwright-mcp" \
  --exclude ".worktrees" \
  --exclude "*.png" \
  --exclude "*.jpg" \
  --exclude "*.pdf" \
  --exclude ".DS_Store" \
  "$SRC/" "$DST/"

echo "Copied repo to $DST"
```

Make it executable: `chmod +x studio/packaging/lib/copy-sources.sh`

- [ ] **Step 3: Write `install-deps.sh`**

Create `studio/packaging/lib/install-deps.sh`:

```bash
#!/bin/bash
# Usage: install-deps.sh <app-dir> [<bundled-node-bin>]
# Runs pnpm install inside <app-dir> using the bundled Node if provided
# (otherwise the host's Node), then installs the Claude CLI and figmanage
# locally so node_modules/.bin/{claude,figmanage} resolve without any host
# install.
set -euo pipefail

APP="${1:?app dir required}"
NODE_BIN_DIR="${2:-}"

cd "$APP"

if [ -n "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
  echo "Using bundled Node: $(node --version) from $NODE_BIN_DIR"
else
  echo "Using host Node: $(node --version)"
fi

# Ensure pnpm is reachable. Use corepack (ships with Node 22) so we don't
# rely on the host having pnpm installed.
corepack enable 2>/dev/null || true
corepack prepare pnpm@latest --activate 2>/dev/null || true

# Install with devDeps — studio runs via Vite (devDep), tailwindcss (devDep),
# @vitejs/plugin-react (devDep). We can't --prod=true. The playwright cost is
# accepted; skipping browsers is done via env below.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Vendor the Claude CLI and figmanage as local deps so node_modules/.bin/
# resolves both without the host having them globally installed.
pnpm add --save-exact @anthropic-ai/claude-code figmanage

echo "Deps installed. bin contents:"
ls node_modules/.bin/ | head -30
```

Make it executable: `chmod +x studio/packaging/lib/install-deps.sh`

- [ ] **Step 4: Run the test**

Run: `pnpm studio:test packaging/install-deps`
Expected: PASS (may take several minutes the first time due to pnpm install).

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/lib/copy-sources.sh studio/packaging/lib/install-deps.sh studio/__tests__/packaging/install-deps.test.ts
git commit -m "feat(studio/packaging): add source copy and dep install scripts"
```

---

## Task 7: Ad-hoc code signing script

**Files:**
- Create: `studio/packaging/lib/codesign.sh`
- Create: `studio/__tests__/packaging/codesign.test.ts`

Apple Silicon Gatekeeper refuses to run any unsigned binary — it marks it as "damaged." An ad-hoc signature (`codesign --sign -`) is the minimum that keeps the app launchable. It still triggers the "cannot verify developer" dialog on first launch; the user must right-click → Open once.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/codesign.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("codesign.sh", () => {
  it("ad-hoc signs a .app bundle end-to-end", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-sign-"));
    try {
      const app = path.join(tmp, "Fake.app");
      const macos = path.join(app, "Contents", "MacOS");
      mkdirSync(macos, { recursive: true });
      const bin = path.join(macos, "Fake");
      writeFileSync(bin, "#!/bin/bash\necho hi\n");
      chmodSync(bin, 0o755);
      writeFileSync(
        path.join(app, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Fake</string>
<key>CFBundleIdentifier</key><string>com.devrev.fake</string>
<key>CFBundleExecutable</key><string>Fake</string>
<key>CFBundleVersion</key><string>0.1</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
      );

      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "codesign.sh");
      execSync(`bash "${script}" "${app}"`, { stdio: "inherit" });
      execSync(`codesign -dv "${app}" 2>&1`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

Run: `pnpm studio:test packaging/codesign`
Expected: FAIL.

- [ ] **Step 2: Write `codesign.sh`**

Create `studio/packaging/lib/codesign.sh`:

```bash
#!/bin/bash
# Usage: codesign.sh <path-to-.app>
# Ad-hoc signs the .app so Gatekeeper on Apple Silicon does not quarantine
# it as "damaged". First launch still requires right-click → Open once.
set -euo pipefail

APP="${1:?app path required}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

codesign --force --deep --sign - --timestamp=none "$APP"
codesign -dv "$APP"
echo "Ad-hoc signed: $APP"
```

Make it executable: `chmod +x studio/packaging/lib/codesign.sh`

Run: `pnpm studio:test packaging/codesign`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/lib/codesign.sh studio/__tests__/packaging/codesign.test.ts
git commit -m "feat(studio/packaging): ad-hoc code signing"
```

---

## Task 8: End-to-end build script

**Files:**
- Create: `studio/packaging/build.sh`
- Create: `studio/__tests__/packaging/build.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/build.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const dist = path.join(repoRoot, "studio", "packaging", "dist");
const app = path.join(dist, "Arcade Studio.app");

describe("build.sh (end-to-end)", () => {
  it("produces a launchable .app", { timeout: 900_000 }, () => {
    rmSync(dist, { recursive: true, force: true });
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "build.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(app)).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Info.plist"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "MacOS", "Arcade Studio"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "icon.icns"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "node", "bin", "node"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "studio", "vite.config.ts"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "vite"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "claude"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "figmanage"))).toBe(true);

    const mode = statSync(path.join(app, "Contents", "MacOS", "Arcade Studio")).mode & 0o111;
    expect(mode).not.toBe(0);
    execSync(`codesign -dv "${app}" 2>&1`);
  });
});
```

Run: `pnpm studio:test packaging/build`
Expected: FAIL — script does not exist.

- [ ] **Step 2: Write `build.sh`**

Create `studio/packaging/build.sh`:

```bash
#!/bin/bash
# Arcade Studio .app build.
# Produces studio/packaging/dist/Arcade Studio.app (and .dmg via dmg.sh).
#
# Stages, each handled by a dedicated script under lib/:
#   1. Clean any prior dist/Arcade Studio.app/
#   2. Scaffold Contents/{MacOS,Resources}/ and drop Info.plist + icon.
#   3. Download Node into Resources/node/.
#   4. Copy repo into Resources/app/.
#   5. Install node_modules (incl. claude-code + figmanage) into Resources/app/.
#   6. Install launcher.sh into MacOS/ (renamed to the bundle executable).
#   7. Ad-hoc codesign the bundle.
set -euo pipefail

ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64)        NODE_ARCH=x64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$PKG_DIR/../.." && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"

echo "==> Cleaning prior build"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

echo "==> Installing Info.plist and icon"
cp "$PKG_DIR/Info.plist" "$CONTENTS/Info.plist"
cp "$PKG_DIR/icon.icns"  "$RESOURCES/icon.icns"

echo "==> Downloading Node ($NODE_ARCH)"
bash "$PKG_DIR/lib/download-node.sh" "$RESOURCES/node" "$NODE_ARCH"

echo "==> Copying repo into Resources/app"
bash "$PKG_DIR/lib/copy-sources.sh" "$REPO_ROOT" "$RESOURCES/app"

echo "==> Installing dependencies"
bash "$PKG_DIR/lib/install-deps.sh" "$RESOURCES/app" "$RESOURCES/node/bin"

echo "==> Installing launcher"
cp "$PKG_DIR/launcher.sh" "$MACOS/Arcade Studio"
chmod +x "$MACOS/Arcade Studio"

echo "==> Ad-hoc codesigning"
bash "$PKG_DIR/lib/codesign.sh" "$APP"

echo ""
echo "✓ Built: $APP"
du -sh "$APP"
```

Make it executable: `chmod +x studio/packaging/build.sh`

Run: `pnpm studio:test packaging/build`
Expected: PASS. Takes ~5–10 minutes for a cold build.

- [ ] **Step 3: Manually smoke-test the built app**

```bash
open "studio/packaging/dist/Arcade Studio.app"
```

Expected: terminal-less launch; browser opens at `http://localhost:5556`; project list renders. The "Connect Figma" button appears. Check `~/Library/Logs/arcade-studio.log`.

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/build.sh studio/__tests__/packaging/build.test.ts
git commit -m "feat(studio/packaging): end-to-end build script"
```

---

## Task 9: DMG packager

**Files:**
- Create: `studio/packaging/dmg.sh`
- Create: `studio/__tests__/packaging/dmg.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/dmg.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const app = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.app");
const dmg = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.dmg");

describe("dmg.sh", () => {
  it("wraps the built .app in a .dmg with an /Applications symlink", { timeout: 120_000 }, () => {
    if (!existsSync(app)) {
      console.warn("Skipping dmg test: .app not yet built. Run build.sh first.");
      return;
    }
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "dmg.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(dmg)).toBe(true);
    expect(statSync(dmg).size).toBeGreaterThan(50_000_000);
  });
});
```

Run: `pnpm studio:test packaging/dmg`
Expected: FAIL (or skip if .app missing).

- [ ] **Step 2: Write `dmg.sh`**

Create `studio/packaging/dmg.sh`:

```bash
#!/bin/bash
# Wrap dist/Arcade Studio.app in dist/Arcade Studio.dmg.
# Includes a symlink to /Applications so users can drag-install.
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
DMG="$DIST/Arcade Studio.dmg"

if [ ! -d "$APP" ]; then
  echo "Missing $APP. Run build.sh first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Arcade Studio" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

echo ""
echo "✓ DMG: $DMG"
du -sh "$DMG"
```

Make it executable: `chmod +x studio/packaging/dmg.sh`

Run: `pnpm studio:test packaging/dmg`
Expected: PASS (after build.sh runs).

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/dmg.sh studio/__tests__/packaging/dmg.test.ts
git commit -m "feat(studio/packaging): wrap .app in distributable .dmg"
```

---

## Task 10: Add `pnpm studio:pack` script and wire docs

**Files:**
- Modify: `package.json` (repo root) — add `studio:pack` script
- Modify: `studio/README.md` — point to packaging README; update Figma prereqs (remove `figma-cli`; note figmanage is vendored in the bundle but required globally for dev)
- Modify: `studio/DEVELOPMENT.md` — add "Building the .app" section; update Figma row in the prereqs table

- [ ] **Step 1: Add script**

Edit `package.json` to add:
```json
"studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh"
```

- [ ] **Step 2: Update `studio/README.md`**

In the prerequisites list, replace:
```
- [figma-cli](https://github.com/devrev/figma-cli) at `~/figma-cli`, Figma Desktop running
```
with:
```
- `figmanage` CLI installed globally (the bundle install includes it — for local dev install via `npm i -g figmanage`)
```

In "Further reading", add:
```
- **[packaging/README.md](./packaging/README.md)** — building Arcade Studio as a distributable `.app` / `.dmg` for internal users
```

- [ ] **Step 3: Update `studio/DEVELOPMENT.md`**

Replace the `figma-cli` and `figmanage` rows of the prereq table with a single row:

```
| figmanage      | REST-backed Figma CLI used by `figmaCli.ts`            | `npm install -g figmanage`, then `figmanage login`    |
```

Remove the entire "Figma Desktop + figma-cli" subsection — no longer applicable.

Remove the `ARCADE_STUDIO_FIGMA_CLI_DIR` row from the env vars table.

Add a new section under "Running studio":

```markdown
## Building a distributable `.app`

For internal DevRev distribution, studio can be packaged as a double-clickable macOS app.

\`\`\`bash
pnpm studio:pack
\`\`\`

This produces:

- `studio/packaging/dist/Arcade Studio.app` — drag to `/Applications`
- `studio/packaging/dist/Arcade Studio.dmg` — hand to non-technical users

See [studio/packaging/README.md](./packaging/README.md) for the first-launch Gatekeeper workaround (right-click → Open) and for caveats about the bundle being unsigned.
```

In the troubleshooting section, replace `### "Missing dependencies: figmanage" on first run` body to say: "Run `npm install -g figmanage` then `figmanage login`. For bundle users, figmanage is vendored — they only need `figmanage login` the first time, which the in-app 'Connect Figma' button handles."

- [ ] **Step 4: Verify pnpm picks up the new script**

```bash
pnpm run | grep studio:pack
```
Expected: the script is listed.

- [ ] **Step 5: Commit**

```bash
git add package.json studio/README.md studio/DEVELOPMENT.md
git commit -m "docs(studio): document pnpm studio:pack and figmanage migration"
```

---

## Task 11: Manual verification + troubleshooting entries

**Files:**
- Modify: `studio/packaging/README.md` — add "Troubleshooting" section

- [ ] **Step 1: End-to-end manual verification**

On a clean test account (or after `rm -rf "$HOME/Library/Application Support/arcade-studio"`):

1. Run `pnpm studio:pack` at the repo root.
2. Wait for build to finish (~10 min cold).
3. `open "studio/packaging/dist/Arcade Studio.dmg"` — verify DMG mounts.
4. Drag `Arcade Studio.app` into `/Applications`.
5. Eject the DMG.
6. Right-click `Arcade Studio` in `/Applications` → **Open** → **Open** in the dialog.
7. Verify the browser opens to `http://localhost:5556` within ~15 seconds.
8. Verify project list renders and the "Connect Figma" button appears.
9. Click "Connect Figma" — verify a browser tab opens for Figma OAuth, complete the flow, return to Studio and verify the button updates to show the connected email.
10. Create a project and paste a Figma URL in the chat — verify the agent can read/export nodes (requires a real AWS SSO session).
11. Quit via Cmd-Q from the Dock. Verify Vite shuts down (no listener on 5556 after a few seconds).
12. Double-click the app again. Verify it reopens without the Gatekeeper dialog and that the Figma connection persists.

Record any deviations in the troubleshooting section below.

- [ ] **Step 2: Append troubleshooting to `studio/packaging/README.md`**

Append this section:

```markdown
## Troubleshooting

### "Arcade Studio is damaged and can't be opened"

You double-clicked before right-clicking → Open on first launch. Fix:

\`\`\`bash
xattr -dr com.apple.quarantine "/Applications/Arcade Studio.app"
\`\`\`

Then right-click → Open.

### Port 5556 already in use

Another studio instance (or a stale Vite process) is still running. The app detects this and opens the browser against the existing server. If the existing one is broken:

\`\`\`bash
lsof -ti:5556 | xargs kill
\`\`\`

### Nothing happens on double-click

Check the launcher log:

\`\`\`bash
tail -100 "$HOME/Library/Logs/arcade-studio.log"
\`\`\`

### "Connect Figma" button doesn't complete

`figmanage login` opens your default browser for OAuth. If the button hangs, check:
- Is your default browser set? (`open https://example.com` should work.)
- Did the OAuth redirect succeed? (`figmanage whoami` should print your email if so.)
- Close the browser tab and click "Connect Figma" again — the command is idempotent.

### "aws sso login" required on every chat turn

This plan does not cover SSO auto-refresh. See the separate "SSO keeper" plan.
```

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/README.md
git commit -m "docs(studio/packaging): troubleshooting for first-launch, port, and figma login"
```

---

## Self-Review

**Spec coverage:**
- ✅ figmaCli.ts migrated to figmanage (M1)
- ✅ middleware/figma.ts reshaped with fileKey + /auth/login (M2)
- ✅ figmaTabSelector.ts deleted (M3)
- ✅ In-app Connect Figma button (M4)
- ✅ Bundled Node runtime (Task 3)
- ✅ Pre-installed node_modules incl. claude-code + figmanage (Task 5)
- ✅ Studio source in bundle (Task 5)
- ✅ Launcher with figmanage on PATH (Task 4)
- ✅ "Already running" short-circuit (Task 4)
- ✅ Ad-hoc signing (Task 7)
- ✅ DMG packaging (Task 9)
- ✅ Unsigned OK for internal (Tasks 1, 2, 11 docs)
- ✅ README with right-click → Open (Tasks 1 + 11)
- ⚠️ SSO auto-refresh — out of scope, noted in troubleshooting
- ⚠️ Intel (x64) — deferred; `build.sh` accepts `ARCH=x64` so it's producible manually

**Placeholder scan:** no TBDs, every step shows exact contents.

**Type consistency:** `figmaWhoami` / `getNode(fileKey, nodeId)` / `nodeTree(fileKey, nodeId, depth)` / `exportNodePng(fileKey, nodeId, outFile, scale)` / `figmaLoginStream(onLine)` names match across M1, M2, M4.

**Known risks:**
- `figmanage login` interactively opens a browser; the SSE stream is cosmetic — the real completion signal is the child exit. Tested by manual smoke in Task 11.
- The agent prompt (`templates/CLAUDE.md.tpl`) already references figmanage commands, so no template change is required.
- If `figmanage whoami --json` in a specific version prints plain text instead of JSON, `figmaWhoami` falls back to "authenticated" (exit 0 is the source of truth).
- Corepack must be enabled; `install-deps.sh` handles this with a guarded `corepack enable || true`.
