import fs from "node:fs/promises";
import { multiplayerRoot, projectsJsonPath, sessionsJsonPath } from "../paths";
import {
  projectStateSchema,
  projectsFileSchema,
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

// ── Plan 2b shared-project persistence ───────────────────────────────
// `projects.json` is the source of truth for which projects exist and
// who they're shared with. When the file is missing but a v1
// `sessions.json` exists, we migrate the legacy session list into a
// deduped project list (one entry per unique hostDevu+projectSlug)
// and write the result before returning it.

/**
 * Load all persisted projects.
 *
 * Behavior matrix:
 * - File missing (ENOENT)             → migrate from v1 sessions.json if
 *                                       present, otherwise return [].
 * - File present, valid v2            → return parsed projects.
 * - File present, unparseable JSON    → log + return []. Do NOT migrate
 *                                       (we'd overwrite something the
 *                                       user might still recover).
 * - File present, schema mismatch     → log + return []. Do NOT migrate
 *                                       (e.g. a future v3 written by a
 *                                       newer Studio after a downgrade —
 *                                       overwriting it with v2 is data
 *                                       loss).
 * - Other read errors (EACCES, etc.)  → throw.
 */
export async function loadProjects(): Promise<ProjectState[]> {
  const file = projectsJsonPath();
  let raw: string | null = null;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // Anything other than missing-file should surface — disk errors,
      // permission issues, etc. shouldn't be papered over.
      throw err;
    }
  }
  if (raw !== null) {
    // File exists. Parse and validate. If the schema doesn't match (e.g.
    // a future version we don't understand), log and return [] WITHOUT
    // attempting to migrate from sessions.json — overwriting an unknown
    // future version with v2 would be data loss.
    try {
      const parsed = projectsFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data.projects;
      console.warn(
        `[persistence] projects.json exists but failed schema validation; ` +
          `treating as empty without overwriting. Issues: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
      );
    } catch (err) {
      console.warn(`[persistence] projects.json is not valid JSON: ${err}`);
    }
    return [];
  }
  // No file — migrate from v1 if it exists, otherwise return [].
  const migrated = await migrateFromSessions();
  if (migrated.length > 0) {
    await saveProjects(migrated);
  }
  return migrated;
}

/**
 * Persist all projects. Writes to a sibling `.tmp` file then renames into
 * place so a crashed write cannot leave a partial file on disk.
 */
export async function saveProjects(projects: ProjectState[]): Promise<void> {
  const file = projectsJsonPath();
  const tmpFile = `${file}.tmp`;
  await fs.mkdir(multiplayerRoot(), { recursive: true });
  const validated = projects.map((p) => projectStateSchema.parse(p));
  const body = JSON.stringify({ version: 2, projects: validated }, null, 2);
  await fs.writeFile(tmpFile, body, "utf-8");
  await fs.rename(tmpFile, file);
}

/**
 * One-time migration from v1 sessions.json → v2 projects.json. Each
 * unique (hostDevu, projectSlug) pair becomes a single project; extra
 * sessions targeting the same project are collapsed. `shared_with` starts
 * empty — v1 sessions did not track recipient identity in a recoverable
 * way, so legacy invites are dropped.
 */
async function migrateFromSessions(): Promise<ProjectState[]> {
  const file = sessionsJsonPath();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = sessionsFileSchema.safeParse(parsedJson);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: ProjectState[] = [];
  for (const s of parsed.data.sessions) {
    const k = `${s.hostDevu}::${s.projectSlug}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: s.id,
      hostDevu: s.hostDevu,
      projectSlug: s.projectSlug,
      createdAt: s.createdAt,
      shared_with: [],
    });
  }
  return out;
}
