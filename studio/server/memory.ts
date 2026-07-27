import fs from "node:fs/promises";
import path from "node:path";

function rulesStub(scope: string): string {
  return `<!-- RULES.md — your standing instructions for ${scope}. Hand-written.
     The generator reads this every turn but never edits it. -->
`;
}

function learnedStub(scope: string): string {
  return `<!-- LEARNED.md — facts Studio has learned about ${scope}.
     Generated from learned.json; edit via the Memory panel, not here. -->
`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotently seed RULES.md + LEARNED.md stubs in `dir`. Creates `dir` if
 * needed. NEVER overwrites a file that already exists — edited content (by
 * the user in RULES.md, or appended by the agent in LEARNED.md) is preserved.
 * `scope` is a human label woven into the stub header ("global", "this
 * project", …).
 */
export async function ensureMemoryStubs(dir: string, scope: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const rules = path.join(dir, "RULES.md");
  const learned = path.join(dir, "LEARNED.md");
  if (!(await fileExists(rules))) await fs.writeFile(rules, rulesStub(scope));
  if (!(await fileExists(learned))) await fs.writeFile(learned, learnedStub(scope));
}

/**
 * Create (or repair) the `global-memory` symlink inside a project dir so
 * CLAUDE.md can @-import global memory RELATIVELY. See
 * projectGlobalMemoryLink for why absolute imports are unusable.
 * Idempotent and never throws: a stale or wrong-target link is replaced, and
 * on a filesystem that refuses symlinks the project still works with project
 * memory only.
 */
export async function ensureGlobalMemoryLink(linkPath: string, targetDir: string): Promise<void> {
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.mkdir(path.dirname(linkPath), { recursive: true });

    let needsCreate = false;
    try {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        const existingTarget = await fs.readlink(linkPath);
        if (existingTarget === targetDir) {
          return; // Already correct
        }
        // Wrong target, replace it
        await fs.rm(linkPath, { recursive: false, force: true });
        needsCreate = true;
      } else if (stat.isDirectory()) {
        // Real directory — do NOT delete, log and bail
        console.warn(`[ensureGlobalMemoryLink] ${linkPath} is a real directory; cannot replace with symlink (data safety)`);
        return;
      } else {
        // File or other — safe to remove
        await fs.rm(linkPath, { recursive: false, force: true });
        needsCreate = true;
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        needsCreate = true;
      } else {
        throw err;
      }
    }

    if (needsCreate) {
      await fs.symlink(targetDir, linkPath, "dir");
    }
  } catch (err) {
    console.warn(`[ensureGlobalMemoryLink] Failed to create symlink ${linkPath} → ${targetDir}:`, err);
  }
}
