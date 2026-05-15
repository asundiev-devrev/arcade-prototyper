import fs from "node:fs/promises";
import { multiplayerRoot, sessionsJsonPath } from "../paths";
import {
  sessionsFileSchema,
  type ProjectState,
  type SessionState,
} from "./types";

/**
 * Load all persisted sessions. Returns [] for any failure mode (missing file,
 * unparseable JSON, unknown schema version). The relay treats persistence as
 * best-effort hydration — a corrupted file does not crash the session.
 */
export async function loadSessions(): Promise<SessionState[]> {
  try {
    const raw = await fs.readFile(sessionsJsonPath(), "utf-8");
    const parsed = JSON.parse(raw);
    const result = sessionsFileSchema.safeParse(parsed);
    if (!result.success) return [];
    return result.data.sessions;
  } catch {
    return [];
  }
}

/**
 * Persist all sessions. Writes to a sibling `.tmp` file then renames into
 * place so a crashed write cannot leave a partial file on disk.
 */
export async function saveSessions(sessions: SessionState[]): Promise<void> {
  const file = sessionsJsonPath();
  const tmpFile = `${file}.tmp`;
  await fs.mkdir(multiplayerRoot(), { recursive: true });
  const body = JSON.stringify({ version: 1, sessions }, null, 2);
  await fs.writeFile(tmpFile, body, "utf-8");
  await fs.rename(tmpFile, file);
}

// ── Plan 2b shared-project persistence (stubs) ───────────────────────
// Task 4 replaces these with real persistence + migration logic that
// reads/writes `relay/projects.json`. Until then projectRegistry imports
// these names so its module graph compiles.

export async function loadProjects(): Promise<ProjectState[]> {
  return [];
}

export async function saveProjects(_projects: ProjectState[]): Promise<void> {
  // no-op until Task 4
}
