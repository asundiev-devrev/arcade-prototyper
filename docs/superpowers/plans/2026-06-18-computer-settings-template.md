# Computer: Settings Multi-Page Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page "Computer: Skills settings" template with a full "Computer: Settings" template — one interactive frame whose 240px sidebar swaps the body between 10 settings pages via React state.

**Architecture:** The seed becomes a *directory* (`computer-settings/`) with a stateful `index.tsx` shell, a `ComputerSettingsSidebar`, a `types.ts` nav config, inline-SVG brand logos, and one file per page under `pages/`. `seedTemplateFrame` and the thumbnail builder gain directory-aware copying. Built in two waves: shell + 4 representative pages first, then the remaining 6.

**Tech Stack:** TypeScript, React 18, `@xorkavi/arcade-gen` (Switch/Table/Tag/Avatar/Select/Input/Button + NavSidebar/SettingsCard/SettingsRow/SkillCard composites), esbuild frame bundler, Playwright (thumbnail), Vitest.

## Global Constraints

- Package manager is **pnpm**; run from repo root. Tests: `pnpm run studio:test <path>` (single file) / `pnpm run studio:test` (full). Thumbnails: `pnpm run studio:templates`.
- **Vite middleware does NOT hot-reload** — restart the dev server after editing `server/middleware/*` or `vite.config.ts`. (Frame `.tsx` files DO hot-reload.)
- Conventional Commits, scope `studio/<area>`. Never `git add -A`/`git add .` — stage explicit paths.
- Templates are seeded `theme: "arcade"`, `mode: "light"`.
- Seed `.tsx` files import shared code from `arcade-prototypes` / `arcade/components` aliases (NOT relative paths) — EXCEPT imports of the seed's own sibling files, which ARE relative (`./ComputerSettingsSidebar`, `./pages/Skills`, `./types`, `./brandLogos`).
- Three templates after this work: ids `computer`, `computer-settings`, `builder-page`. The old `settings-page` id/seed/thumb is removed.
- Manifest entry: `{ id: "computer-settings", name: "Computer: Settings", description: "Full Computer settings", seedFile: "computer-settings", thumb: "computer-settings.png" }`.
- The interactive frame uses `useState`; sidebar click → `setActive(id)` → body `switch`. NO multi-frame, NO FrameLink, NO chart library (CSS bars only), Avatar initials (no photos).
- Component tests MUST mock `@xorkavi/arcade-gen` (gridstack ESM breaks otherwise); the mock must export every primitive the rendered tree uses.
- Sidebar groups + ids + icons (all confirmed present in arcade-gen):
  - (top) `profile` Profile `HumanSilhouette`, `preferences` Preferences `ArrowsLeftAndRight`
  - Customization: `my-computer` My Computer `Computer`, `workflows-tools` Workflows & Tools `ThreeBarsHorizontal`, `skills` Skills `LightingBolt`, `connectors` Connectors `Mcp`
  - Account: `organization` Organization `Buildings`, `users` Users `TwoHumanSilhouettes`, `plans-billing` Plans & Billing `CreditCard`, `usage` Usage `Dashboard`
- Default active page: `my-computer`.
- Branch: `feat/homepage-templates` (continues current work).

## Composite interfaces (confirmed — use verbatim)

```
SettingsCard:  { title?: ReactNode; children: ReactNode }                 // title rendered as its own heading ABOVE the bordered card; children are SettingsRows (auto-separated)
SettingsRow:   { label: ReactNode; description?: ReactNode; action?: ReactNode; control?: ReactNode }
SkillCard:     { icon?: ReactNode; action?: ReactNode; title: ReactNode; description?: ReactNode; status?: ReactNode }
NavSidebar:    <NavSidebar><NavSidebar.Section title="…"><NavSidebar.Item active>…</NavSidebar.Item></NavSidebar.Section></NavSidebar>   // NOTE: used for reference only; this template builds its OWN sidebar
Switch (arcade-gen): { label?: string; size?: "sm"|"md"|"lg" } & Radix Switch props (checked, onCheckedChange)
Table (arcade-gen):  Table.Root / Table.Header / Table.Head / Table.Body / Table.Row / Table.Cell
Tabs (arcade-gen):   Tabs.Root (defaultValue) / Tabs.List / Tabs.Trigger (value)
Tag (arcade-gen):    { intent?: "neutral"|"success"|…; appearance?: "tinted"|… }
Avatar (arcade-gen): { name: string; size?: "sm"|… }   // renders initials when no src
```

All of `SettingsCard`, `SettingsRow`, `SkillCard`, `NavSidebar` are exported from `arcade-prototypes`.

---

### Task 1: Directory-aware seed mechanic + manifest swap

Make the seed system handle a directory seed, swap the manifest from `settings-page` to `computer-settings`, and create a minimal placeholder `computer-settings/` directory so the system is runnable before the real shell is built. This task does NOT build the real pages — just the plumbing + a trivial seed so tests pass.

**Files:**
- Modify: `studio/server/templates.ts`
- Modify: `studio/server/projects.ts` (`seedTemplateFrame`)
- Modify: `studio/server/sidecar/packFromSource.ts` (extract HTML wrapper; add `packFromDir`)
- Modify: `studio/scripts/buildTemplateThumbs.ts` (directory-aware)
- Modify: `studio/src/routes/HomePage.tsx` (name map)
- Create: `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (temporary trivial shell — replaced in Task 2)
- Delete: `studio/prototype-kit/template-seeds/settings-page.tsx`, `studio/prototype-kit/template-thumbs/settings-page.png`
- Modify: `studio/__tests__/server/templates.test.ts`, `studio/__tests__/server/templatesMiddleware.test.ts`, `studio/__tests__/server/seedTemplateFrame.test.ts`, `studio/__tests__/components/home/templates-section.test.tsx`
- Test: `studio/__tests__/server/seedTemplateFrame.test.ts` (add a directory-seed case)

**Interfaces:**
- Consumes: existing `getTemplate`, `TEMPLATE_SEEDS_DIR`, `TEMPLATE_THUMBS_DIR`, `buildFrameBundle`.
- Produces:
  - `templates.ts`: `TemplateId = "computer" | "computer-settings" | "builder-page"`; `TEMPLATES` with the `computer-settings` row replacing `settings-page`; new `function templateSeedPath(id): string` (absolute path to the seed file OR directory under `TEMPLATE_SEEDS_DIR`); `async function isSeedDirectory(id): Promise<boolean>`. `readTemplateSeed` stays (file case only).
  - `packFromSource.ts`: existing `packFromSource` unchanged in signature; new `async function packFromDir(seedDir: string, opts?: { mode?: "light"|"dark"; theme?: "arcade"|"devrev-app" }): Promise<string>` that recursively copies `seedDir` into a temp `frames/01-frame/` and bundles from it. Internal `wrapHtml(theme, mode, bundle)` shared by both.
  - `projects.ts`: `seedTemplateFrame` writes a directory seed by recursively copying the tree into `frames/01-<id>/`, or a file seed as before.

- [ ] **Step 1: Replace the stale `settings-page` test with a directory-seed test + a file-seed test**

The current first test in `studio/__tests__/server/seedTemplateFrame.test.ts` seeds `settings-page` and asserts the on-disk source contains `SettingsPage` — that template is being deleted, so this test must be replaced. Swap it for two tests: one proving directory-seed copy (the new `computer-settings`) and one proving the file-seed path still works (`computer`). Replace the existing `it("writes the template source to frames/01-<id>/index.tsx", …)` block with:

```ts
  it("copies a directory seed (computer-settings) tree into the frame", async () => {
    const p = await createProject({ name: "Computer: Settings", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "computer-settings");
    expect(frame.slug).toBe("01-computer-settings");
    const frameDir = path.join(tmpRoot, "projects", p.slug, "frames", "01-computer-settings");
    const idx = await fs.readFile(path.join(frameDir, "index.tsx"), "utf-8");
    expect(idx).toContain("export default");
    const reloaded = await getProject(p.slug);
    expect(reloaded?.frames.some((f) => f.slug === "01-computer-settings")).toBe(true);
  });

  it("writes a single-file seed (computer) to frames/01-<id>/index.tsx", async () => {
    const p = await createProject({ name: "Computer: Chat", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "computer");
    expect(frame.slug).toBe("01-computer");
    const idx = await fs.readFile(
      path.join(tmpRoot, "projects", p.slug, "frames", "01-computer", "index.tsx"),
      "utf-8",
    );
    expect(idx).toContain("ComputerScene");
  });
```

Keep the existing "rejects an unknown template id" test as-is.

- [ ] **Step 2: Run it — fails (unknown template / no dir copy)**

Run: `pnpm run studio:test studio/__tests__/server/seedTemplateFrame.test.ts`
Expected: FAIL — `Unknown template: computer-settings` (manifest not updated yet).

- [ ] **Step 3: Update the manifest in `templates.ts`**

Replace the `TemplateId` line and the `settings-page` row, and add the path helpers. Final `templates.ts` body (keep the existing imports + DIR consts):

```ts
export type TemplateId = "computer" | "computer-settings" | "builder-page";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  seedFile: string; // basename of a .tsx file OR a directory under TEMPLATE_SEEDS_DIR
  thumb: string;
}

export const TEMPLATES: TemplateDef[] = [
  { id: "computer", name: "Computer: Chat", description: "Agent chat screen", seedFile: "computer.tsx", thumb: "computer.png" },
  { id: "computer-settings", name: "Computer: Settings", description: "Full Computer settings", seedFile: "computer-settings", thumb: "computer-settings.png" },
  { id: "builder-page", name: "Agent Studio: Builder", description: "Agent capability builder", seedFile: "builder-page.tsx", thumb: "builder-page.png" },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templateSeedPath(id: string): string {
  const def = getTemplate(id);
  if (!def) throw new Error(`Unknown template: ${id}`);
  return path.join(TEMPLATE_SEEDS_DIR, def.seedFile);
}

export async function isSeedDirectory(id: string): Promise<boolean> {
  try {
    const st = await fs.stat(templateSeedPath(id));
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function readTemplateSeed(id: TemplateId): Promise<string> {
  const def = getTemplate(id);
  if (!def) return Promise.reject(new Error(`Unknown template: ${id}`));
  return fs.readFile(path.join(TEMPLATE_SEEDS_DIR, def.seedFile), "utf-8");
}
```

(Add `import fs from "node:fs/promises";` if not already present — it is.)

- [ ] **Step 4: Create the temporary trivial seed directory**

Create `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (placeholder — Task 2 replaces it):

```tsx
import * as React from "react";

// Temporary placeholder — replaced by the real shell in Task 2.
export default function ComputerSettingsTemplate() {
  return <div>Computer Settings</div>;
}
```

- [ ] **Step 5: Make `seedTemplateFrame` directory-aware**

In `studio/server/projects.ts`, update the import from `./templates` to include the helpers:

```ts
import { getTemplate, readTemplateSeed, templateSeedPath, isSeedDirectory, type TemplateId } from "./templates";
```

Replace the body of `seedTemplateFrame` (the source-writing part) so it copies a directory tree or writes a file:

```ts
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
```

- [ ] **Step 6: Run the seed tests — pass**

Run: `pnpm run studio:test studio/__tests__/server/seedTemplateFrame.test.ts`
Expected: PASS — the directory-seed test, the file-seed (`computer`) test, and the unknown-id test all green. (The stale `settings-page` test was replaced in Step 1.)

- [ ] **Step 7: Extract `wrapHtml` + add `packFromDir` in `packFromSource.ts`**

Refactor `studio/server/sidecar/packFromSource.ts` so both packers share the HTML wrapper:

```ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildFrameBundle } from "../cloudflare/bundler";

export interface PackInput {
  tsx: string;
  mode?: "light" | "dark";
  theme?: "arcade" | "devrev-app";
}

function wrapHtml(theme: string, mode: string, bundle: { css: string; js: string }): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" class="${mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${bundle.css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${bundle.js}</script>
  </body>
</html>`;
}

export async function packFromSource(input: PackInput): Promise<string> {
  const mode = input.mode ?? "light";
  const theme = input.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.writeFile(path.join(frameDir, "index.tsx"), input.tsx, "utf-8");
  try {
    const bundle = await buildFrameBundle({ projectSlug: "sidecar", frameSlug: "01-frame", framePath: frameDir, theme, mode });
    return wrapHtml(theme, mode, bundle);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// Pack a multi-file frame seed (a directory containing index.tsx + siblings).
export async function packFromDir(seedDir: string, opts?: { mode?: "light" | "dark"; theme?: "arcade" | "devrev-app" }): Promise<string> {
  const mode = opts?.mode ?? "light";
  const theme = opts?.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.cp(seedDir, frameDir, { recursive: true });
  try {
    const bundle = await buildFrameBundle({ projectSlug: "sidecar", frameSlug: "01-frame", framePath: frameDir, theme, mode });
    return wrapHtml(theme, mode, bundle);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 8: Make `buildTemplateThumbs.ts` directory-aware**

Edit the render loop in `studio/scripts/buildTemplateThumbs.ts`:

```ts
import { packFromSource, packFromDir } from "../server/sidecar/packFromSource";
import { TEMPLATES, readTemplateSeed, templateSeedPath, isSeedDirectory, TEMPLATE_THUMBS_DIR } from "../server/templates";
```

Inside the `for (const t of TEMPLATES)` loop, replace the `const html = ...` line with:

```ts
        const html = (await isSeedDirectory(t.id))
          ? await packFromDir(templateSeedPath(t.id), { theme: "arcade", mode: "light" })
          : await packFromSource({ tsx: await readTemplateSeed(t.id), theme: "arcade", mode: "light" });
```

- [ ] **Step 9: Update the manifest/id tests + HomePage name map**

`studio/__tests__/server/templates.test.ts` — fix the id set AND the seed-file existence check (it currently reads `${t.id}.tsx`, which fails for a directory seed):

```ts
  it("exposes exactly the named templates", () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(["builder-page", "computer", "computer-settings"]);
  });

  it("every entry has a name, description, and a seed (file or directory) on disk", async () => {
    const fsmod = await import("node:fs/promises");
    const { templateSeedPath } = await import("../../server/templates");
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      const st = await fsmod.stat(templateSeedPath(t.id));
      if (st.isDirectory()) {
        const idx = await fsmod.readFile(`${templateSeedPath(t.id)}/index.tsx`, "utf-8");
        expect(idx).toContain("export default");
      } else {
        const src = await fsmod.readFile(templateSeedPath(t.id), "utf-8");
        expect(src).toContain("export default");
      }
    }
  });
```

`studio/__tests__/server/templatesMiddleware.test.ts` — id set:

```ts
    expect(list.map((t: any) => t.id).sort()).toEqual(["builder-page", "computer", "computer-settings"]);
```

`studio/src/routes/HomePage.tsx` — name map (replace the `settings-page` entry):

```tsx
      const names: Record<string, string> = { computer: "Computer: Chat", "computer-settings": "Computer: Settings", "builder-page": "Agent Studio: Builder" };
```

`studio/__tests__/components/home/templates-section.test.tsx` — the mock fixture currently lists `settings-page`; update to `computer-settings` / "Computer: Settings" and the matching assertion text.

- [ ] **Step 10: Delete the old single-file settings-page seed + thumb**

```bash
git rm studio/prototype-kit/template-seeds/settings-page.tsx studio/prototype-kit/template-thumbs/settings-page.png
```

- [ ] **Step 11: Render thumbnails (placeholder shell renders "Computer Settings")**

Run: `pnpm run studio:templates`
Expected: `✓ computer`, `✓ computer-settings`, `✓ builder-page`; `studio/prototype-kit/template-thumbs/computer-settings.png` now exists (a trivial "Computer Settings" text render — fine for now, re-rendered in Task 4).

- [ ] **Step 12: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS. Fix any test still referencing `settings-page` (search: `grep -rn "settings-page" studio/__tests__`).

- [ ] **Step 13: Commit**

```bash
git add studio/server/templates.ts studio/server/projects.ts studio/server/sidecar/packFromSource.ts studio/scripts/buildTemplateThumbs.ts studio/src/routes/HomePage.tsx studio/prototype-kit/template-seeds/computer-settings/index.tsx studio/prototype-kit/template-thumbs/computer-settings.png studio/__tests__/server/templates.test.ts studio/__tests__/server/templatesMiddleware.test.ts studio/__tests__/server/seedTemplateFrame.test.ts studio/__tests__/components/home/templates-section.test.tsx
git rm studio/prototype-kit/template-seeds/settings-page.tsx studio/prototype-kit/template-thumbs/settings-page.png
git commit -m "feat(studio/templates): directory-seed mechanic + Computer: Settings manifest entry"
```

---

### Task 2: Shell + sidebar + nav config (Wave 1 chrome)

Replace the placeholder `index.tsx` with the real stateful shell, build the 240px `ComputerSettingsSidebar`, and the `types.ts` nav config. Pages are stubbed (a single shared placeholder body) so nav switching is testable before the real pages land.

**Files:**
- Create: `studio/prototype-kit/template-seeds/computer-settings/types.ts`
- Create: `studio/prototype-kit/template-seeds/computer-settings/ComputerSettingsSidebar.tsx`
- Modify: `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (real shell)
- Test: `studio/__tests__/components/home/computer-settings-shell.test.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: `export type PageId = "profile" | "preferences" | "my-computer" | "workflows-tools" | "skills" | "connectors" | "organization" | "users" | "plans-billing" | "usage";` and `export const NAV_GROUPS: Array<{ title?: string; items: Array<{ id: PageId; label: string; icon: ... }> }>`.
  - `ComputerSettingsSidebar.tsx`: `export function ComputerSettingsSidebar({ active, onSelect }: { active: PageId; onSelect: (id: PageId) => void })`.
  - `index.tsx`: default export `ComputerSettingsTemplate` — holds `useState<PageId>("my-computer")`, renders sidebar + a body `switch`.

- [ ] **Step 1: Write the nav config (`types.ts`)**

```tsx
import * as React from "react";
import { HumanSilhouette, ArrowsLeftAndRight, Computer, ThreeBarsHorizontal, LightingBolt, Mcp, Buildings, TwoHumanSilhouettes, CreditCard, Dashboard } from "arcade/components";

export type PageId =
  | "profile" | "preferences"
  | "my-computer" | "workflows-tools" | "skills" | "connectors"
  | "organization" | "users" | "plans-billing" | "usage";

export interface NavItem { id: PageId; label: string; icon: React.ReactNode; }
export interface NavGroup { title?: string; items: NavItem[]; }

export const NAV_GROUPS: NavGroup[] = [
  { items: [
    { id: "profile", label: "Profile", icon: <HumanSilhouette size={16} /> },
    { id: "preferences", label: "Preferences", icon: <ArrowsLeftAndRight size={16} /> },
  ]},
  { title: "Customization", items: [
    { id: "my-computer", label: "My Computer", icon: <Computer size={16} /> },
    { id: "workflows-tools", label: "Workflows & Tools", icon: <ThreeBarsHorizontal size={16} /> },
    { id: "skills", label: "Skills", icon: <LightingBolt size={16} /> },
    { id: "connectors", label: "Connectors", icon: <Mcp size={16} /> },
  ]},
  { title: "Account", items: [
    { id: "organization", label: "Organization", icon: <Buildings size={16} /> },
    { id: "users", label: "Users", icon: <TwoHumanSilhouettes size={16} /> },
    { id: "plans-billing", label: "Plans & Billing", icon: <CreditCard size={16} /> },
    { id: "usage", label: "Usage", icon: <Dashboard size={16} /> },
  ]},
];

export const PAGE_TITLES: Record<PageId, { title: string; subtitle: string }> = {
  "profile": { title: "Profile", subtitle: "Manage your personal information and account." },
  "preferences": { title: "Preferences", subtitle: "Tune appearance, language, and notifications." },
  "my-computer": { title: "My Computer", subtitle: "Personalise Computer to your own work style and control how it behaves." },
  "workflows-tools": { title: "Workflows & Tools", subtitle: "Browse and manage the tools your agent can use." },
  "skills": { title: "Skills", subtitle: "Discover and add capabilities for your agent." },
  "connectors": { title: "Connectors", subtitle: "Connect Computer to apps, tools, MCP, storage, and more." },
  "organization": { title: "Organization", subtitle: "Manage your organization's profile and settings." },
  "users": { title: "Users", subtitle: "Invite, remove, and manage users and their access roles." },
  "plans-billing": { title: "Plans and Billing", subtitle: "Manage payment methods, balances and billing preferences." },
  "usage": { title: "Usage", subtitle: "Track how your organization is using Computer." },
};
```

- [ ] **Step 2: Write `ComputerSettingsSidebar.tsx`**

240px column: window chrome row (traffic lights + collapse icon), a "‹ Settings" back row, then the groups. Active row highlighted.

```tsx
import * as React from "react";
import { ChevronLeftSmall, Sidebar } from "arcade/components";
import { NAV_GROUPS, type PageId } from "./types";

export function ComputerSettingsSidebar({ active, onSelect }: { active: PageId; onSelect: (id: PageId) => void }) {
  return (
    <div
      className="flex h-full w-60 shrink-0 flex-col border-r"
      style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--surface-shallow)" }}
    >
      {/* window chrome */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
      </div>
      {/* back row */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-3" style={{ color: "var(--fg-neutral-prominent)" }}>
        <ChevronLeftSmall size={16} />
        <span className="text-system-medium">Settings</span>
      </div>
      {/* groups */}
      <nav className="flex flex-col gap-4 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `g${gi}`} className="flex flex-col gap-0.5">
            {group.title && (
              <div className="px-2 pb-1 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{group.title}</div>
            )}
            {group.items.map((item) => {
              const on = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex items-center gap-2 rounded-square px-2 py-1.5 text-left text-system-medium"
                  style={{
                    background: on ? "var(--control-bg-neutral-subtle-hover)" : "transparent",
                    color: on ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-medium)",
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center" style={{ color: "var(--fg-neutral-medium)" }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
```

(If `Sidebar` import is unused, remove it. `ChevronLeftSmall` is a confirmed arcade-gen icon.)

- [ ] **Step 3: Write the real shell `index.tsx` (pages stubbed)**

```tsx
import * as React from "react";
import { ComputerSettingsSidebar } from "./ComputerSettingsSidebar";
import { PAGE_TITLES, type PageId } from "./types";

function PagePlaceholder({ id }: { id: PageId }) {
  return <div className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{id} — coming soon</div>;
}

function renderPage(id: PageId): React.ReactNode {
  switch (id) {
    default:
      return <PagePlaceholder id={id} />;
  }
}

export default function ComputerSettingsTemplate() {
  const [active, setActive] = React.useState<PageId>("my-computer");
  const meta = PAGE_TITLES[active] ?? PAGE_TITLES["my-computer"];
  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--surface-default)" }}>
      <ComputerSettingsSidebar active={active} onSelect={setActive} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-12 shrink-0 items-center px-9 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
          Settings <span className="px-1.5">›</span>
          <span style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</span>
        </div>
        <div className="mx-auto w-full max-w-[760px] px-9 py-6">
          <h1 className="text-title-1" style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</h1>
          <p className="mt-2 text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{meta.subtitle}</p>
          <div className="mt-8">{renderPage(active)}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the failing shell nav test**

Create `studio/__tests__/components/home/computer-settings-shell.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The seed imports from "arcade/components" (alias) — mock it.
vi.mock("arcade/components", async () => {
  const React = await import("react");
  const icon = () => null;
  return new Proxy({}, { get: (_t, key) => {
    if (key === "__esModule") return true;
    // every named import resolves to a no-op passthrough/icon
    return icon;
  }});
});

import ComputerSettingsTemplate from "../../../prototype-kit/template-seeds/computer-settings/index";

afterEach(() => cleanup());

describe("Computer: Settings shell", () => {
  it("defaults to My Computer and switches page on nav click", () => {
    render(<ComputerSettingsTemplate />);
    // default title visible
    expect(screen.getAllByText("My Computer").length).toBeGreaterThan(0);
    // click the Skills nav item → Skills becomes the page title
    fireEvent.click(screen.getByText("Skills"));
    expect(screen.getAllByText("Skills").length).toBeGreaterThan(0);
    // breadcrumb/title now shows Skills subtitle
    expect(screen.getByText(/Discover and add capabilities/i)).toBeTruthy();
  });
});
```

NOTE for the implementer: if mocking `arcade/components` via Proxy doesn't resolve under the test runner's alias config, fall back to an explicit `vi.mock("arcade/components", () => ({ HumanSilhouette: () => null, ArrowsLeftAndRight: () => null, Computer: () => null, ThreeBarsHorizontal: () => null, LightingBolt: () => null, Mcp: () => null, Buildings: () => null, TwoHumanSilhouettes: () => null, CreditCard: () => null, Dashboard: () => null, ChevronLeftSmall: () => null, Sidebar: () => null }))`. Verify the `arcade/components` alias resolves in `studio/vitest.config.ts`; if the seed dir isn't covered by the test tsconfig/alias, import the component via its relative path (already relative here) and ensure the alias mock applies.

- [ ] **Step 5: Run it — fails, then passes after the shell exists**

Run: `pnpm run studio:test studio/__tests__/components/home/computer-settings-shell.test.tsx`
Expected: PASS once `index.tsx` + `types.ts` + sidebar are in place. If the `arcade/components` mock can't be wired, switch to the explicit-mock fallback in Step 4 and re-run.

- [ ] **Step 6: Render the thumbnail to confirm the shell compiles + renders**

Run: `pnpm run studio:templates`
Expected: `✓ computer-settings`. Open `studio/prototype-kit/template-thumbs/computer-settings.png` and confirm you see the sidebar + "My Computer" header (body is a placeholder for now — that's expected until Task 3).

- [ ] **Step 7: Commit**

```bash
git add studio/prototype-kit/template-seeds/computer-settings/types.ts studio/prototype-kit/template-seeds/computer-settings/ComputerSettingsSidebar.tsx studio/prototype-kit/template-seeds/computer-settings/index.tsx studio/__tests__/components/home/computer-settings-shell.test.tsx studio/prototype-kit/template-thumbs/computer-settings.png
git commit -m "feat(studio/templates): Computer: Settings shell + sidebar + nav"
```

---

### Task 3: Wave-1 pages (My Computer, Skills, Connectors, Users)

Build four pages covering the four most distinct archetypes, wire them into the shell's `switch`, and add inline-SVG brand logos for Connectors.

**Files:**
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/MyComputer.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Skills.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Connectors.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Users.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/brandLogos.tsx`
- Modify: `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (wire the 4 pages into `renderPage`)

**Interfaces:**
- Consumes: `PageId` from `./types`.
- Produces: four default-exported page components `MyComputer`, `Skills`, `Connectors`, `Users` (each `() => ReactNode`, no props — the shell renders the title/subtitle/breadcrumb); `brandLogos.tsx` exports `BRAND_LOGOS: Record<string, React.ReactNode>` (inline `<svg>` per connector) + a `BrandTile` fallback.

- [ ] **Step 1: Write `MyComputer.tsx` (settings-form + sub-tabs)**

```tsx
import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Tabs, Switch, Button, PlusSmall } from "arcade/components";

export default function MyComputer() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="general">
          <Tabs.List>
            <Tabs.Trigger value="general">General</Tabs.Trigger>
            <Tabs.Trigger value="desktop">Desktop app</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <SettingsCard title="General settings">
        <SettingsRow label="Run on start up" description="Automatically start Computer on start up" control={<Switch defaultChecked />} />
        <SettingsRow label="File Directory" description="Where Computer saves your files and skills."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>/Users/Shashank.Sin…</Button>} />
        <SettingsRow label="Quick access short cut" description="Bring Computer to your attention quickly"
          action={<span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Manage</span>} control={<Switch defaultChecked />} />
        <SettingsRow label="Menu bar" description="Show Computer in the menu bar" control={<Switch defaultChecked />} />
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Write `Skills.tsx` (card-grid — lift from the old settings-page seed)**

```tsx
import * as React from "react";
import { SkillCard } from "arcade-prototypes";
import { Tabs, Tag, Link, LightingBolt, HumanSilhouette, ChevronRightSmall } from "arcade/components";

const skills = [
  { title: "Prospect Research", description: "Pulls a company brief before any outreach so you walk in knowing more than they expect." },
  { title: "Cold Email Writer", description: "Turns a name and a URL into a sharp, personalised first message worth replying to." },
  { title: "Meeting Recap", description: "Summarises a call into decisions, owners, and next steps the moment it ends." },
];

export default function Skills() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="discover">
          <Tabs.List>
            <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
            <Tabs.Trigger value="mine">My skills</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="flex items-center gap-4 rounded-square-x2 border px-5 py-4"
        style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)" }}>
        <HumanSilhouette size={20} color="var(--fg-neutral-subtle)" />
        <span>Not sure what capabilities are? <Link mode="inline" href="#">Find out more</Link></span>
        <ChevronRightSmall size={16} color="var(--fg-neutral-subtle)" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((s) => (
          <SkillCard
            key={s.title}
            icon={<LightingBolt size={20} color="#2563eb" />}
            title={s.title}
            description={s.description}
            status={<Tag intent="neutral" appearance="tinted">DevRev</Tag>}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `brandLogos.tsx` (inline SVGs + fallback tile)**

Provide inline `<svg>` for the connectors shown in the Figma. Each is a small simplified mark (16–20px). Keep them minimal but recognizable by color. Example shape — author the full set listed:

```tsx
import * as React from "react";

// Minimal inline-SVG brand marks for the Connectors page. Simplified, single-
// path-ish glyphs tinted to each brand — recognizable without shipping real logo assets.
export const BRAND_LOGOS: Record<string, React.ReactNode> = {
  Gmail: <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M2 5l10 7L22 5v14H2z" opacity="0.9"/></svg>,
  "Outlook Email": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" fill="#0078D4"/></svg>,
  Salesforce: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#00A1E0"/></svg>,
  HubSpot: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#FF7A59"/></svg>,
  "Google Calendar": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" fill="#4285F4"/></svg>,
  "Outlook Calendar": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" fill="#0078D4"/></svg>,
  Gong: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#8A3FFC"/></svg>,
  Zoom: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="#2D8CFF"/></svg>,
  "Google Drive": <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#00AC47" d="M8 3h8l6 11H14z"/><path fill="#FFBA00" d="M2 14L8 3l6 11z"/></svg>,
  "Confluence Cloud": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="#1868DB"/></svg>,
  Notion: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" fill="#111"/></svg>,
  OneDrive: <svg width="20" height="20" viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9" ry="5" fill="#0364B8"/></svg>,
  Slack: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="4" fill="#4A154B"/></svg>,
  "Microsoft Teams": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#6264A7"/></svg>,
  SharePoint: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#038387"/></svg>,
  Jira: <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#2684FF" d="M12 2l9 9-9 9-9-9z"/></svg>,
};

export function BrandTile({ name }: { name: string }) {
  const logo = BRAND_LOGOS[name];
  if (logo) return <>{logo}</>;
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-square text-body-small"
      style={{ background: "var(--bg-neutral-soft)", color: "var(--fg-neutral-medium)" }}>
      {name.charAt(0)}
    </span>
  );
}
```

- [ ] **Step 4: Write `Connectors.tsx` (connector-grid)**

```tsx
import * as React from "react";
import { Button, Tag } from "arcade/components";
import { BrandTile } from "../brandLogos";

const connectors: Array<{ name: string; connected?: boolean }> = [
  { name: "Gmail", connected: true }, { name: "Outlook Email", connected: true },
  { name: "Salesforce" }, { name: "HubSpot" },
  { name: "Google Calendar" }, { name: "Outlook Calendar" },
  { name: "Gong" }, { name: "Zoom", connected: true },
  { name: "Google Drive", connected: true }, { name: "Confluence Cloud" },
  { name: "Notion", connected: true }, { name: "OneDrive", connected: true },
  { name: "Slack", connected: true }, { name: "Microsoft Teams", connected: true },
  { name: "SharePoint", connected: true }, { name: "Jira" },
];

export default function Connectors() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm">Add custom connector</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {connectors.map((c) => (
          <div key={c.name} className="flex items-center justify-between rounded-square-x2 border px-4 py-3"
            style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
            <span className="flex items-center gap-3">
              <BrandTile name={c.name} />
              <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{c.name}</span>
            </span>
            {c.connected && <Tag intent="success" appearance="tinted">Connected</Tag>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `Users.tsx` (table)**

```tsx
import * as React from "react";
import { Button, Avatar, Tag, IconButton, ThreeDotsHorizontal, Tabs } from "arcade/components";

const users = [
  { name: "Michael Machado", email: "michael@maple.ai", role: "Admin" },
  { name: "Anmol Agarwal", email: "anmol@maple.ai", role: "Member" },
  { name: "Tim Diacon", email: "tim@maple.ai", role: "Member" },
  { name: "Shubham Gandhi", email: "shubham@maple.ai", role: "Member" },
  { name: "Priya Nair", email: "priya@maple.ai", role: "Member" },
  { name: "Diego Alvarez", email: "diego@maple.ai", role: "Member" },
];

export default function Users() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Tabs.Root defaultValue="users">
          <Tabs.List>
            <Tabs.Trigger value="users">Users 234</Tabs.Trigger>
            <Tabs.Trigger value="invitations">Invitations 4</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
        <Button variant="primary" size="sm">Invite users</Button>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-2 pb-2 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
          <span>Name</span><span>Role</span>
        </div>
        {users.map((u) => (
          <div key={u.email} className="flex items-center justify-between border-t py-3" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
            <span className="flex items-center gap-3">
              <Avatar name={u.name} size="sm" />
              <span className="flex flex-col">
                <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{u.name}</span>
                <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{u.email}</span>
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-body-small" style={{ color: "var(--fg-neutral-medium)" }}>{u.role}</span>
              <IconButton variant="tertiary" size="sm" aria-label="More"><ThreeDotsHorizontal size={16} /></IconButton>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire the 4 pages into the shell `renderPage`**

In `index.tsx`, add the imports and switch cases:

```tsx
import MyComputer from "./pages/MyComputer";
import Skills from "./pages/Skills";
import Connectors from "./pages/Connectors";
import Users from "./pages/Users";
```

```tsx
function renderPage(id: PageId): React.ReactNode {
  switch (id) {
    case "my-computer": return <MyComputer />;
    case "skills": return <Skills />;
    case "connectors": return <Connectors />;
    case "users": return <Users />;
    default: return <PagePlaceholder id={id} />;
  }
}
```

- [ ] **Step 7: Extend the shell nav test to cover a real page body**

Add a test to `studio/__tests__/components/home/computer-settings-shell.test.tsx` asserting a real page renders (My Computer shows "General settings"):

```tsx
  it("renders the My Computer settings body by default", () => {
    render(<ComputerSettingsTemplate />);
    expect(screen.getByText(/General settings/i)).toBeTruthy();
  });
```

(The `arcade-prototypes` composites the pages import — SettingsCard/SettingsRow/SkillCard — also need mocking in this test file. Add a `vi.mock("arcade-prototypes", () => ({ SettingsCard: ({title,children}) => <div>{title}{children}</div>, SettingsRow: ({label,description}) => <div>{label}{description}</div>, SkillCard: ({title}) => <div>{title}</div> }))` alongside the `arcade/components` mock.)

- [ ] **Step 8: Run the shell test**

Run: `pnpm run studio:test studio/__tests__/components/home/computer-settings-shell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Render the thumbnail + verify the 4 pages compile**

Run: `pnpm run studio:templates`
Expected: `✓ computer-settings`. Open the PNG — confirm sidebar + My Computer "General settings" card render. If the bundle errors (a page won't compile), the script exits non-zero — fix the offending page before continuing.

- [ ] **Step 10: Commit**

```bash
git add studio/prototype-kit/template-seeds/computer-settings/pages/MyComputer.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Skills.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Connectors.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Users.tsx studio/prototype-kit/template-seeds/computer-settings/brandLogos.tsx studio/prototype-kit/template-seeds/computer-settings/index.tsx studio/__tests__/components/home/computer-settings-shell.test.tsx studio/prototype-kit/template-thumbs/computer-settings.png
git commit -m "feat(studio/templates): Computer: Settings wave-1 pages (My Computer, Skills, Connectors, Users)"
```

---

### Task 4: Wave-1 live verification

End-to-end check of the shell + 4 pages in the running app, and confirm the homepage card. No new code unless verification surfaces a bug.

**Files:** none (verification task). If a bug is found, fix in the relevant seed file + re-run Task 3's test + thumbnail, and note the fix in the commit.

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS (all green).

- [ ] **Step 2: Launch the app and verify the flow**

Run: `pnpm run studio` (restart if already running — middleware changed in Task 1).

Verify:
1. Homepage → Templates tab shows **Computer: Settings** card (renamed from "Computer: Skills settings") with a rendered thumbnail (sidebar + My Computer).
2. Click it → a "Computer: Settings" project is created and opens; the frame shows the sidebar + My Computer page (General settings card with toggles).
3. In the frame, click **Skills** in the sidebar → body swaps to the Skills cards; click **Connectors** → 2-col brand-tile grid with Connected tags; click **Users** → the user table. The active sidebar row highlights.
4. Clicking a not-yet-built page (e.g. Profile) shows the "coming soon" placeholder — expected until Wave 2.

If any page renders broken, fix the seed file, re-run `pnpm run studio:templates`, re-verify.

- [ ] **Step 3: Clean up the test project**

Delete the project created during verification (it lands in the real workspace):

```bash
rm -rf "$HOME/Library/Application Support/arcade-studio/projects/computer-settings"
```

(Confirm the slug first with `ls "$HOME/Library/Application Support/arcade-studio/projects/" | grep computer-settings`.)

- [ ] **Step 4: No commit unless a fix was made**

If verification surfaced and you fixed a bug, commit it:

```bash
git add <fixed files>
git commit -m "fix(studio/templates): <what the verification caught>"
```

---

### Task 5: Wave-2 pages part A (Profile, Preferences, Organization)

Three settings-form pages. Same archetype as My Computer.

**Files:**
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Profile.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Preferences.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Organization.tsx`
- Modify: `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (wire 3 cases)

**Interfaces:**
- Consumes: `SettingsCard`, `SettingsRow` from `arcade-prototypes`; `Input`, `Select`, `Switch`, `Button`, `Avatar` from `arcade/components`.
- Produces: default-exported `Profile`, `Preferences`, `Organization` components.

- [ ] **Step 1: Write `Profile.tsx`**

```tsx
import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Avatar, Button } from "arcade/components";

export default function Profile() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Personal information">
        <SettingsRow label="Photo" control={<Avatar name="Ben Carter" size="md" />} action={<Button variant="tertiary" size="sm">Change</Button>} />
        <SettingsRow label="Name" control={<Input defaultValue="Ben Carter" onChange={() => {}} />} />
        <SettingsRow label="Email" control={<Input defaultValue="ben@maple.ai" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Danger zone">
        <SettingsRow label="Delete account" description="Permanently remove your account and all data."
          action={<Button variant="tertiary" size="sm">Delete account</Button>} />
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Write `Preferences.tsx`**

```tsx
import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Select, Switch } from "arcade/components";

export default function Preferences() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Appearance">
        <SettingsRow label="Theme" description="Choose how Computer looks." control={<Select value="System" onChange={() => {}} />} />
        <SettingsRow label="Language" control={<Select value="English (US)" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Notifications">
        <SettingsRow label="Email notifications" description="Get notified about activity by email." control={<Switch defaultChecked />} />
        <SettingsRow label="Desktop notifications" control={<Switch />} />
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 3: Write `Organization.tsx`**

```tsx
import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Avatar, Button } from "arcade/components";

export default function Organization() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Organization profile">
        <SettingsRow label="Logo" control={<Avatar name="Maple AI" size="md" />} action={<Button variant="tertiary" size="sm">Change</Button>} />
        <SettingsRow label="Organization name" control={<Input defaultValue="Maple AI" onChange={() => {}} />} />
        <SettingsRow label="Domain" control={<Input defaultValue="maple.ai" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Danger zone">
        <SettingsRow label="Delete organization" description="Remove this organization and all of its data."
          action={<Button variant="tertiary" size="sm">Delete organization</Button>} />
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 4: Wire the 3 cases into `index.tsx`**

Add imports + switch cases:

```tsx
import Profile from "./pages/Profile";
import Preferences from "./pages/Preferences";
import Organization from "./pages/Organization";
```

```tsx
    case "profile": return <Profile />;
    case "preferences": return <Preferences />;
    case "organization": return <Organization />;
```

- [ ] **Step 5: Render the thumbnail to confirm the 3 pages compile**

Run: `pnpm run studio:templates`
Expected: `✓ computer-settings` (script bundles the whole tree; a broken page fails the build).

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/template-seeds/computer-settings/pages/Profile.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Preferences.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Organization.tsx studio/prototype-kit/template-seeds/computer-settings/index.tsx
git commit -m "feat(studio/templates): Computer: Settings settings-form pages (Profile, Preferences, Organization)"
```

---

### Task 6: Wave-2 pages part B (Workflows & Tools, Plans & Billing, Usage)

The last three pages: a card-grid, a settings-form + KPI tiles, and a metrics page with CSS bars.

**Files:**
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/WorkflowsTools.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/PlansBilling.tsx`
- Create: `studio/prototype-kit/template-seeds/computer-settings/pages/Usage.tsx`
- Modify: `studio/prototype-kit/template-seeds/computer-settings/index.tsx` (wire 3 cases)

**Interfaces:**
- Consumes: `SkillCard`, `SettingsCard`, `SettingsRow` from `arcade-prototypes`; `Button`, `Tag`, `Tabs`, `LightingBolt`, `PlusSmall` from `arcade/components`.
- Produces: default-exported `WorkflowsTools`, `PlansBilling`, `Usage` components. After this task `renderPage` has no remaining `PagePlaceholder` cases (all 10 ids resolve to a real page).

- [ ] **Step 1: Write `WorkflowsTools.tsx` (card-grid)**

```tsx
import * as React from "react";
import { SkillCard } from "arcade-prototypes";
import { Tag, ThreeBarsHorizontal } from "arcade/components";

const tools = [
  { title: "Web Search", description: "Look up current information across the web." },
  { title: "Code Runner", description: "Execute snippets and return results inline." },
  { title: "Ticket Triage", description: "Auto-route and label incoming tickets." },
  { title: "Calendar", description: "Read availability and schedule meetings." },
];

export default function WorkflowsTools() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => (
        <SkillCard key={t.title} icon={<ThreeBarsHorizontal size={20} color="#2563eb" />} title={t.title} description={t.description} status={<Tag intent="neutral" appearance="tinted">Tool</Tag>} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `PlansBilling.tsx` (settings-form + KPI tiles w/ progress bar)**

```tsx
import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Button, Tabs, PlusSmall } from "arcade/components";

function MetricTile({ label, value, action, bar }: { label: string; value: string; action?: React.ReactNode; bar?: number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-square-x2 border p-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      <div className="flex items-center justify-between">
        <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{label}</span>
        {action}
      </div>
      <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
      {bar != null && (
        <div className="h-1.5 w-full rounded-full" style={{ background: "var(--bg-neutral-soft)" }}>
          <div className="h-1.5 rounded-full" style={{ width: `${bar}%`, background: "var(--fg-accent-prominent, #7c3aed)" }} />
        </div>
      )}
    </div>
  );
}

export default function PlansBilling() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="billing">
          <Tabs.List>
            <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
            <Tabs.Trigger value="usage">Usage</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Computer Pro Plan</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Trial ends April 15 · When your trial ends you'll be downgraded to Mini</span>
        </div>
        <Button variant="tertiary" size="sm">View plans</Button>
      </div>
      <div className="flex gap-4">
        <MetricTile label="Days remaining" value="3 days left" action={<Button variant="primary" size="sm">Upgrade</Button>} />
        <MetricTile label="Trial credits" value="3,200 / 4,000" bar={80} />
        <MetricTile label="Active users" value="12 users" action={<Button variant="tertiary" size="sm">Invite</Button>} />
      </div>
      <SettingsCard title="Billing details">
        <SettingsRow label="Payment details" description="Reminders, notifications and emails are delivered based on your time zone."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add payment method</Button>} />
        <SettingsRow label="Billing information" description="Review or update your organization's billing information."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add billing address</Button>} />
        <SettingsRow label="Billing admins" description="Add and remove people who can manage your Computer account."
          action={<span className="text-body-small" style={{ color: "var(--fg-neutral-medium)" }}>Manage admins</span>} />
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 3: Write `Usage.tsx` (metrics + CSS bars)**

```tsx
import * as React from "react";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-square-x2 border p-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{label}</span>
      <span className="text-title-2" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
    </div>
  );
}

const usageByDay = [
  { day: "Mon", pct: 40 }, { day: "Tue", pct: 65 }, { day: "Wed", pct: 52 },
  { day: "Thu", pct: 80 }, { day: "Fri", pct: 70 }, { day: "Sat", pct: 24 }, { day: "Sun", pct: 18 },
];

export default function Usage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <Kpi label="Messages this month" value="48,210" />
        <Kpi label="Active users" value="12" />
        <Kpi label="Credits used" value="3,200 / 4,000" />
      </div>
      <div className="rounded-square-x2 border p-5" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
        <div className="mb-4 text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Usage this week</div>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {usageByDay.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
              <div className="w-full rounded-square" style={{ height: `${d.pct}%`, background: "var(--fg-accent-prominent, #7c3aed)" }} />
              <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the final 3 cases into `index.tsx` + drop the placeholder**

Add imports + cases so all 10 ids resolve; `PagePlaceholder` can stay as the `default` (defensive) but no id should hit it:

```tsx
import WorkflowsTools from "./pages/WorkflowsTools";
import PlansBilling from "./pages/PlansBilling";
import Usage from "./pages/Usage";
```

```tsx
    case "workflows-tools": return <WorkflowsTools />;
    case "plans-billing": return <PlansBilling />;
    case "usage": return <Usage />;
```

- [ ] **Step 5: Render the thumbnail to confirm all pages compile**

Run: `pnpm run studio:templates`
Expected: `✓ computer-settings`.

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/template-seeds/computer-settings/pages/WorkflowsTools.tsx studio/prototype-kit/template-seeds/computer-settings/pages/PlansBilling.tsx studio/prototype-kit/template-seeds/computer-settings/pages/Usage.tsx studio/prototype-kit/template-seeds/computer-settings/index.tsx
git commit -m "feat(studio/templates): Computer: Settings remaining pages (Workflows & Tools, Plans & Billing, Usage)"
```

---

### Task 7: Final verification (all 10 pages)

Full end-to-end check of every page + the whole suite.

**Files:** none (verification). Fixes go to the relevant seed file.

- [ ] **Step 1: Full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 2: Launch + click through all 10 pages**

Run: `pnpm run studio` (restart).

Create a project from the **Computer: Settings** card, then click every sidebar item and confirm each renders a real, on-brand body (no "coming soon" placeholder remains): Profile, Preferences, My Computer, Workflows & Tools, Skills, Connectors, Organization, Users, Plans & Billing, Usage. Confirm the active row highlights and the breadcrumb/title update per page.

Fix any broken page in its seed file, re-run `pnpm run studio:templates`, re-verify.

- [ ] **Step 3: Clean up the test project**

```bash
rm -rf "$HOME/Library/Application Support/arcade-studio/projects/computer-settings"*
```

- [ ] **Step 4: Commit any verification fixes**

If fixes were made:

```bash
git add <files>
git commit -m "fix(studio/templates): <verification fixes for Computer: Settings>"
```

---

## Notes for the implementer

- **Restart the dev server** after Task 1 (middleware/server changes). Frame `.tsx` edits hot-reload, but `server/*` and `vite.config.ts` do not.
- The thumbnail script (`pnpm run studio:templates`) is your fast compile check for the seed tree — it bundles the whole `computer-settings/` directory via esbuild and exits non-zero if any page fails to compile. Run it after every page-adding task.
- Seed sibling imports are **relative** (`./pages/Skills`, `./types`, `../brandLogos`); shared kit imports are **aliased** (`arcade-prototypes`, `arcade/components`). Don't mix them up.
- This is a **fixes/local-test** workflow (auto-memory `feedback-fixes-local-test`): no version bump / CHANGELOG / pack / release unless the user asks.
- Token references (`--fg-accent-prominent`, `--stroke-neutral-subtle`, etc.) follow the existing seed + composite conventions; if a token renders wrong in the thumbnail, check it against `studio/prototype-kit/composites/*` usage rather than inventing a new one.
