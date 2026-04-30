# Remotion Clip Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add animated-clip sharing as an alternative to the existing Vercel live-URL share. A designer selects a frame inside the existing `ShareModal`, switches the "Share as" toggle to **Animated clip**, clicks **Generate clip**, and receives a 6-second 1366×768 `.mov` rendered locally via Remotion.

**Architecture:** Server-side rendering pipeline mirroring the Vercel share flow. A new `server/remotion/renderer.ts` writes a Remotion `Root.tsx` entry for the target frame, bundles it with `@remotion/bundler`, and renders to `.mov` with `@remotion/renderer`. A new `server/middleware/clip.ts` exposes `POST /api/projects/:slug/clip` (kick off render, returns 202 + renderId), `GET /api/projects/:slug/clip/:renderId/progress` (SSE progress stream), `DELETE /api/projects/:slug/clip/:renderId` (cancel), and `GET /api/projects/:slug/clips/:file` (serve the .mov for inline preview). Bundle config (esbuild aliases, Tailwind compile, font inlining) is extracted from `server/vercel/bundler.ts` into a shared `server/shared/frameBundleConfig.ts` module consumed by both bundlers.

**Tech Stack:** TypeScript, Vite dev server middleware, Zod schemas, Remotion v4 (`remotion`, `@remotion/bundler`, `@remotion/renderer`), esbuild, Tailwind v4 (`@tailwindcss/node`, `@tailwindcss/oxide`), vitest, React 19, `@xorkavi/arcade-gen`.

---

## Scope

**In scope:**
- Dependency additions: `remotion`, `@remotion/bundler`, `@remotion/renderer` at repo root.
- Shared bundler config refactor (`server/shared/frameBundleConfig.ts`) + Vercel bundler migration to use it.
- `server/remotion/composition.ts` — pure `buildDefaultRootSource()` generator.
- `server/remotion/renderer.ts` — `buildFrameClip()` wrapping `@remotion/bundler` + `@remotion/renderer`.
- `server/middleware/clip.ts` — HTTP/SSE routes, in-memory render-state map, 180s timeout, cancel handling.
- `Clip` Zod schema + `Project.clips?: Clip[]` extension in `server/types.ts`.
- `vite.config.ts` middleware registration.
- Frontend `ShareModal.tsx` changes: "Share as" segmented control, clip Rendering/Success/Error states, SSE client, Save-to-Desktop / Reveal-in-Finder / Open actions.
- Tests: unit tests for composition generator; mocked middleware test; regression test for the shared bundler config refactor.

**Explicitly out of scope (future enhancements):**
- Scripted animations (hover, click, typed input).
- GIF / webm output.
- Multi-frame clips / custom durations / custom templates / custom resolutions.
- Remotion Lambda / Cloud Run.
- Free-text prompts in the modal.
- Theme-token-driven letterbox color (v1 uses hardcoded fallbacks).
- Deploy/clip history UI (only the most recent is surfaced in the success panel).

## Assumptions verified against the codebase

- `studio/vite.config.ts` registers middleware via an `apiPlugin()` function at line 25–50. `vercelMiddleware()` is registered on line 31. New `clipMiddleware()` must be registered alongside it.
- `studio/server/types.ts` exports `projectSchema` with a `deployments?: ...[]` optional array at line 25–29. The clip extension mirrors this shape.
- `studio/server/vercel/bundler.ts` contains `ARCADE_ALIASES` (line 149), `devrevStubPlugin` (line 121), `buildFrameTailwindCss` (line 46), `buildInlineFontFaceCss` (line 92), `REPO_ROOT` (line 117), `REPO_NODE_MODULES` (line 118), `STUDIO_SRC_STYLES` (line 119). These are the helpers extracted into the shared module.
- `studio/server/middleware/vercel.ts` follows the pattern: exports a factory `vercelMiddleware()` that returns an async `(req, res, next)` handler; reads JSON via `readJson(req)`; responds via `send(res, status, body)`. The new `clipMiddleware` mirrors this shape.
- `studio/server/paths.ts::projectDir(slug)` resolves to `~/Library/Application Support/arcade-studio/projects/<slug>/`. `projectJsonPath(slug)` resolves the project.json path. No existing `clipsDir()` helper — we add one.
- `package.json` (repo root) is where Remotion deps are added; `studio/` has no sibling `package.json`.
- Vitest config lives at `studio/vitest.config.ts`. Tests run via `pnpm studio:test` from the repo root.
- Existing `__tests__/server/vercel/bundler.test.ts` mocks `esbuild` via `vi.mock`. The shared-bundle-config regression test will extend this pattern.
- `__tests__/server/middleware/vercel.test.ts` uses duck-typed `IncomingMessage` / `ServerResponse` with `Symbol.asyncIterator` + `writeHead`/`end` spies. The clip middleware test uses the same pattern.
- `ShareModal.tsx` currently lives at `studio/src/components/shell/ShareModal.tsx` and posts to `/api/projects/:slug/share`. It uses `@xorkavi/arcade-gen`'s `Modal.Root`, `Modal.Content`, etc. Same components are available for the clip flow.
- Remotion v4 API: `bundle({ entryPoint, outDir, ... })` returns an `outDir` string. `renderMedia({ serveUrl, composition, outputLocation, codec, onProgress, ... })` writes the video. `selectComposition({ serveUrl, id, inputProps })` returns the composition metadata. `onProgress` fires with `{ renderedFrames, encodedFrames }`. AbortController is supported via `signal` on `renderMedia`.

## File Structure

```
studio/
├── server/
│   ├── types.ts                          # Modified: add ClipSchema + Project.clips
│   ├── paths.ts                          # Modified: add clipsDir() helper
│   ├── shared/
│   │   └── frameBundleConfig.ts          # New: extracted from vercel/bundler.ts
│   ├── vercel/
│   │   └── bundler.ts                    # Modified: import from shared/
│   ├── remotion/
│   │   ├── composition.ts                # New: pure buildDefaultRootSource()
│   │   └── renderer.ts                   # New: buildFrameClip() pipeline
│   └── middleware/
│       └── clip.ts                       # New: HTTP + SSE routes, render-state map
│
├── src/
│   └── components/
│       └── shell/
│           └── ShareModal.tsx            # Modified: "Share as" toggle + clip UX
│
├── vite.config.ts                        # Modified: register clipMiddleware()
│
└── __tests__/
    ├── server/
    │   ├── remotion/
    │   │   └── composition.test.ts       # New: unit tests for source generator
    │   ├── shared/
    │   │   └── frameBundleConfig.test.ts # New: regression guard for refactor
    │   └── middleware/
    │       └── clip.test.ts              # New: mocked middleware test
```

Module boundaries:
- `server/shared/frameBundleConfig.ts` depends only on Node stdlib + `@tailwindcss/node` + `esbuild` types. No imports of studio-local code. Pure utility module.
- `server/remotion/composition.ts` depends on Node stdlib only. Pure string generator; no side effects. Unit-testable without Chromium or filesystem.
- `server/remotion/renderer.ts` depends on `server/shared/frameBundleConfig`, `server/remotion/composition`, `@remotion/bundler`, `@remotion/renderer`, `server/paths`.
- `server/middleware/clip.ts` depends on `server/remotion/renderer`, `server/paths`, `server/types`. Owns the in-memory render-state map; exposes no writable globals.
- `server/vercel/bundler.ts` imports from `server/shared/frameBundleConfig`. No behavior change.

---

## Phase 0 — Foundations

The refactor and dep install have no user-visible behavior change, but unblock every later task. Do them first so subsequent work compiles cleanly.

### Task 0.1: Install Remotion dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add Remotion deps to `package.json` dependencies**

Add to the `dependencies` block (keep alphabetical by reading the existing block first):

```json
"@remotion/bundler": "^4.0.0",
"@remotion/renderer": "^4.0.0",
"remotion": "^4.0.0",
```

The final `dependencies` block should be:

```json
"dependencies": {
  "@remotion/bundler": "^4.0.0",
  "@remotion/renderer": "^4.0.0",
  "@tailwindcss/node": "^4.2.4",
  "@tailwindcss/oxide": "^4.2.4",
  "@xorkavi/arcade-gen": "^1.0.0",
  "chokidar": "^4.0.0",
  "esbuild": "^0.25.0",
  "react": "^19.0.0",
  "react-day-picker": "^9.14.0",
  "react-dom": "^19.0.0",
  "react-markdown": "^10.1.0",
  "remotion": "^4.0.0",
  "zod": "^4.3.6"
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: Lockfile updates. Chromium is **not** downloaded at install time — Remotion fetches it lazily on first `renderMedia()` call.

- [ ] **Step 3: Verify deps resolve**

Run: `node -e "console.log(require.resolve('@remotion/bundler')); console.log(require.resolve('@remotion/renderer')); console.log(require.resolve('remotion'))"`
Expected: Three paths under `node_modules/` print, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(studio): add remotion deps for clip rendering"
```

### Task 0.2: Extract shared bundler config

Move the esbuild/Tailwind/font helpers out of `server/vercel/bundler.ts` into `server/shared/frameBundleConfig.ts`. No behavior change. The Vercel bundler continues to work identically.

**Files:**
- Create: `studio/server/shared/frameBundleConfig.ts`
- Modify: `studio/server/vercel/bundler.ts`
- Create: `studio/__tests__/server/shared/frameBundleConfig.test.ts`

- [ ] **Step 1: Write a regression test that asserts the shared module's exports exist and match expected shape**

Create `studio/__tests__/server/shared/frameBundleConfig.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";

describe("frameBundleConfig", () => {
  it("exports ARCADE_ALIASES matching studio/vite.config.ts", async () => {
    const mod = await import("../../../server/shared/frameBundleConfig");
    expect(mod.ARCADE_ALIASES["arcade"]).toBe("@xorkavi/arcade-gen");
    expect(mod.ARCADE_ALIASES["arcade/components"]).toBe("@xorkavi/arcade-gen");
    expect(mod.ARCADE_ALIASES["arcade-prototypes"]).toMatch(/prototype-kit$/);
  });

  it("exports REPO_ROOT / REPO_NODE_MODULES / STUDIO_SRC_STYLES as absolute paths", async () => {
    const mod = await import("../../../server/shared/frameBundleConfig");
    expect(path.isAbsolute(mod.REPO_ROOT)).toBe(true);
    expect(mod.REPO_NODE_MODULES).toBe(path.join(mod.REPO_ROOT, "node_modules"));
    expect(mod.STUDIO_SRC_STYLES).toBe(path.join(mod.REPO_ROOT, "studio", "src", "styles"));
  });

  it("exports devrevStubPlugin factory producing an esbuild plugin", async () => {
    const mod = await import("../../../server/shared/frameBundleConfig");
    const plugin = mod.devrevStubPlugin();
    expect(plugin.name).toBe("arcade-studio-devrev-stub");
    expect(typeof plugin.setup).toBe("function");
  });

  it("exports buildFrameTailwindCss and buildInlineFontFaceCss as async functions", async () => {
    const mod = await import("../../../server/shared/frameBundleConfig");
    expect(typeof mod.buildFrameTailwindCss).toBe("function");
    expect(typeof mod.buildInlineFontFaceCss).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (module does not exist yet)**

Run: `pnpm studio:test __tests__/server/shared/frameBundleConfig.test.ts`
Expected: FAIL with "Failed to resolve '../../../server/shared/frameBundleConfig'".

- [ ] **Step 3: Create `studio/server/shared/frameBundleConfig.ts`**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import type { Plugin } from "esbuild";
import { compile as tailwindCompile } from "@tailwindcss/node";
import { Scanner as TailwindScanner } from "@tailwindcss/oxide";
import { generateDevRevStubs } from "../vercel/stubDevRev";

// Resolve the arcade-prototyper repo root from this file's own location:
//   <repo>/studio/server/shared/frameBundleConfig.ts → three "../" lands at <repo>.
// This works both in dev checkouts and inside the packaged .app bundle
// (Contents/Resources/app/node_modules/).
const SHARED_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SHARED_DIR, "..", "..", "..");
export const REPO_NODE_MODULES = path.join(REPO_ROOT, "node_modules");
export const STUDIO_SRC_STYLES = path.join(REPO_ROOT, "studio", "src", "styles");

// Keep in sync with studio/vite.config.ts's `resolve.alias`. Generated frames
// under ~/Library/Application Support/... use the short "arcade" /
// "arcade/components" specifiers; `arcade-prototypes` points at prototype-kit.
export const ARCADE_ALIASES = {
  "arcade": "@xorkavi/arcade-gen",
  "arcade/components": "@xorkavi/arcade-gen",
  "arcade-prototypes": path.join(REPO_ROOT, "studio", "prototype-kit"),
} as const;

// esbuild plugin that intercepts `shared/devrev` imports in generated frames
// and replaces them with client-safe stubs. Used by both the Vercel bundler
// (deployed frames can't carry real PATs) and the Remotion renderer (headless
// Chrome can't make authenticated DevRev calls).
export function devrevStubPlugin(): Plugin {
  return {
    name: "arcade-studio-devrev-stub",
    setup(b) {
      b.onResolve({ filter: /(^|\/)shared\/devrev(\.ts|\.tsx|\.js)?$/ }, (args) => ({
        path: args.path,
        namespace: "devrev-stub",
      }));
      b.onLoad({ filter: /.*/, namespace: "devrev-stub" }, () => ({
        contents: generateDevRevStubs(),
        loader: "tsx",
      }));
    },
  };
}

// Compile Tailwind v4 for a specific frame directory — mirrors studio's
// dev-server Tailwind pipeline. Without this, classes the frame uses but
// arcade-gen doesn't also use would be missing from the bundle CSS.
export async function buildFrameTailwindCss(framePath: string): Promise<string> {
  const tailwindEntry = path.join(STUDIO_SRC_STYLES, "tailwind.css");
  const baseCss = await fs.readFile(tailwindEntry, "utf-8");

  const extraSources = [
    `@source "${framePath.replace(/\\/g, "/")}/**/*.{ts,tsx}";`,
    `@source "${path.join(REPO_ROOT, "studio", "prototype-kit").replace(/\\/g, "/")}/**/*.{ts,tsx}";`,
  ].join("\n");
  const cssWithSources = baseCss + "\n" + extraSources + "\n";

  const compiler = await tailwindCompile(cssWithSources, {
    base: STUDIO_SRC_STYLES,
    from: tailwindEntry,
    onDependency: () => {},
  });

  const scannerSources =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: STUDIO_SRC_STYLES, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new TailwindScanner({
    sources: [...scannerSources, ...compiler.sources],
  });
  const candidates = scanner.scan();
  const ast = compiler.build(candidates);

  return ast as unknown as string;
}

// The DevRev font CDN Referer-whitelists its origins; browsers loading a
// Vercel-deployed frame (or a Remotion-rendered frame inside headless
// Chrome with no CDN whitelist) hit 403. Node's fetch omits Referer by
// default, so we pull fonts server-side at bundle time, base64-inline them,
// and avoid any runtime CDN dependency.
const FONT_CDN = "https://files.dev.devrev-eng.ai/fonts";
const FONT_FAMILIES: Array<{ name: string; family: string; weight: string }> = [
  { name: "ChipDispVar.woff2", family: "Chip Display Variable", weight: "100 900" },
  { name: "ChipTextVar.woff2", family: "Chip Text Variable", weight: "100 900" },
  { name: "ChipMono-Regular.woff2", family: "Chip Mono", weight: "400" },
  { name: "ChipMono-Medium.woff2", family: "Chip Mono", weight: "500" },
];

export async function buildInlineFontFaceCss(): Promise<string> {
  const blocks: string[] = [];
  for (const f of FONT_FAMILIES) {
    const res = await fetch(`${FONT_CDN}/${f.name}`);
    if (!res.ok) {
      console.warn(`[frameBundleConfig] font fetch ${f.name} failed: ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    blocks.push(
      `@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${f.weight};font-display:swap}`,
    );
  }
  return blocks.join("\n");
}
```

- [ ] **Step 4: Run the new test to confirm it passes**

Run: `pnpm studio:test __tests__/server/shared/frameBundleConfig.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Migrate `server/vercel/bundler.ts` to import from the shared module**

Replace the top of `studio/server/vercel/bundler.ts` (the portion from line 1 through line 153 that holds `FONT_CDN`, `FONT_FAMILIES`, `buildFrameTailwindCss`, `buildInlineFontFaceCss`, `REPO_ROOT`, `REPO_NODE_MODULES`, `STUDIO_SRC_STYLES`, `devrevStubPlugin`, `ARCADE_ALIASES`) with:

```ts
import { build, type Plugin } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";
import {
  ARCADE_ALIASES,
  REPO_ROOT,
  REPO_NODE_MODULES,
  STUDIO_SRC_STYLES,
  devrevStubPlugin,
  buildFrameTailwindCss,
  buildInlineFontFaceCss,
} from "../shared/frameBundleConfig";

interface BuildContext {
  projectSlug: string;
  frameSlug: string;
  framePath: string;
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
}

export async function buildFrameBundle(ctx: BuildContext): Promise<{
  html: string;
  js: string;
  css: string;
}> {
  // ... (body unchanged; keeps using the imported helpers/constants identically)
}
```

Leave the `buildFrameBundle` function body (lines 163–285 in the current file) untouched. Only the imports and the module-level helpers/constants move. `type Plugin` stays imported because esbuild's types are used elsewhere if needed — if nothing in `bundler.ts` still uses `Plugin` directly after the move, drop it.

- [ ] **Step 6: Run the pre-existing Vercel bundler test — must still pass**

Run: `pnpm studio:test __tests__/server/vercel/bundler.test.ts`
Expected: Both existing tests PASS. This is the regression guard: the refactor must not change Vercel bundler behavior.

- [ ] **Step 7: Run the existing Vercel middleware test — must still pass**

Run: `pnpm studio:test __tests__/server/middleware/vercel.test.ts`
Expected: Both tests PASS.

- [ ] **Step 8: Commit**

```bash
git add studio/server/shared/frameBundleConfig.ts \
        studio/server/vercel/bundler.ts \
        studio/__tests__/server/shared/frameBundleConfig.test.ts
git commit -m "refactor(studio): extract shared frame-bundle config from vercel bundler

Moves ARCADE_ALIASES, devrevStubPlugin, buildFrameTailwindCss,
buildInlineFontFaceCss, and REPO_* constants into
server/shared/frameBundleConfig.ts so both the Vercel bundler and the
new Remotion renderer can consume them. No behavior change; existing
vercel bundler/middleware tests still pass."
```

### Task 0.3: Extend types and paths for clips

**Files:**
- Modify: `studio/server/types.ts`
- Modify: `studio/server/paths.ts`
- Modify (create or update): `studio/__tests__/server/types.test.ts`
- Create: `studio/__tests__/server/paths.test.ts` (or extend existing)

- [ ] **Step 1: Write a failing test for `ProjectSchema.clips`**

Open `studio/__tests__/server/types.test.ts`. Add this test (keep existing tests intact):

```ts
import { describe, it, expect } from "vitest";
import { projectSchema } from "../../server/types";

describe("projectSchema.clips", () => {
  it("accepts a project with a clips array", () => {
    const result = projectSchema.safeParse({
      name: "demo",
      slug: "demo",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      theme: "arcade",
      mode: "light",
      frames: [],
      clips: [
        {
          frameSlug: "hero",
          path: "/abs/path/to/hero-2026-04-30.mov",
          createdAt: "2026-04-30T00:01:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a project with no clips field (backwards compatible)", () => {
    const result = projectSchema.safeParse({
      name: "demo",
      slug: "demo",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      theme: "arcade",
      mode: "light",
      frames: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a clip with a missing required field", () => {
    const result = projectSchema.safeParse({
      name: "demo",
      slug: "demo",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      theme: "arcade",
      mode: "light",
      frames: [],
      clips: [{ frameSlug: "hero" }], // missing path + createdAt
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `pnpm studio:test __tests__/server/types.test.ts`
Expected: FAIL ("accepts a project with a clips array" fails because `clips` would be rejected as unknown field or silently accepted — depending on zod config; either way the 3rd test should fail because no schema validates the clip shape).

- [ ] **Step 3: Add `clipSchema` and extend `projectSchema` in `studio/server/types.ts`**

After the `frameSchema` definition (line 5–12), add:

```ts
export const clipSchema = z.object({
  frameSlug: z.string().regex(slugRegex),
  path: z.string(),
  createdAt: z.string(),
});
export type Clip = z.infer<typeof clipSchema>;
```

Then modify `projectSchema` (lines 14–30) — add the `clips` field alongside `deployments`:

```ts
export const projectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(slugRegex),
  createdAt: z.string(),
  updatedAt: z.string(),
  theme: z.enum(["arcade", "devrev-app"]),
  mode: z.enum(["light", "dark"]).default("light"),
  sessionId: z.string().optional(),
  computerConversationId: z.string().optional(),
  frames: z.array(frameSchema).default([]),
  coverThumbnail: z.string().optional(),
  deployments: z.array(z.object({
    frameSlug: z.string(),
    url: z.string(),
    createdAt: z.string(),
  })).optional(),
  clips: z.array(clipSchema).optional(),
});
export type Project = z.infer<typeof projectSchema>;
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `pnpm studio:test __tests__/server/types.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Add `clipsDir()` helper to `studio/server/paths.ts`**

Append to `studio/server/paths.ts`:

```ts
export function clipsDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "clips");
}
```

- [ ] **Step 6: Add a test for `clipsDir()` in `studio/__tests__/server/paths.test.ts`**

Append to the existing test file:

```ts
import { clipsDir, projectDir } from "../../server/paths";

describe("clipsDir", () => {
  it("returns projectDir/clips", () => {
    expect(clipsDir("foo")).toBe(projectDir("foo") + "/clips");
  });
});
```

- [ ] **Step 7: Run paths test**

Run: `pnpm studio:test __tests__/server/paths.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add studio/server/types.ts studio/server/paths.ts \
        studio/__tests__/server/types.test.ts \
        studio/__tests__/server/paths.test.ts
git commit -m "feat(studio): add Clip schema and clipsDir() path helper"
```

---

## Phase 1 — Composition generator (pure, testable)

`server/remotion/composition.ts` is a pure string generator. It has no Chromium dependency, no filesystem side effects, and is the clearest place to lock down the animation timing and canvas sizing before we touch the renderer.

### Task 1.1: `buildDefaultRootSource()` generator

**Files:**
- Create: `studio/server/remotion/composition.ts`
- Create: `studio/__tests__/server/remotion/composition.test.ts`

- [ ] **Step 1: Write failing tests for the generator**

Create `studio/__tests__/server/remotion/composition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDefaultRootSource } from "../../../server/remotion/composition";

const BASE_CTX = {
  framePath: "/abs/path/to/project/frames/hero",
  theme: "arcade" as const,
  mode: "light" as const,
  frameWidth: 1440,
};

describe("buildDefaultRootSource", () => {
  it("imports the frame from framePath + /index.tsx", () => {
    const src = buildDefaultRootSource(BASE_CTX);
    expect(src).toContain(`import Frame from "/abs/path/to/project/frames/hero/index.tsx"`);
  });

  it("wraps the frame in DevRevThemeProvider with the project mode", () => {
    const src = buildDefaultRootSource({ ...BASE_CTX, mode: "dark" });
    expect(src).toContain(`<DevRevThemeProvider mode="dark">`);
  });

  it("registers a Composition with id=frame-clip, 180 frames, 30 fps, 1366x768", () => {
    const src = buildDefaultRootSource(BASE_CTX);
    expect(src).toContain(`id="frame-clip"`);
    expect(src).toContain(`durationInFrames={180}`);
    expect(src).toContain(`fps={30}`);
    expect(src).toContain(`width={1366}`);
    expect(src).toContain(`height={768}`);
  });

  it("scales wide frames down to 1366 (scale = 1366 / frameWidth)", () => {
    // 1920px frame should scale to 1366/1920 ≈ 0.7114583333
    const src = buildDefaultRootSource({ ...BASE_CTX, frameWidth: 1920 });
    expect(src).toContain("const FRAME_SCALE =");
    expect(src).toMatch(/FRAME_SCALE\s*=\s*1366\s*\/\s*1920/);
  });

  it("does not scale frames narrower than 1366", () => {
    // 1024px frame should use scale 1 (natural size)
    const src = buildDefaultRootSource({ ...BASE_CTX, frameWidth: 1024 });
    expect(src).toContain("const FRAME_SCALE = 1");
  });

  it("uses a light-mode letterbox color when mode is light", () => {
    const src = buildDefaultRootSource({ ...BASE_CTX, mode: "light" });
    expect(src).toContain(`backgroundColor: "#f5f5f5"`);
  });

  it("uses a dark-mode letterbox color when mode is dark", () => {
    const src = buildDefaultRootSource({ ...BASE_CTX, mode: "dark" });
    expect(src).toContain(`backgroundColor: "#0a0a0a"`);
  });

  it("interpolates opacity over the full duration boundaries", () => {
    const src = buildDefaultRootSource(BASE_CTX);
    // Intro: [0, 24, 150, 180]; Values: [0, 1, 1, 0]
    expect(src).toContain("[0, 24, 150, 180]");
    expect(src).toContain("[0, 1, 1, 0]");
  });

  it("scales the intro from 0.98 to 1.0 over frames 0-24", () => {
    const src = buildDefaultRootSource(BASE_CTX);
    expect(src).toMatch(/\[0,\s*24\][,\s]+\[0\.98,\s*1(\.0)?\]/);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail (module does not exist)**

Run: `pnpm studio:test __tests__/server/remotion/composition.test.ts`
Expected: FAIL with "Failed to resolve '../../../server/remotion/composition'".

- [ ] **Step 3: Implement `studio/server/remotion/composition.ts`**

```ts
export interface CompositionContext {
  framePath: string;       // absolute path to the frame dir
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
  frameWidth: number;      // 375 | 1024 | 1440 | 1920
}

// Canvas + animation constants. Changing any of these invalidates the
// composition.test.ts snapshots — update both together.
const CANVAS_WIDTH = 1366;
const CANVAS_HEIGHT = 768;
const FPS = 30;
const DURATION_FRAMES = 180;   // 6s total
const INTRO_END_FRAME = 24;    // 0.8s fade-in
const OUTRO_START_FRAME = 150; // 1s fade-out at the end
const INTRO_SCALE_START = 0.98;
const INTRO_SCALE_END = 1.0;

const LETTERBOX_LIGHT = "#f5f5f5";
const LETTERBOX_DARK = "#0a0a0a";

export function buildDefaultRootSource(ctx: CompositionContext): string {
  // Forward-slash paths; Remotion's bundler expects POSIX-style imports.
  const framePath = ctx.framePath.replace(/\\/g, "/");

  // Scale factor: frames wider than the canvas scale down; narrower frames
  // render at natural size. This means mobile (375) frames sit small inside
  // the 1366 canvas, surrounded by letterbox — intentional.
  const scaleExpr = ctx.frameWidth > CANVAS_WIDTH
    ? `${CANVAS_WIDTH} / ${ctx.frameWidth}`
    : `1`;

  const letterbox = ctx.mode === "dark" ? LETTERBOX_DARK : LETTERBOX_LIGHT;

  return `import React from "react";
import { Composition, AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
import "@xorkavi/arcade-gen/styles.css";
import Frame from "${framePath}/index.tsx";

const FRAME_SCALE = ${scaleExpr};
const FRAME_WIDTH = ${ctx.frameWidth};

function ClipScene() {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, ${INTRO_END_FRAME}, ${OUTRO_START_FRAME}, ${DURATION_FRAMES}],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" }
  );
  const introScale = interpolate(
    frame,
    [0, ${INTRO_END_FRAME}],
    [${INTRO_SCALE_START}, ${INTRO_SCALE_END}],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "${letterbox}" }}>
      <AbsoluteFill style={{ opacity, transform: \`scale(\${introScale})\` }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: FRAME_WIDTH,
            transform: \`translateX(-50%) scale(\${FRAME_SCALE})\`,
            transformOrigin: "top center",
          }}
        >
          <DevRevThemeProvider mode="${ctx.mode}">
            <Frame />
          </DevRevThemeProvider>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="frame-clip"
    component={ClipScene}
    durationInFrames={${DURATION_FRAMES}}
    fps={${FPS}}
    width={${CANVAS_WIDTH}}
    height={${CANVAS_HEIGHT}}
  />
);
`;
}

// Exposed for the renderer to match — keep in sync with the emitted source.
export const CLIP_CONSTANTS = {
  compositionId: "frame-clip",
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  fps: FPS,
  durationInFrames: DURATION_FRAMES,
} as const;
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `pnpm studio:test __tests__/server/remotion/composition.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/remotion/composition.ts \
        studio/__tests__/server/remotion/composition.test.ts
git commit -m "feat(studio): add Remotion composition source generator

Pure buildDefaultRootSource() + CLIP_CONSTANTS. Emits a Root.tsx that
imports the target frame, wraps it in DevRevThemeProvider, scales frames
wider than 1366 down to fit, and animates 6s fade-in / hold / fade-out
at 30fps on a 1366x768 canvas."
```

---

## Phase 2 — Renderer pipeline

`server/remotion/renderer.ts` wraps `@remotion/bundler` + `@remotion/renderer`. It writes the generated `Root.tsx` to a temp dir, bundles it (reusing the shared bundle config), then renders. `onProgress` is forwarded to a caller-provided callback so the middleware can pump SSE events without the renderer knowing anything about HTTP.

### Task 2.1: `buildFrameClip()` renderer

**Files:**
- Create: `studio/server/remotion/renderer.ts`

No standalone unit test for the renderer — it requires Chromium and would be slow/flaky. Coverage comes from the middleware integration test in Phase 3, which is gated behind `SKIP_SLOW_TESTS`.

- [ ] **Step 1: Create `studio/server/remotion/renderer.ts`**

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  ARCADE_ALIASES,
  REPO_ROOT,
  REPO_NODE_MODULES,
  devrevStubPlugin,
} from "../shared/frameBundleConfig";
import { buildDefaultRootSource, CLIP_CONSTANTS } from "./composition";
import { studioRoot, clipsDir } from "../paths";
import type { Frame } from "../types";

export interface RenderContext {
  projectSlug: string;
  frameSlug: string;
  framePath: string;   // absolute path to the frame dir
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
  frameSize: Frame["size"]; // one of "375" | "1024" | "1440" | "1920"
}

export interface RenderProgress {
  renderedFrames: number;
  totalFrames: number;
  elapsedMs: number;
}

export interface RenderResult {
  path: string;         // absolute path to the .mov
  relativePath: string; // "clips/<frame>-<ts>.mov"
}

export interface RenderOptions {
  onProgress?: (p: RenderProgress) => void;
  abortSignal?: AbortSignal;
}

// Timestamp string safe for use in a filename: "2026-04-30T12-34-56-789Z"
function clipTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function buildFrameClip(
  ctx: RenderContext,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const startedAt = Date.now();
  const tempDir = path.join(studioRoot(), ".temp", `clip-${ctx.projectSlug}-${ctx.frameSlug}-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // 1. Generate Root.tsx
  const rootSource = buildDefaultRootSource({
    framePath: ctx.framePath,
    theme: ctx.theme,
    mode: ctx.mode,
    frameWidth: Number(ctx.frameSize),
  });
  const rootPath = path.join(tempDir, "Root.tsx");
  await fs.writeFile(rootPath, rootSource);

  // Remotion entry — imports the generated Root and calls registerRoot.
  const entryPath = path.join(tempDir, "index.ts");
  await fs.writeFile(
    entryPath,
    `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
`,
  );

  try {
    // 2. Bundle with @remotion/bundler.
    //    webpackOverride wires in the same alias + devrev stub plugin the
    //    Vercel bundler uses, so the frame's source resolves identically.
    const bundled = await bundle({
      entryPoint: entryPath,
      outDir: path.join(tempDir, "bundle"),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...(config.resolve ?? {}),
          alias: {
            ...((config.resolve as any)?.alias ?? {}),
            ...ARCADE_ALIASES,
          },
          modules: [
            ...((config.resolve as any)?.modules ?? ["node_modules"]),
            REPO_NODE_MODULES,
          ],
        },
      }),
    });

    // 3. Pick the composition we generated above.
    const composition = await selectComposition({
      serveUrl: bundled,
      id: CLIP_CONSTANTS.compositionId,
      inputProps: {},
    });

    // 4. Render.
    const filename = `${ctx.frameSlug}-${clipTimestamp()}.mov`;
    const outDir = clipsDir(ctx.projectSlug);
    await fs.mkdir(outDir, { recursive: true });
    const outputLocation = path.join(outDir, filename);

    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation,
      inputProps: {},
      onProgress: ({ renderedFrames }) => {
        opts.onProgress?.({
          renderedFrames,
          totalFrames: CLIP_CONSTANTS.durationInFrames,
          elapsedMs: Date.now() - startedAt,
        });
      },
      // @remotion/renderer accepts AbortSignal on v4+.
      signal: opts.abortSignal,
    });

    return {
      path: outputLocation,
      relativePath: path.join("clips", filename),
    };
  } finally {
    // Clean up the temp bundle dir regardless of success/failure.
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// `REPO_ROOT` is re-exported so callers that need to debug bundle paths
// (e.g. the middleware's error logs) don't have to import from `shared/`
// directly.
export { REPO_ROOT };
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `pnpm exec tsc --noEmit --project studio/tsconfig.json`
Expected: No errors from `server/remotion/renderer.ts`. If Remotion's v4 types differ from `{ renderedFrames, encodedFrames }` (e.g., the callback takes a single number), adjust the `onProgress` destructuring to match actual types. The rest of the logic stays the same.

- [ ] **Step 3: Commit**

```bash
git add studio/server/remotion/renderer.ts
git commit -m "feat(studio): add Remotion renderer pipeline

buildFrameClip() writes Root.tsx to a temp dir, bundles with
@remotion/bundler (reusing shared alias/stub plugin config), selects the
'frame-clip' composition, and renders to <projectDir>/clips/<frame>-<ts>.mov.
Forwards progress + supports AbortSignal for cancel handling."
```

---

## Phase 3 — Middleware (HTTP + SSE)

The middleware owns the in-memory render-state map, enforces one-render-per-project, wires SSE to `buildFrameClip`'s `onProgress`, handles cancellation, and serves clip files back for inline preview.

### Task 3.1: Middleware scaffolding and route matching

**Files:**
- Create: `studio/server/middleware/clip.ts`
- Create: `studio/__tests__/server/middleware/clip.test.ts`

- [ ] **Step 1: Write a failing test for route passthrough + missing body rejection**

Create `studio/__tests__/server/middleware/clip.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

describe("clipMiddleware", () => {
  it("passes through non-matching routes", async () => {
    const { clipMiddleware } = await import("../../../server/middleware/clip");
    const middleware = clipMiddleware();
    const req = { url: "/api/projects", method: "GET" } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects POST /api/projects/:slug/clip with missing frameSlug", async () => {
    const { clipMiddleware } = await import("../../../server/middleware/clip");
    const middleware = clipMiddleware();
    const req = {
      url: "/api/projects/test-project/clip",
      method: "POST",
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({});
      },
    } as any;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;
    await middleware(req, res, () => {});
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.objectContaining({ "Content-Type": "application/json" }));
  });
});
```

- [ ] **Step 2: Run test — confirm it fails (module not found)**

Run: `pnpm studio:test __tests__/server/middleware/clip.test.ts`
Expected: FAIL, "Failed to resolve '../../../server/middleware/clip'".

- [ ] **Step 3: Create `studio/server/middleware/clip.ts` with route scaffolding only**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFrameClip, type RenderProgress } from "../remotion/renderer";
import { projectJsonPath, frameDir, clipsDir } from "../paths";
import type { Project } from "../types";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

// In-memory render-state map. One render per project slug. Stale entries die
// with the process — acceptable, since renders must always be preceded by a
// client-initiated POST that surfaces 409 on conflict.
interface RenderState {
  renderId: string;
  promise: Promise<void>;
  abort: AbortController;
  // SSE subscribers. The stream emits the latest progress on subscribe so a
  // client that connected a few ms after the POST still sees an initial event.
  listeners: Set<(event: SseEvent) => void>;
  lastProgress?: RenderProgress;
  settled?: SseEvent; // stored done/error, replayed to late subscribers
}

type SseEvent =
  | { kind: "progress"; data: RenderProgress }
  | { kind: "done"; data: { path: string; relativePath: string } }
  | { kind: "error"; data: { code: string; message: string } };

const RENDERS = new Map<string, RenderState>();

const RENDER_TIMEOUT_MS = 180_000;

function makeRenderId(): string {
  // 8-char base36 is enough for single-process concurrency.
  return Math.random().toString(36).slice(2, 10);
}

function emit(state: RenderState, event: SseEvent) {
  if (event.kind === "progress") state.lastProgress = event.data;
  else state.settled = event;
  for (const fn of state.listeners) fn(event);
}

export function clipMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // POST /api/projects/:slug/clip
    const startMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clip$/i);
    if (startMatch && method === "POST") {
      const [, slug] = startMatch;
      try {
        const body = await readJson(req);
        const { frameSlug } = body ?? {};
        if (!frameSlug) {
          return send(res, 400, { error: { code: "missing_frame", message: "frameSlug required" } });
        }

        if (RENDERS.has(slug)) {
          return send(res, 409, {
            error: { code: "render_in_progress", message: "A clip is already being rendered for this project." },
          });
        }

        const projectJson: Project = JSON.parse(await fs.readFile(projectJsonPath(slug), "utf-8"));
        const frame = projectJson.frames.find((f) => f.slug === frameSlug);
        if (!frame) {
          return send(res, 404, { error: { code: "frame_not_found", message: "Frame not found" } });
        }

        const renderId = makeRenderId();
        const abort = new AbortController();
        const state: RenderState = {
          renderId,
          abort,
          listeners: new Set(),
          promise: Promise.resolve(),
        };

        const timeoutId = setTimeout(() => abort.abort(new Error("timeout")), RENDER_TIMEOUT_MS);

        state.promise = (async () => {
          try {
            const result = await buildFrameClip(
              {
                projectSlug: slug,
                frameSlug,
                framePath: frameDir(slug, frameSlug),
                theme: projectJson.theme,
                mode: projectJson.mode,
                frameSize: frame.size,
              },
              {
                onProgress: (p) => emit(state, { kind: "progress", data: p }),
                abortSignal: abort.signal,
              },
            );

            // Persist the clip record.
            projectJson.clips ??= [];
            projectJson.clips.push({
              frameSlug,
              path: result.path,
              createdAt: new Date().toISOString(),
            });
            await fs.writeFile(projectJsonPath(slug), JSON.stringify(projectJson, null, 2));

            emit(state, { kind: "done", data: { path: result.path, relativePath: result.relativePath } });
          } catch (err: any) {
            const isTimeout = abort.signal.aborted && err?.message === "timeout";
            const isCancelled = abort.signal.aborted && !isTimeout;
            const code = isTimeout
              ? "timeout"
              : isCancelled
              ? "cancelled"
              : /ENOSPC/.test(String(err))
              ? "disk_full"
              : /bundle|esbuild|webpack|compile/i.test(String(err))
              ? "bundle_failed"
              : "render_failed";
            const message = err?.message || String(err);
            emit(state, { kind: "error", data: { code, message } });
          } finally {
            clearTimeout(timeoutId);
            // Keep state in the map briefly so late SSE subscribers can replay
            // the settled event; purge after 10s.
            setTimeout(() => RENDERS.delete(slug), 10_000);
          }
        })();

        RENDERS.set(slug, state);

        return send(res, 202, { renderId });
      } catch (err: any) {
        console.error("[clip] start failed:", err);
        return send(res, 500, { error: { code: "internal", message: err?.message ?? "Internal error" } });
      }
    }

    // GET /api/projects/:slug/clip/:renderId/progress (SSE)
    const progressMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clip\/([a-z0-9]+)\/progress$/i);
    if (progressMatch && method === "GET") {
      const [, slug, renderId] = progressMatch;
      const state = RENDERS.get(slug);
      if (!state || state.renderId !== renderId) {
        return send(res, 404, { error: { code: "not_found", message: "Render not found" } });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const write = (event: SseEvent) => {
        res.write(`event: ${event.kind}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      };

      // Replay the last progress + settled event to a late subscriber.
      if (state.lastProgress) write({ kind: "progress", data: state.lastProgress });
      if (state.settled) {
        write(state.settled);
        res.end();
        return;
      }

      state.listeners.add(write);
      req.on("close", () => state.listeners.delete(write));
      return;
    }

    // DELETE /api/projects/:slug/clip/:renderId
    const cancelMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clip\/([a-z0-9]+)$/i);
    if (cancelMatch && method === "DELETE") {
      const [, slug, renderId] = cancelMatch;
      const state = RENDERS.get(slug);
      if (!state || state.renderId !== renderId) {
        return send(res, 404, { error: { code: "not_found", message: "Render not found" } });
      }
      state.abort.abort(new Error("cancelled"));
      return send(res, 204);
    }

    // GET /api/projects/:slug/clips/:file
    const fileMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clips\/([a-zA-Z0-9._-]+\.mov)$/);
    if (fileMatch && method === "GET") {
      const [, slug, file] = fileMatch;
      const fullPath = path.join(clipsDir(slug), file);
      try {
        const stat = await fs.stat(fullPath);
        res.writeHead(200, {
          "Content-Type": "video/quicktime",
          "Content-Length": String(stat.size),
          "Accept-Ranges": "bytes",
        });
        const fh = await fs.open(fullPath, "r");
        const stream = fh.createReadStream();
        stream.pipe(res);
        stream.on("close", () => fh.close().catch(() => {}));
      } catch {
        return send(res, 404, { error: { code: "clip_not_found", message: "Clip not found" } });
      }
      return;
    }

    next?.();
  };
}
```

- [ ] **Step 4: Run the middleware test — confirm it passes**

Run: `pnpm studio:test __tests__/server/middleware/clip.test.ts`
Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/clip.ts \
        studio/__tests__/server/middleware/clip.test.ts
git commit -m "feat(studio): add clip middleware — POST/GET/DELETE/file routes

In-memory render-state map, one-render-per-project (409 Conflict on
collision), SSE progress stream with replay for late subscribers,
AbortController-driven cancellation, 180s timeout, and a file route
that serves the .mov back for inline preview."
```

### Task 3.2: Register clip middleware in Vite config

**Files:**
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Add the import**

In `studio/vite.config.ts`, add after the existing `vercelMiddleware` import (line 16):

```ts
import { clipMiddleware } from "./server/middleware/clip";
```

- [ ] **Step 2: Register the middleware**

In the `apiPlugin()` function's `configureServer` block (around line 31), add right after `server.middlewares.use(vercelMiddleware());`:

```ts
server.middlewares.use(clipMiddleware());
```

- [ ] **Step 3: Start the dev server, verify it boots**

Run: `pnpm studio`
Expected: Vite starts on port 5556 without errors. Open the browser at http://localhost:5556; the existing app loads normally.

- [ ] **Step 4: Smoke-test the clip-file route returns 404 for a non-existent file**

With the dev server running, in another terminal:
Run: `curl -i http://localhost:5556/api/projects/nonexistent/clips/missing.mov`
Expected: `HTTP/1.1 404 Not Found` with `{"error":{"code":"clip_not_found",...}}` body.

- [ ] **Step 5: Stop the dev server and commit**

```bash
git add studio/vite.config.ts
git commit -m "feat(studio): register clipMiddleware in Vite dev server"
```

### Task 3.3: Integration test (gated, slow)

**Files:**
- Modify: `studio/__tests__/server/middleware/clip.test.ts`

- [ ] **Step 1: Add a slow integration test that renders a minimal real frame**

Append to `studio/__tests__/server/middleware/clip.test.ts`:

```ts
import os from "node:os";
import fs from "node:fs";

const slow = process.env.SKIP_SLOW_TESTS === "1" ? describe.skip : describe;

slow("clipMiddleware — end-to-end render (slow)", () => {
  it("renders a minimal frame to a .mov file on disk", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-clip-e2e-"));
    process.env.ARCADE_STUDIO_ROOT = tmp;

    // Fake project layout.
    const slug = "p";
    const frameSlug = "f";
    const projectDir = path.join(tmp, "projects", slug);
    const frameDir = path.join(projectDir, "frames", frameSlug);
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(
      path.join(frameDir, "index.tsx"),
      `export default function F(){return <div style={{padding:40,fontSize:40}}>hi</div>;}\n`,
    );
    fs.writeFileSync(
      path.join(projectDir, "project.json"),
      JSON.stringify({
        name: "p",
        slug,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        theme: "arcade",
        mode: "light",
        frames: [{ slug: frameSlug, name: "f", createdAt: new Date().toISOString(), size: "1024" }],
      }),
    );

    try {
      const { clipMiddleware } = await import("../../../server/middleware/clip");
      const middleware = clipMiddleware();

      // POST to start render.
      let responseStatus = 0;
      let responseBody: any;
      const req = {
        url: `/api/projects/${slug}/clip`,
        method: "POST",
        [Symbol.asyncIterator]: async function* () {
          yield JSON.stringify({ frameSlug });
        },
      } as any;
      const res = {
        writeHead: (s: number) => { responseStatus = s; return res; },
        end: (body: any) => { responseBody = body ? JSON.parse(body) : null; return res; },
      } as any;
      await middleware(req, res, () => {});
      expect(responseStatus).toBe(202);
      expect(responseBody.renderId).toBeTypeOf("string");

      // Poll the in-memory state by importing the module and accessing
      // its exported map — we don't; instead, wait for the clip file to
      // appear on disk or timeout.
      const clipDir = path.join(projectDir, "clips");
      const deadline = Date.now() + 120_000;
      let files: string[] = [];
      while (Date.now() < deadline) {
        if (fs.existsSync(clipDir)) {
          files = fs.readdirSync(clipDir).filter((f) => f.endsWith(".mov"));
          if (files.length > 0) {
            const stat = fs.statSync(path.join(clipDir, files[0]));
            if (stat.size > 0) break;
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(files.length).toBeGreaterThan(0);

      // Assert project.json.clips got updated.
      const updated = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf-8"));
      expect(updated.clips).toBeDefined();
      expect(updated.clips.length).toBe(1);
      expect(updated.clips[0].frameSlug).toBe(frameSlug);
    } finally {
      delete process.env.ARCADE_STUDIO_ROOT;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 150_000);
});
```

- [ ] **Step 2: Run the slow test locally (first time pulls Chromium)**

Run: `pnpm studio:test __tests__/server/middleware/clip.test.ts`
Expected: Chromium downloads on first run (one-time, ~120 MB into `~/.remotion/`). Test passes within 90 seconds. A `.mov` exists on disk; `project.json.clips[]` has one entry.

- [ ] **Step 3: Verify it skips when `SKIP_SLOW_TESTS=1`**

Run: `SKIP_SLOW_TESTS=1 pnpm studio:test __tests__/server/middleware/clip.test.ts`
Expected: Only the fast tests run; the slow describe block is skipped.

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/server/middleware/clip.test.ts
git commit -m "test(studio): slow e2e test for clip render pipeline"
```

---

## Phase 4 — Frontend (ShareModal)

The `ShareModal` gains a "Share as" segmented control and branches between the Vercel flow (unchanged) and the clip flow. Clip flow has Idle → Rendering → Success/Error states driven by an SSE subscription.

### Task 4.1: Add "Share as" toggle and mode state

**Files:**
- Modify: `studio/src/components/shell/ShareModal.tsx`

- [ ] **Step 1: Add `ShareMode` state and segmented control at the top of the modal body**

Open `studio/src/components/shell/ShareModal.tsx`. At the top of the component body, add:

```tsx
type ShareMode = "url" | "clip";
const [shareMode, setShareMode] = useState<ShareMode>("url");
```

Replace the first child of `<Modal.Body>` with:

```tsx
<Modal.Body>
  {/* Share-as segmented control */}
  <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 8, background: "var(--bg-neutral-subtle)", marginBottom: 16 }}>
    <button
      type="button"
      onClick={() => setShareMode("url")}
      disabled={loading}
      style={{
        flex: 1,
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: shareMode === "url" ? 540 : 440,
        background: shareMode === "url" ? "var(--bg-neutral-default)" : "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      Live URL
    </button>
    <button
      type="button"
      onClick={() => setShareMode("clip")}
      disabled={loading}
      style={{
        flex: 1,
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: shareMode === "clip" ? 540 : 440,
        background: shareMode === "clip" ? "var(--bg-neutral-default)" : "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      Animated clip
    </button>
  </div>

  {/* ... existing content continues below */}
```

- [ ] **Step 2: Reset mode-specific state when `handleClose` runs**

Find `handleClose` and add `setShareMode("url")` before `onClose()`.

- [ ] **Step 3: Run the dev server and eyeball the toggle**

Run: `pnpm studio`
Open http://localhost:5556, navigate to a project, click Share. Confirm the toggle shows "Live URL" / "Animated clip", the current flow still works when "Live URL" is selected, and clicking "Animated clip" changes the toggle appearance but does not yet change behavior.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/shell/ShareModal.tsx
git commit -m "feat(studio/share): add Share-as toggle to ShareModal (UI-only)"
```

### Task 4.2: Branch the action button and body between url/clip modes

**Files:**
- Modify: `studio/src/components/shell/ShareModal.tsx`

- [ ] **Step 1: Introduce clip-specific state**

At the top of the component, add:

```tsx
type ClipState = "idle" | "rendering" | "success" | "error";
const [clipState, setClipState] = useState<ClipState>("idle");
const [clipProgress, setClipProgress] = useState<{ frame: number; totalFrames: number } | null>(null);
const [clipResult, setClipResult] = useState<{ path: string; relativePath: string } | null>(null);
const [clipError, setClipError] = useState<string | null>(null);
const [renderId, setRenderId] = useState<string | null>(null);
const eventSourceRef = useRef<EventSource | null>(null);
```

Import `useRef` from React at the top of the file (keep the existing `useState` import):

```tsx
import { useState, useRef } from "react";
```

- [ ] **Step 2: Add the clip-start action**

Add a new function inside the component, parallel to `handleDeploy`:

```tsx
async function handleGenerateClip() {
  if (!selectedFrame) return;
  setClipState("rendering");
  setClipProgress(null);
  setClipResult(null);
  setClipError(null);
  try {
    const res = await fetch(`/api/projects/${projectSlug}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameSlug: selectedFrame }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Render failed: ${res.status}`);
    }
    const { renderId: id } = await res.json();
    setRenderId(id);

    const es = new EventSource(`/api/projects/${projectSlug}/clip/${id}/progress`);
    eventSourceRef.current = es;
    es.addEventListener("progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setClipProgress({ frame: data.renderedFrames, totalFrames: data.totalFrames });
    });
    es.addEventListener("done", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setClipResult(data);
      setClipState("success");
      es.close();
      eventSourceRef.current = null;
    });
    es.addEventListener("error", (e) => {
      // SSE 'error' event is also fired by the browser on disconnect with no
      // message — only act on it if we have a structured payload.
      const msg = (e as MessageEvent).data;
      if (!msg) return;
      try {
        const data = JSON.parse(msg);
        setClipError(data.message || data.code || "Render failed");
        setClipState("error");
        es.close();
        eventSourceRef.current = null;
      } catch {
        /* ignore */
      }
    });
  } catch (err: any) {
    setClipError(err.message);
    setClipState("error");
  }
}
```

- [ ] **Step 3: Add a cancel handler**

```tsx
async function handleCancelClip() {
  if (!renderId) return;
  eventSourceRef.current?.close();
  eventSourceRef.current = null;
  try {
    await fetch(`/api/projects/${projectSlug}/clip/${renderId}`, { method: "DELETE" });
  } catch { /* ignore */ }
  setClipState("idle");
  setRenderId(null);
  setClipProgress(null);
}
```

- [ ] **Step 4: Extend `handleClose` to close the SSE stream**

Update `handleClose`:

```tsx
function handleClose() {
  eventSourceRef.current?.close();
  eventSourceRef.current = null;
  setSelectedFrame(null);
  setShareUrl(null);
  setError(null);
  setCopied(false);
  setShareMode("url");
  setClipState("idle");
  setClipProgress(null);
  setClipResult(null);
  setClipError(null);
  setRenderId(null);
  onClose();
}
```

- [ ] **Step 5: Branch the footer action button**

Inside the `<Modal.Footer>` block, after the existing Cancel/Deploy branch, add a clip-mode variant. The footer body should read roughly:

```tsx
<Modal.Footer>
  {shareMode === "url" ? (
    // existing deploy flow
    shareUrl ? (
      <>
        <Button variant="secondary" onClick={() => window.open(shareUrl, "_blank")}>Open in New Tab</Button>
        <Button variant="primary" onClick={handleCopy}>{copied ? "Copied!" : "Copy Link"}</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={handleClose}>Cancel</Button>
        <Button variant="primary" onClick={handleDeploy} disabled={!selectedFrame || loading || frames.length === 0}>
          {loading ? "Deploying…" : "Deploy to Vercel"}
        </Button>
      </>
    )
  ) : (
    // clip flow
    clipState === "success" ? (
      <>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
      </>
    ) : clipState === "rendering" ? (
      <>
        <Button variant="secondary" onClick={handleCancelClip}>Cancel</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={handleClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleGenerateClip}
          disabled={!selectedFrame || clipState === "rendering" || frames.length === 0}
        >
          {clipState === "error" ? "Retry" : "Generate clip"}
        </Button>
      </>
    )
  )}
</Modal.Footer>
```

- [ ] **Step 6: Branch the modal body for clip states**

Inside `<Modal.Body>` after the segmented control, branch:

```tsx
{shareMode === "url" ? (
  // EXISTING URL BODY (frame picker / shareUrl result / error)
  shareUrl ? (/* existing success panel */) : (/* existing picker + error */)
) : (
  // CLIP BODY
  clipState === "success" && clipResult ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <video
        src={`/api/projects/${projectSlug}/${clipResult.relativePath}`}
        autoPlay
        muted
        loop
        playsInline
        style={{ width: "100%", borderRadius: 8, background: "#000" }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => window.open(`/api/projects/${projectSlug}/${clipResult.relativePath}`, "_blank")}>Open</Button>
        <Button variant="secondary" onClick={async () => {
          await fetch(`/api/projects/${projectSlug}/clips/${encodeURIComponent(clipResult.path)}/reveal`, { method: "POST" });
        }}>Reveal in Finder</Button>
        <Button variant="primary" onClick={async () => {
          await fetch(`/api/projects/${projectSlug}/clips/${encodeURIComponent(clipResult.path)}/desktop`, { method: "POST" });
        }}>Save to Desktop</Button>
      </div>
      <code style={{ display: "block", padding: 8, borderRadius: 6, background: "var(--bg-neutral-subtle)", fontSize: 11, wordBreak: "break-all", userSelect: "all" }}>
        {clipResult.path}
      </code>
    </div>
  ) : clipState === "rendering" ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 24, alignItems: "center" }}>
      <div style={{ fontSize: 13 }}>
        {clipProgress ? `Rendering… ${clipProgress.frame} / ${clipProgress.totalFrames} frames` : "Starting render…"}
      </div>
      <div style={{ width: "100%", height: 4, borderRadius: 2, background: "var(--bg-neutral-subtle)", overflow: "hidden" }}>
        <div style={{
          width: clipProgress ? `${Math.round((clipProgress.frame / clipProgress.totalFrames) * 100)}%` : "5%",
          height: "100%",
          background: "var(--fg-brand-primary)",
          transition: "width 200ms linear",
        }} />
      </div>
    </div>
  ) : clipState === "error" ? (
    <>
      {/* Same picker as idle, plus error banner */}
      {/* (render the same frame-picker as url mode) */}
      <div role="alert" style={{ padding: 12, borderRadius: 8, background: "var(--bg-alert-subtle)", color: "var(--fg-alert-prominent)", fontSize: 13, marginTop: 12 }}>
        {clipError}
      </div>
    </>
  ) : (
    // IDLE — same frame picker as url mode
    null /* rendered above outside the branch; see next step */
  )
)}
```

Because the frame-picker block is shared between both modes (url-idle and clip-idle/error), factor it out. Pull the picker into a local variable at the top of the body:

```tsx
const framePicker = frames.length === 0 ? (
  <p style={{ margin: 0, fontSize: 13, color: "var(--fg-neutral-subtle)" }}>
    This project has no frames yet. Generate one first, then come back to share it.
  </p>
) : (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {frames.map((frame) => {
      const checked = selectedFrame === frame.slug;
      return (
        <label key={frame.slug} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, cursor: "pointer", border: `1px solid var(--stroke-neutral-${checked ? "prominent" : "subtle"})`, background: checked ? "var(--bg-neutral-subtle)" : "transparent" }}>
          <input type="radio" name="share-frame" value={frame.slug} checked={checked} onChange={(e) => setSelectedFrame(e.target.value)} style={{ width: 16, height: 16, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 540 }}>{frame.name}</div>
            <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>{frame.size}px</div>
          </div>
        </label>
      );
    })}
  </div>
);
```

Use `framePicker` inside both the url-idle branch and the clip-idle/error branch.

- [ ] **Step 7: Smoke-test the flow in the browser**

Run: `pnpm studio`
Open a project with at least one frame. Click Share, switch to "Animated clip", pick a frame, click Generate clip.
Expected: Rendering state appears with frame-count progress; within ~30–60s, Success state appears with an inline autoplaying `<video>`; clicking Close returns to the default state.

If the render fails: the error state shows the error message and a "Retry" button.

- [ ] **Step 8: Commit**

```bash
git add studio/src/components/shell/ShareModal.tsx
git commit -m "feat(studio/share): clip generation flow in ShareModal

Animated-clip branch of the Share modal drives a POST/SSE pipeline:
start render, stream progress, render .mov, show inline video preview
with Open / Reveal in Finder / Save to Desktop actions. Cancel during
rendering aborts the server-side render."
```

### Task 4.3: Server-side handlers for Reveal-in-Finder and Save-to-Desktop

The frontend calls `POST /api/projects/:slug/clips/:encodedPath/reveal` and `/desktop`. Wire these up.

**Files:**
- Modify: `studio/server/middleware/clip.ts`

- [ ] **Step 1: Add reveal and desktop routes in `clipMiddleware`**

Inside the middleware function, after the file-serve route but before `next?.()`, add:

```ts
// POST /api/projects/:slug/clips/:encodedPath/reveal
const revealMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clips\/([^/]+)\/reveal$/i);
if (revealMatch && method === "POST") {
  const [, slug, encoded] = revealMatch;
  const absPath = decodeURIComponent(encoded);
  if (!absPath.startsWith(clipsDir(slug))) {
    return send(res, 400, { error: { code: "out_of_scope", message: "Path is not inside the project's clips directory." } });
  }
  const { spawn } = await import("node:child_process");
  spawn("open", ["-R", absPath], { stdio: "ignore", detached: true }).unref();
  return send(res, 204);
}

// POST /api/projects/:slug/clips/:encodedPath/desktop
const desktopMatch = url.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/clips\/([^/]+)\/desktop$/i);
if (desktopMatch && method === "POST") {
  const [, slug, encoded] = desktopMatch;
  const absPath = decodeURIComponent(encoded);
  if (!absPath.startsWith(clipsDir(slug))) {
    return send(res, 400, { error: { code: "out_of_scope", message: "Path is not inside the project's clips directory." } });
  }
  const os = await import("node:os");
  const desktopDir = path.join(os.homedir(), "Desktop");
  const name = `arcade-clip-${slug}-${path.basename(absPath)}`;
  const dest = path.join(desktopDir, name);
  await fs.copyFile(absPath, dest);
  return send(res, 200, { path: dest });
}
```

- [ ] **Step 2: Confirm the existing fast middleware tests still pass**

Run: `pnpm studio:test __tests__/server/middleware/clip.test.ts`
Expected: Fast tests pass. (The slow e2e test is independent.)

- [ ] **Step 3: Smoke-test the two actions in the browser**

With a successful clip showing in the modal:
- Click **Reveal in Finder** → Finder opens, clip is selected.
- Click **Save to Desktop** → `~/Desktop/arcade-clip-<slug>-<frame>-<ts>.mov` appears.

- [ ] **Step 4: Commit**

```bash
git add studio/server/middleware/clip.ts
git commit -m "feat(studio): add /reveal and /desktop clip action routes

POST /api/projects/:slug/clips/:path/reveal opens Finder on the clip.
POST /api/projects/:slug/clips/:path/desktop copies the clip to ~/Desktop
with a prefixed filename. Both validate the path is inside the project's
clips directory to block path traversal."
```

---

## Phase 5 — Verification

End-to-end check against the spec's success criteria. No new code; this phase is a conscious check that all acceptance criteria hold.

### Task 5.1: Success-criteria walkthrough

- [ ] **Step 1: Start a fresh studio session**

Run: `pnpm studio`. Open http://localhost:5556.

- [ ] **Step 2: Check the Share-as toggle**

Open any project with ≥ 1 frame. Click Share. Toggle between Live URL and Animated clip; confirm the action button swaps between "Deploy to Vercel" and "Generate clip" and that the frame picker persists.

- [ ] **Step 3: Check one-click clip generation end-to-end**

Switch to Animated clip. Pick a frame. Click Generate clip. Confirm:
- Rendering state appears with progress counter incrementing.
- Success state appears with an inline autoplaying video.
- File path displayed looks like `~/Library/Application Support/arcade-studio/projects/<slug>/clips/<frame>-<ts>.mov`.

- [ ] **Step 4: Check `project.json.clips[]`**

Run: `cat "$HOME/Library/Application Support/arcade-studio/projects/<slug>/project.json" | jq .clips`
Expected: An array with one entry `{ frameSlug, path, createdAt }`.

- [ ] **Step 5: Check the three success actions**

- **Open** → opens the .mov in a new tab.
- **Reveal in Finder** → Finder opens with the clip highlighted.
- **Save to Desktop** → clip appears on the Desktop with `arcade-clip-<slug>-<frame>-<ts>.mov` name.

- [ ] **Step 6: Check the 409 collision behavior**

While a render is in progress, open the same project in a second browser tab (or second window) and try Generate clip again. Expected: error state with the "Generate clip" collision message ("A clip is already being rendered for this project."); the first render continues and eventually succeeds in the first tab.

- [ ] **Step 7: Check cancel behavior**

Start a new render. Before it finishes, click Cancel. Expected: state returns to idle; the partial `.mov` (if any) is not finalized. Verify no ghost state blocks a new render — click Generate clip again immediately and confirm it starts.

- [ ] **Step 8: Check bundle-error surfacing**

Introduce a syntax error into a frame's `index.tsx` (via the agent chat, or manually edit the file). Trigger a clip render. Expected: error state shows the bundle failure message ("Frame has build errors" or similar). Fix the frame and retry — next render succeeds.

- [ ] **Step 9: Run the full test suite**

Run: `SKIP_SLOW_TESTS=1 pnpm studio:test`
Expected: All tests PASS. In particular, `__tests__/server/vercel/bundler.test.ts` and `__tests__/server/middleware/vercel.test.ts` must still pass unchanged — the shared-config refactor in Phase 0 has no Vercel-visible behavior change.

- [ ] **Step 10: Commit any last documentation / CHANGELOG**

If `studio/ROADMAP.md` has a corresponding entry (it does not in v1 — this was unplanned), add one line under a "Done" section. Otherwise skip.

```bash
# only if there was a ROADMAP change
git add studio/ROADMAP.md
git commit -m "docs(studio): note Remotion clip feature in roadmap"
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Plan task |
|---|---|
| Share modal "Share as" segmented control | Task 4.1 |
| Frame picker shared between modes | Task 4.2 (framePicker variable) |
| One-click default clip — no prompt, 6s, 1366×768, `.mov` | Tasks 1.1 + 2.1 (composition + renderer constants) |
| Intro 0.8s fade + scale, hold, 1s fade-out | Task 1.1 (composition generator, interpolate boundaries) |
| 1366×768 canvas, scale wide frames down, natural size otherwise | Task 1.1 (FRAME_SCALE expression) |
| Letterbox fallback `#f5f5f5` / `#0a0a0a` | Task 1.1 (LETTERBOX_LIGHT / LETTERBOX_DARK) |
| Canonical clip at `~/.../projects/<slug>/clips/` | Task 0.3 (clipsDir helper) + Task 2.1 (renderer output) |
| `project.json.clips[]` persistence | Task 3.1 (middleware success handler) |
| Save-to-Desktop copy | Task 4.3 |
| Reveal-in-Finder | Task 4.3 |
| Inline video preview | Task 4.2 |
| SSE progress events | Task 3.1 (emit + listeners map) |
| One render per project (409) | Task 3.1 (RENDERS map guard) |
| 180s timeout | Task 3.1 (RENDER_TIMEOUT_MS) |
| Cancel aborts render + cleans partial file | Task 3.1 (DELETE route) + Task 4.2 (handleCancelClip) |
| `bundle_failed` / `render_failed` / `timeout` / `disk_full` error codes | Task 3.1 (error code classifier) |
| Zod `ClipSchema` + `Project.clips?` | Task 0.3 |
| Shared bundler config refactor (no Vercel behavior change) | Task 0.2 + regression guarded by existing vercel/bundler.test.ts |
| Composition unit tests | Task 1.1 |
| Middleware integration test (gated SKIP_SLOW_TESTS) | Task 3.3 |
| Collision test | Task 5.1 Step 6 (manual); the fast middleware test can be extended if we want automated coverage — not required by spec |

All spec requirements map to at least one task. No gaps.

**Placeholder scan:** No TBDs, no "handle edge cases", no "add validation", no "similar to Task N". Code blocks complete. ✓

**Type/name consistency check:**
- `Clip` type exported from `server/types.ts` (Task 0.3) matches the shape persisted by the middleware (Task 3.1: `{ frameSlug, path, createdAt }`). ✓
- `clipsDir` (Task 0.3) used by both the renderer (Task 2.1) and the middleware (Task 3.1, Task 4.3). ✓
- `CLIP_CONSTANTS.compositionId = "frame-clip"` emitted by composition.ts (Task 1.1) and consumed by renderer.ts's `selectComposition({ id: CLIP_CONSTANTS.compositionId })` (Task 2.1). ✓
- `clipMiddleware` exported by `server/middleware/clip.ts` (Task 3.1) and imported in `vite.config.ts` (Task 3.2). ✓
- `RenderProgress` type exported by `server/remotion/renderer.ts` (Task 2.1) and consumed by `server/middleware/clip.ts` (Task 3.1). ✓

**One potential pitfall flagged for the implementer:**
- In Task 2.1, the exact shape of Remotion v4's `renderMedia` `onProgress` callback and `signal` option should be verified against the installed version. If the callback signature or property name differs, adjust at that step; the surrounding logic does not change.
