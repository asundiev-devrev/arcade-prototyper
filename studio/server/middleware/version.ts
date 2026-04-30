import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where `build.sh` drops version.json inside the packaged .app:
//   <App>/Contents/Resources/version.json
// This middleware file lives at:
//   <repo>/studio/server/middleware/version.ts
// Inside the bundle that becomes:
//   <App>/Contents/Resources/app/studio/server/middleware/version.ts
// so ../../../../version.json resolves to the stamped file. In a dev
// checkout (running `pnpm run studio` from the repo) the file doesn't
// exist — we surface "dev" so the UI can label local builds distinctly.
const SERVER_MW_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSION_JSON = path.resolve(SERVER_MW_DIR, "..", "..", "..", "..", "version.json");

// In a packaged .app, build.sh copies CHANGELOG.md next to version.json
// (Contents/Resources/CHANGELOG.md). In a dev checkout, the source file
// lives at studio/CHANGELOG.md — four "../" from server/middleware/ lands
// at the repo root, then we pick it up from there.
const CHANGELOG_PACKAGED = path.resolve(SERVER_MW_DIR, "..", "..", "..", "..", "CHANGELOG.md");
const CHANGELOG_SOURCE = path.resolve(SERVER_MW_DIR, "..", "..", "CHANGELOG.md");

interface VersionInfo {
  base: string;
  build: string;
  gitSha?: string;
  builtAt?: string;
}

async function readVersion(): Promise<VersionInfo> {
  try {
    const raw = await fs.readFile(VERSION_JSON, "utf-8");
    const parsed = JSON.parse(raw) as Partial<VersionInfo>;
    if (typeof parsed.base === "string" && typeof parsed.build === "string") {
      return {
        base: parsed.base,
        build: parsed.build,
        gitSha: typeof parsed.gitSha === "string" ? parsed.gitSha : undefined,
        builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : undefined,
      };
    }
  } catch {
    // File missing or malformed — fall through to the dev-build shape.
  }
  return { base: "dev", build: "dev" };
}

async function readChangelog(): Promise<string | null> {
  // Packaged .app takes precedence — if it's there it's authoritative for
  // that build. Fall back to the in-repo source for dev checkouts.
  for (const p of [CHANGELOG_PACKAGED, CHANGELOG_SOURCE]) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch {
      // try the next path
    }
  }
  return null;
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
