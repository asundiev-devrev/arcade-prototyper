import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectDir, projectsRoot, projectJsonPath, chatHistoryPath } from "./paths";
import { projectSchema, type Project, type Frame, type ChatMessage } from "./types";
import { scaffoldDevRevHelper } from "./devrev/scaffoldHelper";

const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTOTYPER_ROOT = path.resolve(STUDIO_DIR, "..");
// arcade-gen clone. Override with env when you check it out elsewhere.
// Falls back to ~/arcade-gen when HOME is set, otherwise an unresolvable
// sentinel so a misconfigured environment fails loudly.
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? (process.env.HOME ? path.resolve(process.env.HOME, "arcade-gen") : "/__arcade_gen_unconfigured");

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/**
 * Compute the directory where Claude CLI stores session data for a given cwd.
 *
 * Claude CLI hashes its spawn cwd into a directory name by replacing every
 * non-alphanumeric character with `-` and storing conversations at
 * ~/.claude/projects/<hashed-cwd>/<session-id>.jsonl. When we rename a
 * project directory on disk (`fs.rename(projectDir(old), projectDir(new))`),
 * the cwd hash changes, and Claude's `--resume <session-id>` lookup no
 * longer finds the session. The next chat turn errors with:
 *     "No conversation found with session ID: ..."
 *
 * Keep this mapping in sync with Claude CLI's internal encoding. Current
 * observed encoding: replace `/` and space with `-`, preserve alphanumerics,
 * drop no characters. Matches what appears in ~/.claude/projects/ today.
 */
function claudeSessionDirFor(cwd: string): string {
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await exists(projectDir(slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export interface CreateProjectInput {
  name: string;
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const slug = await uniqueSlug(slugify(input.name));
  const now = new Date().toISOString();
  const project: Project = {
    name: input.name,
    slug,
    createdAt: now,
    updatedAt: now,
    theme: input.theme,
    mode: input.mode,
    frames: [],
  };

  const tpl = await fs.readFile(
    path.resolve(STUDIO_DIR, "templates", "CLAUDE.md.tpl"), "utf-8",
  );

  const dir = projectDir(slug);
  try {
    await fs.mkdir(path.join(dir, "frames"), { recursive: true });
    await fs.mkdir(path.join(dir, "shared"), { recursive: true });
    await fs.mkdir(path.join(dir, "thumbnails"), { recursive: true });
    await fs.writeFile(projectJsonPath(slug), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(dir, "theme-overrides.css"), "/* Local theme overrides */\n");
    await fs.writeFile(path.join(dir, "CLAUDE.md"), renderTemplate(tpl, {
      PROJECT_NAME: input.name,
      THEME: input.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
    }));
    await fs.writeFile(chatHistoryPath(slug), "[]");
    await scaffoldDevRevHelper(slug);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return project;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export async function getProject(slug: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(projectJsonPath(slug), "utf-8");
    return projectSchema.parse(JSON.parse(raw));
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function readHistory(slug: string): Promise<ChatMessage[]> {
  let raw: string;
  try { raw = await fs.readFile(chatHistoryPath(slug), "utf-8"); }
  catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  try { return JSON.parse(raw); }
  catch (err) {
    console.warn(`[projects] chat-history.json for "${slug}" is not valid JSON:`, err);
    return [];
  }
}

export async function listProjects(): Promise<Project[]> {
  try {
    const slugs = await fs.readdir(projectsRoot());
    const ps: Project[] = [];
    for (const slug of slugs) {
      try {
        const p = await getProject(slug);
        if (p) ps.push(p);
      } catch (err) {
        console.warn(`[projects] skipping malformed project "${slug}":`, err);
      }
    }
    return ps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function renameProject(slug: string, name: string): Promise<Project> {
  const p = await getProject(slug);
  if (!p) throw new Error(`Project not found: ${slug}`);

  // Reslug from the new name so the URL tracks what the user sees. If the
  // reslugged value matches the current slug (e.g. casing change, punctuation
  // tweak), just update name in place — no directory move needed. Otherwise
  // `uniqueSlug` resolves collisions by appending `-2`, `-3`, …
  const desired = slugify(name);
  const newSlug =
    desired === slug ? slug : await uniqueSlug(desired);
  const now = new Date().toISOString();

  if (newSlug !== slug) {
    // Move the on-disk dir first, then rewrite the project.json with the new
    // slug. If the rename crashes between these two steps, the next call to
    // `getProject(slug)` will 404 (the dir moved), the one to `getProject(newSlug)`
    // will load the pre-rename JSON — still a valid project, just with the old
    // name. That's the least-surprising partial-failure state.
    await fs.rename(projectDir(slug), projectDir(newSlug));

    // Also move Claude's session index alongside. Claude CLI stores sessions
    // at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl; renaming the
    // project's cwd without renaming the session dir orphans every active
    // session — the next `--resume <id>` turn fails with "No conversation
    // found with session ID: ...". Best effort: if the source doesn't exist
    // (no turns yet) or the target already exists (pre-existing project at
    // the new slug), silently skip — rename continues. This keeps the fix
    // local to the rename happy path without adding new failure modes.
    const oldClaudeDir = claudeSessionDirFor(projectDir(slug));
    const newClaudeDir = claudeSessionDirFor(projectDir(newSlug));
    try {
      await fs.rename(oldClaudeDir, newClaudeDir);
    } catch (err: any) {
      // ENOENT: no sessions yet (new project). EEXIST/ENOTEMPTY: a session
      // dir already exists at the target; leave the source orphaned rather
      // than clobber a real one. Either way the project rename is done.
      if (err?.code !== "ENOENT" && err?.code !== "EEXIST" && err?.code !== "ENOTEMPTY") {
        console.warn(
          `[studio] failed to move Claude session dir from ${oldClaudeDir} to ${newClaudeDir}:`,
          err?.message ?? err,
        );
      }
    }
  }

  const next: Project = { ...p, name, slug: newSlug, updatedAt: now };
  await fs.writeFile(projectJsonPath(newSlug), JSON.stringify(next, null, 2));
  return next;
}

export async function updateProject(slug: string, patch: Partial<Project>): Promise<Project> {
  const p = await getProject(slug);
  if (!p) throw new Error(`Project not found: ${slug}`);
  const next: Project = projectSchema.parse({
    ...p,
    ...patch,
    slug: p.slug,
    updatedAt: new Date().toISOString(),
  });
  await fs.writeFile(projectJsonPath(slug), JSON.stringify(next, null, 2));
  return next;
}

export async function deleteProject(slug: string): Promise<void> {
  await fs.rm(projectDir(slug), { recursive: true, force: true });
}

async function readTemplate(): Promise<string> {
  return fs.readFile(path.resolve(STUDIO_DIR, "templates", "CLAUDE.md.tpl"), "utf-8");
}

/**
 * Rewrites CLAUDE.md from the current template for every project whose on-disk
 * copy is stale. When a project's CLAUDE.md changes we also clear its cached
 * sessionId so the next claude turn re-reads the new system prompt instead of
 * resuming the old one.
 */
export async function refreshStaleClaudeMd(): Promise<number> {
  const tpl = await readTemplate();
  const ps = await listProjects();
  let refreshed = 0;
  for (const p of ps) {
    const rendered = renderTemplate(tpl, {
      PROJECT_NAME: p.name,
      THEME: p.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
    });
    const file = path.join(projectDir(p.slug), "CLAUDE.md");
    let current = "";
    try { current = await fs.readFile(file, "utf-8"); } catch {}
    if (current === rendered) continue;
    await fs.writeFile(file, rendered);
    if (p.sessionId) await updateProject(p.slug, { sessionId: undefined });
    refreshed += 1;
  }
  return refreshed;
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".html",
  ".txt",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
]);

const MAX_TEXT_SIZE = 1024 * 1024; // 1 MB

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 10;

export async function fileTree(slug: string): Promise<string[]> {
  const root = projectDir(slug);
  const out: string[] = [];
  async function walk(dir: string, rel: string, depth: number) {
    if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) return;
      if (e.name.startsWith(".") || e.name === "thumbnails" || e.name === "_uploads") continue;
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const next = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        out.push(next + "/");
        await walk(full, next, depth + 1);
      } else {
        out.push(next);
      }
    }
  }
  await walk(root, "", 0);
  return out;
}

export async function readProjectFile(slug: string, rel: string): Promise<string> {
  const base = projectDir(slug);
  const full = path.resolve(base, rel);
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
  if (!full.startsWith(normalizedBase) && full !== base) {
    throw new Error("Path escape");
  }
  const ext = path.extname(full).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return `[non-text file: ${ext || "no-ext"}]`;
  }
  const stat = await fs.stat(full);
  if (stat.size > MAX_TEXT_SIZE) {
    return `[binary/large file omitted: ${stat.size} bytes]`;
  }
  return fs.readFile(full, "utf-8");
}

const reconcileInFlight = new Map<string, Promise<Frame[]>>();

export async function reconcileFrames(slug: string): Promise<Frame[]> {
  const pending = reconcileInFlight.get(slug);
  if (pending) return pending;
  const job = reconcileFramesInner(slug).finally(() => reconcileInFlight.delete(slug));
  reconcileInFlight.set(slug, job);
  return job;
}

async function reconcileFramesInner(slug: string): Promise<Frame[]> {
  const project = await getProject(slug);
  if (!project) return [];
  const framesDir = path.join(projectDir(slug), "frames");
  let entries: string[] = [];
  try { entries = await fs.readdir(framesDir); } catch { entries = []; }
  entries.sort();

  const discovered: Frame[] = [];
  const newFrames: string[] = [];
  for (const name of entries) {
    const idx = path.join(framesDir, name, "index.tsx");
    try { await fs.access(idx); } catch { continue; }
    const prior = project.frames.find((f) => f.slug === name);
    if (!prior) {
      newFrames.push(name);
    }
    discovered.push(prior ?? {
      slug: name,
      name: titleCase(name),
      size: "1440",
      createdAt: new Date().toISOString(),
    });
  }

  const prevSorted = [...project.frames].sort((a, b) => a.slug.localeCompare(b.slug));
  if (JSON.stringify(discovered) === JSON.stringify(prevSorted)) return project.frames;
  const next = await updateProject(slug, { frames: discovered });

  // Fire-and-forget thumbnail capture for new frames
  if (newFrames.length > 0) {
    enqueueThumbnailCapture(slug, newFrames).catch((err) => {
      console.warn(`[projects] thumbnail capture failed for ${slug}:`, err);
    });
  }

  return next.frames;
}

async function enqueueThumbnailCapture(slug: string, framesSlugs: string[]): Promise<void> {
  try {
    const { captureFrameThumbnail } = await import("./thumbnails/capture");
    const project = await getProject(slug);
    if (!project) return;

    for (const frameSlug of framesSlugs) {
      const thumbnailPath = await captureFrameThumbnail(slug, frameSlug);
      if (thumbnailPath) {
        const frames = project.frames.map((f) =>
          f.slug === frameSlug ? { ...f, thumbnail: thumbnailPath } : f
        );
        await updateProject(slug, {
          frames,
          coverThumbnail: project.coverThumbnail || thumbnailPath,
        });
      }
    }
  } catch (err) {
    console.warn(`[projects] enqueueThumbnailCapture failed:`, err);
  }
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
