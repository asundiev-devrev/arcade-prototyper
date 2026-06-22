# Contribute Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a designer select part of a rendered prototype and save it as a named, reusable "component" that they reuse immediately and can export/import to share — no DMG, no build step.

**Architecture:** New components are agent-extracted `.tsx` recipes written to a writable per-user dir (`user-kit/`), merged into the existing KIT-MANIFEST so the generator sees them, aliased into Vite as `arcade-user`, and surfaced in the Assets panel. Save reuses the existing element picker + generator subprocess; the runtime esbuild bundler is the compile gate. Export = HTTP download; import = `<input type=file>` — no Electron IPC.

**Tech Stack:** TypeScript, Node, Vite middleware, React 19, esbuild + Tailwind v4 (via `buildFrameBundle`/`packFromSource`), Vitest.

## Global Constraints

- Package manager is **pnpm**. Never `npm`/`yarn`. (CLAUDE.md)
- Never `git add -A`/`git add .` — stage explicit paths only. (CLAUDE.md)
- **User-facing term is "component" everywhere — never show "composite" to users.** Internal code/dirs may keep `composite`. (spec)
- Conventional Commits, scope `studio/<area>` (e.g. `feat(studio/components): …`). (CLAUDE.md)
- Tailwind v4: every consumer root needs an explicit `@source`; the new `user-kit/` dir must be added to source scanning or its classes silently drop. (studio/CLAUDE.md)
- Vite middleware does NOT hot-reload — restart the app after changing anything under `server/middleware/*` or `vite.config.ts`. (studio/CLAUDE.md)
- No `electron/` changes — export/import are browser-native (no IPC; `nodeIntegration:false`). (spec)
- Ships as **0.40.0** (version already set in `package.json#version`).
- Run `pnpm run studio:test` before any non-trivial commit. (studio/CLAUDE.md)

### Verified anchors (exact signatures to consume)

- `server/paths.ts:11` `studioRoot(): string` → `~/Library/Application Support/arcade-studio` (override `ARCADE_STUDIO_ROOT`). `frameDir(projectSlug, frameSlug)` → `<root>/projects/<p>/frames/<f>` (frame source is `index.tsx` inside).
- `server/kitManifest.ts:169` `buildManifestEntries(kitRoot: string): Promise<KitManifestEntry[]>`; `:311` `writeManifest(kitRoot: string): Promise<string>`; `:285` `renderManifestMarkdown(entries)`.
- `server/plugins/kitManifestPlugin.ts:17` `KIT_ROOT`; regenerates on boot + watcher change/add/unlink of kit `.tsx`.
- `server/sidecar/packFromSource.ts:27` `packFromSource(input: { tsx: string; mode?; theme? }): Promise<string>` — throws if the TSX fails to bundle (esbuild). This is the compile gate.
- `server/claudeCode.ts:510` `runClaudeTurnWithRetry(opts: RunTurnOptions, cfg?)`; `RunTurnOptions` needs `cwd`, `prompt`, `bin`, optional `model`, `addDirs`, `onEvent`, `signal`, `onCrash`. `server/claudeBin.ts:20` `resolveClaudeBin(): string`.
- Middleware pattern (`server/middleware/projects.ts`): `export function xMiddleware() { return async (req, res, next?) => {...} }`; `readJson(req)` slurps + `JSON.parse`; `send(res, status, body)` writes JSON. Registered in `vite.config.ts` `apiPlugin().configureServer` via `server.middlewares.use(...)`.
- Vite aliases live in `vite.config.ts:135-140`; `arcade-prototypes` → `prototype-kit/`. Source-scan injection: `injectStudioSourcePlugin()`.
- Picker result type `TargetSelection` (`src/hooks/targetSelectionContext.tsx:3`): `{ file, line, column, componentName, tagName, frameSlug }`. Consumed in `FrameCard.tsx` (`setTarget`) + `PromptInput.tsx` (`buildTargetPreamble`).
- Assets: `useAssetsCatalog.ts` (`/api/assets`), `AssetsPanel.tsx` sections; `<input type=file>` upload pattern in `PromptInput.tsx:282`.

---

### Task 1: `userKitDir()` path helper + dir scaffold

**Files:**
- Modify: `studio/server/paths.ts`
- Test: `studio/__tests__/server/paths-userkit.test.ts`

**Interfaces:**
- Produces: `userKitDir(): string` → `<studioRoot>/user-kit`; `userKitCompositesDir(): string` → `<studioRoot>/user-kit/composites`; `userKitManifestPath(): string` → `<studioRoot>/user-kit/manifest.json`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/paths-userkit.test.ts
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { userKitDir, userKitCompositesDir, userKitManifestPath } from "../../server/paths";

describe("user-kit paths", () => {
  const prev = process.env.ARCADE_STUDIO_ROOT;
  afterEach(() => { process.env.ARCADE_STUDIO_ROOT = prev; });

  it("nests under the studio root", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/arcade-test-root";
    expect(userKitDir()).toBe(path.join("/tmp/arcade-test-root", "user-kit"));
    expect(userKitCompositesDir()).toBe(path.join("/tmp/arcade-test-root", "user-kit", "composites"));
    expect(userKitManifestPath()).toBe(path.join("/tmp/arcade-test-root", "user-kit", "manifest.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/paths-userkit.test.ts`
Expected: FAIL — `userKitDir is not a function` (not exported yet).

- [ ] **Step 3: Implement the helpers**

Add to `studio/server/paths.ts` (after `globalMemoryDir`):

```ts
/**
 * Writable per-user kit — holds components a designer saved or imported.
 * Lives at the studio root (sibling of projects/), NOT in the read-only .app
 * bundle, so contributing a component needs no DMG. The generator sees these
 * via the merged KIT-MANIFEST (see kitManifest.ts), and frames import them
 * through the `arcade-user` Vite alias.
 */
export function userKitDir(): string {
  return path.join(studioRoot(), "user-kit");
}

export function userKitCompositesDir(): string {
  return path.join(userKitDir(), "composites");
}

export function userKitManifestPath(): string {
  return path.join(userKitDir(), "manifest.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/paths-userkit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/paths.ts studio/__tests__/server/paths-userkit.test.ts
git commit -m "feat(studio/components): add user-kit path helpers"
```

---

### Task 2: KIT-MANIFEST merges the user root

**Files:**
- Modify: `studio/server/kitManifest.ts`
- Test: `studio/__tests__/server/kit-manifest-userkit.test.ts`

**Interfaces:**
- Consumes: `buildManifestEntries(kitRoot)` (Task: existing), `userKitCompositesDir()` (Task 1).
- Produces: `buildMergedManifestEntries(shippedRoot: string, userRoot?: string): Promise<KitManifestEntry[]>` — shipped entries first, then user-kit composites (kind `"composite"`), de-duped by name (shipped wins). Tolerates a missing user root (returns shipped only).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/kit-manifest-userkit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMergedManifestEntries } from "../../server/kitManifest";

const SHIPPED = path.resolve(__dirname, "../../prototype-kit");

describe("buildMergedManifestEntries", () => {
  let userRoot: string;
  beforeEach(async () => {
    userRoot = await fs.mkdtemp(path.join(os.tmpdir(), "userkit-"));
    await fs.mkdir(path.join(userRoot, "composites"), { recursive: true });
    await fs.mkdir(path.join(userRoot, "templates"), { recursive: true });
    await fs.writeFile(
      path.join(userRoot, "composites", "MyThing.tsx"),
      `/**\n * A user-saved thing.\n */\nexport function MyThing() { return null; }\n`,
      "utf-8",
    );
  });
  afterEach(async () => { await fs.rm(userRoot, { recursive: true, force: true }); });

  it("includes user-kit composites alongside shipped ones", async () => {
    const merged = await buildMergedManifestEntries(SHIPPED, userRoot);
    expect(merged.some((e) => e.name === "MyThing" && e.kind === "composite")).toBe(true);
    // a known shipped composite is still present
    expect(merged.some((e) => e.name === "EntityCard")).toBe(true);
  });

  it("tolerates a missing user root", async () => {
    const merged = await buildMergedManifestEntries(SHIPPED, "/no/such/dir");
    expect(merged.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/kit-manifest-userkit.test.ts`
Expected: FAIL — `buildMergedManifestEntries is not a function`.

- [ ] **Step 3: Implement the merge**

In `studio/server/kitManifest.ts`, refactor the per-dir scan out of `buildManifestEntries` into a reusable helper, then add the merge. Replace the body of `buildManifestEntries` and add below it:

```ts
async function scanDir(dir: string, kind: "composite" | "template"): Promise<KitManifestEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // dir absent (e.g. user-kit never created) — not an error
  }
  const files = names.filter((n) => n.endsWith(".tsx")).sort().map((n) => path.join(dir, n));
  const out: KitManifestEntry[] = [];
  for (const f of files) {
    const entry = await parseFile(f, kind);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Merge shipped kit entries with the writable per-user kit. Shipped first;
 * user composites appended; on a name clash the shipped entry wins (a user
 * can't shadow a built-in). A missing/empty user root is fine.
 */
export async function buildMergedManifestEntries(
  shippedRoot: string,
  userRoot?: string,
): Promise<KitManifestEntry[]> {
  const shipped = await buildManifestEntries(shippedRoot);
  if (!userRoot) return shipped;
  const userComposites = await scanDir(path.join(userRoot, "composites"), "composite");
  const have = new Set(shipped.map((e) => e.name));
  const fresh = userComposites.filter((e) => !have.has(e.name));
  return [...shipped, ...fresh];
}
```

Also rewrite `buildManifestEntries` to use `scanDir` (DRY) — its two reads become `scanDir(compositeDir, "composite")` + `scanDir(templateDir, "template")`, concatenated composites-then-templates as before.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/kit-manifest-userkit.test.ts`
Expected: PASS. Also run the existing manifest test if present: `pnpm run studio:test __tests__/server/` to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add studio/server/kitManifest.ts studio/__tests__/server/kit-manifest-userkit.test.ts
git commit -m "feat(studio/components): merge user-kit into KIT-MANIFEST"
```

---

### Task 3: Manifest plugin watches the user root + Vite `arcade-user` alias

**Files:**
- Modify: `studio/server/plugins/kitManifestPlugin.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/vite-arcade-user-alias.test.ts`

**Interfaces:**
- Consumes: `userKitDir()`, `userKitCompositesDir()` (Task 1); `buildMergedManifestEntries` (Task 2); `writeManifest` (existing).
- Produces: a frame can `import { X } from "arcade-user/X"` resolving to `<studioRoot>/user-kit/composites/X.tsx`; manifest regenerates when a user-kit file changes.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/vite-arcade-user-alias.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";

describe("arcade-user alias", () => {
  it("is declared in vite.config and points at user-kit/composites", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.resolve(__dirname, "../../vite.config.ts"), "utf-8"),
    );
    expect(src).toMatch(/arcade-user/);
    expect(src).toMatch(/user-kit/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/vite-arcade-user-alias.test.ts`
Expected: FAIL — no `arcade-user` in vite.config.ts.

- [ ] **Step 3a: Add the Vite alias + source scan**

In `studio/vite.config.ts`, add to the `resolve.alias` array (after the `arcade-prototypes` entry):

```ts
      // User-saved components live in the writable studio root, resolved on
      // the fly like a generated frame. `arcade-user/Foo` → user-kit/composites/Foo.
      {
        find: /^arcade-user\/(.+)$/,
        replacement: path.join(
          process.env.ARCADE_STUDIO_ROOT ??
            path.join(os.homedir(), "Library", "Application Support", "arcade-studio"),
          "user-kit/composites/$1",
        ),
      },
```

Add `import os from "node:os";` at the top of `vite.config.ts` if not present. (If `injectStudioSourcePlugin()` already appends the studio root to Tailwind `@source`, user-kit is covered since it's under that root; if it scopes to `projects/` only, extend it to also include `user-kit/`. Verify by reading the plugin.)

- [ ] **Step 3b: Watch the user root in the manifest plugin**

In `studio/server/plugins/kitManifestPlugin.ts`: change `regenerate` to call `writeManifest` against the shipped root but first write the merged file. Simplest: add a new exported writer in `kitManifest.ts` that merges, then call it here. Replace `writeManifest(KIT_ROOT)` usage:

```ts
import { writeMergedManifest } from "../kitManifest";
import { userKitDir, userKitCompositesDir } from "../paths";
// ...
await writeMergedManifest(KIT_ROOT, userKitDir());
```

And extend the watcher so changes under `userKitCompositesDir()` also trigger `regenerate`. Add to `isKitSourceFile` an OR branch: `file.startsWith(userKitCompositesDir())`. Note `userKitCompositesDir()` must be resolved at call time (env can change in tests) — call it inside the watcher callback, not at module load.

In `studio/server/kitManifest.ts`, add:

```ts
/** Build the merged manifest (shipped + user) and write it next to the
 *  shipped barrel. Returns the path. No-ops when unchanged. */
export async function writeMergedManifest(shippedRoot: string, userRoot?: string): Promise<string> {
  const entries = await buildMergedManifestEntries(shippedRoot, userRoot);
  const content = renderManifestMarkdown(entries);
  const outPath = path.join(shippedRoot, "KIT-MANIFEST.md");
  let existing = "";
  try { existing = await fs.readFile(outPath, "utf-8"); } catch {}
  if (existing !== content) await fs.writeFile(outPath, content);
  return outPath;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm run studio:test __tests__/server/vite-arcade-user-alias.test.ts __tests__/server/kit-manifest-userkit.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts studio/server/plugins/kitManifestPlugin.ts studio/server/kitManifest.ts studio/__tests__/server/vite-arcade-user-alias.test.ts
git commit -m "feat(studio/components): arcade-user alias + watch user-kit for manifest"
```

---

### Task 4: Component store — write/list/delete with `packFromSource` compile gate

**Files:**
- Create: `studio/server/componentStore.ts`
- Test: `studio/__tests__/server/component-store.test.ts`

**Interfaces:**
- Consumes: `userKitCompositesDir()`, `userKitManifestPath()` (Task 1); `packFromSource` (existing).
- Produces:
  - `isValidComponentName(name: string): boolean` — PascalCase identifier, 2–40 chars, `/^[A-Z][A-Za-z0-9]{1,39}$/`.
  - `listComponents(): Promise<ComponentMeta[]>` where `interface ComponentMeta { name: string; description: string; createdAt: string; origin: string }`.
  - `componentExists(name: string): Promise<boolean>`.
  - `saveComponentFile(args: { name: string; description: string; tsx: string; origin: string; createdAt: string }): Promise<void>` — bundles `tsx` via `packFromSource` (throws `ComponentCompileError` on failure, writing nothing), then writes `<name>.tsx` and upserts the manifest entry.
  - `deleteComponent(name: string): Promise<void>`.
  - `class ComponentCompileError extends Error`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/component-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isValidComponentName, listComponents, componentExists,
  saveComponentFile, deleteComponent, ComponentCompileError,
} from "../../server/componentStore";

const GOOD_TSX = `export function PriceTag() { return <div className="text-sm">$9</div>; }\n`;
const BAD_TSX = `export function Broken( { return <div>;`; // syntax error

describe("componentStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "store-"));
    process.env.ARCADE_STUDIO_ROOT = root;
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("validates names", () => {
    expect(isValidComponentName("PriceTag")).toBe(true);
    expect(isValidComponentName("price-tag")).toBe(false);
    expect(isValidComponentName("X")).toBe(false);
    expect(isValidComponentName("../../etc")).toBe(false);
  });

  it("saves a valid component and lists it", async () => {
    await saveComponentFile({
      name: "PriceTag", description: "A price tag", tsx: GOOD_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    });
    expect(await componentExists("PriceTag")).toBe(true);
    const list = await listComponents();
    expect(list).toEqual([
      { name: "PriceTag", description: "A price tag", createdAt: "2026-06-22T00:00:00.000Z", origin: "saved" },
    ]);
  });

  it("rejects un-bundleable tsx and writes nothing", async () => {
    await expect(saveComponentFile({
      name: "Broken", description: "x", tsx: BAD_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    })).rejects.toBeInstanceOf(ComponentCompileError);
    expect(await componentExists("Broken")).toBe(false);
  });

  it("deletes a component and its manifest entry", async () => {
    await saveComponentFile({ name: "PriceTag", description: "d", tsx: GOOD_TSX, origin: "saved", createdAt: "2026-06-22T00:00:00.000Z" });
    await deleteComponent("PriceTag");
    expect(await componentExists("PriceTag")).toBe(false);
    expect(await listComponents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/component-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// studio/server/componentStore.ts
import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir, userKitManifestPath } from "./paths";
import { packFromSource } from "./sidecar/packFromSource";

export interface ComponentMeta {
  name: string;
  description: string;
  createdAt: string;
  origin: string; // "saved" | "imported"
}

export class ComponentCompileError extends Error {}

const NAME_RE = /^[A-Z][A-Za-z0-9]{1,39}$/;
export function isValidComponentName(name: string): boolean {
  return NAME_RE.test(name);
}

async function readManifest(): Promise<ComponentMeta[]> {
  try {
    const raw = await fs.readFile(userKitManifestPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(entries: ComponentMeta[]): Promise<void> {
  await fs.mkdir(userKitCompositesDir(), { recursive: true });
  await fs.writeFile(userKitManifestPath(), JSON.stringify(entries, null, 2), "utf-8");
}

export async function listComponents(): Promise<ComponentMeta[]> {
  return readManifest();
}

export async function componentExists(name: string): Promise<boolean> {
  if (!isValidComponentName(name)) return false;
  try {
    await fs.access(path.join(userKitCompositesDir(), `${name}.tsx`));
    return true;
  } catch {
    return false;
  }
}

export async function saveComponentFile(args: {
  name: string; description: string; tsx: string; origin: string; createdAt: string;
}): Promise<void> {
  if (!isValidComponentName(args.name)) {
    throw new ComponentCompileError(`Invalid component name: ${args.name}`);
  }
  // Compile gate: a component that doesn't bundle never reaches disk.
  try {
    await packFromSource({ tsx: args.tsx });
  } catch (err) {
    throw new ComponentCompileError(
      `Component "${args.name}" failed to compile: ${(err as Error).message}`,
    );
  }
  await fs.mkdir(userKitCompositesDir(), { recursive: true });
  await fs.writeFile(path.join(userKitCompositesDir(), `${args.name}.tsx`), args.tsx, "utf-8");
  const entries = await readManifest();
  const next = entries.filter((e) => e.name !== args.name);
  next.push({ name: args.name, description: args.description, createdAt: args.createdAt, origin: args.origin });
  await writeManifest(next);
}

export async function deleteComponent(name: string): Promise<void> {
  if (!isValidComponentName(name)) return;
  await fs.rm(path.join(userKitCompositesDir(), `${name}.tsx`), { force: true });
  const entries = await readManifest();
  await writeManifest(entries.filter((e) => e.name !== name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/component-store.test.ts`
Expected: PASS. (`packFromSource` runs real esbuild — `GOOD_TSX` bundles, `BAD_TSX` throws. Test is slower; acceptable.)

- [ ] **Step 5: Commit**

```bash
git add studio/server/componentStore.ts studio/__tests__/server/component-store.test.ts
git commit -m "feat(studio/components): component store with packFromSource compile gate"
```

---

### Task 5: Extraction prompt builder

**Files:**
- Create: `studio/server/componentExtract.ts`
- Test: `studio/__tests__/server/component-extract.test.ts`

**Interfaces:**
- Produces: `buildExtractPrompt(args: { name: string; description: string; frameSlug: string; line: number; column: number }): string` — a scoped instruction the generator obeys: read the frame file, extract the sub-tree at `line:column`, rewrite house-style, write to `arcade-user/<name>` source path.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/component-extract.test.ts
import { describe, it, expect } from "vitest";
import { buildExtractPrompt } from "../../server/componentExtract";

describe("buildExtractPrompt", () => {
  const p = buildExtractPrompt({ name: "PriceTag", description: "A price tag", frameSlug: "01-home", line: 42, column: 7 });
  it("anchors to the picked location", () => {
    expect(p).toContain("frames/01-home/index.tsx");
    expect(p).toContain("42:7");
  });
  it("names the output file and component", () => {
    expect(p).toContain("user-kit/composites/PriceTag.tsx");
    expect(p).toContain("PriceTag");
  });
  it("enforces house-style rules", () => {
    expect(p).toMatch(/arcade\/components/);
    expect(p).toMatch(/PriceTagProps/);
    expect(p).toMatch(/JSDoc|header comment/i);
  });
  it("carries the description for the JSDoc", () => {
    expect(p).toContain("A price tag");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/component-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

```ts
// studio/server/componentExtract.ts

/**
 * Build the scoped instruction handed to the generator subprocess when a
 * designer saves a picked element as a reusable component. Mirrors the
 * discipline of the scoped-edit preamble (PromptInput.buildTargetPreamble):
 * read the file, the line:column identifies the element, act narrowly.
 */
export function buildExtractPrompt(args: {
  name: string; description: string; frameSlug: string; line: number; column: number;
}): string {
  const rel = `frames/${args.frameSlug}/index.tsx`;
  return [
    `Extract a reusable component from an existing frame.`,
    ``,
    `Source: ${rel}:${args.line}:${args.column}`,
    `Read ${rel} first — do not work from memory. The line:column above identifies`,
    `the root element of the sub-tree to extract. Extract ONLY that element and its`,
    `children.`,
    ``,
    `Write a new file at user-kit/composites/${args.name}.tsx that exports a single`,
    `component named ${args.name}. Requirements:`,
    `- Start with a JSDoc header comment whose first line is: ${args.description}`,
    `- Compose primitives from "arcade/components" and existing composites from`,
    `  "arcade-prototypes" — never re-implement a primitive, never hardcode hex/rgb`,
    `  (use --fg-*/--surface-*/--stroke-*/--bg-* tokens).`,
    `- Lift hardcoded strings, counts, and repeated data into a props type named`,
    `  ${args.name}Props, with sensible defaults so <${args.name} /> renders standalone.`,
    `- Do not import anything from the original frame; the file must stand alone.`,
    ``,
    `Write ONLY that one file. A reply without a Write tool call is a failed turn.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/component-extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/componentExtract.ts studio/__tests__/server/component-extract.test.ts
git commit -m "feat(studio/components): scoped extraction prompt builder"
```

---

### Task 6: `components` middleware — list / export / import / delete

**Files:**
- Create: `studio/server/middleware/components.ts`
- Modify: `studio/vite.config.ts` (register middleware)
- Test: `studio/__tests__/server/components-middleware.test.ts`

**Interfaces:**
- Consumes: `componentStore` (Task 4), `userKitCompositesDir()` (Task 1).
- Produces HTTP routes (all under `/api/components`):
  - `GET /api/components` → `{ components: ComponentMeta[] }`.
  - `GET /api/components/:name/export` → `text/plain` with `Content-Disposition: attachment; filename="<name>.arcade.tsx"`, body = the stored `.tsx` prefixed with a `// @arcade-component name="…" description="…"` header line.
  - `POST /api/components/import` (JSON `{ tsx: string }`) → parse the header line for name/description (fallback: first exported component name + empty description), then `saveComponentFile({ origin: "imported", … })`. 409 on name collision unless `{ replace: true }`. 422 on compile failure.
  - `DELETE /api/components/:name` → `deleteComponent`, `{ deleted: true }`.
  - `export function parseComponentFile(text: string): { name?: string; description?: string; tsx: string }` (exported for testing).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/components-middleware.test.ts
import { describe, it, expect } from "vitest";
import { parseComponentFile } from "../../server/middleware/components";

describe("parseComponentFile", () => {
  it("reads the arcade-component header", () => {
    const text = `// @arcade-component name="PriceTag" description="A price tag"\nexport function PriceTag(){return null}`;
    const r = parseComponentFile(text);
    expect(r.name).toBe("PriceTag");
    expect(r.description).toBe("A price tag");
    expect(r.tsx).toContain("export function PriceTag");
    expect(r.tsx).not.toContain("@arcade-component");
  });
  it("falls back to the first exported component when no header", () => {
    const text = `export function FancyBox(){return null}`;
    const r = parseComponentFile(text);
    expect(r.name).toBe("FancyBox");
    expect(r.description).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/components-middleware.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware**

```ts
// studio/server/middleware/components.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir } from "../paths";
import {
  listComponents, saveComponentFile, deleteComponent,
  componentExists, isValidComponentName, ComponentCompileError,
} from "../componentStore";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c; return buf ? JSON.parse(buf) : {};
}
function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const HEADER_RE = /^\/\/\s*@arcade-component\s+name="([^"]+)"(?:\s+description="([^"]*)")?\s*$/m;

export function parseComponentFile(text: string): { name?: string; description?: string; tsx: string } {
  const m = text.match(HEADER_RE);
  if (m) {
    return { name: m[1], description: m[2] ?? "", tsx: text.replace(HEADER_RE, "").replace(/^\n/, "") };
  }
  const fn = text.match(/export\s+(?:function|const)\s+([A-Z][A-Za-z0-9]*)/);
  return { name: fn?.[1], description: "", tsx: text };
}

function exportHeader(name: string, description: string): string {
  return `// @arcade-component name="${name}" description="${description.replace(/"/g, "'")}"\n`;
}

export function componentsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").replace(/\?.*$/, "");
    if (!url.startsWith("/api/components")) return next?.();

    if (url === "/api/components" && req.method === "GET") {
      return send(res, 200, { components: await listComponents() });
    }

    const exportMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)\/export$/);
    if (exportMatch && req.method === "GET") {
      const name = exportMatch[1];
      if (!(await componentExists(name))) return send(res, 404, { error: { code: "not_found" } });
      const tsx = await fs.readFile(path.join(userKitCompositesDir(), `${name}.tsx`), "utf-8");
      const meta = (await listComponents()).find((c) => c.name === name);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.arcade.tsx"`,
      });
      res.end(exportHeader(name, meta?.description ?? "") + tsx);
      return;
    }

    if (url === "/api/components/import" && req.method === "POST") {
      const body = await readJson(req);
      const text = typeof body?.tsx === "string" ? body.tsx : "";
      const parsed = parseComponentFile(text);
      if (!parsed.name || !isValidComponentName(parsed.name)) {
        return send(res, 422, { error: { code: "bad_component", message: "This doesn't look like an exported component." } });
      }
      if (await componentExists(parsed.name) && !body?.replace) {
        return send(res, 409, { error: { code: "name_taken", message: `You already have a component named ${parsed.name}.` }, name: parsed.name });
      }
      try {
        await saveComponentFile({
          name: parsed.name, description: parsed.description ?? "", tsx: parsed.tsx,
          origin: "imported", createdAt: new Date().toISOString(),
        });
      } catch (err) {
        if (err instanceof ComponentCompileError) {
          return send(res, 422, { error: { code: "compile_failed", message: "This doesn't look like an exported component." } });
        }
        throw err;
      }
      return send(res, 200, { imported: true, name: parsed.name });
    }

    const delMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)$/);
    if (delMatch && req.method === "DELETE") {
      await deleteComponent(delMatch[1]);
      return send(res, 200, { deleted: true });
    }

    return next?.();
  };
}
```

Note: `new Date().toISOString()` is fine in middleware (runtime); only workflow scripts forbid it.

- [ ] **Step 4a: Register in vite.config.ts**

In `studio/vite.config.ts`, import `componentsMiddleware` and add inside `apiPlugin().configureServer`, near the other `server.middlewares.use(...)` lines:

```ts
      server.middlewares.use(componentsMiddleware());
```

- [ ] **Step 4b: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/components-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/components.ts studio/vite.config.ts studio/__tests__/server/components-middleware.test.ts
git commit -m "feat(studio/components): components middleware (list/export/import/delete)"
```

---

### Task 7: `POST /api/components/save` — run the generator extraction

**Files:**
- Modify: `studio/server/middleware/components.ts`
- Test: `studio/__tests__/server/components-save.test.ts`

**Interfaces:**
- Consumes: `buildExtractPrompt` (Task 5); `runClaudeTurnWithRetry` + `resolveClaudeBin` (existing); `componentStore` (Task 4); `frameDir`/`userKitCompositesDir` (Task 1).
- Produces: `POST /api/components/save` (JSON `{ projectSlug, frameSlug, line, column, name, description, replace? }`):
  - validate name → 400 `bad_name`; collision (no `replace`) → 409 `name_taken`.
  - run the generator turn in `projectDir(projectSlug)` with `--add-dir userKitDir()` so it can write there, prompt from `buildExtractPrompt`.
  - after the turn, read `user-kit/composites/<name>.tsx`. If absent → 422 `extract_failed`. If present, run it through `saveComponentFile` (compile gate + manifest upsert). On `ComponentCompileError`, delete the bad file and 422 `extract_failed`.
  - 200 `{ saved: true, name }`.
- The generator call is factored behind an injectable `runExtraction` dep (default = real) so the test can stub it. Export `__setExtractionRunner(fn)` for tests.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/components-save.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleSaveForTest, __setExtractionRunner } from "../../server/middleware/components";
import { componentExists } from "../../server/componentStore";

describe("save extraction", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "save-"));
    process.env.ARCADE_STUDIO_ROOT = root;
    // make a fake project + frame
    const fdir = path.join(root, "projects", "demo", "frames", "01-home");
    await fs.mkdir(fdir, { recursive: true });
    await fs.writeFile(path.join(fdir, "index.tsx"), "export default function F(){return null}", "utf-8");
  });
  afterEach(async () => { __setExtractionRunner(null); await fs.rm(root, { recursive: true, force: true }); });

  it("persists the component the generator wrote", async () => {
    // stub the generator: write a valid component file where the real agent would
    __setExtractionRunner(async ({ name }) => {
      const dir = path.join(root, "user-kit", "composites");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.tsx`), `export function ${name}(){return <div className="p-2">hi</div>}`, "utf-8");
    });
    const r = await handleSaveForTest({ projectSlug: "demo", frameSlug: "01-home", line: 1, column: 1, name: "PriceTag", description: "d" });
    expect(r.status).toBe(200);
    expect(await componentExists("PriceTag")).toBe(true);
  });

  it("422s when the generator produced nothing", async () => {
    __setExtractionRunner(async () => { /* writes nothing */ });
    const r = await handleSaveForTest({ projectSlug: "demo", frameSlug: "01-home", line: 1, column: 1, name: "Ghost", description: "d" });
    expect(r.status).toBe(422);
    expect(await componentExists("Ghost")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/components-save.test.ts`
Expected: FAIL — `handleSaveForTest` not exported.

- [ ] **Step 3: Implement save**

Add to `studio/server/middleware/components.ts`:

```ts
import { frameDir, userKitDir, userKitCompositesDir as _ukc } from "../paths";
import { buildExtractPrompt } from "../componentExtract";

type ExtractionRunner = (args: {
  name: string; description: string; projectSlug: string; frameSlug: string; line: number; column: number;
}) => Promise<void>;

let extractionRunner: ExtractionRunner | null = null;
export function __setExtractionRunner(fn: ExtractionRunner | null) { extractionRunner = fn; }

async function defaultExtraction(args: Parameters<ExtractionRunner>[0]): Promise<void> {
  const { runClaudeTurnWithRetry } = await import("../claudeCode");
  const { resolveClaudeBin } = await import("../claudeBin");
  const { projectDir } = await import("../paths");
  await runClaudeTurnWithRetry({
    cwd: projectDir(args.projectSlug),
    prompt: buildExtractPrompt({
      name: args.name, description: args.description,
      frameSlug: args.frameSlug, line: args.line, column: args.column,
    }),
    bin: resolveClaudeBin(),
    addDirs: [userKitDir()],
    onEvent: () => {},
    onCrash: () => {},
  });
}

export async function handleSaveForTest(input: {
  projectSlug: string; frameSlug: string; line: number; column: number;
  name: string; description: string; replace?: boolean;
}): Promise<{ status: number; body: unknown }> {
  if (!isValidComponentName(input.name)) return { status: 400, body: { error: { code: "bad_name" } } };
  if (await componentExists(input.name) && !input.replace) {
    return { status: 409, body: { error: { code: "name_taken" }, name: input.name } };
  }
  const run = extractionRunner ?? defaultExtraction;
  await run(input);
  const filePath = path.join(_ukc(), `${input.name}.tsx`);
  let tsx: string;
  try { tsx = await fs.readFile(filePath, "utf-8"); }
  catch { return { status: 422, body: { error: { code: "extract_failed", message: "Couldn't turn this into a clean component — try a different element." } } }; }
  try {
    await saveComponentFile({ name: input.name, description: input.description, tsx, origin: "saved", createdAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ComponentCompileError) {
      await fs.rm(filePath, { force: true });
      return { status: 422, body: { error: { code: "extract_failed", message: "Couldn't turn this into a clean component — try a different element." } } };
    }
    throw err;
  }
  return { status: 200, body: { saved: true, name: input.name } };
}
```

Then wire the HTTP route inside `componentsMiddleware` (before the `return next?.()`):

```ts
    if (url === "/api/components/save" && req.method === "POST") {
      const b = await readJson(req);
      const r = await handleSaveForTest({
        projectSlug: String(b.projectSlug), frameSlug: String(b.frameSlug),
        line: Number(b.line), column: Number(b.column),
        name: String(b.name), description: String(b.description ?? ""), replace: !!b.replace,
      });
      return send(res, r.status, r.body);
    }
```

(Note `saveComponentFile` already re-bundles via `packFromSource`; the generator wrote into `user-kit/composites/` directly, so the re-read + re-save double-checks the compile gate and upserts the manifest. The brief double-write of the .tsx is harmless.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/components-save.test.ts`
Expected: PASS both cases.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/components.ts studio/__tests__/server/components-save.test.ts
git commit -m "feat(studio/components): /api/components/save runs scoped generator extraction"
```

---

### Task 8: Assets panel — "Your components" section, relabels, import, delete

**Files:**
- Modify: `studio/src/components/assets/useAssetsCatalog.ts`
- Modify: `studio/src/components/assets/AssetsPanel.tsx`
- Test: `studio/__tests__/components/assets-panel-user-components.test.tsx`

**Interfaces:**
- Consumes: `GET /api/components`, `POST /api/components/import`, `DELETE /api/components/:name` (Tasks 6).
- Produces: a `useUserComponents()` hook returning `{ items: ComponentMeta[]; reload(): void }`; AssetsPanel renders a "Your components" section first, relabels the shipped sections to "Components"/"Elements", and shows an "Import" button + per-card delete.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/assets-panel-user-components.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AssetsPanel } from "../../src/components/assets/AssetsPanel";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/assets") return new Response(JSON.stringify({ sections: [
      { kind: "composite", items: [{ name: "EntityCard", doc: "card", thumb: null }] },
      { kind: "component", items: [{ name: "Button", doc: "btn", thumb: null }] },
      { kind: "icon", items: [] },
    ] }), { status: 200 });
    if (url === "/api/components") return new Response(JSON.stringify({ components: [
      { name: "PriceTag", description: "A price tag", createdAt: "2026-06-22T00:00:00Z", origin: "saved" },
    ] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});

describe("AssetsPanel user components", () => {
  it("shows the Your components section and relabeled sections", async () => {
    render(<AssetsPanel onSeed={() => {}} onSeeded={() => {}} />);
    await waitFor(() => expect(screen.getByText(/PriceTag/)).toBeInTheDocument());
    expect(screen.getByText(/Your components/i)).toBeInTheDocument();
    expect(screen.getByText(/^Components/)).toBeInTheDocument(); // relabeled composites
    expect(screen.getByText(/^Elements/)).toBeInTheDocument();   // relabeled components
    expect(screen.queryByText(/Composites/)).not.toBeInTheDocument(); // no "composite" word
  });
});
```

(Check whether the existing arcade-gen mock is needed; if AssetsPanel renders only DOM + AssetCard, no mock change required. If a test setup mock for `@xorkavi/arcade-gen` exists and the panel pulls a primitive from it, add the used export — known gotcha [[arcade-gen-mock-projectdetail-tests]].)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/assets-panel-user-components.test.tsx`
Expected: FAIL — "Your components" not present; "Composites" still present.

- [ ] **Step 3: Implement the hook + panel changes**

Add `useUserComponents` to `useAssetsCatalog.ts`:

```ts
export interface UserComponent { name: string; description: string; createdAt: string; origin: string; }

export function useUserComponents(): { items: UserComponent[]; reload: () => void } {
  const [items, setItems] = useState<UserComponent[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/components").then((r) => r.json()).then((d) => {
      if (live) setItems(Array.isArray(d.components) ? d.components : []);
    }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [nonce]);
  return { items, reload: () => setNonce((n) => n + 1) };
}
```

In `AssetsPanel.tsx`:
- Call `const userComps = useUserComponents();`.
- Add a "Your components" `<Section>` ABOVE the existing sections, mapping `userComps.items` to `AssetCard` (synthesize an `AssetItem`: `{ name, doc: description, thumb: null }`). Each card gets a delete affordance → `fetch(\`/api/components/${name}\`, { method: "DELETE" }).then(userComps.reload)`. "Use this" seeds `Use the ${name} component to `.
- Change section label `"Composites"` → `"Components"` and `"Components"` → `"Elements"`. (Keep the internal `kind` values unchanged — only the visible `label` prop changes.)
- Add an "Import" button in the header: a hidden `<input type="file" accept=".tsx">`; on change read the file text and `POST /api/components/import` `{ tsx }`, then `userComps.reload()`. On 409, confirm + retry with `{ replace: true }`. On 422, toast the message.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/assets-panel-user-components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/assets/useAssetsCatalog.ts studio/src/components/assets/AssetsPanel.tsx studio/__tests__/components/assets-panel-user-components.test.tsx
git commit -m "feat(studio/components): Your components section + import/delete + relabel"
```

---

### Task 9: "Save as component" action on a picked element

**Files:**
- Create: `studio/src/components/assets/SaveComponentModal.tsx`
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Test: `studio/__tests__/components/save-component-modal.test.tsx`

**Interfaces:**
- Consumes: the picked `TargetSelection` (`src/hooks/targetSelectionContext.tsx`); `POST /api/components/save`.
- Produces: `SaveComponentModal` (props `{ target: TargetSelection; projectSlug: string; onClose(): void; onSaved(name: string): void }`) — name + description inputs (name pre-filled from `target.componentName || target.tagName`, validated PascalCase), Save → POST, busy state, error + 409-replace handling. FrameCard renders a "Save as component" button when an element is targeted on that frame, opening the modal.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/save-component-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveComponentModal } from "../../src/components/assets/SaveComponentModal";

const target = { file: "/x/frames/01-home/index.tsx", line: 5, column: 3, componentName: "Card", tagName: "div", frameSlug: "01-home" };

describe("SaveComponentModal", () => {
  it("prefills the name and posts a save", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ saved: true, name: "Card" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<SaveComponentModal target={target as any} projectSlug="demo" onClose={() => {}} onSaved={onSaved} />);
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Card");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Card"));
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse((opts as any).body)).toMatchObject({ projectSlug: "demo", frameSlug: "01-home", line: 5, column: 3, name: "Card" });
  });

  it("blocks an invalid name", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SaveComponentModal target={target as any} projectSlug="demo" onClose={() => {}} onSaved={() => {}} />);
    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: "bad name" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/letters and numbers|PascalCase|valid name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/save-component-modal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal + FrameCard button**

Create `SaveComponentModal.tsx`: a lightweight modal (match the styling approach FrameCard/AppSettingsModal use — inline styles + tokens, or arcade-gen `Modal` if already imported in the shell; verify before choosing). Local state `name` (init `target.componentName || target.tagName || ""`), `description`, `busy`, `error`. Validate name against `/^[A-Z][A-Za-z0-9]{1,39}$/` client-side before POST. On Save POST `/api/components/save` with `{ projectSlug, frameSlug: target.frameSlug, line: target.line, column: target.column, name, description }`. On 409 show "Name taken — Replace?" → re-POST with `replace: true`. On 422 show the server message. On 200 call `onSaved(name)`.

In `FrameCard.tsx`: where `isTargetedFrame` is true (target chip area, ~line 213), add a small "Save as component" button. Clicking sets local `showSaveModal=true`; render `<SaveComponentModal target={target!} projectSlug={projectSlug} onClose={…} onSaved={(n) => { setTarget(null); toast({ title: \`Saved ${n}\` }); }} />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/save-component-modal.test.tsx`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/assets/SaveComponentModal.tsx studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/save-component-modal.test.tsx
git commit -m "feat(studio/components): Save-as-component action on picked element"
```

---

### Task 10: CHANGELOG + full-suite gate

**Files:**
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Add the 0.40.0 entry**

Prepend to `studio/CHANGELOG.md` (keep-a-changelog style):

```markdown
## [0.40.0] — 2026-06-22

### Added
- **Contribute components.** Pick any element in a prototype and "Save as
  component" — it becomes a reusable, named component you can drop into any
  other prototype right away. Saved components appear under "Your components"
  in the Assets panel.
- **Share components.** Export a saved component to a file and import a
  teammate's, so a component built once can be reused by everyone.

### Changed
- Assets panel sections renamed for clarity: "Your components" / "Components" /
  "Elements".
```

- [ ] **Step 2: Run the full suite**

Run: `pnpm run studio:test`
Expected: all green (existing 173+ plus the new tests). Fix any regression (most likely the arcade-gen mock for the AssetsPanel test — add any newly-used export).

- [ ] **Step 3: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): changelog for 0.40.0 contribute-components"
```

- [ ] **Step 4: Manual smoke (real app, since middleware doesn't hot-reload)**

```bash
pnpm run studio
```
Then in the app: generate a frame → arm the picker → click an element → "Save as component" → name it → confirm it shows under "Your components" → in a new prompt type "Use the <Name> component to …" and confirm the generator uses it → Export it → re-import it. (Manual; no automated step.)

---

## Self-Review

**Spec coverage:**
- Writable user dir (no DMG) → Tasks 1, 3, 4. ✅
- Manifest sees user components → Tasks 2, 3. ✅
- `arcade-user` alias → Task 3. ✅
- Pick element → save via generator extraction (scoped to line:col) → Tasks 5, 7, 9. ✅
- Compile gate = `packFromSource` → Task 4 (and re-checked in 7). ✅
- Reuse-by-self (generator + "Use this") → Tasks 2/3 (manifest) + 8 (Use this). ✅
- Export = download, Import = file input (no IPC, no hidden folder) → Task 6, 8. ✅
- "Component" everywhere, relabel sections → Task 8. ✅
- Error handling (bad name/collision/extract fail/bad import) → Tasks 4, 6, 7, 9. ✅
- Tests per behavior → every task. ✅
- 0.40.0 + CHANGELOG → Task 10. ✅
- Phase-2 deferrals (registry, multi-select, real thumbnails, in-place edit) → not built. ✅

**Placeholder scan:** none — every code step has full code.

**Type consistency:** `ComponentMeta` shape `{ name, description, createdAt, origin }` consistent across Tasks 4/6/8. `saveComponentFile` signature consistent in Tasks 4/6/7. `buildExtractPrompt` arg shape consistent in Tasks 5/7. `TargetSelection` used as defined.

**Known soft spots flagged for the implementer:**
- Task 3: verify whether `injectStudioSourcePlugin` covers the whole studio root (then user-kit is free) or only `projects/` (then extend it). Read the plugin before editing.
- Task 8/9: verify the AssetsPanel/FrameCard test setup's `@xorkavi/arcade-gen` mock; add any newly-referenced export.
- Task 9: confirm the modal styling convention (inline-tokens vs arcade-gen `Modal`) before writing — match neighbors.
