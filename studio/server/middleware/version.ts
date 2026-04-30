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

export function versionMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/version" || req.method !== "GET") return next?.();
    const info = await readVersion();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info));
  };
}

// Used at studio boot to print a single `[version] …` log line, so when
// a beta tester pastes their launcher log we can see the build at a glance
// without asking them to click around in the UI.
export async function logVersionOnBoot(): Promise<void> {
  const info = await readVersion();
  console.log(`[version] Arcade Studio ${info.build}`);
}
