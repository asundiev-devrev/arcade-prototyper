import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Project } from "./types";
import { userKitCompositesDir, projectDir, studioRoot } from "./paths";
import { getProject, COMPUTER_REFERENCE_SLUG, COMPUTER_REFERENCE_SOURCE } from "./projects";
import { listComponents } from "./componentStore";

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
const ARCADE_USER_IMPORT = /from\s*["']arcade-user\/([A-Z][A-Za-z0-9]{1,39})["']/g;

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

const TAR = "/usr/bin/tar";

const EXCLUDE_TOP = new Set([
  "chat-history.json", "memory", "CLAUDE.md", "CLAUDE.md.bak",
  "thumbnails", "_uploads", "last-error.log", "last-stdout.log",
]);

function studioVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = path.resolve(here, "..", "..", "package.json");
  try { return JSON.parse(readFileSync(pkg, "utf-8")).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
}

export function runTar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(TAR, args, { cwd });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err}`)));
  });
}

async function copyProjectSubtree(srcProjectDir: string, destProjectDir: string): Promise<void> {
  await fs.mkdir(destProjectDir, { recursive: true });
  const entries = await fs.readdir(srcProjectDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || EXCLUDE_TOP.has(e.name)) continue;
    if (e.isSymbolicLink()) continue;               // never copy links out
    const src = path.join(srcProjectDir, e.name);
    const dest = path.join(destProjectDir, e.name);
    if (e.isDirectory()) {
      // Recursive copy that drops nested symlinks so export never produces a
      // bundle its own importer would reject (importer refuses any link).
      await fs.cp(src, dest, { recursive: true, filter: (s) => !isLink(s) });
    } else if (e.isFile()) {
      await fs.copyFile(src, dest);
    }
  }
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

async function isUnmodifiedSeedFrame(framesDir: string): Promise<boolean> {
  try {
    const src = await fs.readFile(
      path.join(framesDir, COMPUTER_REFERENCE_SLUG, "index.tsx"), "utf-8");
    return src === COMPUTER_REFERENCE_SOURCE;
  } catch { return false; }
}

export async function packProject(
  slug: string,
): Promise<{ filePath: string; warnings: string[] }> {
  const project = await getProject(slug);
  if (!project) throw new Error(`Project not found: ${slug}`);
  const warnings: string[] = [];

  await fs.mkdir(studioRoot(), { recursive: true }); // mkdtemp needs the parent
  const tmpRoot = await fs.mkdtemp(path.join(studioRoot(), ".bundle-tmp-"));
  try {
    const projOut = path.join(tmpRoot, "project");
    const compOut = path.join(tmpRoot, "components");
    await fs.mkdir(compOut, { recursive: true });

    await copyProjectSubtree(projectDir(slug), projOut);
    await fs.writeFile(
      path.join(projOut, "project.json"),
      JSON.stringify(cleanProjectJson(project), null, 2));

    const framesOut = path.join(projOut, "frames");
    if (await isUnmodifiedSeedFrame(framesOut)) {
      await fs.rm(path.join(framesOut, COMPUTER_REFERENCE_SLUG), { recursive: true, force: true });
    }

    const { names, missing } = await resolveComponentDeps(framesOut);
    for (const m of missing) warnings.push(`Component ${m} is referenced but no longer in your kit; it will be missing on import.`);
    const allMeta = await listComponents();
    const rows: ComponentManifestRow[] = [];
    for (const name of names) {
      await fs.copyFile(
        path.join(userKitCompositesDir(), `${name}.tsx`),
        path.join(compOut, `${name}.tsx`));
      const meta = allMeta.find((c) => c.name === name);
      if (meta?.thumb) {
        await fs.copyFile(
          path.join(userKitCompositesDir(), `${name}.png`),
          path.join(compOut, `${name}.png`)).catch(() => {});
      }
      rows.push({
        name, description: meta?.description ?? "", origin: meta?.origin ?? "imported",
        createdAt: meta?.createdAt ?? new Date().toISOString(), thumb: meta?.thumb ?? false,
      });
    }
    for (const m of missing) rows.push({ name: m, description: "", origin: "imported", createdAt: new Date().toISOString(), missing: true });

    const manifest: BundleManifest = {
      format: 1, exporterVersion: studioVersion(),
      name: project.name, slug: project.slug, components: rows,
    };
    await fs.writeFile(path.join(tmpRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

    const filePath = path.join(tmpRoot, `${slug}.arcade`);
    await runTar(["czf", filePath, "manifest.json", "project", "components"], tmpRoot);
    return { filePath, warnings };
  } catch (err) {
    await fs.rm(tmpRoot, { recursive: true, force: true }); // no leak on failure
    throw err;
  }
}
