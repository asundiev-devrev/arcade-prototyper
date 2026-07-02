# Figma-fidelity: always-on directive + eject-to-source composites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "implement this Figma design precisely, modify ComputerScene, apply a purple theme" actually produce a faithful frame, by (1) guaranteeing the faithfulness directive reaches the agent on every precise turn and (2) turning sealed composites into an editable starting point.

**Architecture:** Two independent parts. Part 1 decouples the high-fidelity directive from the Figma data-fetch inside `enrichPromptWithFigmaContext` and makes the directive's self-fetch commands cap-safe. Part 2 adds an eject-to-source helper (copies a kit composite's real source into a staging dir with imports rewritten to frame specifiers), a trigger that fires on composite-naming build intent, and CLAUDE.md.tpl guidance for token-override recolor + full-canvas-input placement.

**Tech Stack:** TypeScript, Vitest (`pnpm run studio:test`), Vite middleware, React (prototype-kit), Node fs.

Spec: `docs/superpowers/specs/2026-07-02-figma-fidelity-eject-and-directive-design.md`

## Global Constraints

- **Package manager: pnpm.** Never `npm`/`yarn`. Tests: `pnpm run studio:test <path>` from repo root (`/Users/andrey.sundiev/arcade-prototyper`), NOT from `studio/` (no package.json there).
- **Conventional Commits**, scope `studio/figma` or `studio/prototype-kit`. Commit message trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Never `git add -A` / `git add .`** — stage explicit paths only (repo root has loose untracked files).
- **Vite middleware does NOT hot-reload** — server changes under `server/**` need a full app restart to test live (irrelevant to unit tests, matters for the manual gate).
- **Branch:** work on `feat/figma-export-v1` (current) or a new `feat/figma-fidelity-eject`. Confirm with the user before branching.
- **Pure functions stay pure + exported for unit test** — mirror `fidelityDirective.ts` / `generationIntent.ts` style.
- **`--add-dir` read-only roots:** the generator can Read `{{PROTOTYPER}}` (prototype-kit) but must NOT edit it. Ejected copies live in the project dir, which is writable.

---

## File Structure

- `studio/server/figma/fidelityDirective.ts` — MODIFY. Cap-safe self-fetch recipe; PNG=layout/color vs node-tree=text split.
- `studio/server/middleware/chat.ts` — MODIFY. Decouple directive from digest in `enrichPromptWithFigmaContext`; wire eject trigger into `runClaudeBranch`.
- `studio/server/figma/generationIntent.ts` — MODIFY. Add `detectComposeBaseIntent` + `extractComposeBaseComposite` (composite-naming subset of build intent + name extractor).
- `studio/server/figma/ejectComposite.ts` — CREATE. Pure import-rewrite + copy helper.
- `studio/templates/CLAUDE.md.tpl` — MODIFY. Recolor-via-tokens (selector + token list) + eject/full-canvas-input guidance.
- Tests (CREATE/MODIFY):
  - `studio/__tests__/server/figma/fidelityDirective.test.ts` — MODIFY.
  - `studio/__tests__/server/figma/generationIntent.test.ts` — MODIFY.
  - `studio/__tests__/server/figma/ejectComposite.test.ts` — CREATE.
  - `studio/__tests__/server/middleware/chat-figma-context.test.ts` — MODIFY.
  - `studio/__tests__/templates/claude-md-recolor-guidance.test.ts` — CREATE.

---

# PART 1 — Always-on faithfulness directive

## Task 1: Cap-safe self-fetch in the hi-fi directive

Fixes review S3.2 + the attempt-2 failures (411KB read cap, 30s PNG timeout). Pure string edit to `buildHiFiDirective`.

**Files:**
- Modify: `studio/server/figma/fidelityDirective.ts` (the `buildHiFiDirective` template, ~lines 107–167; and the PNG line at ~110–111)
- Test: `studio/__tests__/server/figma/fidelityDirective.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildHiFiDirective(ctx)` output string — same signature — now containing `--scale 1`, a cap-safe read recipe, and a PNG-vs-text-role split.

- [ ] **Step 1: Write failing tests**

Add to `studio/__tests__/server/figma/fidelityDirective.test.ts` inside the existing `describe("buildHiFiDirective", …)` block:

```ts
  it("uses cap-safe self-fetch: scale-1 PNG, not scale-2 (avoids 30s export timeout)", () => {
    const out = buildHiFiDirective({ ...ctx, hasReferencePng: false });
    expect(out).toContain("--scale 1");
    expect(out).not.toContain("--scale 2");
  });

  it("uses a shallow depth read and reads large output in chunks (avoids the 256KB read cap)", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toMatch(/get-nodes --depth 2/);
    expect(out).not.toMatch(/get-nodes --depth 4/);
    // Names the offset/limit-or-grep escape for persisted-to-file output.
    expect(out).toMatch(/offset|limit|grep/i);
  });

  it("splits roles: text comes from the node tree characters, PNG is layout/color", () => {
    const out = buildHiFiDirective(ctx);
    expect(out).toMatch(/characters/);
    expect(out).toMatch(/do not .*(OCR|read text).*(from|off).*PNG/i);
  });

  it("tells the agent not to fabricate on fetch failure", () => {
    const out = buildHiFiDirective({ ...ctx, hasReferencePng: false });
    expect(out).toMatch(/retry shallower|faithful partial|do NOT .*invent/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/figma/fidelityDirective.test.ts`
Expected: the 4 new tests FAIL (strings not present); existing tests still pass — EXCEPT the pre-existing test at line ~105 that asserts `--scale 2` export (`"figmanage export nodes --format png --scale 2 --json …"`). That test WILL now conflict; update it in Step 3.

- [ ] **Step 3: Edit the directive**

In `studio/server/figma/fidelityDirective.ts`, change the `pngLine` fallback (the `hasReferencePng ? … : …` at ~108–111) from `--scale 2` to `--scale 1`:

```ts
  const pngLine = ctx.hasReferencePng
    ? "The attached high-resolution PNG of the frame — this is what the designer sees and what \"looks right\" means."
    : "A PNG render of the frame. Export it first: `figmanage export nodes --format png --scale 1 --json " +
      ctx.fileKey + " " + ctx.nodeId + "`, then fetch the URL with curl and Read the PNG. Use scale 1 — a full-scale export can exceed the 30s export timeout on large frames.";
```

Replace the node-tree read line (currently `figmanage reading get-nodes --depth 4 …`, ~line 124) and add the cap-safe + role-split guidance. Find the block that starts `"2. The REAL Figma node tree, which you MUST read this turn."` and replace its `figmanage reading get-nodes --depth 4 …` line and the following "Drill into one subtree" line with:

```ts
    `       figmanage reading get-nodes --depth 2 ${ctx.fileKey} ${ctx.nodeId}`,
    "   Start shallow (depth 2). If figmanage output is large enough to be persisted to a",
    "   file (the tool tells you), do NOT Read the whole file — it will exceed the 256KB /",
    "   25K-token read cap and fail. Read it with offset/limit in chunks, or grep for the one",
    "   subtree you need, then drill into that single subtree with a focused deeper read.",
    "",
    "TEXT vs PIXELS — the PNG is legible for LAYOUT, STRUCTURE, and COLOR, but NOT for reading",
    "small body copy word-for-word. Take exact text content from the node tree's `characters`",
    "fields (read via the recipe above). Do NOT OCR / read text off the PNG. The PNG decides",
    "where things sit and what colour they are; the tree decides what they say.",
    "",
    "IF A FETCH FAILS (timeout, or output too large to read): do NOT give up and invent the UI.",
    "Retry shallower, and build from whatever portion of the PNG + tree you did read. A faithful",
    "partial beats a confident fabrication.",
```

Then update the pre-existing test that pins `--scale 2` (fidelityDirective.test.ts, the `"when no reference PNG is attached, tells the agent to export one itself"` test at ~line 103–106): change its expectation from `--scale 2` to `--scale 1`:

```ts
  it("when no reference PNG is attached, tells the agent to export one itself", () => {
    const out = buildHiFiDirective({ ...ctx, hasReferencePng: false });
    expect(out).toContain("figmanage export nodes --format png --scale 1 --json ABC123 3532:40693");
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/fidelityDirective.test.ts`
Expected: PASS (all, including the updated scale-1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/figma/fidelityDirective.ts studio/__tests__/server/figma/fidelityDirective.test.ts
git commit -m "fix(studio/figma): cap-safe hi-fi self-fetch — scale-1 PNG, shallow chunked reads, text-from-tree

Directive told the agent to run get-nodes --depth 4 (411KB, exceeds read cap)
and export a scale-2 PNG (30s timeout) — both failed on the real large file.
Now: depth 2 + chunked/grep reads, scale-1 PNG, and text taken from the node
tree characters (PNG is layout/color only). Adds an anti-fabricate fallback.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 2: Decouple the directive from the digest fetch

Fixes defect A + review S3.1. On a digest miss the function bails before appending the directive; make the append decision context-free (`detectHiFiIntent`) so it fires regardless.

**Files:**
- Modify: `studio/server/middleware/chat.ts` — `enrichPromptWithFigmaContext` (~lines 437–503)
- Test: `studio/__tests__/server/middleware/chat-figma-context.test.ts`

**Interfaces:**
- Consumes: `detectHiFiIntent` from `../figma/fidelityDirective` (add to the existing import on line 22: `import { shouldUseHiFi, detectHiFiIntent, buildHiFiDirective } from "../figma/fidelityDirective";`), `buildHiFiDirective` (already imported).
- Produces: `enrichPromptWithFigmaContext` — same signature — now always appends `<high_fidelity_mode>` when `detectHiFiIntent(prompt)` is true, even when the digest missed.

- [ ] **Step 1: Write the failing test**

The existing test file mocks `runFigmaKitEmitBranch` and drives real `/api/chat`. For a unit-level assertion on the enriched prompt, add a test that captures what the claude branch received. The fake CLI already writes its argv/prompt to `ARCADE_TEST_PROMPT_OUT` (see chat-figma-context.test.ts setup). Add to that file a new describe block:

```ts
describe("hi-fi directive survives a Figma digest miss", () => {
  it("appends <high_fidelity_mode> even when no digest/PNG is available", async () => {
    // No figma-ingest cache + no figmanage in the test env → digest misses.
    // A precise-intent prompt with a URL must STILL carry the directive.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Claude branch ran (not kit-emit — precise intent routes to generator).
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    expect(sent).toContain("<high_fidelity_mode>");
  });
});
```

Note: this requires the digest to actually miss in the test env. Confirm `figmanage` is not on PATH in CI/test (the ingest `getNode` throws → phase-1 fails → `result` null). If the env has a real figmanage, stub `getFigmaIngest` the way the file already stubs `runFigmaKitEmitBranch` (vi.mock), returning an object whose `getCached`→undefined and `ingestPhase1`→`{ok:false}`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-context.test.ts`
Expected: new test FAILS — `sent` lacks `<high_fidelity_mode>` because the current code returns early on digest miss (chat.ts:470-473) before the directive block.

- [ ] **Step 3: Restructure `enrichPromptWithFigmaContext`**

Replace the body from the `if (!result)` early-return (line 470) through the end of the function (line 503) with a layered assembly. Full replacement of lines 470–503:

```ts
  // Directive decision is CONTEXT-FREE: it depends only on the prompt + URL,
  // both of which we have even when the digest missed. This is the fix for the
  // "agent gets a naked prompt with no faithfulness directive on a slow/failed
  // Figma fetch" bug (review S3.1). Do NOT gate this on shouldUseHiFi — that
  // needs digest-derived {classified, hasHighConfidenceComposite} which is
  // absent on a miss. shouldUseHiFi stays only as a digest-SUCCESS upgrade.
  const explicitHiFi = detectHiFiIntent(prompt);

  if (!result) {
    console.warn("[studio] figma ingest miss; proceeding without structured context");
    if (!explicitHiFi) return { prompt, images };
    // No digest, but the designer asked for a precise build: append the
    // directive with hasReferencePng:false so it tells the agent to export +
    // read its own (cap-safe) PNG.
    onNarration?.("high-fidelity mode (no cached design context — agent will fetch)");
    const directive = buildHiFiDirective({
      fileKey: parsed.fileId,
      nodeId: parsed.nodeId,
      hasReferencePng: false,
    });
    return { prompt: `${prompt}\n\n${directive}`, images };
  }

  const block = buildFigmaContextBlock(result);
  const nextImages = result.png ? [...images, result.png.path] : images;

  const parts = [`Figma context: ${result.composites.length} composites suggested`];
  if (result.diagnostics.warnings.length) {
    parts.push(`${result.diagnostics.warnings.length} diagnostic${result.diagnostics.warnings.length > 1 ? "s" : ""}`);
  }

  // Digest succeeded. Append the directive when EITHER explicit intent OR the
  // novel-design upgrade (classifier ran, no high-confidence template) fires.
  const hasHighConfidenceComposite = result.composites.some((c) => c.confidence === "high");
  let block2 = block;
  if (explicitHiFi || shouldUseHiFi(prompt, { classified: result.classified, hasHighConfidenceComposite })) {
    parts.push("high-fidelity mode");
    block2 = `${block}\n\n${buildHiFiDirective({
      fileKey: parsed.fileId,
      nodeId: parsed.nodeId,
      hasReferencePng: Boolean(result.png),
    })}`;
  }

  onNarration?.(parts.join(" · "));

  return { prompt: `${prompt}\n\n${block2}`, images: nextImages };
```

Also update the import on line 22:

```ts
import { shouldUseHiFi, detectHiFiIntent, buildHiFiDirective } from "../figma/fidelityDirective";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-context.test.ts`
Expected: PASS (new test + all existing).

- [ ] **Step 5: Run the broader figma + middleware suites for regressions**

Run: `pnpm run studio:test __tests__/server/figma __tests__/server/middleware`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat-figma-context.test.ts
git commit -m "fix(studio/figma): always append hi-fi directive, even on a digest miss

enrichPromptWithFigmaContext returned early on a Figma-digest timeout/miss,
BEFORE the directive block — so a precise-build prompt on a slow/large file
reached the agent naked (no screenshot, no faithfulness instruction) and it
freelanced. Directive decision is now context-free (detectHiFiIntent) and
fires regardless of digest; digest success still upgrades with the novel-
design branch + attached PNG.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PART 2 — Composites as an editable starting point

## Task 3: Compose-base intent detection + composite-name extractor

Review M5: the eject trigger must be a subset of `detectBuildIntent`, sharing one source of truth, plus a name extractor mapping "ComputerScene" → a real kit file.

**Files:**
- Modify: `studio/server/figma/generationIntent.ts`
- Test: `studio/__tests__/server/figma/generationIntent.test.ts`

**Interfaces:**
- Consumes: existing `detectBuildIntent`.
- Produces:
  - `EJECTABLE_COMPOSITES: readonly string[]` — kit composite/template names eligible for eject.
  - `extractComposeBaseComposite(prompt: string): string | null` — returns the ejectable composite the prompt names as a base, or null.
  - `detectComposeBaseIntent(prompt: string): boolean` — true iff build-intent AND a known composite is named as a base. (Subset of build intent; never fires where `shouldGenerateFromFigma` is false.)

- [ ] **Step 1: Write failing tests**

Add to `studio/__tests__/server/figma/generationIntent.test.ts`:

```ts
import {
  detectComposeBaseIntent,
  extractComposeBaseComposite,
  shouldGenerateFromFigma,
} from "../../../server/figma/generationIntent";

describe("extractComposeBaseComposite", () => {
  it("extracts a named ejectable composite used as a base", () => {
    expect(extractComposeBaseComposite("modify the ComputerScene composite")).toBe("ComputerScene");
    expect(extractComposeBaseComposite("use ComputerScene as a base")).toBe("ComputerScene");
    expect(extractComposeBaseComposite("based on the empty state of ComputerScene")).toBe("ComputerScene");
  });
  it("returns null when no known composite is named", () => {
    expect(extractComposeBaseComposite("modify the composite")).toBeNull();
    expect(extractComposeBaseComposite("build a settings page")).toBeNull();
    expect(extractComposeBaseComposite("use FooBarScene as a base")).toBeNull();
  });
  it("is robust to non-string input", () => {
    expect(extractComposeBaseComposite(undefined as unknown as string)).toBeNull();
  });
});

describe("detectComposeBaseIntent", () => {
  it("fires on the motivating prompt (build intent + named composite)", () => {
    const p =
      "Implement this design precisely. Use the empty state of ComputerScene as a base. " +
      "Modify the ComputerScene composite instead of building from scratch.";
    expect(detectComposeBaseIntent(p)).toBe(true);
    // Must be a SUBSET of generation intent — never eject on an importer turn.
    expect(shouldGenerateFromFigma(p)).toBe(true);
  });
  it("does NOT fire without a named ejectable composite", () => {
    expect(detectComposeBaseIntent("implement this precisely")).toBe(false);
    expect(detectComposeBaseIntent("modify the composite")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts`
Expected: FAIL — `detectComposeBaseIntent` / `extractComposeBaseComposite` not exported.

- [ ] **Step 3: Implement**

Add to `studio/server/figma/generationIntent.ts` (after `detectBuildIntent`):

```ts
/**
 * Kit composites/templates a prompt may name as a "base" to eject and edit.
 * Kept to the whole-scene/page shapes designers actually reference by name;
 * extend as needed. Case-insensitive match, whole-word.
 */
export const EJECTABLE_COMPOSITES = [
  "ComputerScene",
  "ComputerPage",
  "SettingsPage",
  "VistaPage",
] as const;

/**
 * The ejectable composite the prompt names as a base, or null. Requires the
 * name to appear near base-language (modify / use … as base / based on) so a
 * passing mention ("looks like ComputerScene") doesn't trigger an eject.
 */
export function extractComposeBaseComposite(prompt: string): string | null {
  if (typeof prompt !== "string" || !prompt) return null;
  for (const name of EJECTABLE_COMPOSITES) {
    // whole-word, case-insensitive
    const named = new RegExp(`\\b${name}\\b`, "i");
    if (named.test(prompt)) return name;
  }
  return null;
}

/**
 * True when the prompt carries build intent AND names a known ejectable
 * composite as a base. This is a strict subset of detectBuildIntent (and
 * therefore of shouldGenerateFromFigma), so an eject can never happen on a
 * turn that routed to the deterministic importer (review M5).
 */
export function detectComposeBaseIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return detectBuildIntent(prompt) && extractComposeBaseComposite(prompt) !== null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/figma/generationIntent.ts studio/__tests__/server/figma/generationIntent.test.ts
git commit -m "feat(studio/figma): compose-base intent + composite-name extractor

Eject trigger is a strict subset of detectBuildIntent (shares one source of
truth), plus a name extractor mapping a named composite to a real kit file.
Guarantees an eject never fires on a turn routed to the importer (review M5).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 4: The eject-to-source helper

Review M4: rewrite must preserve `as` aliases + `type` qualifiers; the copied file must RENDER (not just parse) because `arcade/components` swaps in size-narrowed wrappers.

**Files:**
- Create: `studio/server/figma/ejectComposite.ts`
- Test: `studio/__tests__/server/figma/ejectComposite.test.ts`

**Interfaces:**
- Consumes: nothing (pure + fs).
- Produces:
  - `rewriteCompositeSource(src: string): string` — pure string transform: relative `./X.js` / `../templates/X.js` imports → `"arcade-prototypes"`; `"@xorkavi/arcade-gen"` → `"arcade/components"`; preserves `as`/`type`.
  - `ejectComposite(name: string, destDir: string): Promise<string>` — copies `prototype-kit/<composites|templates>/<name>.tsx`, rewrites, writes `destDir/<name>.tsx`, returns the written path.

- [ ] **Step 1: Write failing tests**

Create `studio/__tests__/server/figma/ejectComposite.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rewriteCompositeSource, ejectComposite } from "../../../server/figma/ejectComposite";

describe("rewriteCompositeSource", () => {
  it("collapses relative composite + template imports to arcade-prototypes", () => {
    const out = rewriteCompositeSource(
      `import { ChatInput } from "./ChatInput.js";\n` +
      `import { ComputerPage } from "../templates/ComputerPage.js";\n`,
    );
    expect(out).toContain(`from "arcade-prototypes"`);
    expect(out).not.toMatch(/\.\/ChatInput\.js/);
    expect(out).not.toMatch(/\.\.\/templates\/ComputerPage\.js/);
  });

  it("rewrites @xorkavi/arcade-gen to arcade/components", () => {
    const out = rewriteCompositeSource(`import { IconButton } from "@xorkavi/arcade-gen";`);
    expect(out).toContain(`from "arcade/components"`);
    expect(out).not.toContain("@xorkavi/arcade-gen");
  });

  it("preserves an 'as' alias", () => {
    const out = rewriteCompositeSource(`import { Document as DocumentIcon } from "@xorkavi/arcade-gen";`);
    expect(out).toContain("Document as DocumentIcon");
  });

  it("preserves a type-only import qualifier", () => {
    const out = rewriteCompositeSource(`import type { CanvasTab } from "./CanvasTabs.js";`);
    expect(out).toMatch(/import type \{ CanvasTab \} from "arcade-prototypes"/);
  });

  it("leaves react + arcade-prototypes barrel imports untouched", () => {
    const src = `import * as React from "react";\nimport { X } from "arcade-prototypes";`;
    expect(rewriteCompositeSource(src)).toBe(src);
  });
});

describe("ejectComposite", () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes an import-rewritten copy of ComputerScene with no relative/.js or arcade-gen specifiers", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-"));
    const written = await ejectComposite("ComputerScene", dir);
    expect(written).toBe(path.join(dir, "ComputerScene.tsx"));
    const out = fs.readFileSync(written, "utf8");
    expect(out).not.toMatch(/from "\.\.?\/.*\.js"/);   // no relative .js imports
    expect(out).not.toContain("@xorkavi/arcade-gen");
    expect(out).toContain(`from "arcade-prototypes"`);
    // alias survived (ComputerScene imports Document as DocumentIcon)
    expect(out).toContain("Document as DocumentIcon");
  });

  it("throws on an unknown composite name", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-"));
    await expect(ejectComposite("NopeScene", dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm run studio:test __tests__/server/figma/ejectComposite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `studio/server/figma/ejectComposite.ts`:

```ts
/**
 * Eject a kit composite/template's real source into a frame folder so the
 * agent can EDIT it directly, instead of being stuck with the sealed barrel
 * export (whose props expose only a handful of overrides). Copies the .tsx and
 * rewrites its imports to the frame-legal specifiers ("arcade-prototypes",
 * "arcade/components") the frame aliases resolve.
 *
 * Why the agent can't do this itself: CLAUDE.md.tpl forbids reading composite
 * source, and the relative `./X.js` imports inside the kit source don't resolve
 * from a frame folder. The rewrite is the bridge.
 *
 * See spec 2026-07-02-figma-fidelity-eject-and-directive-design.md §2.2.
 */
import fs from "node:fs/promises";
import path from "node:path";

const STUDIO_DIR = path.resolve(__dirname, "..", "..");
const KIT_DIR = path.join(STUDIO_DIR, "prototype-kit");

/**
 * Rewrite a single composite's import lines to frame-legal specifiers.
 * Per-specifier (preserves `as` aliases + `type` qualifiers); does NOT touch
 * `react` or already-barrel imports. Pure.
 */
export function rewriteCompositeSource(src: string): string {
  return src.replace(
    /^(import\s+(?:type\s+)?(?:\{[^}]*\}|[^;'"]+?)\s+from\s+)["']([^"']+)["'](\s*;?)$/gm,
    (full, head: string, spec: string, tail: string) => {
      let next: string | null = null;
      if (spec === "@xorkavi/arcade-gen") next = "arcade/components";
      else if (/^\.\.?\//.test(spec)) next = "arcade-prototypes"; // any relative → barrel
      if (next === null) return full;
      return `${head}"${next}"${tail}`;
    },
  );
}

function kitSourcePath(name: string): string {
  const composite = path.join(KIT_DIR, "composites", `${name}.tsx`);
  const template = path.join(KIT_DIR, "templates", `${name}.tsx`);
  return { composite, template } as unknown as string; // replaced below
}

/**
 * Copy `<name>.tsx` from the kit (composites first, then templates) into
 * `destDir`, with imports rewritten. Returns the written file path. Throws if
 * the composite isn't found in either location.
 */
export async function ejectComposite(name: string, destDir: string): Promise<string> {
  const candidates = [
    path.join(KIT_DIR, "composites", `${name}.tsx`),
    path.join(KIT_DIR, "templates", `${name}.tsx`),
  ];
  let srcPath: string | null = null;
  for (const c of candidates) {
    try { await fs.access(c); srcPath = c; break; } catch { /* try next */ }
  }
  if (!srcPath) throw new Error(`ejectComposite: no kit source for "${name}" in composites/ or templates/`);

  const src = await fs.readFile(srcPath, "utf8");
  const rewritten = rewriteCompositeSource(src);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, `${name}.tsx`);
  await fs.writeFile(dest, rewritten);
  return dest;
}
```

(Delete the stray `kitSourcePath` stub — it was a thinking artifact. Final file must not contain it.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/ejectComposite.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the RENDER check (review M4)**

Append to `studio/__tests__/server/figma/ejectComposite.test.ts` a jsdom render of the ejected file, resolving its `arcade-prototypes` / `arcade/components` specifiers to the real modules via vitest aliases. Because the ejected file is emitted to a temp dir (not under Vite), import it through a small dynamic-import shim OR assert render of the ORIGINAL composite with rewritten imports mapped. Simplest robust check: transform the rewritten source with esbuild and assert it compiles AND that a smoke-mount of the real `ComputerScene` (imported from the barrel, which uses the same wrapper resolution) renders without throwing:

```ts
// @vitest-environment jsdom (add a second test file if mixing envs is awkward)
import { render, cleanup } from "@testing-library/react";
import * as React from "react";
import { ComputerScene } from "../../../prototype-kit";

it("the composite renders under the frame's arcade/components wrapper resolution", () => {
  // Guards review M4: arcade/components swaps size-narrowed Button/IconButton/
  // ChatBubble. Rendering proves the ejected import target is behaviorally OK,
  // not just parseable.
  const { container } = render(<ComputerScene state="empty" />);
  expect(container.firstChild).toBeTruthy();
  cleanup();
});
```

If mixing `node` + `jsdom` in one file is awkward, put this render test in a sibling `studio/__tests__/server/figma/ejectComposite-render.test.tsx` with `// @vitest-environment jsdom`.

- [ ] **Step 6: Run + commit**

Run: `pnpm run studio:test __tests__/server/figma/ejectComposite`
Expected: PASS.

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/figma/ejectComposite.ts "studio/__tests__/server/figma/ejectComposite.test.ts"
# include the render sibling if created:
git add studio/__tests__/server/figma/ejectComposite-render.test.tsx 2>/dev/null || true
git commit -m "feat(studio/figma): eject-to-source helper (import-rewrite + copy)

Copies a kit composite's real source into a frame dir with imports rewritten
to frame specifiers (arcade-prototypes / arcade/components), preserving 'as'
aliases + type qualifiers. Render test guards the arcade/components wrapper
swap (review M4).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 5: Wire eject into the turn + tell the agent

The agent chooses the frame slug mid-turn, so Studio can't eject into `frames/<slug>/` up front. Deliver the ejected copy to a known per-project staging path and instruct the agent (mirrors the `00-computer-reference` precedent) to copy it into its frame and import it locally.

**Files:**
- Modify: `studio/server/middleware/chat.ts` — `runClaudeBranch` (~line 586+), where `enrichPromptWithFigmaContext` result is assembled into the prompt.
- Test: `studio/__tests__/server/middleware/chat-figma-context.test.ts`

**Interfaces:**
- Consumes: `detectComposeBaseIntent`, `extractComposeBaseComposite` from `../figma/generationIntent`; `ejectComposite` from `../figma/ejectComposite`; `projectDir` from `../paths`.
- Produces: on a compose-base turn, a file at `<projectDir>/.eject/<Name>.tsx` and a prompt suffix naming it.

- [ ] **Step 1: Write the failing test**

Add to `chat-figma-context.test.ts`:

```ts
describe("eject-to-source on a compose-base turn", () => {
  it("ejects the named composite and tells the agent where it is", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      "Implement this precisely. Modify the ComputerScene composite as a base. " +
      "https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    // Ejected copy written to the project's .eject staging dir.
    const ejected = path.join(
      process.env.ARCADE_STUDIO_ROOT!, "projects", p.slug, ".eject", "ComputerScene.tsx",
    );
    expect(fs.existsSync(ejected)).toBe(true);

    // Prompt handed to the agent names the ejected path + the local-import rule.
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    expect(sent).toContain(".eject/ComputerScene.tsx");
  });

  it("does NOT eject on a plain precise prompt with no named composite", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2");
    await drainStream(p.slug);
    const ejectDir = path.join(process.env.ARCADE_STUDIO_ROOT!, "projects", p.slug, ".eject");
    expect(fs.existsSync(ejectDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-context.test.ts`
Expected: new tests FAIL — no `.eject` dir, prompt lacks the path.

- [ ] **Step 3: Implement the eject wiring**

In `chat.ts`, add imports:

```ts
import { detectComposeBaseIntent, extractComposeBaseComposite } from "../figma/generationIntent";
import { ejectComposite } from "../figma/ejectComposite";
import { projectDir } from "../paths";  // if not already imported
```

In `runClaudeBranch`, after `enrichPromptWithFigmaContext` returns and before `prependEditContext` (currently ~line 615–621), insert:

```ts
  // Eject-to-source: when the prompt asks to modify a named kit composite as a
  // base, copy its editable source into the project's .eject staging dir and
  // tell the agent to use it. The agent picks its frame slug mid-turn, so we
  // can't write into frames/<slug>/ up front — staging + instruction mirrors
  // the 00-computer-reference seed pattern. See spec §2.2/§2.3.
  let ejectSuffix = "";
  if (detectComposeBaseIntent(ctx.prompt)) {
    const composite = extractComposeBaseComposite(ctx.prompt);
    if (composite) {
      try {
        const ejectDir = path.join(projectDir(slug), ".eject");
        await ejectComposite(composite, ejectDir);
        ejectSuffix =
          `\n\n<eject_to_source>\n` +
          `An EDITABLE copy of ${composite}'s real source has been written to ` +
          `\`.eject/${composite}.tsx\` (relative to the project root). To modify ` +
          `${composite} beyond its props (replace the input, restructure the body, ` +
          `recolor), COPY that file into your new frame folder and import it LOCALLY ` +
          `(\`import { ${composite} } from "./${composite}"\`) instead of from ` +
          `"arcade-prototypes". Edit the local copy directly. Reading/editing THIS ` +
          `copy's source is allowed (the no-composite-source rule applies only to the ` +
          `sealed kit versions).\n` +
          `- For a FULL-CANVAS input: put your input in the scene's body (children) ` +
          `slot and omit the chatInput slot — do NOT just edit the chatInput slot ` +
          `(that yields a bottom bar).\n` +
          `- To RECOLOR the whole UI: override design tokens in theme-overrides.css ` +
          `(see CLAUDE.md), not inline per-surface hex.\n` +
          `</eject_to_source>`;
      } catch (err) {
        console.warn(`[studio] eject failed for ${composite}:`, err);
      }
    }
  }

  const prompt = prependEditContext(enriched.prompt + ejectSuffix, frameSlugs);
```

(Replace the existing `const prompt = prependEditContext(enriched.prompt, frameSlugs);` line with the version above that appends `ejectSuffix`. Confirm `path` is imported at the top of chat.ts — it is used elsewhere; if not, add `import path from "node:path";`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/chat-figma-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard against the project watcher choking on `.eject`**

The project watcher validates slugs and warns on unexpected dirs. `.eject` is inside a project dir (not a project slug), so it's fine — but confirm no code treats project-dir children as frame slugs without a `frames/` prefix. Run the watcher + projects suites:

Run: `pnpm run studio:test __tests__/server/projects.test.ts __tests__/server/project-watch-full-reload-scope.test.ts`
Expected: PASS. If a test flags `.eject`, add it to any ignore list the watcher uses (grep `frameDir`/`readdir` in `server/plugins/projectWatchPlugin.ts`).

- [ ] **Step 6: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat-figma-context.test.ts
git commit -m "feat(studio/figma): eject named composite on compose-base turns + instruct agent

On a build-intent turn that names a kit composite as a base, eject its editable
source to <project>/.eject/<Name>.tsx and append an <eject_to_source> block
telling the agent to copy it into the frame and import locally, plus the
full-canvas-input (body slot) and recolor-via-tokens rules.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 6: CLAUDE.md.tpl — recolor-via-tokens + eject guidance

Review B1: the recolor override MUST use a `.light/.dark`-matching selector and an explicit token list, or it loses the cascade. This task pins that guidance with a content test.

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`
- Test: `studio/__tests__/templates/claude-md-recolor-guidance.test.ts` (CREATE)

**Interfaces:**
- Consumes: nothing.
- Produces: template guidance strings, pinned by test.

- [ ] **Step 1: Write failing tests**

Create `studio/__tests__/templates/claude-md-recolor-guidance.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tpl = fs.readFileSync(
  path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"),
  "utf8",
);

describe("CLAUDE.md.tpl recolor + eject guidance", () => {
  it("mandates a mode-scoped override selector, not a bare :root (review B1)", () => {
    // The kit defines tokens under `:root, :root.light` (specificity 0,2,0);
    // a bare :root override (0,1,0) loses. Pin the correct selector shape.
    expect(tpl).toMatch(/:root\.light/);
    expect(tpl).toMatch(/theme-overrides\.css/);
    // Warns explicitly that a bare :root override is defeated by the cascade.
    expect(tpl).toMatch(/bare `?:root`?|:root alone|loses the cascade|specificity/i);
  });

  it("lists the semantic surface + fg tokens to override, and warns off core primitives", () => {
    expect(tpl).toMatch(/--surface-backdrop/);
    expect(tpl).toMatch(/--surface-shallow/);
    expect(tpl).toMatch(/--surface-overlay/);
    expect(tpl).toMatch(/--fg-neutral-prominent/);
    expect(tpl).toMatch(/--core-neutrals/);   // mentioned as "do NOT override"
  });

  it("explains full-canvas input goes in the body slot, not the chatInput slot (review S2)", () => {
    expect(tpl).toMatch(/full-canvas|full-screen input/i);
    expect(tpl).toMatch(/body \(?children\)? slot|children slot/i);
  });

  it("documents eject-to-source: local copy is editable, sealed kit source is not", () => {
    expect(tpl).toMatch(/\.eject|eject/i);
    expect(tpl).toMatch(/import .* from "\.\//);   // local import guidance
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm run studio:test __tests__/templates/claude-md-recolor-guidance.test.ts`
Expected: FAIL — guidance not yet in the template.

- [ ] **Step 3: Add the guidance section to `CLAUDE.md.tpl`**

Insert a new section (after the existing composite/ComputerScene section, near the `### ComputerScene` block ~line 275). Add verbatim:

```markdown
### Modifying a composite as a base (eject-to-source)

When the prompt asks to **modify / restructure / recolor** a composite (beyond the
handful of props it exposes) — e.g. "use ComputerScene as a base and modify it" — Studio
ejects an editable copy of that composite's real source to `.eject/<Name>.tsx` in the
project root before your turn, and names it in an `<eject_to_source>` block. When you see
that block:

1. **Copy `.eject/<Name>.tsx` into your new frame folder** and import it LOCALLY:
   `import { <Name> } from "./<Name>";` — NOT from `arcade-prototypes`. Edit that local
   copy directly. Reading/editing THIS copy is allowed; the "never read composite source"
   rule applies only to the sealed kit versions.
2. **Full-canvas / full-screen input:** put your input in the scene's **body (`children`)
   slot** and OMIT the `chatInput` slot. Editing the `chatInput` slot only gives you a
   bottom bar — the body slot is what fills the canvas.
3. **Eject a child too** only if that child's *shape* must change (not its color — that's
   tokens below; not the input's position — that's the body slot above).

### Recoloring the whole UI (theme tokens, not inline hex)

To apply a new color theme across the app (sidebar, header, canvas, nav), DO NOT hand-roll
inline gradients or per-surface hex — that only tints the surfaces you touch and leaves the
rest default (the #1 recolor failure). Instead, override the design-token variables in the
project's **`theme-overrides.css`** (already loaded by every frame).

**Selector MUST be mode-scoped — a bare `:root` is silently defeated.** The kit defines
its tokens under `:root, :root.light { … }` (higher specificity than `:root` alone), and
the frame renders with `class="light"`. A bare `:root { --surface-shallow: … }` override
LOSES the cascade and never applies. Write:

```css
:root, :root.light, :root.dark {
  --surface-backdrop: <color>;   /* window */
  --surface-shallow: <color>;    /* sidebar / rail */
  --surface-overlay: <color>;    /* body + header */
  --fg-neutral-prominent: <color>;  /* primary text */
  --fg-neutral-subtle: <color>;     /* muted text */
}
```

Override these **semantic** tokens. Do NOT override `--core-neutrals-*` primitives — they
back many tokens and changing one corrupts everything neutral. Sample the target colors
from the Figma PNG (the PNG is your source for color + layout).
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm run studio:test __tests__/templates/claude-md-recolor-guidance.test.ts`
Expected: PASS. If a `toMatch` misses, adjust the template wording (not the test's intent) until the guidance contains the pinned markers.

- [ ] **Step 5: Refresh existing projects' CLAUDE.md (verify the refresh path still works)**

CLAUDE.md is rendered from the template per project; there's a refresh path (`projects-claude-md-refresh.test.ts`). Run it to ensure the enlarged template still renders:

Run: `pnpm run studio:test __tests__/server/projects-claude-md-refresh.test.ts __tests__/server/claude-md-two-tier.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/templates/CLAUDE.md.tpl studio/__tests__/templates/claude-md-recolor-guidance.test.ts
git commit -m "docs(studio): CLAUDE.md eject-to-source + recolor-via-tokens guidance

Recolor MUST override tokens on :root,:root.light,:root.dark (a bare :root
loses the kit cascade — review B1) using the semantic surface/fg tokens, never
--core-neutrals. Full-canvas input goes in the body slot, not chatInput (S2).
Eject block tells the agent to import the local copy.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 7: Full-suite regression + manual acceptance gate

**Files:** none (verification only).

- [ ] **Step 1: Full studio suite**

Run: `pnpm run studio:test`
Expected: all green (baseline was 1846 passed before this work). Investigate any new failure before proceeding.

- [ ] **Step 2: Typecheck touched files add no new errors**

Run: `npx tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -E "generationIntent|ejectComposite|fidelityDirective|middleware/chat.ts"`
Expected: only the pre-existing chat.ts telemetry/frames errors (L755–789, L1022 region) — NO errors in the edit regions or the new files. (There is a known 235-error repo baseline; the check is that WE add none.)

- [ ] **Step 3: MANUAL acceptance (required — not unit-testable; review B1/S2)**

Restart the app (Vite middleware doesn't hot-reload): `pnpm run studio`. In a fresh project, run the motivating prompt against the clean Figma file:

> Implement this design precisely. … based on the empty state of ComputerScene. Use that composite as a base. … full screen input … purple theme … applied to all of the UI, including canvas and side nav. `<clean-file Figma URL>`

Verify, and screenshot side-by-side with the Figma PNG:
- Frame folder has a local `ComputerScene.tsx`; `index.tsx` imports it locally.
- `theme-overrides.css` overrides tokens on a `:root, :root.light, :root.dark` (or `html.light, html.dark`) selector; sidebar + header + canvas + nav all render PURPLE (not neutral, not just an inline orb).
- The input is a full-canvas editable text field (body slot), pre-filled with the daily-brief text taken from the node tree; NOT a floating modal, NOT a bottom bar.

- [ ] **Step 4: Record the result**

If it matches: capture the screenshot to the spec's acceptance section / handoff note. If it diverges, systematic-debug the specific gap (which of B1/S2/S3 leaked) before declaring done — do NOT paper over with a per-frame patch (see auto-memory `feedback_scalable_accuracy`).

---

## Self-Review

**Spec coverage:**
- §1.1 (decouple directive) → Task 2. ✓
- §1.2 (cap-safe self-fetch + PNG/text split) → Task 1. ✓
- §1.3 (optional wider race) → intentionally OMITTED (spec marks it optional; Task 2 makes it unnecessary for correctness). Noted here so it's a conscious skip, not a gap.
- §2.1 (recolor via tokens: selector + token list) → Task 6 (guidance) + Task 7 Step 3 (manual gate). ✓
- §2.2 (eject helper, one-level default, trigger=subset of build intent, name extractor) → Tasks 3 + 4 + 5. ✓
- §2.3 (template teaching) → Task 6. ✓
- Review B1 → Task 6 selector/token-list guidance + test. ✓
- Review S2 → Task 5 prompt block + Task 6 body-slot guidance. ✓
- Review S3.1 → Task 2 (`detectHiFiIntent` not `shouldUseHiFi`). ✓
- Review S3.2 → Task 1 (PNG/text split). ✓
- Review M4 → Task 4 (alias/type preservation + render test). ✓
- Review M5 → Task 3 (subset trigger + name extractor). ✓

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The one stub (`kitSourcePath` in Task 4 Step 3) is explicitly flagged for deletion.

**Type consistency:** `detectComposeBaseIntent`/`extractComposeBaseComposite`/`EJECTABLE_COMPOSITES` (Task 3) consumed verbatim in Task 5. `rewriteCompositeSource`/`ejectComposite` (Task 4) consumed in Task 5. `detectHiFiIntent`/`buildHiFiDirective` (Task 1/existing) consumed in Task 2. Names match across tasks.

**Known risk to watch during execution:** Task 2's test assumes the digest MISSES in the test env (no `figmanage`). If the env resolves a real digest, the test must mock `getFigmaIngest` (noted in Task 2 Step 1). Task 5's `.eject` dir must not trip the project watcher (Task 5 Step 5 verifies).
