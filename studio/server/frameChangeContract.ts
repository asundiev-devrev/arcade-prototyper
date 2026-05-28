/**
 * Detects whether the agent actually modified any project files during a turn.
 *
 * Why this exists: the agent occasionally narrates changes that did not
 * happen — either because its Edit tool failed silently (no unique match for
 * `old_string`) or because it skipped the tool call entirely and just
 * paraphrased what it "did". The deviations contract catches missing summary
 * structure but cannot tell the difference between a real change and prose.
 * This module gives the chat pipeline a way to compare before/after snapshots
 * of `frames/` + `shared/` and surface a visible warning when the agent
 * claims work but no file actually moved.
 *
 * Pure functions only. Snapshotting is exposed separately so tests can
 * drive the diff with synthetic maps.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type FrameFileStat = { mtimeMs: number; size: number };
export type FrameSnapshot = Map<string, FrameFileStat>;

export type FrameSnapshotDiff = {
  added: string[];
  changed: string[];
  removed: string[];
};

const SNAPSHOT_SUBDIRS = ["frames", "shared"] as const;
const SNAPSHOT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".md"];

/**
 * Trailer appended to a turn's narration when the agent claims a change but
 * no frame file actually moved. Plain-text, designer-facing wording — no
 * mentions of mtime, snapshots, tool calls, or other engineering machinery.
 *
 * Leading `\n\n` is a section separator so the trailer joins cleanly to
 * whatever the agent wrote above. We do NOT include a `### Deviations`
 * heading here because this trailer fires only when narration already has
 * one — i.e. the contract was satisfied on shape but failed on substance.
 */
export const NO_CHANGES_TRAILER =
  "\n\n⚠ Studio detected no frame changes this turn — the agent's reply describes edits that didn't actually happen. Try rephrasing, pointing at the element again, or asking what went wrong.";

/**
 * Walk `frames/` and `shared/` under `projectDir`, recording mtime + size
 * for every source file we care about. Missing directories are treated as
 * empty (returns an empty entry, not an error) — a brand-new project has
 * no `frames/` subdir yet.
 */
export async function snapshotProjectFiles(projectDir: string): Promise<FrameSnapshot> {
  const out: FrameSnapshot = new Map();
  for (const sub of SNAPSHOT_SUBDIRS) {
    await walk(projectDir, path.join(projectDir, sub), out);
  }
  return out;
}

async function walk(rootDir: string, currentDir: string, out: FrameSnapshot): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SNAPSHOT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    try {
      const stat = await fs.stat(full);
      const rel = path.relative(rootDir, full);
      out.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // file vanished between readdir and stat; skip.
    }
  }
}

/**
 * Compare two snapshots and report which files were added, changed, or
 * removed. mtime OR size mismatch counts as a change — mtime alone is not
 * enough on filesystems with second-resolution timestamps where two writes
 * inside the same second look identical.
 */
export function diffSnapshots(before: FrameSnapshot, after: FrameSnapshot): FrameSnapshotDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [key, val] of after) {
    const prev = before.get(key);
    if (!prev) {
      added.push(key);
    } else if (prev.mtimeMs !== val.mtimeMs || prev.size !== val.size) {
      changed.push(key);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { added, changed, removed };
}

export function hasAnyChange(diff: FrameSnapshotDiff): boolean {
  return diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;
}
