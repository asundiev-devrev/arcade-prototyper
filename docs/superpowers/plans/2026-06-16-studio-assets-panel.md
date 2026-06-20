# Studio Assets Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-pane "Assets" tab to Studio that catalogs every building block (composites, arcade-gen components, icons) with search and prebuilt visual previews, so designers can see what exists and seed a prompt to use it.

**Architecture:** A build-time script merges three existing machine-readable sources into one `assets-catalog.json` and renders thumbnail PNGs for composites/components via the existing sidecar `/pack` renderer. A new `/api/assets` middleware serves the catalog + thumbnails. The React shell's left pane becomes a tabbed container (`Chat` | `Assets`); the Assets tab renders search + three sections + a detail view, and reuses the existing `seedRef` mechanism to drop a prompt into chat.

**Tech Stack:** TypeScript, React 18, Vite middleware (Node `http` IncomingMessage/ServerResponse), Vitest, esbuild (via existing `buildFrameBundle`), Playwright (already vendored, used for headless screenshot).

**Spec:** `docs/superpowers/specs/2026-06-16-studio-assets-panel-design.md`

---

## File Structure

**Build / data layer**
- Create: `studio/scripts/buildAssetsCatalog.ts` — orchestrates catalog generation (merge 3 sources, render thumbs, write JSON).
- Create: `studio/server/assetsCatalog.ts` — pure functions that produce catalog *entries* from the three sources (no I/O side effects beyond reads). Imported by the build script AND tests.
- Create: `studio/prototype-kit/examples/<Name>.tsx` (one per composite/component) — minimal demo usage. ~89 files.
- Create: `studio/prototype-kit/examples/index.ts` — barrel mapping name → example source string (for the renderer) + explicit opt-out list.
- Generated (committed): `studio/prototype-kit/assets-catalog.json`, `studio/prototype-kit/assets-thumbs/*.png`.

**Server**
- Create: `studio/server/middleware/assets.ts` — `GET /api/assets` (catalog JSON) + `GET /api/assets/thumbs/<name>.png` (static thumb).
- Modify: `studio/vite.config.ts` — register `assetsMiddleware()`.

**Client**
- Create: `studio/src/components/assets/AssetsPanel.tsx` — top-level Assets tab content (fetch + search + sections + detail).
- Create: `studio/src/components/assets/AssetCard.tsx` — one composite/component card.
- Create: `studio/src/components/assets/AssetDetail.tsx` — detail view (larger preview + description + "Use this").
- Create: `studio/src/components/assets/IconGrid.tsx` — dense icon grid (inline SVG + copy-name).
- Create: `studio/src/components/assets/useAssetsCatalog.ts` — fetch hook.
- Create: `studio/src/components/shell/LeftPaneTabs.tsx` — tab strip + tabbed container wrapping ChatPane / AssetsPanel.
- Modify: `studio/src/routes/ProjectDetail.tsx` — swap the bare `<ChatPane>` aside for `<LeftPaneTabs>`; thread `seedChatRef` + a tab-switch callback.

**Tests**
- Create: `studio/__tests__/server/assetsCatalog.test.ts`
- Create: `studio/__tests__/server/assets-middleware.test.ts`
- Create: `studio/__tests__/prototype-kit/examples-coverage.test.ts`
- Create: `studio/__tests__/prototype-kit/assets-freshness.test.ts`
- Create: `studio/__tests__/components/AssetsPanel.test.tsx`

---

## Conventions to follow (read before starting)

- **Vite middleware does not hot-reload** — restart `pnpm run studio` after touching anything under `server/`.
- Middleware path resolution uses `path.dirname(fileURLToPath(import.meta.url))` then `../` hops — mirror `server/middleware/version.ts`.
- Component tests mock `@xorkavi/arcade-gen` — the mock must export every primitive the component-under-test imports.
- Run a single test file fast: `pnpm run studio:test <path>`. Full suite: `pnpm run studio:test`.
- Commit messages: Conventional Commits, scope `studio/assets`. End body with the Co-Authored-By trailer.
- Never `git add -A` — stage explicit paths.

---

## Task 1: Catalog entry types + composite source

**Files:**
- Create: `studio/server/assetsCatalog.ts`
- Test: `studio/__tests__/server/assetsCatalog.test.ts`

This task builds the *composite* section only (reuses `buildManifestEntries`). Components + icons come in Tasks 2–3.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/assetsCatalog.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection } from "../../server/assetsCatalog";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);

describe("buildCompositeSection", () => {
  it("returns every composite + template as catalog items", async () => {
    const section = await buildCompositeSection(KIT_ROOT);
    expect(section.kind).toBe("composite");
    // 30 composites + 4 templates = 34 (see spec census).
    expect(section.items.length).toBeGreaterThanOrEqual(34);
    const formModal = section.items.find((i) => i.name === "FormModal");
    expect(formModal).toBeDefined();
    expect(formModal!.doc.length).toBeGreaterThan(0);
    expect(formModal!.thumb).toBe("assets-thumbs/FormModal.png");
    // No prop dumps — designers don't need them.
    expect(formModal).not.toHaveProperty("propsSource");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: FAIL — `buildCompositeSection` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/assetsCatalog.ts
import { buildManifestEntries } from "./kitManifest";

export interface AssetItem {
  /** Component export name, e.g. "FormModal". */
  name: string;
  /** One-line human description. */
  doc: string;
  /** Relative thumbnail path under prototype-kit/, or null if none. */
  thumb: string | null;
}

export interface IconItem {
  name: string;
  category: string;
  tags: string[];
  /** Inline SVG markup. */
  svg: string;
}

export interface AssetSection {
  kind: "composite" | "component" | "icon";
  items: AssetItem[] | IconItem[];
}

/** First sentence of a multi-line doc, collapsed to one line. */
function firstLine(doc: string): string {
  const collapsed = doc.replace(/\s+/g, " ").trim();
  const dot = collapsed.indexOf(". ");
  return dot === -1 ? collapsed : collapsed.slice(0, dot + 1);
}

export async function buildCompositeSection(kitRoot: string): Promise<AssetSection> {
  const entries = await buildManifestEntries(kitRoot);
  const items: AssetItem[] = entries.map((e) => ({
    name: e.name,
    doc: firstLine(e.doc),
    thumb: `assets-thumbs/${e.name}.png`,
  }));
  return { kind: "composite", items };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/assetsCatalog.ts studio/__tests__/server/assetsCatalog.test.ts
git commit -m "feat(studio/assets): composite section of the assets catalog"
```

---

## Task 2: Icon section from arcade-gen manifest

**Files:**
- Modify: `studio/server/assetsCatalog.ts`
- Test: `studio/__tests__/server/assetsCatalog.test.ts`

The icon manifest ships inside the installed `@xorkavi/arcade-gen` package. Resolve it via Node module resolution so it works in dev and packaged. The manifest path inside the package is `dist/icons/manifest.json` (published) — fall back to source `src/components/icons/manifest.json` when running against the sibling repo in dev.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/assetsCatalog.test.ts
import { buildIconSection } from "../../server/assetsCatalog";

describe("buildIconSection", () => {
  it("returns icons with name + inline svg + tags", async () => {
    const section = await buildIconSection();
    expect(section.kind).toBe("icon");
    expect(section.items.length).toBeGreaterThanOrEqual(120);
    const first = section.items[0] as { name: string; svg: string; tags: string[] };
    expect(first.name).toMatch(/^[A-Z]/); // PascalCase component name
    expect(first.svg).toContain("<svg");
    expect(Array.isArray(first.tags)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: FAIL — `buildIconSection` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `studio/server/assetsCatalog.ts`:

```ts
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

interface RawIcon {
  componentName: string;
  category: string;
  tags: string[];
  svgContent: string;
}

/** Locate icons/manifest.json inside the installed arcade-gen package,
 *  falling back to the package's source tree for sibling-repo dev. */
function resolveIconManifestPath(): string {
  const pkgEntry = require.resolve("@xorkavi/arcade-gen");
  // pkgEntry is .../@xorkavi/arcade-gen/dist/index.mjs — climb to pkg root.
  const pkgRoot = path.resolve(path.dirname(pkgEntry), "..");
  const candidates = [
    path.join(pkgRoot, "dist", "icons", "manifest.json"),
    path.join(pkgRoot, "src", "components", "icons", "manifest.json"),
  ];
  return candidates[0]; // existence-checked at read time; see below
}

export async function buildIconSection(): Promise<AssetSection> {
  const pkgEntry = require.resolve("@xorkavi/arcade-gen");
  const pkgRoot = path.resolve(path.dirname(pkgEntry), "..");
  const candidates = [
    path.join(pkgRoot, "dist", "icons", "manifest.json"),
    path.join(pkgRoot, "src", "components", "icons", "manifest.json"),
  ];
  let raw: string | null = null;
  for (const c of candidates) {
    try {
      raw = await fs.readFile(c, "utf-8");
      break;
    } catch {
      /* try next */
    }
  }
  if (raw === null) {
    throw new Error(
      `arcade-gen icon manifest not found (looked in: ${candidates.join(", ")})`,
    );
  }
  const parsed = JSON.parse(raw) as RawIcon[] | { icons: RawIcon[] };
  const list: RawIcon[] = Array.isArray(parsed) ? parsed : parsed.icons;
  const items: IconItem[] = list.map((i) => ({
    name: i.componentName,
    category: i.category,
    tags: i.tags ?? [],
    svg: i.svgContent,
  }));
  return { kind: "icon", items };
}
```

> Note: delete the unused `resolveIconManifestPath` helper if the linter flags it — it is illustrative; the inline version in `buildIconSection` is the real one.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: PASS. If the manifest shape differs (array vs `{icons:[]}`), the code handles both; if field names differ, adjust `RawIcon` to match the actual `manifest.json` keys (`componentName`, `category`, `tags`, `svgContent` per the census).

- [ ] **Step 5: Commit**

```bash
git add studio/server/assetsCatalog.ts studio/__tests__/server/assetsCatalog.test.ts
git commit -m "feat(studio/assets): icon section sourced from arcade-gen manifest"
```

---

## Task 3: Component section from arcade-gen barrel

**Files:**
- Modify: `studio/server/assetsCatalog.ts`
- Test: `studio/__tests__/server/assetsCatalog.test.ts`

arcade-gen has no per-component one-line doc index that's trivially machine-readable across all ~55 components, so v1 uses a **curated allowlist with hand-written one-liners** kept in this file. This keeps the panel honest (only blessed, renderable components appear) and avoids surfacing hooks/types/internal exports. The allowlist is small and reviewed; new components are added intentionally.

- [ ] **Step 1: Write the failing test**

```ts
// append to studio/__tests__/server/assetsCatalog.test.ts
import { buildComponentSection } from "../../server/assetsCatalog";

describe("buildComponentSection", () => {
  it("returns curated arcade-gen components with docs + thumb paths", () => {
    const section = buildComponentSection();
    expect(section.kind).toBe("component");
    expect(section.items.length).toBeGreaterThanOrEqual(30);
    const button = (section.items as { name: string; doc: string; thumb: string }[]).find(
      (i) => i.name === "Button",
    );
    expect(button).toBeDefined();
    expect(button!.doc.length).toBeGreaterThan(0);
    expect(button!.thumb).toBe("assets-thumbs/Button.png");
    // Hooks/types must NOT appear.
    const names = (section.items as { name: string }[]).map((i) => i.name);
    expect(names).not.toContain("useDevRevTheme");
    expect(names).not.toContain("buttonVariants");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: FAIL — `buildComponentSection` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `studio/server/assetsCatalog.ts`:

```ts
/** Curated, renderable arcade-gen components shown in the panel.
 *  Order = display order within the Components section. Keep one-liners
 *  designer-facing (what it's for, not how it's typed). */
const COMPONENT_CATALOG: { name: string; doc: string }[] = [
  { name: "Button", doc: "Primary action control with variants and sizes." },
  { name: "IconButton", doc: "Square button that holds a single icon." },
  { name: "SplitButton", doc: "Primary action paired with a dropdown of related actions." },
  { name: "ButtonGroup", doc: "A row of buttons grouped as one control." },
  { name: "Input", doc: "Single-line text field." },
  { name: "TextArea", doc: "Multi-line text field." },
  { name: "Select", doc: "Dropdown for picking one option from a list." },
  { name: "Dropdown", doc: "Menu of actions triggered by a control." },
  { name: "Checkbox", doc: "Toggle for an individual on/off choice." },
  { name: "Radio", doc: "Pick exactly one option from a small set." },
  { name: "Switch", doc: "On/off toggle styled as a switch." },
  { name: "Toggle", doc: "Pressable control that stays on or off." },
  { name: "ToggleGroup", doc: "A set of toggles where one or more can be active." },
  { name: "DatePicker", doc: "Calendar control for picking a date." },
  { name: "Avatar", doc: "Round image or initials representing a person." },
  { name: "Badge", doc: "Small count or status indicator." },
  { name: "Tag", doc: "Compact label for categorizing content." },
  { name: "Banner", doc: "Full-width inline message for context or alerts." },
  { name: "Toast", doc: "Transient notification that appears and dismisses." },
  { name: "Tooltip", doc: "Small hint shown on hover or focus." },
  { name: "Popover", doc: "Floating panel anchored to a trigger." },
  { name: "Modal", doc: "Centered dialog that overlays the page." },
  { name: "Menu", doc: "List of selectable actions or links." },
  { name: "Table", doc: "Rows and columns of structured data." },
  { name: "Tabs", doc: "Switch between panels of related content." },
  { name: "Breadcrumb", doc: "Trail showing the current location in a hierarchy." },
  { name: "Link", doc: "Inline navigational text link." },
  { name: "Sidebar", doc: "Vertical navigation rail." },
  { name: "ChatBubble", doc: "A single message bubble in a conversation." },
  { name: "Loader", doc: "Inline spinner indicating progress." },
  { name: "FullscreenLoader", doc: "Full-page loading overlay." },
  { name: "Separator", doc: "Thin divider between sections." },
  { name: "KeyboardShortcut", doc: "Styled key combination hint." },
  { name: "Stack", doc: "Vertical or horizontal flex layout container." },
  { name: "Grid", doc: "Responsive grid layout container." },
  { name: "Accordion", doc: "Expandable/collapsible content sections." },
  { name: "ScrollArea", doc: "Scrollable region with styled scrollbars." },
  { name: "ResizablePanel", doc: "Panel the user can drag to resize." },
  { name: "AreaChart", doc: "Filled line chart for trends over a range." },
  { name: "BarChart", doc: "Horizontal bars comparing categories." },
  { name: "ColumnChart", doc: "Vertical bars comparing categories." },
  { name: "LineChart", doc: "Line chart for values over time." },
  { name: "PieChart", doc: "Circular chart of proportions." },
  { name: "ScatterChart", doc: "Points plotted on two axes." },
  { name: "HeatMapChart", doc: "Grid of color-coded intensity values." },
  { name: "FunnelChart", doc: "Stage-by-stage conversion funnel." },
  { name: "RadarChart", doc: "Multi-axis comparison on a radial grid." },
  { name: "TreemapChart", doc: "Nested rectangles sized by value." },
];

export function buildComponentSection(): AssetSection {
  const items: AssetItem[] = COMPONENT_CATALOG.map((c) => ({
    name: c.name,
    doc: c.doc,
    thumb: `assets-thumbs/${c.name}.png`,
  }));
  return { kind: "component", items };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/assetsCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/assetsCatalog.ts studio/__tests__/server/assetsCatalog.test.ts
git commit -m "feat(studio/assets): curated arcade-gen component section"
```

---

## Task 4: Demo examples folder + coverage guard

**Files:**
- Create: `studio/prototype-kit/examples/index.ts`
- Create: `studio/prototype-kit/examples/<Name>.tsx` (start with a representative handful; the coverage test drives the rest)
- Test: `studio/__tests__/prototype-kit/examples-coverage.test.ts`

Each example is a minimal, realistic render of one composite/component so its thumbnail shows something complete instead of an empty box. The example exports a default element. The barrel maps name → dynamic import path so the renderer (Task 5) can read each example's source.

- [ ] **Step 1: Write the failing coverage test**

```ts
// studio/__tests__/prototype-kit/examples-coverage.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection, buildComponentSection } from "../../server/assetsCatalog";
import { EXAMPLE_NAMES, EXAMPLE_OPT_OUT } from "../../prototype-kit/examples";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);

describe("example coverage", () => {
  it("every composite + component has an example or an explicit opt-out", async () => {
    const composites = (await buildCompositeSection(KIT_ROOT)).items as { name: string }[];
    const components = buildComponentSection().items as { name: string }[];
    const need = [...composites, ...components].map((i) => i.name);
    const covered = new Set([...EXAMPLE_NAMES, ...EXAMPLE_OPT_OUT]);
    const missing = need.filter((n) => !covered.has(n));
    expect(missing, `missing examples for: ${missing.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/prototype-kit/examples-coverage.test.ts`
Expected: FAIL — `prototype-kit/examples` module not found.

- [ ] **Step 3: Create the barrel + first examples**

```ts
// studio/prototype-kit/examples/index.ts
// Maps a composite/component name to a module that default-exports a single
// rendered example element. Used by scripts/buildAssetsCatalog.ts to render
// thumbnails. Add a row here for every item shown in the Assets panel.
export const EXAMPLES: Record<string, () => Promise<{ default: React.ReactElement }>> = {
  FormModal: () => import("./FormModal"),
  CardGrid: () => import("./CardGrid"),
  Button: () => import("./Button"),
  // …one row per composite + component (see EXAMPLE_NAMES below)…
};

// Names we intentionally do NOT render a thumbnail for (e.g. invisible/utility
// components). They appear in the panel as a name-only tile.
export const EXAMPLE_OPT_OUT: string[] = ["Separator", "KeyboardShortcut"];

export const EXAMPLE_NAMES = Object.keys(EXAMPLES);

import type React from "react";
```

```tsx
// studio/prototype-kit/examples/Button.tsx
import React from "react";
import { Button } from "../arcade-components";

export default <Button variant="primary" size="md">Save changes</Button>;
```

```tsx
// studio/prototype-kit/examples/CardGrid.tsx
import React from "react";
import { CardGrid } from "../composites/CardGrid";

export default (
  <CardGrid
    items={[
      { id: "1", title: "Onboarding", subtitle: "12 steps", icon: "rocket" },
      { id: "2", title: "Billing", subtitle: "3 plans", icon: "card" },
      { id: "3", title: "Team", subtitle: "8 members", icon: "people" },
    ]}
  />
);
```

```tsx
// studio/prototype-kit/examples/FormModal.tsx
import React from "react";
import { FormModal } from "../composites/FormModal";

export default (
  <FormModal
    title="Edit profile"
    open
    fields={[
      { label: "Name", value: "Ada Lovelace" },
      { label: "Email", value: "ada@example.com" },
    ]}
    onSave={() => {}}
    onClose={() => {}}
  />
);
```

> The exact props for each composite come from its `.tsx` signature — open `studio/prototype-kit/composites/<Name>.tsx` and read the `type <Name>Props` block (the same one `kitManifest.ts` extracts). For arcade-gen components, read the prop interface from the package types. Keep each example to the minimum that renders a representative, non-empty result.

- [ ] **Step 4: Author the remaining examples until the coverage test passes**

Add one `<Name>.tsx` + one `EXAMPLES` row per remaining composite/component, or add the name to `EXAMPLE_OPT_OUT` when a visual thumbnail makes no sense. Re-run after each batch:

Run: `pnpm run studio:test studio/__tests__/prototype-kit/examples-coverage.test.ts`
Expected: eventually PASS (`missing examples for: ` empty).

- [ ] **Step 5: Verify examples compile**

Run: `pnpm run studio:test` (the project's existing typecheck/build step in CI will catch a broken example; locally, a quick guard is to ensure the panel build script in Task 5 runs without throwing).
Expected: no TypeScript errors from `examples/`.

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/examples studio/__tests__/prototype-kit/examples-coverage.test.ts
git commit -m "feat(studio/assets): demo examples for composites + components"
```

---

## Task 5: Build script — render thumbnails + write catalog JSON

**Files:**
- Create: `studio/scripts/buildAssetsCatalog.ts`
- Generated: `studio/prototype-kit/assets-catalog.json`, `studio/prototype-kit/assets-thumbs/*.png`

The script: (1) assembles the three sections, (2) for each composite/component with an example, renders the example to HTML via `packFromSource`, loads it in headless Chromium (Playwright is vendored), screenshots the `#root` element to a PNG, (3) writes the catalog JSON (stamping `generatedAt` last).

- [ ] **Step 1: Write the script**

```ts
// studio/scripts/buildAssetsCatalog.ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { packFromSource } from "../server/sidecar/packFromSource";
import {
  buildCompositeSection,
  buildComponentSection,
  buildIconSection,
  type AssetSection,
  type AssetItem,
} from "../server/assetsCatalog";
import { EXAMPLES, EXAMPLE_OPT_OUT } from "../prototype-kit/examples";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(HERE, "..", "prototype-kit");
const THUMBS_DIR = path.join(KIT_ROOT, "assets-thumbs");
const CATALOG_PATH = path.join(KIT_ROOT, "assets-catalog.json");

// Wrap an example element's source into a renderable frame. Examples
// default-export a React element; we re-emit them as a frame entrypoint.
function exampleFrameSource(name: string): string {
  return `import React from "react";
import example from "../../prototype-kit/examples/${name}";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(example);
`;
}

async function renderThumb(
  browser: import("playwright").Browser,
  name: string,
): Promise<boolean> {
  const html = await packFromSource({ tsx: exampleFrameSource(name), theme: "arcade" });
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    const root = page.locator("#root");
    await root.waitFor({ state: "visible", timeout: 5000 });
    await fs.mkdir(THUMBS_DIR, { recursive: true });
    await root.screenshot({ path: path.join(THUMBS_DIR, `${name}.png`) });
    return true;
  } catch (err) {
    console.warn(`[assets] thumbnail failed for ${name}:`, (err as Error).message);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  const [composites, icons] = await Promise.all([
    buildCompositeSection(KIT_ROOT),
    buildIconSection(),
  ]);
  const components = buildComponentSection();

  const browser = await chromium.launch();
  try {
    for (const section of [composites, components] as AssetSection[]) {
      for (const item of section.items as AssetItem[]) {
        if (EXAMPLE_OPT_OUT.includes(item.name) || !(item.name in EXAMPLES)) {
          item.thumb = null; // name-only tile
          continue;
        }
        const ok = await renderThumb(browser, item.name);
        if (!ok) item.thumb = null;
      }
    }
  } finally {
    await browser.close();
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    sections: [composites, components, icons],
  };
  await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf-8");
  console.log(
    `[assets] wrote ${CATALOG_PATH} (` +
      `${composites.items.length} composites, ` +
      `${components.items.length} components, ` +
      `${icons.items.length} icons)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add an npm script**

In the repo-root `package.json` `scripts`, add:

```json
"studio:assets": "tsx studio/scripts/buildAssetsCatalog.ts"
```

(Use `tsx` — already a dev dependency for studio scripts. If absent, use the project's existing TS runner; check how other `studio/scripts/*` are invoked.)

- [ ] **Step 3: Run it**

Run: `pnpm run studio:assets`
Expected: prints the summary line; `studio/prototype-kit/assets-catalog.json` and `assets-thumbs/*.png` now exist. Spot-check `assets-thumbs/FormModal.png` is a non-empty image showing the modal.

- [ ] **Step 4: Commit (including generated artifacts)**

```bash
git add studio/scripts/buildAssetsCatalog.ts package.json \
  studio/prototype-kit/assets-catalog.json studio/prototype-kit/assets-thumbs
git commit -m "feat(studio/assets): build script renders thumbnails + writes catalog json"
```

---

## Task 6: Freshness test

**Files:**
- Test: `studio/__tests__/prototype-kit/assets-freshness.test.ts`

Asserts the committed catalog is not older than the sources that feed it, so a release can't ship stale art silently.

- [ ] **Step 1: Write the test**

```ts
// studio/__tests__/prototype-kit/assets-freshness.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);
const CATALOG = path.join(KIT_ROOT, "assets-catalog.json");

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (entry.name.endsWith(".tsx")) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

describe("assets catalog freshness", () => {
  it("catalog is newer than composite + example sources", () => {
    expect(fs.existsSync(CATALOG), "run `pnpm run studio:assets`").toBe(true);
    const catalogMtime = fs.statSync(CATALOG).mtimeMs;
    const sourceMtime = Math.max(
      newestMtime(path.join(KIT_ROOT, "composites")),
      newestMtime(path.join(KIT_ROOT, "templates")),
      newestMtime(path.join(KIT_ROOT, "examples")),
    );
    expect(
      catalogMtime >= sourceMtime,
      "assets-catalog.json is stale — run `pnpm run studio:assets` and commit",
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/prototype-kit/assets-freshness.test.ts`
Expected: PASS (catalog was just regenerated in Task 5).

- [ ] **Step 3: Wire into studio:pack**

In the repo-root `package.json`, prepend the catalog build to the pack script so releases regenerate art. Find the existing `studio:pack` script and chain `studio:assets` before it, e.g.:

```json
"studio:pack": "pnpm run studio:assets && <existing pack command>"
```

(Read the current value first; preserve it verbatim after the `&&`.)

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/prototype-kit/assets-freshness.test.ts package.json
git commit -m "test(studio/assets): freshness guard + regenerate art on pack"
```

---

## Task 7: `/api/assets` middleware

**Files:**
- Create: `studio/server/middleware/assets.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/assets-middleware.test.ts`

Serves the committed catalog JSON at `GET /api/assets` and thumbnails at `GET /api/assets/thumbs/<name>.png`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/assets-middleware.test.ts
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { assetsMiddleware } from "../../server/middleware/assets";

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k: string, v: string) => (res.headers[k] = v);
  res.writeHead = (code: number, h?: Record<string, string>) => {
    res.statusCode = code;
    if (h) Object.assign(res.headers, h);
    return res;
  };
  res.body = "";
  res.end = vi.fn((chunk?: any) => {
    if (chunk) res.body += chunk;
  });
  return res as ServerResponse & { body: string; headers: Record<string, string> };
}

describe("assetsMiddleware", () => {
  it("serves the catalog JSON at GET /api/assets", async () => {
    const mw = assetsMiddleware();
    const req = { method: "GET", url: "/api/assets" } as IncomingMessage;
    const res = mockRes();
    await new Promise<void>((resolve) => {
      (res.end as any).mockImplementation((chunk?: any) => {
        if (chunk) (res as any).body += chunk;
        resolve();
      });
      mw(req, res, () => resolve());
    });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse((res as any).body);
    expect(Array.isArray(parsed.sections)).toBe(true);
    expect(parsed.sections.map((s: any) => s.kind)).toEqual([
      "composite",
      "component",
      "icon",
    ]);
  });

  it("passes through unrelated routes via next()", async () => {
    const mw = assetsMiddleware();
    const req = { method: "GET", url: "/api/other" } as IncomingMessage;
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/assets-middleware.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the middleware**

```ts
// studio/server/middleware/assets.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/middleware/ -> ../../prototype-kit lands on studio/prototype-kit in
// both dev and the packaged app (electron-builder copies studio/** verbatim).
const MW_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(MW_DIR, "..", "..", "prototype-kit");
const CATALOG = path.join(KIT_ROOT, "assets-catalog.json");
const THUMBS = path.join(KIT_ROOT, "assets-thumbs");

export function assetsMiddleware() {
  return function (req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? "";
    if (req.method !== "GET") return next();

    if (url === "/api/assets") {
      fs.readFile(CATALOG, "utf-8")
        .then((json) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(json);
        })
        .catch(() => {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "catalog_unavailable" }));
        });
      return;
    }

    const thumbMatch = url.match(/^\/api\/assets\/thumbs\/([A-Za-z][A-Za-z0-9]*)\.png$/);
    if (thumbMatch) {
      const file = path.join(THUMBS, `${thumbMatch[1]}.png`);
      // Defense-in-depth: the regex already forbids path separators.
      fs.readFile(file)
        .then((buf) => {
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "thumb_not_found" }));
        });
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/assets-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in vite.config.ts**

Add the import near the other middleware imports (around line 34):

```ts
import { assetsMiddleware } from "./server/middleware/assets";
```

And register it with the others (around line 67, after `figmaExportMiddleware()`):

```ts
      server.middlewares.use(assetsMiddleware());
```

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/assets.ts studio/vite.config.ts \
  studio/__tests__/server/assets-middleware.test.ts
git commit -m "feat(studio/assets): /api/assets middleware serves catalog + thumbnails"
```

---

## Task 8: Catalog fetch hook

**Files:**
- Create: `studio/src/components/assets/useAssetsCatalog.ts`

- [ ] **Step 1: Write the hook**

```ts
// studio/src/components/assets/useAssetsCatalog.ts
import { useEffect, useState } from "react";

export interface AssetItem {
  name: string;
  doc: string;
  thumb: string | null;
}
export interface IconItem {
  name: string;
  category: string;
  tags: string[];
  svg: string;
}
export interface AssetSection {
  kind: "composite" | "component" | "icon";
  items: AssetItem[] | IconItem[];
}
export interface Catalog {
  generatedAt: string;
  sections: AssetSection[];
}

type State =
  | { status: "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "error" };

export function useAssetsCatalog(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/assets")
      .then((r) => {
        if (!r.ok) throw new Error("catalog unavailable");
        return r.json();
      })
      .then((catalog: Catalog) => {
        if (live) setState({ status: "ready", catalog });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
```

- [ ] **Step 2: Commit**

```bash
git add studio/src/components/assets/useAssetsCatalog.ts
git commit -m "feat(studio/assets): catalog fetch hook"
```

---

## Task 9: AssetsPanel UI (search + sections + detail + seed/copy)

**Files:**
- Create: `studio/src/components/assets/AssetCard.tsx`
- Create: `studio/src/components/assets/AssetDetail.tsx`
- Create: `studio/src/components/assets/IconGrid.tsx`
- Create: `studio/src/components/assets/AssetsPanel.tsx`
- Test: `studio/__tests__/components/AssetsPanel.test.tsx`

`AssetsPanel` takes two callbacks from the shell: `onSeed(text)` (drop a prompt into chat) and `onSeeded()` (switch the left pane to the Chat tab). Composites/components → detail + "Use this" (calls both). Icons → copy name.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/AssetsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetsPanel } from "../../src/components/assets/AssetsPanel";

const CATALOG = {
  generatedAt: "2026-06-16T00:00:00.000Z",
  sections: [
    { kind: "composite", items: [{ name: "FormModal", doc: "Edit dialog.", thumb: null }] },
    { kind: "component", items: [{ name: "Button", doc: "Action control.", thumb: null }] },
    {
      kind: "icon",
      items: [{ name: "ChevronDown", category: "Navigation", tags: ["chevron"], svg: "<svg></svg>" }],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOG) })) as any,
  );
});

describe("AssetsPanel", () => {
  it("renders all three sections after load", async () => {
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    expect(await screen.findByText("FormModal")).toBeTruthy();
    expect(screen.getByText("Button")).toBeTruthy();
    expect(screen.getByText("ChevronDown")).toBeTruthy();
  });

  it("filters by search query", async () => {
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    await screen.findByText("FormModal");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "button" } });
    expect(screen.queryByText("FormModal")).toBeNull();
    expect(screen.getByText("Button")).toBeTruthy();
  });

  it("seeds a prompt and asks to switch tab when Use this is clicked", async () => {
    const onSeed = vi.fn();
    const onSeeded = vi.fn();
    render(<AssetsPanel onSeed={onSeed} onSeeded={onSeeded} />);
    fireEvent.click(await screen.findByText("FormModal"));
    fireEvent.click(await screen.findByRole("button", { name: /use this/i }));
    expect(onSeed).toHaveBeenCalledWith("Use the FormModal composite to ");
    expect(onSeeded).toHaveBeenCalled();
  });

  it("copies icon name on click", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } } as any);
    render(<AssetsPanel onSeed={vi.fn()} onSeeded={vi.fn()} />);
    fireEvent.click(await screen.findByText("ChevronDown"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ChevronDown"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/AssetsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write AssetCard**

```tsx
// studio/src/components/assets/AssetCard.tsx
import React from "react";
import type { AssetItem } from "./useAssetsCatalog";

export function AssetCard({ item, onClick }: { item: AssetItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        background: "var(--surface-neutral)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          aspectRatio: "4 / 3",
          borderRadius: 6,
          background: "var(--surface-neutral-subtle, #f3f3f3)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.thumb ? (
          <img
            src={`/api/assets/thumbs/${item.name}.png`}
            alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>{item.name}</span>
        )}
      </div>
      <span style={{ fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)" }}>
        {item.name}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Write AssetDetail**

```tsx
// studio/src/components/assets/AssetDetail.tsx
import React from "react";
import { Button } from "@xorkavi/arcade-gen";
import type { AssetItem } from "./useAssetsCatalog";

export function AssetDetail({
  item,
  kind,
  onBack,
  onUse,
}: {
  item: AssetItem;
  kind: "composite" | "component";
  onBack: () => void;
  onUse: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <button
        onClick={onBack}
        style={{ alignSelf: "flex-start", fontSize: 13, color: "var(--fg-neutral-subtle)", cursor: "pointer", background: "none", border: "none" }}
      >
        ← Back
      </button>
      <div
        style={{
          borderRadius: 8,
          border: "1px solid var(--stroke-neutral-subtle)",
          background: "var(--surface-neutral-subtle, #f3f3f3)",
          minHeight: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {item.thumb ? (
          <img src={`/api/assets/thumbs/${item.name}.png`} alt={item.name} style={{ width: "100%" }} />
        ) : (
          <span style={{ color: "var(--fg-neutral-subtle)" }}>{item.name}</span>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-neutral-prominent)" }}>
        {item.name}
      </div>
      <div style={{ fontSize: 13, color: "var(--fg-neutral)" }}>{item.doc}</div>
      <Button variant="primary" size="md" onClick={onUse}>
        Use this
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Write IconGrid**

```tsx
// studio/src/components/assets/IconGrid.tsx
import React, { useState } from "react";
import type { IconItem } from "./useAssetsCatalog";

export function IconGrid({ icons }: { icons: IconItem[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(name: string) {
    navigator.clipboard.writeText(name).then(() => {
      setCopied(name);
      window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
    });
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
        gap: 8,
        padding: 8,
      }}
    >
      {icons.map((icon) => (
        <button
          key={icon.name}
          title={icon.name}
          onClick={() => copy(icon.name)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 6,
            background: "var(--surface-neutral)",
            cursor: "pointer",
          }}
        >
          <span
            style={{ width: 24, height: 24, color: "var(--fg-neutral-prominent)" }}
            dangerouslySetInnerHTML={{ __html: icon.svg }}
          />
          <span style={{ fontSize: 10, color: "var(--fg-neutral-subtle)", textAlign: "center", wordBreak: "break-word" }}>
            {copied === icon.name ? "Copied!" : icon.name}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write AssetsPanel**

```tsx
// studio/src/components/assets/AssetsPanel.tsx
import React, { useMemo, useState } from "react";
import { useAssetsCatalog, type AssetItem, type IconItem } from "./useAssetsCatalog";
import { AssetCard } from "./AssetCard";
import { AssetDetail } from "./AssetDetail";
import { IconGrid } from "./IconGrid";

interface Props {
  onSeed: (text: string) => void;
  onSeeded: () => void;
}

const SECTION_LABEL: Record<string, string> = {
  composite: "Composites",
  component: "Components",
  icon: "Icons",
};

export function AssetsPanel({ onSeed, onSeeded }: Props) {
  const state = useAssetsCatalog();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ item: AssetItem; kind: "composite" | "component" } | null>(null);

  const q = query.trim().toLowerCase();

  if (state.status === "loading")
    return <div style={panelMsg}>Loading assets…</div>;
  if (state.status === "error")
    return <div style={panelMsg}>Assets unavailable — run the build.</div>;

  if (selected) {
    return (
      <AssetDetail
        item={selected.item}
        kind={selected.kind}
        onBack={() => setSelected(null)}
        onUse={() => {
          const noun = selected.kind === "composite" ? "composite" : "component";
          onSeed(`Use the ${selected.item.name} ${noun} to `);
          onSeeded();
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: 8, borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <input
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "var(--surface-neutral)",
            color: "var(--fg-neutral-prominent)",
            fontSize: 13,
          }}
        />
      </div>
      <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
        {state.catalog.sections.map((section) => {
          if (section.kind === "icon") {
            const icons = (section.items as IconItem[]).filter(
              (i) => !q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)),
            );
            if (icons.length === 0) return null;
            return (
              <Section key="icon" title={`${SECTION_LABEL.icon} · ${icons.length}`}>
                <IconGrid icons={icons} />
              </Section>
            );
          }
          const kind = section.kind as "composite" | "component";
          const items = (section.items as AssetItem[]).filter(
            (i) => !q || i.name.toLowerCase().includes(q) || i.doc.toLowerCase().includes(q),
          );
          if (items.length === 0) return null;
          return (
            <Section key={kind} title={`${SECTION_LABEL[kind]} · ${items.length}`}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: 8,
                  padding: 8,
                }}
              >
                {items.map((item) => (
                  <AssetCard key={item.name} item={item} onClick={() => setSelected({ item, kind })} />
                ))}
              </div>
            </Section>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--fg-neutral-subtle)",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open && children}
    </div>
  );
}

const panelMsg: React.CSSProperties = {
  padding: 16,
  fontSize: 13,
  color: "var(--fg-neutral-subtle)",
};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/components/AssetsPanel.test.tsx`
Expected: PASS all four cases. If the arcade-gen `Button` import in `AssetDetail` breaks the test renderer, add `Button` to the `@xorkavi/arcade-gen` mock used by the test (mirror the existing component-test mock pattern).

- [ ] **Step 8: Commit**

```bash
git add studio/src/components/assets
git commit -m "feat(studio/assets): AssetsPanel UI — search, sections, detail, seed/copy"
```

---

## Task 10: Left-pane tabs + wire into ProjectDetail

**Files:**
- Create: `studio/src/components/shell/LeftPaneTabs.tsx`
- Modify: `studio/src/routes/ProjectDetail.tsx`

Wraps ChatPane + AssetsPanel in a tab strip. Tab state persisted to `studio:leftPaneTab`, default `chat`. "Use this" calls `onSeed` (existing seedRef) then flips the tab to `chat`.

- [ ] **Step 1: Write LeftPaneTabs**

```tsx
// studio/src/components/shell/LeftPaneTabs.tsx
import React, { useState, useEffect, type MutableRefObject } from "react";
import { ChatPane } from "../chat/ChatPane";
import { AssetsPanel } from "../assets/AssetsPanel";
import type { ChimeIn } from "../../types"; // match ChatPane's existing import path

const TAB_KEY = "studio:leftPaneTab";
type Tab = "chat" | "assets";

interface Props {
  projectSlug: string;
  history: React.ComponentProps<typeof ChatPane>["history"];
  seedRef: MutableRefObject<((text: string) => void) | null>;
  chimeIns: ChimeIn[];
  onApplyChimeIn: (c: ChimeIn) => void;
  onDismissChimeIn: (c: ChimeIn) => void;
}

export function LeftPaneTabs(props: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "chat";
    return window.localStorage.getItem(TAB_KEY) === "assets" ? "assets" : "chat";
  });
  useEffect(() => {
    window.localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        {(["chat", "assets"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 0",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 500,
              color: tab === t ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--fg-accent-prominent, #5b5bd6)" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t === "chat" ? "Chat" : "Assets"}
          </button>
        ))}
      </div>
      {/* Keep ChatPane mounted (preserve scroll/stream); just hide it. */}
      <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "flex" : "none", flexDirection: "column" }}>
        <ChatPane
          projectSlug={props.projectSlug}
          history={props.history}
          seedRef={props.seedRef}
          chimeIns={props.chimeIns}
          onApplyChimeIn={props.onApplyChimeIn}
          onDismissChimeIn={props.onDismissChimeIn}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === "assets" ? "block" : "none" }}>
        {tab === "assets" && (
          <AssetsPanel
            onSeed={(text) => props.seedRef.current?.(text)}
            onSeeded={() => setTab("chat")}
          />
        )}
      </div>
    </div>
  );
}
```

> Match `ChimeIn` and `history` types to ChatPane's actual prop types — open `studio/src/components/chat/ChatPane.tsx` and copy the exact import + prop signatures. Adjust the imports above if the real paths differ.

- [ ] **Step 2: Swap into ProjectDetail**

In `studio/src/routes/ProjectDetail.tsx`, replace the `<ChatPane …/>` element (lines ~349–356) with:

```tsx
          <LeftPaneTabs
            projectSlug={project.slug}
            history={chatHistory}
            seedRef={seedChatRef}
            chimeIns={chimeIns}
            onApplyChimeIn={handleApplyChimeIn}
            onDismissChimeIn={handleDismissChimeIn}
          />
```

Add the import at the top with the other component imports:

```tsx
import { LeftPaneTabs } from "../components/shell/LeftPaneTabs";
```

Remove the now-unused `ChatPane` import from ProjectDetail if nothing else there uses it (check first — leave it if still referenced).

- [ ] **Step 3: Manual verification**

Run: `pnpm run studio`
- Left pane shows `Chat | Assets` tabs; Chat is default and behaves exactly as before.
- Click `Assets` → three sections render with thumbnails; search filters.
- Click a composite → detail view → "Use this" → input is seeded with `Use the <Name> composite to ` AND the pane flips back to Chat.
- Click an icon → label flips to "Copied!" and the name is on the clipboard.

- [ ] **Step 4: Run the full suite**

Run: `pnpm run studio:test`
Expected: all green (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/shell/LeftPaneTabs.tsx studio/src/routes/ProjectDetail.tsx
git commit -m "feat(studio/assets): left-pane Chat/Assets tabs wired into project view"
```

---

## Task 11: Changelog entry

**Files:**
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Add an Added entry**

Add under a new unreleased/next-version heading at the top of `studio/CHANGELOG.md` (keep-a-changelog style):

```markdown
### Added
- Assets panel: a new "Assets" tab in the left pane that catalogs every
  composite, component, and icon available to prototypes, with search and visual
  previews. Click "Use this" on a composite or component to drop a starter prompt
  into chat; click an icon to copy its name.
```

- [ ] **Step 2: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): changelog entry for assets panel"
```

> Per repo memory, no version bump / pack / release unless the user asks — this is local-test-only by default.

---

## Self-Review Notes (author)

- **Spec coverage:** 3 sections (Tasks 1–3), thumbnails + examples (Tasks 4–5), drift guard (Task 6), middleware (Task 7), tabbed left pane (Task 10), search/detail/seed/copy (Task 9), designer-facing/no-props (enforced in Task 1 test). All spec requirements mapped.
- **Type consistency:** `AssetItem`/`IconItem`/`AssetSection` defined in `server/assetsCatalog.ts` (Task 1–2) and mirrored client-side in `useAssetsCatalog.ts` (Task 8) — keep field names identical (`name`, `doc`, `thumb`, `svg`, `tags`, `category`). Seed string `Use the <Name> composite|component to ` is identical in Task 9 impl and its test.
- **Known soft spots to confirm during execution:** (a) arcade-gen icon manifest field names — verify against the real `manifest.json`; (b) each composite's example props — read each `.tsx` signature; (c) ChatPane prop types in Task 10 — copy exact signatures.
