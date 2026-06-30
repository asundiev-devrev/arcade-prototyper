import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectDir, projectsRoot, projectJsonPath, chatHistoryPath, projectMemoryDir, globalMemoryDir, sharedDir } from "./paths";
import { projectSchema, type Project, type Frame, type ChatMessage } from "./types";
import { scaffoldDevRevHelper } from "./devrev/scaffoldHelper";
import { ensureMemoryStubs } from "./memory";
import { getTemplate, readTemplateSeed, templateSeedPath, isSeedDirectory, type TemplateId } from "./templates";

const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTOTYPER_ROOT = path.resolve(STUDIO_DIR, "..");
// arcade-gen clone. Override with env when you check it out elsewhere.
// Falls back to ~/arcade-gen when HOME is set, otherwise an unresolvable
// sentinel so a misconfigured environment fails loudly.
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? (process.env.HOME ? path.resolve(process.env.HOME, "arcade-gen") : "/__arcade_gen_unconfigured");

/**
 * Append a single message to a project's persisted chat history. Used by
 * the chat middleware (turn user/assistant messages) and by the auto-fix
 * dispatcher in `buildErrorReporter` (system messages narrating the
 * auto-repair flow). Centralised here so call sites don't reimplement the
 * read-modify-write dance — and so the chat middleware no longer needs to
 * export a private helper.
 */
export async function appendHistory(slug: string, msg: ChatMessage): Promise<void> {
  const file = chatHistoryPath(slug);
  let existing: ChatMessage[] = [];
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    /* missing or unreadable history — start fresh */
  }
  existing.push(msg);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

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
    chimeIns: [],
  };

  const tpl = await fs.readFile(
    path.resolve(STUDIO_DIR, "templates", "CLAUDE.md.tpl"), "utf-8",
  );

  const dir = projectDir(slug);
  try {
    await fs.mkdir(path.join(dir, "frames"), { recursive: true });
    await fs.mkdir(path.join(dir, "shared"), { recursive: true });
    await fs.writeFile(projectJsonPath(slug), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(dir, "theme-overrides.css"), "/* Local theme overrides */\n");
    await fs.writeFile(path.join(dir, "CLAUDE.md"), renderTemplate(tpl, {
      PROJECT_NAME: input.name,
      THEME: input.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
      GLOBAL_MEMORY: globalMemoryDir(),
    }));
    await fs.writeFile(chatHistoryPath(slug), "[]");
    await ensureMemoryStubs(projectMemoryDir(slug), "this project");
    await scaffoldDevRevHelper(slug);
    await scaffoldDevRevApiReference(slug);
    await scaffoldComputerReferenceFrame(dir);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return project;
}

/**
 * Seed every new project with a working Computer / Agent Studio reference
 * frame. The frame is a single-line `<ComputerScene />` — the populated-by-
 * default scene composite. This serves two audiences:
 *
 *  1. Designers see a fully realised Computer prototype the moment they
 *     create a project. They can keep it, mutate it, or delete it.
 *  2. The generator agent has a concrete on-disk reference to read
 *     ("frames/00-computer-reference/index.tsx") whenever the prompt asks
 *     for a Computer screen. Copy-and-mutate beats slot-graph reasoning
 *     when the prompt is generic ("a Computer chat screen").
 *
 * Numbered `00-` so it sits ahead of any frame the user generates with the
 * `01-…` two-digit prefix scheme.
 */
/** Slug of the seeded Computer reference frame. */
export const COMPUTER_REFERENCE_SLUG = "00-computer-reference";

/**
 * Exact source the reference frame is seeded with. Kept as a module constant
 * so `reconcileFrames` can detect whether the user (or agent) has touched the
 * frame yet: an UNMODIFIED seed is hidden from the viewport — designers never
 * ask for a generic Computer screen, so showing them an untouched canonical
 * scene is just noise. The file stays on disk either way, because the
 * generator reads/copies it as a reference (see CLAUDE.md.tpl).
 */
const COMPUTER_REFERENCE_SOURCE = `import * as React from "react";
import { ComputerScene } from "arcade-prototypes";

// Reference frame for Computer / Agent Studio chat screens.
// Mutate this frame, copy it as a starting point for new ones, or delete it.
// To swap to the empty-state wordmark: <ComputerScene state="empty" />
// To add the right-hand artefacts panel: <ComputerScene withCanvasPanel />
export default function ComputerReference() {
  return <ComputerScene />;
}
`;

async function scaffoldComputerReferenceFrame(dir: string): Promise<void> {
  const frameDir = path.join(dir, "frames", COMPUTER_REFERENCE_SLUG);
  await fs.mkdir(frameDir, { recursive: true });
  await fs.writeFile(path.join(frameDir, "index.tsx"), COMPUTER_REFERENCE_SOURCE);
}

/**
 * Seed a chosen homepage template into an existing project as a VISIBLE frame.
 * Unlike the hidden 00-computer-reference seed, this is the page the user
 * explicitly picked, so it gets a 01- prefix and surfaces in the viewport.
 * reconcileFrames (called on every project GET) would also pick the file up,
 * but we update project.json here too so the frame is present immediately
 * without waiting for the next reconcile.
 */
export async function seedTemplateFrame(slug: string, templateId: string): Promise<Frame> {
  const def = getTemplate(templateId);
  if (!def) throw new Error(`Unknown template: ${templateId}`);
  const project = await getProject(slug);
  if (!project) throw new Error(`Project not found: ${slug}`);

  const frameSlug = `01-${def.id}`;
  const dir = path.join(projectDir(slug), "frames", frameSlug);
  await fs.mkdir(dir, { recursive: true });

  if (await isSeedDirectory(def.id)) {
    // Directory seed: copy the whole tree (index.tsx + sibling files).
    await fs.cp(templateSeedPath(def.id), dir, { recursive: true });
  } else {
    const source = await readTemplateSeed(def.id as TemplateId);
    await fs.writeFile(path.join(dir, "index.tsx"), source, "utf-8");
  }

  const frame: Frame = {
    slug: frameSlug,
    name: def.name,
    size: "1440",
    createdAt: new Date().toISOString(),
  };
  if (!project.frames.some((f) => f.slug === frameSlug)) {
    await updateProject(slug, { frames: [...project.frames, frame] });
  }
  return frame;
}

/**
 * Copy the DevRev API integration guide into the project's `shared/` so the
 * agent can `Read shared/DEVREV-API.md` on demand. This content used to live
 * inline in CLAUDE.md (~250 lines / ~7K tokens) and was loaded on EVERY turn
 * even though it's only relevant when the designer asks for live DevRev data.
 * Splitting it out keeps the always-loaded system prompt lean. The file is
 * static (no template vars), so a plain copy suffices. Idempotent.
 */
async function scaffoldDevRevApiReference(slug: string): Promise<void> {
  const src = path.resolve(STUDIO_DIR, "templates", "DEVREV-API.md");
  const dest = path.join(sharedDir(slug), "DEVREV-API.md");
  try {
    await fs.mkdir(sharedDir(slug), { recursive: true });
    await fs.copyFile(src, dest);
  } catch (err) {
    console.warn(`[projects] DEVREV-API.md scaffold skipped for ${slug}:`, err);
  }
}

/**
 * True when the reference frame is still the untouched seed. Compared against
 * the on-disk source so any edit (by the user via the UI, or by the agent
 * copying real data into it) flips it to "modified" and it becomes visible.
 */
async function isUnmodifiedReferenceFrame(slug: string, frameName: string): Promise<boolean> {
  if (frameName !== COMPUTER_REFERENCE_SLUG) return false;
  try {
    const src = await fs.readFile(
      path.join(projectDir(slug), "frames", frameName, "index.tsx"),
      "utf-8",
    );
    return src === COMPUTER_REFERENCE_SOURCE;
  } catch {
    return false;
  }
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
      // Ignore dotfiles (macOS sprays .DS_Store into every directory). These
      // aren't projects and shouldn't spam the logs.
      if (slug.startsWith(".")) continue;
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
    // Backfill memory/ for projects created before the memory feature. Idempotent.
    await ensureMemoryStubs(projectMemoryDir(p.slug), "this project");
    // Backfill the DevRev API reference for projects created before it was
    // split out of CLAUDE.md. Idempotent (plain copy, last write wins).
    await scaffoldDevRevApiReference(p.slug);
    const rendered = renderTemplate(tpl, {
      PROJECT_NAME: p.name,
      THEME: p.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
      GLOBAL_MEMORY: globalMemoryDir(),
    });
    const file = path.join(projectDir(p.slug), "CLAUDE.md");
    let current = "";
    try { current = await fs.readFile(file, "utf-8"); } catch {}
    if (current === rendered) continue;
    // Preserve the prior contents before we overwrite — users who edited
    // CLAUDE.md inline (rare but happens) can recover from `.bak` on the
    // next launch. Single rolling backup; last refresh wins.
    if (current) {
      try { await fs.writeFile(`${file}.bak`, current); }
      catch (err) {
        console.warn(`[studio] CLAUDE.md backup skipped for ${p.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await fs.writeFile(file, rendered);
    if (p.sessionId) await updateProject(p.slug, { sessionId: undefined });
    refreshed += 1;
  }
  return refreshed;
}

/**
 * Clear the resume session of every project so the next claude turn re-reads
 * the system prompt instead of resuming a stale one. Called when the user-kit
 * changes (a component saved/imported/deleted): the kit catalog rides in the
 * cached `--append-system-prompt`, so a resumed session would never see the
 * new/removed component. Same mechanism as refreshStaleClaudeMd. Returns the
 * number of sessions cleared.
 */
export async function clearAllProjectSessions(): Promise<number> {
  const ps = await listProjects();
  let cleared = 0;
  for (const p of ps) {
    if (p.sessionId) {
      await updateProject(p.slug, { sessionId: undefined });
      cleared += 1;
    }
  }
  return cleared;
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

/**
 * Compute the next two-digit prefix for a new frame. Scans existing
 * frame slugs for a leading `\d+-` prefix and returns highest+1,
 * padded to two digits (or more if we've gone past 99). Slugs without
 * a numeric prefix are ignored.
 */
export function nextFramePrefix(existingSlugs: string[]): string {
  let max = 0;
  for (const slug of existingSlugs) {
    const m = slug.match(/^(\d+)-/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return next.toString().padStart(2, "0");
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
  for (const name of entries) {
    const idx = path.join(framesDir, name, "index.tsx");
    try { await fs.access(idx); } catch { continue; }
    // Hide the seeded Computer reference frame from the viewport until it's
    // been modified. The file stays on disk for the generator to read/copy;
    // the user just shouldn't see an untouched generic scene they never asked
    // for. Once edited (by the user or the agent), it surfaces normally.
    if (await isUnmodifiedReferenceFrame(slug, name)) continue;
    const prior = project.frames.find((f) => f.slug === name);
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

  return next.frames;
}

function titleCase(slug: string): string {
  // Strip leading numeric prefix (e.g., "01-untitled-1" → "untitled-1")
  const withoutPrefix = slug.replace(/^\d+-/, "");
  return withoutPrefix.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
