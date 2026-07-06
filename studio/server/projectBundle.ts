import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "./types";
import { userKitCompositesDir } from "./paths";

export interface ComponentManifestRow {
  name: string;
  description: string;
  origin: string;
  createdAt: string;
  thumb?: boolean;
  missing?: boolean;
}

export interface BundleManifest {
  format: 1;
  exporterVersion: string;
  name: string;
  slug: string;
  components: ComponentManifestRow[];
}

/**
 * Copy a project's manifest with everything machine-specific stripped, so it is
 * safe to ship to another user. Removes the exporter's Claude session, share
 * deployments, and Computer conversation handle, and clears pending chime-ins
 * (they reference the exporter's frame slugs). Never mutates the input.
 */
export function cleanProjectJson(p: Project): Project {
  const { sessionId, deployments, computerConversationId, ...rest } = p;
  void sessionId; void deployments; void computerConversationId;
  return { ...rest, chimeIns: [] };
}

// Discovery: capture any PascalCase name imported from arcade-user/<Name>.
// Anchored to the component-name shape so it can never bleed into a neighbour
// specifier. Global — one source file may import several components.
const ARCADE_USER_IMPORT = /from\s*["']arcade-user\/([A-Z][A-Za-z0-9]{0,39})["']/g;

async function scanFileForDeps(file: string): Promise<string[]> {
  let src: string;
  try { src = await fs.readFile(file, "utf-8"); } catch { return []; }
  const out: string[] = [];
  for (const m of src.matchAll(ARCADE_USER_IMPORT)) out.push(m[1]);
  return out;
}

async function scanTreeForDeps(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await scanTreeForDeps(full));
    else if (e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts"))) {
      out.push(...await scanFileForDeps(full));
    }
  }
  return out;
}

/**
 * Resolve the full set of user-kit components a project depends on, following
 * composite-to-composite imports transitively (a saved composite may itself
 * import another via the shared `arcade-user` alias). The `seen` set is
 * populated BEFORE enqueueing transitive deps, so an A↔B import cycle
 * terminates. Returns components that exist on disk (to bundle) separately from
 * names referenced but with no file (deleted from the kit — surfaced as a soft
 * warning, never fatal).
 */
export async function resolveComponentDeps(
  framesDir: string,
): Promise<{ names: string[]; missing: string[] }> {
  const found = new Set<string>();
  const missing = new Set<string>();
  const seen = new Set<string>();
  const queue = await scanTreeForDeps(framesDir);
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const file = path.join(userKitCompositesDir(), `${name}.tsx`);
    try {
      await fs.access(file);
      found.add(name);
      queue.push(...await scanFileForDeps(file)); // transitive
    } catch {
      missing.add(name);
    }
  }
  return { names: [...found].sort(), missing: [...missing].sort() };
}
