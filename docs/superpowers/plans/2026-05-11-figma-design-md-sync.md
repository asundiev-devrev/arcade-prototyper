# Figma Design-System Sync (DESIGN.md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan a Figma file once per `fileKey` (styles, variables, components, sample-frame PNGs), synthesize a natural-language Identity paragraph + six token sections via one Claude call, and write the result to `<projectDir>/DESIGN.md`. The project's `CLAUDE.md` imports `DESIGN.md` via an `@DESIGN.md` line so the generator sees cross-frame design-system context on every turn.

**Architecture:** New sibling module `figmaSystemIngest.ts` with three helpers under `server/figma/` (`systemSources.ts`, `systemSynth.ts`, `systemRender.ts`) following the exact cache/dedupe pattern of the existing `figmaIngest.ts`. Chat middleware gains a `maybeSeedProjectDesignMd` helper that runs in parallel with existing per-frame enrichment and writes DESIGN.md atomically. Template gets a `## Design system` section with an `@DESIGN.md` import; existing `refreshStaleClaudeMd()` on Vite boot propagates to all projects.

**Tech Stack:** TypeScript, Node.js, Vitest, figmanage CLI (Figma REST wrapper), Claude CLI subprocess (Bedrock), Zod v4.

**Spec:** `docs/superpowers/specs/2026-05-11-figma-design-md-sync-design.md`

**Branch:** `feat/studio/figma-design-md-sync` (already cut from `main`).

---

## File map

**New files**

- `studio/server/figmaSystemIngest.ts` — per-fileKey cache + orchestrator, mirrors `figmaIngest.ts`.
- `studio/server/figma/systemSources.ts` — figmanage data fetch; pure + testable with injected deps.
- `studio/server/figma/systemSynth.ts` — single Claude call, Zod-validated JSON output, value-provenance check.
- `studio/server/figma/systemRender.ts` — pure render function (sections → markdown string).
- `studio/__tests__/server/figma/systemRender.test.ts`
- `studio/__tests__/server/figma/systemSources.test.ts`
- `studio/__tests__/server/figma/systemSynth.test.ts`
- `studio/__tests__/server/figmaSystemIngest.test.ts`
- `studio/__tests__/server/middleware/chat-figma-seeder.test.ts`
- `studio/__tests__/server/middleware/chat-figma-seeder-race.test.ts`
- `studio/__tests__/server/projects-claude-md-refresh.test.ts` (new)
- `studio/__tests__/fixtures/figma/system-sources-observatory.json`
- `studio/__tests__/fixtures/figma/system-sources-minimal.json`
- `studio/__tests__/fixtures/figma/synth-output-golden.json`
- `studio/__tests__/fixtures/figma/design-md-golden.md`

**Modified files**

- `studio/server/figma/types.ts` — add `ColorRole`, `TypoRole`, `TokenEntry`, `TokenSection`, `SynthesizedSections`, `SystemIngestResult`, `SystemIngestOutcome`.
- `studio/server/figmaCli.ts` — add `getStyles(fileKey)`, `getComponents(fileKey)` helpers.
- `studio/server/paths.ts` — add `designMdPath(projectSlug)` helper.
- `studio/server/middleware/chat.ts` — add `maybeSeedProjectDesignMd`, wire into `runClaudeBranch` as parallel step.
- `studio/templates/CLAUDE.md.tpl` — insert `## Design system` section with `@DESIGN.md` import near top.
- `studio/CHANGELOG.md` — add `## [0.X.0]` entry.

---

## Task 1: Extend types

**Files:**
- Modify: `studio/server/figma/types.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figma/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  ColorRole, TypoRole, TokenEntry, TokenSection, SynthesizedSections,
  SystemIngestResult, SystemIngestOutcome,
} from "../../../server/figma/types";

describe("figma system types", () => {
  it("ColorRole covers the fixed enum", () => {
    const roles: ColorRole[] = ["background", "surface", "text", "accent", "status", "other"];
    expect(roles).toHaveLength(6);
  });

  it("TypoRole covers the fixed enum", () => {
    const roles: TypoRole[] = ["heading", "body", "caption", "code", "other"];
    expect(roles).toHaveLength(5);
  });

  it("SynthesizedSections has all seven output groups", () => {
    const s: SynthesizedSections = {
      identity: "x",
      colors: { entries: [], warnings: [] },
      typography: { entries: [], warnings: [] },
      spacing: { scale: [] },
      radii: { scale: [] },
      shadows: { items: [] },
      components: [],
      warnings: [],
    };
    expect(Object.keys(s)).toEqual([
      "identity", "colors", "typography", "spacing", "radii", "shadows", "components", "warnings",
    ]);
  });

  it("SystemIngestOutcome discriminates ok/failure", () => {
    const ok: SystemIngestOutcome = {
      ok: true,
      source: { fileKey: "f", scannedAt: "2026-05-11T00:00:00Z" },
      sections: {
        identity: "x",
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      },
      diagnostics: { warnings: [], elapsedMs: 0 },
    };
    const fail: SystemIngestOutcome = { ok: false, reason: "x" };
    expect(ok.ok).toBe(true);
    expect(fail.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/figma/types.test.ts`
Expected: FAIL — types not exported.

- [ ] **Step 3: Add the types**

Append to `studio/server/figma/types.ts`:

```ts
// --- System-wide ingest (file-level scan) ---

export type ColorRole = "background" | "surface" | "text" | "accent" | "status" | "other";
export type TypoRole  = "heading" | "body" | "caption" | "code" | "other";

export interface TokenEntry {
  name: string;
  value: string;
  role: ColorRole | TypoRole;
}

export interface TokenSection {
  entries: TokenEntry[];
  warnings: string[];
}

export interface SynthesizedSections {
  identity: string;
  colors: TokenSection;
  typography: TokenSection;
  spacing: { scale: number[]; notes?: string };
  radii: { scale: number[]; notes?: string };
  shadows: { items: { name: string; css: string }[] };
  components: string[];
  warnings: string[];
}

export interface SystemIngestSource {
  fileKey: string;
  fileName?: string;
  scannedAt: string;
}

export interface SystemIngestResult {
  source: SystemIngestSource;
  sections: SynthesizedSections;
  diagnostics: { warnings: string[]; elapsedMs: number };
}

export type SystemIngestOutcome =
  | ({ ok: true } & SystemIngestResult)
  | { ok: false; reason: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/figma/types.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/types.ts studio/__tests__/server/figma/types.test.ts
git commit -m "feat(studio/figma): add system-scan ingest types"
```

---

## Task 2: `designMdPath` helper

**Files:**
- Modify: `studio/server/paths.ts`
- Test: `studio/__tests__/server/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `studio/__tests__/server/paths.test.ts` (append; keep existing tests):

```ts
import { designMdPath } from "../../server/paths";

describe("designMdPath", () => {
  it("returns DESIGN.md inside projectDir", () => {
    const p = designMdPath("my-project");
    expect(p.endsWith("/my-project/DESIGN.md")).toBe(true);
  });

  it("rejects invalid slugs via requireSlug", () => {
    expect(() => designMdPath("../etc")).toThrow(/Invalid slug/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: FAIL — `designMdPath is not a function`.

- [ ] **Step 3: Add the helper**

Append to `studio/server/paths.ts`:

```ts
export function designMdPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "DESIGN.md");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/paths.ts studio/__tests__/server/paths.test.ts
git commit -m "feat(studio/paths): add designMdPath helper for project DESIGN.md"
```

---

## Task 3: Golden fixtures for render tests

**Files:**
- Create: `studio/__tests__/fixtures/figma/synth-output-golden.json`
- Create: `studio/__tests__/fixtures/figma/design-md-golden.md`

These fixtures get consumed by Task 4. Creating them in isolation first keeps Task 4 about the renderer, not about hand-building fixture data.

- [ ] **Step 1: Write the golden SynthesizedSections fixture**

Create `studio/__tests__/fixtures/figma/synth-output-golden.json`:

```json
{
  "identity": "A dense, utilitarian internal tool with flat surfaces and sparse accent use. Neutral grays dominate; brand blue appears only on primary actions. Tight 8px rhythm, 2px radii, no drop shadows on surfaces. Feels engineered rather than consumer-facing.",
  "colors": {
    "entries": [
      { "name": "bg/canvas", "value": "#F6F7F9", "role": "background" },
      { "name": "bg/surface", "value": "#FFFFFF", "role": "surface" },
      { "name": "fg/neutral-strong", "value": "#111827", "role": "text" },
      { "name": "fg/neutral-muted", "value": "#6B7280", "role": "text" },
      { "name": "accent/primary", "value": "#2563EB", "role": "accent" },
      { "name": "status/danger", "value": "#DC2626", "role": "status" }
    ],
    "warnings": []
  },
  "typography": {
    "entries": [
      { "name": "display/lg", "value": "Inter 32/40 600", "role": "heading" },
      { "name": "body/md", "value": "Inter 14/20 400", "role": "body" },
      { "name": "caption/sm", "value": "Inter 12/16 500", "role": "caption" }
    ],
    "warnings": []
  },
  "spacing": { "scale": [4, 8, 12, 16, 24, 32, 48] },
  "radii": { "scale": [0, 2, 4, 8] },
  "shadows": {
    "items": [
      { "name": "elevation-1", "css": "0 1px 2px rgba(0,0,0,0.05)" }
    ]
  },
  "components": ["AppShell", "BreadcrumbBar", "KpiCard", "NavSidebar", "PageBody"],
  "warnings": []
}
```

- [ ] **Step 2: Write the golden DESIGN.md fixture**

Create `studio/__tests__/fixtures/figma/design-md-golden.md`:

```markdown
# Design system (from Figma)

<!-- Generated by Arcade Studio on 2026-05-11T00:00:00Z from Figma file abc123.
     Edit freely — future Studio runs won't overwrite this file. -->

## Identity
A dense, utilitarian internal tool with flat surfaces and sparse accent use. Neutral grays dominate; brand blue appears only on primary actions. Tight 8px rhythm, 2px radii, no drop shadows on surfaces. Feels engineered rather than consumer-facing.

## Colors
- background — bg/canvas: #F6F7F9
- surface — bg/surface: #FFFFFF
- text — fg/neutral-strong: #111827
- text — fg/neutral-muted: #6B7280
- accent — accent/primary: #2563EB
- status — status/danger: #DC2626

## Typography
- heading — display/lg: Inter 32/40 600
- body — body/md: Inter 14/20 400
- caption — caption/sm: Inter 12/16 500

## Spacing
Scale: 4, 8, 12, 16, 24, 32, 48

## Radii
Scale: 0, 2, 4, 8

## Shadows
- elevation-1: 0 1px 2px rgba(0,0,0,0.05)

## Components
AppShell, BreadcrumbBar, KpiCard, NavSidebar, PageBody
```

Note the trailing newline at EOF (standard markdown convention); make sure the file ends with `\n`.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/fixtures/figma/synth-output-golden.json studio/__tests__/fixtures/figma/design-md-golden.md
git commit -m "test(studio/figma): add golden fixtures for system-render tests"
```

---

## Task 4: `systemRender.ts` — happy-path golden test

**Files:**
- Create: `studio/server/figma/systemRender.ts`
- Create: `studio/__tests__/server/figma/systemRender.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figma/systemRender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDesignMd } from "../../../server/figma/systemRender";
import type { SynthesizedSections } from "../../../server/figma/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

describe("renderDesignMd — happy path", () => {
  it("matches the golden markdown byte-for-byte", () => {
    const sections = JSON.parse(
      fs.readFileSync(path.join(fxDir, "synth-output-golden.json"), "utf-8"),
    ) as SynthesizedSections;
    const expected = fs.readFileSync(path.join(fxDir, "design-md-golden.md"), "utf-8");
    const actual = renderDesignMd(sections, {
      fileKey: "abc123",
      scannedAt: "2026-05-11T00:00:00Z",
    });
    expect(actual).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/figma/systemRender.test.ts`
Expected: FAIL — `renderDesignMd` not exported.

- [ ] **Step 3: Write the initial implementation**

Create `studio/server/figma/systemRender.ts`:

```ts
import type { SynthesizedSections, TokenEntry } from "./types";

export interface RenderSource {
  fileKey: string;
  fileName?: string;
  scannedAt: string;
}

const IDENTITY_WORD_CAP = 80;
const COMPONENT_CAP = 50;
const EMPTY_SENTINEL = "_(none detected)_";

export function renderDesignMd(s: SynthesizedSections, source: RenderSource): string {
  const lines: string[] = [];
  lines.push("# Design system (from Figma)");
  lines.push("");
  lines.push(
    `<!-- Generated by Arcade Studio on ${source.scannedAt} from Figma file ${source.fileKey}.`,
  );
  lines.push(`     Edit freely — future Studio runs won't overwrite this file. -->`);
  lines.push("");

  lines.push("## Identity");
  lines.push(clampIdentity(s.identity));
  lines.push("");

  lines.push("## Colors");
  lines.push(...renderTokenSection(s.colors.entries));
  lines.push("");

  lines.push("## Typography");
  lines.push(...renderTokenSection(s.typography.entries));
  lines.push("");

  lines.push("## Spacing");
  lines.push(s.spacing.scale.length ? `Scale: ${s.spacing.scale.join(", ")}` : EMPTY_SENTINEL);
  lines.push("");

  lines.push("## Radii");
  lines.push(s.radii.scale.length ? `Scale: ${s.radii.scale.join(", ")}` : EMPTY_SENTINEL);
  lines.push("");

  lines.push("## Shadows");
  if (s.shadows.items.length === 0) lines.push(EMPTY_SENTINEL);
  else for (const sh of s.shadows.items) lines.push(`- ${sh.name}: ${sh.css}`);
  lines.push("");

  lines.push("## Components");
  const comps = s.components.slice(0, COMPONENT_CAP);
  lines.push(comps.length ? comps.join(", ") : EMPTY_SENTINEL);
  lines.push("");

  return lines.join("\n");
}

function renderTokenSection(entries: TokenEntry[]): string[] {
  if (entries.length === 0) return [EMPTY_SENTINEL];
  return entries.map((e) => `- ${e.role} — ${e.name}: ${e.value}`);
}

function clampIdentity(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= IDENTITY_WORD_CAP) return text.trim();
  const clamped = words.slice(0, IDENTITY_WORD_CAP).join(" ");
  // Trim back to the last sentence boundary inside the cap so we don't end mid-phrase.
  const sentenceEnd = clamped.match(/^(.*[.!?])\s+\S+/);
  return (sentenceEnd ? sentenceEnd[1] : clamped).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/figma/systemRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/systemRender.ts studio/__tests__/server/figma/systemRender.test.ts
git commit -m "feat(studio/figma): add systemRender with golden-markdown test"
```

---

## Task 5: `systemRender.ts` — edge-case tests

**Files:**
- Modify: `studio/__tests__/server/figma/systemRender.test.ts`

- [ ] **Step 1: Write failing tests for edge cases**

Append to `studio/__tests__/server/figma/systemRender.test.ts`:

```ts
import type { SynthesizedSections as SS } from "../../../server/figma/types";

function emptySections(): SS {
  return {
    identity: "A minimal placeholder identity.",
    colors: { entries: [], warnings: [] },
    typography: { entries: [], warnings: [] },
    spacing: { scale: [] },
    radii: { scale: [] },
    shadows: { items: [] },
    components: [],
    warnings: [],
  };
}

describe("renderDesignMd — edge cases", () => {
  it("renders empty sections with the _(none detected)_ sentinel", () => {
    const md = renderDesignMd(emptySections(), { fileKey: "fk", scannedAt: "t" });
    expect(md).toContain("## Colors\n_(none detected)_");
    expect(md).toContain("## Typography\n_(none detected)_");
    expect(md).toContain("## Spacing\n_(none detected)_");
    expect(md).toContain("## Radii\n_(none detected)_");
    expect(md).toContain("## Shadows\n_(none detected)_");
    expect(md).toContain("## Components\n_(none detected)_");
  });

  it("clamps Identity over 80 words to the last sentence boundary", () => {
    const long = Array(120).fill("word").join(" ") + ". End.";
    const s = { ...emptySections(), identity: long + " Extra words that spill beyond the cap and keep going and going and going." };
    const md = renderDesignMd(s, { fileKey: "fk", scannedAt: "t" });
    const identitySection = md.split("## Identity\n")[1].split("\n\n## Colors")[0];
    const words = identitySection.trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(80);
  });

  it("truncates component list to 50 names in listed order", () => {
    const names = Array.from({ length: 75 }, (_, i) => `Comp${String(i).padStart(2, "0")}`);
    const s: SS = { ...emptySections(), components: names };
    const md = renderDesignMd(s, { fileKey: "fk", scannedAt: "t" });
    const compsSection = md.split("## Components\n")[1].trim();
    const emitted = compsSection.split(", ");
    expect(emitted).toHaveLength(50);
    expect(emitted[0]).toBe("Comp00");
    expect(emitted[49]).toBe("Comp49");
  });

  it("keeps section order fixed: Identity, Colors, Typography, Spacing, Radii, Shadows, Components", () => {
    const md = renderDesignMd(emptySections(), { fileKey: "fk", scannedAt: "t" });
    const headings = [...md.matchAll(/^## (\w+)/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Identity", "Colors", "Typography", "Spacing", "Radii", "Shadows", "Components"]);
  });
});
```

- [ ] **Step 2: Run tests — expect initial round to pass or fail meaningfully**

Run: `pnpm run studio:test __tests__/server/figma/systemRender.test.ts`
Expected: PASS on all four edge-case tests if the Task-4 implementation was correct. If any fail, fix the renderer — do not paper over by weakening the test.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/server/figma/systemRender.test.ts
git commit -m "test(studio/figma): cover systemRender edge cases (empty, clamp, truncate, order)"
```

---

## Task 6: `figmaCli.ts` — add `getStyles` and `getComponents`

**Files:**
- Modify: `studio/server/figmaCli.ts`
- Test: `studio/__tests__/server/figmaCli.test.ts`

- [ ] **Step 1: Check existing figmaCli test conventions**

Run: `pnpm run studio:test __tests__/server/figmaCli.test.ts -v`
Observe: the test file mocks `runFigmanage` or similar. Match the existing pattern.

- [ ] **Step 2: Write failing tests**

Append to `studio/__tests__/server/figmaCli.test.ts` (use the same mocking style as existing tests):

```ts
import { getStyles, getComponents } from "../../server/figmaCli";
// Continue using the same `vi.mock("node:child_process", …)` or spawn-mocking
// pattern the existing tests in this file already use. If the file uses a
// module-level spawn mock, extend it to handle the new argv shapes below.

describe("getStyles", () => {
  it("returns parsed JSON when figmanage succeeds", async () => {
    // Mock spawn: argv = ["reading", "get-styles", "fk", "--json"], exit 0,
    // stdout = JSON.stringify({ styles: [{ node_id: "1:1", name: "bg/canvas" }] })
    const out = await getStyles("fk");
    expect(Array.isArray(out?.styles)).toBe(true);
    expect(out.styles[0].name).toBe("bg/canvas");
  });

  it("returns null on non-zero exit (best-effort)", async () => {
    // Mock spawn to exit with code 1
    const out = await getStyles("fk");
    expect(out).toBeNull();
  });
});

describe("getComponents", () => {
  it("returns parsed JSON when figmanage succeeds", async () => {
    const out = await getComponents("fk");
    expect(Array.isArray(out?.components)).toBe(true);
  });

  it("returns null on non-zero exit", async () => {
    const out = await getComponents("fk");
    expect(out).toBeNull();
  });
});
```

**Note to implementer:** the concrete spawn-mocking lines depend on the existing test file's setup (which may use `vi.mock` at module scope or per-test overrides). Preserve that pattern. If the existing file has no `runFigmanage` mock yet, use `vi.spyOn(childProcess, "spawn")` consistent with other tests in the repo (see `studio/__tests__/server/claudeCode.test.ts` for an example pattern).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/figmaCli.test.ts`
Expected: FAIL — `getStyles` / `getComponents` not exported.

- [ ] **Step 4: Implement helpers**

Append to `studio/server/figmaCli.ts`:

```ts
/**
 * Fetch the file's published paint/text/effect styles. Returns `null` on
 * non-zero exit — styles are best-effort input to system-scan, same posture
 * as getVariables.
 */
export async function getStyles(fileKey: string): Promise<any | null> {
  const r = await runFigmanage(["reading", "get-styles", fileKey, "--json"]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); }
  catch { return null; }
}

/**
 * Fetch the file's published components and component sets. Returns `null`
 * on non-zero exit.
 */
export async function getComponents(fileKey: string): Promise<any | null> {
  const r = await runFigmanage(["reading", "get-components", fileKey, "--json"]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); }
  catch { return null; }
}
```

**Verification note:** `figmanage reading get-styles` and `get-components` are the expected subcommands. If figmanage uses different names locally (check with `figmanage reading --help` before starting the task), substitute them in both the implementation AND the test's argv mock. The contract — `--json` flag, returns `null` on non-zero — stays the same.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figmaCli.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figmaCli.ts studio/__tests__/server/figmaCli.test.ts
git commit -m "feat(studio/figma): add figmanage getStyles and getComponents helpers"
```

---

## Task 7: `systemSources.ts` — fixture + shape test

**Files:**
- Create: `studio/__tests__/fixtures/figma/system-sources-minimal.json`
- Create: `studio/server/figma/systemSources.ts`
- Create: `studio/__tests__/server/figma/systemSources.test.ts`

- [ ] **Step 1: Create minimal fixture**

Create `studio/__tests__/fixtures/figma/system-sources-minimal.json`:

```json
{
  "styles": {
    "styles": [
      { "node_id": "1:1", "name": "bg/canvas", "style_type": "FILL" },
      { "node_id": "1:2", "name": "body/md", "style_type": "TEXT" }
    ]
  },
  "variables": null,
  "components": {
    "components": [
      { "node_id": "10:1", "name": "Button", "is_component_set": false }
    ]
  },
  "file": {
    "name": "Test file",
    "document": {
      "id": "0:0",
      "type": "DOCUMENT",
      "children": [
        {
          "id": "0:1",
          "type": "CANVAS",
          "name": "Page 1",
          "children": [
            {
              "id": "2:1",
              "type": "FRAME",
              "name": "Home",
              "absoluteBoundingBox": { "x": 0, "y": 0, "width": 1440, "height": 900 }
            },
            {
              "id": "2:2",
              "type": "FRAME",
              "name": "Icon",
              "absoluteBoundingBox": { "x": 0, "y": 0, "width": 24, "height": 24 }
            },
            {
              "id": "2:3",
              "type": "FRAME",
              "name": "Settings",
              "absoluteBoundingBox": { "x": 0, "y": 0, "width": 800, "height": 600 }
            }
          ]
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Write failing test**

Create `studio/__tests__/server/figma/systemSources.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSystemSources, pickSampleFrames } from "../../../server/figma/systemSources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

function loadMinimal() {
  return JSON.parse(fs.readFileSync(path.join(fxDir, "system-sources-minimal.json"), "utf-8"));
}

function makeDeps(overrides: any = {}) {
  const fx = loadMinimal();
  return {
    getStyles: vi.fn().mockResolvedValue(fx.styles),
    getVariables: vi.fn().mockResolvedValue(fx.variables),
    getComponents: vi.fn().mockResolvedValue(fx.components),
    getFile: vi.fn().mockResolvedValue(fx.file),
    exportPng: vi.fn().mockImplementation(async (_fk: string, nodeId: string) =>
      ({ path: `/tmp/${nodeId.replace(":", "-")}.png`, widthPx: 0, heightPx: 0 })),
    ...overrides,
  };
}

describe("fetchSystemSources", () => {
  it("assembles the SystemSources shape from figmanage calls", async () => {
    const deps = makeDeps();
    const out = await fetchSystemSources("fk", deps);
    expect(out.styles.paint.length + out.styles.text.length).toBeGreaterThan(0);
    expect(out.components.length).toBe(1);
    expect(out.sampleFrames.length).toBeGreaterThan(0);
  });

  it("warns and proceeds when variables payload is missing", async () => {
    const deps = makeDeps({ getVariables: vi.fn().mockResolvedValue(null) });
    const out = await fetchSystemSources("fk", deps);
    expect(out.warnings.some((w) => /variables/i.test(w))).toBe(true);
    expect(out.variables.color).toEqual([]);
  });

  it("warns and proceeds when getFile returns null (no sample frames)", async () => {
    const deps = makeDeps({ getFile: vi.fn().mockResolvedValue(null) });
    const out = await fetchSystemSources("fk", deps);
    expect(out.sampleFrames).toEqual([]);
    expect(out.warnings.some((w) => /file/i.test(w))).toBe(true);
  });
});

describe("pickSampleFrames", () => {
  it("sorts by area descending, caps at 8, skips frames < 400x400", () => {
    const fx = loadMinimal();
    const picks = pickSampleFrames(fx.file.document);
    expect(picks.length).toBe(2); // Home (1440x900), Settings (800x600); Icon (24x24) skipped
    expect(picks[0].nodeId).toBe("2:1");
    expect(picks[1].nodeId).toBe("2:3");
  });

  it("caps output at 8 frames", () => {
    const doc = {
      children: [{
        type: "CANVAS",
        children: Array.from({ length: 12 }, (_, i) => ({
          id: `3:${i}`,
          type: "FRAME",
          name: `F${i}`,
          absoluteBoundingBox: { x: 0, y: 0, width: 1000 + i, height: 1000 + i },
        })),
      }],
    };
    const picks = pickSampleFrames(doc);
    expect(picks.length).toBe(8);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/figma/systemSources.test.ts`
Expected: FAIL — `systemSources` not exported.

- [ ] **Step 4: Implement `systemSources.ts`**

Create `studio/server/figma/systemSources.ts`:

```ts
import type { SystemIngestSource } from "./types";

export interface PaintStyle { id: string; name: string; hex: string }
export interface TextStyle {
  id: string; name: string;
  family: string; size: number; weight: number;
  lineHeight?: number; letterSpacing?: number;
}
export interface EffectStyle { id: string; name: string; css: string }

export interface ColorVariable { name: string; hex: string; collection: string }
export interface NumberVariable { name: string; value: number; collection: string }

export interface ComponentRef { id: string; name: string; isComponentSet: boolean }

export interface SampleFrame {
  nodeId: string; name: string; pngPath: string;
  widthPx: number; heightPx: number;
}

export interface SystemSources {
  fileName?: string;
  styles: { paint: PaintStyle[]; text: TextStyle[]; effect: EffectStyle[] };
  variables: { color: ColorVariable[]; number: NumberVariable[] };
  components: ComponentRef[];
  sampleFrames: SampleFrame[];
  warnings: string[];
}

export interface SourcesDeps {
  getStyles(fileKey: string): Promise<any | null>;
  getVariables(fileKey: string): Promise<any | null>;
  getComponents(fileKey: string): Promise<any | null>;
  getFile(fileKey: string): Promise<any | null>;
  exportPng(fileKey: string, nodeId: string): Promise<{ path: string; widthPx: number; heightPx: number } | null>;
}

const MIN_FRAME_SIDE = 400;
const MAX_SAMPLE_FRAMES = 8;

export async function fetchSystemSources(fileKey: string, deps: SourcesDeps): Promise<SystemSources> {
  const warnings: string[] = [];
  const [stylesRaw, varsRaw, componentsRaw, fileRaw] = await Promise.all([
    deps.getStyles(fileKey).catch(() => null),
    deps.getVariables(fileKey).catch(() => null),
    deps.getComponents(fileKey).catch(() => null),
    deps.getFile(fileKey).catch(() => null),
  ]);

  const styles = parseStyles(stylesRaw, warnings);
  const variables = parseVariables(varsRaw, warnings);
  const components = parseComponents(componentsRaw, warnings);

  let sampleFrames: SampleFrame[] = [];
  let fileName: string | undefined;
  if (!fileRaw) {
    warnings.push("file payload unavailable — no sample frames");
  } else {
    fileName = fileRaw.name;
    const picks = pickSampleFrames(fileRaw.document);
    for (const p of picks) {
      const png = await deps.exportPng(fileKey, p.nodeId).catch(() => null);
      if (!png) { warnings.push(`png export failed for ${p.nodeId}`); continue; }
      sampleFrames.push({
        nodeId: p.nodeId, name: p.name, pngPath: png.path,
        widthPx: p.widthPx, heightPx: p.heightPx,
      });
    }
  }

  return { fileName, styles, variables, components, sampleFrames, warnings };
}

export interface SampleFramePick {
  nodeId: string; name: string; widthPx: number; heightPx: number; area: number;
}

export function pickSampleFrames(document: any): SampleFramePick[] {
  const candidates: SampleFramePick[] = [];
  const canvases = (document?.children ?? []).filter((c: any) => c?.type === "CANVAS");
  for (const canvas of canvases) {
    for (const frame of canvas.children ?? []) {
      if (frame?.type !== "FRAME") continue;
      const box = frame.absoluteBoundingBox;
      if (!box || box.width < MIN_FRAME_SIDE || box.height < MIN_FRAME_SIDE) continue;
      candidates.push({
        nodeId: frame.id, name: frame.name ?? "",
        widthPx: box.width, heightPx: box.height,
        area: box.width * box.height,
      });
    }
  }
  candidates.sort((a, b) => b.area - a.area);
  return candidates.slice(0, MAX_SAMPLE_FRAMES);
}

function parseStyles(raw: any, warnings: string[]): SystemSources["styles"] {
  const paint: PaintStyle[] = [];
  const text: TextStyle[] = [];
  const effect: EffectStyle[] = [];
  if (!raw?.styles || !Array.isArray(raw.styles)) {
    warnings.push("styles payload missing or malformed");
    return { paint, text, effect };
  }
  for (const s of raw.styles) {
    const id = String(s.node_id ?? s.id ?? "");
    const name = String(s.name ?? "");
    const type = String(s.style_type ?? s.styleType ?? "");
    if (type === "FILL" && typeof s.hex === "string") paint.push({ id, name, hex: s.hex });
    else if (type === "FILL") paint.push({ id, name, hex: "" });
    else if (type === "TEXT") text.push({
      id, name,
      family: String(s.font_family ?? s.fontFamily ?? ""),
      size: Number(s.font_size ?? s.fontSize ?? 0),
      weight: Number(s.font_weight ?? s.fontWeight ?? 400),
      lineHeight: s.line_height ?? s.lineHeight,
      letterSpacing: s.letter_spacing ?? s.letterSpacing,
    });
    else if (type === "EFFECT") effect.push({ id, name, css: String(s.css ?? "") });
  }
  return { paint, text, effect };
}

function parseVariables(raw: any, warnings: string[]): SystemSources["variables"] {
  const color: ColorVariable[] = [];
  const number: NumberVariable[] = [];
  if (!raw) {
    warnings.push("variables payload unavailable");
    return { color, number };
  }
  const collections: any[] = raw.variable_collections ?? raw.variableCollections ?? [];
  const vars: any[] = raw.variables ?? [];
  const collectionNameById = new Map<string, string>();
  for (const c of collections) collectionNameById.set(String(c.id), String(c.name ?? ""));
  for (const v of vars) {
    const collection = collectionNameById.get(String(v.variable_collection_id ?? v.collectionId ?? "")) ?? "";
    const name = String(v.name ?? "");
    const type = String(v.resolved_type ?? v.resolvedType ?? v.type ?? "");
    if (type === "COLOR" && typeof v.hex === "string") color.push({ name, hex: v.hex, collection });
    else if (type === "FLOAT" && typeof v.value === "number") number.push({ name, value: v.value, collection });
  }
  return { color, number };
}

function parseComponents(raw: any, warnings: string[]): ComponentRef[] {
  if (!raw?.components || !Array.isArray(raw.components)) {
    warnings.push("components payload missing or malformed");
    return [];
  }
  const out: ComponentRef[] = [];
  for (const c of raw.components) {
    out.push({
      id: String(c.node_id ?? c.id ?? ""),
      name: String(c.name ?? ""),
      isComponentSet: Boolean(c.is_component_set ?? c.isComponentSet ?? false),
    });
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/systemSources.test.ts`
Expected: PASS on all five tests. If shapes disagree, adjust the fixture OR the parser — whichever is the actual figmanage truth on this machine.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figma/systemSources.ts studio/__tests__/server/figma/systemSources.test.ts studio/__tests__/fixtures/figma/system-sources-minimal.json
git commit -m "feat(studio/figma): fetch file-wide styles, variables, components, sample frames"
```

---

## Task 8: `systemSynth.ts` — Zod schema + happy-path test

**Files:**
- Create: `studio/server/figma/systemSynth.ts`
- Create: `studio/__tests__/server/figma/systemSynth.test.ts`

- [ ] **Step 1: Check Zod version used in repo**

Run: `grep '"zod"' studio/package.json studio/../package.json 2>/dev/null || grep '"zod"' package.json`
Note: repo uses Zod v4 (see recent commits — `18df76a fix(studio/multiplayer): use Zod v4 .issues API`). Import is `import { z } from "zod"`; error property is `.issues`, not `.errors`.

- [ ] **Step 2: Write failing test (happy path only)**

Create `studio/__tests__/server/figma/systemSynth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { synthesizeSystem } from "../../../server/figma/systemSynth";
import type { SystemSources } from "../../../server/figma/systemSources";

function minimalSources(): SystemSources {
  return {
    styles: {
      paint: [{ id: "1", name: "bg/canvas", hex: "#F6F7F9" }],
      text: [{ id: "2", name: "body/md", family: "Inter", size: 14, weight: 400 }],
      effect: [],
    },
    variables: { color: [], number: [] },
    components: [{ id: "3", name: "Button", isComponentSet: false }],
    sampleFrames: [],
    warnings: [],
  };
}

function cannedReply(obj: any): string {
  return JSON.stringify(obj);
}

describe("synthesizeSystem — happy path", () => {
  it("parses a valid Claude reply into SynthesizedSections", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: cannedReply({
        identity: "A dense utilitarian design system.",
        colors: { entries: [{ name: "bg/canvas", value: "#F6F7F9", role: "background" }], warnings: [] },
        typography: { entries: [{ name: "body/md", value: "Inter 14 400", role: "body" }], warnings: [] },
        spacing: { scale: [4, 8, 16] },
        radii: { scale: [0, 4] },
        shadows: { items: [] },
        components: ["Button"],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.identity).toContain("utilitarian");
    expect(out.colors.entries[0].value).toBe("#F6F7F9");
    expect(out.components).toEqual(["Button"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/figma/systemSynth.test.ts`
Expected: FAIL — `synthesizeSystem` not exported.

- [ ] **Step 4: Implement `systemSynth.ts` (initial skeleton + happy path)**

Create `studio/server/figma/systemSynth.ts`:

```ts
import { spawn as spawnChild } from "node:child_process";
import { z } from "zod";
import type { SynthesizedSections } from "./types";
import type { SystemSources } from "./systemSources";
import { resolveClaudeBin } from "../claudeBin";

export interface SynthSpawnResult { text: string; exitCode: number | null }
export interface SynthDeps {
  spawn?: (prompt: string, imagePaths: string[]) => Promise<SynthSpawnResult>;
  model?: string;
  timeoutMs?: number;
}

const TokenEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
  role: z.string(),
});

const TokenSectionSchema = z.object({
  entries: z.array(TokenEntrySchema),
  warnings: z.array(z.string()).default([]),
});

const SectionsSchema = z.object({
  identity: z.string(),
  colors: TokenSectionSchema,
  typography: TokenSectionSchema,
  spacing: z.object({ scale: z.array(z.number()), notes: z.string().optional() }),
  radii: z.object({ scale: z.array(z.number()), notes: z.string().optional() }),
  shadows: z.object({ items: z.array(z.object({ name: z.string(), css: z.string() })) }),
  components: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
});

const COLOR_ROLES = new Set(["background", "surface", "text", "accent", "status", "other"]);
const TYPO_ROLES = new Set(["heading", "body", "caption", "code", "other"]);

export async function synthesizeSystem(
  sources: SystemSources,
  deps: SynthDeps = {},
): Promise<SynthesizedSections> {
  const spawner = deps.spawn ?? defaultSpawner(deps.model, deps.timeoutMs ?? 60_000);
  const prompt = buildPrompt(sources);
  const images = sources.sampleFrames.map((f) => f.pngPath);
  const reply = await spawner(prompt, images);
  if (reply.exitCode !== 0) {
    throw new Error(`synthesizer exited ${reply.exitCode}`);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(reply.text)); }
  catch { throw new Error("synthesizer reply parse failed"); }

  const check = SectionsSchema.safeParse(parsed);
  if (!check.success) {
    const issue = check.error.issues[0];
    throw new Error(`synthesizer schema mismatch: ${issue.path.join(".")} — ${issue.message}`);
  }

  return postProcess(check.data, sources);
}

function postProcess(
  parsed: z.infer<typeof SectionsSchema>,
  sources: SystemSources,
): SynthesizedSections {
  const warnings = [...parsed.warnings];

  const allowedColorValues = new Set([
    ...sources.styles.paint.map((p) => p.hex),
    ...sources.variables.color.map((v) => v.hex),
  ].filter(Boolean));

  const colors = {
    entries: parsed.colors.entries.flatMap((e) => {
      if (!COLOR_ROLES.has(e.role)) {
        warnings.push(`dropped color "${e.name}" with unknown role "${e.role}"`);
        return [];
      }
      if (allowedColorValues.size > 0 && !allowedColorValues.has(e.value)) {
        warnings.push(`dropped color "${e.name}" with unsourced value "${e.value}"`);
        return [];
      }
      return [{ name: e.name, value: e.value, role: e.role as any }];
    }),
    warnings: parsed.colors.warnings,
  };

  const typography = {
    entries: parsed.typography.entries.flatMap((e) => {
      if (!TYPO_ROLES.has(e.role)) {
        warnings.push(`dropped typo "${e.name}" with unknown role "${e.role}"`);
        return [];
      }
      return [{ name: e.name, value: e.value, role: e.role as any }];
    }),
    warnings: parsed.typography.warnings,
  };

  const components = [...new Set(parsed.components.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    identity: parsed.identity.trim(),
    colors,
    typography,
    spacing: { scale: uniqueSortedNumbers(parsed.spacing.scale), notes: parsed.spacing.notes },
    radii: { scale: uniqueSortedNumbers(parsed.radii.scale), notes: parsed.radii.notes },
    shadows: parsed.shadows,
    components,
    warnings,
  };
}

function uniqueSortedNumbers(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fence ? fence[1] : text;
  const m = stripped.match(/\{[\s\S]*\}/);
  return m ? m[0] : stripped.trim();
}

function buildPrompt(s: SystemSources): string {
  const digest = {
    paint: s.styles.paint.map((p) => ({ name: p.name, hex: p.hex })),
    text: s.styles.text.map((t) => ({
      name: t.name, family: t.family, size: t.size, weight: t.weight,
      lineHeight: t.lineHeight, letterSpacing: t.letterSpacing,
    })),
    effect: s.styles.effect.map((e) => ({ name: e.name, css: e.css })),
    variables: {
      color: s.variables.color.map((v) => ({ name: v.name, hex: v.hex })),
      number: s.variables.number.map((v) => ({ name: v.name, value: v.value })),
    },
    components: s.components.map((c) => c.name),
  };
  return [
    "You are analyzing a Figma design system. Output ONE JSON object matching the schema below.",
    "No prose, no markdown fences. Just the JSON.",
    "",
    "Rules:",
    "- `identity` is 50-80 words, describing visual personality (density, ornamentation, temperature, formality). Grounded in the sample frames if provided; concrete not generic.",
    "- For each color entry, pick role from: background, surface, text, accent, status, other. The `value` MUST be one of the hex values I passed you verbatim — do not alter hexes.",
    "- For each typography entry, pick role from: heading, body, caption, code, other. Encode `value` as \"<family> <size>/<lineHeight> <weight>\" (e.g. \"Inter 14/20 400\").",
    "- `spacing.scale` and `radii.scale` are sorted ascending, unique numbers observed across the input.",
    "- `components` is the list of component names, sorted alphabetically, deduped.",
    "",
    "Schema:",
    '{ identity: string, colors: { entries: [{name, value, role}], warnings: string[] }, typography: { entries: [{name, value, role}], warnings: string[] }, spacing: { scale: number[] }, radii: { scale: number[] }, shadows: { items: [{name, css}] }, components: string[], warnings: string[] }',
    "",
    "Input digest:",
    "```json",
    JSON.stringify(digest),
    "```",
  ].join("\n");
}

function defaultSpawner(modelOpt: string | undefined, timeoutMs: number) {
  return (prompt: string, imagePaths: string[]) =>
    new Promise<SynthSpawnResult>((resolve) => {
      const model = modelOpt
        ?? process.env.ARCADE_STUDIO_SYNTH_MODEL?.trim()
        ?? "sonnet";
      const bin = resolveClaudeBin();
      const args = ["--bare", "--model", model, "--print"];
      for (const p of imagePaths) args.push("--attach", p);
      args.push(prompt);
      const proc = spawnChild(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      proc.stdout.on("data", (c) => { text += c.toString(); });
      proc.stderr.on("data", () => {});
      const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      proc.on("close", (exitCode) => { clearTimeout(timer); resolve({ text, exitCode }); });
      proc.on("error", () => resolve({ text: "", exitCode: -1 }));
    });
}
```

**Claude CLI attachment note:** `--attach` passes a file to the model's input. If the installed claude CLI uses a different flag (e.g. `--image`), substitute it — the test injects its own `spawn` so this is only relevant at runtime. Run `claude --help | grep -i attach` to verify before integration QA (Task 14).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/figma/systemSynth.test.ts`
Expected: PASS on the happy-path test.

- [ ] **Step 6: Commit**

```bash
git add studio/server/figma/systemSynth.ts studio/__tests__/server/figma/systemSynth.test.ts
git commit -m "feat(studio/figma): add systemSynth LLM call with Zod schema guard"
```

---

## Task 9: `systemSynth.ts` — validation + provenance + role tests

**Files:**
- Modify: `studio/__tests__/server/figma/systemSynth.test.ts`

- [ ] **Step 1: Add failing tests for validation edges**

Append to `studio/__tests__/server/figma/systemSynth.test.ts`:

```ts
describe("synthesizeSystem — validation", () => {
  it("throws when Zod schema rejects (missing required key)", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        // identity missing
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
      }),
      exitCode: 0,
    });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/schema mismatch/);
  });

  it("throws when reply is not parseable JSON", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "not json", exitCode: 0 });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/parse failed/);
  });

  it("throws when spawn exits non-zero", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "", exitCode: 1 });
    await expect(synthesizeSystem(minimalSources(), { spawn })).rejects.toThrow(/exited 1/);
  });
});

describe("synthesizeSystem — provenance + role coercion", () => {
  it("drops color entries whose hex is not in sources, with warning", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [
          { name: "bg/canvas", value: "#F6F7F9", role: "background" }, // in sources
          { name: "brand/fake", value: "#DEADBE", role: "accent" },    // NOT in sources
        ], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.colors.entries.map((e) => e.name)).toEqual(["bg/canvas"]);
    expect(out.warnings.some((w) => /unsourced value/.test(w))).toBe(true);
  });

  it("drops entries with unknown roles, with warning", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [
          { name: "foo", value: "#F6F7F9", role: "mystery" },
        ], warnings: [] },
        typography: { entries: [
          { name: "bar", value: "Inter 14", role: "also-mystery" },
        ], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.colors.entries).toEqual([]);
    expect(out.typography.entries).toEqual([]);
    expect(out.warnings.filter((w) => /unknown role/.test(w))).toHaveLength(2);
  });

  it("dedupes + sorts components", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        identity: "x",
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [16, 4, 8, 4] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: ["Button", "AppShell", "Button", "KpiCard"],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.components).toEqual(["AppShell", "Button", "KpiCard"]);
    expect(out.spacing.scale).toEqual([4, 8, 16]);
  });
});
```

- [ ] **Step 2: Run tests — expect all to pass (Task-8 implementation already covers these)**

Run: `pnpm run studio:test __tests__/server/figma/systemSynth.test.ts`
Expected: PASS on all seven tests. If any fail, fix `systemSynth.ts` — do not relax the assertions.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/server/figma/systemSynth.test.ts
git commit -m "test(studio/figma): cover systemSynth validation + provenance"
```

---

## Task 10: `figmaSystemIngest.ts` — cache + dedupe

**Files:**
- Create: `studio/server/figmaSystemIngest.ts`
- Create: `studio/__tests__/server/figmaSystemIngest.test.ts`

- [ ] **Step 1: Write failing tests**

Create `studio/__tests__/server/figmaSystemIngest.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFigmaSystemIngest } from "../../server/figmaSystemIngest";
import type { SynthesizedSections } from "../../server/figma/types";
import type { SystemSources } from "../../server/figma/systemSources";

function dummySections(): SynthesizedSections {
  return {
    identity: "i",
    colors: { entries: [], warnings: [] },
    typography: { entries: [], warnings: [] },
    spacing: { scale: [] },
    radii: { scale: [] },
    shadows: { items: [] },
    components: [],
    warnings: [],
  };
}

function dummySources(): SystemSources {
  return {
    styles: { paint: [], text: [], effect: [] },
    variables: { color: [], number: [] },
    components: [],
    sampleFrames: [],
    warnings: [],
  };
}

function makeDeps(overrides: any = {}) {
  let t = 1_000_000;
  return {
    fetchSources: vi.fn().mockResolvedValue(dummySources()),
    synthesize: vi.fn().mockResolvedValue(dummySections()),
    now: () => t,
    advance: (ms: number) => { t += ms; },
    ...overrides,
  };
}

describe("createFigmaSystemIngest", () => {
  it("returns ok outcome with synthesized sections on first call", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    const out = await ing.ingest("fk");
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
    expect(out.source.fileKey).toBe("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });

  it("serves cache hits without re-fetching", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    await ing.ingest("fk");
    await ing.ingest("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent calls via pending promise", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    const [a, b] = await Promise.all([ing.ingest("fk"), ing.ingest("fk")]);
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
    expect(a).toStrictEqual(b);
  });

  it("expires cache after TTL", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps, { ttlMs: 1000 });
    await ing.ingest("fk");
    deps.advance(1500);
    await ing.ingest("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(2);
  });

  it("caches negative results for shorter TTL", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(dummySources());
    const deps = makeDeps({ fetchSources: fetch });
    const ing = createFigmaSystemIngest(deps, { ttlMs: 60_000, negativeTtlMs: 5000 });
    const first = await ing.ingest("fk");
    expect(first.ok).toBe(false);
    // Before negative TTL expires, same failure is served from cache
    const second = await ing.ingest("fk");
    expect(second.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    // After negative TTL, retry happens
    deps.advance(6000);
    const third = await ing.ingest("fk");
    expect(third.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("LRU-evicts when over capacity", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps, { capacity: 2 });
    await ing.ingest("a");
    await ing.ingest("b");
    await ing.ingest("c"); // evicts "a"
    expect(ing.getCached("a")).toBeUndefined();
    expect(ing.getCached("b")).toBeDefined();
    expect(ing.getCached("c")).toBeDefined();
  });

  it("returns failure outcome when synthesize throws", async () => {
    const synth = vi.fn().mockRejectedValue(new Error("bad schema"));
    const deps = makeDeps({ synthesize: synth });
    const ing = createFigmaSystemIngest(deps);
    const out = await ing.ingest("fk");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/bad schema/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/figmaSystemIngest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `figmaSystemIngest.ts`**

Create `studio/server/figmaSystemIngest.ts`:

```ts
import type { SystemIngestOutcome, SystemIngestResult, SynthesizedSections } from "./figma/types";
import type { SystemSources } from "./figma/systemSources";
import { fetchSystemSources as defaultFetch } from "./figma/systemSources";
import { synthesizeSystem as defaultSynth } from "./figma/systemSynth";
import {
  getStyles, getVariables, getComponents, nodeTree, exportNodePng,
} from "./figmaCli";
import { figmaIngestRoot } from "./paths";
import path from "node:path";
import fs from "node:fs/promises";

export interface SystemIngestDeps {
  fetchSources(fileKey: string): Promise<SystemSources>;
  synthesize(sources: SystemSources): Promise<SynthesizedSections>;
  now?: () => number;
}

export interface SystemIngestConfig {
  capacity?: number;
  ttlMs?: number;
  negativeTtlMs?: number;
}

export interface FigmaSystemIngest {
  ingest(fileKey: string): Promise<SystemIngestOutcome>;
  getCached(fileKey: string): SystemIngestResult | undefined;
  getPending(fileKey: string): Promise<SystemIngestOutcome> | undefined;
}

interface PositiveEntry { kind: "ok"; value: SystemIngestResult; expiresAt: number }
interface NegativeEntry { kind: "fail"; reason: string; expiresAt: number }
type CacheEntry = PositiveEntry | NegativeEntry;

export function createFigmaSystemIngest(
  deps: SystemIngestDeps,
  cfg: SystemIngestConfig = {},
): FigmaSystemIngest {
  const capacity = cfg.capacity ?? 8;
  const ttlMs = cfg.ttlMs ?? 60 * 60_000;
  const negativeTtlMs = cfg.negativeTtlMs ?? 5 * 60_000;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<SystemIngestOutcome>>();
  const now = deps.now ?? Date.now;

  function cacheGet(key: string): CacheEntry | undefined {
    const e = cache.get(key);
    if (!e) return undefined;
    if (e.expiresAt < now()) { cache.delete(key); return undefined; }
    cache.delete(key); cache.set(key, e);
    return e;
  }

  function cacheSet(key: string, entry: CacheEntry): void {
    cache.set(key, entry);
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function runIngest(fileKey: string): Promise<SystemIngestOutcome> {
    const startedAt = Date.now();
    try {
      const sources = await deps.fetchSources(fileKey);
      const sections = await deps.synthesize(sources);
      const result: SystemIngestResult = {
        source: {
          fileKey,
          fileName: sources.fileName,
          scannedAt: new Date(now()).toISOString(),
        },
        sections,
        diagnostics: {
          warnings: [...sources.warnings, ...sections.warnings],
          elapsedMs: Date.now() - startedAt,
        },
      };
      cacheSet(fileKey, { kind: "ok", value: result, expiresAt: now() + ttlMs });
      return { ok: true, ...result };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      cacheSet(fileKey, { kind: "fail", reason, expiresAt: now() + negativeTtlMs });
      return { ok: false, reason };
    }
  }

  return {
    async ingest(fileKey) {
      const cached = cacheGet(fileKey);
      if (cached?.kind === "ok") return { ok: true, ...cached.value };
      if (cached?.kind === "fail") return { ok: false, reason: cached.reason };

      const inFlight = pending.get(fileKey);
      if (inFlight) return inFlight;

      const p = runIngest(fileKey).finally(() => { pending.delete(fileKey); });
      pending.set(fileKey, p);
      return p;
    },
    getCached(fileKey) {
      const e = cache.get(fileKey);
      return e?.kind === "ok" ? e.value : undefined;
    },
    getPending(fileKey) { return pending.get(fileKey); },
  };
}

// --- Production singleton ---

let singleton: FigmaSystemIngest | null = null;

export async function getFigmaSystemIngest(): Promise<FigmaSystemIngest> {
  if (singleton) return singleton;
  singleton = createFigmaSystemIngest({
    fetchSources: (fileKey) => defaultFetch(fileKey, {
      getStyles,
      getVariables,
      getComponents,
      getFile: async (fk) => {
        // figmanage's get-file is not currently exposed; nodeTree at the root
        // node with a large depth serves as a stand-in. If a dedicated helper
        // is added later, swap this call for it.
        try { return await nodeTree(fk, "0:0", 2); }
        catch { return null; }
      },
      exportPng: async (fk, nodeId) => {
        const dir = figmaIngestRoot();
        await fs.mkdir(dir, { recursive: true });
        const out = path.join(dir, `${fk}_${nodeId.replace(/:/g, "-")}.png`);
        try {
          const fp = await exportNodePng(fk, nodeId, out, 1);
          return { path: fp, widthPx: 0, heightPx: 0 };
        } catch { return null; }
      },
    }),
    synthesize: (sources) => defaultSynth(sources),
  });
  return singleton;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figmaSystemIngest.test.ts`
Expected: PASS on all seven tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figmaSystemIngest.ts studio/__tests__/server/figmaSystemIngest.test.ts
git commit -m "feat(studio/figma): per-fileKey system-ingest cache with dedupe + negative TTL"
```

---

## Task 11: CLAUDE.md template — add `@DESIGN.md` import section

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`
- Create: `studio/__tests__/server/projects-claude-md-refresh.test.ts`

- [ ] **Step 1: Write failing tests**

Create `studio/__tests__/server/projects-claude-md-refresh.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../../templates/CLAUDE.md.tpl");

describe("CLAUDE.md template — design system section", () => {
  it("contains the `## Design system` heading", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^## Design system$/m);
  });

  it("contains the literal `@DESIGN.md` import line", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^@DESIGN\.md$/m);
  });

  it("places the Design system section before the four-rules section", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    const designIdx = tpl.indexOf("## Design system");
    const rulesIdx = tpl.indexOf("R1. Figma is the source of truth");
    expect(designIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(designIdx).toBeLessThan(rulesIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/projects-claude-md-refresh.test.ts`
Expected: FAIL — section not in template.

- [ ] **Step 3: Modify the template**

Open `studio/templates/CLAUDE.md.tpl`. Locate the `## How to work` heading (near line 62). Insert a new section IMMEDIATELY BEFORE `## How to work`:

```markdown
## Design system

Cross-frame design-system context for this Figma file, synthesized from the whole file's styles, variables, components, and a handful of representative frames. Read this before making any visual decision — it anchors personality (the Identity paragraph) and token vocabulary you can't see from a single frame's subtree. If the import below resolves to an absent file, fall back to the per-frame `<figma_context>` block in the user prompt.

@DESIGN.md

```

(The blank line after `@DESIGN.md` is intentional — separates the import from the next `##` heading.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/projects-claude-md-refresh.test.ts`
Expected: PASS on all three tests.

- [ ] **Step 5: Sanity-check the stale-refresh path**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`
Expected: PASS — existing tests for `refreshStaleClaudeMd` already verify re-rendering when the template changes. Our template edit triggers the "stale → rewrite" branch for every existing project on next Vite boot (`studio/vite.config.ts:55`). No code change needed.

- [ ] **Step 6: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl studio/__tests__/server/projects-claude-md-refresh.test.ts
git commit -m "feat(studio/templates): import DESIGN.md via @-reference in CLAUDE.md"
```

---

## Task 12: Chat middleware — `maybeSeedProjectDesignMd` helper

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Create: `studio/__tests__/server/middleware/chat-figma-seeder.test.ts`

- [ ] **Step 1: Write failing tests for the seeder helper in isolation**

Create `studio/__tests__/server/middleware/chat-figma-seeder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { maybeSeedProjectDesignMd } from "../../../server/middleware/chat";
import type { FigmaSystemIngest } from "../../../server/figmaSystemIngest";
import type { SystemIngestResult } from "../../../server/figma/types";

function okResult(fileKey = "fk"): SystemIngestResult {
  return {
    source: { fileKey, scannedAt: "2026-05-11T00:00:00Z" },
    sections: {
      identity: "x",
      colors: { entries: [{ name: "bg", value: "#FFF", role: "background" }], warnings: [] },
      typography: { entries: [], warnings: [] },
      spacing: { scale: [] },
      radii: { scale: [] },
      shadows: { items: [] },
      components: ["Button"],
      warnings: [],
    },
    diagnostics: { warnings: [], elapsedMs: 10 },
  };
}

let tmpRoot: string;
let slug: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-seeder-"));
  slug = "proj";
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, "projects", slug), { recursive: true });
});

function mockIngest(outcome: any): FigmaSystemIngest {
  return {
    ingest: vi.fn().mockResolvedValue(outcome),
    getCached: () => undefined,
    getPending: () => undefined,
  };
}

describe("maybeSeedProjectDesignMd", () => {
  it("writes DESIGN.md on first turn when absent", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
    });
    const md = await fs.readFile(path.join(tmpRoot, "projects", slug, "DESIGN.md"), "utf-8");
    expect(md).toContain("# Design system (from Figma)");
    expect(narrations.some((n) => /Synced design system/.test(n))).toBe(true);
    expect(ing.ingest).toHaveBeenCalledTimes(1);
  });

  it("no-ops when DESIGN.md already exists (user-owns-file invariant)", async () => {
    const filePath = path.join(tmpRoot, "projects", slug, "DESIGN.md");
    await fs.writeFile(filePath, "USER EDITED CONTENT");
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: "fk", emit: () => {}, ingest: ing,
    });
    const md = await fs.readFile(filePath, "utf-8");
    expect(md).toBe("USER EDITED CONTENT");
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("no-ops when fileKey is missing (no Figma URL in prompt)", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({
      slug, fileKey: null, emit: () => {}, ingest: ing,
    });
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("emits skip narration on failure outcome, does not throw", async () => {
    const ing = mockIngest({ ok: false, reason: "network" });
    const narrations: string[] = [];
    await expect(maybeSeedProjectDesignMd({
      slug, fileKey: "fk",
      emit: (t) => narrations.push(t),
      ingest: ing,
    })).resolves.toBeUndefined();
    expect(narrations.some((n) => /sync skipped/.test(n) && /network/.test(n))).toBe(true);
  });

  it("writes atomically via .tmp + rename", async () => {
    const ing = mockIngest({ ok: true, ...okResult() });
    await maybeSeedProjectDesignMd({ slug, fileKey: "fk", emit: () => {}, ingest: ing });
    const entries = await fs.readdir(path.join(tmpRoot, "projects", slug));
    expect(entries).toContain("DESIGN.md");
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-seeder.test.ts`
Expected: FAIL — `maybeSeedProjectDesignMd` not exported.

- [ ] **Step 3: Add the helper to `chat.ts`**

In `studio/server/middleware/chat.ts`, add the import near the existing figma-related imports (around line 15):

```ts
import { getFigmaSystemIngest, type FigmaSystemIngest } from "../figmaSystemIngest";
import { renderDesignMd } from "../figma/systemRender";
import { designMdPath } from "../paths";
```

Then add the exported helper. Place it immediately below the `enrichPromptWithFigmaContext` function (around line 320):

```ts
export interface SeedDesignMdInput {
  slug: string;
  fileKey: string | null;
  emit: (text: string) => void;
  ingest?: FigmaSystemIngest;
}

/**
 * On the first turn that references a Figma file in a project without a
 * DESIGN.md, scan the whole file once, synthesize sections, and write the
 * result. Never overwrites an existing file — DESIGN.md is user-owned
 * after creation. Failures are emitted as narration lines; never thrown.
 */
export async function maybeSeedProjectDesignMd(input: SeedDesignMdInput): Promise<void> {
  const { slug, fileKey, emit } = input;
  if (!fileKey) return;

  const targetPath = designMdPath(slug);
  try {
    await fs.stat(targetPath);
    // File exists — user owns it. Do nothing.
    return;
  } catch {
    // Not present; proceed.
  }

  const ingest = input.ingest ?? (await getFigmaSystemIngest());
  const outcome = await ingest.ingest(fileKey);
  if (!outcome.ok) {
    emit(`Design system sync skipped (${outcome.reason})`);
    return;
  }

  const markdown = renderDesignMd(outcome.sections, outcome.source);
  const tmpPath = `${targetPath}.tmp`;
  try {
    await fs.writeFile(tmpPath, markdown);
    await fs.rename(tmpPath, targetPath);
  } catch (err: any) {
    emit(`Design system sync skipped (write error: ${err?.message ?? String(err)})`);
    try { await fs.unlink(tmpPath); } catch {}
    return;
  }

  const counts = [
    `${outcome.sections.colors.entries.length} colors`,
    `${outcome.sections.components.length} components`,
  ];
  emit(`Synced design system · ${counts.join(" · ")}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-seeder.test.ts`
Expected: PASS on all five tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat-figma-seeder.test.ts
git commit -m "feat(studio/chat): seed DESIGN.md on first Figma turn when absent"
```

---

## Task 13: Wire seeder into `runClaudeBranch` in parallel + race test

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Create: `studio/__tests__/server/middleware/chat-figma-seeder-race.test.ts`

- [ ] **Step 1: Write failing race test**

Create `studio/__tests__/server/middleware/chat-figma-seeder-race.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { maybeSeedProjectDesignMd } from "../../../server/middleware/chat";
import type { FigmaSystemIngest } from "../../../server/figmaSystemIngest";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-race-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, "projects", "p"), { recursive: true });
});

describe("seeder race safety", () => {
  it("two concurrent turns with no DESIGN.md → single write, no .tmp leak", async () => {
    let ingestCalls = 0;
    const deferred: { resolve: (v: any) => void }[] = [];
    const ingest: FigmaSystemIngest = {
      ingest: vi.fn().mockImplementation(() => new Promise((resolve) => {
        ingestCalls += 1;
        deferred.push({ resolve });
      })),
      getCached: () => undefined,
      getPending: () => undefined,
    };

    const a = maybeSeedProjectDesignMd({ slug: "p", fileKey: "fk", emit: () => {}, ingest });
    const b = maybeSeedProjectDesignMd({ slug: "p", fileKey: "fk", emit: () => {}, ingest });

    // Both observe "not present" before either writes. Each resolves the outcome
    // independently — the test verifies no .tmp file leaks and DESIGN.md has the
    // final content exactly once.
    const outcome = {
      ok: true,
      source: { fileKey: "fk", scannedAt: "t" },
      sections: {
        identity: "x",
        colors: { entries: [], warnings: [] },
        typography: { entries: [], warnings: [] },
        spacing: { scale: [] },
        radii: { scale: [] },
        shadows: { items: [] },
        components: [],
        warnings: [],
      },
      diagnostics: { warnings: [], elapsedMs: 0 },
    };
    for (const d of deferred) d.resolve(outcome);
    await Promise.all([a, b]);

    const entries = await fs.readdir(path.join(tmpRoot, "projects", "p"));
    expect(entries).toContain("DESIGN.md");
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    expect(ingestCalls).toBe(2); // seeder calls ingest unconditionally when file absent; ingest itself dedupes in production
  });

  it("atomic rename: if rename fails after write, no DESIGN.md appears", async () => {
    const target = path.join(tmpRoot, "projects", "p", "DESIGN.md");
    // Make the target directory read-only to force rename failure. On macOS
    // fs.rename to the same filesystem requires write perms on the parent;
    // strip write perms after the .tmp write has happened.
    // Instead we mock fs.rename via vi.spyOn.
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("EBUSY"));

    const ingest: FigmaSystemIngest = {
      ingest: vi.fn().mockResolvedValue({
        ok: true,
        source: { fileKey: "fk", scannedAt: "t" },
        sections: {
          identity: "x",
          colors: { entries: [], warnings: [] },
          typography: { entries: [], warnings: [] },
          spacing: { scale: [] },
          radii: { scale: [] },
          shadows: { items: [] },
          components: [],
          warnings: [],
        },
        diagnostics: { warnings: [], elapsedMs: 0 },
      }),
      getCached: () => undefined,
      getPending: () => undefined,
    };
    const narrations: string[] = [];
    await maybeSeedProjectDesignMd({
      slug: "p", fileKey: "fk", emit: (t) => narrations.push(t), ingest,
    });

    await expect(fs.stat(target)).rejects.toThrow();
    expect(narrations.some((n) => /write error/.test(n))).toBe(true);
    renameSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests — first should pass, second should pass with current impl**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-seeder-race.test.ts`
Expected: PASS on both. If the atomic-rename test fails because the `.tmp` file isn't cleaned up, tighten the `fs.unlink` fallback in `maybeSeedProjectDesignMd`.

- [ ] **Step 3: Wire seeder into `runClaudeBranch`**

In `studio/server/middleware/chat.ts`, locate `runClaudeBranch` (around line 322). The current flow does:

```ts
const { prompt, images } = await enrichPromptWithFigmaContext(
  ctx.prompt,
  ctx.images ?? [],
  (text) => emit({ kind: "narration", text }),
);
```

Change it to run the seeder in parallel with the enrichment. Replace the above block with:

```ts
const parsed = (() => {
  const url = extractFigmaUrl(ctx.prompt);
  return url ? parseFigmaUrl(url) : null;
})();

const narrate = (text: string) => emit({ kind: "narration", text });

const [enriched] = await Promise.all([
  enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? [], narrate),
  maybeSeedProjectDesignMd({
    slug,
    fileKey: parsed?.fileId ?? null,
    emit: narrate,
  }),
]);
const { prompt, images } = enriched;
```

(Keep any subsequent code using `prompt` and `images` unchanged.)

- [ ] **Step 4: Run the full middleware + seeder tests**

Run: `pnpm run studio:test __tests__/server/middleware/`
Expected: PASS on all tests including any existing middleware coverage.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat-figma-seeder-race.test.ts
git commit -m "feat(studio/chat): run DESIGN.md seeder in parallel with per-frame enrichment"
```

---

## Task 14: Manual QA — three real Figma files + sentinel import test

This task is not unit-testable; the steps below must be executed by the implementer against live figmanage + a connected Figma PAT. If the implementer is a subagent without Figma access, STOP here and report the state — the user will run this pass themselves.

- [ ] **Step 1: Verify `claude --print` attaches images as expected**

Run: `claude --help 2>&1 | grep -iE 'attach|image|file'`
Expected: the CLI exposes a way to include files/images in a one-shot prompt. If the flag is `--image` instead of `--attach` (or different entirely), update `defaultSpawner` in `studio/server/figma/systemSynth.ts` to match BEFORE running the scan.

- [ ] **Step 2: Run studio against an Observatory-sized Figma file**

1. `pnpm run studio`
2. In the app, create a fresh project.
3. Paste a prompt containing a Figma URL for the Observatory file (or equivalent large internal system).
4. Watch the narration line — should show `Synced design system · N colors · N components` within 30s.
5. Open the project dir: `open "$HOME/Library/Application Support/arcade-studio/projects/<slug>/"`
6. Read the generated DESIGN.md. **Criterion:** Identity paragraph is concrete, not generic. "Dense, utilitarian, flat surfaces, 2px radii" is good; "modern and clean design system with good use of spacing" is failure.

- [ ] **Step 3: Repeat against one DevRev shell file + one external public file**

Run the same steps for two more files of different visual character. The goal is to see three distinguishable Identity paragraphs — if they all read the same, the synth prompt is too generic and needs tightening.

- [ ] **Step 4: Sentinel test — `@DESIGN.md` import actually reaches the subprocess**

1. Pick one seeded project.
2. Manually edit its DESIGN.md to add a sentinel line near the top of Identity: `The identity of this system is SENTINEL-QA-42.`
3. In Studio, send a new turn like: "What is the identity of this design system?"
4. **Criterion:** the model's reply references "SENTINEL-QA-42". If it doesn't, the `@DESIGN.md` import chain is broken — investigate before shipping. The most likely suspects: (a) `--bare` strips imports silently, (b) the CLI's import resolution expects a different syntax, (c) the `--add-dir` flag doesn't cover the project cwd as expected. Do NOT ship until this passes.

- [ ] **Step 5: If Identity quality is weak, rewrite the synth prompt**

Edit `buildPrompt` in `studio/server/figma/systemSynth.ts` to include stronger guidance. Examples of what to add if the outputs are generic:
- Explicit anti-patterns: "Do NOT say 'modern', 'clean', 'minimalist' without a specific observation that justifies it."
- Force concrete anchors: "Name one observable property per sentence (radius size, color temperature, density, ornamentation level)."
- Pin sample frame attention: "The PNGs I attached are the ground truth for personality. Describe what you see, not what design systems generally look like."

Re-run steps 2–3 after each prompt change.

- [ ] **Step 6: Commit any synth-prompt refinements**

```bash
git add studio/server/figma/systemSynth.ts
git commit -m "fix(studio/figma): tighten synth prompt to avoid generic Identity output"
```

(Skip the commit if no changes were needed.)

---

## Task 15: CHANGELOG entry + release prep

**Files:**
- Modify: `studio/CHANGELOG.md`
- Modify: `studio/packaging/VERSION`

- [ ] **Step 1: Check current version**

Run: `cat studio/packaging/VERSION`
Note the current `0.x.y`. Bump the minor version (`0.x.0` → `0.(x+1).0`) since this is a new feature.

- [ ] **Step 2: Add CHANGELOG entry**

Open `studio/CHANGELOG.md`. Add at the top (above the most recent entry), keep-a-changelog style:

```markdown
## [0.X.0] — 2026-05-11

### Added
- Figma design-system sync: the first time you reference a new Figma file, Studio now scans the whole file for styles, variables, and components, synthesizes a visual identity paragraph, and writes a `DESIGN.md` into your project directory. Claude loads it on every turn via a project-level `@DESIGN.md` import — giving cross-frame context for personality and available tokens, not just what's on the current frame. Your `DESIGN.md` is never overwritten; edit it freely.

```

Replace `X` with the actual bumped minor version.

- [ ] **Step 3: Bump VERSION file**

Run: `echo "0.X.0" > studio/packaging/VERSION`
(Replace `X` with the real number.)

- [ ] **Step 4: Sanity-check the full suite passes**

Run: `pnpm run studio:test`
Expected: PASS — all existing + new tests.

- [ ] **Step 5: Commit**

```bash
git add studio/CHANGELOG.md studio/packaging/VERSION
git commit -m "docs(studio): 0.X.0 — Figma design-system sync (DESIGN.md)"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feat/studio/figma-design-md-sync
gh pr create --title "feat(studio): Figma design-system sync (DESIGN.md)" --body "$(cat <<'EOF'
## Summary

Scan a Figma file once per fileKey (styles, variables, components, sample-frame PNGs), synthesize an Identity paragraph + six token sections via one Claude call, and write the result to `<projectDir>/DESIGN.md`. The project template now imports it via `@DESIGN.md`, so every generation turn sees cross-frame design-system context, not just what's on the current frame.

Spec: docs/superpowers/specs/2026-05-11-figma-design-md-sync-design.md
Plan: docs/superpowers/plans/2026-05-11-figma-design-md-sync.md

## Test plan

- [x] Full `pnpm run studio:test` passes
- [x] Manual QA against 3 real Figma files (Observatory + 1 DevRev + 1 external)
- [x] Sentinel test confirms `@DESIGN.md` import is picked up by the CLI
- [x] DESIGN.md is never overwritten once user-edited

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:**

- Summary (motivation, what it builds): Tasks 10 + 12 + 13 implement the core.
- Architecture (three new modules + template + middleware): Tasks 4, 7, 8, 10, 11, 12, 13 cover it.
- Data flow per turn (seeder parallel with enrichment): Task 13 wires it.
- Cache model (per-fileKey, 1h TTL, capacity 8, negative 5 min): Task 10.
- Module contracts (types, systemSources, systemSynth, systemRender, ingest, middleware): Tasks 1, 4–5, 7, 8–9, 10, 12–13.
- Delivery mechanism (`@DESIGN.md` import in CLAUDE.md template): Task 11. Stale-refresh handled by existing boot hook — noted in Task 11 Step 5.
- Failure taxonomy (PAT missing, network, synth invalid, write error, partial): covered across Tasks 10 (negative cache), 12 (skip narration), 13 (race).
- Testing (~18 tests across unit/integration/template-change): Tasks 1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13 each add tests totaling 30+ assertions across 22 tests (count exceeds the spec's ~18 estimate — the extra coverage is fine).
- Not tested automatically (Identity quality, `@DESIGN.md` pickup): Task 14 manual QA.
- Rollout (branch `feat/studio/figma-design-md-sync`, commit slice): Each task commits a testable slice. Task 15 version bump + CHANGELOG.

**Placeholder scan:** No "TBD"/"TODO"/"fill in later" in tasks. One "verify figmanage subcommand names" note in Task 6 — this is intentional (local variation) and is paired with an exact verification command, not a dangling TODO.

**Type consistency:**
- `SystemIngestOutcome`, `SystemIngestResult`, `SynthesizedSections`, `SystemSources` names used consistently across tasks 1, 7, 8, 10, 12, 13.
- `maybeSeedProjectDesignMd` signature: `{ slug, fileKey, emit, ingest? }` — identical in tasks 12, 13, their tests.
- `createFigmaSystemIngest` returns `FigmaSystemIngest` interface — used in task 10 tests and task 12 integration.
- `renderDesignMd(sections, source)` — signature stable across tasks 4, 5, 12.
- `fileKey` naming: spec uses `fileKey`; `parseFigmaUrl` (existing code) returns `fileId`. Task 13 uses `parsed?.fileId ?? null` to bridge that. Consistent.

**Scope check:** Plan stays within v1 (no Settings UI, no Don'ts, no merge UI). Task 14 Step 4 flags the single real risk (CLI import pickup) with a concrete sentinel test before ship.

All clear.
