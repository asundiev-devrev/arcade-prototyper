# Export / Import Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click Export (project → `.arcade` file) and Import (`.arcade` file → project appears immediately, components installed) to Arcade Studio.

**Architecture:** A new pure module `studio/server/projectBundle.ts` owns pack/unpack/validate/install logic (unit-testable, no HTTP). Two thin routes in the existing `studio/server/middleware/projects.ts` expose it: `GET /api/projects/:slug/export` (binary download) and `POST /api/projects/import` (raw-body upload, mirroring `uploadsMiddleware`). Client helpers in `src/lib/api.ts`; UI is an Export item in `ProjectPicker`'s menu and an Import button on the home screen. Bundle = gzipped tar via the OS `/usr/bin/tar`. All import validation happens in a temp dir outside `projects/`; the live tree is mutated only after every check passes.

**Tech Stack:** TypeScript, Node `fs/promises` + `child_process`, Vite middleware, React, Vitest. macOS-only app (bsdtar guaranteed present). No new npm dependencies.

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. Tests run via `pnpm run studio:test <path>` from the repo root (`/Users/andrey.sundiev/arcade-prototyper`), not from `studio/`.
- **No new npm dependency.** Tar via absolute `/usr/bin/tar`; upload via raw request body (the `uploadsMiddleware` pattern), never multipart.
- **Bundle format version is `1`.** `manifest.format` must equal `1`; import rejects any other value.
- **Server test files MUST start with `// @vitest-environment node` as line 1.** `studio/vitest.config.ts:24` sets `environment: "jsdom"` globally; `projectBundle.ts` transitively imports esbuild (via `componentStore` → `packFromSource` → `bundler`), which throws `Invariant violation … You cannot use esbuild in this environment` at import time under jsdom. Every existing bundler-touching test uses this pragma (`__tests__/server/component-store.test.ts:1`, `__tests__/sidecar/packFromSource.test.ts:1`). The component UI test (Task 9) stays jsdom (no pragma).
- **Saved component `.tsx` MUST have a default export.** The compile gate's entrypoint is `import Frame from ".../index.tsx"` (`server/cloudflare/bundler.ts:190`) — a default import. Any component source that flows through `saveComponentFile` (incl. all Task 5 test fixtures) needs `export default <Name>;`. See the working fixture at `__tests__/server/component-store.test.ts:18`.
- **Never `git add -A`/`git add .`** — stage explicit paths only.
- **Commit style:** `feat(studio/projects): ...`. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Component name rule:** `NAME_RE = /^[A-Z][A-Za-z0-9]{1,39}$/` (PascalCase, ≤40 chars). `componentStore.isValidComponentName` enforces it; call it before building any path from a bundle-supplied name (path-traversal guard).
- **Studio root override:** tests set `process.env.ARCADE_STUDIO_ROOT` to a temp dir and `process.env.HOME` to a temp fake home (see `__tests__/server/projects.test.ts:10-25`). Reuse that harness verbatim.
- **`arcade-user` rewrites are SPECIFIER-ONLY.** On a component collision we rewrite only the quoted module path `"arcade-user/<Old>"` → `"arcade-user/<New>"` (anchored regex `/["']arcade-user\/<Old>["']/g`). NEVER a bare-word identifier replace — module resolution keys on the file path, while the import binding + JSX tag key on the file's unchanged export name, so the specifier swap alone is sufficient and can't corrupt label text, comments, or unrelated identifiers.
- **`arcade-user` discovery match is exact:** `/from\s*["']arcade-user\/([A-Z][A-Za-z0-9]{1,39})["']/g` — never a substring test (else `Foo` matches `FooBar`).
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
// @vitest-environment node
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
  - `async function resolveComponentDeps(framesDir: string): Promise<{ names: string[]; missing: string[] }>` — scans every `.tsx`/`.ts` under `framesDir` for `arcade-user/<Name>` imports, then transitively scans each referenced composite file (`userKitCompositesDir()/<Name>.tsx`) for further `arcade-user/<Name>` imports until the set closes. `names` = referenced components that exist on disk (sorted, deduped); `missing` = referenced names with no file on disk (sorted, deduped). A visited-set guards against composite import cycles.

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
    writeComposite("PriceTag", `export function PriceTag() { return null; }\nexport default PriceTag;`);
    writeComposite("AppCard", `import { PriceTag } from "arcade-user/PriceTag";\nexport function AppCard() { return null; }\nexport default AppCard;`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { AppCard } from "arcade-user/AppCard";\nexport default function F() { return null; }`);

    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["AppCard", "PriceTag"]);
    expect(missing).toEqual([]);
  });

  it("terminates on a composite import cycle and collects both", async () => {
    writeComposite("A", `import { B } from "arcade-user/B";\nexport default function A(){return null;}`);
    writeComposite("B", `import { A } from "arcade-user/A";\nexport default function B(){return null;}`);
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { A } from "arcade-user/A";`);
    const { names } = await resolveComponentDeps(framesDir);
    expect(names).toEqual(["A", "B"]);
  });

  it("reports referenced-but-absent components as missing, not found", async () => {
    const framesDir = path.join(root, "proj", "frames");
    writeFrame(framesDir, "01-home", `import { Ghost } from "arcade-user/Ghost";`);
    const { names, missing } = await resolveComponentDeps(framesDir);
    expect(names).toEqual([]);
    expect(missing).toEqual(["Ghost"]);
  });

  it("does not match substrings (arcade-user/Foo vs FooBar)", async () => {
    writeComposite("FooBar", `export default function FooBar() { return null; }`);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): transitive component dep scan for bundling\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `runTar` + `packProject` (export core)

**Files:**
- Modify: `studio/server/projectBundle.ts`, `studio/server/projects.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Consumes: `projectDir`, `userKitCompositesDir`, `studioRoot` from `paths.ts`; `getProject`, `COMPUTER_REFERENCE_SLUG`, `COMPUTER_REFERENCE_SOURCE` from `projects.ts`; `listComponents` from `componentStore.ts`.
- **Prereq edit in `projects.ts`:** the reference-source string is currently a private `const COMPUTER_REFERENCE_SOURCE` at `projects.ts:163`. Add `export` to it. (`COMPUTER_REFERENCE_SLUG` at `:153` is already exported. No import cycle: `projects.ts` imports nothing from `projectBundle.ts`.)
- Produces:
  - `async function runTar(args: string[], cwd: string): Promise<void>` — spawns `/usr/bin/tar` with `args` in `cwd`; rejects on non-zero exit with stderr.
  - `async function packProject(slug: string): Promise<{ filePath: string; warnings: string[] }>` — builds `<studioRoot>/.bundle-tmp-XXXX/<slug>.arcade` and returns its path + warnings. Wrapped in try/finally-safe cleanup by its caller; on internal throw it removes its own temp dir. Caller deletes the temp dir after streaming.

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
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"),
      `import { Badge } from "arcade-user/Badge";\nexport default function F(){return null;}`);
    const cdir = path.join(root, "user-kit", "composites");
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, "Badge.tsx"), `export default function Badge(){return null;}`);
    // stuff that must NOT ship
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"secret":"nope"}]`);
    fs.mkdirSync(path.join(pdir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "memory", "LEARNED.md"), "private");

    const { filePath, warnings } = await packProject(proj.slug);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(warnings).toEqual([]);

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

In `studio/server/projects.ts`, add `export` to the reference-source const at line ~163:

```ts
export const COMPUTER_REFERENCE_SOURCE = `import * as React from "react";
// ...unchanged body...
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

function isLink(_p: string): boolean { return false; } // placeholder; see note

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
```

**Implementer note on `copyProjectSubtree` symlink filtering:** replace the `isLink` placeholder with a real check. `fs.cp`'s `filter` is sync and receives a source path; use `import { lstatSync } from "node:fs"` and return `false` when `lstatSync(s).isSymbolicLink()`. Wrap in try/catch returning `true` on stat failure. This drops nested symlinks under `frames/` during export so a valid project never yields a bundle the importer rejects.

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

### Task 4: Safe extraction — probe caps, link rejection, `extractBundle`

**Files:**
- Modify: `studio/server/projectBundle.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- Produces:
  - `const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;` and `const MAX_BUNDLE_ENTRIES = 5000;` (exported).
  - `async function probeBundle(archive: string): Promise<{ entries: number; bytes: number }>` — runs `/usr/bin/tar -tzvf <archive>` (lists WITHOUT extracting to disk), parses the size column of each line, and returns entry count + summed uncompressed bytes. This is the disk-fill-bomb guard: it never writes payload to disk.
  - `async function assertNoLinks(dir: string): Promise<void>` — walks `dir`; throws `Error("Bundle contains a symbolic or hard link; refusing to import.")` if any entry is a symlink (`lstat().isSymbolicLink()`) or a regular file with `nlink > 1`.
  - `async function extractBundle(bytes: Buffer): Promise<string>` — ensures `studioRoot()` exists, `mkdtemp`s a `.import-tmp-` dir under it, writes the archive, **`probeBundle` and reject if over `MAX_BUNDLE_BYTES`/`MAX_BUNDLE_ENTRIES` BEFORE extracting**, then `tar xzf` into the dir, then `assertNoLinks`. Returns the temp dir path. On any failure, `rm -rf`s the temp dir and rethrows.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { assertNoLinks, extractBundle, probeBundle } from "../../server/projectBundle";

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

  it("probeBundle sums entries + uncompressed bytes without extracting", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "probe-src-"));
    fs.writeFileSync(path.join(src, "a.txt"), "x".repeat(1000));
    fs.writeFileSync(path.join(src, "b.txt"), "y".repeat(2000));
    const arc = path.join(src, "p.arcade");
    execFileSync("/usr/bin/tar", ["czf", arc, "-C", src, "a.txt", "b.txt"]);
    const { entries, bytes } = await probeBundle(arc);
    expect(entries).toBeGreaterThanOrEqual(2);
    expect(bytes).toBeGreaterThanOrEqual(3000);
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("extractBundle unpacks a real packed bundle", async () => {
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): safe bundle extraction (probe caps + link rejection)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Collision-safe component install (specifier-only rename)

**Files:**
- Modify: `studio/server/projectBundle.ts`, `studio/server/componentStore.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Design (why this is safe + order-independent):**
- Components are written to `userKitCompositesDir()` **all at once, before any compile validation**, so the compile order of transitive deps (AppCard→PriceTag) never matters — every `arcade-user/<dep>` resolves once the whole set is on disk.
- Because they were already compile-gated when the exporter saved them, a bundle install uses a **raw writer** (`writeComponentRaw`) that validates the name against `NAME_RE` (path-traversal guard) and merges the manifest row, but does NOT re-run the per-file compile gate. This is what removes the ordering blocker.
- Collision handling is **specifier-only**: same name + identical bytes → skip; same name + different bytes → write the bundled file under a fresh filename `<Name>Imported[N]` and rewrite only the quoted module path `"arcade-user/<Name>"` → `"arcade-user/<New>"` in (a) frame files and (b) any OTHER bundled composite that imports it. The import binding, JSX tag, and the file's own export are left untouched — a named import resolves by the file's unchanged export name, so nothing breaks and no bare-word text is ever mangled.

**Interfaces:**
- Consumes: `componentExists`, `isValidComponentName`, `writeComponentRaw` (new, below) from `componentStore.ts`; `userKitCompositesDir` from `paths.ts`.
- **Prereq edit in `componentStore.ts`** — add a raw writer that skips the compile gate (used only for already-gated bundle installs):

```ts
// componentStore.ts — new export
/**
 * Write a component file + manifest row WITHOUT the compile gate. For bundle
 * imports only: the components were compile-gated when the exporter saved them,
 * and the whole dependency set is written together, so gating each file mid-
 * install (before its arcade-user deps land) would spuriously fail. Still
 * validates the name so a hostile bundle can't traverse out of the composites
 * dir. Last-write-wins on the manifest row (matches saveComponentFile).
 */
export async function writeComponentRaw(args: {
  name: string; description: string; tsx: string; origin: string; createdAt: string;
}): Promise<void> {
  if (!isValidComponentName(args.name)) {
    throw new ComponentCompileError(`Invalid component name: ${args.name}`);
  }
  await fs.mkdir(userKitCompositesDir(), { recursive: true });
  await fs.writeFile(path.join(userKitCompositesDir(), `${args.name}.tsx`), args.tsx, "utf-8");
  const entries = await readManifest();
  const next = entries.filter((e) => e.name !== args.name);
  next.push({ name: args.name, description: args.description, createdAt: args.createdAt, origin: args.origin });
  await writeManifest(next);
}
```

- Produces (in `projectBundle.ts`):
  - `async function uniqueComponentName(base: string, taken: Set<string>): Promise<string>` — returns a valid `NAME_RE` name not in the recipient's kit nor in `taken`, trying `<base>Imported`, `<base>Imported2`, …; truncates `base` so the result stays ≤40 chars.
  - `function rewriteSpecifier(src: string, oldName: string, newName: string): string` — replaces the quoted module path only, via `/(["'])arcade-user\/<oldName>\1/g`.
  - `async function installBundledComponents(compDir: string, rows: ComponentManifestRow[], framesRoot: string): Promise<void>` — the two-phase installer described above.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { installBundledComponents, uniqueComponentName, rewriteSpecifier } from "../../server/projectBundle";
import { componentExists, writeComponentRaw } from "../../server/componentStore";

describe("component install (specifier-only, order-independent)", () => {
  it("installs a brand-new component", async () => {
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-"));
    fs.writeFileSync(path.join(compDir, "Fresh.tsx"), `export default function Fresh(){return null;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
    await installBundledComponents(compDir, [{ name: "Fresh", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Fresh")).toBe(true);
  });

  it("installs transitive deps regardless of alphabetical order (AppCard before PriceTag)", async () => {
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-t-"));
    fs.writeFileSync(path.join(compDir, "AppCard.tsx"), `import { PriceTag } from "arcade-user/PriceTag";\nexport default function AppCard(){return null;}`);
    fs.writeFileSync(path.join(compDir, "PriceTag.tsx"), `export default function PriceTag(){return null;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames-t-"));
    // rows sorted alphabetically, AppCard first — must NOT fail
    await installBundledComponents(compDir, [
      { name: "AppCard", description: "", origin: "imported", createdAt: "t" },
      { name: "PriceTag", description: "", origin: "imported", createdAt: "t" },
    ], framesRoot);
    expect(await componentExists("AppCard")).toBe(true);
    expect(await componentExists("PriceTag")).toBe(true);
  });

  it("renames on same-name-different-content via SPECIFIER ONLY; labels/comments untouched", async () => {
    await writeComponentRaw({ name: "Button", description: "mine", tsx: `export default function Button(){return <div>MINE</div>;}`, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp2-"));
    fs.writeFileSync(path.join(compDir, "Button.tsx"), `export default function Button(){return <div>THEIRS</div>;}`);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames2-"));
    fs.mkdirSync(path.join(framesRoot, "01-home"), { recursive: true });
    fs.writeFileSync(path.join(framesRoot, "01-home", "index.tsx"),
      `import { Button } from "arcade-user/Button";\n// The Button below is primary\nexport default function F(){return <Button aria-label="Button">Button</Button>;}`);

    await installBundledComponents(compDir, [{ name: "Button", description: "d", origin: "imported", createdAt: "t" }], framesRoot);

    expect(await componentExists("ButtonImported")).toBe(true);
    const frame = fs.readFileSync(path.join(framesRoot, "01-home", "index.tsx"), "utf-8");
    // specifier rewritten:
    expect(frame).toContain(`from "arcade-user/ButtonImported"`);
    // binding + JSX + comment + label text UNCHANGED (no corruption):
    expect(frame).toContain(`import { Button }`);
    expect(frame).toContain(`<Button aria-label="Button">Button</Button>`);
    expect(frame).toContain(`// The Button below is primary`);
  });

  it("skips identical same-name components", async () => {
    const tsx = `export default function Same(){return null;}`;
    await writeComponentRaw({ name: "Same", description: "d", tsx, origin: "saved", createdAt: "t" });
    const compDir = fs.mkdtempSync(path.join(os.tmpdir(), "comp3-"));
    fs.writeFileSync(path.join(compDir, "Same.tsx"), tsx);
    const framesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frames3-"));
    await installBundledComponents(compDir, [{ name: "Same", description: "d", origin: "imported", createdAt: "t" }], framesRoot);
    expect(await componentExists("Same")).toBe(true);
  });

  it("uniqueComponentName truncates long bases to stay <=40 chars", async () => {
    const long = "A".repeat(38);
    const out = await uniqueComponentName(long, new Set());
    expect(out.length).toBeLessThanOrEqual(40);
    expect(/^[A-Z][A-Za-z0-9]{1,39}$/.test(out)).toBe(true);
  });

  it("rewriteSpecifier does not touch arcade-user/FooBar when renaming Foo", () => {
    const src = `import { Foo } from "arcade-user/Foo";\nimport { FooBar } from "arcade-user/FooBar";`;
    const out = rewriteSpecifier(src, "Foo", "FooImported");
    expect(out).toContain(`"arcade-user/FooImported"`);
    expect(out).toContain(`"arcade-user/FooBar"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: FAIL — install helpers / `writeComponentRaw` not exported.

- [ ] **Step 3: Write minimal implementation**

Add `writeComponentRaw` to `componentStore.ts` (shown in Interfaces above). Then in `projectBundle.ts`:

```ts
import { componentExists, isValidComponentName, writeComponentRaw } from "./componentStore";

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

  // Phase C: write all files at once (deps now all resolvable), merge manifest.
  for (const p of plan) {
    await writeComponentRaw({
      name: p.name, description: p.row.description, tsx: p.tsx,
      origin: "imported", createdAt: p.row.createdAt,
    });
  }

  // Phase D: rewrite frame specifiers for every renamed component.
  for (const [oldName, newName] of renames) {
    await rewriteFrameSpecifiers(oldName, newName, framesRoot);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/server/componentStore.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): order-independent, specifier-only component install\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `unpackAndInstall` orchestrator + import-side scaffolding

**Files:**
- Modify: `studio/server/projectBundle.ts`, `studio/server/projects.ts`
- Test: `studio/__tests__/server/projectBundle.test.ts`

**Interfaces:**
- **Prereq edits in `projects.ts`** — export a scaffolder and a slug helper. `scaffoldComputerReferenceFrame` is currently a private function at `projects.ts:175`; add `export` to it so import can recreate the seed frame the shipped CLAUDE.md tells the generator to read.

```ts
// projects.ts
export async function importSlug(name: string): Promise<string> {
  return uniqueSlug(slugify(name));
}

/**
 * Recipient-side scaffolding for an already-on-disk imported project: write
 * CLAUDE.md with THIS machine's paths (import ships none — it hardcodes the
 * exporter's paths), backfill memory stubs + the DevRev API reference, and
 * recreate the seeded Computer reference frame (dropped at export; CLAUDE.md
 * instructs the generator to Read it). Mirrors createProject's scaffolding,
 * minus the directory bootstrap.
 */
export async function scaffoldImportedProject(slug: string): Promise<void> {
  const p = await getProject(slug);
  if (!p) throw new Error(`Project not found: ${slug}`);
  const tpl = await readTemplate();
  await fs.writeFile(path.join(projectDir(slug), "CLAUDE.md"), renderTemplate(tpl, {
    PROJECT_NAME: p.name, THEME: p.theme,
    ARCADE: ARCADE_GEN_ROOT, PROTOTYPER: PROTOTYPER_ROOT, GLOBAL_MEMORY: globalMemoryDir(),
  }));
  await ensureMemoryStubs(projectMemoryDir(slug), "this project");
  await scaffoldDevRevApiReference(slug);
  await scaffoldComputerReferenceFrame(projectDir(slug)); // now exported
}
```

Also add `export` to `scaffoldComputerReferenceFrame` at `projects.ts:175`.

- Produces (in `projectBundle.ts`):
  - `async function unpackAndInstall(bytes: Buffer): Promise<Project>` — extract (Task 4) → read+validate `manifest.json` (`format===1`) → parse `project/project.json` against `projectSchema` → derive install slug via `importSlug(manifest.name)`; if slug ≠ original, set `name = "<name> (imported)"` → install components (Task 5) into the staged `project/frames` tree → write cleaned+re-slugged `project.json` → move staged `project/` into `projectDir(slug)` → `scaffoldImportedProject(slug)` → `reconcileFrames(slug)` → `clearAllProjectSessions()` (so other projects' cached system prompts pick up newly-installed kit components) → return the project. `finally` removes the temp dir.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/projectBundle.test.ts
import { unpackAndInstall } from "../../server/projectBundle";
import { listProjects } from "../../server/projects";

describe("unpackAndInstall (round-trip)", () => {
  it("imports a packed bundle into a clean root with recipient paths + seed frame", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-a-"));
    const proj = await createProject({ name: "Trip", theme: "devrev-app", mode: "dark" });
    const pdir = path.join(root, "projects", proj.slug);
    fs.mkdirSync(path.join(pdir, "frames", "01-home"), { recursive: true });
    fs.writeFileSync(path.join(pdir, "frames", "01-home", "index.tsx"), `export default function F(){return null;}`);
    fs.writeFileSync(path.join(pdir, "chat-history.json"), `[{"x":1}]`);
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);

    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-b-"));
    process.env.ARCADE_STUDIO_ROOT = rootB;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-b-"));

    const imported = await unpackAndInstall(bytes);
    expect(imported.theme).toBe("devrev-app");
    expect(imported.mode).toBe("dark");
    const idir = path.join(rootB, "projects", imported.slug);
    expect(fs.existsSync(path.join(idir, "project.json"))).toBe(true);        // folder===slug
    expect(fs.existsSync(path.join(idir, "chat-history.json"))).toBe(false);  // excluded
    expect(fs.existsSync(path.join(idir, "CLAUDE.md"))).toBe(true);           // regenerated
    expect(fs.existsSync(path.join(idir, "frames", "01-home", "index.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(idir, "frames", "00-computer-reference", "index.tsx"))).toBe(true); // seed recreated
    expect((await listProjects()).some((p) => p.slug === imported.slug)).toBe(true);

    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("re-slugs and marks name on collision", async () => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "home-c-"));
    const proj = await createProject({ name: "Dup", theme: "arcade", mode: "light" });
    const { filePath } = await packProject(proj.slug);
    const bytes = fs.readFileSync(filePath);
    const imported = await unpackAndInstall(bytes); // same root — collides
    expect(imported.slug).not.toBe(proj.slug);
    expect(imported.name).toMatch(/\(imported\)/);
  });

  it("rejects a bundle with a bad format", async () => {
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
Expected: FAIL — `unpackAndInstall`/`scaffoldImportedProject`/`importSlug` not exported.

- [ ] **Step 3: Write minimal implementation**

Add `importSlug`, `scaffoldImportedProject`, and `export` on `scaffoldComputerReferenceFrame` to `projects.ts` (shown in Interfaces). Then in `projectBundle.ts`:

```ts
import { projectsRoot } from "./paths";
import { projectSchema, type Project } from "./types";
import {
  getProject, reconcileFrames, importSlug, scaffoldImportedProject, clearAllProjectSessions,
} from "./projects";

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
```

`clearAllProjectSessions` is already exported (`projects.ts:433`). Ensure it and `reconcileFrames`/`getProject` are all in the single import from `./projects`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/projectBundle.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/projectBundle.ts studio/server/projects.ts studio/__tests__/server/projectBundle.test.ts
git commit -m "$(printf 'feat(studio/projects): unpackAndInstall import pipeline + recipient scaffolding\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: HTTP routes — export (GET) + import (POST raw body)

**Files:**
- Modify: `studio/server/middleware/projects.ts`
- Test: `studio/__tests__/server/middleware/projects-bundle.test.ts` (new)

**Interfaces:**
- Consumes: `packProject`, `unpackAndInstall`, `MAX_BUNDLE_BYTES` from `../projectBundle`.
- Produces:
  - `GET /api/projects/:slug/export` → `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<slug>.arcade"`, streams the packed file, then deletes its temp dir. Missing project → 404 JSON.
  - `POST /api/projects/import` → raw body with a `MAX_BUNDLE_BYTES` cap + drain-on-overflow (the `uploadsMiddleware` pattern), calls `unpackAndInstall`, returns `201` + the `Project` JSON. Validation failures → `422`; oversize → `413`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/middleware/projects-bundle.test.ts
// @vitest-environment node
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
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf,
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
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from("not a tar"),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/middleware/projects-bundle.test.ts`
Expected: FAIL — routes not present.

- [ ] **Step 3: Write minimal implementation**

At the top of `studio/server/middleware/projects.ts`, **add both imports** (the file currently imports neither `path` nor `fs/promises` — it imports `fs` differently; verify and add):

```ts
import path from "node:path";
import fsp from "node:fs/promises";
import { packProject, unpackAndInstall, MAX_BUNDLE_BYTES } from "../projectBundle";
```

Inside `projectsMiddleware`'s handler, add these **before** the generic `/api/projects` GET/POST block at `projects.ts:167` (so `rest="export"` / `slug="import"` don't fall through to it):

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
  - `exportProject(slug: string): void` — `window.location.href = "/api/projects/<slug>/export"` (the verified host-independent download pattern, `AssetsPanel.tsx:172`).
  - `importProject(file: File): Promise<Project>` — POSTs the file bytes as the raw body with `Content-Type: application/octet-stream` + `X-Upload-Filename`, returns the created `Project`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/api-bundle.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../../src/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("api.importProject", () => {
  it("POSTs raw bytes to the import route and returns the project", async () => {
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
    // Robust in jsdom: redefine location with a capturing href setter.
    const captured: { href?: string } = {};
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { captured.href = v; }, get href() { return captured.href ?? ""; } },
    });
    api.exportProject("my-slug");
    expect(captured.href).toBe("/api/projects/my-slug/export");
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
- Modify: `studio/src/components/home/HomeShelf.tsx` (render an "Import project" button via a new optional `onImport` prop)
- Test: `studio/__tests__/components/home-import.test.tsx` (new)

**Interfaces:**
- `HomeShelf` gains optional prop `onImport?: () => void`.

**Context that MUST be respected (verified against the files):**
- `HomePage.tsx:1` imports `import { useState } from "react"` — extend to `{ useState, useRef }`, do NOT add a second react import.
- `HomePage.tsx:11` already imports `useDialogs`; `HomePage.tsx:17` already destructures `const { confirm, promptText } = useDialogs();` — REUSE the existing `confirm`, do NOT re-import or re-declare it.
- `useDialogs().confirm` options are `{ title, description?, confirmLabel?, cancelLabel?, destructive? }` (`Dialogs.tsx:27`). The warning text field is **`description`**, NOT `body`.
- Test mocks (auto-memory `arcade-gen-mock-projectdetail-tests`): `HomeShelf` imports `ToggleGroup` from `@xorkavi/arcade-gen`; the test mocks it. If any new arcade-gen import is added elsewhere, update every mock and run the FULL suite.

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

`HomeShelf.tsx` — add the prop + button in the toggle row:

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

`HomePage.tsx` — extend the react import, add a ref + handlers, reuse the existing `confirm`:

```tsx
// line 1: change to
import { useState, useRef } from "react";
// (useDialogs + confirm already imported/destructured at lines 11 & 17 — do not re-add)

// inside HomePage, alongside the other handlers:
const fileRef = useRef<HTMLInputElement>(null);

async function handleImportClick() {
  const ok = await confirm({
    title: "Import a project?",
    description: "Only import .arcade files from people you trust. They contain code that runs on your machine.",
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

Render the input + pass the prop in the returned JSX (inside the scroll container, near `<HomeShelf …>`):

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

`ProjectPicker.tsx` — add an "Export project…" item right after the "Rename project…" button (~line 186), before the divider:

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
Expected: PASS, no regressions. If a component test broke because `HomeShelf`/`ProjectPicker` gained imports, update its `@xorkavi/arcade-gen` mock (auto-memory) and re-run.

- [ ] **Step 2: Manual smoke test (dev server)**

Run: `pnpm run studio`
1. Create a project, add a frame, save a custom component, use it in a frame.
2. Project menu (`⋯`) → **Export project…** → confirm a `<slug>.arcade` downloads.
3. Home → **Import project…** → accept the trust prompt → pick the file → confirm the project opens, the frame renders, the custom component resolves (no blank frame), and `frames/00-computer-reference/` exists.
4. Import the same file again → confirm a second project named "… (imported)" that doesn't clobber the first or the original component.

- [ ] **Step 3: Final commit (only if smoke test surfaced fixes)**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add <explicit changed paths>
git commit -m "$(printf 'fix(studio/projects): smoke-test corrections for export/import\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Known limitations (documented, out of scope)

- **Foreign-code isolation.** Imported `.tsx` renders in a same-origin, unsandboxed iframe; `/api/chat` runs `claude` with Bash. A malicious bundle is credential-theft + RCE. Mitigated only by the trust prompt (internal-only tool). Iframe sandboxing / endpoint token-gating is a separate architectural change.
- **Renamed-component generator visibility.** On a same-name-different-content collision the component installs under `<Name>Imported` (filename/manifest) while its internal export keeps the original name. Existing imported frames work (named import resolves by export name via the rewritten specifier). The generator's user-kit addendum, which suggests `import { <Name>Imported } from "arcade-user/<Name>Imported"`, would be wrong for NEW frames using that renamed component — a rare edge, degradation not crash.
- **Pasted images don't travel.** `_uploads/` is excluded and frame sources embed absolute `/@fs` paths that are invalid on the recipient. Frames using pasted images render broken on import. Future: rewrite `_uploads` refs to bundled relative assets, or warn on export.

## Self-Review

**Spec coverage:** every spec section maps to a task (bundle format → 1/3/6; clean project.json → 1; transitive deps → 2; drop+recreate seed frame → 3/6; export flow/route/download → 3/7/8; raw-body upload → 7; validate-before-promote → 6; slug re-derivation + "(imported)" → 6; collision-safe install → 5; CLAUDE.md regeneration → 6; symlink/hardlink rejection → 4; size/entry caps via pre-extract probe → 4; client refresh+navigate → 9; trust prompt → 9). All covered.

**Review fixes folded in:** node pragma on both server test files (Constraints + Tasks 1/7); default exports in every fixture (Constraints + Tasks 2/3/5); compile-order blocker → write-all-first via `writeComponentRaw` (Task 5); rename-corruption → specifier-only rewrite (Task 5 + Constraints); `clearAllProjectSessions` after install (Task 6); `mkdir(studioRoot)` before `mkdtemp` in pack + extract (Tasks 3/4); recreate seed frame on import (Task 6); decompression-bomb cap moved BEFORE extraction via `probeBundle` (Task 4); `packProject` try/finally cleanup (Task 3); export-side nested-symlink filtering (Task 3); `path`+`fsp` imports in middleware (Task 7); reuse existing `confirm`, `useState,useRef`, `description` not `body` (Task 9).

**Type consistency:** `BundleManifest`/`ComponentManifestRow` (Task 1) used unchanged in 3/5/6. `resolveComponentDeps → {names,missing}` (2) consumed in 3. `packProject → {filePath,warnings}` (3) consumed in 7. `unpackAndInstall(bytes)→Project` (6) consumed in 7. `installBundledComponents(compDir,rows,framesRoot)` (5) consumed in 6. `writeComponentRaw` (componentStore, Task 5) consumed in 5. `importSlug`/`scaffoldImportedProject` (projects, Task 6) consumed in 6. Consistent throughout.
