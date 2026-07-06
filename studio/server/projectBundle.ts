import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project } from "./types";
import { projectSchema } from "./types";
import { userKitCompositesDir, projectDir, studioRoot, projectsRoot } from "./paths";
import { getProject, reconcileFrames, importSlug, scaffoldImportedProject, clearAllProjectSessions, COMPUTER_REFERENCE_SLUG, COMPUTER_REFERENCE_SOURCE } from "./projects";
import { listComponents, componentExists, isValidComponentName, writeComponentRaw } from "./componentStore";

const execFileP = promisify(execFile);

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

export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
export const MAX_BUNDLE_ENTRIES = 5000;

/**
 * List a gzipped tar WITHOUT extracting to disk, summing uncompressed sizes.
 * This is the disk-fill-bomb guard: `tar -tzv` decompresses in memory only, so
 * a 1 KB archive that would inflate to gigabytes is rejected before a single
 * payload byte hits disk. bsdtar's verbose long-listing puts the byte size in
 * column 5 (after mode, owner/group). We parse defensively: any line whose 5th
 * whitespace field is an integer contributes; directories (size 0) count as
 * entries but add no bytes.
 */
export async function probeBundle(archive: string): Promise<{ entries: number; bytes: number }> {
  const { stdout } = await execFileP(TAR, ["-tzvf", archive], { maxBuffer: 64 * 1024 * 1024 });
  let entries = 0, bytes = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    entries += 1;
    const cols = line.trim().split(/\s+/);
    const size = Number(cols[4]);
    if (Number.isFinite(size)) bytes += size;
  }
  return { entries, bytes };
}

export async function assertNoLinks(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const st = await fs.lstat(full);
    if (st.isSymbolicLink()) throw new Error("Bundle contains a symbolic or hard link; refusing to import.");
    if (st.isFile() && st.nlink > 1) throw new Error("Bundle contains a symbolic or hard link; refusing to import.");
    if (st.isDirectory()) await assertNoLinks(full);
  }
}

export async function extractBundle(bytes: Buffer): Promise<string> {
  await fs.mkdir(studioRoot(), { recursive: true });
  const tmp = await fs.mkdtemp(path.join(studioRoot(), ".import-tmp-"));
  try {
    const archive = path.join(tmp, "bundle.arcade");
    await fs.writeFile(archive, bytes);
    // Bomb guard BEFORE extracting anything to disk.
    const { entries, bytes: uncompressed } = await probeBundle(archive);
    if (entries > MAX_BUNDLE_ENTRIES) throw new Error("Bundle has too many entries; refusing to import.");
    if (uncompressed > MAX_BUNDLE_BYTES) throw new Error("Bundle is too large; refusing to import.");
    await runTar(["xzf", archive, "-C", tmp], tmp);
    await fs.rm(archive, { force: true });
    await assertNoLinks(tmp);
    return tmp;
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

export async function uniqueComponentName(base: string, taken: Set<string>): Promise<string> {
  const trimmed = (base.slice(0, 40 - "Imported".length - 3) || "X");
  for (let n = 0; n < 1000; n++) {
    const cand = n === 0 ? `${trimmed}Imported` : `${trimmed}Imported${n + 1}`;
    if (isValidComponentName(cand) && !taken.has(cand) && !(await componentExists(cand))) return cand;
  }
  throw new Error(`Could not find a free name for imported component "${base}".`);
}

export function rewriteSpecifier(src: string, oldName: string, newName: string): string {
  // Quoted module path only — never a bare-word identifier replace.
  return src.replace(new RegExp(`(["'])arcade-user\\/${oldName}\\1`, "g"), `$1arcade-user/${newName}$1`);
}

async function rewriteFrameSpecifiers(oldName: string, newName: string, dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await rewriteFrameSpecifiers(oldName, newName, full); continue; }
    if (!(e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts")))) continue;
    const src = await fs.readFile(full, "utf-8");
    const next = rewriteSpecifier(src, oldName, newName);
    if (next !== src) await fs.writeFile(full, next);
  }
}

export async function installBundledComponents(
  compDir: string, rows: ComponentManifestRow[], framesRoot: string,
): Promise<void> {
  // Phase A: decide the final name for every component (collision resolution),
  // reading bundled sources but writing nothing yet.
  const taken = new Set<string>();
  const renames = new Map<string, string>();          // oldName -> newName
  const plan: { name: string; tsx: string; row: ComponentManifestRow }[] = [];
  for (const row of rows) {
    if (row.missing || !isValidComponentName(row.name)) continue;
    let tsx: string;
    try { tsx = await fs.readFile(path.join(compDir, `${row.name}.tsx`), "utf-8"); } catch { continue; }
    if (await componentExists(row.name)) {
      const current = await fs.readFile(path.join(userKitCompositesDir(), `${row.name}.tsx`), "utf-8").catch(() => "");
      if (current === tsx) continue;                  // identical — dedup skip
      const newName = await uniqueComponentName(row.name, taken);
      renames.set(row.name, newName);
      taken.add(newName);
      plan.push({ name: newName, tsx, row });
    } else {
      taken.add(row.name);
      plan.push({ name: row.name, tsx, row });
    }
  }

  // Phase B: apply every rename to specifiers INSIDE the bundled sources too,
  // so a renamed dep stays wired to the renamed file (transitive correctness).
  for (const [oldName, newName] of renames) {
    for (const p of plan) p.tsx = rewriteSpecifier(p.tsx, oldName, newName);
  }

  // Phase C: append re-export aliases to renamed components so the generator
  // catalog (which advertises the NEW name) can import them. Existing imported
  // frames import { <Old> } which still works; newly-generated frames import
  // { <New> } which now also works.
  for (const p of plan) {
    const oldName = [...renames.entries()].find(([_, nw]) => nw === p.name)?.[0];
    if (oldName) {
      // Additive: preserves original export + labels/comments
      p.tsx += `\nexport { ${oldName} as ${p.name} };`;
    }
  }

  // Phase D: write all files at once (deps now all resolvable), merge manifest.
  for (const p of plan) {
    await writeComponentRaw({
      name: p.name, description: p.row.description, tsx: p.tsx,
      origin: "imported", createdAt: p.row.createdAt,
    });
  }

  // Phase E: rewrite frame specifiers for every renamed component.
  for (const [oldName, newName] of renames) {
    await rewriteFrameSpecifiers(oldName, newName, framesRoot);
  }
}

export async function unpackAndInstall(bytes: Buffer): Promise<Project> {
  const tmp = await extractBundle(bytes); // throws on link/cap/tar failure
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(tmp, "manifest.json"), "utf-8")) as BundleManifest;
    if (manifest?.format !== 1) {
      throw new Error("This bundle was made by a newer version of Studio and can't be imported.");
    }
    const stagedProjectDir = path.join(tmp, "project");
    const parsed = projectSchema.parse(JSON.parse(await fs.readFile(path.join(stagedProjectDir, "project.json"), "utf-8")));

    const slug = await importSlug(parsed.name);
    const collided = slug !== parsed.slug;
    const name = collided ? `${parsed.name} (imported)` : parsed.name;

    // install components (into the recipient's global kit) BEFORE promoting;
    // rewrites staged frame specifiers in place for any renamed component.
    await installBundledComponents(path.join(tmp, "components"), manifest.components, path.join(stagedProjectDir, "frames"));

    await fs.writeFile(path.join(stagedProjectDir, "project.json"),
      JSON.stringify({ ...parsed, slug, name, updatedAt: new Date().toISOString() }, null, 2));

    // promote: same-volume move (tmp is under studioRoot, so is projectsRoot)
    await fs.mkdir(projectsRoot(), { recursive: true });
    await fs.rename(stagedProjectDir, path.join(projectsRoot(), slug));

    await scaffoldImportedProject(slug);
    await reconcileFrames(slug);
    await clearAllProjectSessions().catch(() => {}); // new kit components → refresh cached prompts

    const final = await getProject(slug);
    if (!final) throw new Error("Import failed: project vanished after install.");
    return final;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
