# Studio MEMORY (project + global) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-level persistent MEMORY (global + project) that always injects into every Studio generation turn, with human-authored `RULES.md` and agent-appended `LEARNED.md` per level.

**Architecture:** Memory rides the existing `CLAUDE.md` `@import` + `--add-dir` rails. Project memory lives in `<projectDir>/memory/` (already covered by `--add-dir opts.cwd`). Global memory lives in `<studioRoot>/memory/` and gets a new `--add-dir`. The `CLAUDE.md.tpl` template gains a `## Memory` section with four `@import` lines plus a memory-protocol section telling the agent when/how to append learned facts. Files are seeded as idempotent stubs at project-create and server-boot.

**Tech Stack:** TypeScript, Node `fs/promises`, Vitest, Vite middleware, Claude Code CLI subprocess.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `studio/server/paths.ts` | Path helpers | Add `globalMemoryDir()`, `projectMemoryDir(slug)` |
| `studio/server/memory.ts` | Memory stub seeding | **New** — `ensureMemoryStubs(dir, scope)` |
| `studio/server/projects.ts` | Project CRUD + template render + boot refresh | Seed project memory in `createProject`; backfill in `refreshStaleClaudeMd`; pass `GLOBAL_MEMORY` render var |
| `studio/server/claudeCode.ts` | Subprocess spawn | Add `globalMemoryDir()` to default `addDirs` |
| `studio/templates/CLAUDE.md.tpl` | Per-project system prompt | Add `## Memory` section (imports + protocol) |
| `studio/vite.config.ts` | Server boot wiring | Seed global memory dir before refresh |
| `studio/__tests__/server/paths.test.ts` | Path tests | Add memory-dir cases |
| `studio/__tests__/server/memory.test.ts` | Seeding tests | **New** |
| `studio/__tests__/server/projects.test.ts` | Project tests | Add seed + backfill cases |
| `studio/__tests__/server/claudeCode.test.ts` | Spawn-arg tests | Add global memory `--add-dir` case |

---

## Task 1: Path helpers

**Files:**
- Modify: `studio/server/paths.ts` (after `designMdPath`, ~line 84)
- Test: `studio/__tests__/server/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `studio/__tests__/server/paths.test.ts`. First extend the import on line 4 to include the two new helpers:

```ts
import { studioRoot, projectsRoot, projectDir, frameDir, designMdPath, multiplayerRoot, sessionsJsonPath, globalMemoryDir, projectMemoryDir } from "../../server/paths";
```

Then append this describe block:

```ts
describe("memory paths", () => {
  it("globalMemoryDir sits inside studioRoot", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-test";
    expect(globalMemoryDir()).toBe("/tmp/studio-test/memory");
    delete process.env.ARCADE_STUDIO_ROOT;
  });

  it("projectMemoryDir nests under projectDir", () => {
    expect(projectMemoryDir("my-project")).toBe(
      path.join(projectsRoot(), "my-project", "memory"),
    );
  });

  it("projectMemoryDir rejects invalid slugs", () => {
    expect(() => projectMemoryDir("../etc")).toThrow(/Invalid slug/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: FAIL — `globalMemoryDir is not a function` (import undefined).

- [ ] **Step 3: Implement the helpers**

In `studio/server/paths.ts`, add after the `designMdPath` function (~line 84):

```ts
/**
 * Global memory directory — applies to every project. Holds RULES.md
 * (human-authored standing instructions) + LEARNED.md (agent append-only
 * cross-project facts). Sibling of projects/; granted to the generator
 * subprocess via --add-dir so the agent can read AND append.
 */
export function globalMemoryDir(): string {
  return path.join(studioRoot(), "memory");
}

/**
 * Per-project memory directory. Same RULES.md + LEARNED.md shape as global,
 * scoped to one project. Lives inside the project cwd so it's already
 * readable/writable via the existing --add-dir opts.cwd.
 */
export function projectMemoryDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "memory");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: PASS (all cases including the new memory block).

- [ ] **Step 5: Commit**

```bash
git add studio/server/paths.ts studio/__tests__/server/paths.test.ts
git commit -m "feat(studio/memory): add global + project memory path helpers"
```

---

## Task 2: Memory stub seeding module

**Files:**
- Create: `studio/server/memory.ts`
- Test: `studio/__tests__/server/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `studio/__tests__/server/memory.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureMemoryStubs } from "../../server/memory";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-memory-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ensureMemoryStubs", () => {
  it("creates the dir and both stub files when absent", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "global");
    expect(fs.existsSync(path.join(dir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "LEARNED.md"))).toBe(true);
  });

  it("scope label appears in the stub header", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "this project");
    const rules = fs.readFileSync(path.join(dir, "RULES.md"), "utf-8");
    expect(rules).toContain("this project");
  });

  it("does not overwrite an edited file (idempotent)", async () => {
    const dir = path.join(tmp, "memory");
    await ensureMemoryStubs(dir, "global");
    const learned = path.join(dir, "LEARNED.md");
    fs.writeFileSync(learned, "- prefers teal accents <!-- 2026-06-04 -->\n");
    await ensureMemoryStubs(dir, "global");
    expect(fs.readFileSync(learned, "utf-8")).toBe(
      "- prefers teal accents <!-- 2026-06-04 -->\n",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/memory.test.ts`
Expected: FAIL — cannot find module `../../server/memory`.

- [ ] **Step 3: Implement the module**

Create `studio/server/memory.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

function rulesStub(scope: string): string {
  return `<!-- RULES.md — your standing instructions for ${scope}. Hand-written.
     The generator reads this every turn but never edits it. -->
`;
}

function learnedStub(scope: string): string {
  return `<!-- LEARNED.md — facts the generator remembers about ${scope}.
     Auto-appended during generation; safe to edit or prune by hand. -->
`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotently seed RULES.md + LEARNED.md stubs in `dir`. Creates `dir` if
 * needed. NEVER overwrites a file that already exists — edited content (by
 * the user in RULES.md, or appended by the agent in LEARNED.md) is preserved.
 * `scope` is a human label woven into the stub header ("global", "this
 * project", …).
 */
export async function ensureMemoryStubs(dir: string, scope: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const rules = path.join(dir, "RULES.md");
  const learned = path.join(dir, "LEARNED.md");
  if (!(await fileExists(rules))) await fs.writeFile(rules, rulesStub(scope));
  if (!(await fileExists(learned))) await fs.writeFile(learned, learnedStub(scope));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/memory.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add studio/server/memory.ts studio/__tests__/server/memory.test.ts
git commit -m "feat(studio/memory): add idempotent memory stub seeding"
```

---

## Task 3: Seed project memory on create + backfill on boot

**Files:**
- Modify: `studio/server/projects.ts` (imports; `createProject` ~line 110-125; `refreshStaleClaudeMd` ~line 327-356)
- Test: `studio/__tests__/server/projects.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `studio/__tests__/server/projects.test.ts` inside the `describe("projects CRUD", …)` block (or a new describe):

```ts
describe("project memory seeding", () => {
  it("createProject seeds memory/RULES.md + memory/LEARNED.md", async () => {
    await createProject({ name: "Mem Proj", theme: "arcade", mode: "light" });
    const memDir = path.join(tmp, "projects", "mem-proj", "memory");
    expect(fs.existsSync(path.join(memDir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(memDir, "LEARNED.md"))).toBe(true);
  });

  it("refreshStaleClaudeMd backfills memory/ for a project lacking it", async () => {
    await createProject({ name: "Old Proj", theme: "arcade", mode: "light" });
    // Simulate a pre-feature project: delete its memory dir.
    const memDir = path.join(tmp, "projects", "old-proj", "memory");
    fs.rmSync(memDir, { recursive: true, force: true });
    expect(fs.existsSync(memDir)).toBe(false);

    await refreshStaleClaudeMd();
    expect(fs.existsSync(path.join(memDir, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(memDir, "LEARNED.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`
Expected: FAIL — `memory/RULES.md` does not exist (seeding not wired yet).

- [ ] **Step 3: Implement seeding + backfill**

In `studio/server/projects.ts`:

(a) Extend the paths import (line 5) to add `projectMemoryDir`:

```ts
import { projectDir, projectsRoot, projectJsonPath, chatHistoryPath, projectMemoryDir, globalMemoryDir } from "./paths";
```

(b) Add the memory import near the top with the other imports:

```ts
import { ensureMemoryStubs } from "./memory";
```

(c) In `createProject`, inside the `try` block after `await fs.writeFile(chatHistoryPath(slug), "[]");` (~line 123), before `await scaffoldDevRevHelper(slug);`:

```ts
    await ensureMemoryStubs(projectMemoryDir(slug), "this project");
```

(d) In `refreshStaleClaudeMd`, inside the `for (const p of ps)` loop, as the first statement of the loop body (before the `renderTemplate` call ~line 332), backfill memory for every project regardless of whether CLAUDE.md is stale:

```ts
    // Backfill memory/ for projects created before the memory feature. Idempotent.
    await ensureMemoryStubs(projectMemoryDir(p.slug), "this project");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`
Expected: PASS (including the two new memory cases). The existing CRUD/rename tests still pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/projects.ts studio/__tests__/server/projects.test.ts
git commit -m "feat(studio/memory): seed project memory on create + backfill on boot"
```

---

## Task 4: Pass GLOBAL_MEMORY render var + template Memory section

**Files:**
- Modify: `studio/server/projects.ts` (`createProject` renderTemplate vars ~line 117-122; `refreshStaleClaudeMd` renderTemplate vars ~line 332-337)
- Modify: `studio/templates/CLAUDE.md.tpl` (after the `@DESIGN.md` block, ~line 108)
- Test: `studio/__tests__/server/projects.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `studio/__tests__/server/projects.test.ts`:

```ts
describe("CLAUDE.md memory imports", () => {
  it("renders the four memory @import lines with a resolved global path", async () => {
    await createProject({ name: "Mem Imports", theme: "arcade", mode: "light" });
    const md = fs.readFileSync(
      path.join(tmp, "projects", "mem-imports", "CLAUDE.md"),
      "utf-8",
    );
    // Project-relative imports
    expect(md).toContain("@memory/RULES.md");
    expect(md).toContain("@memory/LEARNED.md");
    // Global imports resolved to an absolute path under the tmp studio root
    expect(md).toContain(`@${path.join(tmp, "memory", "RULES.md")}`);
    expect(md).toContain(`@${path.join(tmp, "memory", "LEARNED.md")}`);
    // No unreplaced placeholder
    expect(md).not.toContain("{{GLOBAL_MEMORY}}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`
Expected: FAIL — `@memory/RULES.md` not found (template lacks the section) and/or `{{GLOBAL_MEMORY}}` unreplaced.

- [ ] **Step 3a: Add the Memory section to the template**

In `studio/templates/CLAUDE.md.tpl`, immediately after the `@DESIGN.md` line (line 107) and its blank line, insert:

```
## Memory

Two layers of durable context apply to every turn. Read them before making
design decisions; when memory conflicts with one-off prompt phrasing, memory
wins (the designer told you this on purpose, across turns).

Global memory (applies to every project):
@{{GLOBAL_MEMORY}}/RULES.md
@{{GLOBAL_MEMORY}}/LEARNED.md

Project memory (this project only):
@memory/RULES.md
@memory/LEARNED.md

### Memory protocol — how you keep memory

- `RULES.md` is human-authored. You NEVER edit it. Read it, honor it.
- `LEARNED.md` is yours to maintain. When you notice a **durable** preference
  or correction during a turn — something the designer will want applied to
  *future* frames, not a one-off tweak to the current frame — append one line:
  - a fact specific to this project → `memory/LEARNED.md`
  - a cross-project taste/preference → `{{GLOBAL_MEMORY}}/LEARNED.md`
- Line format: `- <fact> <!-- YYYY-MM-DD --> ` (one fact per line).
- Before appending, read the target `LEARNED.md` and check for a near-duplicate.
  If one exists, update that line instead of adding a second.
- Do NOT record: secrets or tokens, volatile file paths, or this-frame-only
  details ("made this heading bigger"). Record taste, conventions, and
  recurring corrections — the things worth remembering next time.
- If the prompt contains an explicit `remember:` instruction (e.g.
  "remember: always use teal accents"), write that fact verbatim to
  `LEARNED.md`. Choose project vs global from context; if genuinely ambiguous,
  write it to the project file.
- Memory bookkeeping is SILENT: appending to `LEARNED.md` does NOT count as the
  turn's frame change, does NOT appear in your journey lines, and does NOT go in
  the `### Deviations` section. A frame-editing turn still requires a real frame
  edit. A bare `remember:` turn with no frame work may produce no frame change
  and no `### Deviations` section.
```

- [ ] **Step 3b: Pass the GLOBAL_MEMORY var in both render sites**

In `studio/server/projects.ts`, `createProject` (the `renderTemplate(tpl, { … })` call ~line 117-122) — add the var:

```ts
    await fs.writeFile(path.join(dir, "CLAUDE.md"), renderTemplate(tpl, {
      PROJECT_NAME: input.name,
      THEME: input.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
      GLOBAL_MEMORY: globalMemoryDir(),
    }));
```

In `refreshStaleClaudeMd` (the `renderTemplate(tpl, { … })` call ~line 332-337) — add the same var:

```ts
    const rendered = renderTemplate(tpl, {
      PROJECT_NAME: p.name,
      THEME: p.theme,
      ARCADE: ARCADE_GEN_ROOT,
      PROTOTYPER: PROTOTYPER_ROOT,
      GLOBAL_MEMORY: globalMemoryDir(),
    });
```

(`globalMemoryDir` is already imported via the Task 3 import change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`
Expected: PASS. Note: adding `GLOBAL_MEMORY` to the render changes the rendered output, so the existing `projects-claude-md-refresh.test.ts` "stale → rewrite" behavior still holds (the template genuinely changed). Run it too:

Run: `pnpm run studio:test __tests__/server/projects-claude-md-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/projects.ts studio/templates/CLAUDE.md.tpl studio/__tests__/server/projects.test.ts
git commit -m "feat(studio/memory): inject memory @imports + protocol into CLAUDE.md"
```

---

## Task 5: Add global memory dir to subprocess --add-dir

**Files:**
- Modify: `studio/server/claudeCode.ts` (imports; `addDirs` default ~line 99)
- Test: `studio/__tests__/server/claudeCode.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `studio/__tests__/server/claudeCode.test.ts` inside `describe("runClaudeTurn", …)`:

```ts
it("passes --add-dir for the global memory dir", async () => {
  const spy = path.join(__dirname, "../fixtures/fake-claude-mem-spy.sh");
  const logFile = path.join(os.tmpdir(), `claude-mem-${Date.now()}.log`);
  fs.writeFileSync(spy, `#!/usr/bin/env bash\necho "$@" >> ${logFile}\nprintf '{"type":"result","subtype":"success"}\\n'\n`, { mode: 0o755 });
  fs.writeFileSync(logFile, "");
  process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-mem-test";
  try {
    await runClaudeTurn({ cwd: os.tmpdir(), prompt: "hi", bin: spy, onEvent: () => {} });
    const args = fs.readFileSync(logFile, "utf-8");
    expect(args).toContain("--add-dir /tmp/studio-mem-test/memory");
  } finally {
    delete process.env.ARCADE_STUDIO_ROOT;
    fs.rmSync(spy, { force: true });
    fs.rmSync(logFile, { force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/claudeCode.test.ts`
Expected: FAIL — args do not contain `--add-dir /tmp/studio-mem-test/memory`.

- [ ] **Step 3: Implement**

In `studio/server/claudeCode.ts`:

(a) Add the import near the top (the file currently imports from `node:path`, `node:url`, and `../src/lib/streamJson` — add a sibling import):

```ts
import { globalMemoryDir } from "./paths";
```

(b) Change the `addDirs` default (line 99) to include the global memory dir:

```ts
  const addDirs = opts.addDirs ?? [PROTOTYPER_ROOT, ARCADE_GEN_ROOT, globalMemoryDir()];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/claudeCode.test.ts`
Expected: PASS (all cases, including existing `--resume` / partial-messages / env-strip tests).

- [ ] **Step 5: Commit**

```bash
git add studio/server/claudeCode.ts studio/__tests__/server/claudeCode.test.ts
git commit -m "feat(studio/memory): grant subprocess read+write to global memory dir"
```

---

## Task 6: Seed global memory dir on server boot

**Files:**
- Modify: `studio/vite.config.ts` (imports ~line 43; boot block ~line 128-132)

No new unit test — this is one-line boot wiring that calls the already-tested `ensureMemoryStubs`. It is exercised end-to-end on next `pnpm run studio` (manual verification in Step 3).

- [ ] **Step 1: Add the import**

In `studio/vite.config.ts`, alongside the existing `import { refreshStaleClaudeMd } from "./server/projects";` (line 43):

```ts
import { ensureMemoryStubs } from "./server/memory";
import { globalMemoryDir } from "./server/paths";
```

(If `globalMemoryDir` or a sibling from `./server/paths` is already imported in this file, merge into the existing import statement instead of adding a duplicate.)

- [ ] **Step 2: Seed global memory before the refresh**

In the boot block (~line 128-132), add a seeding call before `refreshStaleClaudeMd()` so the global dir exists before the first turn's `--add-dir` references it:

```ts
      void logVersionOnBoot();
      void cleanStaleStagingSessions();
      void ensureMemoryStubs(globalMemoryDir(), "global")
        .catch((err) => console.warn("[studio] global memory seed failed:", err));
      refreshStaleClaudeMd()
        .then((n) => { if (n > 0) console.log(`[studio] refreshed CLAUDE.md for ${n} project(s)`); })
        .catch((err) => console.warn("[studio] CLAUDE.md refresh failed:", err));
```

- [ ] **Step 3: Verify end-to-end (manual)**

Run: `pnpm run studio` (or restart if already running — Vite middleware does NOT hot-reload).
Then check the global dir was seeded:

Run: `ls "$HOME/Library/Application Support/arcade-studio/memory/"`
Expected: `LEARNED.md  RULES.md`

Open an existing project, send a trivial prompt (e.g. "make the heading say Hello"), and confirm the project's memory dir exists:

Run: `ls "$HOME/Library/Application Support/arcade-studio/projects/"<some-slug>"/memory/"`
Expected: `LEARNED.md  RULES.md`

Confirm the rendered CLAUDE.md has the imports:

Run: `grep -n "memory/RULES.md\|GLOBAL_MEMORY" "$HOME/Library/Application Support/arcade-studio/projects/"<some-slug>"/CLAUDE.md"`
Expected: the four `@…RULES.md` / `@…LEARNED.md` lines, no literal `{{GLOBAL_MEMORY}}`.

- [ ] **Step 4: Commit**

```bash
git add studio/vite.config.ts
git commit -m "feat(studio/memory): seed global memory dir on server boot"
```

---

## Task 7: Full suite + manual learn-loop check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: PASS (all existing tests + the new memory cases; ~no regressions).

- [ ] **Step 2: Manual learn-loop smoke test**

With `pnpm run studio` running, in an existing project send:

> remember: always use teal as the primary accent color

Then check the file got a line:

Run: `cat "$HOME/Library/Application Support/arcade-studio/projects/"<slug>"/memory/LEARNED.md"`
Expected: a bullet like `- always use teal as the primary accent color <!-- 2026-06-04 -->` (the agent may route it to global instead — either is acceptable; check both files).

This step validates the prompt-driven behavior (not unit-testable). If the agent does not append, note it as a prompt-tuning follow-up — the plumbing (files, imports, --add-dir) is independently verified by the unit tests and Task 6 Step 3.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -p   # stage only intentional fixes; NEVER git add -A in this repo
git commit -m "test(studio/memory): verify memory end-to-end"
```

---

## Self-Review notes

- **Spec coverage:** §"File layout" → Tasks 1,2,3,6. §"How memory reaches the generator" → Tasks 4 (imports) + 5 (global --add-dir). §"Components to change" 1-4 → Tasks 1,5,4,3+6. §"Seeding" (project/global/backfill) → Tasks 3,6,3. §"Memory protocol" + "remember:" → Task 4 template. §"Testing" bullets → Tasks 1,2,3,4,5. §"Out of scope" → nothing built (correct).
- **No filesystem enforcement of RULES.md read-only** is intentional (spec §"Error handling", §"Out of scope") — prompt instruction only in v1.
- **Type consistency:** `ensureMemoryStubs(dir, scope)`, `globalMemoryDir()`, `projectMemoryDir(slug)` used identically across Tasks 1-6. Render var named `GLOBAL_MEMORY` consistently in template + both render sites.
- **Release:** per auto-memory `feedback-fixes-local-test`, this is local-test only — no version bump / CHANGELOG / pack unless the user asks to ship a DMG. `refreshStaleClaudeMd` rolls the template change to existing projects on next boot automatically.
