import fs from "node:fs/promises";
import path from "node:path";
import { projectsRoot } from "../paths";
import { listProjects } from "./projectRegistry";
import { getReplayBufferForProject } from "./wsServer";

/**
 * Boot-time seed: for every shared project the host owns, read every
 * `<projectsRoot>/<slug>/frames/<frameId>/index.tsx` from disk and load
 * it into the project's replay buffer.
 *
 * Without this, frames the host generated in previous sessions are
 * invisible to guests until the host re-saves each one — chokidar's
 * `ignoreInitial: true` (in projectWatchPlugin) skips startup `add`
 * events, and the buffer is in-memory so it doesn't survive restarts.
 *
 * Idempotent. Best-effort: per-project failures are logged and skipped.
 */
export async function seedReplayBuffersFromDisk(hostDevu: string): Promise<void> {
  const sharedProjects = listProjects({ hostDevu });
  for (const project of sharedProjects) {
    try {
      await seedOneProject(project.id, project.projectSlug);
    } catch (err) {
      console.warn(
        `[seedReplayBuffers] failed for ${project.projectSlug}:`,
        err,
      );
    }
  }
}

/**
 * Seed the replay buffer for a single project from disk. Use this on the
 * share path so a project freshly added to the registry mid-session picks
 * up frames the host already generated, without waiting for the next
 * Studio restart.
 *
 * Idempotent: re-seeding overwrites with the same content.
 */
export async function seedOneProject(projectShareId: string, projectSlug: string): Promise<void> {
  const buf = getReplayBufferForProject(projectShareId);
  if (!buf) return;
  const framesDir = path.join(projectsRoot(), projectSlug, "frames");
  let entries: string[];
  try {
    entries = await fs.readdir(framesDir);
  } catch {
    return; // No frames dir yet — nothing to seed.
  }
  for (const frameId of entries) {
    const indexPath = path.join(framesDir, frameId, "index.tsx");
    try {
      const content = await fs.readFile(indexPath, "utf-8");
      buf.recordFrame(frameId, content);
    } catch {
      // Missing index.tsx is normal — frame may be staging or partial.
    }
  }
}
