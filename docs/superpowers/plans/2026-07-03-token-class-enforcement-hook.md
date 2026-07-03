# Token-class enforcement hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PostToolUse hook that BLOCKS a generated frame when it uses design-token utility classes in the un-compilable "named" form (`text-fg-neutral-medium`, `bg-surface-shallow`, `bg-intelligence-prominent`) instead of the paren form the kit actually uses (`text-(--fg-neutral-medium)`), so a frame that would render with no colors can't be saved — the agent self-corrects in the same turn.

**Architecture:** Mirror the existing `validateArcadeImports.mjs` hook exactly — pure exported functions + a `main()` that reads the PostToolUse stdin payload and exits 0 (pass) or 2 (block). Load the valid token-name set from `@xorkavi/arcade-gen/dist/styles.css` (source of truth, resolvable on every machine incl. the DMG). Detect classes of the form `<prefix>-<token-tail>` where the tail maps to a real token but the class uses the named (non-paren) form. Fail open if the token source can't be resolved. Register alongside the import validator in `claudeCode.ts`. Teach the correct syntax in `CLAUDE.md.tpl` as first-line defense.

**Tech Stack:** Node ESM `.mjs` hook, Vitest (`pnpm run studio:test`), the claude CLI PostToolUse hook mechanism.

Spec: `docs/superpowers/specs/2026-07-03-token-class-enforcement-hook-design.md`

## Global Constraints

- **Package manager pnpm.** Tests: `pnpm run studio:test <path>` from repo root `/Users/andrey.sundiev/arcade-prototyper` (NOT from `studio/`).
- **Conventional Commits**, scope `studio/figma` or `studio/hooks`. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — stage explicit paths.
- **Vite middleware does NOT hot-reload** — `claudeCode.ts` / hook changes need an app restart to take effect live (irrelevant to unit tests).
- **Hooks launch via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`** (the `hookCommand()` helper) — NEVER bare `node` (exits 127 on the DMG; see auto-memory `studio-hooks-node-not-found-dmg`).
- **The hook must fail OPEN** on any parse/resolution error — a broken hook must never wedge generation. Same contract as `validateArcadeImports.mjs`.
- **Detection rule = the narrow one** (spec Option 1): flag only `<prefix>-<tail>` classes whose tail is a REAL token. Do NOT flag arbitrary brackets (`bg-[#hex]` — they render), real utilities (`text-body-small`, `flex`), or genuinely-custom classes.
- **RTK caveat (environment):** the `rtk-rewrite.sh` Bash hook has failed its integrity check repeatedly this session, blocking all Bash. If a command returns `rtk: hook integrity check FAILED`, the user must run `rtk init -g --auto-patch` before proceeding.

---

## File Structure

- `studio/server/hooks/validateTokenClasses.mjs` — NEW. The hook: token-set loader + class parser + violation detector + suggestion formatter + `main()`. Mirrors `validateArcadeImports.mjs` shape.
- `studio/server/claudeCode.ts` — MODIFY. Add `VALIDATE_TOKEN_CLASSES_HOOK` const + register it in the PostToolUse `Write|Edit` matcher.
- `studio/templates/CLAUDE.md.tpl` — MODIFY. Add the exact paren-class syntax + worked example in the styling-rules section.
- `studio/__tests__/server/hooks/validateTokenClasses.test.ts` — NEW. Pure-function unit tests, mirrors `validateArcadeImports.test.ts`.
- `studio/__tests__/templates/claude-md-token-class-syntax.test.ts` — NEW. Pins the template guidance.

---

## Task 1: Token-set loader + class detector (pure functions)

The core logic, all pure + exported for test. No stdin, no wiring yet.

**Files:**
- Create: `studio/server/hooks/validateTokenClasses.mjs`
- Test: `studio/__tests__/server/hooks/validateTokenClasses.test.ts`

**Interfaces:**
- Produces:
  - `extractTokenNames(cssText: string): Set<string>` — every custom-property NAME defined in the CSS (e.g. `fg-neutral-medium`, `surface-shallow`, `bg-intelligence-prominent`), WITHOUT the leading `--`.
  - `parseClassNames(source: string): string[]` — every class token from `className="…"` / `className={"…"}` / `class="…"` string literals in the source, whitespace-split, deduped.
  - `detectTokenClassViolations(classes: string[], tokenNames: Set<string>): { badClass: string, suggestion: string }[]` — one violation per class of the named-token form whose tail is a real token. `suggestion` is the paren form.

- [ ] **Step 1: Write the failing tests**

Create `studio/__tests__/server/hooks/validateTokenClasses.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  extractTokenNames,
  parseClassNames,
  detectTokenClassViolations,
} from "../../../server/hooks/validateTokenClasses.mjs";

describe("extractTokenNames", () => {
  it("pulls custom-property names (sans --) from CSS", () => {
    const css = `:root{--fg-neutral-medium:#615e5f;--surface-shallow:#faf9f9;--bg-intelligence-prominent:#5800e6;}`;
    const names = extractTokenNames(css);
    expect(names.has("fg-neutral-medium")).toBe(true);
    expect(names.has("surface-shallow")).toBe(true);
    expect(names.has("bg-intelligence-prominent")).toBe(true);
  });
  it("returns empty set on non-string / empty", () => {
    expect(extractTokenNames("").size).toBe(0);
    expect(extractTokenNames(undefined).size).toBe(0);
  });
});

describe("parseClassNames", () => {
  it("extracts classes from className string literals", () => {
    const src = `<div className="flex text-fg-neutral-medium px-4"><span className={"bg-surface-shallow"} /></div>`;
    const c = parseClassNames(src);
    expect(c).toContain("text-fg-neutral-medium");
    expect(c).toContain("bg-surface-shallow");
    expect(c).toContain("flex");
    expect(c).toContain("px-4");
  });
  it("ignores dynamic className expressions it can't read as a literal", () => {
    // A template/interpolated className yields no bare string literal; we just
    // don't crash and return whatever literals we can see.
    const src = "<div className={cx(styles.a)} />";
    expect(Array.isArray(parseClassNames(src))).toBe(true);
  });
});

describe("detectTokenClassViolations", () => {
  const tokens = new Set([
    "fg-neutral-medium", "fg-neutral-prominent", "surface-shallow",
    "surface-overlay", "bg-intelligence-prominent", "stroke-neutral-subtle",
  ]);

  it("flags the named-token form and suggests the paren form", () => {
    const v = detectTokenClassViolations(
      ["text-fg-neutral-medium", "bg-surface-shallow", "bg-intelligence-prominent", "border-stroke-neutral-subtle"],
      tokens,
    );
    const bad = v.map((x) => x.badClass);
    expect(bad).toContain("text-fg-neutral-medium");
    expect(bad).toContain("bg-surface-shallow");
    expect(bad).toContain("bg-intelligence-prominent");
    expect(bad).toContain("border-stroke-neutral-subtle");
    const sug = Object.fromEntries(v.map((x) => [x.badClass, x.suggestion]));
    expect(sug["text-fg-neutral-medium"]).toBe("text-(--fg-neutral-medium)");
    expect(sug["bg-surface-shallow"]).toBe("bg-(--surface-shallow)");
  });

  it("does NOT flag real utilities, paren form, arbitrary brackets, or custom classes", () => {
    const v = detectTokenClassViolations(
      [
        "text-body-small", "text-caption", "text-title-2", "flex", "px-4", "gap-2",
        "text-(--fg-neutral-prominent)", "bg-(--surface-overlay)",
        "bg-[#FAF9F9]", "hover:bg-black/5", "rounded-square-x2", "my-custom-thing",
      ],
      tokens,
    );
    expect(v).toEqual([]);
  });

  it("handles variant prefixes (hover:, md:) on a bad token class", () => {
    const v = detectTokenClassViolations(["hover:text-fg-neutral-medium"], tokens);
    expect(v[0]?.badClass).toBe("hover:text-fg-neutral-medium");
    expect(v[0]?.suggestion).toBe("hover:text-(--fg-neutral-medium)");
  });

  it("fails open: empty token set → no violations", () => {
    expect(detectTokenClassViolations(["text-fg-neutral-medium"], new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm run studio:test __tests__/server/hooks/validateTokenClasses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure functions**

Create `studio/server/hooks/validateTokenClasses.mjs`:

```js
#!/usr/bin/env node
// PostToolUse hook: block Write/Edit that use design-token utility classes in
// the un-compilable "named" form (text-fg-neutral-medium) instead of the paren
// form the kit uses (text-(--fg-neutral-medium)). Tailwind v4 compiles the
// named form to NOTHING, so the frame renders with no colors (the
// implement-this-design-precisely-3 "unstyled frame" bug). Mirrors
// validateArcadeImports.mjs: pure exports for tests + main() that exits 0/2.
// Fails open on any error — a broken hook must not wedge generation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Tailwind prefixes that take a color/token value. A class of the form
// `<prefix>-<tail>` where <tail> is a real token name but written WITHOUT the
// paren/`--` form never compiles → silent no-op.
const TOKEN_PREFIXES = [
  "text", "bg", "border", "fill", "ring", "stroke", "from", "to", "via",
  "divide", "outline", "decoration", "shadow", "accent", "caret", "placeholder",
];

/** Every custom-property name (sans leading --) defined in the CSS text. */
export function extractTokenNames(cssText) {
  const out = new Set();
  if (typeof cssText !== "string" || !cssText) return out;
  const re = /--([a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Class tokens from className/class string literals in the source. */
export function parseClassNames(source) {
  if (typeof source !== "string" || !source) return [];
  const out = new Set();
  // className="…"  |  className={"…"}  |  class="…"  (single or double quotes)
  const re = /class(?:Name)?=\{?\s*["'`]([^"'`]*)["'`]\s*\}?/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      const t = tok.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

/**
 * Split a class into its optional variant prefix chain (hover:, md:, etc.) and
 * the base utility. Returns { variants, base } where variants includes the
 * trailing ":" chain (e.g. "hover:") or "" if none.
 */
function splitVariants(cls) {
  const idx = cls.lastIndexOf(":");
  if (idx === -1) return { variants: "", base: cls };
  return { variants: cls.slice(0, idx + 1), base: cls.slice(idx + 1) };
}

/**
 * One violation per class of the named-token form whose tail is a real token.
 * e.g. `text-fg-neutral-medium` → tail `fg-neutral-medium` ∈ tokens →
 * suggest `text-(--fg-neutral-medium)`. Preserves any variant prefix.
 * Fails open: empty token set → no violations.
 */
export function detectTokenClassViolations(classes, tokenNames) {
  if (!tokenNames || tokenNames.size === 0) return [];
  const out = [];
  for (const cls of classes) {
    // Skip the correct paren form and arbitrary brackets outright.
    if (cls.includes("(--") || cls.includes("[")) continue;
    const { variants, base } = splitVariants(cls);
    const dash = base.indexOf("-");
    if (dash === -1) continue;
    const prefix = base.slice(0, dash);
    const tail = base.slice(dash + 1);
    if (!TOKEN_PREFIXES.includes(prefix)) continue;
    if (!tokenNames.has(tail.toLowerCase())) continue; // tail isn't a real token → not ours
    out.push({
      badClass: cls,
      suggestion: `${variants}${prefix}-(--${tail})`,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm run studio:test __tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/hooks/validateTokenClasses.mjs studio/__tests__/server/hooks/validateTokenClasses.test.ts
git commit -m "feat(studio/hooks): token-class violation detector (pure fns)

Detects design-token utility classes in the un-compilable named form
(text-fg-neutral-medium) vs the paren form the kit uses
(text-(--fg-neutral-medium)) — the Tailwind-v4 silent no-op behind the
unstyled-frame bug. Pure fns + tests; token set loaded from CSS, class parse,
narrow detection (tail must be a real token; skips paren form + brackets +
real utilities). Fail-open on empty token set.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 2: Token-source resolution + main() (the runnable hook)

Wire the pure functions to a real CSS source + the PostToolUse stdin/exit protocol.

**Files:**
- Modify: `studio/server/hooks/validateTokenClasses.mjs` (append loader + main)
- Test: `studio/__tests__/server/hooks/validateTokenClasses.test.ts` (add loader test)

**Interfaces:**
- Consumes: `extractTokenNames`, `parseClassNames`, `detectTokenClassViolations` (Task 1).
- Produces:
  - `loadTokenNames(): Set<string>` — resolves `@xorkavi/arcade-gen/dist/styles.css` and returns `extractTokenNames` of it; empty set on failure (fail open).
  - `formatTokenClassError(violations): string` — the stderr block.
  - `main()` — reads stdin PostToolUse payload, exits 2 on violations, else 0.

- [ ] **Step 1: Write the failing test**

Append to `validateTokenClasses.test.ts`:

```ts
import { loadTokenNames, formatTokenClassError } from "../../../server/hooks/validateTokenClasses.mjs";

describe("loadTokenNames (real arcade-gen styles.css)", () => {
  it("resolves the shipped token CSS and contains known tokens", () => {
    const names = loadTokenNames();
    // arcade-gen dist/styles.css defines 1000+ custom props incl. these.
    expect(names.has("fg-neutral-medium")).toBe(true);
    expect(names.has("surface-shallow")).toBe(true);
    expect(names.size).toBeGreaterThan(100);
  });
});

describe("formatTokenClassError", () => {
  it("names each bad class + its paren-form fix", () => {
    const msg = formatTokenClassError([
      { badClass: "text-fg-neutral-medium", suggestion: "text-(--fg-neutral-medium)" },
    ]);
    expect(msg).toContain("text-fg-neutral-medium");
    expect(msg).toContain("text-(--fg-neutral-medium)");
    expect(msg).toMatch(/compile to nothing|render/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/server/hooks/validateTokenClasses.test.ts`
Expected: FAIL — `loadTokenNames` / `formatTokenClassError` not exported.

- [ ] **Step 3: Implement loader + main**

Append to `validateTokenClasses.mjs`:

```js
/**
 * Resolve the shipped arcade-gen token CSS and return its token-name set.
 * The runtime aliases `arcade/components` to a barrel that re-exports
 * @xorkavi/arcade-gen; the compiled tokens live in that package's
 * dist/styles.css — present on every machine incl. the packaged DMG.
 * Fails open (empty set) if unresolvable — mirrors validateArcadeImports'
 * empty-barrel guard.
 */
export function loadTokenNames() {
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen"); // → dist/index.mjs
    const cssPath = path.join(path.dirname(mainEntry), "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    return extractTokenNames(css);
  } catch {
    return new Set(); // fail open
  }
}

export function formatTokenClassError(violations) {
  if (!violations.length) return "";
  const lines = [];
  lines.push("Blocked: these design-token classes compile to NOTHING in Tailwind v4");
  lines.push("(they render no color/background). Use the CSS-variable paren form:");
  lines.push("");
  for (const v of violations) {
    lines.push(`  - \`${v.badClass}\` → \`${v.suggestion}\``);
  }
  lines.push("");
  lines.push("Colors/surfaces/strokes use the paren form: text-(--fg-neutral-prominent),");
  lines.push("bg-(--surface-shallow), border-(--stroke-neutral-subtle). Typography stays a");
  lines.push("named utility (text-body, text-body-small). This hook runs on every Write/Edit");
  lines.push("and will block again until the classes are fixed.");
  return lines.join("\n");
}

function isInScope(filePath) {
  if (typeof filePath !== "string") return false;
  return filePath.endsWith(".tsx") || filePath.endsWith(".ts");
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
  if (!isInScope(toolInput?.file_path)) process.exit(0);
  const content = extractContent(toolName, toolInput);
  if (!content) process.exit(0);

  const tokenNames = loadTokenNames();
  const classes = parseClassNames(content);
  const violations = detectTokenClassViolations(classes, tokenNames);
  if (violations.length === 0) process.exit(0);

  process.stderr.write(formatTokenClassError(violations));
  process.exit(2);
}

// Run main() only when invoked directly (not when imported by tests). Compare
// resolved file URLs — a space in the packaged path (".../Arcade Studio.app/…")
// is percent-encoded in import.meta.url, so a raw template literal never
// matches. pathToFileURL encodes argv[1] the same way. (Same guard as
// validateArcadeImports.mjs.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/hooks/validateTokenClasses.mjs studio/__tests__/server/hooks/validateTokenClasses.test.ts
git commit -m "feat(studio/hooks): token-class hook loader + main (blocks on violation)

Loads the real token set from @xorkavi/arcade-gen/dist/styles.css (resolvable
on the DMG; fail-open if not), reads the PostToolUse Write/Edit payload, exits
2 with a paren-form did-you-mean on violations. Direct-invoke guard uses
pathToFileURL (space-in-path safe).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 3: Register the hook in claudeCode.ts

**Files:**
- Modify: `studio/server/claudeCode.ts` (const near line 79; PostToolUse block near line 270)

**Interfaces:**
- Consumes: the `validateTokenClasses.mjs` file path + the existing `hookCommand()` helper + `MODULE_DIR`.

- [ ] **Step 1: Add the hook path constant**

In `studio/server/claudeCode.ts`, directly after the `VALIDATE_ARCADE_IMPORTS_HOOK` const (~line 79), add:

```ts
// PostToolUse hook that blocks Write/Edit introducing design-token utility
// classes in the un-compilable named form (text-fg-neutral-medium) instead of
// the paren form (text-(--fg-neutral-medium)). Tailwind v4 silently drops the
// named form → unstyled frame. Emits a paren-form did-you-mean so the model
// self-corrects in the same turn.
const VALIDATE_TOKEN_CLASSES_HOOK = path.resolve(MODULE_DIR, "hooks", "validateTokenClasses.mjs");
```

- [ ] **Step 2: Register it in the PostToolUse matcher**

In the `settings` object's `PostToolUse` array (~line 270-275), add a second entry after the import-validator one so both run on Write|Edit:

```ts
      PostToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: hookCommand(VALIDATE_ARCADE_IMPORTS_HOOK) }],
        },
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: hookCommand(VALIDATE_TOKEN_CLASSES_HOOK) }],
        },
      ],
```

- [ ] **Step 3: Verify the registration via the existing claudeCode test (or add one)**

Check whether a test asserts the PostToolUse hook set:

Run: `pnpm run studio:test __tests__/server/claudeCode.test.ts 2>&1 | tail -5`

- If that test asserts the hook list, extend it to expect `validateTokenClasses.mjs` in the PostToolUse commands.
- If no such assertion exists, add a minimal one to `__tests__/server/claudeCode.test.ts` (create if absent) that builds the settings and asserts both hook filenames appear:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildClaudeArgs } from "../../server/claudeCode"; // or whatever exports the settings/args

// If claudeCode.ts does not export a testable settings builder, assert instead
// on the source text of the file (read it, expect both hook filenames present)
// — a static guard that the token-class hook is wired next to the import one.
```

NOTE for implementer: if `claudeCode.ts` has no exported settings builder, do the **static source assertion** variant — read `server/claudeCode.ts` and assert it contains both `validateArcadeImports.mjs` and `validateTokenClasses.mjs` in a PostToolUse context. Do not refactor claudeCode.ts to make it testable in this task (out of scope).

- [ ] **Step 4: Run + commit**

Run: `pnpm run studio:test __tests__/server/claudeCode.test.ts` (or the file you touched)
Expected: PASS.

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/claudeCode.ts studio/__tests__/server/claudeCode.test.ts
git commit -m "feat(studio/hooks): register token-class hook in the PostToolUse chain

Runs validateTokenClasses.mjs on every Write|Edit alongside the import
validator, via the execPath hookCommand shim (DMG-safe).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 4: Teach the paren-class syntax in CLAUDE.md.tpl (first-line defense)

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl` (styling-rules section, near the token list ~line 667-679)
- Test: `studio/__tests__/templates/claude-md-token-class-syntax.test.ts` (new)

**Interfaces:** none (template + content-pin test).

- [ ] **Step 1: Write the failing content test**

Create `studio/__tests__/templates/claude-md-token-class-syntax.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tpl = fs.readFileSync(
  path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"),
  "utf8",
);

describe("CLAUDE.md.tpl token-class syntax", () => {
  it("shows the paren class form and marks the named form as wrong", () => {
    // Colors use text-(--fg-*), NOT text-fg-*. Pin both so a rewrite can't
    // silently drop the syntax (the unstyled-frame bug).
    expect(tpl).toMatch(/text-\(--fg-neutral-prominent\)/);
    expect(tpl).toMatch(/bg-\(--surface-shallow\)/);
    // Warns the named form compiles to nothing.
    expect(tpl).toMatch(/text-fg-neutral/); // the ✗ example
    expect(tpl).toMatch(/compile to nothing|renders? no|does not render/i);
  });
  it("clarifies typography stays a named utility", () => {
    expect(tpl).toMatch(/text-body-small/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/templates/claude-md-token-class-syntax.test.ts`
Expected: FAIL — the paren-form guidance isn't in the template yet.

- [ ] **Step 3: Add the guidance**

In `studio/templates/CLAUDE.md.tpl`, in the "Styling rules" section, immediately BEFORE the
`- **Never hardcode hex…**` bullet (~line 667), insert:

```markdown
- **Colors / surfaces / strokes use the CSS-VARIABLE class form, NOT a named utility.** This is
  the #1 silent-failure: the named form compiles to NOTHING in Tailwind v4 (renders no color).
  A write-time hook blocks the wrong form, but write it right the first time:
  - ✓ `text-(--fg-neutral-prominent)`  `bg-(--surface-shallow)`  `border-(--stroke-neutral-subtle)`  `bg-(--bg-intelligence-prominent)`
  - ✗ `text-fg-neutral-prominent`  `bg-surface-shallow`  `border-stroke-neutral-subtle`  `bg-intelligence-prominent`  ← compile to nothing
  - Typography STAYS a named utility (these DO exist): `text-body`, `text-body-small`, `text-title-2`, `text-caption`.
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/templates/claude-md-token-class-syntax.test.ts`
Expected: PASS. If a `toMatch` misses, adjust the template WORDING to contain the pinned marker (do not weaken the test's intent).

- [ ] **Step 5: Verify template still renders per-project**

Run: `pnpm run studio:test __tests__/server/projects-claude-md-refresh.test.ts __tests__/server/claude-md-two-tier.test.ts`
Expected: PASS (enlarged template still renders).

- [ ] **Step 6: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/templates/CLAUDE.md.tpl studio/__tests__/templates/claude-md-token-class-syntax.test.ts
git commit -m "docs(studio): CLAUDE.md — teach the paren token-class syntax (first-line defense)

Shows text-(--fg-*) as correct + marks text-fg-* as compile-to-nothing, so the
prompt is right before the hook has to block. Content test pins both forms.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 5: Full-suite regression + manual acceptance

**Files:** none (verification only).

- [ ] **Step 1: Full studio suite**

Run: `pnpm run studio:test`
Expected: all green (baseline ~1874 pass; +new hook tests). Investigate any new failure before proceeding. Note: two intentional broken-frame FIXTURE `[ERROR]` lines in output are not failures.

- [ ] **Step 2: Typecheck adds no new errors**

Run: `npx tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -E "claudeCode|validateTokenClasses"`
Expected: no NEW errors attributable to the edits (the `.mjs` hook is untyped by design; `claudeCode.ts` edit is a const + array entry — no type surface).

- [ ] **Step 3: MANUAL acceptance (required — hook only fires live)**

Restart the app (`pnpm run studio` — hook/claudeCode changes need a restart). Regenerate the
navigation design (the precisely-3 prompt) OR any Figma design. Confirm in the turn transcript:
- If the agent writes `text-fg-*` / `bg-surface-*`, the hook BLOCKS the Write (exit 2), the
  stderr did-you-mean appears, and the agent re-Writes with the paren form in the same turn.
- The resulting frame renders WITH colors (not the flat unstyled result).
If the agent writes the paren form directly (template fix worked), the hook stays silent — also success.

- [ ] **Step 4: Record the result** in the SDD ledger / a short note. If the frame still renders
  unstyled for a DIFFERENT reason, systematic-debug that separately — do not widen this hook to
  chase it.

---

## Self-Review

**Spec coverage:**
- Detection rule (Option 1: named-token form whose tail is a real token; skip paren/brackets/utilities) → Task 1 `detectTokenClassViolations`. ✓
- Token source from arcade-gen styles.css, fail-open → Task 2 `loadTokenNames`. ✓
- PostToolUse Write|Edit block, exit 2, did-you-mean → Task 2 `main` + `formatTokenClassError`. ✓
- DMG-safe launch (execPath/hookCommand), direct-invoke guard (pathToFileURL) → Task 2 guard + Task 3 wiring. ✓
- Template first-line defense → Task 4. ✓
- Does NOT block arbitrary brackets / real utilities / custom classes → Task 1 tests pin the negatives. ✓

**Placeholder scan:** No TBD/TODO. Every code step has full code. The one conditional is Task 3
Step 3 (test claudeCode wiring) — explicitly gives the fallback (static source assertion) with
the exact assertion, not a vague "add a test."

**Type consistency:** `extractTokenNames`/`parseClassNames`/`detectTokenClassViolations` (Task 1)
consumed verbatim by `loadTokenNames`/`main` (Task 2). `VALIDATE_TOKEN_CLASSES_HOOK` (Task 3)
uses the file created in Task 1/2. Names match across tasks.

**Known risk to watch:** the `parseClassNames` regex reads static string literals only — a frame
using a fully-dynamic `className={cx(...)}` with token strings in a variable won't be scanned.
Acceptable: generated frames overwhelmingly use inline string classNames (verified across the
session's frames); the hook is a high-precision guard, not exhaustive. Documented in Task 1's
"ignores dynamic className" test so it's a known, tested boundary — not a silent gap.
