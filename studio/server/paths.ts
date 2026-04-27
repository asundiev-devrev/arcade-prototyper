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
