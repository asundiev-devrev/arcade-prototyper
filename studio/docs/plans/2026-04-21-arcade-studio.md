# Arcade Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `arcade-studio`, an internal macOS tool that lets DevRev designers prototype features against the real arcade-gen design system through a conversational agent, with live multi-frame rendering and optional Figma input.

**Architecture:** A new `studio/` workspace inside the `arcade-gen` repo, parallel to `playground/`. Single Vite dev server + browser tab with two panes (chat, viewport). Every chat turn spawns a pinned `@anthropic-ai/claude-code` subprocess with stream-json output. Frames are real React modules served via a custom Vite plugin and rendered in one iframe each with HMR.

**Tech Stack:** Vite 8, React 19, TypeScript 5.9, Tailwind v4, arcade-gen (via `../src` alias), `@anthropic-ai/claude-code` CLI, figma-cli (local clone at `~/figma-cli`), AWS Bedrock via designer's SSO credentials. Tests: Vitest 4 + Testing Library + supertest-style fetch for middleware.

**Spec:** `docs/superpowers/specs/2026-04-21-arcade-studio-design.md`

---

## File Structure

All paths relative to the arcade-gen repo root unless noted. New code lives under `studio/`.

### New files in `studio/`

```
studio/
├── package.json                              # Studio workspace: @anthropic-ai/claude-code pinned
├── tsconfig.json                             # Extends arcade-gen root tsconfig
├── vite.config.ts                            # Plugins: react, tailwind, mount API + frame plugins
├── index.html                                # Root HTML, loads src/main.tsx
├── README.md                                 # Developer intro to the studio workspace
├── src/
│   ├── main.tsx                              # React mount + Arcade theme provider
│   ├── App.tsx                               # Router: project list vs project detail
│   ├── routes/
│   │   ├── ProjectList.tsx                   # Home screen — cards, search, "+ New project"
│   │   └── ProjectDetail.tsx                 # Chat + viewport layout
│   ├── components/
│   │   ├── Header.tsx                        # App header (back, name, theme, dev toggle)
│   │   ├── chat/
│   │   │   ├── ChatPane.tsx                  # Left pane container
│   │   │   ├── MessageList.tsx               # Scroll + bubbles
│   │   │   ├── AgentNarration.tsx            # Plain-language tool-call rendering
│   │   │   ├── MessageBubble.tsx             # User/agent bubble
│   │   │   ├── ImageAttachmentChip.tsx       # Thumbnail above input
│   │   │   ├── PromptInput.tsx               # Textarea + Cmd+Enter + action chips
│   │   │   └── FigmaUrlModal.tsx             # "+ From Figma" form
│   │   ├── viewport/
│   │   │   ├── Viewport.tsx                  # Horizontal row of frames
│   │   │   ├── FrameCard.tsx                 # Naked frame + label + corner menu
│   │   │   ├── FrameCornerMenu.tsx           # Size presets, rename, duplicate, delete
│   │   │   └── EmptyViewport.tsx             # Drop target + prompt-to-start
│   │   ├── projects/
│   │   │   ├── ProjectCard.tsx               # Thumbnail + name + date + overflow
│   │   │   ├── NewProjectModal.tsx           # Name + theme picker
│   │   │   └── ProjectSearch.tsx             # Name filter
│   │   ├── devmode/
│   │   │   ├── DevModePanel.tsx              # Right-slide file tree
│   │   │   └── FileTree.tsx                  # Read-only, Reveal-in-Finder
│   │   └── feedback/
│   │       ├── ErrorBanner.tsx               # Plain-language error surface
│   │       └── AuthExpiredNotice.tsx         # AWS SSO expired message
│   ├── hooks/
│   │   ├── useProject.ts                     # Fetches project.json + watches chat-history
│   │   ├── useProjects.ts                    # List-screen data hook
│   │   ├── useChatStream.ts                  # EventSource wrapper for /api/chat
│   │   ├── useFrames.ts                      # Lists frames for a project, watches HMR
│   │   └── useTheme.ts                       # Light/dark toggle, persisted
│   ├── lib/
│   │   ├── api.ts                            # Typed fetch helpers for /api/*
│   │   ├── streamJson.ts                     # Parse Claude Code stream-json events
│   │   ├── figmaUrl.ts                       # URL detection + extraction
│   │   └── pathing.ts                        # Project paths, slug helpers
│   └── styles/
│       └── studio.css                        # Studio-only (non-frame) overrides
├── server/                                   # Vite middleware & filesystem helpers
│   ├── paths.ts                              # Single source of truth for all dirs
│   ├── projects.ts                           # Project CRUD (filesystem)
│   ├── claudeCode.ts                         # Subprocess wrapper, stream-json parser
│   ├── figmaCli.ts                           # Wraps `node ~/figma-cli/src/index.js ...`
│   ├── designMd.ts                           # DESIGN.md generator
│   ├── thumbnails.ts                         # Capture first-frame PNG via Playwright
│   ├── middleware/
│   │   ├── chat.ts                           # POST /api/chat (SSE)
│   │   ├── projects.ts                       # GET/POST/PATCH/DELETE /api/projects
│   │   ├── figma.ts                          # /api/figma/{frame,annotations,export}
│   │   └── frames.ts                         # /api/frames/:projectSlug/:frameSlug
│   └── plugins/
│       ├── frameMountPlugin.ts               # Serves frames/<slug>/index.tsx as a module
│       ├── apiPlugin.ts                      # Wires all middleware
│       └── projectWatchPlugin.ts             # Chokidar watcher → HMR
├── templates/
│   ├── CLAUDE.md.tpl                         # Per-project CLAUDE.md template
│   └── theme-overrides.css.tpl               # Empty starter
└── __tests__/                                # Vitest; see Testing section inside each task
    ├── server/
    │   ├── projects.test.ts
    │   ├── claudeCode.test.ts
    │   ├── figmaCli.test.ts
    │   └── designMd.test.ts
    ├── lib/
    │   ├── streamJson.test.ts
    │   └── figmaUrl.test.ts
    └── components/
        └── chat/AgentNarration.test.tsx
```

### Touched files outside `studio/`

- `package.json` (repo root) — add `"studio": "vite --config studio/vite.config.ts"` script.
- `pnpm-workspace.yaml` — add `studio` if the repo uses workspaces (check Task 1).

### Per-project filesystem layout (runtime-created)

```
~/Library/Application Support/arcade-studio/
└── projects/
    └── <slug>/
        ├── project.json
        ├── CLAUDE.md
        ├── DESIGN.md
        ├── theme-overrides.css
        ├── chat-history.json
        ├── shared/
        ├── frames/<slug>/index.tsx
        └── thumbnails/<frame>.png
```

---

## Conventions used across tasks

### Test patterns

- Filesystem tests use a tmp dir via `fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-"))` and clean up in `afterEach`. Never touch the real `~/Library/Application Support/arcade-studio/` in tests.
- Subprocess tests use a **stub binary** — a tiny shell script that emits canned stream-json events — injected via an env var `ARCADE_STUDIO_CLAUDE_BIN=<path>`. Real Claude Code is only invoked in manual smoke tests.
- Middleware tests use Vite's `createServer` in middleware mode and `fetch` against `http://localhost:<port>`.
- Component tests use `@testing-library/react` + `vitest-axe`.

### Error surface

All middleware returns `{ error: { code, message, hint? } }` on failure with the right HTTP status. UI never surfaces raw errors — it maps codes to plain-language banners.

### Commit style

Match the repo's existing style (imperative, no emoji, no scope prefix):
- `Add studio workspace scaffold`
- `Wire /api/chat streaming pipeline`
- `Render frames via iframe viewport`

### Skipped scope (non-goals — see spec §9)

- Electron packaging, project sharing/export, multi-frame click-through, promote-to-arcade-gen flow, multi-user, in-tool code editor, undo beyond natural language, session branching.

### A note on parallel execution

The spec groups tasks into Phase 0 → Wave A → Wave B → Wave C for a coordinator dispatching parallel agents. **Tasks within a wave are safe to run in parallel** because they touch disjoint files. Integration checkpoints (IC-A, IC-B, IC-C) are where a single agent reconciles the merged output. This plan preserves that structure: tasks are numbered globally but tagged with their wave for the coordinator.

---

## PHASE 0 — Scaffolding (serial)

### Task 1: Inspect repo and decide workspace shape

**Files:**
- Read: `package.json`, `pnpm-workspace.yaml` (if present), `playground/package.json`, `playground/vite.config.ts`, `tsconfig.json`

- [ ] **Step 1: Detect workspace setup**

Run (from arcade-gen root):
```bash
cat package.json | grep -A2 '"workspaces"' || cat pnpm-workspace.yaml 2>/dev/null || echo "No workspace config"
```

Decide: if `pnpm-workspace.yaml` exists, studio is a workspace package. If not, studio is a sibling folder referenced by a top-level npm script (like `playground/` currently is).

- [ ] **Step 2: Read playground for mirrorable patterns**

Note these patterns to mirror in studio:
- Vite plugin function shape (e.g. `function bedrockApiPlugin(): Plugin`).
- Alias pattern `"@": path.resolve(__dirname, "../src")`.
- Port convention (playground = 5555; studio = **5556**).

- [ ] **Step 3: Record findings**

No code change. Drop short notes into the `studio/README.md` in Task 2 referencing the choices.

---

### Task 2: Create `studio/` workspace skeleton

**Files:**
- Create: `studio/package.json`
- Create: `studio/tsconfig.json`
- Create: `studio/index.html`
- Create: `studio/vite.config.ts`
- Create: `studio/src/main.tsx`
- Create: `studio/src/App.tsx`
- Create: `studio/README.md`
- Modify: `package.json` (repo root) — add `"studio"` script

- [ ] **Step 1: Create `studio/package.json`**

```json
{
  "name": "arcade-studio",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "2.0.0",
    "chokidar": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

*Note:* `@anthropic-ai/claude-code` version MUST be pinned (no `^`). Verify the actual latest stable on npm at implementation time and update.

- [ ] **Step 2: Create `studio/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vite/client"],
    "paths": {
      "arcade": ["../src/index.ts"],
      "arcade/*": ["../src/*"]
    }
  },
  "include": ["src", "server", "__tests__", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `studio/index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="arcade" class="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arcade Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `studio/vite.config.ts` (plugins stubbed)**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      arcade: path.resolve(__dirname, "../src"),
      "@": path.resolve(__dirname, "../src"),
    },
  },
  server: { port: 5556, open: true },
});
```

- [ ] **Step 5: Create `studio/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { DevRevThemeProvider } from "@/theme/DevRevThemeProvider";
import "@/styles/globals.css";
import "@/styles/typography.css";
import "@/tokens/generated/core.css";
import "@/tokens/generated/light.css";
import "@/tokens/generated/component.css";
import "./styles/studio.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DevRevThemeProvider mode="light">
      <App />
    </DevRevThemeProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Create `studio/src/App.tsx` (placeholder)**

```tsx
export function App() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Arcade Studio</h1>
      <p>Project list and project detail routes coming next.</p>
    </main>
  );
}
```

- [ ] **Step 7: Create empty `studio/src/styles/studio.css`**

```css
/* Studio-only overrides. Frames do NOT load this file. */
:root { color-scheme: light dark; }
html, body, #root { height: 100%; margin: 0; }
```

- [ ] **Step 8: Add root script**

In `package.json` at repo root, add under `scripts`:

```json
"studio": "vite --config studio/vite.config.ts"
```

- [ ] **Step 9: Install and verify the shell launches**

Run:
```bash
pnpm install
pnpm studio
```

Expected: browser opens `http://localhost:5556`, page shows "Arcade Studio" heading with no console errors.

- [ ] **Step 10: Commit**

```bash
git add studio/ package.json pnpm-lock.yaml
git commit -m "Add studio workspace scaffold"
```

---

### Task 3: Define path helpers (single source of truth)

**Files:**
- Create: `studio/server/paths.ts`
- Create: `studio/__tests__/server/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`studio/__tests__/server/paths.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { studioRoot, projectsRoot, projectDir, frameDir } from "../../server/paths";

describe("paths", () => {
  it("studioRoot defaults to Application Support on darwin", () => {
    expect(studioRoot()).toBe(
      path.join(os.homedir(), "Library", "Application Support", "arcade-studio"),
    );
  });

  it("projectsRoot sits inside studioRoot", () => {
    expect(projectsRoot()).toBe(path.join(studioRoot(), "projects"));
  });

  it("projectDir joins slug safely", () => {
    expect(projectDir("my-project")).toBe(path.join(projectsRoot(), "my-project"));
  });

  it("frameDir nests under frames/", () => {
    expect(frameDir("p", "01-welcome")).toBe(
      path.join(projectsRoot(), "p", "frames", "01-welcome"),
    );
  });

  it("projectDir rejects path traversal", () => {
    expect(() => projectDir("../escape")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter arcade-studio test paths` (or `cd studio && pnpm test paths`).
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `studio/server/paths.ts`**

```ts
import path from "node:path";
import os from "node:os";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i;

function requireSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new Error(`Invalid slug: ${slug}`);
  return slug;
}

export function studioRoot(): string {
  const override = process.env.ARCADE_STUDIO_ROOT;
  if (override) return override;
  return path.join(os.homedir(), "Library", "Application Support", "arcade-studio");
}

export function projectsRoot(): string {
  return path.join(studioRoot(), "projects");
}

export function projectDir(slug: string): string {
  return path.join(projectsRoot(), requireSlug(slug));
}

export function frameDir(projectSlug: string, frameSlug: string): string {
  return path.join(projectDir(projectSlug), "frames", requireSlug(frameSlug));
}

export function sharedDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "shared");
}

export function chatHistoryPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "chat-history.json");
}

export function projectJsonPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "project.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/paths.ts studio/__tests__/server/paths.test.ts
git commit -m "Add studio path helpers with slug validation"
```

---

## WAVE A — Independent foundations

### Task A1.1: Project JSON schema and types

**Files:**
- Create: `studio/server/types.ts`
- Create: `studio/__tests__/server/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { projectSchema, type Project } from "../../server/types";

describe("Project schema", () => {
  const valid: Project = {
    name: "My project",
    slug: "my-project",
    createdAt: "2026-04-21T00:00:00Z",
    updatedAt: "2026-04-21T00:00:00Z",
    theme: "arcade",
    mode: "light",
    frames: [],
  };

  it("accepts valid project", () => {
    expect(projectSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid slug", () => {
    expect(() => projectSchema.parse({ ...valid, slug: "has spaces" })).toThrow();
  });

  it("accepts optional sessionId", () => {
    expect(projectSchema.parse({ ...valid, sessionId: "abc-123" }).sessionId).toBe("abc-123");
  });

  it("rejects unknown theme", () => {
    expect(() => projectSchema.parse({ ...valid, theme: "neon" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `studio/server/types.ts`**

```ts
import { z } from "zod";

export const frameSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  size: z.enum(["375", "1024", "1440", "1920"]).default("1440"),
});
export type Frame = z.infer<typeof frameSchema>;

export const projectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  createdAt: z.string(),
  updatedAt: z.string(),
  theme: z.enum(["arcade", "devrev-app"]),
  mode: z.enum(["light", "dark"]).default("light"),
  sessionId: z.string().optional(),
  frames: z.array(frameSchema).default([]),
});
export type Project = z.infer<typeof projectSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  images: z.array(z.string()).optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
```

- [ ] **Step 4: Verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/types.ts studio/__tests__/server/types.test.ts
git commit -m "Add project and chat-message schemas"
```

---

### Task A1.2: Project CRUD (filesystem layer)

**Files:**
- Create: `studio/server/projects.ts`
- Create: `studio/__tests__/server/projects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, listProjects, getProject, renameProject, deleteProject } from "../../server/projects";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("projects CRUD", () => {
  it("creates a project with scaffolded files", async () => {
    const p = await createProject({ name: "My Project", theme: "arcade", mode: "light" });
    expect(p.slug).toBe("my-project");

    const root = path.join(tmp, "projects", "my-project");
    expect(fs.existsSync(path.join(root, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "theme-overrides.css"))).toBe(true);
    expect(fs.existsSync(path.join(root, "frames"))).toBe(true);
    expect(fs.existsSync(path.join(root, "shared"))).toBe(true);
    expect(fs.existsSync(path.join(root, "chat-history.json"))).toBe(true);
  });

  it("lists projects sorted by updatedAt desc", async () => {
    await createProject({ name: "Alpha", theme: "arcade", mode: "light" });
    await new Promise((r) => setTimeout(r, 10));
    await createProject({ name: "Beta", theme: "arcade", mode: "light" });
    const ps = await listProjects();
    expect(ps.map((p) => p.name)).toEqual(["Beta", "Alpha"]);
  });

  it("dedupes slugs", async () => {
    const a = await createProject({ name: "Same", theme: "arcade", mode: "light" });
    const b = await createProject({ name: "Same", theme: "arcade", mode: "light" });
    expect(a.slug).toBe("same");
    expect(b.slug).toBe("same-2");
  });

  it("renames a project and updates updatedAt", async () => {
    const p = await createProject({ name: "Orig", theme: "arcade", mode: "light" });
    await new Promise((r) => setTimeout(r, 10));
    const r = await renameProject(p.slug, "Renamed");
    expect(r.name).toBe("Renamed");
    expect(r.slug).toBe(p.slug);
    expect(r.updatedAt > p.updatedAt).toBe(true);
  });

  it("deletes a project", async () => {
    const p = await createProject({ name: "Bye", theme: "arcade", mode: "light" });
    await deleteProject(p.slug);
    expect(await getProject(p.slug)).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm failure**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `studio/server/projects.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir, projectsRoot, projectJsonPath, chatHistoryPath } from "./paths";
import { projectSchema, type Project } from "./types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await exists(projectDir(slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
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

  const dir = projectDir(slug);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  await fs.mkdir(path.join(dir, "shared"), { recursive: true });
  await fs.mkdir(path.join(dir, "thumbnails"), { recursive: true });
  await fs.writeFile(projectJsonPath(slug), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(dir, "theme-overrides.css"), "/* Local theme overrides */\n");
  await fs.writeFile(path.join(dir, "CLAUDE.md"), ""); // Task B3 fills in template
  await fs.writeFile(path.join(dir, "DESIGN.md"), ""); // Task B2 fills in
  await fs.writeFile(chatHistoryPath(slug), "[]");
  return project;
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

export async function listProjects(): Promise<Project[]> {
  try {
    const slugs = await fs.readdir(projectsRoot());
    const ps: Project[] = [];
    for (const slug of slugs) {
      const p = await getProject(slug);
      if (p) ps.push(p);
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
  const next: Project = { ...p, name, updatedAt: new Date().toISOString() };
  await fs.writeFile(projectJsonPath(slug), JSON.stringify(next, null, 2));
  return next;
}

export async function updateProject(slug: string, patch: Partial<Project>): Promise<Project> {
  const p = await getProject(slug);
  if (!p) throw new Error(`Project not found: ${slug}`);
  const next: Project = projectSchema.parse({
    ...p, ...patch, slug: p.slug, updatedAt: new Date().toISOString(),
  });
  await fs.writeFile(projectJsonPath(slug), JSON.stringify(next, null, 2));
  return next;
}

export async function deleteProject(slug: string): Promise<void> {
  await fs.rm(projectDir(slug), { recursive: true, force: true });
}
```

- [ ] **Step 4: Verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/projects.ts studio/__tests__/server/projects.test.ts
git commit -m "Add filesystem CRUD for arcade-studio projects"
```

---

### Task A1.3: `/api/projects` middleware

**Files:**
- Create: `studio/server/middleware/projects.ts`
- Create: `studio/__tests__/server/middleware/projects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";

let tmp: string; let server: http.Server; let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(projectsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("/api/projects", () => {
  it("POST creates a project", async () => {
    const r = await req("POST", "/api/projects", { name: "X", theme: "arcade", mode: "light" });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("x");
  });

  it("GET lists projects", async () => {
    await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("GET", "/api/projects");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it("PATCH renames", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("PATCH", `/api/projects/${c.body.slug}`, { name: "B" });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("B");
  });

  it("DELETE removes", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("DELETE", `/api/projects/${c.body.slug}`);
    expect(r.status).toBe(204);
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement middleware**

`studio/server/middleware/projects.ts`:
```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { createProject, deleteProject, listProjects, renameProject, updateProject, getProject } from "../projects";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function projectsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/projects")) return next?.();
    try {
      const parts = url.replace(/\?.*$/, "").split("/").filter(Boolean); // ["api","projects",slug?]
      const slug = parts[2];

      if (req.method === "GET" && !slug) return send(res, 200, await listProjects());
      if (req.method === "GET" && slug)  {
        const p = await getProject(slug);
        return send(res, p ? 200 : 404, p ?? { error: { code: "not_found", message: "Project not found" } });
      }
      if (req.method === "POST" && !slug) {
        const body = await readJson(req);
        return send(res, 201, await createProject(body));
      }
      if (req.method === "PATCH" && slug) {
        const body = await readJson(req);
        if (typeof body.name === "string") return send(res, 200, await renameProject(slug, body.name));
        return send(res, 200, await updateProject(slug, body));
      }
      if (req.method === "DELETE" && slug) {
        await deleteProject(slug);
        return send(res, 204);
      }
      send(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    } catch (err: any) {
      send(res, 400, { error: { code: "bad_request", message: err.message } });
    }
  };
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/projects.ts studio/__tests__/server/middleware/projects.test.ts
git commit -m "Add /api/projects middleware"
```

---

### Task A1.4: Project list UI (home screen)

**Files:**
- Create: `studio/src/routes/ProjectList.tsx`
- Create: `studio/src/components/projects/ProjectCard.tsx`
- Create: `studio/src/components/projects/NewProjectModal.tsx`
- Create: `studio/src/components/projects/ProjectSearch.tsx`
- Create: `studio/src/hooks/useProjects.ts`
- Create: `studio/src/lib/api.ts`
- Modify: `studio/src/App.tsx` (trivial router)
- Create: `studio/__tests__/components/projects/NewProjectModal.test.tsx`

- [ ] **Step 1: Create `studio/src/lib/api.ts`**

```ts
import type { Project } from "../../server/types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json()).error?.message ?? `HTTP ${res.status}`);
  return res.status === 204 ? (undefined as T) : (await res.json()) as T;
}

export const api = {
  listProjects: () => fetch("/api/projects").then(j<Project[]>),
  createProject: (input: { name: string; theme: "arcade" | "devrev-app"; mode: "light" | "dark" }) =>
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(j<Project>),
  renameProject: (slug: string, name: string) =>
    fetch(`/api/projects/${slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(j<Project>),
  deleteProject: (slug: string) =>
    fetch(`/api/projects/${slug}`, { method: "DELETE" }).then(j<void>),
};
```

- [ ] **Step 2: Create `studio/src/hooks/useProjects.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Project } from "../../server/types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setProjects(await api.listProjects()); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { projects, loading, error, refresh };
}
```

- [ ] **Step 3: Create `NewProjectModal.tsx`**

```tsx
import { useState } from "react";
import { Modal, Input, Button, Select } from "arcade";

export function NewProjectModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (slug: string) => void }) {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<"arcade" | "devrev-app">("arcade");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { api } = await import("../../lib/api");
      const p = await api.createProject({ name: name.trim(), theme, mode: "light" });
      onCreated(p.slug);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="New project">
      <div style={{ display: "grid", gap: 12 }}>
        <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select
          value={theme}
          onValueChange={(v) => setTheme(v as any)}
          options={[
            { value: "arcade", label: "Arcade theme" },
            { value: "devrev-app", label: "DevRev App theme" },
          ]}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Create `ProjectCard.tsx`**

```tsx
import type { Project } from "../../../server/types";

export function ProjectCard({
  project, onOpen, onRename, onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      style={{
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 540, color: "var(--fg-neutral-prominent)" }}>{project.name}</div>
      <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12 }}>
        {new Date(project.updatedAt).toLocaleDateString()}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={(e) => { e.stopPropagation(); onRename(); }}>Rename</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Create `ProjectSearch.tsx`**

```tsx
import { Input } from "arcade";

export function ProjectSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search projects"
    />
  );
}
```

- [ ] **Step 6: Create `ProjectList.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Button } from "arcade";
import { useProjects } from "../hooks/useProjects";
import { ProjectCard } from "../components/projects/ProjectCard";
import { NewProjectModal } from "../components/projects/NewProjectModal";
import { ProjectSearch } from "../components/projects/ProjectSearch";
import { api } from "../lib/api";

export function ProjectList({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, refresh } = useProjects();
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query],
  );

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 style={{ flex: 1, margin: 0 }}>Projects</h1>
        <ProjectSearch value={query} onChange={setQuery} />
        <Button variant="primary" onClick={() => setShowNew(true)}>+ New project</Button>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {filtered.map((p) => (
          <ProjectCard
            key={p.slug}
            project={p}
            onOpen={() => onOpen(p.slug)}
            onRename={async () => {
              const n = prompt("New name", p.name);
              if (n && n.trim()) { await api.renameProject(p.slug, n.trim()); void refresh(); }
            }}
            onDelete={async () => {
              if (confirm(`Delete "${p.name}"? This cannot be undone.`)) {
                await api.deleteProject(p.slug); void refresh();
              }
            }}
          />
        ))}
      </div>
      <NewProjectModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(slug) => { setShowNew(false); onOpen(slug); }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Wire router in `App.tsx`**

```tsx
import { useState } from "react";
import { ProjectList } from "./routes/ProjectList";

export function App() {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  if (openSlug === null) return <ProjectList onOpen={setOpenSlug} />;
  return (
    <main style={{ padding: 24 }}>
      <button onClick={() => setOpenSlug(null)}>&lt; Projects</button>
      <h1>{openSlug}</h1>
      <p>Project detail view — built in Wave B (frames) and Wave C (chat wiring).</p>
    </main>
  );
}
```

- [ ] **Step 8: Write `NewProjectModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewProjectModal } from "../../../src/components/projects/NewProjectModal";

vi.mock("../../../src/lib/api", () => ({
  api: { createProject: vi.fn(async ({ name }) => ({ slug: name.toLowerCase() })) },
}));

describe("NewProjectModal", () => {
  it("enables create only with a name", () => {
    render(<NewProjectModal open onClose={() => {}} onCreated={() => {}} />);
    const create = screen.getByRole("button", { name: /create/i });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/project name/i), { target: { value: "X" } });
    expect(create).not.toBeDisabled();
  });
});
```

- [ ] **Step 9: Wire `projectsMiddleware` into `vite.config.ts`**

In `studio/vite.config.ts`, add a plugin entry:
```ts
import { projectsMiddleware } from "./server/middleware/projects";

function apiPlugin(): import("vite").Plugin {
  return {
    name: "arcade-studio-api",
    configureServer(server) {
      server.middlewares.use(projectsMiddleware());
    },
  };
}

// then: plugins: [react(), tailwindcss(), apiPlugin()],
```

- [ ] **Step 10: Manual smoke test**

Run `pnpm studio`, click "+ New project", enter name, see it appear. Reload — it persists. Delete — it disappears.

- [ ] **Step 11: Commit**

```bash
git add studio/src studio/server/middleware/projects.ts studio/vite.config.ts studio/__tests__/components
git commit -m "Add project list screen with create/rename/delete"
```

---

### Task A2.1: stream-json parser

**Files:**
- Create: `studio/src/lib/streamJson.ts`
- Create: `studio/__tests__/lib/streamJson.test.ts`

The Claude Code CLI emits NDJSON events. Each line is a JSON object. We parse and normalize them into the shape the UI actually needs.

Event shapes reference (verify with `claude --help` or docs at implementation time):
- `{ "type": "system", "subtype": "init", "session_id": "..." }`
- `{ "type": "assistant", "message": { "content": [ { "type": "text", "text": "..." } ] } }`
- `{ "type": "assistant", "message": { "content": [ { "type": "tool_use", "name": "Read", "input": {...} } ] } }`
- `{ "type": "user", "message": { "content": [ { "type": "tool_result", "tool_use_id": "...", "content": "..." } ] } }`
- `{ "type": "result", "subtype": "success" | "error", ... }`

If actual event shapes differ at implementation time, update this parser and its tests together.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseStreamLine, type StudioEvent } from "../../src/lib/streamJson";

describe("parseStreamLine", () => {
  it("ignores blank lines", () => {
    expect(parseStreamLine("")).toBeNull();
  });

  it("extracts session id from system init", () => {
    const e = parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }));
    expect(e).toEqual<StudioEvent>({ kind: "session", sessionId: "abc" });
  });

  it("extracts narration from assistant text", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "Building Welcome screen…" }] },
    }));
    expect(e).toEqual<StudioEvent>({ kind: "narration", text: "Building Welcome screen…" });
  });

  it("maps tool_use Read to plain language", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "frames/01-welcome/index.tsx" } }] },
    }));
    expect(e).toMatchObject({ kind: "tool_call", tool: "Read", pretty: expect.stringContaining("Reading") });
  });

  it("maps figma-cli bash calls to a Figma narration", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cd ~/figma-cli && node src/index.js get 1:2" } }] },
    }));
    expect(e).toMatchObject({ kind: "tool_call", tool: "Figma", pretty: expect.stringContaining("Figma") });
  });

  it("signals end on result event", () => {
    const e = parseStreamLine(JSON.stringify({ type: "result", subtype: "success" }));
    expect(e).toEqual<StudioEvent>({ kind: "end", ok: true });
  });

  it("returns error on result failure", () => {
    const e = parseStreamLine(JSON.stringify({ type: "result", subtype: "error_during_execution", error: "boom" }));
    expect(e).toEqual<StudioEvent>({ kind: "end", ok: false, error: "boom" });
  });

  it("returns null for unrelated garbage", () => {
    expect(parseStreamLine("not json")).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `studio/src/lib/streamJson.ts`**

```ts
export type StudioEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "narration"; text: string }
  | { kind: "tool_call"; tool: string; pretty: string }
  | { kind: "tool_result"; tool: string; ok: boolean; snippet?: string }
  | { kind: "end"; ok: true }
  | { kind: "end"; ok: false; error: string };

function prettyTool(name: string, input: any): { tool: string; pretty: string } {
  if (name === "Read") return { tool: "Read", pretty: `Reading ${basename(input?.file_path)}` };
  if (name === "Write") return { tool: "Write", pretty: `Writing ${basename(input?.file_path)}` };
  if (name === "Edit") return { tool: "Edit", pretty: `Editing ${basename(input?.file_path)}` };
  if (name === "Glob") return { tool: "Glob", pretty: `Looking for files matching "${input?.pattern}"` };
  if (name === "Grep") return { tool: "Grep", pretty: `Searching for "${input?.pattern}"` };
  if (name === "Bash") {
    const cmd = String(input?.command ?? "");
    if (cmd.includes("figma-cli")) return { tool: "Figma", pretty: figmaPretty(cmd) };
    return { tool: "Bash", pretty: "Running a command" };
  }
  return { tool: name, pretty: `Using ${name}` };
}

function figmaPretty(cmd: string): string {
  if (cmd.includes(" get ")) return "Reading a Figma node";
  if (cmd.includes(" find ")) return "Finding a Figma node";
  if (cmd.includes(" export ")) return "Exporting from Figma";
  if (cmd.includes(" node tree ")) return "Reading Figma frame structure";
  if (cmd.includes(" daemon status") || cmd.includes(" connect")) return "Connecting to Figma";
  return "Working with Figma";
}

function basename(p?: string): string {
  if (!p) return "a file";
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function parseStreamLine(line: string): StudioEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev: any;
  try { ev = JSON.parse(trimmed); } catch { return null; }

  if (ev.type === "system" && ev.subtype === "init" && ev.session_id) {
    return { kind: "session", sessionId: ev.session_id };
  }

  if (ev.type === "assistant" && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        return { kind: "narration", text: c.text };
      }
      if (c.type === "tool_use") {
        const pr = prettyTool(c.name, c.input);
        return { kind: "tool_call", ...pr };
      }
    }
    return null;
  }

  if (ev.type === "user" && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === "tool_result") {
        const snippet = typeof c.content === "string" ? c.content.slice(0, 140) : undefined;
        return { kind: "tool_result", tool: "unknown", ok: !c.is_error, snippet };
      }
    }
    return null;
  }

  if (ev.type === "result") {
    if (ev.subtype === "success") return { kind: "end", ok: true };
    return { kind: "end", ok: false, error: String(ev.error ?? "Agent error") };
  }

  return null;
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/streamJson.ts studio/__tests__/lib/streamJson.test.ts
git commit -m "Parse Claude Code stream-json into studio events"
```

---

### Task A2.2: Claude Code subprocess wrapper

**Files:**
- Create: `studio/server/claudeCode.ts`
- Create: `studio/__tests__/fixtures/fake-claude.sh`
- Create: `studio/__tests__/server/claudeCode.test.ts`

- [ ] **Step 1: Create the fake claude binary for tests**

`studio/__tests__/fixtures/fake-claude.sh`:
```bash
#!/usr/bin/env bash
# Fake claude CLI. Emits stream-json events to stdout, line-by-line.
# Reads user prompt from -p "<msg>". Fixture output is selected via the env var FAKE_CLAUDE_SCENARIO.
case "${FAKE_CLAUDE_SCENARIO:-default}" in
  default)
    printf '{"type":"system","subtype":"init","session_id":"sess-001"}\n'
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it"}]}}\n'
    printf '{"type":"result","subtype":"success"}\n'
    ;;
  auth_error)
    printf '{"type":"result","subtype":"error_during_execution","error":"aws sso expired"}\n'
    exit 1
    ;;
  *) exit 2 ;;
esac
```

Make it executable via the test's `beforeAll` (`chmod 0755`). Don't rely on check-in file mode.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runClaudeTurn } from "../../server/claudeCode";

const FAKE = path.join(__dirname, "../fixtures/fake-claude.sh");

beforeAll(() => { fs.chmodSync(FAKE, 0o755); });

describe("runClaudeTurn", () => {
  it("captures session id and yields narration", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-cc-"));
    const events: any[] = [];
    await runClaudeTurn({
      cwd: tmp,
      prompt: "hi",
      bin: FAKE,
      env: { FAKE_CLAUDE_SCENARIO: "default" },
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.kind === "session" && e.sessionId === "sess-001")).toBe(true);
    expect(events.some((e) => e.kind === "narration")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ kind: "end", ok: true });
  });

  it("propagates error end event on failure", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-cc-"));
    const events: any[] = [];
    await runClaudeTurn({
      cwd: tmp, prompt: "hi", bin: FAKE,
      env: { FAKE_CLAUDE_SCENARIO: "auth_error" },
      onEvent: (e) => events.push(e),
    });
    expect(events[events.length - 1]).toMatchObject({ kind: "end", ok: false });
  });

  it("passes --resume when sessionId is provided", async () => {
    const calls: string[][] = [];
    const spy = path.join(__dirname, "../fixtures/fake-claude-spy.sh");
    fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${path.join(os.tmpdir(), "claude-args.log")}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
    const logFile = path.join(os.tmpdir(), "claude-args.log");
    fs.writeFileSync(logFile, "");
    await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, sessionId: "abc", onEvent: () => {} });
    const args = fs.readFileSync(logFile, "utf-8");
    expect(args).toMatch(/--resume abc/);
    fs.rmSync(spy);
  });
});
```

- [ ] **Step 3: Confirm failure**

- [ ] **Step 4: Implement `studio/server/claudeCode.ts`**

```ts
import { spawn } from "node:child_process";
import { parseStreamLine, type StudioEvent } from "../src/lib/streamJson";

export interface RunTurnOptions {
  cwd: string;
  prompt: string;
  sessionId?: string;
  /** Absolute path to the `claude` binary. In tests, a fake. In production, node_modules/.bin/claude. */
  bin: string;
  env?: Record<string, string>;
  /** Optional image paths to attach; will be included in the prompt via @-references. */
  images?: string[];
  onEvent: (e: StudioEvent) => void;
  signal?: AbortSignal;
}

const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Write,Glob,Grep,Bash(figma-cli:*)";

export async function runClaudeTurn(opts: RunTurnOptions): Promise<void> {
  const args = [
    "-p", decoratePrompt(opts.prompt, opts.images),
    "--output-format", "stream-json",
    "--allowed-tools", DEFAULT_ALLOWED_TOOLS,
  ];
  if (opts.sessionId) args.push("--resume", opts.sessionId);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(opts.bin, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
        ...opts.env,
      },
    });
    opts.signal?.addEventListener("abort", () => proc.kill("SIGTERM"));

    let stdoutBuf = "";
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const ev = parseStreamLine(line);
        if (ev) opts.onEvent(ev);
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (c) => { stderrBuf += c.toString(); });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (stdoutBuf.trim()) {
        const ev = parseStreamLine(stdoutBuf);
        if (ev) opts.onEvent(ev);
      }
      if (code !== 0) {
        opts.onEvent({ kind: "end", ok: false, error: stderrBuf.trim() || `claude exited ${code}` });
      }
      resolve();
    });
  });
}

function decoratePrompt(prompt: string, images?: string[]): string {
  if (!images?.length) return prompt;
  const refs = images.map((p) => `@${p}`).join("\n");
  return `${prompt}\n\nReference images:\n${refs}`;
}
```

- [ ] **Step 5: Verify pass**

- [ ] **Step 6: Commit**

```bash
git add studio/server/claudeCode.ts studio/__tests__/server/claudeCode.test.ts studio/__tests__/fixtures/fake-claude.sh
git commit -m "Add Claude Code subprocess wrapper with stream parsing"
```

---

### Task A2.3: `/api/chat` SSE middleware

**Files:**
- Create: `studio/server/middleware/chat.ts`
- Create: `studio/__tests__/server/middleware/chat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";

const FAKE = path.join(__dirname, "../../fixtures/fake-claude.sh");
let tmp: string; let server: http.Server; let port: number;

beforeAll(() => fs.chmodSync(FAKE, 0o755));

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-chat-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE;
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/chat", () => {
  it("streams events and persists the session id", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, prompt: "hi" }),
    });
    const txt = await res.text();
    expect(txt).toContain("event: session");
    expect(txt).toContain("event: narration");
    expect(txt).toContain("event: end");
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, "projects", p.slug, "project.json"), "utf-8"));
    expect(saved.sessionId).toBe("sess-001");
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `studio/server/middleware/chat.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { runClaudeTurn } from "../claudeCode";
import { getProject, updateProject } from "../projects";
import { chatHistoryPath, projectDir } from "../paths";
import type { ChatMessage } from "../types";

function claudeBin(): string {
  return process.env.ARCADE_STUDIO_CLAUDE_BIN
    ?? path.resolve(process.cwd(), "studio", "node_modules", ".bin", "claude");
}

async function appendHistory(slug: string, msg: ChatMessage) {
  const file = chatHistoryPath(slug);
  let existing: ChatMessage[] = [];
  try { existing = JSON.parse(await fs.readFile(file, "utf-8")); } catch {}
  existing.push(msg);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

export function chatMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!req.url?.startsWith("/api/chat") || req.method !== "POST") return next?.();

    let buf = "";
    for await (const chunk of req) buf += chunk;
    const { slug, prompt, images } = JSON.parse(buf) as {
      slug: string; prompt: string; images?: string[];
    };

    const project = await getProject(slug);
    if (!project) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await appendHistory(slug, {
      id: `u-${Date.now()}`, role: "user", content: prompt, images,
      createdAt: new Date().toISOString(),
    });

    let capturedSessionId: string | undefined;

    try {
      await runClaudeTurn({
        cwd: projectDir(slug),
        prompt,
        sessionId: project.sessionId,
        bin: claudeBin(),
        images,
        onEvent: (ev) => {
          if (ev.kind === "session") capturedSessionId = ev.sessionId;
          res.write(`event: ${ev.kind}\n`);
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        },
      });
    } catch (err: any) {
      res.write(`event: end\ndata: ${JSON.stringify({ kind: "end", ok: false, error: err.message })}\n\n`);
    }

    if (capturedSessionId && !project.sessionId) {
      await updateProject(slug, { sessionId: capturedSessionId });
    }
    res.end();
  };
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Wire into `vite.config.ts`**

Extend the `apiPlugin` from Task A1.4:
```ts
import { chatMiddleware } from "./server/middleware/chat";
// inside configureServer:
server.middlewares.use(chatMiddleware());
```

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat.test.ts studio/vite.config.ts
git commit -m "Add /api/chat SSE middleware with session persistence"
```

---

### Task A3.1: figma-cli wrapper

**Files:**
- Create: `studio/server/figmaCli.ts`
- Create: `studio/__tests__/server/figmaCli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFigmaUrl } from "../../server/figmaCli";

describe("parseFigmaUrl", () => {
  it("extracts file id and node id from a Figma URL", () => {
    const r = parseFigmaUrl("https://www.figma.com/design/AbC123/My-file?node-id=1038-14518");
    expect(r).toEqual({ fileId: "AbC123", nodeId: "1038:14518" });
  });
  it("returns null for non-Figma url", () => {
    expect(parseFigmaUrl("https://example.com/x")).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `studio/server/figmaCli.ts`**

```ts
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

export function figmaCliDir(): string {
  return process.env.ARCADE_STUDIO_FIGMA_CLI_DIR ?? path.join(os.homedir(), "figma-cli");
}

export interface ParsedFigmaUrl { fileId: string; nodeId: string; }

export function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("figma.com")) return null;
    const m = u.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    const nodeParam = u.searchParams.get("node-id");
    if (!m || !nodeParam) return null;
    return { fileId: m[1], nodeId: nodeParam.replace(/-/g, ":") };
  } catch { return null; }
}

async function run(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [path.join(figmaCliDir(), "src", "index.js"), ...args], {
      cwd: figmaCliDir(),
    });
    let stdout = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
  });
}

export async function daemonStatus(): Promise<{ connected: boolean }> {
  const r = await run(["daemon", "status"]);
  return { connected: /connected/i.test(r.stdout) };
}

export async function getNode(nodeId: string): Promise<unknown> {
  const r = await run(["get", nodeId]);
  if (r.code !== 0) throw new Error(`figma get failed (${r.code})`);
  return JSON.parse(r.stdout);
}

export async function nodeTree(nodeId: string, depth = 3): Promise<unknown> {
  const r = await run(["node", "tree", nodeId, "-d", String(depth)]);
  if (r.code !== 0) throw new Error(`figma tree failed (${r.code})`);
  return JSON.parse(r.stdout);
}

export async function exportNodePng(nodeId: string, outFile: string, scale = 2): Promise<string> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const r = await run(["export", "node", nodeId, "-o", outFile, "-s", String(scale)]);
  if (r.code !== 0) throw new Error(`figma export failed (${r.code})`);
  return outFile;
}
```

- [ ] **Step 4: Verify pass**

Expected: PASS (URL parsing only; CLI execution covered by manual smoke in Step 6).

- [ ] **Step 5: Manual smoke test**

Requires Figma Desktop running, figma-cli at `~/figma-cli`.
```bash
cd studio
pnpm tsx -e 'import("./server/figmaCli").then(async (m) => console.log(await m.daemonStatus()))'
```
Expected: `{ connected: true }`.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figmaCli.ts studio/__tests__/server/figmaCli.test.ts
git commit -m "Add figma-cli wrapper for studio"
```

---

### Task A3.2: `/api/figma` middleware

**Files:**
- Create: `studio/server/middleware/figma.ts`
- Create: `studio/__tests__/server/middleware/figma.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { figmaMiddleware } from "../../../server/middleware/figma";
import * as cli from "../../../server/figmaCli";

let server: http.Server; let port: number;

beforeEach(async () => {
  vi.spyOn(cli, "daemonStatus").mockResolvedValue({ connected: true });
  vi.spyOn(cli, "getNode").mockResolvedValue({ name: "Button" });
  server = http.createServer(figmaMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => { vi.restoreAllMocks(); server.close(); });

describe("/api/figma", () => {
  it("returns daemon status", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(await res.json()).toEqual({ connected: true });
  });

  it("reads a node by id", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/node/1:2`);
    expect(await res.json()).toEqual({ name: "Button" });
  });

  it("surfaces disconnected daemon with a 503 and plain hint", async () => {
    (cli.daemonStatus as any).mockResolvedValueOnce({ connected: false });
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.hint).toMatch(/Figma Desktop/);
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement middleware**

`studio/server/middleware/figma.ts`:
```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { daemonStatus, getNode, nodeTree, exportNodePng } from "../figmaCli";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function figmaMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/figma")) return next?.();
    try {
      if (url === "/api/figma/status") {
        const s = await daemonStatus();
        if (!s.connected) {
          return send(res, 503, { error: { code: "figma_disconnected", message: "Figma Desktop is not connected", hint: "Open Figma Desktop and try again." } });
        }
        return send(res, 200, s);
      }
      const nodeMatch = url.match(/^\/api\/figma\/node\/([^?/]+)(?:\?.*)?$/);
      if (req.method === "GET" && nodeMatch) {
        return send(res, 200, await getNode(decodeURIComponent(nodeMatch[1])));
      }
      const treeMatch = url.match(/^\/api\/figma\/tree\/([^?/]+)(?:\?d=(\d+))?/);
      if (req.method === "GET" && treeMatch) {
        return send(res, 200, await nodeTree(decodeURIComponent(treeMatch[1]), Number(treeMatch[2] ?? 3)));
      }
      if (req.method === "POST" && url.startsWith("/api/figma/export")) {
        let buf = ""; for await (const c of req) buf += c;
        const { nodeId, outFile, scale } = JSON.parse(buf);
        const out = await exportNodePng(nodeId, outFile, scale);
        return send(res, 200, { path: out });
      }
      send(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (err: any) {
      send(res, 500, { error: { code: "figma_error", message: err.message } });
    }
  };
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Wire into `vite.config.ts`**

Extend `apiPlugin`: `server.middlewares.use(figmaMiddleware());`

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/figma.ts studio/__tests__/server/middleware/figma.test.ts studio/vite.config.ts
git commit -m "Add /api/figma middleware wrapping figma-cli"
```

---

## Integration Checkpoint A (single agent, ~0.5 day)

- [ ] **Step 1: Start the dev server** — `pnpm studio`. Confirm no plugin errors.

- [ ] **Step 2: End-to-end path 1** — Create a project in the UI (A1.4), then `curl -N -X POST http://localhost:5556/api/chat -H 'Content-Type: application/json' -d '{"slug":"<slug>","prompt":"Create a file at frames/01-welcome/index.tsx that exports a React component."}'`. Confirm `sess-...` is captured and the file appears on disk.

- [ ] **Step 3: End-to-end path 2** — `curl http://localhost:5556/api/figma/status`. If Figma is running, see `{connected:true}`.

- [ ] **Step 4: Commit any reconciliation fixes** — e.g. route ordering in `apiPlugin`.

```bash
git commit -am "Wave A integration checkpoint" || true
```

---

## WAVE B — Rendering and grounding

### Task B1.1: Frame mount Vite plugin

**Files:**
- Create: `studio/server/plugins/frameMountPlugin.ts`
- Create: `studio/__tests__/server/plugins/frameMountPlugin.test.ts`

The plugin resolves URLs of the form `/api/frames/<projectSlug>/<frameSlug>` to the on-disk file `<projectsRoot>/<projectSlug>/frames/<frameSlug>/index.tsx`, wrapping it in a mini-bootstrap that imports the theme, the project's `theme-overrides.css`, and mounts the default export as a React app.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { frameMountPlugin } from "../../../server/plugins/frameMountPlugin";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-fm-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "welcome");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "index.tsx"), `export default () => <div>Hi</div>;`);
  fs.writeFileSync(path.join(tmp, "projects", "p", "theme-overrides.css"), `:root { --x: 1; }`);
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("frameMountPlugin", () => {
  it("serves a bootstrap HTML at /api/frames/:project/:frame", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/frames/p/welcome`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("<div id=\"root\"></div>");
    expect(html).toContain("theme-overrides.css");
    await server.close();
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `studio/server/plugins/frameMountPlugin.ts`**

```ts
import type { Plugin } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir, projectDir } from "../paths";

export function frameMountPlugin(): Plugin {
  return {
    name: "arcade-studio-frame-mount",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/frames\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\?.*)?$/);
        if (!m) return next();
        const [, slug, frame] = m;
        const fPath = path.join(frameDir(slug, frame), "index.tsx");
        try { await fs.access(fPath); } catch {
          res.writeHead(404); res.end("Frame not found"); return;
        }

        const overridesUrl = `/@fs${path.join(projectDir(slug), "theme-overrides.css")}`;
        const bootstrapUrl = `/@id/virtual:arcade-studio-frame?project=${slug}&frame=${frame}`;
        const html = `<!DOCTYPE html>
<html lang="en" data-theme="arcade" class="light">
  <head><meta charset="UTF-8" /><title>${slug}/${frame}</title>
    <link rel="stylesheet" href="${overridesUrl}" />
  </head>
  <body><div id="root"></div>
    <script type="module" src="${bootstrapUrl}"></script>
  </body>
</html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
    },
    resolveId(id) {
      if (id.startsWith("virtual:arcade-studio-frame")) return "\0" + id;
      return null;
    },
    load(id) {
      if (!id.startsWith("\0virtual:arcade-studio-frame")) return null;
      const q = new URLSearchParams(id.split("?")[1] ?? "");
      const slug = q.get("project")!;
      const frame = q.get("frame")!;
      const absFrame = path.join(frameDir(slug, frame), "index.tsx");
      return `
        import React from "react";
        import ReactDOM from "react-dom/client";
        import { DevRevThemeProvider } from "arcade/theme/DevRevThemeProvider";
        import "arcade/styles/globals.css";
        import "arcade/styles/typography.css";
        import "arcade/tokens/generated/core.css";
        import "arcade/tokens/generated/light.css";
        import "arcade/tokens/generated/component.css";
        import Frame from "${absFrame}";
        ReactDOM.createRoot(document.getElementById("root")).render(
          <React.StrictMode>
            <DevRevThemeProvider mode="light">
              <Frame />
            </DevRevThemeProvider>
          </React.StrictMode>
        );
      `;
    },
  };
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Wire plugin into `vite.config.ts`**

Add `frameMountPlugin()` to the `plugins: [...]` array BEFORE `apiPlugin()` so its middleware registers first.

- [ ] **Step 6: Manual smoke test**

Create a project, drop `frames/welcome/index.tsx` with a trivial component. Visit `http://localhost:5556/api/frames/<slug>/welcome`. Expected: page renders with arcade tokens applied.

- [ ] **Step 7: Commit**

```bash
git add studio/server/plugins/frameMountPlugin.ts studio/__tests__/server/plugins/frameMountPlugin.test.ts studio/vite.config.ts
git commit -m "Serve frames via virtual-module bootstrap"
```

---

### Task B1.2: Project-dir file watcher plugin

**Files:**
- Create: `studio/server/plugins/projectWatchPlugin.ts`

Vite watches only under `root` by default. Frames live outside (in `~/Library/.../projects/<slug>/frames/`). This plugin adds those directories to the watcher so HMR fires when the agent writes a file.

- [ ] **Step 1: Implement the plugin**

```ts
import type { Plugin } from "vite";
import chokidar from "chokidar";
import { projectsRoot } from "../paths";

export function projectWatchPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  return {
    name: "arcade-studio-project-watch",
    configureServer(server) {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", (event, filePath) => {
        if (!/\.(tsx|ts|css)$/.test(filePath)) return;
        // Full reload is safer than partial HMR for arbitrary-root files.
        server.ws.send({ type: "full-reload", path: "*" });
      });
    },
    async closeBundle() { await watcher?.close(); },
  };
}
```

- [ ] **Step 2: Wire into `vite.config.ts`**

Add `projectWatchPlugin()` to the plugin array.

- [ ] **Step 3: Manual test**

With a frame open in the viewport, edit its `index.tsx` via `echo` on disk. Expected: iframe reloads automatically.

- [ ] **Step 4: Commit**

```bash
git add studio/server/plugins/projectWatchPlugin.ts studio/vite.config.ts
git commit -m "Watch project directories for live reload"
```

---

### Task B1.3: Viewport UI

**Files:**
- Create: `studio/src/components/viewport/Viewport.tsx`
- Create: `studio/src/components/viewport/FrameCard.tsx`
- Create: `studio/src/components/viewport/FrameCornerMenu.tsx`
- Create: `studio/src/components/viewport/EmptyViewport.tsx`
- Create: `studio/src/hooks/useFrames.ts`

- [ ] **Step 1: Create `useFrames.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Project } from "../../server/types";

export interface FrameInfo { slug: string; name: string; size: string; }

export function useFrames(project: Project) {
  const [frames, setFrames] = useState<FrameInfo[]>(project.frames);

  const refresh = useCallback(async () => {
    const p = await fetch(`/api/projects/${project.slug}`).then((r) => r.json()) as Project;
    setFrames(p.frames);
  }, [project.slug]);

  useEffect(() => {
    const id = setInterval(refresh, 1500); // cheap poll; filesystem events are not SSE-pushed in v1
    return () => clearInterval(id);
  }, [refresh]);

  return { frames, refresh };
}
```

- [ ] **Step 2: Create `FrameCornerMenu.tsx`**

```tsx
import { Menu, IconButton } from "arcade";

const SIZES = ["375", "1024", "1440", "1920"] as const;

export function FrameCornerMenu({
  onSize, onRename, onDuplicate, onDelete,
}: {
  onSize: (s: typeof SIZES[number]) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu
      trigger={<IconButton icon="more" ariaLabel="Frame actions" />}
      items={[
        ...SIZES.map((s) => ({ label: `${s}px`, onSelect: () => onSize(s) })),
        { separator: true },
        { label: "Rename", onSelect: onRename },
        { label: "Duplicate", onSelect: onDuplicate },
        { label: "Delete", onSelect: onDelete, destructive: true },
      ]}
    />
  );
}
```

- [ ] **Step 3: Create `FrameCard.tsx`**

```tsx
import { useState } from "react";
import { FrameCornerMenu } from "./FrameCornerMenu";

export function FrameCard({
  projectSlug, frame,
}: { projectSlug: string; frame: { slug: string; name: string; size: string } }) {
  const [hover, setHover] = useState(false);
  const width = Number(frame.size);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginBottom: 8 }}>{frame.name}</div>
      <div style={{ position: "relative", width, height: "calc(100vh - 180px)", background: "var(--surface-shallow)", borderRadius: 12, overflow: "hidden" }}>
        <iframe
          title={frame.name}
          src={`/api/frames/${projectSlug}/${frame.slug}`}
          style={{ width: "100%", height: "100%", border: 0 }}
        />
        {hover && (
          <div style={{ position: "absolute", top: 8, right: 8 }}>
            <FrameCornerMenu
              onSize={() => { /* wired in C2 */ }}
              onRename={() => { /* wired in C2 */ }}
              onDuplicate={() => { /* wired in C2 */ }}
              onDelete={() => { /* wired in C2 */ }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `EmptyViewport.tsx`**

```tsx
export function EmptyViewport() {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--fg-neutral-subtle)" }}>
      Describe what you want to build — or drop a Figma frame into the chat.
    </div>
  );
}
```

- [ ] **Step 5: Create `Viewport.tsx`**

```tsx
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";

export function Viewport({ project }: { project: Project }) {
  const { frames } = useFrames(project);
  if (!frames.length) return <EmptyViewport />;
  return (
    <div style={{
      display: "flex", gap: 32, padding: 24, overflowX: "auto",
      background: "var(--surface-backdrop)", height: "100%",
    }}>
      {frames.map((f) => <FrameCard key={f.slug} projectSlug={project.slug} frame={f} />)}
    </div>
  );
}
```

- [ ] **Step 6: Wire into `ProjectDetail.tsx` (placeholder)**

Create `studio/src/routes/ProjectDetail.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Project } from "../../server/types";
import { Viewport } from "../components/viewport/Viewport";

export function ProjectDetail({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    fetch(`/api/projects/${slug}`).then((r) => r.json()).then(setProject);
  }, [slug]);
  if (!project) return <div>Loading…</div>;
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh" }}>
      <header style={{ padding: 12, borderBottom: "1px solid var(--control-stroke-neutral-medium-active)" }}>
        <button onClick={onBack}>&lt; Projects</button>
        <strong style={{ marginLeft: 12 }}>{project.name}</strong>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr" }}>
        <aside style={{ borderRight: "1px solid var(--control-stroke-neutral-medium-active)", padding: 12 }}>
          <p>Chat pane — wired in Wave C.</p>
        </aside>
        <main><Viewport project={project} /></main>
      </div>
    </div>
  );
}
```

Update `App.tsx` to route to it.

- [ ] **Step 7: Manual smoke test**

Create a frame on disk manually — `frames/welcome/index.tsx` + matching `frames` entry in `project.json`. Confirm it appears in the viewport in a horizontal row.

- [ ] **Step 8: Commit**

```bash
git add studio/src/components/viewport studio/src/hooks/useFrames.ts studio/src/routes/ProjectDetail.tsx studio/src/App.tsx
git commit -m "Render frames in horizontal-row viewport"
```

---

### Task B1.4: Frame registration hook in projects.ts

**Files:**
- Modify: `studio/server/projects.ts`
- Modify: `studio/server/plugins/projectWatchPlugin.ts`

The agent's file edits create `frames/<slug>/index.tsx`. We need `project.json.frames` to stay in sync. Approach: the watcher scans each project's `frames/` on change and reconciles `project.json.frames`.

- [ ] **Step 1: Add a reconciler to `projects.ts`**

Append:
```ts
import type { Frame } from "./types";

export async function reconcileFrames(slug: string): Promise<Frame[]> {
  const project = await getProject(slug);
  if (!project) return [];
  const framesDir = path.join(projectDir(slug), "frames");
  let entries: string[] = [];
  try { entries = await fs.readdir(framesDir); } catch { entries = []; }

  const discovered: Frame[] = [];
  for (const name of entries) {
    const idx = path.join(framesDir, name, "index.tsx");
    try { await fs.access(idx); } catch { continue; }
    const prior = project.frames.find((f) => f.slug === name);
    discovered.push(prior ?? {
      slug: name,
      name: titleCase(name),
      size: "1440",
      createdAt: new Date().toISOString(),
    });
  }

  if (JSON.stringify(discovered) === JSON.stringify(project.frames)) return project.frames;
  const next = await updateProject(slug, { frames: discovered });
  return next.frames;
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

(Add `import path from "node:path";` at top if not already imported.)

- [ ] **Step 2: Call reconciler from watcher**

Modify `projectWatchPlugin.ts` `watcher.on("all", ...)` handler:
```ts
import path from "node:path";
import { projectsRoot } from "../paths";
import { reconcileFrames } from "../projects";
// ...
watcher.on("all", async (_event, filePath) => {
  const rel = path.relative(projectsRoot(), filePath);
  const [slug] = rel.split(path.sep);
  if (!slug) return;
  if (/\.(tsx|ts|css)$/.test(filePath)) {
    try { await reconcileFrames(slug); } catch {}
    server.ws.send({ type: "full-reload", path: "*" });
  }
});
```

- [ ] **Step 3: Test (manual)**

Create a frame file on disk; within a few seconds, `project.json.frames` updates and the viewport shows it.

- [ ] **Step 4: Commit**

```bash
git add studio/server/projects.ts studio/server/plugins/projectWatchPlugin.ts
git commit -m "Reconcile frames/ with project.json on filesystem change"
```

---

### Task B2.1: DESIGN.md generator

**Files:**
- Create: `studio/server/designMd.ts`
- Create: `studio/__tests__/server/designMd.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateDesignMd } from "../../server/designMd";

describe("generateDesignMd", () => {
  it("produces sections for tokens, typography, and components", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "design-md-"));
    const srcDir = path.join(tmp, "src");
    fs.mkdirSync(path.join(srcDir, "components", "ui", "Button"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "components", "ui", "Button", "Button.tsx"), `
/** Button: primary UI control. */
export function Button() { return null; }
`);
    fs.mkdirSync(path.join(srcDir, "tokens", "generated"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "tokens", "generated", "light.css"), `
:root {
  --fg-neutral-prominent: #111;
  --bg-neutral-subtle: #fafafa;
}
`);
    const out = await generateDesignMd({ arcadeGenRoot: tmp });
    expect(out).toMatch(/^# Arcade Design Reference/m);
    expect(out).toMatch(/## Components/);
    expect(out).toMatch(/- `Button`/);
    expect(out).toMatch(/## Tokens/);
    expect(out).toMatch(/fg-neutral-prominent/);
    expect(out).toMatch(/## Typography/);
    expect(out).toMatch(/Chip/);
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `studio/server/designMd.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";

export interface GenerateOptions { arcadeGenRoot: string; }

export async function generateDesignMd(opts: GenerateOptions): Promise<string> {
  const [components, tokens] = await Promise.all([
    listComponents(path.join(opts.arcadeGenRoot, "src", "components")),
    readTokens(path.join(opts.arcadeGenRoot, "src", "tokens", "generated", "light.css")),
  ]);

  return [
    "# Arcade Design Reference",
    "",
    "This is the design system reference for the current prototype.",
    "Prefer arcade-gen components and semantic tokens over raw CSS.",
    "",
    "## Components",
    "",
    components.map((c) => `- \`${c}\``).join("\n"),
    "",
    "## Tokens",
    "",
    "Semantic tokens are CSS custom properties — never use hex literals.",
    "",
    "```css",
    tokens.slice(0, 40).join("\n"),
    "```",
    "",
    "## Typography",
    "",
    "- Font family: **Chip** — use `var(--font-text)`, `var(--font-display)`, `var(--font-mono)`.",
    "- Weights: **440** (normal), **540** (medium), **660** (bold). Never 400/500/700.",
    "",
    "## Themes",
    "",
    "- `arcade` — Computer & Agent Studio (warm achromatic).",
    "- `devrev-app` — System of Record (cool blue-indigo).",
    "",
    "## Rules",
    "",
    "- No hardcoded hex. Use semantic tokens.",
    "- No third-party installs. Only use `arcade` imports.",
    "- Stay inside the project directory; never touch `arcade-gen` source.",
    "- Override DS values only via `theme-overrides.css`.",
    "",
  ].join("\n");
}

async function listComponents(dir: string): Promise<string[]> {
  const out: string[] = [];
  const groups = ["ui", "charts", "layout", "dashboard", "widget"] as const;
  for (const g of groups) {
    try {
      const entries = await fs.readdir(path.join(dir, g));
      for (const e of entries) if (!e.startsWith(".") && !e.endsWith(".ts") && !e.endsWith(".tsx")) out.push(e);
    } catch {}
  }
  return out.sort();
}

async function readTokens(file: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return raw.split("\n").filter((l) => /--[a-z0-9-]+:/i.test(l)).map((l) => l.trim());
  } catch { return []; }
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```bash
git add studio/server/designMd.ts studio/__tests__/server/designMd.test.ts
git commit -m "Generate DESIGN.md from arcade-gen source"
```

---

### Task B2.2: Wire DESIGN.md into project creation and regeneration on launch

**Files:**
- Modify: `studio/server/projects.ts`
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Update `createProject` to write `DESIGN.md`**

In `projects.ts`, replace the `DESIGN.md` write line:
```ts
await fs.writeFile(path.join(dir, "DESIGN.md"), ""); // old
```
with:
```ts
const { generateDesignMd } = await import("./designMd");
await fs.writeFile(path.join(dir, "DESIGN.md"), await generateDesignMd({ arcadeGenRoot: path.resolve(process.cwd()) }));
```

- [ ] **Step 2: Add launch-time regeneration hook**

Create `studio/server/designMdLauncher.ts`:
```ts
import path from "node:path";
import fs from "node:fs/promises";
import { listProjects } from "./projects";
import { projectDir } from "./paths";
import { generateDesignMd } from "./designMd";

export async function regenerateAllDesignMd(arcadeGenRoot: string): Promise<number> {
  const body = await generateDesignMd({ arcadeGenRoot });
  const ps = await listProjects();
  for (const p of ps) {
    await fs.writeFile(path.join(projectDir(p.slug), "DESIGN.md"), body);
  }
  return ps.length;
}
```

Call once at server start from a tiny plugin in `vite.config.ts`:
```ts
import { regenerateAllDesignMd } from "./server/designMdLauncher";
// in apiPlugin's configureServer:
regenerateAllDesignMd(path.resolve(__dirname, "..")).catch(() => {});
```

- [ ] **Step 3: Manual smoke test**

Create a project, delete its `DESIGN.md`, restart `pnpm studio`. Confirm `DESIGN.md` reappears.

- [ ] **Step 4: Commit**

```bash
git add studio/server/projects.ts studio/server/designMdLauncher.ts studio/vite.config.ts
git commit -m "Regenerate DESIGN.md on project creation and studio launch"
```

---

### Task B3.1: CLAUDE.md template + empty-state prompt chips

**Files:**
- Create: `studio/templates/CLAUDE.md.tpl`
- Modify: `studio/server/projects.ts` (fill the template)
- Create: `studio/src/components/chat/EmptyStatePrompts.tsx`

- [ ] **Step 1: Create `studio/templates/CLAUDE.md.tpl`**

Placeholders are `{{PROJECT_NAME}}` and `{{THEME}}`.

```markdown
# {{PROJECT_NAME}}

You are helping a DevRev designer prototype a feature. All work happens inside this project directory.

## Communication style

The user is a designer, not an engineer. Never mention file paths, tool names, stack traces, or terminal commands. Speak about colors, type, spacing, components, screens.

## Where things live

- Frames: `frames/<slug>/index.tsx`. Each frame's default export is the component rendered in the viewport.
- Shared React primitives: `shared/`.
- Local DS overrides: `theme-overrides.css` at the project root. Never touch arcade-gen source, never install packages.

## Design system

Use components from `arcade` (the DevRev arcade-gen library). See `DESIGN.md` for the full reference. Key rules:

- Current theme: **{{THEME}}**. Keep it consistent across frames.
- Never hardcode hex values. Always use semantic tokens (`var(--fg-neutral-prominent)`, `var(--surface-shallow)`, etc.).
- Font weights: use **440 / 540 / 660** only.
- Prefer composition of arcade-gen primitives over hand-rolled HTML.

## Tools you can use

- `Read`, `Write`, `Edit`, `Glob`, `Grep` — filesystem inside this project.
- `Bash(figma-cli:*)` — only for figma-cli commands, e.g. `cd ~/figma-cli && node src/index.js get "1:2"`.

## Rules

- Stay inside this project directory. Never modify `node_modules/` or arcade-gen source.
- When the user pastes a Figma URL, read the node, read any Dev Mode annotations, and export any required icons to `/tmp/arcade-studio-<slug>/` before building the frame.
- When creating a new frame, name its directory with a two-digit prefix (`01-welcome`, `02-signup`, ...). `index.tsx` must `export default` a React component.
- When fixing a frame that has a build error, make the smallest change that resolves it.
```

- [ ] **Step 2: Fill template in `createProject`**

Replace the placeholder `CLAUDE.md` write:
```ts
await fs.writeFile(path.join(dir, "CLAUDE.md"), ""); // old
```
with:
```ts
const tpl = await fs.readFile(
  path.resolve(process.cwd(), "studio", "templates", "CLAUDE.md.tpl"), "utf-8",
);
await fs.writeFile(
  path.join(dir, "CLAUDE.md"),
  tpl.replace("{{PROJECT_NAME}}", input.name).replace("{{THEME}}", input.theme),
);
```

- [ ] **Step 3: Empty-state prompt chips (UI)**

`studio/src/components/chat/EmptyStatePrompts.tsx`:
```tsx
const PROMPTS = [
  "Build a login screen",
  "Create a dashboard with a bar chart and a data table",
  "Design a settings page with tabs",
];

export function EmptyStatePrompts({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div style={{ display: "grid", gap: 8, padding: 12 }}>
      <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12 }}>Try starting with:</div>
      {PROMPTS.map((p) => (
        <button
          key={p}
          onClick={() => onPick(p)}
          style={{
            textAlign: "left", padding: "8px 12px", borderRadius: 8,
            background: "var(--bg-neutral-subtle)", border: "1px solid var(--control-stroke-neutral-medium-active)",
            color: "var(--fg-neutral-prominent)", cursor: "pointer",
          }}
        >{p}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

Create a new project, confirm `CLAUDE.md` reads correctly and references DESIGN.md.

- [ ] **Step 5: Commit**

```bash
git add studio/templates studio/server/projects.ts studio/src/components/chat
git commit -m "Add CLAUDE.md template and empty-state prompt chips"
```

---

## Integration Checkpoint B (single agent, ~0.5 day)

- [ ] **Step 1: DS fidelity E2E** — Create a project; run a chat turn with prompt "Build a simple login screen using the Button and Input components." (via curl against `/api/chat`). Wait for the agent to write `frames/01-login/index.tsx`.

- [ ] **Step 2: Reconciliation check** — confirm `project.json.frames` gains the new frame within 2s.

- [ ] **Step 3: Visual check** — open the studio in the browser, open that project, see the login frame rendered with arcade tokens (no raw hex colors, Chip fonts loaded, semantic tokens visible in devtools).

- [ ] **Step 4: HMR check** — edit the frame's `index.tsx` on disk, iframe reloads within 1s.

- [ ] **Step 5: Commit any fixes**

```bash
git commit -am "Wave B integration checkpoint fixes" || true
```

---

## WAVE C — Interaction polish

### Task C1.1: Chat UI — messages, narration, input

**Files:**
- Create: `studio/src/components/chat/ChatPane.tsx`
- Create: `studio/src/components/chat/MessageList.tsx`
- Create: `studio/src/components/chat/MessageBubble.tsx`
- Create: `studio/src/components/chat/AgentNarration.tsx`
- Create: `studio/src/components/chat/PromptInput.tsx`
- Create: `studio/src/hooks/useChatStream.ts`
- Create: `studio/__tests__/components/chat/AgentNarration.test.tsx`

- [ ] **Step 1: Create `useChatStream.ts`**

```ts
import { useCallback, useRef, useState } from "react";
import type { StudioEvent } from "../lib/streamJson";

export interface StreamState {
  busy: boolean;
  error: string | null;
  narrations: string[];     // rolling transcript for current turn
  lastEvent: StudioEvent | null;
}

export function useChatStream(slug: string) {
  const [state, setState] = useState<StreamState>({ busy: false, error: null, narrations: [], lastEvent: null });
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (prompt: string, images?: string[]) => {
    if (state.busy) return;
    abortRef.current = new AbortController();
    setState({ busy: true, error: null, narrations: [], lastEvent: null });

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt, images }),
      signal: abortRef.current.signal,
    });

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const ev = JSON.parse(dataLine.slice(6)) as StudioEvent;
        setState((s) => {
          if (ev.kind === "narration") return { ...s, lastEvent: ev, narrations: [...s.narrations, ev.text] };
          if (ev.kind === "tool_call") return { ...s, lastEvent: ev, narrations: [...s.narrations, ev.pretty] };
          if (ev.kind === "end" && !ev.ok) return { ...s, busy: false, error: ev.error };
          if (ev.kind === "end") return { ...s, busy: false, lastEvent: ev };
          return { ...s, lastEvent: ev };
        });
      }
    }
  }, [slug, state.busy]);

  const cancel = useCallback(() => { abortRef.current?.abort(); setState((s) => ({ ...s, busy: false })); }, []);

  return { state, send, cancel };
}
```

- [ ] **Step 2: Create `MessageBubble.tsx`**

```tsx
export function MessageBubble({
  role, children,
}: { role: "user" | "assistant"; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", margin: "8px 0" }}>
      <div style={{
        maxWidth: "85%", padding: "8px 12px", borderRadius: 12,
        background: isUser ? "var(--control-bg-neutral-prominent-idle)" : "var(--surface-shallow)",
        color: isUser ? "var(--fg-neutral-on-prominent)" : "var(--fg-neutral-prominent)",
      }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Create `AgentNarration.tsx`**

```tsx
export function AgentNarration({ text }: { text: string }) {
  return (
    <div style={{
      padding: "4px 12px", color: "var(--fg-neutral-subtle)", fontSize: 12,
      fontStyle: "italic",
    }}>
      {text}
    </div>
  );
}
```

Test `studio/__tests__/components/chat/AgentNarration.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentNarration } from "../../../src/components/chat/AgentNarration";

describe("AgentNarration", () => {
  it("renders the plain-language text", () => {
    render(<AgentNarration text="Reading Figma frame" />);
    expect(screen.getByText("Reading Figma frame")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Create `MessageList.tsx`**

```tsx
import { MessageBubble } from "./MessageBubble";
import { AgentNarration } from "./AgentNarration";
import type { ChatMessage } from "../../../server/types";

export function MessageList({
  history, currentNarrations,
}: { history: ChatMessage[]; currentNarrations: string[] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      {history.map((m) => (
        <MessageBubble key={m.id} role={m.role === "user" ? "user" : "assistant"}>
          {m.content}
        </MessageBubble>
      ))}
      {currentNarrations.map((t, i) => <AgentNarration key={i} text={t} />)}
    </div>
  );
}
```

- [ ] **Step 5: Create `PromptInput.tsx`**

```tsx
import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "arcade";

export function PromptInput({
  busy, onSend,
}: { busy: boolean; onSend: (prompt: string, images: string[]) => void }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const p = text.trim();
    if (!p || busy) return;
    onSend(p, images);
    setText(""); setImages([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <div style={{ padding: 12, borderTop: "1px solid var(--control-stroke-neutral-medium-active)" }}>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {images.map((src, i) => (
            <img key={i} src={src} alt="attachment" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover" }} />
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Describe what to build… (Cmd+Enter to send)"
        style={{ width: "100%", minHeight: 60, resize: "vertical", fontFamily: "var(--font-text)" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Button variant="primary" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? "Working…" : "Generate"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `ChatPane.tsx`**

```tsx
import { useEffect, useState } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStream } from "../../hooks/useChatStream";
import type { ChatMessage } from "../../../server/types";
import { EmptyStatePrompts } from "./EmptyStatePrompts";

export function ChatPane({ projectSlug }: { projectSlug: string }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const { state, send } = useChatStream(projectSlug);

  async function refresh() {
    const r = await fetch(`/api/projects/${projectSlug}/history`);
    if (r.ok) setHistory(await r.json());
  }

  useEffect(() => { void refresh(); }, [projectSlug]);
  useEffect(() => { if (!state.busy) void refresh(); }, [state.busy]);

  if (!history.length && !state.busy) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <EmptyStatePrompts onPick={(p) => send(p)} />
        <div style={{ flex: 1 }} />
        <PromptInput busy={state.busy} onSend={send} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MessageList history={history} currentNarrations={state.narrations} />
      {state.error && (
        <div style={{ padding: 8, background: "var(--bg-alert-subtle)", color: "var(--bg-alert-prominent)" }}>
          {state.error}
        </div>
      )}
      <PromptInput busy={state.busy} onSend={send} />
    </div>
  );
}
```

- [ ] **Step 7: Expose `/api/projects/:slug/history`**

In `projects.ts`, add an exported reader:
```ts
export async function readHistory(slug: string): Promise<ChatMessage[]> {
  try { return JSON.parse(await fs.readFile(chatHistoryPath(slug), "utf-8")); }
  catch { return []; }
}
```
(Top import: `import type { ChatMessage } from "./types";`.)

In `server/middleware/projects.ts`, branch before the main parser:
```ts
const histMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/history$/);
if (req.method === "GET" && histMatch) {
  return send(res, 200, await readHistory(histMatch[1]));
}
```

- [ ] **Step 8: Wire `ChatPane` into `ProjectDetail`**

Replace the placeholder `<aside>` with `<ChatPane projectSlug={project.slug} />`.

- [ ] **Step 9: Manual smoke test**

Create a project → type a prompt → see narration stream, agent writes a frame, frame renders. Reload — history persists.

- [ ] **Step 10: Commit**

```bash
git add studio/src/components/chat studio/src/hooks/useChatStream.ts studio/src/routes/ProjectDetail.tsx studio/server/projects.ts studio/server/middleware/projects.ts studio/__tests__/components/chat
git commit -m "Add chat pane with streaming narration"
```

---

### Task C1.2: Figma URL paste + "+ From Figma" action

**Files:**
- Create: `studio/src/lib/figmaUrl.ts`
- Create: `studio/__tests__/lib/figmaUrl.test.ts`
- Create: `studio/src/components/chat/FigmaUrlModal.tsx`
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Modify: `studio/src/components/chat/ChatPane.tsx`

- [ ] **Step 1: Write `figmaUrl.ts`**

```ts
const FIGMA_HOST = /(?:^|\/\/)(?:www\.)?figma\.com/;

export function extractFigmaUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const u of urls) if (FIGMA_HOST.test(u) && /node-id=/.test(u)) return u;
  return null;
}

export function decoratePromptWithFigma(prompt: string, url: string): string {
  if (prompt.includes(url)) return prompt;
  return `${prompt}\n\nFigma reference: ${url}`;
}
```

Test:
```ts
import { describe, it, expect } from "vitest";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../src/lib/figmaUrl";

describe("figmaUrl helpers", () => {
  it("extracts a Figma URL with node id", () => {
    expect(extractFigmaUrl("Look at https://www.figma.com/design/abc/Foo?node-id=1-2"))
      .toBe("https://www.figma.com/design/abc/Foo?node-id=1-2");
  });
  it("returns null without a node id", () => {
    expect(extractFigmaUrl("https://www.figma.com/design/abc/Foo")).toBeNull();
  });
  it("decoratePromptWithFigma appends the url", () => {
    const out = decoratePromptWithFigma("Build this", "https://figma.com/design/a?node-id=1-2");
    expect(out).toContain("Figma reference:");
  });
});
```

- [ ] **Step 2: Create `FigmaUrlModal.tsx`**

```tsx
import { useState } from "react";
import { Modal, Input, Button } from "arcade";

export function FigmaUrlModal({
  open, onClose, onSubmit,
}: { open: boolean; onClose: () => void; onSubmit: (url: string, note: string) => void }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="From Figma">
      <div style={{ display: "grid", gap: 8 }}>
        <Input placeholder="Paste a Figma frame URL" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
        <Input placeholder="What should I build from this? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!url} onClick={() => onSubmit(url, note)}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Update `PromptInput.tsx` to expose action chips**

Add above the textarea:
```tsx
<div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
  <button onClick={props.onPickImage}>📎 Attach image</button>
  <button onClick={props.onPickFigma}>🎨 From Figma</button>
</div>
```

Extend `PromptInputProps` with `onPickImage: () => void;` and `onPickFigma: () => void;`.

- [ ] **Step 4: Update `ChatPane.tsx`**

- Track `showFigma` state.
- On send, detect Figma URL in the prompt via `extractFigmaUrl`. If present, pre-decorate with `decoratePromptWithFigma` (the URL is already in the text; no-op if it's the only thing there).
- Wire `onPickFigma={() => setShowFigma(true)}`.
- Pass the URL into `send(decoratePromptWithFigma(note || "Build a frame from this Figma reference.", url))` on modal submit.
- File-picker wiring for images happens in Task C1.3.

- [ ] **Step 5: Manual smoke test**

Paste a Figma URL in the prompt → agent (with figma-cli running) reads it. Click "+ From Figma" → modal → submit → same outcome.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/figmaUrl.ts studio/src/components/chat/FigmaUrlModal.tsx studio/src/components/chat/PromptInput.tsx studio/src/components/chat/ChatPane.tsx studio/__tests__/lib/figmaUrl.test.ts
git commit -m "Support Figma URL input via paste and From Figma action"
```

---

### Task C1.3: Image attachment (drag + paste)

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Modify: `studio/server/middleware/chat.ts`
- Create: `studio/server/middleware/uploads.ts`

The agent needs file paths, not browser-side data URLs. We POST images to `/api/uploads/:slug`, get back absolute paths, pass them to `/api/chat` as `images: [path, ...]`.

- [ ] **Step 1: Implement `/api/uploads/:slug`**

`studio/server/middleware/uploads.ts`:
```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { projectDir } from "../paths";

export function uploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = req.url?.match(/^\/api\/uploads\/([a-z0-9-]+)$/);
    if (!m || req.method !== "POST") return next?.();
    const slug = m[1];

    const ct = req.headers["content-type"] ?? "";
    const extMatch = /image\/(png|jpeg|webp|gif)/.exec(ct);
    if (!extMatch) {
      res.writeHead(400); res.end(JSON.stringify({ error: { message: "Unsupported image type" } })); return;
    }
    const dir = path.join(projectDir(slug), "_uploads");
    await fs.mkdir(dir, { recursive: true });
    const name = `${Date.now()}.${extMatch[1]}`;
    const abs = path.join(dir, name);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    await fs.writeFile(abs, Buffer.concat(chunks));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ path: abs, url: `/@fs${abs}` }));
  };
}
```

Wire into `apiPlugin`.

- [ ] **Step 2: Update `PromptInput.tsx` to accept drag/paste**

```tsx
async function uploadImage(blob: Blob): Promise<{ path: string; url: string }> {
  const res = await fetch(`/api/uploads/${props.projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  return res.json();
}

function onPaste(e: React.ClipboardEvent) {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile(); if (!file) continue;
      e.preventDefault();
      uploadImage(file).then(({ path, url }) => {
        setImages((xs) => [...xs, url]); setImagePaths((xs) => [...xs, path]);
      });
    }
  }
}

function onDrop(e: React.DragEvent) {
  e.preventDefault();
  for (const file of e.dataTransfer.files) if (file.type.startsWith("image/")) {
    uploadImage(file).then(({ path, url }) => {
      setImages((xs) => [...xs, url]); setImagePaths((xs) => [...xs, path]);
    });
  }
}
```

Attach `onPaste` to the textarea and `onDrop`/`onDragOver` to the container. Submit now passes `imagePaths` (not `images` URLs) to `onSend`.

Add `projectSlug: string` to `PromptInputProps`.

- [ ] **Step 3: Accept `images` in `/api/chat`**

Already done in A2.3's contract. Confirm the `useChatStream.send(prompt, images)` thread passes them through.

- [ ] **Step 4: Manual smoke test**

Drag a PNG into the prompt → thumbnail appears → send → agent writes a frame that visually matches.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/uploads.ts studio/src/components/chat/PromptInput.tsx studio/vite.config.ts
git commit -m "Support image attachments in chat"
```

---

### Task C2.1: Header + theme toggle + frame corner menu wiring

**Files:**
- Create: `studio/src/components/Header.tsx`
- Modify: `studio/src/routes/ProjectDetail.tsx`
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Modify: `studio/src/components/viewport/FrameCornerMenu.tsx`

- [ ] **Step 1: Create `Header.tsx`**

```tsx
import { Switch, IconButton } from "arcade";

export function Header({
  name, mode, onBack, onToggleMode, onToggleDev,
}: {
  name: string;
  mode: "light" | "dark";
  onBack: () => void;
  onToggleMode: () => void;
  onToggleDev: () => void;
}) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 12px", height: 44, borderBottom: "1px solid var(--control-stroke-neutral-medium-active)" }}>
      <button onClick={onBack} style={{ border: 0, background: "transparent" }}>&lt; Projects</button>
      <span style={{ color: "var(--fg-neutral-subtle)" }}>•</span>
      <strong>{name}</strong>
      <div style={{ flex: 1 }} />
      <Switch checked={mode === "dark"} onCheckedChange={onToggleMode} label="Dark" />
      <IconButton icon="code" ariaLabel="Developer mode" onClick={onToggleDev} />
    </header>
  );
}
```

- [ ] **Step 2: Update `ProjectDetail.tsx`**

- Track `mode` locally (initial from `project.mode`) and `devOpen`.
- When mode changes, PATCH the project and reload the viewport (iframes pick up via mode propagation added in Step 3).
- Layout becomes 3-column when Dev mode open (`400px 1fr 320px`).

- [ ] **Step 3: Propagate mode into frame bootstrap**

In `frameMountPlugin.ts`, read the project's current mode from `project.json` inside `load()` and emit `class="dark"` on `<html>` + swap `dark.css` when mode is `dark`. Minimal change:

```ts
// Inside the resolved HTML bootstrap `load()`:
// Read project.json sync to decide mode
import fs2 from "node:fs";
import { projectJsonPath } from "../paths";
// ...
const pj = JSON.parse(fs2.readFileSync(projectJsonPath(slug), "utf-8"));
const mode = pj.mode === "dark" ? "dark" : "light";
// return HTML/bootstrap with that mode; import `arcade/tokens/generated/${mode}.css`
```

(Update both the inline HTML in `configureServer` and the virtual module in `load`.)

- [ ] **Step 4: Frame corner menu wiring**

In `FrameCornerMenu`, the `onSize`/`onRename`/`onDuplicate`/`onDelete` props already exist. Implement them in `FrameCard`:
```tsx
async function setSize(size: "375" | "1024" | "1440" | "1920") {
  await fetch(`/api/projects/${projectSlug}/frames/${frame.slug}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size }),
  });
}
// rename / duplicate / delete analogous
```

Add matching routes to `/api/projects/:slug/frames/:frame` in `server/middleware/projects.ts`:
```ts
const frameMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/frames\/([a-z0-9-]+)$/);
if (frameMatch && req.method === "PATCH") {
  const body = await readJson(req);
  const p = await getProject(frameMatch[1]);
  if (!p) return send(res, 404, { error: { message: "Not found" } });
  const frames = p.frames.map((f) => f.slug === frameMatch[2] ? { ...f, ...body } : f);
  return send(res, 200, await updateProject(frameMatch[1], { frames }));
}
if (frameMatch && req.method === "DELETE") {
  // Remove directory + entry
  const { frameDir } = await import("../paths");
  await fs.rm(frameDir(frameMatch[1], frameMatch[2]), { recursive: true, force: true });
  const p = await getProject(frameMatch[1]);
  if (!p) return send(res, 404, { error: { message: "Not found" } });
  return send(res, 200, await updateProject(frameMatch[1], { frames: p.frames.filter((f) => f.slug !== frameMatch[2]) }));
}
```

(Add `import fs from "node:fs/promises";` at top of the middleware if missing.)

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/Header.tsx studio/src/components/viewport studio/src/routes/ProjectDetail.tsx studio/server/middleware/projects.ts studio/server/plugins/frameMountPlugin.ts
git commit -m "Add header, theme toggle, and frame corner-menu actions"
```

---

### Task C2.2: Dev mode panel

**Files:**
- Create: `studio/src/components/devmode/DevModePanel.tsx`
- Create: `studio/src/components/devmode/FileTree.tsx`
- Modify: `studio/server/middleware/projects.ts` (add `GET /api/projects/:slug/tree` and `/api/projects/:slug/file?path=...`)

- [ ] **Step 1: Add file-tree endpoints**

In `projects.ts` (server/):
```ts
export async function fileTree(slug: string): Promise<string[]> {
  const root = projectDir(slug);
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "thumbnails" || e.name === "_uploads") continue;
      const full = path.join(dir, e.name), next = path.join(rel, e.name);
      if (e.isDirectory()) { out.push(next + "/"); await walk(full, next); }
      else out.push(next);
    }
  }
  await walk(root, "");
  return out;
}

export async function readFile(slug: string, rel: string): Promise<string> {
  const full = path.resolve(projectDir(slug), rel);
  if (!full.startsWith(projectDir(slug))) throw new Error("Path escape");
  return fs.readFile(full, "utf-8");
}
```

Add two handlers in `server/middleware/projects.ts`:
```ts
const treeMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/tree$/);
if (treeMatch && req.method === "GET") {
  return send(res, 200, await fileTree(treeMatch[1]));
}
const fileMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/file\?path=(.+)$/);
if (fileMatch && req.method === "GET") {
  return send(res, 200, { content: await readFile(fileMatch[1], decodeURIComponent(fileMatch[2])) });
}
```

- [ ] **Step 2: Create `FileTree.tsx`**

```tsx
import { useEffect, useState } from "react";

export function FileTree({ slug, onPick }: { slug: string; onPick: (p: string) => void }) {
  const [entries, setEntries] = useState<string[]>([]);
  useEffect(() => { fetch(`/api/projects/${slug}/tree`).then((r) => r.json()).then(setEntries); }, [slug]);
  return (
    <ul style={{ fontFamily: "var(--font-mono)", fontSize: 12, padding: 8, margin: 0, listStyle: "none" }}>
      {entries.map((e) => (
        <li key={e} onClick={() => !e.endsWith("/") && onPick(e)}
            style={{ padding: "2px 4px", cursor: e.endsWith("/") ? "default" : "pointer" }}>
          {e}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Create `DevModePanel.tsx`**

```tsx
import { useState } from "react";
import { FileTree } from "./FileTree";

export function DevModePanel({ slug }: { slug: string }) {
  const [picked, setPicked] = useState<{ path: string; content: string } | null>(null);

  async function pick(p: string) {
    const r = await fetch(`/api/projects/${slug}/file?path=${encodeURIComponent(p)}`).then((r) => r.json());
    setPicked({ path: p, content: r.content });
  }

  return (
    <aside style={{ borderLeft: "1px solid var(--control-stroke-neutral-medium-active)", display: "grid", gridTemplateRows: "1fr auto" }}>
      <FileTree slug={slug} onPick={pick} />
      {picked && (
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflow: "auto", padding: 8, background: "var(--surface-shallow)", margin: 0 }}>
          {picked.content}
        </pre>
      )}
      <button onClick={() => fetch(`/api/projects/${slug}/reveal`, { method: "POST" })}>Reveal in Finder</button>
    </aside>
  );
}
```

- [ ] **Step 4: Add `POST /api/projects/:slug/reveal`**

In middleware:
```ts
const revealMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/reveal$/);
if (revealMatch && req.method === "POST") {
  const { projectDir } = await import("../paths");
  const { spawn } = await import("node:child_process");
  spawn("open", [projectDir(revealMatch[1])]);
  return send(res, 204);
}
```

- [ ] **Step 5: Mount `DevModePanel` when `devOpen`**

Conditionally render in `ProjectDetail.tsx`.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/devmode studio/server/projects.ts studio/server/middleware/projects.ts studio/src/routes/ProjectDetail.tsx
git commit -m "Add Dev mode panel with read-only file tree"
```

---

### Task C2.3: Project card thumbnails

**Files:**
- Create: `studio/server/thumbnails.ts`
- Modify: `studio/server/middleware/projects.ts`
- Modify: `studio/src/components/projects/ProjectCard.tsx`

- [ ] **Step 1: Implement thumbnail capture**

For v1, use a lightweight approach: when a frame is first rendered in the viewport, the iframe `onLoad` triggers a client-side `html2canvas`-style capture. Given we want no extra dep, use Playwright-via-`@playwright/test` if already in deps; otherwise fall back to **no thumbnail** (gray placeholder showing the project's theme color).

Keep v1 simple: **no captured thumbnail**. Instead, show a tinted placeholder keyed off `project.theme`. Defer real capture to v-next.

`studio/server/thumbnails.ts`:
```ts
export function placeholderTint(theme: "arcade" | "devrev-app"): string {
  return theme === "arcade"
    ? "linear-gradient(135deg, #F5F2EF, #E6DFD6)"
    : "linear-gradient(135deg, #E8EEFB, #D3DEF4)";
}
```

- [ ] **Step 2: Update `ProjectCard.tsx`**

Add a `thumbnail` box above the name using `placeholderTint(project.theme)`.

```tsx
import { placeholderTint } from "../../../server/thumbnails";
// ...
<div style={{ height: 120, borderRadius: 8, marginBottom: 12, background: placeholderTint(project.theme) }} />
```

- [ ] **Step 3: Commit**

```bash
git add studio/server/thumbnails.ts studio/src/components/projects/ProjectCard.tsx
git commit -m "Add theme-tinted placeholder for project cards"
```

---

### Task C2.4: Error banners + auth-expired notice

**Files:**
- Create: `studio/src/components/feedback/ErrorBanner.tsx`
- Create: `studio/src/components/feedback/AuthExpiredNotice.tsx`
- Modify: `studio/src/hooks/useChatStream.ts`

- [ ] **Step 1: Create components**

`ErrorBanner.tsx`:
```tsx
import { Banner } from "arcade";
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Banner variant="alert" title="Something went wrong" description={message} action={onRetry ? { label: "Try again", onClick: onRetry } : undefined} />;
}
```

`AuthExpiredNotice.tsx`:
```tsx
import { Banner } from "arcade";
export function AuthExpiredNotice() {
  return (
    <Banner
      variant="warning"
      title="Your AWS session looks expired"
      description={`Run "aws sso login --profile dev" in a terminal, then try again.`}
    />
  );
}
```

- [ ] **Step 2: Classify errors in `useChatStream`**

```ts
const AUTH_EXPIRED = /sso|credential|expired|unauthorized/i;

// when handling end/ok=false:
return { ...s, busy: false, error: ev.error, errorKind: AUTH_EXPIRED.test(ev.error) ? "auth" : "generic" };
```

Extend `StreamState` with `errorKind?: "auth" | "generic"`.

- [ ] **Step 3: Wire into `ChatPane.tsx`**

Replace the plain red div with:
```tsx
{state.error && state.errorKind === "auth" && <AuthExpiredNotice />}
{state.error && state.errorKind !== "auth" && <ErrorBanner message={state.error} onRetry={() => send(lastPrompt)} />}
```

(Track `lastPrompt` in `useChatStream` so retry is possible.)

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/feedback studio/src/hooks/useChatStream.ts studio/src/components/chat/ChatPane.tsx
git commit -m "Surface plain-language errors and auth-expired hints"
```

---

## Integration Checkpoint C (single agent, ~0.5 day)

- [ ] **Step 1: Walkthrough** — create project → type a prompt → Figma paste → image drop → theme toggle → Dev mode reveal in Finder → close tab → reopen → see full history and frames.

- [ ] **Step 2: Kill `aws sso` credentials mid-turn** — run `aws sso logout`, send a turn, confirm the `AuthExpiredNotice` appears and the user message is preserved in chat history.

- [ ] **Step 3: Force a TypeScript error** — edit a frame to introduce a syntax error. Confirm the iframe loads an error overlay (Vite's default) and a subsequent chat turn can fix it. (Auto-fix loop is Phase ∞.)

- [ ] **Step 4: Commit reconciliation fixes**

---

## PHASE ∞ — Hardening (ongoing, serial)

### Task H1: Frame build-error auto-recovery

**Files:**
- Modify: `studio/server/plugins/frameMountPlugin.ts`
- Create: `studio/server/buildErrorReporter.ts`

Goal: when a frame fails to compile, the tool automatically composes a chat turn that asks the agent to fix it. Max 1 auto-retry per frame per minute.

- [ ] **Step 1: Intercept Vite's error events**

```ts
// studio/server/buildErrorReporter.ts
import type { ViteDevServer } from "vite";
import path from "node:path";
import { projectsRoot } from "./paths";
import { runClaudeTurn } from "./claudeCode";
import { getProject, updateProject } from "./projects";

const lastAttempt = new Map<string, number>();

export function attachBuildErrorReporter(server: ViteDevServer) {
  server.ws.on("vite:error", async (payload) => {
    const file = payload?.err?.loc?.file as string | undefined;
    if (!file?.startsWith(projectsRoot())) return;
    const rel = path.relative(projectsRoot(), file);
    const [slug, , frameName] = rel.split(path.sep);
    const key = `${slug}/${frameName}`;
    const now = Date.now();
    if ((lastAttempt.get(key) ?? 0) > now - 60_000) return;
    lastAttempt.set(key, now);

    const project = await getProject(slug);
    if (!project) return;
    const bin = process.env.ARCADE_STUDIO_CLAUDE_BIN
      ?? path.resolve(process.cwd(), "studio", "node_modules", ".bin", "claude");
    await runClaudeTurn({
      cwd: path.join(projectsRoot(), slug),
      bin,
      sessionId: project.sessionId,
      prompt: `The frame ${frameName} is failing to build with: ${payload.err.message}. Fix the smallest thing that resolves it; do not restructure.`,
      onEvent: () => {},
    });
  });
}
```

Wire into `vite.config.ts` apiPlugin: `attachBuildErrorReporter(server);`

- [ ] **Step 2: Commit**

```bash
git add studio/server/buildErrorReporter.ts studio/vite.config.ts
git commit -m "Auto-prompt agent to fix build errors in frames"
```

---

### Task H2: AWS SSO pre-flight check

**Files:**
- Create: `studio/server/awsPreflight.ts`
- Modify: `studio/server/middleware/chat.ts`

- [ ] **Step 1: Implement cheap cached preflight**

```ts
import { spawn } from "node:child_process";

let lastOk = 0;
export async function ssoIsValid(): Promise<boolean> {
  if (Date.now() - lastOk < 30_000) return true;
  return new Promise((resolve) => {
    const p = spawn("aws", ["sts", "get-caller-identity"], { env: process.env });
    p.on("close", (code) => { if (code === 0) { lastOk = Date.now(); resolve(true); } else resolve(false); });
    p.on("error", () => resolve(false));
  });
}
```

- [ ] **Step 2: Guard `/api/chat`**

At the top of the handler, before spawning claude:
```ts
if (!(await ssoIsValid())) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(`event: end\ndata: ${JSON.stringify({ kind: "end", ok: false, error: "AWS SSO credentials expired. Run aws sso login --profile dev." })}\n\n`);
  res.end();
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add studio/server/awsPreflight.ts studio/server/middleware/chat.ts
git commit -m "Pre-check AWS SSO validity before starting a chat turn"
```

---

### Task H3: First-run dependency pre-flight

**Files:**
- Create: `studio/server/firstRun.ts`
- Modify: `studio/vite.config.ts`

Mirror the arcade-prototyper skill's silent installer: Homebrew → Node → pnpm → figma-cli (git clone + `pnpm install` + `pnpm link`).

- [ ] **Step 1: Implement guarded installer**

```ts
// studio/server/firstRun.ts
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { figmaCliDir } from "./figmaCli";

export async function ensureDeps(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  if (!(await has("brew"))) missing.push("brew");
  if (!(await has("node"))) missing.push("node");
  if (!(await has("pnpm"))) missing.push("pnpm");
  try { await fs.access(path.join(figmaCliDir(), "src", "index.js")); } catch { missing.push("figma-cli"); }
  return { ok: missing.length === 0, missing };
}

function has(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd]);
    p.on("close", (code) => resolve(code === 0));
  });
}
```

- [ ] **Step 2: Expose `/api/preflight`**

Add a middleware branch in `apiPlugin`:
```ts
if (req.url === "/api/preflight" && req.method === "GET") {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(await ensureDeps()));
  return;
}
```

Actual silent-install scripts are deferred to a follow-up since they modify the designer's machine and require careful user messaging; for v1 this just reports `missing`. A banner in the UI shows the shell snippet for the designer to paste.

- [ ] **Step 3: Commit**

```bash
git add studio/server/firstRun.ts studio/vite.config.ts
git commit -m "Add first-run dependency pre-flight endpoint"
```

---

## Self-Review (pre-handoff, performed by plan author)

- [ ] Placeholder scan — `grep -nE 'TBD|TODO|fill in|similar to' docs/superpowers/plans/2026-04-21-arcade-studio.md` returns no matches.
- [ ] Spec coverage — each spec decision (table in §3) maps to one or more tasks:
    - Conversational + live artifact → A2.*, B1.*, C1.1
    - Live React via arcade-gen → B1.*
    - Files on disk + HMR → B1.*
    - figma-cli now / MCP later → A3.*, C1.2
    - Local web v1 → Phase 0, throughout
    - Claude Code subprocess → A2.*
    - Chat left + viewport right → B1.3, C1.1
    - Horizontal-row tall-vertical frames → B1.3
    - Hybrid agent-proposed frames → B1.4
    - Multi-frame logic in chat → (no extra UI; covered by agent via CLAUDE.md B3.1)
    - Theme overrides per project → B1.1, B3.1
    - Named projects local → A1.*
    - Figma URL + "+ From Figma" → C1.2
    - Image input drag/paste → C1.3
    - Global theme toggle → C2.1
    - Naked frame + corner menu → B1.3, C2.1
    - Project list first screen → A1.4
    - Plain narration / errors / Dev mode → A2.1, C1.1, C2.2, C2.4
- [ ] Commits are frequent and atomic (every task ends with a commit step).
- [ ] Type consistency — `StudioEvent` shape shared between `streamJson.ts`, `claudeCode.ts`, `useChatStream.ts`. `Project`/`Frame` types from `server/types.ts` used throughout.
- [ ] `ARCADE_STUDIO_ROOT`, `ARCADE_STUDIO_CLAUDE_BIN`, `ARCADE_STUDIO_FIGMA_CLI_DIR` — env overrides consistent.
- [ ] Port 5556 used consistently (not conflicting with playground 5555).

---

*Plan authored 2026-04-21, referencing spec `docs/superpowers/specs/2026-04-21-arcade-studio-design.md`.*
