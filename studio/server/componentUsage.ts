import fs from "node:fs/promises";
import path from "node:path";
import { projectsRoot, projectDir } from "./paths";

export interface ComponentUsage {
  slug: string;       // project slug
  frameSlug: string;  // frame directory name
  framePath: string;  // absolute path of the frame dir's index.tsx (anchor for the rewrite)
}

/** Does any `.tsx` file under `dir` (recursively) import `arcade-user/<name>`?
 *  Frames are often multi-file (index.tsx + pages/*.tsx + helpers); the import
 *  can live in any of them, so we must walk the whole tree — checking only
 *  index.tsx misses sub-file imports and leaves a dangling import that blanks
 *  the frame after the component file is removed. */
async function frameTreeImports(dir: string, re: RegExp): Promise<boolean> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (await frameTreeImports(full, re)) return true;
    } else if (e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts"))) {
      try {
        if (re.test(await fs.readFile(full, "utf-8"))) return true;
      } catch {
        // unreadable file — skip
      }
    }
  }
  return false;
}

/**
 * Find every frame across all projects that imports a saved component via its
 * `arcade-user/<Name>` specifier. Used when deleting a component to decide
 * whether frames must be rewritten first (so none are left with a dangling
 * import that blanks the frame).
 *
 * Scans the ENTIRE frame directory tree (index.tsx + nested sub-files like
 * pages/*.tsx), not just index.tsx — the import can live in any file. Returns
 * ONE entry per frame (the rewrite is frame-scoped); framePath points at the
 * frame's index.tsx as a stable anchor. Reads source from disk (the source of
 * truth), so a freshly-written frame is included.
 */
export async function findComponentUsages(name: string): Promise<ComponentUsage[]> {
  // Specifier is exact: arcade-user/<Name> in a quoted import. Name is a
  // validated PascalCase identifier, safe to embed in the regex.
  const re = new RegExp(`from\\s*["']arcade-user/${name}["']`);
  const out: ComponentUsage[] = [];

  let slugs: string[];
  try {
    slugs = await fs.readdir(projectsRoot());
  } catch {
    return out;
  }

  for (const slug of slugs) {
    if (slug.startsWith(".")) continue;
    // projectDir() throws on a non-slug name (e.g. the `_figma-ingest` sibling
    // dir or `uploads-staging`). Skip anything that isn't a valid project slug
    // rather than letting it crash the scan.
    let framesDir: string;
    try {
      framesDir = path.join(projectDir(slug), "frames");
    } catch {
      continue;
    }
    let frameNames: string[];
    try {
      frameNames = await fs.readdir(framesDir);
    } catch {
      continue; // not a project / no frames dir
    }
    for (const frameSlug of frameNames) {
      if (frameSlug.startsWith(".")) continue;
      const frameDir = path.join(framesDir, frameSlug);
      // One entry per frame, regardless of how many sub-files import it.
      if (await frameTreeImports(frameDir, re)) {
        out.push({ slug, frameSlug, framePath: path.join(frameDir, "index.tsx") });
      }
    }
  }
  return out;
}
