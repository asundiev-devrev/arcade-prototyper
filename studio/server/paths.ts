import path from "node:path";
import os from "node:os";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i;

function requireSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new Error(`Invalid slug: ${slug}`);
  return slug;
}

export function studioRoot(): string {
  const override = process.env.ARCADE_STUDIO_ROOT;
  if (override) return override;
  return path.join(os.homedir(), "Library", "Application Support", "arcade-studio");
}

export function projectsRoot(): string {
  return path.join(studioRoot(), "projects");
}

export function projectDir(slug: string): string {
  return path.join(projectsRoot(), requireSlug(slug));
}

export function frameDir(projectSlug: string, frameSlug: string): string {
  return path.join(projectDir(projectSlug), "frames", requireSlug(frameSlug));
}

export function sharedDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "shared");
}

export function chatHistoryPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "chat-history.json");
}

export function projectJsonPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "project.json");
}

export function frameThumbnailPath(projectSlug: string, frameSlug: string): string {
  return path.join(projectDir(projectSlug), "thumbnails", `${requireSlug(frameSlug)}.png`);
}

export function lastErrorLogPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "last-error.log");
}

export function lastStdoutLogPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "last-stdout.log");
}

/**
 * Scratch directory for Figma-ingest artifacts (PNG exports, etc.). Sibling
 * of `projects/`, not nested inside it — otherwise the project watcher
 * mistakes it for a project slug and spams `Invalid slug` errors every poll.
 */
export function figmaIngestRoot(): string {
  return path.join(studioRoot(), ".figma-ingest");
}

/**
 * Root folder for pre-project uploads (images pasted into the hero input
 * before a project exists). Sibling of `projects/`; `adopt-uploads` moves
 * files from here into the project once it is created.
 */
export function stagingRoot(): string {
  return path.join(studioRoot(), "uploads-staging");
}

const SESSION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function requireSessionId(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error(`Invalid staging session id: ${id}`);
  return id;
}

export function stagingSessionDir(sessionId: string): string {
  return path.join(stagingRoot(), requireSessionId(sessionId));
}

export function designMdPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "DESIGN.md");
}

/**
 * Per-turn generation metrics log (JSONL, one row per turn). Lives at the
 * studio root — a sibling of projects/, not inside it — so the project watcher
 * ignores it and it survives project deletes. Written by the chat middleware,
 * read by the metrics aggregator behind GET /api/metrics.
 */
export function metricsLogPath(): string {
  return path.join(studioRoot(), "generation-metrics.jsonl");
}

/**
 * Global memory directory — applies to every project. Holds RULES.md
 * (human-authored standing instructions) + LEARNED.md (agent append-only
 * cross-project facts). Sibling of projects/; granted to the generator
 * subprocess via --add-dir so the agent can read AND append.
 */
export function globalMemoryDir(): string {
  return path.join(studioRoot(), "memory");
}

/**
 * Per-project memory directory. Same RULES.md + LEARNED.md shape as global,
 * scoped to one project. Lives inside the project cwd so it's already
 * readable/writable via the existing --add-dir opts.cwd.
 */
export function projectMemoryDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "memory");
}

/**
 * Per-project shared-state file written by the host's Share panel. Contains
 * the projectShareId and the current `shared_with` list. Recipients never
 * see this file — it lives in the host's project dir alongside `project.json`
 * and is rewritten on every share/unshare.
 */
export function multiplayerJsonPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "multiplayer.json");
}

/**
 * Root folder for Studio multiplayer session state. Sibling of `projects/`.
 * Holds `sessions.json` (persisted session metadata) plus any future
 * per-session artifacts.
 */
export function multiplayerRoot(): string {
  return path.join(studioRoot(), "multiplayer");
}

/**
 * Single JSON file holding all known multiplayer session metadata. Read at
 * startup, rewritten atomically on every change. SQLite is overkill for the
 * expected session count in v1.
 */
export function sessionsJsonPath(): string {
  return path.join(multiplayerRoot(), "sessions.json");
}

/**
 * Plan 2b shared-project state: one entry per (hostDevu, projectSlug) pair,
 * with the list of `shared_with` recipients. Replaces the v1 per-session
 * model. Read at startup; rewritten on every share/unshare.
 */
export function projectsJsonPath(): string {
  return path.join(multiplayerRoot(), "projects.json");
}

/**
 * Root folder for the GUEST-side on-disk mirror of shared projects.
 * Sibling of `projects/` and `multiplayer/`. Each entry is an opaque
 * shared-project id (not a slug) — recipients receive these from invite
 * payloads and must not be subject to the `requireSlug` constraints.
 */
export function sharedProjectsRoot(): string {
  return path.join(studioRoot(), "shared-projects");
}

/**
 * Per-shared-project mirror directory on the GUEST side. Holds
 * `metadata.json`, `chat-history.json`, and a `frames/` subdir with
 * last-seen frame content keyed by frame path.
 */
export function sharedProjectDir(id: string): string {
  return path.join(sharedProjectsRoot(), id);
}
