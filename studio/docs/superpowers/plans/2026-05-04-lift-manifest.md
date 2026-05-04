# Lift Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a per-frame Lift Manifest (`LIFT.md` + `LIFT.json`) that translates a Studio frame's arcade-gen imports into a production `raw-design-system` + `arcade-theme` handoff, expose it through Studio's UI and the Vercel share bundle, and enforce coverage via a mapping-table test.

**Architecture:** All logic lives in `studio/`. Pure functions in `studio/src/lift/` do the work (parse a frame's imports, look up entries in a curated mapping table, detect the frame's shape, render markdown + JSON). A Vite plugin (`liftEmitPlugin`) runs the pure functions whenever a frame changes and writes `LIFT.md` / `LIFT.json` next to the frame. A thin HTTP middleware (`liftMiddleware`) reads those files. The Vercel bundler ships them as-is into share bundles. A `"Copy lift manifest"` action in the Studio shell hits the middleware and copies the markdown to the clipboard. The generator, the chat subprocess, `arcade-gen`, and the production design system are **not** touched.

**Tech Stack:** TypeScript, Vite plugin API, Node fs/promises, chokidar-driven file watching (piggybacks on existing `projectWatchPlugin`), Vitest for tests, React for the one-button UI surface.

---

## Pre-work: worktree setup

- [ ] **Step 0: Create an isolated worktree**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git worktree add .worktrees/lift-manifest -b feat/lift-manifest
cd .worktrees/lift-manifest
```

All remaining steps run from `.worktrees/lift-manifest`. Paths in the plan are **relative to that worktree root** (which mirrors the repo root).

---

## File Structure

```
studio/
├── src/
│   └── lift/
│       ├── types.ts                     # Manifest + mapping-entry types. Pure, no I/O.
│       ├── parseImports.ts              # Parse a frame's index.tsx into { moduleSpecifier, importedNames }[]
│       ├── mappings/
│       │   ├── index.ts                 # Barrel: all mapping entries merged
│       │   ├── primitives.ts            # arcade-gen primitives (Button, Input, Modal, ...)
│       │   └── composites.ts            # prototype-kit composites + templates
│       ├── detectShape.ts               # Frame-shape heuristic → shape name
│       ├── scaffolding.ts               # Shape → production scaffolding checklist
│       ├── buildManifest.ts             # Pure: (frame text, prompt, shape) → Manifest object
│       └── render.ts                    # Manifest → markdown, Manifest → JSON
├── server/
│   ├── plugins/
│   │   └── liftEmitPlugin.ts            # Vite plugin. Writes LIFT.md/LIFT.json on frame change.
│   ├── middleware/
│   │   └── lift.ts                      # GET /api/projects/:slug/lift/:frame.(md|json)
│   └── vercel/
│       └── bundler.ts                   # MODIFIED: include LIFT.md/LIFT.json as deployment files
├── src/components/shell/
│   └── ShareModal.tsx                   # MODIFIED: "Copy Lift Manifest" button in success state
├── __tests__/
│   └── lift/
│       ├── parseImports.test.ts
│       ├── detectShape.test.ts
│       ├── scaffolding.test.ts
│       ├── buildManifest.test.ts
│       ├── renderMarkdown.snapshot.test.ts
│       ├── renderJson.snapshot.test.ts
│       ├── mappingCoverage.test.ts
│       ├── liftEmitPlugin.test.ts
│       ├── liftMiddleware.test.ts
│       └── fixtures/
│           ├── list-frame.tsx
│           ├── settings-frame.tsx
│           ├── detail-frame.tsx
│           └── adhoc-frame.tsx
└── CHANGELOG.md                         # MODIFIED: add Lift Manifest entry to unreleased
```

**Boundaries:**

- `studio/src/lift/` is pure. No filesystem. No Vite. Unit-testable with plain strings.
- `studio/server/plugins/liftEmitPlugin.ts` is the only place that writes files.
- `studio/server/middleware/lift.ts` is the only place that reads files over HTTP.
- `studio/server/vercel/bundler.ts` change is a small additive read; nothing else in the bundler is touched.
- The one React change is a button inside the existing `ShareModal`. No new modal, no new shell surface.

---

## Task 1: Types and mapping-entry shape

**Files:**
- Create: `studio/src/lift/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// studio/src/lift/types.ts
//
// Pure types for the Lift Manifest subsystem. No imports from "vite",
// "node:fs", or anywhere else with side effects — keep this file importable
// from unit tests, the plugin, the middleware, and the renderer alike.

export type TranslationClass = "mechanical" | "structural" | "judgment";

export interface PropDelta {
  /** Studio prop name. */
  from: string;
  /** Production prop name. Same as `from` when only the value mapping changes. */
  to: string;
  /** Optional mapping from Studio value → production value. */
  valueMap?: Record<string, string>;
  /** Optional free-text note attached to this prop. */
  note?: string;
}

export interface MappingEntry {
  /** What the frame code imports. */
  studio: {
    /** Module specifier, e.g. "arcade", "arcade/components", "arcade-prototypes". */
    source: "arcade" | "arcade/components" | "arcade-prototypes";
    /** Named import, e.g. "Button", "NavSidebar", "VistaPage". */
    name: string;
  };
  /** What the production equivalent is. */
  production: {
    /** Module specifier engineers should import from. */
    source: string;
    /** Exported name in that module. */
    name: string;
  };
  propDeltas: PropDelta[];
  /**
   * Notes about slot/children differences — e.g. Studio's flat children vs.
   * production compound subcomponents. One bullet per line when rendered.
   */
  slotNotes: string[];
  translationClass: TranslationClass;
  /** One-line note surfaced in the manifest when class is "judgment". */
  judgmentNote?: string;
}

export type FrameShape = "list-view" | "settings-form" | "detail" | "ad-hoc";

export interface ScaffoldingItem {
  /** Short label shown in the checklist. */
  label: string;
  /** Path pattern (templated with <entity>, <domain>, etc.) for the engineer. */
  pathPattern?: string;
  /**
   * "required" — engineer must do this
   * "n/a"      — detector knows this shape doesn't need it
   * "done"     — detector inferred this is already present (reserved; unused today)
   */
  status: "required" | "n/a" | "done";
}

export interface FrameImport {
  source: string;
  names: string[];
}

export interface Manifest {
  projectSlug: string;
  frameSlug: string;
  /** Absolute path to the frame's index.tsx on disk. Useful for the agent. */
  frameAbsPath: string;
  intentSummary: string;
  imports: FrameImport[];
  mappings: MappingEntry[];
  /** Entries in `imports` that had no mapping-table match. Surface in the manifest as "unmapped". */
  unmapped: Array<{ source: string; name: string }>;
  shape: FrameShape;
  scaffolding: ScaffoldingItem[];
  figmaUrl?: string;
  screenshotUrl?: string;
  /** Schema version of the emitted manifest. Bump when breaking consumers. */
  schemaVersion: 1;
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `pnpm run studio:test -- --run studio/__tests__/lib/streamJson.test.ts`
Expected: existing tests still pass (proves the types file compiles in the same project).

- [ ] **Step 3: Commit**

```bash
git add studio/src/lift/types.ts
git commit -m "feat(studio/lift): add manifest and mapping-entry types

Pure types module, no I/O. Foundation for the rest of the subsystem."
```

---

## Task 2: Frame import parser

**Files:**
- Create: `studio/src/lift/parseImports.ts`
- Test: `studio/__tests__/lift/parseImports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/parseImports.test.ts
import { describe, it, expect } from "vitest";
import { parseImports } from "../../src/lift/parseImports";

describe("parseImports", () => {
  it("collects named imports grouped by module specifier", () => {
    const src = `
      import React from "react";
      import { Button, Input } from "arcade";
      import { Modal } from "arcade/components";
      import { NavSidebar, VistaPage } from "arcade-prototypes";
      export default function Frame() { return null; }
    `;
    const imports = parseImports(src);
    // React is excluded; only arcade-* specifiers are tracked.
    expect(imports).toEqual([
      { source: "arcade", names: ["Button", "Input"] },
      { source: "arcade/components", names: ["Modal"] },
      { source: "arcade-prototypes", names: ["NavSidebar", "VistaPage"] },
    ]);
  });

  it("merges multiple imports from the same module", () => {
    const src = `
      import { Button } from "arcade";
      import { Input } from "arcade";
    `;
    const imports = parseImports(src);
    expect(imports).toEqual([
      { source: "arcade", names: ["Button", "Input"] },
    ]);
  });

  it("ignores renamed imports by keeping the original name", () => {
    const src = `import { Button as Btn } from "arcade";`;
    const imports = parseImports(src);
    expect(imports).toEqual([{ source: "arcade", names: ["Button"] }]);
  });

  it("returns an empty array when the frame imports nothing from arcade roots", () => {
    const src = `import React from "react"; export default () => null;`;
    expect(parseImports(src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/parseImports.test.ts`
Expected: FAIL with "Cannot find module '../../src/lift/parseImports'"

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/lift/parseImports.ts
//
// Extract named imports from a frame's source text, restricted to the three
// specifier roots generated frames are allowed to use ("arcade",
// "arcade/components", "arcade-prototypes"). Other imports (react, anything
// else) are ignored — they aren't relevant to the lift mapping.
//
// Regex-based: Studio frames are small, and a TypeScript AST parse would
// pull in a heavy dependency we don't need. The grammar is constrained
// because the generator produces a narrow import style.

import type { FrameImport } from "./types";

const ARCADE_SOURCES = new Set(["arcade", "arcade/components", "arcade-prototypes"]);

// Matches: import { A, B as C, D } from "arcade";
// Captures the named-imports clause and the module specifier.
const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g;

export function parseImports(source: string): FrameImport[] {
  const bySource = new Map<string, Set<string>>();
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    const clause = m[1];
    const specifier = m[2];
    if (!ARCADE_SOURCES.has(specifier)) continue;

    const names = clause
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        // "Button as Btn" → "Button". We track the original, not the alias —
        // the mapping table is keyed on the original export.
        const asIdx = part.indexOf(" as ");
        return asIdx === -1 ? part : part.slice(0, asIdx).trim();
      });

    const set = bySource.get(specifier) ?? new Set<string>();
    for (const n of names) set.add(n);
    bySource.set(specifier, set);
  }

  return Array.from(bySource.entries()).map(([source, names]) => ({
    source,
    names: Array.from(names).sort(),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/parseImports.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lift/parseImports.ts studio/__tests__/lift/parseImports.test.ts
git commit -m "feat(studio/lift): parse arcade imports from frame source

Regex-based, restricted to the three generator-allowed specifiers."
```

---

## Task 3: Mapping table — primitives

**Files:**
- Create: `studio/src/lift/mappings/primitives.ts`

> **Note:** This table is hand-curated. Do not generate it from types. An incomplete entry is better than a wrong one — add a `judgment` entry with a note rather than inventing a production equivalent.

- [ ] **Step 1: Create the primitives file with a seed set**

```ts
// studio/src/lift/mappings/primitives.ts
//
// Studio arcade-gen primitive → production raw-design-system equivalents.
// Curated by hand. When arcade-gen or raw-design-system change, update
// entries here; the mapping-coverage test fails loud when a primitive
// exported from arcade-components.tsx has no entry.
//
// Scope: only primitives actually reachable from generated frames. That's
// everything exported from studio/prototype-kit/arcade-components.tsx.
// Not the full arcade-gen API — a frame can't import things arcade-components
// doesn't re-export.

import type { MappingEntry } from "../types";

const PROD_SOURCE = "@devrev-web/design-system/shared/raw-design-system";

export const PRIMITIVE_MAPPINGS: MappingEntry[] = [
  // --- Core controls -----------------------------------------------------
  {
    studio: { source: "arcade", name: "Button" },
    production: { source: PROD_SOURCE, name: "Button" },
    propDeltas: [
      {
        from: "size",
        to: "size",
        valueMap: { md: "M", lg: "L" },
        note: "Studio narrows to md|lg; production accepts S|M|L. A Studio frame never uses sm.",
      },
      {
        from: "variant",
        to: "variant",
        valueMap: {
          primary: "primary",
          secondary: "secondary",
          tertiary: "tertiary",
          destructive: "destructive",
        },
      },
    ],
    slotNotes: [
      "Children are identical. Leading/trailing icons move from raw children to `start` / `end` slots in production.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "IconButton" },
    production: { source: PROD_SOURCE, name: "IconButton" },
    propDeltas: [
      { from: "size", to: "size", valueMap: { md: "M", lg: "L" } },
      { from: "variant", to: "variant" },
    ],
    slotNotes: [
      "Studio injects a numeric `size` prop onto the single icon child via React.cloneElement. Production renders the icon as-is inside a Slot; size is controlled by the IconButton's own size token. Drop the runtime cloning when translating.",
    ],
    translationClass: "structural",
  },
  // --- Inputs ------------------------------------------------------------
  {
    studio: { source: "arcade", name: "Input" },
    production: { source: PROD_SOURCE, name: "TextInput" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onChange" },
      { from: "placeholder", to: "placeholder" },
      {
        from: "disabled",
        to: "modifiers",
        note: "Production moves disabled/readOnly into a `modifiers` prop object: modifiers={{ disabled: true }}.",
      },
    ],
    slotNotes: [
      "Studio exposes `start` / `end` as children-like nodes. Production uses explicit `start` / `end` slot props.",
    ],
    translationClass: "structural",
    judgmentNote: undefined,
  },
  {
    studio: { source: "arcade", name: "Select" },
    production: { source: PROD_SOURCE, name: "SingleSelect" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onValueChange" },
    ],
    slotNotes: [
      "Production uses a compound API: <SingleSelect.Root><SingleSelect.Trigger /><SingleSelect.Options>... Migrate children accordingly.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade", name: "Checkbox" },
    production: { source: PROD_SOURCE, name: "Checkbox" },
    propDeltas: [
      { from: "checked", to: "checked" },
      { from: "onChange", to: "onCheckedChange" },
    ],
    slotNotes: [],
    translationClass: "mechanical",
  },
  // --- Surfaces ----------------------------------------------------------
  {
    studio: { source: "arcade", name: "Modal" },
    production: { source: PROD_SOURCE, name: "Modal" },
    propDeltas: [
      { from: "open", to: "open" },
      { from: "onOpenChange", to: "onOpenChange" },
    ],
    slotNotes: [
      "Both use compound subcomponents. Rename Modal.Root → Modal.Root, Modal.Content → Modal.Content, etc. API shape matches closely; mechanical.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Popover" },
    production: { source: PROD_SOURCE, name: "Popover" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Tabs" },
    production: { source: PROD_SOURCE, name: "TabList" },
    propDeltas: [
      { from: "value", to: "value" },
      { from: "onChange", to: "onValueChange" },
    ],
    slotNotes: ["Production names the component TabList; subcomponent shape is similar."],
    translationClass: "mechanical",
  },
  // --- Misc --------------------------------------------------------------
  {
    studio: { source: "arcade", name: "Badge" },
    production: { source: PROD_SOURCE, name: "Badge" },
    propDeltas: [{ from: "variant", to: "variant" }],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "Tooltip" },
    production: { source: PROD_SOURCE, name: "Tooltip" },
    propDeltas: [{ from: "content", to: "content" }],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade", name: "DevRevThemeProvider" },
    production: { source: PROD_SOURCE, name: "ThemeProvider" },
    propDeltas: [],
    slotNotes: [
      "Production's ThemeProvider takes the arcade theme config via spread: `<ThemeProvider {...arcadeDesignSystemTheme()}>`. Studio's DevRevThemeProvider takes a `mode` prop directly; translation reassembles the theme call.",
    ],
    translationClass: "judgment",
    judgmentNote:
      "Confirm whether the target feature already has a ThemeProvider further up the tree (devrev-web typically wraps at the feature level, not the frame level). Likely remove this wrapper from the translated output.",
  },
];
```

> **Note on coverage:** The list above is a seed covering the common primitives. The mapping-coverage test (Task 7) will fail if there are primitives exported from `arcade-components.tsx` not present here. When it fails, add entries rather than skip the test.

- [ ] **Step 2: Verify the file parses**

Run: `pnpm exec tsc --noEmit -p studio/tsconfig.json 2>&1 | grep primitives.ts || echo "ok"`
Expected: `ok` (no type errors specific to this file).

- [ ] **Step 3: Commit**

```bash
git add studio/src/lift/mappings/primitives.ts
git commit -m "feat(studio/lift): seed primitive mapping entries

Ten core primitives with production equivalents in raw-design-system.
Coverage test (later task) will enforce completeness."
```

---

## Task 4: Mapping table — composites and templates

**Files:**
- Create: `studio/src/lift/mappings/composites.ts`

> **Context for you:** Every composite in `studio/prototype-kit/index.ts` needs an entry. There are 19 composites + 2 templates. Each entry maps to a **production pattern** that engineers already use in `/Users/andrey.sundiev/devrev-web/` — not a composite to add to production. That distinction matters: we map against `Nav`, `Page`, `PageLayout`, `SettingsPage`, `ListViewPage` etc. which already exist.

- [ ] **Step 1: Create the composites mapping file**

```ts
// studio/src/lift/mappings/composites.ts
//
// Studio prototype-kit composite → production pattern.
//
// Each entry maps a Studio composite to the shape an engineer would write
// in devrev-web today. We do NOT ask production to grow new composites;
// we match against existing Tier-2 (design-system) and Tier-3 (shared
// templates) composition patterns:
//
//   AppShell / NavSidebar / TitleBar        → <Page> + <Nav> manual flex
//   VistaPage / VistaHeader / VistaToolbar  → <ListViewPage>
//   SettingsPage / SettingsCard / SettingsRow → <SettingsPage> + <SettingsSection>
//   ChatInput / ChatMessages / ChatEmptyState, CanvasPanel, Computer*
//                                           → judgment (no direct production equivalent)
//
// Judgment entries are the honest answer when no obvious mapping exists.
// The manifest surfaces them verbatim so the engineer decides.

import type { MappingEntry } from "../types";

const PROD_RDS = "@devrev-web/design-system/shared/raw-design-system";
const PROD_PAGES = "@devrev-web/design-system/shared/pages";
const PROD_SETTINGS = "@devrev-web/design-system/shared/settings";
const PROD_LISTVIEW =
  "@devrev-web/part-work-components/shared/ui-components/src/pages/list-view-page";

export const COMPOSITE_MAPPINGS: MappingEntry[] = [
  // --- Layout chrome -----------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "AppShell" },
    production: { source: PROD_RDS, name: "Page" },
    propDeltas: [],
    slotNotes: [
      "AppShell wraps the whole app in a sidebar+content flex layout. In devrev-web, features compose this inline: `<div className=\"flex h-screen\"><aside>{sidebar}</aside><div className=\"flex-1\">{children}</div></div>` alongside <Page>. There is no single-component equivalent. Unroll into inline flex + Page.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "TitleBar" },
    production: { source: PROD_RDS, name: "Page.Header" },
    propDeltas: [],
    slotNotes: [
      "Production pages use Page.Header for the top bar; traffic-lights/window-chrome elements from Studio's TitleBar do not exist in production (they are Studio's own chrome).",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "BreadcrumbBar" },
    production: { source: PROD_RDS, name: "Breadcrumbs" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "PageBody" },
    production: { source: PROD_RDS, name: "Page.Content" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "NavSidebar" },
    production: { source: PROD_RDS, name: "Nav" },
    propDeltas: [],
    slotNotes: [
      "Studio's NavSidebar: <NavSidebar><NavSidebar.Section><NavSidebar.Item/></NavSidebar.Section></NavSidebar>.",
      "Production Nav: <Nav variant=\"primary\"><Nav.Header/><Nav.Content><Nav.List><Nav.SingleSelectItem><Nav.SingleSelectItem.Icon/><Nav.SingleSelectItem.Label/></Nav.SingleSelectItem></Nav.List></Nav.Content><Nav.Footer/></Nav>.",
      "Section → Nav.List. Item → Nav.SingleSelectItem with `selected` prop. Studio's brand header and Computer footer have no production equivalent; typically drop them in the translation.",
    ],
    translationClass: "structural",
  },
  // --- Vista (list-view) family -----------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "VistaPage" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage" },
    propDeltas: [],
    slotNotes: [
      "VistaPage composes AppShell + VistaHeader + VistaToolbar + content. Production wraps these behaviours in ListViewPage: pass tableProps, filterProps, headerProps.",
      "The `primaryAction`, `count`, `toolbarIcons`, `filters` slots from VistaPage map onto headerProps.actions, headerProps.count, toolbarProps.actions, toolbarProps.filters respectively.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaHeader" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage.Header" },
    propDeltas: [],
    slotNotes: [
      "Absorbed into ListViewPage's headerProps when mapped at the page level. Only surface standalone if the frame uses VistaHeader without VistaPage.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaToolbar" },
    production: { source: PROD_LISTVIEW, name: "ListViewPage.Toolbar" },
    propDeltas: [],
    slotNotes: [
      "Same absorption pattern as VistaHeader; standalone use is rare.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaGroupRail" },
    production: { source: PROD_LISTVIEW, name: "GroupRail" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaRow" },
    production: { source: PROD_RDS, name: "Row" },
    propDeltas: [
      {
        from: "stage",
        to: "stage",
        note: "StageTone/PriorityValue enums are Studio-specific; map onto production Badge variants at the call site.",
      },
    ],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "VistaRow encodes specific columns (title, stage, priority, assignee). In devrev-web rows are built per-table via the data-layer + cell components. Decide whether to keep a reusable VistaRow shape or inline cells.",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaFilterPill" },
    production: { source: PROD_RDS, name: "Chip" },
    propDeltas: [],
    slotNotes: [
      "Production uses Chip with a close-button slot; Studio's VistaFilterPill bundles behaviour into one component.",
    ],
    translationClass: "structural",
  },
  {
    studio: { source: "arcade-prototypes", name: "VistaPagination" },
    production: { source: PROD_RDS, name: "Pagination" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  // --- Settings ---------------------------------------------------------
  {
    studio: { source: "arcade-prototypes", name: "SettingsPage" },
    production: { source: PROD_SETTINGS, name: "SettingsPage" },
    propDeltas: [],
    slotNotes: [
      "Production SettingsPage is the exact production template engineers use for settings routes. Near-mechanical at the page level.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "SettingsCard" },
    production: { source: PROD_SETTINGS, name: "SettingsSection" },
    propDeltas: [],
    slotNotes: [
      "Card heading + body → SettingsSection with `title` + children.",
    ],
    translationClass: "mechanical",
  },
  {
    studio: { source: "arcade-prototypes", name: "SettingsRow" },
    production: { source: PROD_SETTINGS, name: "SettingsRow" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "mechanical",
  },
  // --- Computer / Chat / Canvas (no direct production equivalent) -------
  {
    studio: { source: "arcade-prototypes", name: "ComputerHeader" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "ComputerHeader is Studio-specific UI (the 'Computer' app's own title bar). No production equivalent — drop when the frame is being lifted as a product feature, keep if lifting the whole Computer experience.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ComputerSidebar" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "Studio-specific UI (chat sidebar for the Computer app). Treat like ComputerHeader.",
  },
  {
    studio: { source: "arcade-prototypes", name: "CanvasPanel" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "No production equivalent. Decide whether the frame genuinely needs a scratch-canvas pattern; most product features don't.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatInput" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote:
      "Studio provides a chat-input composite. In devrev-web chat inputs live inside specific features (Support, Timeline) and are bespoke. Map against the host feature's input component.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatMessages" },
    production: { source: "n/a", name: "n/a" },
    propDeltas: [],
    slotNotes: [],
    translationClass: "judgment",
    judgmentNote: "Same as ChatInput — bespoke per host feature.",
  },
  {
    studio: { source: "arcade-prototypes", name: "ChatEmptyState" },
    production: { source: PROD_RDS, name: "EmptyState" },
    propDeltas: [],
    slotNotes: [
      "Production EmptyState is the general empty-state component; the 'chat' framing is Studio-specific copy.",
    ],
    translationClass: "mechanical",
  },
];
```

- [ ] **Step 2: Create the barrel**

Create file `studio/src/lift/mappings/index.ts`:

```ts
// studio/src/lift/mappings/index.ts

import type { MappingEntry } from "../types";
import { PRIMITIVE_MAPPINGS } from "./primitives";
import { COMPOSITE_MAPPINGS } from "./composites";

export const ALL_MAPPINGS: MappingEntry[] = [
  ...PRIMITIVE_MAPPINGS,
  ...COMPOSITE_MAPPINGS,
];

export function findMapping(source: string, name: string): MappingEntry | null {
  return (
    ALL_MAPPINGS.find(
      (m) => m.studio.source === source && m.studio.name === name,
    ) ?? null
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm exec tsc --noEmit -p studio/tsconfig.json 2>&1 | grep mappings || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add studio/src/lift/mappings/composites.ts studio/src/lift/mappings/index.ts
git commit -m "feat(studio/lift): map prototype-kit composites to production patterns

Maps against existing Tier-2/3 patterns in devrev-web (Page, Nav,
ListViewPage, SettingsPage). No new composites proposed for production."
```

---

## Task 5: Frame shape detection

**Files:**
- Create: `studio/src/lift/detectShape.ts`
- Test: `studio/__tests__/lift/detectShape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/detectShape.test.ts
import { describe, it, expect } from "vitest";
import { detectShape } from "../../src/lift/detectShape";
import type { FrameImport } from "../../src/lift/types";

describe("detectShape", () => {
  it("returns list-view when the frame imports VistaPage", () => {
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["VistaPage"] },
    ];
    expect(detectShape(imports)).toBe("list-view");
  });

  it("returns settings-form when the frame imports SettingsPage", () => {
    const imports: FrameImport[] = [
      { source: "arcade-prototypes", names: ["SettingsPage"] },
    ];
    expect(detectShape(imports)).toBe("settings-form");
  });

  it("returns detail when the frame uses TitleBar + BreadcrumbBar + PageBody but no template", () => {
    const imports: FrameImport[] = [
      {
        source: "arcade-prototypes",
        names: ["AppShell", "TitleBar", "BreadcrumbBar", "PageBody"],
      },
    ];
    expect(detectShape(imports)).toBe("detail");
  });

  it("returns ad-hoc when no known shape markers are present", () => {
    const imports: FrameImport[] = [
      { source: "arcade", names: ["Button", "Input"] },
    ];
    expect(detectShape(imports)).toBe("ad-hoc");
  });

  it("prefers the most specific marker when multiple could match", () => {
    // VistaPage beats TitleBar+BreadcrumbBar.
    const imports: FrameImport[] = [
      {
        source: "arcade-prototypes",
        names: ["VistaPage", "TitleBar", "BreadcrumbBar"],
      },
    ];
    expect(detectShape(imports)).toBe("list-view");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/detectShape.test.ts`
Expected: FAIL with "Cannot find module '../../src/lift/detectShape'".

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/lift/detectShape.ts
//
// Map a frame's arcade-prototypes imports to a shape name. Switch-statement
// heuristic, not a model call. Ordering matters: check the most specific
// markers (templates) before the general ones (composites).

import type { FrameImport, FrameShape } from "./types";

export function detectShape(imports: FrameImport[]): FrameShape {
  const proto = imports.find((i) => i.source === "arcade-prototypes");
  const names = new Set(proto?.names ?? []);

  if (names.has("VistaPage")) return "list-view";
  if (names.has("SettingsPage")) return "settings-form";

  // Detail-page heuristic: a frame that assembles its own page chrome
  // (TitleBar + BreadcrumbBar + PageBody) is acting like a detail view —
  // even without an explicit template.
  if (names.has("TitleBar") && names.has("BreadcrumbBar") && names.has("PageBody")) {
    return "detail";
  }

  return "ad-hoc";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/detectShape.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lift/detectShape.ts studio/__tests__/lift/detectShape.test.ts
git commit -m "feat(studio/lift): detect frame shape from prototype-kit imports"
```

---

## Task 6: Scaffolding checklist per shape

**Files:**
- Create: `studio/src/lift/scaffolding.ts`
- Test: `studio/__tests__/lift/scaffolding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/scaffolding.test.ts
import { describe, it, expect } from "vitest";
import { scaffoldingFor } from "../../src/lift/scaffolding";

describe("scaffoldingFor", () => {
  it("list-view includes data hook, query keys, route, feature flag, telemetry", () => {
    const items = scaffoldingFor("list-view");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Data-layer hook (useDL<Entity>s list query)");
    expect(labels).toContain("Query keys entry");
    expect(labels).toContain("Stale time entry");
    expect(labels).toContain("Adapter (API list response → UI shape)");
    expect(labels).toContain("Route registration");
    expect(labels).toContain("Feature flag gate (useFeatureFlag)");
    expect(labels).toContain("Event tracker wiring (useEventTracker + track)");
  });

  it("settings-form includes form hook, mutation hook, and the scaffolding that settings skip", () => {
    const items = scaffoldingFor("settings-form");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Data-layer hook (useDL<Entity> mutation)");
    expect(labels).toContain("Form hook (validation + submission)");
    // Settings forms typically don't paginate.
    expect(items.find((i) => i.label === "Query keys entry")?.status).toBe("required");
  });

  it("ad-hoc surfaces the generic checklist with a 'consider a template' note item", () => {
    const items = scaffoldingFor("ad-hoc");
    const labels = items.map((i) => i.label);
    expect(labels).toContain(
      "Consider whether this fits an existing Tier-2/3 template (PageLayout, ListViewPage, SettingsPage)",
    );
  });

  it("every item has a status of required or n/a", () => {
    for (const shape of ["list-view", "settings-form", "detail", "ad-hoc"] as const) {
      for (const item of scaffoldingFor(shape)) {
        expect(["required", "n/a", "done"]).toContain(item.status);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/scaffolding.test.ts`
Expected: FAIL with "Cannot find module '../../src/lift/scaffolding'".

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/lift/scaffolding.ts
//
// Per-shape production scaffolding checklist. Items describe the work a
// Studio frame never covers by itself (data layer, adapters, routing, flags,
// telemetry) and point at devrev-web's conventional paths.
//
// Path patterns use <domain> and <Entity> as placeholders. They are
// surfaced verbatim in the markdown manifest — the engineer fills them in.

import type { FrameShape, ScaffoldingItem } from "./types";

const ITEM_DATA_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity> query)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-<entity>.ts",
  status: "required",
};

const ITEM_DATA_MUTATION_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity> mutation)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-update-<entity>.ts",
  status: "required",
};

const ITEM_LIST_HOOK: ScaffoldingItem = {
  label: "Data-layer hook (useDL<Entity>s list query)",
  pathPattern: "libs/<domain>/shared/data-layer/src/use-<entity>s.ts",
  status: "required",
};

const ITEM_ADAPTER: ScaffoldingItem = {
  label: "Adapter (API response → UI shape)",
  pathPattern: "libs/<domain>/adapters/src/<entity>.ts",
  status: "required",
};

const ITEM_ADAPTER_LIST: ScaffoldingItem = {
  label: "Adapter (API list response → UI shape)",
  pathPattern: "libs/<domain>/adapters/src/<entity>-list.ts",
  status: "required",
};

const ITEM_QUERY_KEYS: ScaffoldingItem = {
  label: "Query keys entry",
  pathPattern: "libs/<domain>/shared/data-layer/src/keys.ts",
  status: "required",
};

const ITEM_STALE_TIME: ScaffoldingItem = {
  label: "Stale time entry",
  pathPattern: "STALE_TIMES_IN_MS.<ENTITY>",
  status: "required",
};

const ITEM_FORM_HOOK: ScaffoldingItem = {
  label: "Form hook (validation + submission)",
  pathPattern: "libs/<domain>/feature/<feature>/src/hooks/use-<feature>-form.ts",
  status: "required",
};

const ITEM_ROUTE: ScaffoldingItem = {
  label: "Route registration",
  pathPattern: "apps/product/dr-router.tsx + libs/micro-apps/main/src/...",
  status: "required",
};

const ITEM_FEATURE_FLAG: ScaffoldingItem = {
  label: "Feature flag gate (useFeatureFlag)",
  status: "required",
};

const ITEM_TELEMETRY: ScaffoldingItem = {
  label: "Event tracker wiring (useEventTracker + track)",
  status: "required",
};

const ITEM_TEMPLATE_CHOICE: ScaffoldingItem = {
  label:
    "Consider whether this fits an existing Tier-2/3 template (PageLayout, ListViewPage, SettingsPage)",
  status: "required",
};

export function scaffoldingFor(shape: FrameShape): ScaffoldingItem[] {
  switch (shape) {
    case "list-view":
      return [
        ITEM_LIST_HOOK,
        ITEM_ADAPTER_LIST,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "settings-form":
      return [
        ITEM_DATA_HOOK,
        ITEM_DATA_MUTATION_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_FORM_HOOK,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "detail":
      return [
        ITEM_DATA_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
    case "ad-hoc":
      return [
        ITEM_TEMPLATE_CHOICE,
        ITEM_DATA_HOOK,
        ITEM_ADAPTER,
        ITEM_QUERY_KEYS,
        ITEM_STALE_TIME,
        ITEM_ROUTE,
        ITEM_FEATURE_FLAG,
        ITEM_TELEMETRY,
      ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/scaffolding.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lift/scaffolding.ts studio/__tests__/lift/scaffolding.test.ts
git commit -m "feat(studio/lift): per-shape production scaffolding checklist"
```

---

## Task 7: Mapping coverage test

**Files:**
- Create: `studio/__tests__/lift/mappingCoverage.test.ts`

> **Why this task exists:** The mapping table is the central asset. If it drifts behind arcade-components.tsx or prototype-kit/index.ts, the manifest is silently incomplete. This test fails loudly when coverage drops.

- [ ] **Step 1: Write the test**

```ts
// studio/__tests__/lift/mappingCoverage.test.ts
//
// Coverage guard: every primitive exported via arcade-components.tsx and
// every composite/template exported by prototype-kit/index.ts MUST have
// a mapping entry. When this test fails, the fix is always to add an
// entry — never to skip, never to delete the export.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_MAPPINGS } from "../../src/lift/mappings";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROTOTYPE_KIT = path.join(REPO_ROOT, "studio", "prototype-kit");

function readExportedNames(indexFile: string): string[] {
  const src = fs.readFileSync(indexFile, "utf-8");
  const names = new Set<string>();

  // Matches: export { A, B as C } from "..."
  const reNamedReexport = /export\s*\{([^}]+)\}\s*from\s*["'][^"']+["']\s*;?/g;
  let m: RegExpExecArray | null;
  while ((m = reNamedReexport.exec(src)) !== null) {
    for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue;
      const asIdx = raw.indexOf(" as ");
      const exported = asIdx === -1 ? raw : raw.slice(asIdx + 4).trim();
      names.add(exported);
    }
  }

  // Matches: export const Foo = ..., export function Foo, etc.
  const reDecl = /export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)/g;
  while ((m = reDecl.exec(src)) !== null) names.add(m[1]);

  // Matches: export { Foo } (local re-export)
  const reLocalReexport = /export\s*\{([^}]+)\}\s*;?/g;
  while ((m = reLocalReexport.exec(src)) !== null) {
    for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue;
      const asIdx = raw.indexOf(" as ");
      names.add(asIdx === -1 ? raw : raw.slice(asIdx + 4).trim());
    }
  }

  return Array.from(names);
}

describe("mapping-table coverage", () => {
  it("covers every composite/template exported by prototype-kit/index.ts", () => {
    const indexFile = path.join(PROTOTYPE_KIT, "index.ts");
    const exported = readExportedNames(indexFile)
      .filter((n) => n !== "default" && !/^[a-z]/.test(n));

    const mapped = new Set(
      ALL_MAPPINGS
        .filter((m) => m.studio.source === "arcade-prototypes")
        .map((m) => m.studio.name),
    );

    const missing = exported.filter((n) => !mapped.has(n));
    expect(missing, `Unmapped prototype-kit exports: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers the primitives arcade-components.tsx re-exports directly by name", () => {
    // arcade-components.tsx does `export * from "@xorkavi/arcade-gen"` plus
    // explicit named overrides (Button, IconButton). We enumerate the
    // primitive names actually referenced by composites/templates — that's
    // the reachable surface. See composites for the list.
    const reachable = new Set<string>();
    const kitDir = path.join(PROTOTYPE_KIT, "composites");
    for (const f of fs.readdirSync(kitDir)) {
      if (!f.endsWith(".tsx")) continue;
      const src = fs.readFileSync(path.join(kitDir, f), "utf-8");
      // Collect names imported from "@xorkavi/arcade-gen" OR "arcade".
      const re = /import\s*\{([^}]+)\}\s*from\s*["'](?:@xorkavi\/arcade-gen|arcade|arcade\/components)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (raw.startsWith("type ")) continue;
          const asIdx = raw.indexOf(" as ");
          const name = asIdx === -1 ? raw : raw.slice(0, asIdx).trim();
          // Icons are out of scope for the primitive mapping table — each
          // icon would be a trivial entry and they translate 1:1.
          if (/Icon$|Small$|Medium$|Large$/.test(name)) continue;
          reachable.add(name);
        }
      }
    }

    const mappedPrimitives = new Set(
      ALL_MAPPINGS
        .filter((m) => m.studio.source === "arcade" || m.studio.source === "arcade/components")
        .map((m) => m.studio.name),
    );

    const missing = Array.from(reachable).filter((n) => !mappedPrimitives.has(n));
    expect(missing, `Unmapped primitives reachable from composites: ${missing.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/mappingCoverage.test.ts`

Expected: either PASS, or FAIL with a concrete list of names to add to the mapping table. **If it fails, fix by adding entries** (not by skipping the test). Add a `judgment` entry with a `judgmentNote` when no production equivalent exists. Re-run until green.

- [ ] **Step 3: Commit** (including whatever mapping entries were needed)

```bash
git add studio/__tests__/lift/mappingCoverage.test.ts studio/src/lift/mappings/
git commit -m "test(studio/lift): enforce mapping-table coverage

Fails when prototype-kit or arcade-gen evolve without a corresponding
mapping entry."
```

---

## Task 8: buildManifest — the assembly function

**Files:**
- Create: `studio/src/lift/buildManifest.ts`
- Test: `studio/__tests__/lift/buildManifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/buildManifest.test.ts
import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";

const LIST_FRAME = `
import { VistaPage, VistaFilterPill, VistaPagination } from "arcade-prototypes";
import { Button } from "arcade";

export default function Frame() {
  return <VistaPage title="Tickets" />;
}
`;

describe("buildManifest", () => {
  it("assembles a manifest for a list-view frame", () => {
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "tickets",
      frameAbsPath: "/abs/path/index.tsx",
      frameSource: LIST_FRAME,
      intentSummary: "List of all tickets.",
      figmaUrl: undefined,
      screenshotUrl: undefined,
    });

    expect(m.projectSlug).toBe("p");
    expect(m.frameSlug).toBe("tickets");
    expect(m.shape).toBe("list-view");
    expect(m.imports.map((i) => i.source).sort()).toEqual([
      "arcade",
      "arcade-prototypes",
    ]);
    expect(m.mappings.length).toBeGreaterThan(0);
    expect(m.schemaVersion).toBe(1);
  });

  it("populates unmapped[] for imports with no mapping entry", () => {
    const src = `import { TotallyMadeUpComponent } from "arcade";`;
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/x/index.tsx",
      frameSource: src,
      intentSummary: "",
    });
    expect(m.unmapped).toEqual([
      { source: "arcade", name: "TotallyMadeUpComponent" },
    ]);
  });

  it("uses ad-hoc shape when no prototype-kit template is imported", () => {
    const src = `import { Button } from "arcade";`;
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/x/index.tsx",
      frameSource: src,
      intentSummary: "",
    });
    expect(m.shape).toBe("ad-hoc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/buildManifest.test.ts`
Expected: FAIL with "Cannot find module '../../src/lift/buildManifest'".

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/lift/buildManifest.ts
//
// Pure assembly of a Manifest. Takes frame source text + metadata; returns
// a fully-populated Manifest. No I/O. The plugin and middleware call this
// after reading files from disk.

import { parseImports } from "./parseImports";
import { detectShape } from "./detectShape";
import { scaffoldingFor } from "./scaffolding";
import { ALL_MAPPINGS, findMapping } from "./mappings";
import type { Manifest, MappingEntry } from "./types";

export interface BuildManifestInput {
  projectSlug: string;
  frameSlug: string;
  frameAbsPath: string;
  frameSource: string;
  intentSummary: string;
  figmaUrl?: string;
  screenshotUrl?: string;
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const imports = parseImports(input.frameSource);
  const shape = detectShape(imports);
  const scaffolding = scaffoldingFor(shape);

  const mappings: MappingEntry[] = [];
  const unmapped: Array<{ source: string; name: string }> = [];
  for (const imp of imports) {
    for (const name of imp.names) {
      const entry = findMapping(imp.source, name);
      if (entry) mappings.push(entry);
      else unmapped.push({ source: imp.source, name });
    }
  }

  return {
    projectSlug: input.projectSlug,
    frameSlug: input.frameSlug,
    frameAbsPath: input.frameAbsPath,
    intentSummary: input.intentSummary,
    imports,
    mappings,
    unmapped,
    shape,
    scaffolding,
    figmaUrl: input.figmaUrl,
    screenshotUrl: input.screenshotUrl,
    schemaVersion: 1,
  };
}

// Re-export so consumers can do `import { ALL_MAPPINGS } from ".../buildManifest"` if convenient.
export { ALL_MAPPINGS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/buildManifest.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lift/buildManifest.ts studio/__tests__/lift/buildManifest.test.ts
git commit -m "feat(studio/lift): assemble Manifest from frame source and metadata"
```

---

## Task 9: Renderer — Markdown

**Files:**
- Create: `studio/src/lift/render.ts`
- Test: `studio/__tests__/lift/renderMarkdown.snapshot.test.ts`
- Test: `studio/__tests__/lift/renderJson.snapshot.test.ts`
- Test fixtures: `studio/__tests__/lift/fixtures/*.tsx`

- [ ] **Step 1: Create fixtures**

Create `studio/__tests__/lift/fixtures/list-frame.tsx`:

```tsx
import { VistaPage, VistaFilterPill, VistaPagination } from "arcade-prototypes";
import { Button, Input } from "arcade";

export default function TicketsFrame() {
  return (
    <VistaPage title="Tickets" primaryAction={<Button>New</Button>} filters={<VistaFilterPill label="Open" />}>
      <Input placeholder="Search" />
      <VistaPagination total={42} />
    </VistaPage>
  );
}
```

Create `studio/__tests__/lift/fixtures/settings-frame.tsx`:

```tsx
import { SettingsPage, SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Button } from "arcade";

export default function ProfileSettings() {
  return (
    <SettingsPage title="Profile">
      <SettingsCard title="Basics">
        <SettingsRow label="Name"><Input value="Alice" onChange={() => {}} /></SettingsRow>
      </SettingsCard>
      <Button variant="primary">Save</Button>
    </SettingsPage>
  );
}
```

Create `studio/__tests__/lift/fixtures/detail-frame.tsx`:

```tsx
import { AppShell, TitleBar, BreadcrumbBar, PageBody } from "arcade-prototypes";
import { Tabs, Button } from "arcade";

export default function TicketDetail() {
  return (
    <AppShell sidebar={<div />}>
      <TitleBar title="TKT-42" />
      <BreadcrumbBar />
      <PageBody>
        <Tabs value="overview" onChange={() => {}} />
        <Button>Resolve</Button>
      </PageBody>
    </AppShell>
  );
}
```

Create `studio/__tests__/lift/fixtures/adhoc-frame.tsx`:

```tsx
import { Button, Modal } from "arcade";

export default function Adhoc() {
  return <Modal open><Button>Close</Button></Modal>;
}
```

- [ ] **Step 2: Write the markdown snapshot test**

```ts
// studio/__tests__/lift/renderMarkdown.snapshot.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderMarkdown } from "../../src/lift/render";

const FIXTURES = path.join(__dirname, "fixtures");

function snap(name: string, intent: string) {
  const source = fs.readFileSync(path.join(FIXTURES, name), "utf-8");
  const manifest = buildManifest({
    projectSlug: "demo",
    frameSlug: name.replace(".tsx", ""),
    frameAbsPath: `/abs/${name}`,
    frameSource: source,
    intentSummary: intent,
    figmaUrl: "https://figma.com/file/xyz",
    screenshotUrl: "/api/projects/demo/thumbnails/" + name.replace(".tsx", "") + ".png",
  });
  return renderMarkdown(manifest);
}

describe("renderMarkdown", () => {
  it("renders a list-view frame", () => {
    expect(snap("list-frame.tsx", "List of tickets with filters and pagination.")).toMatchSnapshot();
  });

  it("renders a settings-form frame", () => {
    expect(snap("settings-frame.tsx", "Profile settings form.")).toMatchSnapshot();
  });

  it("renders a detail frame", () => {
    expect(snap("detail-frame.tsx", "Ticket detail with tabs.")).toMatchSnapshot();
  });

  it("renders an ad-hoc frame", () => {
    expect(snap("adhoc-frame.tsx", "Confirmation modal.")).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run test to verify it fails (missing module)**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/renderMarkdown.snapshot.test.ts`
Expected: FAIL with "Cannot find module '../../src/lift/render'".

- [ ] **Step 4: Write the renderer**

```ts
// studio/src/lift/render.ts
//
// Render a Manifest to (a) markdown for humans and LLM prompt consumption
// and (b) JSON for programmatic consumers. Both are pure string output —
// no I/O. Sections are in the order defined in the design spec §4.2.

import type { Manifest, MappingEntry, ScaffoldingItem } from "./types";

export function renderMarkdown(m: Manifest): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# Lift Manifest — ${m.projectSlug}/${m.frameSlug}`);
  push("");
  push(`> Generated by Arcade Studio. Schema version ${m.schemaVersion}. Frame on disk: \`${m.frameAbsPath}\``);
  push("");

  // 1. Intent summary
  push("## Intent");
  push(m.intentSummary || "_(no prompt recorded — intent is implicit from frame code.)_");
  push("");

  // 2. Frame inventory
  push("## Frame inventory");
  if (m.mappings.length === 0 && m.unmapped.length === 0) {
    push("_(Frame imports nothing from arcade roots.)_");
  } else {
    push("| Studio import | Production equivalent | Class | Notes |");
    push("| --- | --- | --- | --- |");
    for (const entry of m.mappings) {
      push(renderMappingRow(entry));
    }
    for (const u of m.unmapped) {
      push(
        `| \`${u.name}\` from \`${u.source}\` | _unmapped_ | judgment | No mapping entry — surface to reviewer; add to mapping table after lift. |`,
      );
    }
  }
  push("");

  // 3. Composite mapping details
  const compositesUsed = m.mappings.filter((e) => e.studio.source === "arcade-prototypes");
  if (compositesUsed.length > 0) {
    push("## Composite mapping details");
    for (const e of compositesUsed) {
      push(`### ${e.studio.name} → ${e.production.name}`);
      if (e.slotNotes.length === 0) {
        push("- _(no structural notes.)_");
      } else {
        for (const n of e.slotNotes) push(`- ${n}`);
      }
      if (e.judgmentNote) push(`- **Judgment:** ${e.judgmentNote}`);
      push("");
    }
  }

  // 4. Token alignment
  push("## Tokens");
  push("Tokens are aligned between arcade-gen and arcade-theme. CSS custom property names carry across. No token remap is required.");
  push("");

  // 5. Scaffolding checklist
  push(`## Production scaffolding (${m.shape})`);
  push("These are the things a Studio frame never covers by itself. Engineer + agent divide between them.");
  push("");
  for (const it of m.scaffolding) {
    const box = it.status === "done" ? "[x]" : it.status === "n/a" ? "[~]" : "[ ]";
    const path = it.pathPattern ? ` — \`${it.pathPattern}\`` : "";
    push(`- ${box} ${it.label}${path}`);
  }
  push("");

  // 6 / 7. Grounding links
  if (m.figmaUrl || m.screenshotUrl) {
    push("## Grounding");
    if (m.figmaUrl) push(`- Figma: ${m.figmaUrl}`);
    if (m.screenshotUrl) push(`- Screenshot: ${m.screenshotUrl}`);
    push("");
  }

  // 8. Agent prompt snippet
  push("## Agent handoff");
  push("Paste the block below into a Claude Code session opened in the `devrev-web` checkout:");
  push("");
  push("```text");
  push(
    `I'm lifting an Arcade Studio frame into devrev-web. Apply MECHANICAL rewrites directly. ` +
      `For STRUCTURAL rewrites, write the new production shape and leave brief comments explaining ` +
      `what changed. For JUDGMENT entries, leave a // TODO: comment with the judgment note and ask ` +
      `me before deciding. Do NOT invent production equivalents for unmapped imports — surface them.\n\n` +
      `Manifest follows.\n\n---\n` +
      `Project/frame: ${m.projectSlug}/${m.frameSlug}\n` +
      `Shape: ${m.shape}\n` +
      `Frame source on disk (Studio user's machine): ${m.frameAbsPath}`,
  );
  push("```");
  push("");

  return lines.join("\n");
}

function renderMappingRow(e: MappingEntry): string {
  const studio = `\`${e.studio.name}\` from \`${e.studio.source}\``;
  const prod =
    e.production.source === "n/a"
      ? "_no direct equivalent_"
      : `\`${e.production.name}\` from \`${e.production.source}\``;
  const notes: string[] = [];
  for (const d of e.propDeltas) {
    if (d.valueMap) {
      const vm = Object.entries(d.valueMap)
        .map(([k, v]) => `${k}→${v}`)
        .join(", ");
      notes.push(`prop \`${d.from}\`: ${vm}`);
    } else if (d.from !== d.to) {
      notes.push(`prop \`${d.from}\`→\`${d.to}\``);
    }
    if (d.note) notes.push(d.note);
  }
  if (e.slotNotes.length > 0) notes.push(`see composite mapping details`);
  if (e.judgmentNote) notes.push(e.judgmentNote);
  const notesText = notes.length === 0 ? "—" : notes.join("; ").replace(/\|/g, "\\|");
  return `| ${studio} | ${prod} | ${e.translationClass} | ${notesText} |`;
}

export function renderJson(m: Manifest): string {
  return JSON.stringify(m, null, 2);
}
```

- [ ] **Step 5: Run markdown tests, accept the snapshots**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/renderMarkdown.snapshot.test.ts`

First run: snapshots are created (Vitest writes them). Expected: PASS (4 passing, 4 snapshots written).

Inspect the written snapshots at `studio/__tests__/lift/__snapshots__/renderMarkdown.snapshot.test.ts.snap`. They should look like real manifests (headings, table, scaffolding checklist, agent-prompt block). If any section looks wrong, fix `render.ts` and re-run; Vitest will mark snapshots stale and you'll need to pass `-u` to update.

- [ ] **Step 6: Write and run the JSON snapshot test**

Create `studio/__tests__/lift/renderJson.snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderJson } from "../../src/lift/render";

const FIXTURES = path.join(__dirname, "fixtures");

describe("renderJson", () => {
  it("is valid JSON and round-trips", () => {
    const source = fs.readFileSync(path.join(FIXTURES, "list-frame.tsx"), "utf-8");
    const manifest = buildManifest({
      projectSlug: "demo",
      frameSlug: "list",
      frameAbsPath: "/abs/list.tsx",
      frameSource: source,
      intentSummary: "list",
    });
    const raw = renderJson(manifest);
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.shape).toBe("list-view");
    expect(parsed.frameSlug).toBe("list");
  });
});
```

Run: `pnpm run studio:test -- --run studio/__tests__/lift/renderJson.snapshot.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/src/lift/render.ts studio/__tests__/lift/fixtures studio/__tests__/lift/renderMarkdown.snapshot.test.ts studio/__tests__/lift/renderJson.snapshot.test.ts studio/__tests__/lift/__snapshots__
git commit -m "feat(studio/lift): render manifest as markdown and JSON

Snapshot-tested across list, settings, detail, and ad-hoc fixtures."
```

---

## Task 10: liftEmitPlugin — write LIFT.md and LIFT.json on frame change

**Files:**
- Create: `studio/server/plugins/liftEmitPlugin.ts`
- Modify: `studio/vite.config.ts` (register the plugin)
- Test: `studio/__tests__/lift/liftEmitPlugin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/liftEmitPlugin.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitLiftForFrame } from "../../server/plugins/liftEmitPlugin";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-lift-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(
    path.join(frameDir, "index.tsx"),
    `import { VistaPage } from "arcade-prototypes";\nexport default () => <VistaPage title="x" />;`,
  );
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("emitLiftForFrame", () => {
  it("writes LIFT.md and LIFT.json next to index.tsx", async () => {
    await emitLiftForFrame("p", "hello");
    const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
    expect(fs.existsSync(path.join(frameDir, "LIFT.md"))).toBe(true);
    expect(fs.existsSync(path.join(frameDir, "LIFT.json"))).toBe(true);

    const md = fs.readFileSync(path.join(frameDir, "LIFT.md"), "utf-8");
    expect(md).toContain("# Lift Manifest — p/hello");
    expect(md).toContain("list-view");

    const json = JSON.parse(fs.readFileSync(path.join(frameDir, "LIFT.json"), "utf-8"));
    expect(json.schemaVersion).toBe(1);
    expect(json.shape).toBe("list-view");
  });

  it("is a no-op when the frame file is missing", async () => {
    await expect(emitLiftForFrame("p", "does-not-exist")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/liftEmitPlugin.test.ts`
Expected: FAIL with "Cannot find module '../../server/plugins/liftEmitPlugin'".

- [ ] **Step 3: Write the plugin**

```ts
// studio/server/plugins/liftEmitPlugin.ts
//
// Watches each project's frames directory. Whenever a frame's index.tsx
// changes, regenerate LIFT.md and LIFT.json next to it.
//
// We piggyback on chokidar directly (same pattern as projectWatchPlugin).
// The actual regeneration is an exported async function so tests can
// invoke it without a real Vite server.

import type { Plugin } from "vite";
import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir, projectsRoot, chatHistoryPath } from "../paths";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderJson, renderMarkdown } from "../../src/lift/render";
import type { ChatMessage } from "../types";

async function readFirstUserPrompt(slug: string): Promise<string> {
  try {
    const raw = await fs.readFile(chatHistoryPath(slug), "utf-8");
    const messages = JSON.parse(raw) as ChatMessage[];
    const first = messages.find((m) => m.role === "user" && typeof m.content === "string");
    if (!first) return "";
    // Keep the summary short — 2-4 sentences' worth.
    const text = (first.content as string).trim();
    return text.length > 400 ? text.slice(0, 400) + "…" : text;
  } catch {
    return "";
  }
}

export async function emitLiftForFrame(slug: string, frame: string): Promise<void> {
  const fPath = path.join(frameDir(slug, frame), "index.tsx");
  let source: string;
  try {
    source = await fs.readFile(fPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  const intent = await readFirstUserPrompt(slug);
  const manifest = buildManifest({
    projectSlug: slug,
    frameSlug: frame,
    frameAbsPath: fPath,
    frameSource: source,
    intentSummary: intent,
    figmaUrl: undefined,
    screenshotUrl: `/api/projects/${slug}/thumbnails/${frame}.png`,
  });

  const dir = path.dirname(fPath);
  await fs.writeFile(path.join(dir, "LIFT.md"), renderMarkdown(manifest));
  await fs.writeFile(path.join(dir, "LIFT.json"), renderJson(manifest));
}

function parseFrameTouched(filePath: string): { slug: string; frame: string } | null {
  const rel = path.relative(projectsRoot(), filePath);
  const parts = rel.split(path.sep);
  // Shape: <slug>/frames/<frame>/index.tsx
  if (parts.length < 4) return null;
  if (parts[1] !== "frames") return null;
  if (parts[3] !== "index.tsx") return null;
  return { slug: parts[0], frame: parts[2] };
}

export function liftEmitPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  return {
    name: "arcade-studio-lift-emit",
    configureServer() {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", async (_event, filePath) => {
        const parsed = parseFrameTouched(filePath);
        if (!parsed) return;
        try {
          await emitLiftForFrame(parsed.slug, parsed.frame);
        } catch (err) {
          console.warn(`[liftEmitPlugin] failed for ${parsed.slug}/${parsed.frame}:`, err);
        }
      });
    },
    async closeBundle() { await watcher?.close(); },
  };
}
```

- [ ] **Step 4: Register in Vite config**

Open `studio/vite.config.ts`. Add import and register in the plugins array alongside `projectWatchPlugin()`.

```ts
// studio/vite.config.ts — add the import near the existing plugin imports:
import { liftEmitPlugin } from "./server/plugins/liftEmitPlugin";
```

```ts
// Modify the plugins array to include liftEmitPlugin() after projectWatchPlugin():
plugins: [injectStudioSourcePlugin(), kitManifestPlugin(), react(), tailwindcss(), frameMountPlugin(), projectWatchPlugin(), liftEmitPlugin(), apiPlugin()],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/liftEmitPlugin.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Smoke test the dev server boot**

Run `pnpm run studio` briefly (kill with Ctrl-C after a few seconds). Expected: no new warnings about the lift plugin in the boot log; vite.config type-checks.

- [ ] **Step 7: Commit**

```bash
git add studio/server/plugins/liftEmitPlugin.ts studio/vite.config.ts studio/__tests__/lift/liftEmitPlugin.test.ts
git commit -m "feat(studio/lift): vite plugin emits LIFT.md and LIFT.json on frame change"
```

---

## Task 11: liftMiddleware — serve manifests over HTTP

**Files:**
- Create: `studio/server/middleware/lift.ts`
- Modify: `studio/vite.config.ts` (register middleware)
- Test: `studio/__tests__/lift/liftMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lift/liftMiddleware.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { liftMiddleware } from "../../server/middleware/lift";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-liftmw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "LIFT.md"), "# Lift Manifest — p/hello\n");
  fs.writeFileSync(path.join(frameDir, "LIFT.json"), '{"schemaVersion":1}\n');
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("liftMiddleware", () => {
  it("serves LIFT.md at /api/projects/:slug/lift/:frame.md", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.md`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(text).toContain("# Lift Manifest — p/hello");
    await server.close();
  });

  it("serves LIFT.json at /api/projects/:slug/lift/:frame.json", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.json`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(json.schemaVersion).toBe(1);
    await server.close();
  });

  it("returns 404 when the manifest is missing", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/missing.md`);
    expect(res.status).toBe(404);
    await server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/liftMiddleware.test.ts`
Expected: FAIL with "Cannot find module '../../server/middleware/lift'".

- [ ] **Step 3: Write the middleware**

```ts
// studio/server/middleware/lift.ts
//
// Serves LIFT.md and LIFT.json that liftEmitPlugin writes next to each
// frame. Read-only; the plugin is the source of truth. Routes:
//
//   GET /api/projects/:slug/lift/:frame.md
//   GET /api/projects/:slug/lift/:frame.json

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";

function send(res: ServerResponse, status: number, body: string, contentType: string) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

export function liftMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    const m = url.match(/^\/api\/projects\/([a-z0-9-]+)\/lift\/([a-z0-9-]+)\.(md|json)(?:\?.*)?$/);
    if (!m || req.method !== "GET") return next?.();

    const [, slug, frame, ext] = m;
    const file = path.join(frameDir(slug, frame), ext === "md" ? "LIFT.md" : "LIFT.json");
    try {
      const body = await fs.readFile(file, "utf-8");
      const contentType = ext === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8";
      return send(res, 200, body, contentType);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return send(
          res,
          404,
          JSON.stringify({ error: { code: "not_found", message: "Manifest not found" } }),
          "application/json",
        );
      }
      return send(
        res,
        500,
        JSON.stringify({ error: { code: "read_failed", message: err.message } }),
        "application/json",
      );
    }
  };
}
```

- [ ] **Step 4: Register the middleware in vite.config.ts**

Add to the imports block:

```ts
import { liftMiddleware } from "./server/middleware/lift";
```

Add to the `apiPlugin()` `configureServer` block, alongside the other middlewares (place after `thumbnailsMiddleware()` for locality):

```ts
server.middlewares.use(thumbnailsMiddleware());
server.middlewares.use(liftMiddleware());       // ← new line
server.middlewares.use(preflightMiddleware());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/liftMiddleware.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/lift.ts studio/vite.config.ts studio/__tests__/lift/liftMiddleware.test.ts
git commit -m "feat(studio/lift): serve LIFT.md and LIFT.json via /api/projects/:slug/lift/:frame.(md|json)"
```

---

## Task 12: Vercel bundler — include manifest files in share bundles

**Files:**
- Modify: `studio/server/vercel/bundler.ts`
- Modify: `studio/server/middleware/vercel.ts`
- Test: add an assertion to `studio/__tests__/server/vercel/bundler.test.ts`

- [ ] **Step 1: Update bundler return type**

In `studio/server/vercel/bundler.ts`, expand the `buildFrameBundle` return type to include the lift files:

```ts
// Replace the existing return-type annotation on buildFrameBundle:
export async function buildFrameBundle(ctx: BuildContext): Promise<{
  html: string;
  js: string;
  css: string;
  liftMd?: string;
  liftJson?: string;
}> {
```

At the end of the function, just before `return { html, js, css }`, add a best-effort read of the LIFT files that `liftEmitPlugin` wrote next to the frame:

```ts
// Read the manifest files emitted by liftEmitPlugin (best effort —
// a missing manifest is fine; the deployment still works without it).
let liftMd: string | undefined;
let liftJson: string | undefined;
try { liftMd = await fs.readFile(path.join(ctx.framePath, "LIFT.md"), "utf-8"); } catch {}
try { liftJson = await fs.readFile(path.join(ctx.framePath, "LIFT.json"), "utf-8"); } catch {}

await fs.rm(tempDir, { recursive: true, force: true });

return { html, js, css, liftMd, liftJson };
```

> Remove the existing `await fs.rm(tempDir, ...)` + `return { html, js, css }` pair that this block replaces.

- [ ] **Step 2: Ship manifest files with the deployment**

In `studio/server/middleware/vercel.ts`, the `deployToVercel` call includes a `files` array. Append entries for the manifest when present:

```ts
// Inside vercelMiddleware's handler, just before the existing deployToVercel call:
const files: Array<{ file: string; data: string }> = [
  { file: "index.html", data: bundle.html },
  { file: "assets/bundle.js", data: bundle.js },
  { file: "assets/bundle.css", data: bundle.css },
];
if (bundle.liftMd) files.push({ file: `lift/${frameSlug}.md`, data: bundle.liftMd });
if (bundle.liftJson) files.push({ file: `lift/${frameSlug}.json`, data: bundle.liftJson });

const deployment = await deployToVercel({
  name: projectName,
  files,
  token: vercelToken,
  teamId: settings.vercel?.teamId,
});
```

Delete the old inline `files: [...]` literal from the deploy call.

- [ ] **Step 3: Update the bundler test**

Add a test inside `studio/__tests__/server/vercel/bundler.test.ts` (append a new `it(...)` to the existing `describe` block):

```ts
it("includes LIFT.md and LIFT.json in the bundle output when present", async () => {
  const studioRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundler-lift-"));
  const frameDir = path.join(studioRootTmp, "frame");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "index.tsx"), "export default () => null;\n");
  fs.writeFileSync(path.join(frameDir, "LIFT.md"), "# Manifest");
  fs.writeFileSync(path.join(frameDir, "LIFT.json"), '{"schemaVersion":1}');
  process.env.ARCADE_STUDIO_ROOT = studioRootTmp;

  try {
    const { buildFrameBundle } = await import("../../../server/vercel/bundler");
    const result = await buildFrameBundle({
      projectSlug: "p",
      frameSlug: "f",
      framePath: frameDir,
      theme: "arcade",
      mode: "light",
    });
    expect(result.liftMd).toBe("# Manifest");
    expect(JSON.parse(result.liftJson!).schemaVersion).toBe(1);
  } finally {
    delete process.env.ARCADE_STUDIO_ROOT;
    fs.rmSync(studioRootTmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run test**

Run: `pnpm run studio:test -- --run studio/__tests__/server/vercel/bundler.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add studio/server/vercel/bundler.ts studio/server/middleware/vercel.ts studio/__tests__/server/vercel/bundler.test.ts
git commit -m "feat(studio/share): include LIFT.md/LIFT.json in Vercel share bundles

Engineers can grab a frame's manifest from the shared URL at
/lift/<frame>.md without needing Studio installed."
```

---

## Task 13: ShareModal — "Copy Lift Manifest" action

**Files:**
- Modify: `studio/src/components/shell/ShareModal.tsx`
- Test: `studio/__tests__/lift/shareModalLiftButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/lift/shareModalLiftButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ShareModal } from "../../src/components/shell/ShareModal";
import type { Frame } from "../../server/types";

// arcade-gen is mocked throughout the suite; keep that consistent here.
vi.mock("@xorkavi/arcade-gen", () => ({
  Modal: {
    Root: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    Content: ({ children }: any) => <div>{children}</div>,
    Header: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <h2>{children}</h2>,
    Description: ({ children }: any) => <p>{children}</p>,
    Body: ({ children }: any) => <div>{children}</div>,
    Footer: ({ children }: any) => <div>{children}</div>,
  },
  Button: ({ children, onClick, disabled, variant }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>
  ),
}));

const frames: Frame[] = [
  { slug: "hello", name: "Hello", size: "1440", createdAt: new Date().toISOString() },
];

describe("ShareModal — Copy Lift Manifest", () => {
  beforeEach(() => {
    // Mock clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Lift Manifest — demo/hello",
    }) as any;
  });

  it("renders a Copy Lift Manifest button when a frame is selected", () => {
    render(<ShareModal open={true} onClose={() => {}} projectSlug="demo" frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: /Hello/ }));
    expect(screen.getByRole("button", { name: /Copy Lift Manifest/i })).toBeInTheDocument();
  });

  it("fetches the manifest and writes to clipboard on click", async () => {
    render(<ShareModal open={true} onClose={() => {}} projectSlug="demo" frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: /Hello/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy Lift Manifest/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/projects/demo/lift/hello.md");
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "# Lift Manifest — demo/hello",
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/shareModalLiftButton.test.tsx`
Expected: FAIL — the button doesn't exist yet.

- [ ] **Step 3: Modify ShareModal**

Edit `studio/src/components/shell/ShareModal.tsx`. Inside the Modal.Footer for the non-deployed branch (the `else` of `shareUrl ?`), keep the existing "Cancel" and "Deploy to Vercel" buttons, and add the new "Copy Lift Manifest" button between them. Also add state to track copied-manifest status.

At the top of the component (after the existing useState calls), add:

```ts
const [manifestCopied, setManifestCopied] = useState(false);

async function handleCopyManifest() {
  if (!selectedFrame) return;
  try {
    const res = await fetch(`/api/projects/${projectSlug}/lift/${selectedFrame}.md`);
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    setManifestCopied(true);
    setTimeout(() => setManifestCopied(false), 2000);
  } catch (err: any) {
    setError(err.message);
  }
}
```

In the footer's non-deployed branch, update the buttons:

```tsx
<>
  <Button variant="secondary" onClick={handleClose}>
    Cancel
  </Button>
  <Button
    variant="secondary"
    onClick={handleCopyManifest}
    disabled={!selectedFrame || loading || frames.length === 0}
  >
    {manifestCopied ? "Copied!" : "Copy Lift Manifest"}
  </Button>
  <Button
    variant="primary"
    onClick={handleDeploy}
    disabled={!selectedFrame || loading || frames.length === 0}
  >
    {loading ? "Deploying…" : "Deploy to Vercel"}
  </Button>
</>
```

Also reset `manifestCopied` inside `handleClose`:

```ts
function handleClose() {
  setSelectedFrame(null);
  setShareUrl(null);
  setError(null);
  setCopied(false);
  setManifestCopied(false);
  onClose();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test -- --run studio/__tests__/lift/shareModalLiftButton.test.tsx`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/shell/ShareModal.tsx studio/__tests__/lift/shareModalLiftButton.test.tsx
git commit -m "feat(studio/share): Copy Lift Manifest button in Share modal

Fetches /api/projects/:slug/lift/:frame.md and writes to clipboard."
```

---

## Task 14: Changelog + full-suite guard

**Files:**
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Add a changelog entry**

Open `studio/CHANGELOG.md`. Add a new section at the top (under the existing keep-a-changelog header). Use today's date (2026-05-04) and a version bump approach consistent with the file's existing pattern; check the most recent entry for conventions.

Representative block (adapt version to match the project's current cadence):

```markdown
## [Unreleased]

### Added
- Lift Manifest: every frame now gets a `LIFT.md` and `LIFT.json` next to
  its source, plus a "Copy Lift Manifest" button in the Share modal. The
  manifest maps arcade-gen imports to their production `raw-design-system`
  equivalents and flags the data-layer / routing / telemetry scaffolding
  a Studio frame doesn't cover. Served at
  `/api/projects/<slug>/lift/<frame>.(md|json)`; also bundled into Vercel
  share deployments at `/lift/<frame>.(md|json)`.
```

- [ ] **Step 2: Run the full suite**

Run: `pnpm run studio:test`
Expected: all existing tests still pass plus the new lift tests. If anything unrelated fails, investigate — a refactor may have hit something unexpected.

- [ ] **Step 3: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): note Lift Manifest in changelog"
```

---

## Task 15: Manual smoke test

No code, just a verification pass.

- [ ] **Step 1: Boot Studio and generate/touch a frame**

Run: `pnpm run studio`

Open the app. Generate a new frame (or open an existing project) and wait ~1s for `liftEmitPlugin` to react.

- [ ] **Step 2: Verify manifest files on disk**

In a terminal:

```bash
ls ~/Library/Application\ Support/arcade-studio/projects/*/frames/*/LIFT.md
```

Expected: at least one `LIFT.md` and one sibling `LIFT.json`.

- [ ] **Step 3: Verify the HTTP endpoints**

With Studio running:

```bash
# Replace <slug> and <frame> with values from step 2:
curl -s http://localhost:5556/api/projects/<slug>/lift/<frame>.md | head -40
curl -s http://localhost:5556/api/projects/<slug>/lift/<frame>.json | jq '.schemaVersion'
```

Expected: markdown starts with `# Lift Manifest — <slug>/<frame>`; JSON returns `1`.

- [ ] **Step 4: Click the button**

In Studio's share modal, select a frame, click "Copy Lift Manifest", paste into a scratch buffer. Expected: markdown matches step 3's output.

- [ ] **Step 5: Stop here**

This completes rung 1. The success criterion from the spec (three real lifts) is a post-merge activity, not an implementation step. Do not invent more.

---

## Self-Review Notes (for the plan author)

- Spec §4.1 (file path): covered by Task 10 (plugin writes `LIFT.md`/`LIFT.json` next to index.tsx).
- Spec §4.2 sections 1–8: covered by Task 9's renderer, which lays out the markdown in the spec's order.
- Spec §4.3 (shape detection): Task 5.
- Spec §5 (mapping table + coverage test): Tasks 3, 4, 7.
- Spec §6.1 (Studio UI action): Task 13 (inside the existing ShareModal — we chose not to add a new frame-level action because ShareModal already owns "per-frame action" UX; the spec's "button or menu item" language permits this).
- Spec §6.2 (Vercel preview manifest URL): Task 12.
- Spec §7.1 (where code lives): matches Task layout.
- Spec §7.3 (integration point = frame filesystem only): Task 10 only watches the projects directory; no generator changes.
- Spec §8 testing: mapping-coverage (Task 7), shape detector (Task 5), manifest snapshot (Task 9), integration middleware (Task 11), plus new unit coverage for parseImports, scaffolding, buildManifest.
- Spec §9 open question 2 (ownership): plan keeps everything in `studio/`; moving later is a later PR.
- Spec §10 success criteria: Task 15 is the last step. Three-lift retros happen post-merge.

No unresolved placeholders, no steps without code, no forward references to unknown types. Plan is concrete.
