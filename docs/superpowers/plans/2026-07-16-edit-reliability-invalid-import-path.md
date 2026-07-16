# Edit Reliability — Invalid Arcade Import-Path Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent can no longer crash a frame by importing a real symbol from an `arcade`-namespace path that doesn't resolve (`arcade/components/icons`) — the shipped import-validation hook now validates the import PATH (not just symbol names) against Vite's alias semantics and exit-2 self-corrects with the right path.

**Architecture:** Extend `studio/server/hooks/validateArcadeImports.mjs` (already a PostToolUse Write/Edit hook that validates symbol NAMES via exit-2 self-correct). Add: a resolvability predicate mirroring Vite's exact-vs-prefix aliases; an all-import-forms specifier extractor; a path-violation detector; wire into `main()` unioned with the existing named-symbol check into one exit-2.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Vite alias resolution.

## Global Constraints

- Package manager **pnpm**. Focused test: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts` from repo root `/Users/andrey.sundiev/arcade-prototyper`.
- **`command git` for ALL git** (bare git blocked by a failing rtk hook). Prefix any intercepted `grep`/`node` with `command`.
- **No false alarms is a HARD requirement.** Only judge `arcade`-namespace specifiers; the predicate MUST mirror Vite's real alias semantics (exact vs prefix) or it false-flags resolving imports.
- **Vite alias semantics are the authority** (`studio/vite.config.ts:152-159`): `arcade` and `arcade/components` are `$`-anchored regexes → EXACT (only the bare specifier resolves; `arcade/components/icons` does NOT). `arcade-studio` and `arcade-prototypes` are bare-string finds → PREFIX (the specifier AND any `/subpath` resolve). `arcade-user/<name>` is `/^arcade-user\/(.+)$/` (non-empty name required).
- **Resolvability predicate (exact copy this logic):** a specifier resolves iff `spec === "arcade" || spec === "arcade/components" || spec === "arcade-studio" || spec.startsWith("arcade-studio/") || spec === "arcade-prototypes" || spec.startsWith("arcade-prototypes/") || /^arcade-user\/.+/.test(spec)`.
- **In-scope for the path check:** a specifier is judged iff it is `arcade`, or starts with `arcade/`, or starts with `arcade-`. This EXCLUDES `@xorkavi/arcade-gen` (starts `@`), relative (`./…`), and npm packages.
- **Do NOT reuse `parseImports` (named-only) or `collectDefinedIdentifiers` regexes (capture bindings, not the `from "…"` specifier)** — a NEW specifier scan is required.
- **Do NOT alter** existing `validateImports`/`formatErrorMessage`/`parseImports` behavior — ADD alongside; union violations into ONE exit-2; `exit(0)` only when all checks pass.
- The hook reads `new_string` on Edit but `main()` already re-reads the whole post-edit file from disk (confirmed at `validateArcadeImports.mjs` main() Edit branch) — the path check runs on that same whole-file `content`.
- Fail open: extraction yields nothing → no path violations; the path check needs NO barrels, so it must run even if barrel load fails.

---

## Task 1: Import-path validation in the shipped hook

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs` (add predicate + extractor + detector + formatter; wire into `main()`)
- Test: `studio/__tests__/server/hooks/validateArcadeImports.test.ts` (EXISTS; has `runHook` (~:296) + `tmpFrame` (~:309) + `spawnSync`; add unit + integration cases)

**Interfaces:**
- Produces:
  - `isResolvableArcadeSpecifier(spec: string) → boolean` — the Global-Constraints predicate.
  - `isArcadeNamespaceSpecifier(spec: string) → boolean` — `spec === "arcade" || spec.startsWith("arcade/") || spec.startsWith("arcade-")`.
  - `extractImportSpecifiers(source: string) → string[]` — every import specifier across named/default/namespace (`from "…"`) AND side-effect (`import "…"`) forms; comments stripped first.
  - `detectInvalidArcadePaths(source: string) → Array<{ specifier: string, suggestion: string }>` — in-scope specifiers that fail the resolvability predicate, each with a correct-path suggestion.
  - `formatInvalidPathError(violations) → string` — the exit-2 message block.

- [ ] **Step 1: Write the failing unit tests**

Add to the file's existing vitest imports (the file imports the hook's pure exports at the top — add these names there):

```typescript
// add to the existing import from "../../../server/hooks/validateArcadeImports.mjs":
//   isResolvableArcadeSpecifier, isArcadeNamespaceSpecifier,
//   extractImportSpecifiers, detectInvalidArcadePaths

describe("isResolvableArcadeSpecifier", () => {
  it("exact aliases resolve", () => {
    for (const s of ["arcade", "arcade/components", "arcade-studio", "arcade-prototypes"])
      expect(isResolvableArcadeSpecifier(s)).toBe(true);
  });
  it("PREFIX aliases resolve with a subpath (the Critical regression guard)", () => {
    expect(isResolvableArcadeSpecifier("arcade-studio/frame/FrameErrorBoundary")).toBe(true);
    expect(isResolvableArcadeSpecifier("arcade-prototypes/examples/Foo")).toBe(true);
  });
  it("arcade-user requires a non-empty name", () => {
    expect(isResolvableArcadeSpecifier("arcade-user/Foo")).toBe(true);
    expect(isResolvableArcadeSpecifier("arcade-user")).toBe(false);
  });
  it("EXACT aliases do NOT resolve a subpath", () => {
    expect(isResolvableArcadeSpecifier("arcade/components/icons")).toBe(false);
    expect(isResolvableArcadeSpecifier("arcade/nope")).toBe(false);
  });
});

describe("extractImportSpecifiers (all forms)", () => {
  it("captures named, default, namespace, and side-effect specifiers", () => {
    const src = `
      import { A } from "arcade/components";
      import B from "arcade/components/icons";
      import * as C from "arcade-studio/frame/x";
      import "arcade-prototypes/side/effect";
      const notImport = "from \\"arcade/fake\\"";
    `;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("arcade/components");
    expect(specs).toContain("arcade/components/icons");
    expect(specs).toContain("arcade-studio/frame/x");
    expect(specs).toContain("arcade-prototypes/side/effect");
  });
});

describe("detectInvalidArcadePaths", () => {
  it("flags the bug path, suggests arcade/components", () => {
    const v = detectInvalidArcadePaths(`import { ChevronDownSmall } from "arcade/components/icons";`);
    expect(v.map((x) => x.specifier)).toEqual(["arcade/components/icons"]);
    expect(v[0].suggestion).toMatch(/arcade\/components/);
  });
  it("does NOT flag prefix-alias subpaths (no false alarm)", () => {
    const src = `import { FrameErrorBoundary } from "arcade-studio/frame/FrameErrorBoundary";
                 import example from "arcade-prototypes/examples/Foo";`;
    expect(detectInvalidArcadePaths(src)).toEqual([]);
  });
  it("does NOT flag non-arcade specifiers", () => {
    const src = `import React from "react";
                 import { X } from "@xorkavi/arcade-gen";
                 import { Y } from "./pages/Foo";`;
    expect(detectInvalidArcadePaths(src)).toEqual([]);
  });
  it("flags a bad path in default and namespace and side-effect forms", () => {
    expect(detectInvalidArcadePaths(`import Foo from "arcade/bad";`)).toHaveLength(1);
    expect(detectInvalidArcadePaths(`import * as Foo from "arcade/bad";`)).toHaveLength(1);
    expect(detectInvalidArcadePaths(`import "arcade/bad";`)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement the functions**

Add to `validateArcadeImports.mjs` (near the other exported helpers; `stripComments` already exists at `:310` — reuse it):

```javascript
/**
 * Valid arcade-namespace import specifiers, mirroring Vite's alias SEMANTICS
 * (studio/vite.config.ts resolve.alias — the authority for this predicate):
 *   /^arcade$/            → EXACT: only bare "arcade"
 *   /^arcade\/components$/ → EXACT: only bare "arcade/components" (so
 *                           "arcade/components/icons" does NOT resolve — the bug)
 *   "arcade-studio"       → PREFIX (bare string find): "arcade-studio" AND "arcade-studio/*"
 *   "arcade-prototypes"   → PREFIX: "arcade-prototypes" AND "arcade-prototypes/*"
 *   /^arcade-user\/(.+)$/ → requires a non-empty name
 * If an alias is added/changed in vite.config.ts, update this in lockstep.
 * (A second alias table for share-time esbuild lives in server/cloudflare/
 * bundler.ts with different subpath semantics — NOT this hook's concern.)
 */
export function isResolvableArcadeSpecifier(spec) {
  return (
    spec === "arcade" ||
    spec === "arcade/components" ||
    spec === "arcade-studio" ||
    spec.startsWith("arcade-studio/") ||
    spec === "arcade-prototypes" ||
    spec.startsWith("arcade-prototypes/") ||
    /^arcade-user\/.+/.test(spec)
  );
}

/** A specifier in the arcade namespace (the only specifiers the path check judges). */
export function isArcadeNamespaceSpecifier(spec) {
  return spec === "arcade" || spec.startsWith("arcade/") || spec.startsWith("arcade-");
}

/**
 * Every import specifier in the source, across ALL import forms:
 *   named/default/namespace all end in `from "…"`; side-effect is `import "…"`.
 * Comments stripped first so a commented-out import isn't judged. NOT reused
 * from parseImports (named-only) or collectDefinedIdentifiers (captures the
 * binding, not the specifier) — those don't yield the path.
 */
export function extractImportSpecifiers(source) {
  if (typeof source !== "string" || !source) return [];
  const clean = stripComments(source);
  const out = [];
  const fromRe = /\bfrom\s+["']([^"']+)["']/g;                 // named/default/namespace
  const sideRe = /(?:^|[;\n])\s*import\s+["']([^"']+)["']/g;    // side-effect (no `from`)
  let m;
  while ((m = fromRe.exec(clean)) !== null) out.push(m[1]);
  while ((m = sideRe.exec(clean)) !== null) out.push(m[1]);
  return out;
}

/**
 * In-scope (arcade-namespace) specifiers that fail the resolvability predicate.
 * Each carries a correct-path suggestion. An `arcade/<subpath>` → suggest
 * `arcade/components` (the barrel re-exports all arcade-gen icons+components);
 * anything else → list the valid forms.
 */
export function detectInvalidArcadePaths(source) {
  const out = [];
  const seen = new Set();
  for (const spec of extractImportSpecifiers(source)) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    if (!isArcadeNamespaceSpecifier(spec)) continue;
    if (isResolvableArcadeSpecifier(spec)) continue;
    const suggestion = spec.startsWith("arcade/")
      ? '`arcade/components` (it re-exports all arcade-gen icons and components) or `arcade`'
      : "one of: `arcade`, `arcade/components`, `arcade-studio[/…]`, `arcade-prototypes[/…]`, `arcade-user/<name>`";
    out.push({ specifier: spec, suggestion });
  }
  return out;
}

export function formatInvalidPathError(violations) {
  if (!violations.length) return "";
  const lines = ["Blocked: some imports use an arcade path that doesn't resolve", "(the symbols are real, but the path is not aliased → they'd be undefined at render).", ""];
  for (const v of violations) {
    lines.push(`  - \`${v.specifier}\` is not a valid import path. Import from ${v.suggestion}.`);
  }
  lines.push("", "Fix the import path(s) and re-Write. This hook runs on every Write/Edit.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify unit tests pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS (all Step-1 cases).

- [ ] **Step 5: Wire into `main()` — union with the existing named-symbol check**

In `main()`, after the existing `importViolations` line and BEFORE the `if (importViolations.length === 0) process.exit(0)` early-exit, add the path check and combine. Replace the tail:

```javascript
  const imports = parseImports(content);
  const importViolations = imports.length ? validateImports(imports, barrels) : [];
  const pathViolations = detectInvalidArcadePaths(content);   // needs no barrels

  if (importViolations.length === 0 && pathViolations.length === 0) process.exit(0);

  const message = [
    importViolations.length ? formatErrorMessage(importViolations, barrels, barrelPaths) : "",
    pathViolations.length ? formatInvalidPathError(pathViolations) : "",
  ].filter(Boolean).join("\n\n");
  process.stderr.write(message);
  process.exit(2);
```

(This preserves: named-symbol violations still exit-2 with `formatErrorMessage`; clean files exit-0; both kinds union into one exit-2. `detectInvalidArcadePaths` runs even when `barrels` failed to load, since it takes only `content`.)

- [ ] **Step 6: Add integration tests (Write, full content, real hook)**

The file already has `runHook` + `tmpFrame`. Add:

```typescript
it("exit 2 on the bug path arcade/components/icons; suggests arcade/components", () => {
  const f = tmpFrame(`import { ChevronDownSmall } from "arcade/components/icons";\nexport default () => <ChevronDownSmall/>;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(2);
  expect(p.stderr).toMatch(/arcade\/components\/icons/);
  expect(p.stderr).toMatch(/arcade\/components\b/);
});
it("exit 0 on a resolving prefix-alias subpath (Critical regression guard)", () => {
  const f = tmpFrame(`import { FrameErrorBoundary } from "arcade-studio/frame/FrameErrorBoundary";\nexport default () => <div/>;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(0);
});
it("exit 0 on valid arcade/components + relative + npm imports", () => {
  const f = tmpFrame(`import { Button } from "arcade/components";\nimport X from "./pages/X";\nimport React from "react";\nexport default () => <Button/>;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(0);
});
```

Use `proc.status`/`proc.stderr`. (`fs`/`tmpFrame` are already imported/defined in this file.)

- [ ] **Step 7: Run to verify pass + no regression to the existing named-symbol tests**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS — new cases AND all pre-existing named-symbol/import tests still green.

- [ ] **Step 8: Commit**

```bash
command git add studio/server/hooks/validateArcadeImports.mjs studio/__tests__/server/hooks/validateArcadeImports.test.ts
command git commit -m "feat(studio/hooks): validate arcade import PATHS (not just symbols) so bad-path imports self-correct"
```

---

## Task 2: Full suite + manual acceptance

**Files:** (data, not repo) the two live broken frames, if still broken on the test machine.

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS. Re-run any failing file in isolation to confirm contention, not regression (suite flakes under load; clear ports 9223-9232 if wsServer/bridge tests fail). Note: `[ERROR]` lines in output are intentional esbuild fixtures inside passing tests, not failures.

- [ ] **Step 2: One-frame data fix (if still broken)**

In `~/Library/Application Support/arcade-studio/projects/computer-settings/frames/01-computer-settings/pages/`, if `PlansBilling.tsx` / `WorkflowsTools.tsx` still import from `"arcade/components/icons"`, change to `"arcade/components"`. (May already be fixed on the machine — check first; do NOT `git add`, it's user data.)

- [ ] **Step 3: Manual acceptance (the live gate)**

`pnpm run studio` (fully quit + restart first — hook `.mjs` loads per spawned process). Then in `computer-settings` (or any project):
- Ask the agent for an edit that historically produced the bad import (e.g. "add a dropdown filter" or "put a chevron icon on this row"). Confirm: if the agent writes `arcade/components/icons`, the hook feeds back the correct path and the agent self-corrects to `arcade/components` — the frame renders, no `X is not defined` crash.
- Confirm NO false alarm on ordinary edits: a frame importing from `arcade/components`, a relative `./pages/X`, an `arcade-prototypes/…` or `arcade-studio/…` subpath (if the project has one) must NOT be blocked.
- Open the `PlansBilling`/`WorkflowsTools` tabs → confirm they render (no chevron crash).

- [ ] **Step 4: No version bump here.** Per the user: all THREE edit-reliability features (resilient-render, dead-token, invalid-import-path) ship under ONE release once this passes manual acceptance — that release cut is a separate explicit step, not part of this plan.

---

## Self-review notes (author)

- **Spec coverage:** predicate + all-forms extractor + detector + formatter + main() wiring = Task 1; frame fix + suite + manual gate = Task 2. All spec sections mapped.
- **The Critical from spec review is guarded:** prefix-alias subpaths (`arcade-studio/frame/…`, `arcade-prototypes/examples/…`) have explicit exit-0 unit AND integration tests — the exact false-alarm the exact-set draft would have shipped.
- **Reuse trap avoided:** `extractImportSpecifiers` is a NEW scan (from-form + side-effect form), NOT `parseImports`/`collectDefinedIdentifiers` (which capture bindings). Comments stripped via existing `stripComments`.
- **Composition:** `detectInvalidArcadePaths` takes only `content` (no barrels) so it runs even if barrel load degraded; unioned with the named-symbol check into one exit-2; clean → exit-0 unchanged.
- **Type consistency:** `detectInvalidArcadePaths` → `{specifier, suggestion}[]`; `formatInvalidPathError` consumes exactly that; `main()` unions `importViolations` (named) + `pathViolations` (path) messages.
- **No false alarms:** only `isArcadeNamespaceSpecifier` specifiers judged; `@xorkavi/arcade-gen` (starts `@`), relative, npm all excluded; prefix aliases resolve. Fail-open: empty extraction → no violations.
