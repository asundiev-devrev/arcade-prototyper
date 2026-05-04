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
