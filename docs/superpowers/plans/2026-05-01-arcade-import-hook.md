# Arcade Import Validation Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Code PostToolUse hook that validates named imports from `"arcade/components"` and `"arcade-prototypes"` against their real barrels, blocking hallucinated names (e.g. `ArrowsUpDownSmall`) with "Did you mean" suggestions so the generating agent self-corrects in the same turn instead of shipping a broken frame.

**Architecture:** Single new hook file `studio/server/hooks/validateArcadeImports.mjs`, mirroring the shape of the existing `blockImageReshape.mjs`: pure-function exports (testable as a library) plus a `main()` that reads stdin, validates, and exits 0 or 2. The hook is registered in `claudeCode.ts` alongside the existing Bash hook, matching `Write` and `Edit`. Validation is regex-based over machine-generated barrel files; fuzzy-match via Levenshtein for suggestions. Fails open on any environmental error.

**Tech Stack:** Node ESM (.mjs), Vitest for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-01-arcade-import-hook-design.md`

## File Structure

**New files (under `studio/`):**

- `server/hooks/validateArcadeImports.mjs` — the hook. All logic lives here; pure-function exports for tests plus a `main()` for runtime.
- `__tests__/server/hooks/validateArcadeImports.test.ts` — unit tests against the pure functions + integration test via child_process.
- `__tests__/fixtures/hooks/arcade-gen/src/components/index.ts` — fake primitives barrel (~10 entries).
- `__tests__/fixtures/hooks/arcade-gen/src/components/icons/index.ts` — fake icons barrel (~10 entries).
- `__tests__/fixtures/hooks/prototype-kit/index.ts` — fake prototypes barrel (~5 entries).

**Modified files (under `studio/`):**

- `server/claudeCode.ts` — register the new PostToolUse hook.
- `templates/CLAUDE.md.tpl` — one-line addition under the "Icons" section.
- `CHANGELOG.md` — `[0.4.3]` entry.
- `packaging/VERSION` — bump to `0.4.3`.

**Commit granularity:** one commit per task. Scope `studio/figma-import-hook` for feature commits, `studio/packaging` for version bump, `docs(studio)` for changelog.

---

### Task 1: Fake barrel fixtures

**Files:**
- Create: `studio/__tests__/fixtures/hooks/arcade-gen/src/components/index.ts`
- Create: `studio/__tests__/fixtures/hooks/arcade-gen/src/components/icons/index.ts`
- Create: `studio/__tests__/fixtures/hooks/prototype-kit/index.ts`

- [ ] **Step 1: Create the primitives barrel**

Create `studio/__tests__/fixtures/hooks/arcade-gen/src/components/index.ts`:

```ts
// Fake primitives barrel for hook tests. Shape mirrors the real arcade-gen
// barrel (machine-generated, one export per line). Kept small so the tests
// have a manageable namespace to validate against.

export { Button, buttonVariants } from "./ui/Button/index.js";
export type { ButtonProps } from "./ui/Button/index.js";
export { IconButton } from "./ui/IconButton/index.js";
export type { IconButtonProps } from "./ui/IconButton/index.js";
export { Input } from "./ui/Input/index.js";
export { Select } from "./ui/Select/index.js";
export { Switch } from "./ui/Switch/index.js";
export { Dialog } from "./ui/Dialog/index.js";
export { Avatar } from "./ui/Avatar/index.js";
export { Separator } from "./ui/Separator/index.js";
```

- [ ] **Step 2: Create the icons barrel**

Create `studio/__tests__/fixtures/hooks/arcade-gen/src/components/icons/index.ts`:

```ts
// Fake icons barrel for hook tests. Mirrors the shape of the real arcade-gen
// icons barrel — one `export { X } from "./X.js"` per line — but only contains
// the handful of names the tests reference.

export type { IconProps } from "./types.js";

export { ArrowDownSmall } from "./ArrowDownSmall.js";
export { ArrowUpSmall } from "./ArrowUpSmall.js";
export { ArrowsUpAndDown } from "./ArrowsUpAndDown.js";
export { ChevronDownSmall } from "./ChevronDownSmall.js";
export { ChevronLeftSmall } from "./ChevronLeftSmall.js";
export { ChevronRightSmall } from "./ChevronRightSmall.js";
export { ChevronUpAndDownSmall } from "./ChevronUpAndDownSmall.js";
export { MagnifyingGlass } from "./MagnifyingGlass.js";
export { PlusSmall } from "./PlusSmall.js";
export { ThreeDotsHorizontal } from "./ThreeDotsHorizontal.js";
```

- [ ] **Step 3: Create the prototype-kit barrel**

Create `studio/__tests__/fixtures/hooks/prototype-kit/index.ts`:

```ts
// Fake prototype-kit barrel for hook tests. Shape mirrors
// studio/prototype-kit/index.ts — a flat list of exported composite/template
// names — but only the handful the tests reference.

export { AppShell } from "./composites/AppShell.js";
export { NavSidebar } from "./composites/NavSidebar.js";
export { ComputerSidebar } from "./composites/ComputerSidebar.js";
export { VistaHeader } from "./composites/VistaHeader.js";
export { VistaPage } from "./templates/VistaPage.js";
```

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/fixtures/hooks/
git commit -m "test(studio/figma-import-hook): add fake barrel fixtures"
```

---

### Task 2: `parseImports` — failing test + implementation

**Files:**
- Create: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`
- Create: `studio/server/hooks/validateArcadeImports.mjs`

This task sets up the file skeleton and implements the first pure export (`parseImports`). Later tasks add `loadBarrel`, `validateImports`, `formatErrorMessage`, and `main()`.

- [ ] **Step 1: Write the failing `parseImports` tests**

Create `studio/__tests__/server/hooks/validateArcadeImports.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { parseImports } from "../../../server/hooks/validateArcadeImports.mjs";

describe("parseImports", () => {
  it("extracts named imports from arcade/components", () => {
    const src = `import { Button, IconButton } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton"] },
    ]);
  });

  it("extracts named imports from arcade-prototypes", () => {
    const src = `import { AppShell } from "arcade-prototypes";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade-prototypes", names: ["AppShell"] },
    ]);
  });

  it("handles multi-line import statements", () => {
    const src = `import {\n  Button,\n  IconButton,\n  Avatar,\n} from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton", "Avatar"] },
    ]);
  });

  it("ignores imports from untracked sources", () => {
    const src = [
      `import React from "react";`,
      `import { useState } from "react";`,
      `import foo from "./local";`,
      `import fs from "node:fs";`,
    ].join("\n");
    expect(parseImports(src)).toEqual([]);
  });

  it("resolves 'Foo as Bar' by recording the source name Foo", () => {
    const src = `import { Button as Btn, IconButton } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton"] },
    ]);
  });

  it("dedupes repeated names within a source", () => {
    const src = `import { Button } from "arcade/components";\nimport { Button, Avatar } from "arcade/components";`;
    const result = parseImports(src);
    expect(result).toHaveLength(1);
    expect(result[0].names.sort()).toEqual(["Avatar", "Button"]);
  });

  it("skips 'type'-prefixed tokens", () => {
    const src = `import { type ButtonProps, Button } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button"] },
    ]);
  });

  it("returns [] when there are no tracked imports", () => {
    expect(parseImports(`const x = 1;`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests, expect them to fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: FAIL — `Cannot find module '../../../server/hooks/validateArcadeImports.mjs'`.

- [ ] **Step 3: Implement the hook skeleton with `parseImports` only**

Create `studio/server/hooks/validateArcadeImports.mjs`:

```js
#!/usr/bin/env node
// PostToolUse hook: validate named imports from "arcade/components" and
// "arcade-prototypes" against the real barrels. Blocks Write/Edit tool
// calls that introduce hallucinated names (e.g. ArrowsUpDownSmall), with
// Did-you-mean suggestions so the agent can self-correct in the same turn.
//
// Mirrors the shape of blockImageReshape.mjs: pure-function exports for
// tests, plus a main() that reads stdin and exits 0 or 2. Fails open on
// any parse/runtime error — a broken hook must not wedge a real generation.

const TRACKED_SOURCES = ["arcade/components", "arcade-prototypes"];

/**
 * Parse named imports from the file's source text. Returns one entry per
 * tracked source, deduplicated. Ignores imports from untracked sources
 * (react, relatives, node:, third-party) entirely.
 *
 * For `import { Foo as Bar } from <source>`, records Foo (the source name
 * that must exist in the barrel), not Bar (the local alias).
 */
export function parseImports(source) {
  if (typeof source !== "string") return [];
  const re = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  const bySource = new Map();
  let m;
  while ((m = re.exec(source)) !== null) {
    const braceGroup = m[1];
    const src = m[2];
    if (!TRACKED_SOURCES.includes(src)) continue;
    const names = parseBraceGroup(braceGroup);
    if (!names.length) continue;
    if (!bySource.has(src)) bySource.set(src, new Set());
    const set = bySource.get(src);
    for (const name of names) set.add(name);
  }
  return [...bySource.entries()].map(([source, set]) => ({
    source,
    names: [...set],
  }));
}

function parseBraceGroup(group) {
  const tokens = group.split(",").map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    // Strip `type` prefix (`type Foo` or `type Foo as Bar`).
    let t = token;
    if (/^type\s+/.test(t)) continue;
    // `Foo as Bar` — keep Foo (source-side name).
    const asIdx = t.search(/\s+as\s+/);
    if (asIdx !== -1) t = t.slice(0, asIdx).trim();
    if (/^[A-Za-z_][\w$]*$/.test(t)) out.push(t);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests, expect them to pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
git commit -m "feat(studio/figma-import-hook): parseImports for tracked sources"
```

---

### Task 3: `loadBarrel` — failing test + implementation

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs`
- Modify: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`

- [ ] **Step 1: Append the failing `loadBarrel` tests**

Append to `studio/__tests__/server/hooks/validateArcadeImports.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { loadBarrel } from "../../../server/hooks/validateArcadeImports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../fixtures/hooks");

describe("loadBarrel", () => {
  it("extracts value exports from a machine-generated barrel", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/index.ts"));
    expect(barrel.has("Button")).toBe(true);
    expect(barrel.has("IconButton")).toBe(true);
    expect(barrel.has("Dialog")).toBe(true);
    // buttonVariants is a value export too, from the same line as Button.
    expect(barrel.has("buttonVariants")).toBe(true);
  });

  it("skips 'export type { ... }' type-only exports", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/index.ts"));
    expect(barrel.has("ButtonProps")).toBe(false);
    expect(barrel.has("IconButtonProps")).toBe(false);
    expect(barrel.has("IconProps")).toBe(false);
  });

  it("resolves 'Foo as Bar' by recording Bar (publicly importable name)", () => {
    const tmp = fs.mkdtempSync(path.join(__dirname, "tmp-barrel-"));
    try {
      const p = path.join(tmp, "index.ts");
      fs.writeFileSync(p, `export { InternalName as PublicName } from "./x.js";\n`);
      const barrel = loadBarrel(p);
      expect(barrel.has("PublicName")).toBe(true);
      expect(barrel.has("InternalName")).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty Set when the file is missing", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "does-not-exist.ts"));
    expect(barrel.size).toBe(0);
  });

  it("returns an empty Set when the file is empty", () => {
    const tmp = fs.mkdtempSync(path.join(__dirname, "tmp-barrel-"));
    try {
      const p = path.join(tmp, "empty.ts");
      fs.writeFileSync(p, "");
      const barrel = loadBarrel(p);
      expect(barrel.size).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("collects icon-barrel entries", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/icons/index.ts"));
    expect(barrel.has("ArrowsUpAndDown")).toBe(true);
    expect(barrel.has("ChevronUpAndDownSmall")).toBe(true);
    expect(barrel.has("MagnifyingGlass")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect `loadBarrel` tests to fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: 8 `parseImports` tests PASS, 6 `loadBarrel` tests FAIL with `loadBarrel is not a function`.

- [ ] **Step 3: Implement `loadBarrel`**

Append to `studio/server/hooks/validateArcadeImports.mjs`:

```js
import { readFileSync } from "node:fs";

/**
 * Load publicly-importable value-export names from a barrel file.
 * Skips `export type { ... }` and `export { type X }` — those are not
 * importable as values. For `export { Foo as Bar }`, records Bar (what
 * consumers can `import { Bar } from "..."`).
 *
 * Returns an empty Set on any I/O or parse error. The caller interprets
 * that as "fail open for this source" — we validate what we can.
 */
export function loadBarrel(absPath) {
  let text;
  try { text = readFileSync(absPath, "utf-8"); }
  catch { return new Set(); }
  return extractBarrelExports(text);
}

export function extractBarrelExports(text) {
  const out = new Set();
  // Match `export { ... } from "..."` statements, case-sensitive.
  // The brace group may span multiple lines.
  const re = /export\s+(type\s+)?\{([^}]+)\}\s+from\s+["'][^"']+["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const isTypeOnlyBlock = Boolean(m[1]);
    if (isTypeOnlyBlock) continue;
    const braceGroup = m[2];
    for (const name of parseBarrelBraceGroup(braceGroup)) out.add(name);
  }
  return out;
}

function parseBarrelBraceGroup(group) {
  const tokens = group.split(",").map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    // Skip per-token `type` — `export { type Foo }` is not a value.
    if (/^type\s+/.test(token)) continue;
    // `Foo as Bar` — the publicly importable name is Bar.
    const asMatch = token.match(/^([A-Za-z_][\w$]*)\s+as\s+([A-Za-z_][\w$]*)$/);
    if (asMatch) { out.push(asMatch[2]); continue; }
    if (/^[A-Za-z_][\w$]*$/.test(token)) out.push(token);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests, expect all to pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — 14 tests total.

- [ ] **Step 5: Commit**

```bash
git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
git commit -m "feat(studio/figma-import-hook): loadBarrel for barrel files"
```

---

### Task 4: `validateImports` — failing test + implementation

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs`
- Modify: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`

- [ ] **Step 1: Append the failing `validateImports` tests**

Append:

```ts
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { validateImports } from "../../../server/hooks/validateArcadeImports.mjs";

describe("validateImports", () => {
  const barrels = {
    "arcade/components": new Set([
      "Button", "IconButton", "Input", "Dialog", "Avatar",
      "ArrowsUpAndDown", "ChevronUpAndDownSmall", "ArrowDownSmall",
    ]),
    "arcade-prototypes": new Set(["AppShell", "NavSidebar", "ComputerSidebar"]),
  };

  it("returns empty violations when every import exists", () => {
    const imports = [
      { source: "arcade/components", names: ["Button", "Avatar"] },
      { source: "arcade-prototypes", names: ["AppShell"] },
    ];
    expect(validateImports(imports, barrels)).toEqual([]);
  });

  it("flags a single bad name with top-3 suggestions", () => {
    const imports = [{ source: "arcade/components", names: ["ArrowsUpDownSmall"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe("arcade/components");
    expect(violations[0].badName).toBe("ArrowsUpDownSmall");
    expect(violations[0].suggestions.length).toBeGreaterThan(0);
    expect(violations[0].suggestions.length).toBeLessThanOrEqual(3);
    // ArrowsUpAndDown is the closest (4 edits); make sure it's included.
    expect(violations[0].suggestions).toContain("ArrowsUpAndDown");
  });

  it("drops suggestions whose Levenshtein distance is greater than 4", () => {
    const imports = [{ source: "arcade/components", names: ["Xyzzy"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(1);
    // "Xyzzy" is 5+ edits away from everything in the barrel → no suggestions.
    expect(violations[0].suggestions).toEqual([]);
  });

  it("flags multiple bad names", () => {
    const imports = [{ source: "arcade/components", names: ["Button", "BadOne", "BadTwo"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.badName).sort()).toEqual(["BadOne", "BadTwo"]);
  });

  it("flags bad names across multiple sources", () => {
    const imports = [
      { source: "arcade/components", names: ["BadIcon"] },
      { source: "arcade-prototypes", names: ["FakeComposite"] },
    ];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.source).sort()).toEqual(["arcade-prototypes", "arcade/components"]);
  });

  it("fails open (empty violations) when a source's barrel is empty", () => {
    const imports = [{ source: "arcade/components", names: ["ArrowsUpDownSmall"] }];
    const emptyBarrels = { "arcade/components": new Set(), "arcade-prototypes": new Set() };
    expect(validateImports(imports, emptyBarrels)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect the new tests to fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: prior tests PASS; new `validateImports` tests FAIL — `validateImports is not a function`.

- [ ] **Step 3: Implement `validateImports` + Levenshtein helper**

Append to `studio/server/hooks/validateArcadeImports.mjs`:

```js
export const MAX_SUGGESTION_DISTANCE = 4;
export const MAX_SUGGESTIONS = 3;

/**
 * Given a set of extracted imports and the loaded barrels, produce one
 * violation per (source, badName) pair with up to MAX_SUGGESTIONS
 * suggestions sorted by ascending Levenshtein distance, keeping only
 * those with distance <= MAX_SUGGESTION_DISTANCE.
 *
 * Fails open: if a source's barrel is empty (load failed), we skip
 * validation for that source rather than flagging everything as bad.
 */
export function validateImports(imports, barrels) {
  const violations = [];
  for (const { source, names } of imports) {
    const barrel = barrels[source];
    if (!barrel || barrel.size === 0) continue; // fail open for this source
    for (const name of names) {
      if (barrel.has(name)) continue;
      violations.push({
        source,
        badName: name,
        suggestions: topSuggestions(name, barrel),
      });
    }
  }
  return violations;
}

function topSuggestions(badName, barrel) {
  const scored = [];
  for (const candidate of barrel) {
    const d = levenshtein(badName, candidate);
    if (d <= MAX_SUGGESTION_DISTANCE) scored.push({ candidate, d });
  }
  scored.sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.candidate);
}

// Plain iterative Levenshtein — O(n*m) with two rolling rows. Inputs are
// short identifiers; no optimization needed.
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}
```

- [ ] **Step 4: Run the tests, expect all to pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — 20 tests total (8 parse + 6 barrel + 6 validate).

- [ ] **Step 5: Commit**

```bash
git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
git commit -m "feat(studio/figma-import-hook): validateImports with levenshtein suggestions"
```

---

### Task 5: `formatErrorMessage` — failing test + implementation

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs`
- Modify: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`

- [ ] **Step 1: Append the failing `formatErrorMessage` tests**

Append:

```ts
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { formatErrorMessage } from "../../../server/hooks/validateArcadeImports.mjs";

describe("formatErrorMessage", () => {
  const barrels = {
    "arcade/components": new Set(["Button", "IconButton", "ArrowsUpAndDown"]),
    "arcade-prototypes": new Set(["AppShell", "ComputerSidebar"]),
  };
  const barrelPaths = {
    "arcade/components": "/abs/arcade-gen/src/components/index.ts",
    "arcade-prototypes": "/abs/studio/prototype-kit/index.ts",
  };

  it("includes a per-source group header", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "FakeIcon", suggestions: ["ArrowsUpAndDown"] }],
      barrels, barrelPaths,
    );
    expect(msg).toContain(`In "arcade/components"`);
  });

  it("includes the top-3 suggestions inline", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "FakeIcon",
        suggestions: ["ArrowsUpAndDown", "IconButton", "Button"] }],
      barrels, barrelPaths,
    );
    expect(msg).toMatch(/did you mean.+ArrowsUpAndDown/i);
    expect(msg).toContain("IconButton");
    expect(msg).toContain("Button");
  });

  it("shows the barrel path when no suggestion meets the threshold", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "Xyzzy", suggestions: [] }],
      barrels, barrelPaths,
    );
    expect(msg).toContain("/abs/arcade-gen/src/components/index.ts");
    expect(msg).toContain("3 exports"); // includes size
  });

  it("groups multiple violations by source", () => {
    const msg = formatErrorMessage(
      [
        { source: "arcade/components", badName: "A", suggestions: ["Button"] },
        { source: "arcade/components", badName: "B", suggestions: ["IconButton"] },
        { source: "arcade-prototypes", badName: "C", suggestions: ["AppShell"] },
      ],
      barrels, barrelPaths,
    );
    expect(msg).toMatch(/In "arcade\/components".+\n.+A.+\n.+B/s);
    expect(msg).toMatch(/In "arcade-prototypes".+\n.+C/s);
  });
});
```

- [ ] **Step 2: Run, expect the new tests to fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: prior tests PASS; new `formatErrorMessage` tests FAIL.

- [ ] **Step 3: Implement `formatErrorMessage`**

Append to `studio/server/hooks/validateArcadeImports.mjs`:

```js
/**
 * Build the human-readable stderr message the hook emits on block.
 * Groups violations by source; for each bad name, emits the top-3
 * suggestions inline or the absolute barrel path if no suggestion met
 * the distance threshold. Export counts are included so the model's
 * size intuition is correct.
 */
export function formatErrorMessage(violations, barrels, barrelPaths) {
  const bySource = new Map();
  for (const v of violations) {
    if (!bySource.has(v.source)) bySource.set(v.source, []);
    bySource.get(v.source).push(v);
  }
  const lines = ["Blocked: some imports don't exist in their declared source.", ""];
  for (const [source, group] of bySource) {
    lines.push(`In "${source}":`);
    for (const v of group) {
      if (v.suggestions.length > 0) {
        lines.push(`  - \`${v.badName}\` — did you mean ${v.suggestions.map((s) => `\`${s}\``).join(", ")}?`);
      } else {
        const size = barrels[source]?.size ?? 0;
        const p = barrelPaths[source] ?? "<unknown>";
        lines.push(`  - \`${v.badName}\` — no near-matches.`);
        lines.push(`      Read ${p} for the full list of ${size} exports.`);
      }
    }
    lines.push("");
  }
  lines.push("Fix the names (or drop the symbol) and re-Write. This hook runs on");
  lines.push("every Write/Edit and will block again if the imports still don't exist.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests, expect all to pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — 24 tests total.

- [ ] **Step 5: Commit**

```bash
git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
git commit -m "feat(studio/figma-import-hook): formatErrorMessage with suggestions and barrel paths"
```

---

### Task 6: Hook entry point + integration tests

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs`
- Modify: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`

- [ ] **Step 1: Append the failing integration tests**

Append:

```ts
import { spawnSync } from "node:child_process";

const HOOK = path.resolve(__dirname, "../../../server/hooks/validateArcadeImports.mjs");

function runHook(payload, envOverrides = {}) {
  return spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      ARCADE_GEN_ROOT: path.join(FIXTURES, "arcade-gen"),
      ARCADE_PROTOTYPER_ROOT: FIXTURES,
      ...envOverrides,
    },
    encoding: "utf-8",
  });
}

describe("validateArcadeImports hook (integration)", () => {
  it("exits 0 when file_path is outside a .tsx file", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/foo.css",
        content: `import { BadIcon } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 0 when the file has no tracked imports", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import React from "react";\nexport default () => null;`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 0 when all imports are valid", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import { Button, IconButton } from "arcade/components";\nimport { AppShell } from "arcade-prototypes";`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 2 with a human-readable stderr on a bad import", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import { ArrowsUpDownSmall } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/Blocked/);
    expect(proc.stderr).toMatch(/ArrowsUpDownSmall/);
    expect(proc.stderr).toMatch(/did you mean/i);
    expect(proc.stderr).toMatch(/ArrowsUpAndDown/);
  });

  it("validates the new_string field for Edit tool calls", () => {
    const proc = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        old_string: `import { Button } from "arcade/components";`,
        new_string: `import { Button, ArrowsUpDownSmall } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/ArrowsUpDownSmall/);
  });

  it("fails open (exit 0) when barrels cannot be read", () => {
    const proc = runHook(
      {
        tool_name: "Write",
        tool_input: {
          file_path: "/tmp/frame.tsx",
          content: `import { ArrowsUpDownSmall } from "arcade/components";`,
        },
      },
      { ARCADE_GEN_ROOT: "/nonexistent/path", ARCADE_PROTOTYPER_ROOT: "/nonexistent/path" },
    );
    expect(proc.status).toBe(0);
  });

  it("fails open on malformed JSON input", () => {
    const proc = spawnSync("node", [HOOK], {
      input: "not json",
      env: { ...process.env, ARCADE_GEN_ROOT: path.join(FIXTURES, "arcade-gen") },
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect the new tests to fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: prior PASS; new integration tests FAIL because the hook's `main()` doesn't exist yet.

- [ ] **Step 3: Implement `main()` and the CLI entry point**

Append to `studio/server/hooks/validateArcadeImports.mjs`:

```js
import path from "node:path";

const HOME = process.env.HOME ?? "";
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? (HOME ? path.join(HOME, "arcade-gen") : "/__arcade_gen_unconfigured");
const ARCADE_PROTOTYPER_ROOT = process.env.ARCADE_PROTOTYPER_ROOT ?? "";

function barrelPathsForEnv() {
  return {
    "arcade/components": [
      path.join(ARCADE_GEN_ROOT, "src/components/index.ts"),
      path.join(ARCADE_GEN_ROOT, "src/components/icons/index.ts"),
    ],
    "arcade-prototypes": [
      ARCADE_PROTOTYPER_ROOT
        ? path.join(ARCADE_PROTOTYPER_ROOT, "prototype-kit/index.ts")
        : path.resolve(new URL("../../prototype-kit/index.ts", import.meta.url).pathname),
    ],
  };
}

function loadAllBarrels() {
  const paths = barrelPathsForEnv();
  const barrels = {};
  const resolvedPaths = {};
  for (const [source, files] of Object.entries(paths)) {
    const merged = new Set();
    for (const f of files) {
      for (const name of loadBarrel(f)) merged.add(name);
    }
    barrels[source] = merged;
    // Show the first file as the "canonical" path in error messages — the
    // one the model is most likely to Read.
    resolvedPaths[source] = files[0];
  }
  return { barrels, barrelPaths: resolvedPaths };
}

function isInScope(filePath) {
  if (typeof filePath !== "string") return false;
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return false;
  const base = path.basename(filePath);
  if (base === "index.errors.json" || base === "project.json") return false;
  return true;
}

function extractContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (toolName === "Write") return typeof toolInput.content === "string" ? toolInput.content : "";
  if (toolName === "Edit") return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  return "";
}

async function readStdin() {
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    process.exit(0);
  }
  const toolName = payload?.tool_name;
  const toolInput = payload?.tool_input;
  if (toolName !== "Write" && toolName !== "Edit") process.exit(0);
  const filePath = toolInput?.file_path;
  if (!isInScope(filePath)) process.exit(0);
  const content = extractContent(toolName, toolInput);
  if (!content) process.exit(0);

  const imports = parseImports(content);
  if (imports.length === 0) process.exit(0);

  const { barrels, barrelPaths } = loadAllBarrels();
  const violations = validateImports(imports, barrels);
  if (violations.length === 0) process.exit(0);

  process.stderr.write(formatErrorMessage(violations, barrels, barrelPaths));
  process.exit(2);
}

// Allow importing for tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => process.exit(0));
}
```

- [ ] **Step 4: Run the tests, expect all to pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — 31 tests total (24 pure + 7 integration).

- [ ] **Step 5: Commit**

```bash
git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
git commit -m "feat(studio/figma-import-hook): main() entry point with stdin parsing"
```

---

### Task 7: Register the hook in `claudeCode.ts`

**Files:**
- Modify: `studio/server/claudeCode.ts`

- [ ] **Step 1: Read the current state of `claudeCode.ts` around the hook registration**

Run: `grep -n "BLOCK_IMAGE_RESHAPE_HOOK\|hooks:" studio/server/claudeCode.ts | head -10`
Expected: shows the existing `BLOCK_IMAGE_RESHAPE_HOOK` constant declaration and the `hooks:` object inside the inline settings. Confirm you know where to insert the new hook.

- [ ] **Step 2: Add the new hook constant**

Open `studio/server/claudeCode.ts`. Find the line:

```ts
const BLOCK_IMAGE_RESHAPE_HOOK = path.resolve(MODULE_DIR, "hooks", "blockImageReshape.mjs");
```

Add immediately below it:

```ts
// PostToolUse hook that blocks Write/Edit tool calls introducing named
// imports (from "arcade/components" / "arcade-prototypes") that don't
// exist in the real barrels. Emits Did-you-mean suggestions on block so
// the model self-corrects in the same turn.
const VALIDATE_ARCADE_IMPORTS_HOOK = path.resolve(MODULE_DIR, "hooks", "validateArcadeImports.mjs");
```

- [ ] **Step 3: Register the hook in the inline settings**

Find the `const settings = JSON.stringify({ hooks: { PreToolUse: [...] } });` block. Replace it with:

```ts
  const settings = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `node ${BLOCK_IMAGE_RESHAPE_HOOK}` }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: `node ${VALIDATE_ARCADE_IMPORTS_HOOK}` }],
        },
      ],
    },
  });
```

- [ ] **Step 4: Re-run the existing claudeCode tests to confirm no regression**

Run: `pnpm run studio:test studio/__tests__/server/claudeCode.test.ts`
Expected: all existing tests PASS. (The existing tests use a fake claude binary and don't exercise real hooks, so they should be unaffected.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -v "chokidar\|keytar\|puppeteer\|ComputerSidebar\|select-item-empty\|projectWatch\|capture.ts"`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add studio/server/claudeCode.ts
git commit -m "feat(studio/figma-import-hook): register PostToolUse hook on Write/Edit"
```

---

### Task 8: CLAUDE.md template note

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`

- [ ] **Step 1: Read the current Icons section**

Run: `awk 'NR>=200 && NR<=230' studio/templates/CLAUDE.md.tpl`
Expected: you see the "### Icons" heading and the mapping table.

- [ ] **Step 2: Add a one-line note immediately after the "If no reasonable match exists" guidance**

Find the line ending with:

```
Better to ship an icon-less button than a frame that won't load. If no reasonable match exists, drop the icon or leave a `{/* TODO: icon */}` gap per R4.
```

Immediately below it, add:

```md

**A write-time hook runs on every Write/Edit.** If your import references a name that doesn't exist in `arcade/components` or `arcade-prototypes`, the hook exits with stderr like `Blocked: ... — did you mean FooBar, BazQux?`. When you see that, pick from the suggestions or `Read` the referenced barrel path — do not guess again. The hook runs again on the retry; a bad second guess is blocked the same way.
```

- [ ] **Step 3: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl
git commit -m "docs(studio): tell the agent about the import-validation hook"
```

---

### Task 9: Version bump + changelog

**Files:**
- Modify: `studio/packaging/VERSION`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump VERSION**

Run: `echo "0.4.3" > studio/packaging/VERSION && cat studio/packaging/VERSION`
Expected: `0.4.3`.

- [ ] **Step 2: Prepend the 0.4.3 changelog entry**

Open `studio/CHANGELOG.md`. Find the line:

```
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
```

After the blank line following it, insert:

```md
## [0.4.3] — 2026-05-01

### Fixed

- **Hallucinated icon imports no longer reach the browser.** The
  generator sometimes writes imports like `ArrowsUpDownSmall` that
  don't exist in `arcade/components`, and the frame renders blank
  with a load error. A new PostToolUse hook runs on every `Write` /
  `Edit` and checks named imports from `arcade/components` and
  `arcade-prototypes` against the real barrels. On a bad name it
  exits 2 with a `did you mean …` message, and the model
  self-corrects in the same turn — no more broken frames from this
  class of typo.

```

(Note: preserve the blank line between the new entry and the next section heading.)

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/VERSION studio/CHANGELOG.md
git commit -m "chore(studio): bump to 0.4.3 for arcade import hook"
```

---

### Task 10: Full suite + manual smoke

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: all tests PASS (prior passing count + the new hook tests). Fresh DMG also gets built as a side effect of the packaging test — confirm `studio/packaging/dist/Arcade Studio 0.4.3.dmg` exists.

- [ ] **Step 2: Smoke — bad import triggers a block**

Start the dev server: `pnpm run studio`
In a second terminal, simulate the hook invocation directly to confirm wiring (bypasses needing a live chat turn):

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.tsx","content":"import { ArrowsUpDownSmall } from \"arcade/components\";"}}' \
  | node studio/server/hooks/validateArcadeImports.mjs
echo "exit=$?"
```

Expected: stderr starts with `Blocked: some imports don't exist` and mentions `ArrowsUpAndDown` and/or `ChevronUpAndDownSmall`; `exit=2`.

- [ ] **Step 3: Smoke — valid import passes**

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.tsx","content":"import { Button } from \"arcade/components\";"}}' \
  | node studio/server/hooks/validateArcadeImports.mjs
echo "exit=$?"
```

Expected: no stderr; `exit=0`.

- [ ] **Step 4: Smoke — fail-open when arcade-gen missing**

```bash
ARCADE_GEN_ROOT=/tmp/does-not-exist ARCADE_PROTOTYPER_ROOT=/tmp/does-not-exist \
  node studio/server/hooks/validateArcadeImports.mjs \
  <<< '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.tsx","content":"import { WhateverFake } from \"arcade/components\";"}}'
echo "exit=$?"
```

Expected: no stderr; `exit=0`. The hook didn't block because it couldn't read the barrel.

- [ ] **Step 5: End-to-end smoke via Studio**

In the running Studio dev server, open a project and paste a prompt that typically triggers hallucinated icons (e.g. a Figma frame with sort indicators). Watch the server terminal for the hook's stderr if a bad import is attempted; the chat narration in the UI should show the agent self-correcting.

If no smoke case reliably triggers the hallucination, manually test by:

1. Open an existing frame's `index.tsx` in `~/Library/Application Support/arcade-studio/projects/<slug>/frames/<frame>/index.tsx`.
2. Add a line `import { DefinitelyFakeIcon } from "arcade/components";` and save.
3. Vite will report a module error immediately (as expected without the hook — the hook only fires on Claude's Write/Edit, not manual saves).
4. Verify the hook's `main()` output via the Step 2/3 commands instead.

- [ ] **Step 6: Mark the plan done if all smokes pass**

No commit — the work is complete. If any smoke fails, file a follow-up task. Common likely failure: `ARCADE_PROTOTYPER_ROOT` fallback is wrong for the packaged app; if you see the hook blocking on `arcade-prototypes` imports that should be valid, check that the fallback `new URL("../../prototype-kit/index.ts", import.meta.url)` resolves correctly when the `.mjs` is bundled inside the DMG.

---

## Self-Review Summary

**Spec coverage:**
- Goal / non-goals / fail-open invariant: Tasks 2–6 (tests assert each).
- Hook contract (stdin JSON shape, Write vs Edit, scope gate): Task 6 integration tests + `main()` implementation.
- Barrel resolution (two tracked sources, combined flatten for arcade/components): Task 6 `barrelPathsForEnv` + `loadAllBarrels`.
- Barrel parsing (regex, `export type` skip, alias handling): Task 3.
- Import parsing (regex, `type` prefix skip, `Foo as Bar`, dedup): Task 2.
- Levenshtein + top-3 suggestions + ≤4 threshold: Task 4.
- Error message (per-source grouping, inline suggestions, barrel-path fallback, export counts): Task 5.
- Exit codes (0/2): Task 6 integration tests.
- Fail open on missing barrels and malformed input: Task 6 integration tests.
- Registration alongside existing hook: Task 7.
- Template note: Task 8.
- Version bump + changelog: Task 9.
- Smoke: Task 10.

**Deliberate omissions from the spec (already flagged):**
- Namespace-import (`import * as X`) validation — skipped by design.
- JSX-usage-without-import — different bug class.
- Transitive import validation — not in scope.

**Risks I'd flag for the implementer:**
- The `ARCADE_PROTOTYPER_ROOT` env var is new. In dev (`pnpm run studio`), the hook's fallback to `new URL("../../prototype-kit/index.ts", import.meta.url).pathname` resolves relative to the `.mjs` source location and should work. In the packaged DMG the `.mjs` lives under `Contents/Resources/app/studio/server/hooks/`, so the same relative math still lands on `.../app/studio/prototype-kit/index.ts`. Worth verifying during Task 10 smoke.
- The integration tests spawn a real `node` subprocess with stdin. If your vitest runner doesn't have `child_process` spawning permissions (unusual, but possible in some sandboxed CI), these will fail in ways unrelated to the hook. The existing `blockImageReshape.test.ts` doesn't do this — our new pattern is one step more integration-heavy. If this bites, fall back to unit-testing `main()` by mocking `process.stdin` / `process.exit` / `process.stderr` — at the cost of less realism.
- The message format uses backticks around identifiers. If in live terminals those backticks confuse the agent's parsing, swap to plain quotes — the format tests assert presence of the name, not the surrounding punctuation.
