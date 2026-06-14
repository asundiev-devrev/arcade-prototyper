import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// We read the build version from the top-level `package.json#version`.
// electron-builder reads the same field at packaging time and bakes it
// into latest-mac.yml + the .app's Info.plist, so package.json is the
// single source of truth in both dev and packaged modes.
//
// This middleware file lives at:
//   <repo>/studio/server/middleware/version.ts                       (dev)
//   <App>/Contents/Resources/app/studio/server/middleware/version.ts (packaged)
// In both cases, three "../" lands on the repo root / app root where
// package.json sits (electron-builder.yml's `files:` glob copies
// package.json to <Resources>/app/package.json).
const SERVER_MW_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = path.resolve(SERVER_MW_DIR, "..", "..", "..", "package.json");

// CHANGELOG.md lives at studio/CHANGELOG.md in the source tree, which
// electron-builder bundles to <Resources>/app/studio/CHANGELOG.md via
// the `studio/**/*` glob. Three "../" from server/middleware/ resolves
// to studio/, so the same path works in dev and in the packaged app.
const CHANGELOG_SOURCE = path.resolve(SERVER_MW_DIR, "..", "..", "CHANGELOG.md");

interface VersionInfo {
  base: string;
  build: string;
  gitSha?: string;
  builtAt?: string;
}

async function readVersion(): Promise<VersionInfo> {
  try {
    const raw = await fs.readFile(PACKAGE_JSON, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      // Mirror the previous shape: `base` is the semver, `build` is the
      // user-facing label. The old build.sh distinguished the two so a
      // "-dirty" suffix could land in `build` only; electron-builder
      // doesn't ship that distinction yet, so for now they're identical
      // and future suffixes (e.g., commit SHA) can be appended to `build`.
      return { base: parsed.version, build: parsed.version };
    }
  } catch {
    // File missing or malformed — fall through to the dev-build shape.
  }
  return { base: "dev", build: "dev" };
}

async function readChangelog(): Promise<string | null> {
  // Same path resolves in dev and packaged builds — see CHANGELOG_SOURCE
  // comment above.
  try {
    return await fs.readFile(CHANGELOG_SOURCE, "utf-8");
  } catch {
    return null;
  }
}

export function versionMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/api/version") {
      const info = await readVersion();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
      return;
    }
    if (req.method === "GET" && url === "/api/changelog") {
      const body = await readChangelog();
      if (body === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", message: "Changelog unavailable" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(body);
      return;
    }
    return next?.();
  };
}

// Used at studio boot to print a single `[version] …` log line, so when
// a beta tester pastes their launcher log we can see the build at a glance
// without asking them to click around in the UI.
export async function logVersionOnBoot(): Promise<void> {
  const info = await readVersion();
  console.log(`[version] Arcade Studio ${info.build}`);
}
