# Homepage Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "start from a template" path to the Arcade Studio homepage — a tabbed shelf (My projects | Templates) where picking a template instantly seeds a fully-rendered frame into a new project.

**Architecture:** Each template is ONE `.tsx` source file that does double duty: it is both the thumbnail's render source (build-time PNG) and the seed frame written into the project on disk. Picking a template creates a project, writes `frames/01-<id>/index.tsx`, and opens the project — no generation, no tokens. The homepage's Projects grid becomes a tabbed shelf with a smart default tab.

**Tech Stack:** TypeScript, React 18, Vite middleware (node:http handlers), `@xorkavi/arcade-gen` (ToggleGroup), Playwright + `packFromSource` (thumbnail render), Vitest.

## Global Constraints

- Package manager is **pnpm** — never `npm`/`yarn`.
- Run from **repo root**, not `studio/`. Tests: `pnpm run studio:test <path>`; full suite: `pnpm run studio:test`.
- **Vite middleware does NOT hot-reload** — after editing anything under `studio/server/middleware/*` or `vite.config.ts`, the dev server must be restarted to test manually. (Tests run independently and don't need this.)
- Conventional Commits, scope `studio/<area>`: `feat(studio/home): …`, `feat(studio/templates): …`.
- Never `git add -A`/`git add .` — stage explicit paths only.
- Templates are seeded `theme: "arcade"`, `mode: "light"`.
- Three templates only: `computer`, `settings-page`, `app-list`. More are added later by appending to the manifest.
- Seed `.tsx` files import only from `arcade-prototypes` / `arcade/components` (the aliases generated frames use), NOT relative paths.
- Component test files MUST mock `@xorkavi/arcade-gen` (gridstack ESM resolution breaks otherwise). Any arcade-gen component a tested component uses must appear in the mock.
- Branch: `feat/homepage-templates` (already created off `chore/studio-cleanup-audit`).

---

### Task 1: Template manifest + seed sources

Create the three seed `.tsx` files and the server-side manifest that names them. This is the data foundation every later task consumes. No thumbnails yet (Task 3); the manifest references thumbnail paths that get populated later.

**Files:**
- Create: `studio/prototype-kit/template-seeds/computer.tsx`
- Create: `studio/prototype-kit/template-seeds/settings-page.tsx`
- Create: `studio/prototype-kit/template-seeds/app-list.tsx`
- Create: `studio/server/templates.ts`
- Test: `studio/__tests__/server/templates.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - `studio/prototype-kit/template-seeds/<id>.tsx` — readable seed source files.
  - `studio/server/templates.ts` exports:
    - `interface TemplateDef { id: TemplateId; name: string; description: string; seedFile: string; thumb: string; }`
    - `type TemplateId = "computer" | "settings-page" | "app-list";`
    - `const TEMPLATES: TemplateDef[]`
    - `function getTemplate(id: string): TemplateDef | undefined`
    - `function readTemplateSeed(id: TemplateId): Promise<string>` — reads the seed `.tsx` from disk.
    - `const TEMPLATE_SEEDS_DIR: string`, `const TEMPLATE_THUMBS_DIR: string` (absolute paths under `studio/prototype-kit/`).

- [ ] **Step 1: Write the computer seed source**

Create `studio/prototype-kit/template-seeds/computer.tsx`:

```tsx
import * as React from "react";
import { ComputerScene } from "arcade-prototypes";

// Template seed: Computer / Agent Studio chat screen.
// ComputerScene renders a settled multi-turn transcript by default.
export default function ComputerTemplate() {
  return <ComputerScene />;
}
```

- [ ] **Step 2: Write the app-list seed source**

Create `studio/prototype-kit/template-seeds/app-list.tsx` (lifted from `studio/__tests__/lift/loop-fixtures/list-view/index.tsx`, self-contained — no sibling-frame links):

```tsx
import * as React from "react";
import { VistaPage, VistaFilterPill, VistaPagination, VistaRow } from "arcade-prototypes";
import { Button, IconButton, Avatar, Tag, Input } from "arcade/components";
import { MagnifyingGlass, PlusSmall, ChevronRightSmall } from "arcade/components";

const tickets = [
  { id: "TKT-42", title: "Investigate API timeouts on export", stage: "Open", assignee: "Alice Nguyen" },
  { id: "TKT-43", title: "Crash on launch after 0.36 update", stage: "In progress", assignee: "Bob Marsh" },
  { id: "TKT-44", title: "Add bulk-archive to the inbox", stage: "Open", assignee: "Carla Diaz" },
  { id: "TKT-45", title: "Webhook retries fire twice", stage: "In review", assignee: "Dan Okoro" },
  { id: "TKT-46", title: "Dark-mode contrast on filter pills", stage: "Open", assignee: "Eve Larsen" },
];

export default function AppListTemplate() {
  return (
    <VistaPage
      title="Tickets"
      count={tickets.length}
      primaryAction={
        <Button variant="primary" size="sm" iconLeft={<PlusSmall size={16} />}>
          New ticket
        </Button>
      }
      actions={
        <IconButton variant="tertiary" size="sm" aria-label="Search">
          <MagnifyingGlass size={16} />
        </IconButton>
      }
      filters={<VistaFilterPill label="Status: Open" />}
    >
      <div className="flex w-full flex-col">
        <div className="px-9 py-3">
          <Input placeholder="Search tickets" />
        </div>
        {tickets.map((t) => (
          <VistaRow key={t.id} stage={t.stage}>
            <span>{t.title}</span>
            <Tag intent="neutral">{t.stage}</Tag>
            <Avatar name={t.assignee} size="sm" />
            <ChevronRightSmall size={16} />
          </VistaRow>
        ))}
        <VistaPagination total={tickets.length} />
      </div>
    </VistaPage>
  );
}
```

- [ ] **Step 3: Write the settings-page seed source**

Create `studio/prototype-kit/template-seeds/settings-page.tsx` (adapted from `studio/__tests__/lift/loop-fixtures/settings-list/index.tsx`, with the `FrameLink` sibling-frame wrapper removed — a fresh project has no `02-skill-modal` to link to):

```tsx
import * as React from "react";
import { SettingsPage, NavSidebar } from "arcade-prototypes";
import { Breadcrumb, Button, IconButton, Avatar, Tabs, Tag, Link } from "arcade/components";
import { MagnifyingGlass, Bell, PlusSmall, TrashBin, LightingBolt, ChevronRightSmall, HumanSilhouette } from "arcade/components";

const sidebarSections: Array<{ title?: string; items: Array<{ label: string; active?: boolean }> }> = [
  { title: "Settings", items: [{ label: "General information" }, { label: "Account" }, { label: "Notifications" }, { label: "Teams" }] },
  { title: "User Management", items: [{ label: "Groups" }, { label: "Roles" }, { label: "Users" }, { label: "Invitations" }, { label: "Skills", active: true }, { label: "Customer management" }] },
];

const skills: Array<{ title: string; description: string }> = [
  { title: "Prospect Research", description: "Pulls a company brief before any outreach so you walk in knowing more than they expect." },
  { title: "Cold Email Writer", description: "Turns a name and a URL into a sharp, personalised first message worth replying to." },
  { title: "Meeting Recap", description: "Summarises a call into decisions, owners, and next steps the moment it ends." },
];

function SkillCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-square-x2 border p-5 text-left"
      style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--surface-overlay)" }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-square" style={{ background: "var(--bg-neutral-soft)" }}>
        <LightingBolt size={20} color="#2563eb" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{title}</div>
        <div className="text-body-small line-clamp-3" style={{ color: "var(--fg-neutral-subtle)" }}>{description}</div>
      </div>
      <div className="mt-2">
        <Tag intent="neutral" appearance="tinted">DevRev</Tag>
      </div>
    </div>
  );
}

export default function SettingsTemplate() {
  return (
    <SettingsPage
      sidebar={
        <NavSidebar>
          {sidebarSections.map((section) => (
            <NavSidebar.Section key={section.title} title={section.title}>
              {section.items.map((item) => (
                <NavSidebar.Item key={item.label} active={item.active}>{item.label}</NavSidebar.Item>
              ))}
            </NavSidebar.Section>
          ))}
        </NavSidebar>
      }
      breadcrumb={
        <Breadcrumb.Root>
          <Breadcrumb.Item><Breadcrumb.Link href="#">Settings</Breadcrumb.Link></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item><Breadcrumb.Link href="#" current>Skills</Breadcrumb.Link></Breadcrumb.Item>
        </Breadcrumb.Root>
      }
      actions={
        <div className="flex items-center gap-1">
          <IconButton variant="tertiary" size="sm" aria-label="Search"><MagnifyingGlass size={16} /></IconButton>
          <IconButton variant="tertiary" size="sm" aria-label="Notifications"><Bell size={16} /></IconButton>
          <Avatar name="Ben Carter" size="sm" />
        </div>
      }
      pageActions={
        <div className="flex items-center gap-2">
          <Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Create new</Button>
          <IconButton variant="tertiary" size="sm" aria-label="Delete"><TrashBin size={16} /></IconButton>
          <Button variant="primary" size="sm">Add skill</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 py-2">
        <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
          <Tabs.Root defaultValue="discover">
            <Tabs.List>
              <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
              <Tabs.Trigger value="mine">My skills</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div
          className="flex items-center gap-4 rounded-square-x2 border px-5 py-4 text-left"
          style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)" }}
        >
          <HumanSilhouette size={20} color="var(--fg-neutral-subtle)" />
          <span>Not sure what capabilities are? <Link mode="inline" href="#">Find out more</Link></span>
          <ChevronRightSmall size={16} color="var(--fg-neutral-subtle)" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => (<SkillCard key={s.title} {...s} />))}
        </div>
      </div>
    </SettingsPage>
  );
}
```

- [ ] **Step 4: Write the failing manifest test**

Create `studio/__tests__/server/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { TEMPLATES, getTemplate, readTemplateSeed, TEMPLATE_SEEDS_DIR } from "../../server/templates";

describe("templates manifest", () => {
  it("exposes exactly the three named templates", () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(["app-list", "computer", "settings-page"]);
  });

  it("every entry has a name, description, and a seed file that exists on disk", async () => {
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      const src = await fs.readFile(`${TEMPLATE_SEEDS_DIR}/${t.id}.tsx`, "utf-8");
      expect(src).toContain("export default");
    }
  });

  it("getTemplate returns undefined for an unknown id", () => {
    expect(getTemplate("nope")).toBeUndefined();
    expect(getTemplate("computer")?.id).toBe("computer");
  });

  it("readTemplateSeed returns the on-disk source", async () => {
    const src = await readTemplateSeed("computer");
    expect(src).toContain("ComputerScene");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/templates.test.ts`
Expected: FAIL — `Cannot find module '../../server/templates'`.

- [ ] **Step 6: Implement the manifest**

Create `studio/server/templates.ts`:

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_SEEDS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-seeds");
export const TEMPLATE_THUMBS_DIR = path.resolve(STUDIO_DIR, "prototype-kit", "template-thumbs");

export type TemplateId = "computer" | "settings-page" | "app-list";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  seedFile: string; // basename under TEMPLATE_SEEDS_DIR
  thumb: string;     // basename under TEMPLATE_THUMBS_DIR
}

export const TEMPLATES: TemplateDef[] = [
  { id: "computer", name: "Computer", description: "Agent chat screen", seedFile: "computer.tsx", thumb: "computer.png" },
  { id: "settings-page", name: "Settings page", description: "DevRev settings layout", seedFile: "settings-page.tsx", thumb: "settings-page.png" },
  { id: "app-list", name: "App list", description: "DevRev list view", seedFile: "app-list.tsx", thumb: "app-list.png" },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function readTemplateSeed(id: TemplateId): Promise<string> {
  const def = getTemplate(id);
  if (!def) return Promise.reject(new Error(`Unknown template: ${id}`));
  return fs.readFile(path.join(TEMPLATE_SEEDS_DIR, def.seedFile), "utf-8");
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/templates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add studio/prototype-kit/template-seeds/computer.tsx studio/prototype-kit/template-seeds/settings-page.tsx studio/prototype-kit/template-seeds/app-list.tsx studio/server/templates.ts studio/__tests__/server/templates.test.ts
git commit -m "feat(studio/templates): manifest + three seed sources"
```

---

### Task 2: Seed a template frame into a project

Add the server function that writes a chosen template's seed source into a new project as a visible `01-<id>` frame, plus the middleware route. The frame is auto-registered by the existing `reconcileFrames` (called on every project GET), so this only writes the file + updates `project.json`'s frame list directly for immediacy.

**Files:**
- Modify: `studio/server/projects.ts` (add `seedTemplateFrame`)
- Modify: `studio/server/middleware/projects.ts` (add the `seed-template` route)
- Test: `studio/__tests__/server/seedTemplateFrame.test.ts`

**Interfaces:**
- Consumes: `getTemplate`, `readTemplateSeed`, `TemplateId` from `studio/server/templates.ts` (Task 1); `projectDir` from `studio/server/paths.ts`; `getProject`, `updateProject` from `studio/server/projects.ts`.
- Produces:
  - `studio/server/projects.ts` exports `async function seedTemplateFrame(slug: string, templateId: string): Promise<Frame>` — writes `frames/01-<templateId>/index.tsx`, returns the new `Frame`. Throws `Error("Unknown template: …")` on bad id; throws if project missing.
  - Route: `POST /api/projects/:slug/seed-template` with body `{ templateId }` → `201` + the `Frame`; unknown id → `404 { error: { code: "not_found" } }`; missing project → `404`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/seedTemplateFrame.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createProject, seedTemplateFrame, getProject } from "../../server/projects";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpl-seed-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
});

afterEach(async () => {
  delete process.env.ARCADE_STUDIO_ROOT;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("seedTemplateFrame", () => {
  it("writes the template source to frames/01-<id>/index.tsx", async () => {
    const p = await createProject({ name: "App list", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "app-list");
    expect(frame.slug).toBe("01-app-list");
    const onDisk = await fs.readFile(
      path.join(tmpRoot, "projects", p.slug, "frames", "01-app-list", "index.tsx"),
      "utf-8",
    );
    expect(onDisk).toContain("VistaPage");
    const reloaded = await getProject(p.slug);
    expect(reloaded?.frames.some((f) => f.slug === "01-app-list")).toBe(true);
  });

  it("rejects an unknown template id", async () => {
    const p = await createProject({ name: "X", theme: "arcade", mode: "light" });
    await expect(seedTemplateFrame(p.slug, "bogus")).rejects.toThrow(/Unknown template/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/seedTemplateFrame.test.ts`
Expected: FAIL — `seedTemplateFrame is not a function` / not exported.

- [ ] **Step 3: Implement `seedTemplateFrame` in projects.ts**

Add the import near the top of `studio/server/projects.ts` (after the existing imports, around line 8):

```ts
import { getTemplate, readTemplateSeed, type TemplateId } from "./templates";
```

Add this function (place it after `scaffoldComputerReferenceFrame`, near line 178):

```ts
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
  const source = await readTemplateSeed(def.id as TemplateId);
  const dir = path.join(projectDir(slug), "frames", frameSlug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.tsx"), source, "utf-8");

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/seedTemplateFrame.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the middleware route**

In `studio/server/middleware/projects.ts`, add the import at the top:

```ts
import { createProject, deleteProject, listProjects, renameProject, updateProject, getProject, readHistory, fileTree, readProjectFile, reconcileFrames, seedTemplateFrame } from "../projects";
```

Add this route block inside the `try`, right before the `revealMatch` block (around line 82):

```ts
      const seedMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/seed-template$/);
      if (seedMatch && req.method === "POST") {
        const p = await getProject(seedMatch[1]);
        if (!p) return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
        const body = await readJson(req);
        try {
          const frame = await seedTemplateFrame(seedMatch[1], body.templateId);
          return send(res, 201, frame);
        } catch (err: any) {
          if (/Unknown template/.test(err?.message ?? "")) {
            return send(res, 404, { error: { code: "not_found", message: err.message } });
          }
          throw err;
        }
      }
```

- [ ] **Step 6: Write the middleware route test**

Create `studio/__tests__/server/seedTemplateRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { projectsMiddleware } from "../../server/middleware/projects";
import { createProject } from "../../server/projects";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpl-route-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
});
afterEach(async () => {
  delete process.env.ARCADE_STUDIO_ROOT;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = new PassThrough();
  if (body !== undefined) stream.end(JSON.stringify(body));
  else stream.end();
  return Object.assign(stream, { method, url }) as unknown as IncomingMessage;
}

function mockRes() {
  let status = 0;
  let payload = "";
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(chunk?: string) { if (chunk) payload += chunk; },
  } as unknown as ServerResponse;
  return { res, get status() { return status; }, get body() { return payload ? JSON.parse(payload) : undefined; } };
}

describe("POST /api/projects/:slug/seed-template", () => {
  it("seeds the frame and returns 201", async () => {
    const p = await createProject({ name: "Settings page", theme: "arcade", mode: "light" });
    const mw = projectsMiddleware();
    const out = mockRes();
    await mw(mockReq("POST", `/api/projects/${p.slug}/seed-template`, { templateId: "settings-page" }), out.res);
    expect(out.status).toBe(201);
    expect(out.body.slug).toBe("01-settings-page");
  });

  it("returns 404 for an unknown template id", async () => {
    const p = await createProject({ name: "X", theme: "arcade", mode: "light" });
    const mw = projectsMiddleware();
    const out = mockRes();
    await mw(mockReq("POST", `/api/projects/${p.slug}/seed-template`, { templateId: "bogus" }), out.res);
    expect(out.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run the route test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/seedTemplateRoute.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add studio/server/projects.ts studio/server/middleware/projects.ts studio/__tests__/server/seedTemplateFrame.test.ts studio/__tests__/server/seedTemplateRoute.test.ts
git commit -m "feat(studio/templates): seed a template frame into a project + route"
```

---

### Task 3: Thumbnail render script + thumbnail-serving route

Render each seed `.tsx` to a wide PNG at build time, commit the PNGs, and serve them via `GET /api/templates/:id/thumb`. Also serve the manifest via `GET /api/templates`.

**Files:**
- Create: `studio/scripts/buildTemplateThumbs.ts`
- Create: `studio/server/middleware/templates.ts`
- Modify: `studio/vite.config.ts` (register the middleware)
- Modify: `package.json` (add `studio:templates` script + chain it into `studio:pack`/`studio:release`)
- Modify: `electron-builder.yml` (re-include the thumbnail PNGs)
- Create: `studio/prototype-kit/template-thumbs/{computer,settings-page,app-list}.png` (generated by running the script)
- Test: `studio/__tests__/server/templatesMiddleware.test.ts`

**Interfaces:**
- Consumes: `TEMPLATES`, `getTemplate`, `readTemplateSeed`, `TEMPLATE_SEEDS_DIR`, `TEMPLATE_THUMBS_DIR` from `studio/server/templates.ts` (Task 1); `packFromSource` from `studio/server/sidecar/packFromSource.ts`.
- Produces:
  - `studio/server/middleware/templates.ts` exports `function templatesMiddleware()` — handles `GET /api/templates` (→ array of `{ id, name, description }`) and `GET /api/templates/:id/thumb` (→ `image/png` stream, or `404` if file missing).
  - Committed PNGs at `studio/prototype-kit/template-thumbs/<id>.png`.

- [ ] **Step 1: Write the render script**

Create `studio/scripts/buildTemplateThumbs.ts` (modeled on the assets-panel render loop — `chromium.launch` → `packFromSource` → `setContent` networkidle → full-page screenshot):

```ts
/**
 * Render each homepage-template seed (.tsx) to a wide PNG thumbnail.
 * Pack the seed into self-contained HTML via packFromSource, load it in
 * headless chromium, and screenshot full-page. Committed PNGs mean dev mode
 * and tests never run Playwright. Wired into studio:pack / studio:release.
 *
 * Run: pnpm run studio:templates
 */
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { packFromSource } from "../server/sidecar/packFromSource";
import { TEMPLATES, readTemplateSeed, TEMPLATE_THUMBS_DIR } from "../server/templates";

async function main() {
  await fs.mkdir(TEMPLATE_THUMBS_DIR, { recursive: true });
  const browser = await chromium.launch();
  const failed: string[] = [];
  try {
    for (const t of TEMPLATES) {
      let page;
      try {
        const html = await packFromSource({ tsx: await readTemplateSeed(t.id), theme: "arcade", mode: "light" });
        // Wide page preview (16:9-ish) — show the full layout, not a crop.
        page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(TEMPLATE_THUMBS_DIR, t.thumb) });
        console.log(`  ✓ ${t.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ! ${t.id} failed: ${msg.split("\n")[0]}`);
        failed.push(t.id);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  if (failed.length) {
    console.error(`Failed to render: ${failed.join(", ")}`);
    process.exit(1);
  }
}

void main();
```

- [ ] **Step 2: Add the npm scripts**

In the repo-root `package.json` `scripts`, add:

```json
"studio:templates": "pnpm exec tsx studio/scripts/buildTemplateThumbs.ts",
```

Then prepend `pnpm run studio:templates && ` to the START of both the `studio:pack` and `studio:release` command strings (right before their existing `pnpm run kit:build`).

- [ ] **Step 3: Run the render script to generate the PNGs**

Run: `pnpm run studio:templates`
Expected: prints `✓ computer`, `✓ settings-page`, `✓ app-list`; three files appear under `studio/prototype-kit/template-thumbs/`.

Verify: `ls -la studio/prototype-kit/template-thumbs/` shows three non-empty `.png` files. Open each to confirm it shows the rendered page (not a blank/error frame). If a template renders blank or errors, fix its seed `.tsx` from Task 1 before continuing.

- [ ] **Step 4: Write the failing middleware test**

Create `studio/__tests__/server/templatesMiddleware.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { templatesMiddleware } from "../../server/middleware/templates";

function mockReq(method: string, url: string): IncomingMessage {
  const stream = new PassThrough();
  stream.end();
  return Object.assign(stream, { method, url }) as unknown as IncomingMessage;
}
function mockRes() {
  let status = 0; let headers: Record<string, any> = {}; const chunks: Buffer[] = [];
  const res = {
    writeHead(s: number, h?: Record<string, any>) { status = s; if (h) headers = h; return res; },
    setHeader(k: string, v: any) { headers[k] = v; },
    end(chunk?: any) { if (chunk) chunks.push(Buffer.from(chunk)); },
  } as unknown as ServerResponse;
  return { res, get status() { return status; }, get headers() { return headers; }, get bytes() { return Buffer.concat(chunks); } };
}

describe("templatesMiddleware", () => {
  it("GET /api/templates returns the manifest", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates"), out.res, () => {});
    expect(out.status).toBe(200);
    const list = JSON.parse(out.bytes.toString());
    expect(list.map((t: any) => t.id).sort()).toEqual(["app-list", "computer", "settings-page"]);
  });

  it("GET /api/templates/:id/thumb streams a PNG", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates/computer/thumb"), out.res, () => {});
    expect(out.status).toBe(200);
    expect(String(out.headers["Content-Type"])).toContain("image/png");
    expect(out.bytes.length).toBeGreaterThan(100);
  });

  it("GET /api/templates/:id/thumb returns 404 for an unknown id", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates/bogus/thumb"), out.res, () => {});
    expect(out.status).toBe(404);
  });

  // Freshness guard: every manifest entry must have a committed PNG, so
  // "added a template, forgot to run studio:templates" fails CI, not the user.
  it("serves a committed thumbnail for EVERY template in the manifest", async () => {
    const { TEMPLATES } = await import("../../server/templates");
    for (const t of TEMPLATES) {
      const out = mockRes();
      await templatesMiddleware()(mockReq("GET", `/api/templates/${t.id}/thumb`), out.res, () => {});
      expect(out.status, `${t.id} thumbnail missing — run pnpm run studio:templates`).toBe(200);
      expect(out.bytes.length).toBeGreaterThan(100);
    }
  });

  it("passes through non-template URLs", async () => {
    let nexted = false;
    await templatesMiddleware()(mockReq("GET", "/api/projects"), mockRes().res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/templatesMiddleware.test.ts`
Expected: FAIL — `Cannot find module '../../server/middleware/templates'`.

- [ ] **Step 6: Implement the middleware**

Create `studio/server/middleware/templates.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { TEMPLATES, getTemplate, TEMPLATE_THUMBS_DIR } from "../templates";

export function templatesMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "/").replace(/\?.*$/, "");
    if (!url.startsWith("/api/templates")) return next?.();

    if (req.method === "GET" && url === "/api/templates") {
      const list = TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(list));
    }

    const thumbMatch = url.match(/^\/api\/templates\/([a-z0-9-]+)\/thumb$/);
    if (req.method === "GET" && thumbMatch) {
      const def = getTemplate(thumbMatch[1]);
      if (!def) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "not_found", message: "Unknown template" } }));
      }
      try {
        const png = await fs.readFile(path.join(TEMPLATE_THUMBS_DIR, def.thumb));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
        return res.end(png);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "not_found", message: "Thumbnail not built" } }));
      }
    }

    return next?.();
  };
}
```

- [ ] **Step 7: Register the middleware in vite.config.ts**

In `studio/vite.config.ts`, add the import alongside the others (near line 6):

```ts
import { templatesMiddleware } from "./server/middleware/templates";
```

And register it right after the `projectsMiddleware()` line in `configureServer` (around line 51):

```ts
      server.middlewares.use(templatesMiddleware());
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/templatesMiddleware.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Re-include the PNGs in electron-builder.yml**

In `electron-builder.yml`, immediately AFTER the `- "!**/*.{png,jpg,jpeg,gif}"` line, add (last-match-wins, so it must come after the exclusion):

```yaml
  # Re-include homepage-template thumbnails: the blanket image exclusion above
  # would strip them, leaving testers with blank template tiles. Must come
  # AFTER the exclusion.
  - "studio/prototype-kit/template-thumbs/**/*.png"
```

- [ ] **Step 10: Commit**

```bash
git add studio/scripts/buildTemplateThumbs.ts studio/server/middleware/templates.ts studio/vite.config.ts package.json electron-builder.yml studio/prototype-kit/template-thumbs/computer.png studio/prototype-kit/template-thumbs/settings-page.png studio/prototype-kit/template-thumbs/app-list.png studio/__tests__/server/templatesMiddleware.test.ts
git commit -m "feat(studio/templates): render+serve thumbnails, package them"
```

---

### Task 4: Client API + TemplateCard + TemplatesSection

Add the client API calls and the UI pieces that render template cards and trigger the create→seed→open flow. No homepage wiring yet (Task 5).

**Files:**
- Modify: `studio/src/lib/api.ts` (add `listTemplates`, `seedTemplate`)
- Create: `studio/src/components/home/TemplateCard.tsx`
- Create: `studio/src/components/home/TemplatesSection.tsx`
- Test: `studio/__tests__/components/home/templates-section.test.tsx`

**Interfaces:**
- Consumes: `api` from `studio/src/lib/api.ts`; `Frame` from `studio/server/types`.
- Produces:
  - `api.listTemplates(): Promise<TemplateSummary[]>` where `interface TemplateSummary { id: string; name: string; description: string; }`.
  - `api.seedTemplate(slug: string, templateId: string): Promise<Frame>`.
  - `TemplateCard` props: `{ template: TemplateSummary; onPick: (id: string) => void }`.
  - `TemplatesSection` props: `{ onStart: (templateId: string) => void }` — fetches the manifest itself via `api.listTemplates()` and renders a 3-col grid of `TemplateCard`.

- [ ] **Step 1: Add the API calls**

In `studio/src/lib/api.ts`, add a type near the top (after the import line) and two methods inside the `api` object (after `deleteProject`):

```ts
export interface TemplateSummary { id: string; name: string; description: string; }
```

```ts
  listTemplates: () => fetch("/api/templates").then(j<TemplateSummary[]>),
  seedTemplate: (slug: string, templateId: string) =>
    fetch(`/api/projects/${slug}/seed-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    }).then(j<Frame>),
```

- [ ] **Step 2: Write the TemplateCard component**

Create `studio/src/components/home/TemplateCard.tsx` (wide page-preview thumbnail on top, name + description below; styled to read as a rich card since `ProjectCard` has no thumbnail):

```tsx
import type { TemplateSummary } from "../../lib/api";

export function TemplateCard({
  template,
  onPick,
}: {
  template: TemplateSummary;
  onPick: (id: string) => void;
}) {
  return (
    <article
      onClick={() => onPick(template.id)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      <div style={{ aspectRatio: "16 / 9", background: "var(--bg-neutral-soft)", overflow: "hidden" }}>
        {/* On a missing/unbuilt thumbnail the <img> 404s; hide it so the
            neutral panel background shows through instead of a broken-image icon. */}
        <img
          src={`/api/templates/${template.id}/thumb`}
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", display: "block" }}
        />
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
            fontWeight: 700,
            lineHeight: "16px",
            color: "var(--fg-neutral-prominent)",
          }}
        >
          {template.name}
        </div>
        <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12, marginTop: 4 }}>
          {template.description}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Write the failing TemplatesSection test**

Create `studio/__tests__/components/home/templates-section.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { TemplatesSection } from "../../../src/components/home/TemplatesSection";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/templates") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "computer", name: "Computer", description: "Agent chat screen" },
          { id: "app-list", name: "App list", description: "DevRev list view" },
        ],
      } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

describe("TemplatesSection", () => {
  it("renders a card per template and fires onStart on click", async () => {
    const onStart = vi.fn();
    render(<TemplatesSection onStart={onStart} />);
    await waitFor(() => expect(screen.getByText("Computer")).toBeTruthy());
    expect(screen.getByText("App list")).toBeTruthy();
    fireEvent.click(screen.getByText("Computer"));
    expect(onStart).toHaveBeenCalledWith("computer");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/home/templates-section.test.tsx`
Expected: FAIL — cannot resolve `TemplatesSection`.

- [ ] **Step 5: Write TemplatesSection**

Create `studio/src/components/home/TemplatesSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type TemplateSummary } from "../../lib/api";
import { TemplateCard } from "./TemplateCard";

export function TemplatesSection({ onStart }: { onStart: (templateId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api.listTemplates().then((t) => { if (!cancelled) setTemplates(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (templates.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
      }}
    >
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} onPick={onStart} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/components/home/templates-section.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/api.ts studio/src/components/home/TemplateCard.tsx studio/src/components/home/TemplatesSection.tsx studio/__tests__/components/home/templates-section.test.tsx
git commit -m "feat(studio/home): template cards + section"
```

---

### Task 5: HomeShelf tab switcher + HomePage wiring

Wrap the Projects grid and the Templates section in a tabbed shelf with a smart default tab, and wire the template-pick flow (create project → seed → open) into `HomePage`.

**Files:**
- Create: `studio/src/components/home/HomeShelf.tsx`
- Modify: `studio/src/routes/HomePage.tsx` (use `HomeShelf`, add `handleTemplateStart`)
- Test: `studio/__tests__/components/home/home-shelf.test.tsx`

**Interfaces:**
- Consumes: `ProjectsSection` (existing), `TemplatesSection` (Task 4), `ToggleGroup` from `@xorkavi/arcade-gen` (shape: `ToggleGroup.Root` + `ToggleGroup.Item`); `Project` from `studio/server/types`; `api.createProject` + `api.seedTemplate` (Task 4).
- Produces:
  - `HomeShelf` props: `{ projects: Project[]; onOpen: (slug: string) => void; onRename: (p: Project) => void | Promise<void>; onDelete: (p: Project) => void | Promise<void>; onStartTemplate: (templateId: string) => void }`. Renders a `ToggleGroup` (`My projects` / `Templates`) above the active grid; initial tab = `templates` if `projects.length === 0`, else `projects`.

- [ ] **Step 1: Write the failing HomeShelf test**

Create `studio/__tests__/components/home/home-shelf.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Project } from "../../../server/types";

// Mock arcade-gen: HomeShelf uses ToggleGroup; ProjectsSection (rendered as a
// child) uses IconButton + Menu + ThreeDotsHorizontal. Mock all of them.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const ToggleGroup: any = { Root: ({ children }: any) => React.createElement("div", null, children), Item: ({ children, value, onClick }: any) => React.createElement("button", { onClick, "data-value": value }, children) };
  const Menu: any = ({ children }: any) => React.createElement("div", null, children);
  Menu.Root = ({ children }: any) => React.createElement("div", null, children);
  Menu.Trigger = ({ children }: any) => React.createElement("div", null, children);
  Menu.Content = ({ children }: any) => React.createElement("div", null, children);
  Menu.Item = ({ children, onSelect }: any) => React.createElement("button", { onClick: onSelect }, children);
  return {
    ToggleGroup,
    Menu,
    IconButton: React.forwardRef((p: any, ref: any) => React.createElement("button", { ...p, ref })),
    ThreeDotsHorizontal: () => null,
  };
});

// TemplatesSection fetches the manifest; stub fetch so it renders nothing noisy.
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] } as Response)));

import { HomeShelf } from "../../../src/components/home/HomeShelf";

afterEach(() => cleanup());

const noop = () => {};
const proj: Project = { name: "Demo", slug: "demo", createdAt: "", updatedAt: "", theme: "arcade", mode: "light", frames: [], chimeIns: [] };

describe("HomeShelf smart default tab", () => {
  it("defaults to Templates when there are no projects", () => {
    render(<HomeShelf projects={[]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    // Projects grid is empty AND not the active tab → the project name never appears.
    expect(screen.queryByText("Demo")).toBeNull();
  });

  it("defaults to My projects when at least one project exists", () => {
    render(<HomeShelf projects={[proj]} onOpen={noop} onRename={noop} onDelete={noop} onStartTemplate={noop} />);
    expect(screen.getByText("Demo")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/home/home-shelf.test.tsx`
Expected: FAIL — cannot resolve `HomeShelf`.

- [ ] **Step 3: Write HomeShelf**

Create `studio/src/components/home/HomeShelf.tsx`:

```tsx
import { useState } from "react";
import { ToggleGroup } from "@xorkavi/arcade-gen";
import type { Project } from "../../../server/types";
import { ProjectsSection } from "./ProjectsSection";
import { TemplatesSection } from "./TemplatesSection";

type Tab = "projects" | "templates";

export interface HomeShelfProps {
  projects: Project[];
  onOpen: (slug: string) => void;
  onRename: (p: Project) => void | Promise<void>;
  onDelete: (p: Project) => void | Promise<void>;
  onStartTemplate: (templateId: string) => void;
}

export function HomeShelf({ projects, onOpen, onRename, onDelete, onStartTemplate }: HomeShelfProps) {
  const [tab, setTab] = useState<Tab>(projects.length === 0 ? "templates" : "projects");

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <ToggleGroup.Root type="single" value={tab} onValueChange={(v: string) => { if (v === "projects" || v === "templates") setTab(v); }}>
          <ToggleGroup.Item value="projects" onClick={() => setTab("projects")}>My projects</ToggleGroup.Item>
          <ToggleGroup.Item value="templates" onClick={() => setTab("templates")}>Templates</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      {tab === "projects" ? (
        <ProjectsSection projects={projects} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
      ) : (
        <TemplatesSection onStart={onStartTemplate} />
      )}
    </section>
  );
}
```

Note: `ToggleGroup.Item` carries both `onValueChange` (Radix path) and an explicit `onClick` so the switch works under the test mock and in production. `ProjectsSection` already returns `null` when `projects` is empty, so the "projects" tab with zero projects shows nothing — acceptable, since the smart default lands new users on Templates.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/components/home/home-shelf.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire HomeShelf + the template-start flow into HomePage**

In `studio/src/routes/HomePage.tsx`:

Replace the `ProjectsSection` import with `HomeShelf`:

```tsx
import { HomeShelf } from "../components/home/HomeShelf";
```

(Remove the now-unused `import { ProjectsSection } from "../components/home/ProjectsSection";` line.)

Add a handler after `handleHeroSubmit` (reuses the existing `submitting` guard, `api`, `toast`, `refresh`, `onOpen`):

```tsx
  async function handleTemplateStart(templateId: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const names: Record<string, string> = { computer: "Computer", "settings-page": "Settings page", "app-list": "App list" };
      const base = names[templateId] ?? "Untitled";
      // Dedupe the DISPLAY name against existing projects (createProject only
      // dedupes the slug): "Computer", then "Computer 2", "Computer 3", …
      const taken = new Set(projects.map((p) => p.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      const project = await api.createProject({
        name,
        theme: "arcade",
        mode: "light",
      });
      await api.seedTemplate(project.slug, templateId);
      void refresh();
      onOpen(project.slug);
    } catch (e) {
      toast({
        title: "Failed to start from template",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    } finally {
      setSubmitting(false);
    }
  }
```

Replace the `<ProjectsSection … />` JSX block with:

```tsx
          <HomeShelf
            projects={projects}
            onOpen={onOpen}
            onRename={handleRename}
            onDelete={handleDelete}
            onStartTemplate={handleTemplateStart}
          />
```

- [ ] **Step 6: Run the full suite to catch shell-mock fallout**

Run: `pnpm run studio:test`
Expected: PASS. If any existing `HomePage`/shell test fails because its `@xorkavi/arcade-gen` mock lacks `ToggleGroup`, add a `ToggleGroup` mock (matching the shape in Step 1) to that test's `vi.mock` block, then re-run. Do NOT consider the task done until the full suite is green.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/home/HomeShelf.tsx studio/src/routes/HomePage.tsx studio/__tests__/components/home/home-shelf.test.tsx
git commit -m "feat(studio/home): tabbed shelf with templates + project start flow"
```

---

### Task 6: Packaging guard + manual verification

Add a packaging-config test asserting the thumbnail PNGs survive the bundle, then manually verify the end-to-end flow in the running app.

**Files:**
- Modify: `studio/__tests__/packaging/scaffold.test.ts` (assert the template-thumbs re-include line)

**Interfaces:**
- Consumes: `electron-builder.yml` (Task 3's re-include line).
- Produces: a regression test guarding the image-exclusion trap.

- [ ] **Step 1: Write the packaging guard test**

Add to `studio/__tests__/packaging/scaffold.test.ts` (inside the existing `describe`; this reads the YAML as text and asserts the re-include glob is present AND ordered after the blanket image exclusion):

```ts
  it("re-includes template thumbnails after the blanket image exclusion", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const yml = await fs.readFile(path.resolve(__dirname, "../../../electron-builder.yml"), "utf-8");
    const exclusionIdx = yml.indexOf('"!**/*.{png,jpg,jpeg,gif}"');
    const reincludeIdx = yml.indexOf("studio/prototype-kit/template-thumbs/**/*.png");
    expect(exclusionIdx).toBeGreaterThan(-1);
    expect(reincludeIdx).toBeGreaterThan(-1);
    expect(reincludeIdx).toBeGreaterThan(exclusionIdx); // last-match-wins
  });
```

(If the existing test file uses a different path-resolution helper or `import` style, match it — open the file first and follow its conventions.)

- [ ] **Step 2: Run the packaging test**

Run: `pnpm run studio:test studio/__tests__/packaging/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/packaging/scaffold.test.ts
git commit -m "test(studio/packaging): guard template-thumbnail re-include"
```

- [ ] **Step 4: Manual end-to-end verification in the running app**

Run: `pnpm run studio` (opens the browser on :5556).

Verify the full flow:
1. On the homepage, with no projects, the shelf opens on the **Templates** tab showing three cards with rendered page previews (Computer, Settings page, App list).
2. Switch to **My projects** and back — the tab toggle works.
3. Click the **Computer** card → a new "Computer" project is created and opens, showing the rendered ComputerScene frame in the viewport (no chat turn, instant).
4. Go back to the homepage → the shelf now defaults to **My projects** (≥1 project exists) and "Computer" is listed.
5. Repeat for **App list** and **Settings page**; confirm each opens with its rendered frame.

If any thumbnail tile is blank: confirm `pnpm run studio:templates` produced the PNG and the dev server was restarted (middleware doesn't hot-reload).

- [ ] **Step 5: Final full-suite run before wrap-up**

Run: `pnpm run studio:test`
Expected: PASS (all tests green).

---

## Notes for the implementer

- **Restart the dev server** after Task 3 (new middleware) and Task 5's HomePage edits before manual testing — Vite middleware doesn't hot-reload.
- The hidden `00-computer-reference` seed still runs inside `createProject`; it stays hidden (it's unmodified) while the user's chosen `01-<id>` template frame is visible. Both coexisting is expected.
- This is a **fixes/local-test** workflow by default (auto-memory `feedback-fixes-local-test`): no version bump / CHANGELOG / pack unless the user asks for a release. Tasks 1–6 ship the feature behind `pnpm run studio`; packaging only matters when a DMG is cut.
