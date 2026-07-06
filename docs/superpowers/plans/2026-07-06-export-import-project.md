# Export / Import Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click Export (project → `.arcade` file) and Import (`.arcade` file → project appears immediately, components installed) to Arcade Studio.

**Architecture:** A new pure module `studio/server/projectBundle.ts` owns pack/unpack/validate/install logic (unit-testable, no HTTP). Two thin routes in the existing `studio/server/middleware/projects.ts` expose it: `GET /api/projects/:slug/export` (binary download) and `POST /api/projects/import` (raw-body upload, mirroring `uploadsMiddleware`). Client helpers in `src/lib/api.ts`; UI is an Export item in `ProjectPicker`'s menu and an Import button on the home screen. Bundle = gzipped tar via the OS `/usr/bin/tar`. All import validation happens in a temp dir outside `projects/`; the live tree is mutated only after every check passes.

**Tech Stack:** TypeScript, Node `fs/promises` + `child_process`, Vite middleware, React, Vitest. macOS-only app (bsdtar guaranteed present). No new npm dependencies.

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. Tests run via `pnpm run studio:test <path>` from the repo root (`/Users/andrey.sundiev/arcade-prototyper`), not from `studio/`.
- **No new npm dependency.** Tar via absolute `/usr/bin/tar`; upload via raw request body (the `uploadsMiddleware` pattern), never multipart.
- **Bundle format version is `1`.** `manifest.format` must equal `1`; import rejects any other value.
- **Vite middleware does NOT hot-reload.** Changes under `server/middleware/*` need a full restart to test manually.
- **Never `git add -A`/`git add .`** — stage explicit paths only.
- **Commit style:** `feat(studio/projects): ...`. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Component name rule:** `NAME_RE = /^[A-Z][A-Za-z0-9]{1,39}$/` (PascalCase, ≤40 chars). Every component write goes through `componentStore.saveComponentFile` (validates name before building any path + runs the compile gate).
- **Studio root override:** tests set `process.env.ARCADE_STUDIO_ROOT` to a temp dir and `process.env.HOME` to a temp fake home (see `__tests__/server/projects.test.ts:10-25`). Reuse that harness verbatim.
- **`arcade-user` import specifier is exact:** match `` /from\s*["']arcade-user/<Name>["']/ `` — never a substring test (else `Foo` matches `FooBar`).
- **Fix-class rollout:** verify with `pnpm run studio`; NO version bump / CHANGELOG / pack unless a release is explicitly requested.

---

### Task 1: Bundle manifest types + `cleanProjectJson`

**Files:**
- Create: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `Project` from `studio/server/types.ts`.
- Produces:
  - `interface ComponentManifestRow { name: string; description: string; origin: string; createdAt: string; thumb?: boolean; missing?: boolean; }`
  - `interface BundleManifest { format: 1; exporterVersion: string; name: string; slug: string; components: ComponentManifestRow[]; }`
  - `function cleanProjectJson(p: Project): Project` — returns a copy with `sessionId`, `deployments`, `computerConversationId` removed and `chimeIns` reset to `[]`. Leaves `name`, `slug`, `createdAt`, `updatedAt`, `theme`, `mode`, `frames` intact.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/projectBundle.test.ts
import { describe, it, expect } from "vitest";
import { cleanProjectJson } from "../../server/projectBundle";
import type { Project } from "../../server/types";

const base: Project = {
  name: "My Project", slug: "my-project",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  theme: "arcade", mode: "light",
  frames: [{ slug: "01-home", name: "Home", size: "1440", createdAt: "2026-01-01T00:00:00.000Z" }],
  chimeIns: [],
};

describe("cleanProjectJson", () => {
  it("strips per-machine fields and resets chimeIns", () => {
    const dirty: Project = {
      ...base,
      sessionId: "sess-123",
      computerConversationId: "conv-xyz",
      deployments: [{ frameSlug: "01-home", url: "https://x", createdAt: "2026-01-01T00:00:00.000Z" }],
      chimeIns: [{ id: "c1", frameSlug: "01-home", status: "pending", message: "hi", createdAt: "2026-01-01T00:00:00.000Z" } as any],
    };
    const clean = cleanProjectJson(dirty);
    expect(clean.sessionId).toBeUndefined();
    expect(clean.computerConversationId).toBeUndefined();
    expect(clean.deployments).toBeUndefined();
    expect(clean.chimeIns).toEqual([]);
    // preserved
    expect(clean.name).toBe("My Project");
    expect(clean.theme).toBe("arcade");
    expect(clean.mode).toBe("light");
    expect(clean.frames).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const input: Project = { ...base, sessionId: "keep" };
    cleanProjectJson(input);
    expect(input.sessionId).toBe("keep");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — `cleanProjectJson` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/projectBundle.ts
import type { Project } from "./types";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): bundle types + cleanProjectJson\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Transitive component-dependency scan

**Files:**
- Modify: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `userKitCompositesDir` from `studio/server/paths.ts`.
- Produces:
  - `async function resolveComponentDeps(framesDir: string): Promise<{ names: string[]; missing: string[] }>` — scans every `.tsx`/`.ts` under `framesDir` for `arcade-user/<Name>` imports, then transitively scans each referenced composite file (`userKitCompositesDir()/<Name>.tsx`) for further `arcade-user/<Name>` imports until the set closes. `names` = referenced components that exist on disk (sorted, deduped); `missing` = referenced names with no file on disk (sorted, deduped).

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach } from "vitest";
import { resolveComponentDeps } from "../../server/projectBundle";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundle-"));
  process.env.ARCADE_STUDIO_ROOT = root;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeComposite(name: string, body: string) {
  const dir = path.join(root, "user-kit", "composites");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.tsx`), body);
}
function writeFrame(framesDir: string, frameSlug: string, body: string) {
  const dir = path.join(framesDir, frameSlug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.tsx"), body);
}

describe("resolveComponentDeps", () => {
  it("follows frame -> composite -> composite transitively", async () => {
    // AppCard imports PriceTag; a frame imports only AppCard.
    writeComposite("PriceTag", `export function PriceTag() { return null; }`);
    writeComposite("AppCard", `import { PriceTag } from "arcade-user/PriceTag";\nexport function AppCard() { return null; }`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { AppCard } from "arcade-user/AppCard";\nexport default function F() { return null; }`);

    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["AppCard", "PriceTag"]);
    expect(missing).toEqual([]);
  });

  it("reports referenced-but-absent components as missing, not found", async () => {
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Ghost } from "arcade-user/Ghost";`);
    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual([]);
    expect(missing).toEqual(["Ghost"]);
  });

  it("does not match substrings (arcade-user/Foo vs FooBar)", async () => {
    writeComposite("FooBar", `export function FooBar() { return null; }`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { FooBar } from "arcade-user/FooBar";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["FooBar"]); // not "Foo"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — `resolveComponentDeps` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to studio/server/projectBundle.ts
import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir } from "./paths";

// Discovery regex: capture any PascalCase name imported from arcade-user/<Name>.
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
 * import another via the shared `arcade-user` alias). Returns components that
 * exist on disk (to bundle) separately from names referenced but with no file
 * (deleted from the kit — surfaced as a soft warning, never fatal).
 */
export async function resolveComponentDeps(
  framesDir: string,
): Promise<{ names: string[]; missing: string[] }> {
  const found = new Set<string>();
  const missing = new Set<string>();
  const queue = await scanTreeForDeps(framesDir);
  const seen = new Set<string>();
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
  return {
    names: [...found].sort(),
    missing: [...missing].sort(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS (all resolveComponentDeps tests + Task 1 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): transitive component dep scan for bundling\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `runTar` + `packProject` (export core)

**Files:**
- Modify: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `projectDir`, `userKitCompositesDir`, `studioRoot` from `paths.ts`; `getProject` from `projects.ts`; `listComponents` from `componentStore.ts`; `COMPUTER_REFERENCE_SLUG` + `COMPUTER_REFERENCE_SOURCE` — **export `COMPUTER_REFERENCE_SOURCE` from `projects.ts`** (currently a private const at `projects.ts:163`; add `export`).
- Produces:
  - `async function runTar(args: string[], cwd: string): Promise<void>` — spawns `/usr/bin/tar` with `args` in `cwd`; rejects on non-zero exit with stderr.
  - `async function packProject(slug: string): Promise<{ filePath: string; warnings: string[] }>` — builds `<studioRoot>/.bundle-tmp-XXXX/<slug>.arcade` and returns its path + warnings (e.g. `"Component Ghost is missing"`). Caller deletes the temp dir after streaming.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { packProject } from "../../server/projectBundle";
import { createProject } from "../../server/projects";
import { execFileSync } from "node:child_process";

describe("packProject", () => {
  it("produces a .arcade tar with a clean project and used components, minus excluded files", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home-"));
    const proj = await createProject({ name: "Pack Me", theme: "arcade", mode: "light" });
    const pdir = path.join(root, "projects", proj.slug);
    // a real frame that uses a saved component
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"),
      `import { Badge } from "arcade-user/Badge";\nexport default function F(){return null;}`);
    // the saved component on disk
    const cdir = path.join(root, "user-kit", "composites");
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, "Badge.tsx"), `export function Badge(){return null;}`);
    // stuff that must NOT ship
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"secret":"nope"}]`);
    fs.mkdirSync(path.join(pdir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "memory", "LEARNED.md"), "private");

    const { filePath, warnings } = await packProject(proj.slug);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(warnings).toEqual([]);

    // list tar entries
    const listing = execFileSync("/usr/bin/tar", ["tzf", filePath], { encoding: "utf-8" });
    expect(listing).toMatch(/manifest\.json/);
    expect(listing).toMatch(/project\/frames\/01-home\/index\.tsx/);
    expect(listing).toMatch(/components\/Badge\.tsx/);
    expect(listing).not.toMatch(/chat-history\.json/);
    expect(listing).not.toMatch(/memory\//);
    expect(listing).not.toMatch(/CLAUDE\.md/);
  });

  it("records missing components as a warning without failing", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home2-"));
    const proj = await createProject({ name: "Ghosty", theme: "arcade", mode: "light" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-x"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-x", "index.tsx"),
      `import { Ghost } from "arcade-user/Ghost";`);
    const { warnings } = await packProject(proj.slug);
    expect(warnings.join(" ")).toMatch(/Ghost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — `packProject` not exported.

- [ ] **Step 3: Write minimal implementation**

First, in `studio/server/projects.ts`, add `export` to the reference-source const (needed by packProject to drop the untouched seed):

```ts
// projects.ts — change line ~163 from `const COMPUTER_REFERENCE_SOURCE` to:
export const COMPUTER_REFERENCE_SOURCE = `import * as React from "react";
// ... unchanged body ...
`;
```

Then in `projectBundle.ts`:

```ts
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectDir, userKitCompositesDir, studioRoot } from "./paths";
import { getProject, COMPUTER_REFERENCE_SLUG, COMPUTER_REFERENCE_SOURCE } from "./projects";
import { listComponents } from "./componentStore";

const TAR = "/usr/bin/tar";

// Files/dirs that never ship in a bundle (machine-specific, private, or regen'd).
const EXCLUDE_TOP = new Set([
  "chat-history.json", "memory", "CLAUDE.md", "CLAUDE.md.bak",
  "thumbnails", "_uploads", "last-error.log", "last-stdout.log",
]);

function studioVersion(): string {
  // package.json#version is the single source of truth (repo root).
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
    const src = path.join(srcProjectDir, e.name);
    const dest = path.join(destProjectDir, e.name);
    if (e.isSymbolicLink()) continue; // never copy links out
    if (e.isDirectory()) await fs.cp(src, dest, { recursive: true });
    else if (e.isFile()) await fs.copyFile(src, dest);
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

  const tmpRoot = await fs.mkdtemp(path.join(studioRoot(), ".bundle-tmp-"));
  const projOut = path.join(tmpRoot, "project");
  const compOut = path.join(tmpRoot, "components");
  await fs.mkdir(compOut, { recursive: true });

  // 1. clean project.json + copy allowed subtree
  await copyProjectSubtree(projectDir(slug), projOut);
  await fs.writeFile(
    path.join(projOut, "project.json"),
    JSON.stringify(cleanProjectJson(project), null, 2));

  // 2. drop the untouched seed frame (recipient regenerates its own)
  const framesOut = path.join(projOut, "frames");
  if (await isUnmodifiedSeedFrame(framesOut)) {
    await fs.rm(path.join(framesOut, COMPUTER_REFERENCE_SLUG), { recursive: true, force: true });
  }

  // 3. resolve + copy component deps (transitive)
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
      name,
      description: meta?.description ?? "",
      origin: meta?.origin ?? "imported",
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      thumb: meta?.thumb ?? false,
    });
  }
  for (const m of missing) rows.push({ name: m, description: "", origin: "imported", createdAt: new Date().toISOString(), missing: true });

  // 4. manifest
  const manifest: BundleManifest = {
    format: 1,
    exporterVersion: studioVersion(),
    name: project.name,
    slug: project.slug,
    components: rows,
  };
  await fs.writeFile(path.join(tmpRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 5. tar it up
  const filePath = path.join(tmpRoot, `${slug}.arcade`);
  await runTar(["czf", filePath, "manifest.json", "project", "components"], tmpRoot);
  return { filePath, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/server/projects.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): packProject builds clean .arcade bundle\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Safe extraction — `assertNoLinks`, `enforceCaps`, `extractBundle`

**Files:**
- Modify: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Produces:
  - `async function assertNoLinks(dir: string): Promise<void>` — walks `dir`; throws `Error("Bundle contains a symbolic or hard link; refusing to import.")` if any entry is a symlink (`lstat().isSymbolicLink()`) or a regular file with `nlink > 1` (hardlink).
  - `async function enforceCaps(dir: string, maxBytes: number, maxEntries: number): Promise<void>` — walks `dir`; throws if cumulative file bytes exceed `maxBytes` or entry count exceeds `maxEntries`.
  - `const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;` and `const MAX_BUNDLE_ENTRIES = 5000;` (exported).
  - `async function extractBundle(bytes: Buffer): Promise<string>` — writes bytes to a temp file in a fresh `mkdtemp` under `studioRoot()` (dir name prefix `.import-tmp-`), runs `tar xzf` into that dir, then `enforceCaps` + `assertNoLinks`. Returns the temp dir path. On any failure, `rm -rf`s the temp dir and rethrows.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { assertNoLinks, enforceCaps, extractBundle } from "../../server/projectBundle";

describe("import safety", () => {
  it("assertNoLinks rejects a symlink entry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-"));
    fs.writeFileSync(path.join(dir, "real.txt"), "ok");
    fs.symlinkSync("/etc/hosts", path.join(dir, "escape"));
    await expect(assertNoLinks(dir)).rejects.toThrow(/link/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("assertNoLinks passes a clean tree", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "a.txt"), "hi");
    await expect(assertNoLinks(dir)).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("enforceCaps rejects when over the entry cap", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `f${i}`), "x");
    await expect(enforceCaps(dir, 1_000_000, 3)).rejects.toThrow(/too many|entries/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extractBundle unpacks a real packed bundle", async () => {
    // Reuse packProject output from a fresh project.
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-home3-"));
    const proj = await createProject({ name: "Extract Me", theme: "arcade", mode: "light" });
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);
    const outDir = await extractBundle(bytes);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "project", "project.json"))).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to studio/server/projectBundle.ts
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
export const MAX_BUNDLE_ENTRIES = 5000;

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

export async function enforceCaps(dir: string, maxBytes: number, maxEntries: number): Promise<void> {
  let bytes = 0, count = 0;
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      count += 1;
      if (count > maxEntries) throw new Error("Bundle has too many entries; refusing to import.");
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        bytes += (await fs.stat(full)).size;
        if (bytes > maxBytes) throw new Error("Bundle is too large; refusing to import.");
      }
    }
  }
  await walk(dir);
}

export async function extractBundle(bytes: Buffer): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(studioRoot(), ".import-tmp-"));
  try {
    const archive = path.join(tmp, "bundle.arcade");
    await fs.writeFile(archive, bytes);
    await runTar(["xzf", archive, "-C", tmp], tmp);
    await fs.rm(archive, { force: true });
    await enforceCaps(tmp, MAX_BUNDLE_BYTES, MAX_BUNDLE_ENTRIES);
    await assertNoLinks(tmp);
    return tmp;
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): safe bundle extraction (link + size caps)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Collision-safe component install + rename

**Files:**
- Modify: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `componentExists`, `saveComponentFile`, `isValidComponentName` from `componentStore.ts`; `userKitCompositesDir` from `paths.ts`.
- Produces:
  - `async function uniqueComponentName(base: string, taken: Set<string>): Promise<string>` — returns a valid `NAME_RE` name not already in the recipient's kit nor in `taken`, trying `<base>Imported`, `<base>Imported2`, …; truncates `base` so the result stays ≤40 chars.
  - `async function renameComponentEverywhere(oldName: string, newName: string, framesRoot: string): Promise<void>` — in every `.tsx`/`.ts` under `framesRoot` that references `arcade-user/<oldName>`, replaces whole-word `oldName`→`newName` (regex `/\boldName\b/g`), which rewrites the specifier, import binding, and JSX tags in one pass.
  - `async function installBundledComponents(compDir: string, rows: ComponentManifestRow[], framesRoot: string): Promise<void>` — for each non-missing row: if recipient lacks the name → install as-is; if same name + byte-identical `.tsx` → skip; if same name + different bytes → pick `uniqueComponentName`, rename inside the component source + rewrite frames, then install under the new name. All writes go through `saveComponentFile`.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { installBundledComponents, uniqueComponentName, renameComponentEverywhere } from "../../server/projectBundle";
import { saveComponentFile, componentExists } from "../../server/componentStore";

describe("component install + rename", () => {
  it("installs a brand-new component as-is", async () => {
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-"));
    fs.writeFileSync(path.join(compDir, "Fresh.tsx"), `export function Fresh(){return null;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
    await installBundledComponents(compDir, [{ name: "Fresh", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Fresh")).toBe(true);
  });

  it("renames on same-name-different-content and rewrites frame references", async () => {
    // recipient already has Button with different content
    await saveComponentFile({ name: "Button", description: "mine", tsx: `export function Button(){return <div>MINE</div>;}`, origin: "saved", createdAt: "t" });
    // bundle ships a different Button + a frame using it
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp2-"));
    fs.writeFileSync(path.join(compDir, "Button.tsx"), `export function Button(){return <div>THEIRS</div>;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames2-"));
    fs.mkdirSync(path.join(framesRoot, "01-home"), { recursive: true });
    fs.writeFileSync(path.join(framesRoot, "01-home", "index.tsx"),
      `import { Button } from "arcade-user/Button";\nexport default function F(){return <Button />;}`);

    await installBundledComponents(compDir, [{ name: "Button", description: "d", origin: "imported", createdAt: "t" }], framesRoot);

    expect(await componentExists("ButtonImported")).toBe(true);
    const frame = fs.readFileSync(path.join(framesRoot, "01-home", "index.tsx"), "utf-8");
    expect(frame).toContain(`arcade-user/ButtonImported`);
    expect(frame).toContain(`<ButtonImported />`);
    expect(frame).toContain(`{ ButtonImported }`);
  });

  it("skips identical same-name components", async () => {
    const tsx = `export function Same(){return null;}`;
    await saveComponentFile({ name: "Same", description: "d", tsx, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp3-"));
    fs.writeFileSync(path.join(compDir, "Same.tsx"), tsx);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames3-"));
    await installBundledComponents(compDir, [{ name: "Same", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Same")).toBe(true); // unchanged, no throw
  });

  it("uniqueComponentName truncates long bases to stay <=40 chars", async () => {
    const long = "A".repeat(38); // + "Imported" would be 46
    const out = await uniqueComponentName(long, new Set());
    expect(out.length).toBeLessThanOrEqual(40);
    expect(/^[A-Z][A-Za-z0-9]{1,39}$/.test(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — install helpers not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to studio/server/projectBundle.ts
import { componentExists, saveComponentFile, isValidComponentName } from "./componentStore";

export async function uniqueComponentName(base: string, taken: Set<string>): Promise<string> {
  // Trim base so base + "Imported" + up to 3 digits fits in 40 chars.
  const trimmed = base.slice(0, 40 - "Imported".length - 3) || "X";
  for (let n = 0; n < 1000; n++) {
    const cand = n === 0 ? `${trimmed}Imported` : `${trimmed}Imported${n + 1}`;
    if (isValidComponentName(cand) && !taken.has(cand) && !(await componentExists(cand))) return cand;
  }
  throw new Error(`Could not find a free name for imported component "${base}".`);
}

async function rewriteFrameFilesReferencing(oldName: string, newName: string, dir: string): Promise<void> {
  const specifier = new RegExp(`["']arcade-user/${oldName}["']`);
  const whole = new RegExp(`\\b${oldName}\\b`, "g");
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await rewriteFrameFilesReferencing(oldName, newName, full); continue; }
    if (!(e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts")))) continue;
    const src = await fs.readFile(full, "utf-8");
    if (!specifier.test(src)) continue; // only touch files that actually import it
    await fs.writeFile(full, src.replace(whole, newName));
  }
}

export async function renameComponentEverywhere(oldName: string, newName: string, framesRoot: string): Promise<void> {
  await rewriteFrameFilesReferencing(oldName, newName, framesRoot);
}

export async function installBundledComponents(
  compDir: string, rows: ComponentManifestRow[], framesRoot: string,
): Promise<void> {
  const takenThisBundle = new Set<string>();
  for (const row of rows) {
    if (row.missing) continue;
    const srcPath = path.join(compDir, `${row.name}.tsx`);
    let tsx: string;
    try { tsx = await fs.readFile(srcPath, "utf-8"); } catch { continue; }

    const exists = await componentExists(row.name);
    if (exists) {
      const current = await fs.readFile(path.join(userKitCompositesDir(), `${row.name}.tsx`), "utf-8").catch(() => "");
      if (current === tsx) { continue; } // identical — nothing to do
      // different content — install under a fresh name + rewrite the frames + the component's own source
      const newName = await uniqueComponentName(row.name, takenThisBundle);
      takenThisBundle.add(newName);
      const renamedSource = tsx.replace(new RegExp(`\\b${row.name}\\b`, "g"), newName);
      await renameComponentEverywhere(row.name, newName, framesRoot);
      await saveComponentFile({ name: newName, description: row.description, tsx: renamedSource, origin: "imported", createdAt: row.createdAt });
    } else {
      takenThisBundle.add(row.name);
      await saveComponentFile({ name: row.name, description: row.description, tsx, origin: "imported", createdAt: row.createdAt });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): collision-safe component install + rename\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `unpackAndInstall` orchestrator + `scaffoldProjectMeta`

**Files:**
- Modify: `studio/server/projectBundle.ts`, `studio/server/projects.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `projectsRoot`, `projectDir` from `paths.ts`; `projectSchema` from `types.ts`; `uniqueSlug` (private in `projects.ts`) and CLAUDE.md render — expose via a new export.
- Produces (in `projects.ts`):
  - `export async function scaffoldProjectMeta(slug: string): Promise<void>` — for an existing on-disk project, writes `CLAUDE.md` from the template with THIS machine's paths, `ensureMemoryStubs`, and `scaffoldDevRevApiReference`. (Reuses the private `renderTemplate`, `readTemplate`, `ARCADE_GEN_ROOT`, `PROTOTYPER_ROOT` already in the module.)
  - `export async function importSlug(name: string): Promise<string>` — thin wrapper: `uniqueSlug(slugify(name))`.
- Produces (in `projectBundle.ts`):
  - `export async function unpackAndInstall(bytes: Buffer): Promise<Project>` — full pipeline: extract (Task 4) → read+validate `manifest.json` (`format===1`) → parse `project/project.json` against `projectSchema` → derive install slug via `importSlug(manifest.name)`; if slug ≠ original, set `name = "<name> (imported)"` → install components (Task 5) into `project/frames` staged tree → move staged `project/` into `projectDir(slug)` → write cleaned `project.json` with new slug/name → `scaffoldProjectMeta(slug)` → `reconcileFrames(slug)` → return the project. `finally` removes the temp dir.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { unpackAndInstall } from "../../server/projectBundle";
import { listProjects, getProject } from "../../server/projects";

describe("unpackAndInstall (round-trip)", () => {
  it("imports a packed bundle into a clean root with recipient paths", async () => {
    // EXPORT side, in root A
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-a-"));
    const proj = await createProject({ name: "Trip", theme: "devrev-app", mode: "dark" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"), `export default function F(){return null;}`);
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"x":1}]`);
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);

    // IMPORT side, in a FRESH root B
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-b-"));
    process.env.ARCADE_STUDIO_ROOT = rootB;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-b-"));

    const imported = await unpackAndInstall(bytes);
    expect(imported.theme).toBe("devrev-app");
    expect(imported.mode).toBe("dark");
    // folder name === slug invariant
    expect(fs.existsSync(path.join(rootB, "projects", imported.slug, "project.json"))).toBe(true);
    // excluded content absent; CLAUDE.md regenerated
    expect(fs.existsSync(path.join(rootB, "projects", imported.slug, "chat-history.json"))).toBe(false);
    expect(fs.existsSync(path.join(rootB, "projects", imported.slug, "CLAUDE.md"))).toBe(true);
    // frame present
    expect(fs.existsSync(path.join(rootB, "projects", imported.slug, "frames", "01-home", "index.tsx"))).toBe(true);
    // appears in listing
    expect((await listProjects()).some((p) => p.slug === imported.slug)).toBe(true);

    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("re-slugs and marks name on collision", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-c-"));
    const proj = await createProject({ name: "Dup", theme: "arcade", mode: "light" });
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);
    // import back into the SAME root where "dup" already exists
    const imported = await unpackAndInstall(bytes);
    expect(imported.slug).not.toBe(proj.slug);
    expect(imported.name).toMatch(/\(imported\)/);
  });

  it("rejects a bundle with a bad format", async () => {
    // hand-build a bogus bundle
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), "bogus-"));
    fs.writeFileSync(path.join(bogus, "manifest.json"), JSON.stringify({ format: 99 }));
    fs.mkdirSync(path.join(bogus, "project"));
    fs.writeFileSync(path.join(bogus, "project", "project.json"), "{}");
    fs.mkdirSync(path.join(bogus, "components"));
    execFileSync("/usr/bin/tar", ["czf", path.join(bogus, "b.arcade"), "-C", bogus, "manifest.json", "project", "components"]);
    const bytes = fs.readFileSync(path.join(bogus, "b.arcade"));
    await expect(unpackAndInstall(bytes)).rejects.toThrow(/newer version|format/i);
    fs.rmSync(bogus, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — `unpackAndInstall`/`scaffoldProjectMeta` not exported.

- [ ] **Step 3: Write minimal implementation**

In `studio/server/projects.ts`, add near the other exports (reuses in-module `readTemplate`, `renderTemplate`, `ARCADE_GEN_ROOT`, `PROTOTYPER_ROOT`, `ensureMemoryStubs`, `scaffoldDevRevApiReference`, `uniqueSlug`, `slugify`):

```ts
// projects.ts
export async function importSlug(name: string): Promise<string> {
  return uniqueSlug(slugify(name));
}

/**
 * Write CLAUDE.md + memory stubs + the DevRev API reference for an already
 * on-disk project, using THIS machine's paths. Used by project import, which
 * deliberately ships no CLAUDE.md (it hardcodes the exporter's paths). Mirrors
 * the scaffolding createProject does, minus the directory creation.
 */
export async function scaffoldProjectMeta(slug: string): Promise<void> {
  const p = await getProject(slug);
  if (!p) throw new Error(`Project not found: ${slug}`);
  const tpl = await readTemplate();
  await fs.writeFile(path.join(projectDir(slug), "CLAUDE.md"), renderTemplate(tpl, {
    PROJECT_NAME: p.name,
    THEME: p.theme,
    ARCADE: ARCADE_GEN_ROOT,
    PROTOTYPER: PROTOTYPER_ROOT,
    GLOBAL_MEMORY: globalMemoryDir(),
  }));
  await ensureMemoryStubs(projectMemoryDir(slug), "this project");
  await scaffoldDevRevApiReference(slug);
}
```

In `studio/server/projectBundle.ts`:

```ts
import { projectsRoot } from "./paths";
import { projectSchema, type Project } from "./types";
import { importSlug, scaffoldProjectMeta, reconcileFrames } from "./projects";

export async function unpackAndInstall(bytes: Buffer): Promise<Project> {
  const tmp = await extractBundle(bytes); // throws on link/cap/tar failure
  try {
    // 1. manifest
    const manifestRaw = await fs.readFile(path.join(tmp, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as BundleManifest;
    if (manifest?.format !== 1) {
      throw new Error("This bundle was made by a newer version of Studio and can't be imported.");
    }
    // 2. project.json against the schema (strips unknown keys, enforces slug/enums)
    const stagedProjectDir = path.join(tmp, "project");
    const projRaw = await fs.readFile(path.join(stagedProjectDir, "project.json"), "utf-8");
    const parsed = projectSchema.parse(JSON.parse(projRaw));

    // 3. derive a safe install slug from the NAME (never trust tar/JSON for the path)
    const slug = await importSlug(parsed.name);
    const collided = slug !== parsed.slug;
    const name = collided ? `${parsed.name} (imported)` : parsed.name;

    // 4. install components into the staged frames tree BEFORE moving in
    await installBundledComponents(path.join(tmp, "components"), manifest.components, path.join(stagedProjectDir, "frames"));

    // 5. rewrite the staged project.json with the final slug/name (already cleaned at export)
    await fs.writeFile(path.join(stagedProjectDir, "project.json"),
      JSON.stringify({ ...parsed, slug, name, updatedAt: new Date().toISOString() }, null, 2));

    // 6. promote: move staged project into the live projects root (same volume — mkdtemp is under studioRoot)
    const dest = path.join(projectsRoot(), slug);
    await fs.mkdir(projectsRoot(), { recursive: true });
    await fs.rename(stagedProjectDir, dest);

    // 7. recipient-side scaffolding + reconcile
    await scaffoldProjectMeta(slug);
    await reconcileFrames(slug);

    const final = await getProject(slug);
    if (!final) throw new Error("Import failed: project vanished after install.");
    return final;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
```

Note: `getProject` is already imported (Task 3). Add it to the import from `./projects` if not.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/server/projects.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): unpackAndInstall import pipeline + scaffoldProjectMeta\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: HTTP routes — export (GET) + import (POST raw body)

**Files:**
- Modify: `studio/server/middleware/projects.ts`
- Test: `studio/__tests__/server/middleware/projects-bundle.test.ts` (new)

**Interfaces:**
- Consumes: `packProject`, `unpackAndInstall`, `MAX_BUNDLE_BYTES` from `../projectBundle`.
- Produces two routes:
  - `GET /api/projects/:slug/export` → `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<slug>.arcade"`, streams the packed file, then deletes its temp dir. On missing project → 404 JSON.
  - `POST /api/projects/import` → reads raw body with a `MAX_BUNDLE_BYTES` cap + drain-on-overflow (the `uploadsMiddleware` pattern), calls `unpackAndInstall`, returns `201` + the `Project` JSON. Validation failures → `422` with `{ error: { message } }`; oversize → `413`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/middleware/projects-bundle.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";
import { createProject } from "../../../server/projects";

let tmp: string, home: string, server: Server, port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mwhome-"));
  process.env.HOME = home;
  const mw = projectsMiddleware();
  server = createServer((req, res) => mw(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as any).port;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("export/import routes", () => {
  it("round-trips a project through HTTP", async () => {
    const proj = await createProject({ name: "HTTP Trip", theme: "arcade", mode: "light" });

    const exp = await fetch(`http://localhost:${port}/api/projects/${proj.slug}/export`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-disposition")).toContain(`${proj.slug}.arcade`);
    const buf = Buffer.from(await exp.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);

    const imp = await fetch(`http://localhost:${port}/api/projects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buf,
    });
    expect(imp.status).toBe(201);
    const body = await imp.json();
    expect(body.slug).toBeTruthy();
    expect(body.name).toMatch(/imported/i); // collided with the original in the same root
  });

  it("404s export for an unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/nope/export`);
    expect(res.status).toBe(404);
  });

  it("422s a malformed import body", async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("not a tar"),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/middleware/projects-bundle.test.ts`
Expected: FAIL — routes not present (404 for export, or 404 fallthrough for import).

- [ ] **Step 3: Write minimal implementation**

At the top of `studio/server/middleware/projects.ts`, extend imports:

```ts
import fsp from "node:fs/promises";
import { packProject, unpackAndInstall, MAX_BUNDLE_BYTES } from "../projectBundle";
```

Inside `projectsMiddleware`'s handler, add these BEFORE the generic `/api/projects` GET/POST block (so the specific routes match first):

```ts
      // Export a project as a downloadable .arcade bundle.
      const exportMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/export$/);
      if (req.method === "GET" && exportMatch) {
        const slug = exportMatch[1];
        let filePath: string | undefined;
        try {
          const packed = await packProject(slug);
          filePath = packed.filePath;
          const buf = await fsp.readFile(filePath);
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${slug}.arcade"`,
          });
          res.end(buf);
        } catch (err: any) {
          const notFound = /not found/i.test(err?.message ?? "");
          return send(res, notFound ? 404 : 500, { error: { message: err?.message ?? "export failed" } });
        } finally {
          if (filePath) await fsp.rm(path.dirname(filePath), { recursive: true, force: true });
        }
        return;
      }

      // Import a .arcade bundle (raw body upload; mirrors uploadsMiddleware).
      if (req.method === "POST" && url === "/api/projects/import") {
        const chunks: Buffer[] = [];
        let total = 0, tooLarge = false;
        for await (const c of req) {
          total += c.length;
          if (total > MAX_BUNDLE_BYTES) { tooLarge = true; break; }
          chunks.push(Buffer.from(c));
        }
        if (tooLarge) {
          req.on("error", () => {}); req.resume();
          return send(res, 413, { error: { message: "Bundle too large." } });
        }
        try {
          const project = await unpackAndInstall(Buffer.concat(chunks));
          return send(res, 201, project);
        } catch (err: any) {
          return send(res, 422, { error: { message: err?.message ?? "Import failed." } });
        }
      }
```

`path` is already imported at the top of the file (used by `frameDir`). If not, add `import path from "node:path";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/middleware/projects-bundle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/middleware/projects.ts studio/__tests__/server/middleware/projects-bundle.test.ts
git commit -m "$(printf 'feat(studio/projects): export/import HTTP routes\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Client API helpers

**Files:**
- Modify: `studio/src/lib/api.ts`
- Test: `studio/__tests__/lib/api-bundle.test.ts` (new)

**Interfaces:**
- Produces on the `api` object:
  - `exportProject(slug: string): void` — triggers a browser download via `window.location.href = "/api/projects/<slug>/export"` (the verified host-independent pattern from `AssetsPanel.tsx:172`).
  - `importProject(file: File): Promise<Project>` — POSTs the file's bytes as the raw body with `Content-Type: application/octet-stream` and `X-Upload-Filename`, returns the created `Project`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/api-bundle.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../../src/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("api.importProject", () => {
  it("POSTs raw bytes and returns the project", async () => {
    const project = { slug: "x", name: "X (imported)" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(project), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "x.arcade");
    const out = await api.importProject(file);
    expect(out.slug).toBe("x");
    const [urlArg, init] = fetchMock.mock.calls[0];
    expect(urlArg).toBe("/api/projects/import");
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("api.exportProject", () => {
  it("navigates to the export URL", () => {
    const href = { value: "" };
    // jsdom: assigning window.location.href is a navigation; spy instead
    const spy = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, set href(v: string) { href.value = v; } } as any);
    api.exportProject("my-slug");
    expect(href.value).toBe("/api/projects/my-slug/export");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/api-bundle.test.ts`
Expected: FAIL — `exportProject`/`importProject` not on `api`.

- [ ] **Step 3: Write minimal implementation**

Add to the `api` object in `studio/src/lib/api.ts` (before the closing `}`):

```ts
  exportProject: (slug: string): void => {
    // Full-page navigation to the download URL — verified host-independent in
    // the packaged app (Electron ignores the <a download> attribute; see the
    // Assets panel export). The response's Content-Disposition drives the save.
    window.location.href = `/api/projects/${slug}/export`;
  },
  importProject: (file: File): Promise<Project> =>
    fetch("/api/projects/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Filename": encodeURIComponent(file.name),
      },
      body: file,
    }).then(j<Project>),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/api-bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/src/lib/api.ts studio/__tests__/lib/api-bundle.test.ts
git commit -m "$(printf 'feat(studio/projects): client export/import API helpers\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: UI — Export menu item + Import button + trust dialog

**Files:**
- Modify: `studio/src/components/shell/ProjectPicker.tsx` (add "Export project…" menu item)
- Modify: `studio/src/routes/HomePage.tsx` (import handler + hidden file input + trust dialog + refresh/navigate)
- Modify: `studio/src/components/home/HomeShelf.tsx` (render an "Import project" button in the toggle row via a new optional `onImport` prop)
- Test: `studio/__tests__/components/home-import.test.tsx` (new)

**Interfaces:**
- Consumes: `api.exportProject`, `api.importProject`; `useDialogs().confirm` (existing — check `src/components/feedback/Dialogs`); `useProjects().refresh`; `onOpen`.
- Produces: `HomeShelf` gains optional prop `onImport?: () => void`.

**NOTE on test mocks (per auto-memory `arcade-gen-mock-projectdetail-tests`):** `HomeShelf` imports `ToggleGroup` from `@xorkavi/arcade-gen`. Component tests that render it must mock `@xorkavi/arcade-gen` exporting `ToggleGroup` (with `.Root`/`.Item`). If a new arcade-gen import is added, update every mock and run the FULL suite.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/home-import.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomeShelf } from "../../src/components/home/HomeShelf";

vi.mock("@xorkavi/arcade-gen", () => ({
  ToggleGroup: {
    Root: ({ children }: any) => <div>{children}</div>,
    Item: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  },
}));

afterEach(() => vi.restoreAllMocks());

describe("HomeShelf import button", () => {
  it("renders an Import button and fires onImport when clicked", () => {
    const onImport = vi.fn();
    render(
      <HomeShelf projects={[]} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} onStartTemplate={() => {}} onImport={onImport} />,
    );
    fireEvent.click(screen.getByText(/import project/i));
    expect(onImport).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/home-import.test.tsx`
Expected: FAIL — no "Import project" button / `onImport` prop.

- [ ] **Step 3: Write minimal implementation**

`HomeShelf.tsx` — add the prop and render the button in the toggle row:

```tsx
export interface HomeShelfProps {
  projects: Project[];
  onOpen: (slug: string) => void;
  onRename: (p: Project) => void | Promise<void>;
  onDelete: (p: Project) => void | Promise<void>;
  onStartTemplate: (templateId: string) => void;
  onImport?: () => void;
}

export function HomeShelf({ projects, onOpen, onRename, onDelete, onStartTemplate, onImport }: HomeShelfProps) {
  // ...existing state/effects unchanged...
  return (
    <section>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <ToggleGroup.Root type="single" value={tab} onValueChange={(v: string) => { if (v === "projects" || v === "templates") setTab(v); }} style={{ fontSize: 16 }}>
          <ToggleGroup.Item value="projects" onClick={() => setTab("projects")} style={{ padding: "8px 16px", fontSize: 16, lineHeight: "24px" }}>My projects</ToggleGroup.Item>
          <ToggleGroup.Item value="templates" onClick={() => setTab("templates")} style={{ padding: "8px 16px", fontSize: 16, lineHeight: "24px" }}>Templates</ToggleGroup.Item>
        </ToggleGroup.Root>
        {onImport && (
          <button type="button" onClick={onImport}
            style={{ padding: "6px 12px", fontSize: 13, borderRadius: 6, border: "1px solid var(--stroke-neutral-subtle)", background: "transparent", color: "var(--fg-neutral-prominent)", cursor: "pointer" }}>
            Import project…
          </button>
        )}
      </div>
      {/* ...tab body unchanged... */}
    </section>
  );
}
```

`HomePage.tsx` — add a hidden file input + import handler and pass `onImport`; wire the trust confirm. Add near the other handlers:

```tsx
import { useRef } from "react";
import { useDialogs } from "../components/feedback/Dialogs";
// inside HomePage:
const fileRef = useRef<HTMLInputElement>(null);
const { confirm } = useDialogs();

async function handleImportClick() {
  const ok = await confirm({
    title: "Import a project?",
    body: "Only import .arcade files from people you trust. They contain code that runs on your machine.",
    confirmLabel: "Choose file…",
  });
  if (ok) fileRef.current?.click();
}

async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-picking the same file
  if (!file) return;
  try {
    const project = await api.importProject(file);
    void refresh();
    onOpen(project.slug);
  } catch (err) {
    toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), intent: "alert" });
  }
}
```

Render the input + pass the prop (inside the returned JSX):

```tsx
<input ref={fileRef} type="file" accept=".arcade" style={{ display: "none" }} onChange={handleFilePicked} />
<HomeShelf
  projects={projects}
  onOpen={onOpen}
  onRename={handleRename}
  onDelete={handleDelete}
  onStartTemplate={handleTemplateStart}
  onImport={handleImportClick}
/>
```

`ProjectPicker.tsx` — add an "Export project…" item right after the "Rename project…" button (line ~186), before the divider:

```tsx
<button
  type="button"
  role="menuitem"
  onClick={() => { setOpen(false); api.exportProject(project.slug); }}
  style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", fontSize: 13, background: "transparent", border: "none", borderRadius: 4, color: "var(--fg-neutral-prominent)", cursor: "pointer" }}
  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)"; }}
  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
>
  Export project…
</button>
```

Confirm the `useDialogs` API before writing `confirm(...)`: open `studio/src/components/feedback/Dialogs.tsx` and match the actual method name/signature (the codebase already exposes `promptText`; use the sibling confirm method — if it's named differently, e.g. `confirmAction`, use that name and its option keys).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/components/home-import.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/src/components/shell/ProjectPicker.tsx studio/src/routes/HomePage.tsx studio/src/components/home/HomeShelf.tsx studio/__tests__/components/home-import.test.tsx
git commit -m "$(printf 'feat(studio/projects): export menu item + import button with trust prompt\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Full-suite verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: PASS, no regressions. If any component test broke because `HomeShelf`/`ProjectPicker` gained imports, update its `@xorkavi/arcade-gen` mock (per auto-memory) and re-run.

- [ ] **Step 2: Manual smoke test (dev server)**

Run: `pnpm run studio`
Then:
1. Create a project, generate/add one frame, save one custom component and use it in a frame.
2. Project menu (`⋯` on the project name) → **Export project…** → confirm a `<slug>.arcade` file downloads.
3. Home → **Import project…** → accept the trust prompt → pick the file → confirm the project opens immediately, the frame renders, and the custom component resolves (no blank frame).
4. Import the same file again → confirm it appears as a second project named "… (imported)" and doesn't clobber the first or the original component.

- [ ] **Step 3: Final commit (only if smoke test surfaced fixes)**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add <explicit changed paths>
git commit -m "$(printf 'fix(studio/projects): smoke-test corrections for export/import\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:** bundle format → Task 3 (manifest) + Task 6 (format gate); clean project.json → Task 1; transitive deps → Task 2; drop seed frame → Task 3; export flow/route/download → Tasks 3,7,8; raw-body upload → Task 7; validate-before-promote ordering → Task 6; slug re-derivation + "(imported)" → Task 6; collision-safe component install + 4-part rename → Task 5; CLAUDE.md regeneration on import → Task 6 (`scaffoldProjectMeta`); symlink/hardlink rejection → Task 4; size/entry caps → Task 4; client refresh + navigate → Task 9; trust prompt → Task 9; tests enumerated in spec → Tasks 1-9 + Task 10 full suite. All covered.

**Placeholder scan:** no TBD/TODO; every code step shows real code. One deliberate verification instruction (confirm `useDialogs` confirm method name in Task 9) — flagged because the exact method name wasn't read; the implementer verifies against `Dialogs.tsx` rather than guessing.

**Type consistency:** `BundleManifest`/`ComponentManifestRow` defined in Task 1, used unchanged in Tasks 3,5,6. `resolveComponentDeps` returns `{names, missing}` (Task 2) consumed in Task 3. `packProject` returns `{filePath, warnings}` (Task 3) consumed in Task 7. `unpackAndInstall(bytes) → Project` (Task 6) consumed in Task 7. `api.importProject(file) → Project` (Task 8) consumed in Task 9. `COMPUTER_REFERENCE_SOURCE` export added in Task 3 and consumed there. Consistent throughout.
