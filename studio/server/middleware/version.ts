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

// GitHub repo the update-checker polls for public releases. Hardcoded
// because it's a distribution fact, not a user setting — a downstream
// fork can change this constant.
//
// We deliberately point at a public mirror repo rather than the main
// (private) source repo. Releases on private repos return 404 to
// unauthenticated callers, which would silently break the banner for
// all beta testers. The mirror repo carries only DMG artifacts; source
// stays private.
const GITHUB_RELEASES_URL = "https://api.github.com/repos/asundiev-devrev/arcade-studio-releases/releases/latest";
// How long to cache the upstream response in-memory. Conservative; the
// point is to avoid hammering the GitHub API on every app reload while
// still seeing new releases within an hour of publish.
const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;

interface UpdateCheckCache {
  fetchedAt: number;
  body: UpdateCheckResult;
}
let updateCheckCache: UpdateCheckCache | null = null;

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  /** True when `latest` could not be determined. Surface neutrally — do not alarm the user. */
  unknown?: boolean;
  upToDate: boolean;
  downloadUrl: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
}

function compareSemver(a: string, b: string): number {
  const aa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Fetch the latest public release from GitHub and compare against the
 * running build. Returns a neutral "unknown" result on any network or
 * parse error — the banner UI should not alarm the user when GitHub is
 * unreachable or the repo has no public releases yet.
 *
 * Exported for tests; the HTTP handler wraps it below.
 */
export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const fallback: UpdateCheckResult = {
    current,
    latest: null,
    unknown: true,
    upToDate: true,
    downloadUrl: null,
    releaseUrl: null,
    releaseNotes: null,
    publishedAt: null,
  };
  let body: any;
  try {
    const res = await fetchImpl(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return fallback;
    body = await res.json();
  } catch {
    return fallback;
  }
  // GitHub returns the release object's tag_name as "v0.4.4" or "0.4.4"
  // depending on how you tag. Strip a leading `v` defensively.
  const rawTag = typeof body?.tag_name === "string" ? body.tag_name : "";
  const latest = rawTag.replace(/^v/i, "").trim();
  if (!latest) return fallback;

  const dmgAsset = Array.isArray(body?.assets)
    ? body.assets.find((a: any) => typeof a?.name === "string" && a.name.endsWith(".dmg"))
    : null;

  const upToDate = current === "dev" ? true : compareSemver(current, latest) >= 0;
  return {
    current,
    latest,
    upToDate,
    downloadUrl: typeof dmgAsset?.browser_download_url === "string"
      ? dmgAsset.browser_download_url : null,
    releaseUrl: typeof body?.html_url === "string" ? body.html_url : null,
    releaseNotes: typeof body?.body === "string" ? body.body : null,
    publishedAt: typeof body?.published_at === "string" ? body.published_at : null,
  };
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
    if (req.method === "GET" && url === "/api/version/check") {
      const info = await readVersion();
      const now = Date.now();
      if (!updateCheckCache || now - updateCheckCache.fetchedAt > UPDATE_CHECK_TTL_MS) {
        updateCheckCache = {
          fetchedAt: now,
          body: await checkForUpdate(info.base),
        };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(updateCheckCache.body));
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
