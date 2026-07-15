# Edit Reliability — Dead-Token Resolvability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent can no longer report an edit as "done" when it wrote a design-token reference (`bg-(--x)` / `var(--x)`) that resolves to nothing — the write-time hook flags the dead reference and the agent self-corrects to a real token before the turn completes.

**Architecture:** Extend the ALREADY-SHIPPED PostToolUse hook `studio/server/hooks/validateTokenClasses.mjs` (which today catches the *named-form* token no-op, e.g. `text-fg-neutral-medium`). Add a complementary detector for the *paren/var form* the existing check deliberately skips: extract every `--custom-property` a generated frame references, and flag any that isn't defined in the design system's rendered stylesheet, the project's theme-overrides, or locally in the same file. Reuse the hook's existing token loader and its `exit(2)` → agent-self-correct lane. No new hook, no new surface, no render.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Tailwind v4, DevRev design-system tokens shipped in `@xorkavi/arcade-gen/dist/styles.css`.

## Global Constraints

- Package manager **pnpm**. Focused test: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`. Full suite: `pnpm run studio:test` (~90s; flakes under load — a failure that passes in isolation is contention, re-run the single file; clear ports 9223-9232 if wsServer/bridge tests fail).
- **`command git` for ALL git** (a bare `git` is intercepted by a failing rtk hook). Same for any intercepted `grep`/`node`.
- **No false alarms is a HARD requirement.** A valid frame must never be flagged. This drives three guards below; do not weaken them.
- **The token definition source of truth is `@xorkavi/arcade-gen/dist/styles.css`** (the minified stylesheet every frame imports at render — `frameMountPlugin.ts:259`). It is loaded by the hook's EXISTING `loadTokenNames()`. Do NOT use `tokens.css` (that is the server-side Figma-export superset, never rendered).
- **Reuse the hook's existing exports** — `loadTokenNames`, `extractTokenNames`, `parseClassNames`, the `exit(0)`/`exit(2)` `main()` shape, and the fail-open contract. Do NOT add a second token loader.
- **Fail open:** if the DS token set can't be read (empty), the dead-ref check is skipped entirely — never block generation on our own inability to load the DS.
- **Scope the dead-ref check to GENERATED FRAME files only** (`.../projects/<slug>/frames/<id>/*.tsx|ts`). Studio's own `src/**` `.tsx` references CSS vars the DS set doesn't contain and would false-flag. (The existing named-form check keeps its broader `.tsx` scope — do not change it.)

---

## Task 1: Dead-token-ref detector + wire into the token hook

**Files:**
- Modify: `studio/server/hooks/validateTokenClasses.mjs` (add `extractTokenRefs`, `detectDeadTokenRefs`, `suggestRealTokens`, `formatDeadTokenError`, `isFrameFile`, `readProjectThemeOverrides`; call them in `main()` alongside the existing checks)
- Test: `studio/__tests__/server/hooks/validateTokenClasses.test.ts` (**verified to EXIST**; imports the hook's pure `.mjs` exports with a `// @ts-expect-error — .mjs import of a pure-JS module with no types` line before the import — match that convention for any new import. Note: the `runHook`/`spawnSync`/`tmpFrame` integration harness lives in the SIBLING `validateArcadeImports.test.ts` (~`:291`, `:309`), NOT here — Step 6 must port it, see that step.)

**Interfaces:**
- Consumes (already exported in the file): `extractTokenNames(cssText) → Set<string>`, `loadTokenNames() → Set<string>`, `parseClassNames(source) → string[]`, existing `detectTokenClassViolations`, `formatTokenClassError`.
- Produces:
  - `extractTokenRefs(source: string) → Set<string>` — every custom-property NAME (sans `--`) referenced via `(--x)` or `var(--x)`, requiring at least one internal hyphen (so JS `(--i)` decrement is never captured).
  - `detectDeadTokenRefs(source: string, resolvable: Set<string>) → Array<{ ref: string, suggestions: string[] }>` — refs not in `resolvable`. Returns `[]` if `resolvable` is empty (fail open).
  - `suggestRealTokens(deadName: string, tokenNames: Set<string>, limit = 3) → string[]` — real tokens sharing the longest leading name-segment prefix.
  - `formatDeadTokenError(violations) → string` — stderr message block.
  - `isFrameFile(filePath) → boolean`; `readProjectThemeOverrides(frameFilePath) → string`.

**Context:** At `validateTokenClasses.mjs:73` the existing detector does `if (cls.includes("(--") || cls.includes("[")) continue;` — it SKIPS the paren form, assuming it valid. The repro token `bg-(--bg-orange-subtle)` slips through there. This task checks the `--x` inside that form. The paren regex `/\(\s*--(...)\s*\)/` also matches the `(--x)` substring inside `var(--x)` and `[var(--x)]`, so one pattern covers all three reference forms.

- [ ] **Step 1: Confirm the test harness, then write the failing unit tests**

Read `studio/__tests__/server/hooks/validateTokenClasses.test.ts` first — it EXISTS and already imports the hook's pure exports. It uses a `// @ts-expect-error` line before the `.mjs` import (the module has no type declarations); your new exports go in that SAME import block, keeping the annotation.

Add these unit tests (pure-function level — fast, deterministic; no process spawn needed because the hook exports the functions). Add `extractTokenRefs, detectDeadTokenRefs, suggestRealTokens` to the file's EXISTING `@ts-expect-error`-annotated import from `../../../server/hooks/validateTokenClasses.mjs` (do not add a second, un-annotated import — it will fail typecheck):

```typescript
// (these names join the existing @ts-expect-error import block at the top of the file)
// import { …existing…, extractTokenRefs, detectDeadTokenRefs, suggestRealTokens } from "../../../server/hooks/validateTokenClasses.mjs";

const DS = new Set([
  "bg-expressive-blue-subtle",
  "bg-expressive-yellow-subtle",
  "bg-neutral-subtle",
  "core-marmalade-orange-200",
  "fg-neutral-medium",
]);

describe("extractTokenRefs", () => {
  it("captures the Tailwind paren-var form", () => {
    expect([...extractTokenRefs(`<div className="bg-(--bg-orange-subtle)" />`)]).toEqual(["bg-orange-subtle"]);
  });
  it("captures the var() form in inline styles", () => {
    expect([...extractTokenRefs(`<div style={{ background: "var(--surface-overlay)" }} />`)]).toEqual(["surface-overlay"]);
  });
  it("does NOT capture a JS decrement (--i) — no internal hyphen", () => {
    expect([...extractTokenRefs(`for (let i=n; i>0; ) { arr[(--i)] }`)]).toEqual([]);
  });
});

describe("detectDeadTokenRefs", () => {
  it("flags a DS-namespace ref absent from the resolvable set", () => {
    const v = detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, DS);
    expect(v.map((x) => x.ref)).toEqual(["bg-orange-subtle"]);
  });
  it("does NOT flag a real token", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-expressive-yellow-subtle)"`, DS)).toEqual([]);
  });
  it("does NOT flag a var defined locally in the same file (author var)", () => {
    const resolvable = new Set([...DS, "my-thing"]); // caller unions local defs in
    expect(detectDeadTokenRefs(`style={{ ["--my-thing"]: "#fff", color: "var(--my-thing)" }}`, resolvable)).toEqual([]);
  });
  it("fails open on an empty resolvable set", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, new Set())).toEqual([]);
  });
});

describe("suggestRealTokens", () => {
  it("returns real tokens sharing the leading prefix, capped", () => {
    const s = suggestRealTokens("bg-orange-subtle", DS, 3);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.every((t) => DS.has(t))).toBe(true);
    expect(s.every((t) => t.startsWith("bg-"))).toBe(true); // shares first segment "bg"
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: FAIL — `extractTokenRefs`/`detectDeadTokenRefs`/`suggestRealTokens` are not exported.

- [ ] **Step 3: Implement the detector functions**

Add to `validateTokenClasses.mjs` (after the existing `detectTokenClassViolations`, before `loadTokenNames`):

```javascript
/**
 * Custom-property REFERENCES in the source. Matches the Tailwind v4 arbitrary-
 * var shorthand `bg-(--x)`, the CSS `var(--x)` form, and `[var(--x)]` (all three
 * contain the `(--x)` substring). References live INSIDE className="…" / style={{…}}
 * literals, so scan the raw source — do NOT strip strings. Requires at least one
 * internal hyphen so a JS decrement like `(--i)` or `(--count)` is never mistaken
 * for a design token (every DS token name is multi-segment, e.g. bg-orange-subtle).
 */
export function extractTokenRefs(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;
  const re = /\(\s*--([a-z0-9]+(?:-[a-z0-9]+)+)\s*\)/gi;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/**
 * Real tokens whose name shares the longest LEADING segment prefix with the dead
 * name (e.g. bg-orange-subtle → other bg-* tokens). A hint for the agent, capped;
 * NOT a semantic color matcher (YAGNI — the agent still has the user's original
 * intent + DS knowledge to pick the right one). Must share at least the first
 * segment to be offered.
 */
export function suggestRealTokens(deadName, tokenNames, limit = 3) {
  const segs = String(deadName).split("-");
  const scored = [];
  for (const name of tokenNames) {
    const other = name.split("-");
    let shared = 0;
    while (shared < segs.length && shared < other.length && segs[shared] === other[shared]) shared++;
    if (shared === 0) continue; // must share the first segment
    scored.push({ name, shared });
  }
  scored.sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

/**
 * References to a `--custom-property` that resolve to NOTHING — the token is not
 * in the resolvable set (DS styles.css ∪ project theme-overrides ∪ same-file local
 * defs, unioned by the caller). Such a reference compiles fine but paints nothing
 * (the "silent no-op" bug). Fails open on an empty resolvable set — never flag
 * when we couldn't load the DS.
 */
export function detectDeadTokenRefs(source, resolvable) {
  if (!resolvable || resolvable.size === 0) return [];
  const out = [];
  for (const ref of extractTokenRefs(source)) {
    if (resolvable.has(ref)) continue;
    out.push({ ref, suggestions: suggestRealTokens(ref, resolvable) });
  }
  return out;
}

export function formatDeadTokenError(violations) {
  if (!violations.length) return "";
  const lines = [];
  lines.push("Blocked: these CSS-variable references resolve to NO design-system token");
  lines.push("(the class compiles but paints nothing — a silent no-op). Use a real token:");
  lines.push("");
  for (const v of violations) {
    const hint = v.suggestions.length
      ? ` — real tokens in this family: ${v.suggestions.map((s) => `--${s}`).join(", ")}`
      : " — (no same-family token; pick a real design-system token that matches the intent)";
    lines.push(`  - \`--${v.ref}\` is undefined${hint}`);
  }
  lines.push("");
  lines.push("Reference only tokens that exist in the design system. This hook runs on");
  lines.push("every Write/Edit and will block again until the references resolve.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify the detector tests pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS (all Step-1 cases).

- [ ] **Step 5: Add the frame-file gate + theme-overrides reader, and wire into `main()`**

Add these helpers near the existing `isInScope`/`extractContent`:

```javascript
/**
 * The dead-token-ref check runs ONLY on generated frame files
 * (…/projects/<slug>/frames/<id>/*.tsx|ts). Studio's own src/** .tsx references
 * CSS vars outside the DS set and would false-flag, so it is intentionally NOT
 * in scope for this check (the named-form check keeps its broader .tsx scope).
 */
function isFrameFile(filePath) {
  if (typeof filePath !== "string") return false;
  const sep = path.sep;
  return (
    filePath.includes(`${sep}projects${sep}`) &&
    filePath.includes(`${sep}frames${sep}`) &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".ts"))
  );
}

/**
 * A project's theme-overrides.css is imported into the frame at render, so any
 * token it defines genuinely resolves — union it into the resolvable set so we
 * don't false-flag a project-local token. Best-effort; "" on any miss.
 */
function readProjectThemeOverrides(frameFilePath) {
  try {
    const marker = `${path.sep}frames${path.sep}`;
    const idx = frameFilePath.indexOf(marker);
    if (idx === -1) return "";
    const projectDir = frameFilePath.slice(0, idx);
    return readFileSync(path.join(projectDir, "theme-overrides.css"), "utf-8");
  } catch {
    return "";
  }
}
```

Then extend `main()` — keep the existing class-violation logic, ADD the dead-ref logic, union into ONE exit(2):

```javascript
  const tokenNames = loadTokenNames();
  const classes = parseClassNames(content);
  const classViolations = detectTokenClassViolations(classes, tokenNames);

  // Dead-token-ref check: generated frame files only, and only when the DS set
  // actually loaded (tokenNames non-empty) — otherwise fail open (skip).
  let deadRefs = [];
  if (tokenNames.size > 0 && isFrameFile(toolInput?.file_path)) {
    const resolvable = new Set(tokenNames);
    for (const t of extractTokenNames(readProjectThemeOverrides(toolInput.file_path))) resolvable.add(t);
    for (const t of extractTokenNames(content)) resolvable.add(t); // same-file local --defs
    deadRefs = detectDeadTokenRefs(content, resolvable);
  }

  if (classViolations.length === 0 && deadRefs.length === 0) process.exit(0);

  const message = [
    classViolations.length ? formatTokenClassError(classViolations) : "",
    deadRefs.length ? formatDeadTokenError(deadRefs) : "",
  ].filter(Boolean).join("\n\n");
  process.stderr.write(message);
  process.exit(2);
```

Replace the existing tail of `main()` (the `const tokenNames = loadTokenNames(); … process.exit(2);` block) with the above. Do NOT change `loadTokenNames`, `extractTokenNames`, `parseClassNames`, `detectTokenClassViolations`, or `formatTokenClassError`.

**Note on local-def union:** `extractTokenNames(content)` pulls `--name:` DEFINITIONS from the frame source (e.g. `["--my-thing"]: "#fff"` in an inline style object, or a `<style>` block). Because a reference like `var(--my-thing)` is only dead if it's absent from `resolvable`, and the local def is unioned in, an author's own in-file var is never flagged. This is the same `extractTokenNames` already used for the DS file.

- [ ] **Step 6: Add the end-to-end exit-code test**

The `runHook`/`tmpFrame` harness is NOT in this test file — it lives in the sibling `validateArcadeImports.test.ts` (`runHook` ~`:296` via `spawnSync("node", [HOOK], …)`; `tmpFrame` ~`:309`). Port BOTH into `validateTokenClasses.test.ts`, pointing `HOOK` at `server/hooks/validateTokenClasses.mjs` (not the imports hook). **Critical:** the sibling's `tmpFrame` writes under `os.tmpdir()/validate-hook-*` — a path with NO `/projects/<slug>/frames/<id>/` segment, so `isFrameFile` would REJECT it and the check would wrongly pass (exit 0). Your ported `tmpFrame` MUST create the file under a frame-shaped path so `isFrameFile` returns true:

```typescript
it("exit 2 on a dead token ref in a frame file; exit 0 on a real one", () => {
  const bad = tmpFrame(`export default () => <div className="bg-(--bg-orange-subtle)" />;`);
  expect(runHook({ tool_name: "Edit", tool_input: { file_path: bad, old_string: "x", new_string: "y" } }).status).toBe(2);
  const good = tmpFrame(`export default () => <div className="bg-(--bg-neutral-subtle)" />;`);
  expect(runHook({ tool_name: "Edit", tool_input: { file_path: good, old_string: "x", new_string: "y" } }).status).toBe(0);
});
```

```typescript
function tmpFrame(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-token-"));
  const frameDir = path.join(dir, "projects", "p", "frames", "01");
  fs.mkdirSync(frameDir, { recursive: true });          // path MUST contain /projects/…/frames/…/
  const file = path.join(frameDir, "index.tsx");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}
```

Use `proc.status`/`proc.stderr` (NOT `exitCode`). The hook reads the file from disk on Edit, so the temp file holds the whole content. `runHook` points `HOOK` at `validateTokenClasses.mjs`.

- [ ] **Step 7: Run to verify pass + confirm no regression to the named-form tests**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS — new dead-ref cases AND all pre-existing named-form (`detectTokenClassViolations`) tests still green (the union must not have regressed them).

- [ ] **Step 8: Commit**

```bash
command git add studio/server/hooks/validateTokenClasses.mjs studio/__tests__/server/hooks/validateTokenClasses.test.ts
command git commit -m "feat(studio/hooks): flag dead design-token references so silent no-op edits self-correct"
```

---

## Task 2: One-frame data fix + manual acceptance

**Files:**
- Modify (data, not code): `~/Library/Application Support/arcade-studio/projects/implement-this-precisely/frames/01-figma-4368-19734/index.tsx:9`

**Context:** The live repro frame is still broken. Figma ground truth (`get_variable_defs`, node 4368-19734): background = `BG/Expressive/Orange/Subtle = #fcecd2`, which equals the DS token `--core-marmalade-orange-200` (verified present in `styles.css`). This is a user-data fix (a project file under `Application Support`), NOT part of the shipped hook change and NOT committed to the repo.

- [ ] **Step 1: Fix the one broken frame**

In `~/Library/Application Support/arcade-studio/projects/implement-this-precisely/frames/01-figma-4368-19734/index.tsx`, line 9, change:
`className="bg-(--bg-orange-subtle)"` → `className="bg-(--core-marmalade-orange-200)"`

(Do NOT `git add` this — it lives outside the repo, under the user's Application Support.)

- [ ] **Step 2: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS. Re-run any failing file in isolation to confirm it's contention, not a regression (the suite flakes under load).

- [ ] **Step 3: Manual acceptance (the live gate — jsdom can't exercise the real self-correct loop)**

`pnpm run studio` (fully quit + restart first — hook `.mjs` changes load per spawned process, but restart avoids any stale server). Then:
- Open project `implement-this-precisely`, frame `01-figma-4368-19734`. Confirm the background now shows the orange (`#fcecd2`) from the Step-1 fix.
- Ask the agent, via chat, to set the background to some other real thing (e.g. "make the background the subtle blue expressive surface") → confirm it lands visibly (a REAL token → no hook block, change applies).
- Ask for a bogus token (e.g. "set the background to bg/expressive/orange/subtle" — the original failing request) → confirm the agent does NOT report a silent success on a dead token: the hook feeds back the violation and the agent self-corrects to a real token (or explains), and the visible result changes. The exact substitute is the agent's call; the requirement is **no more "I did it" while nothing changed.**
- Confirm no false alarm on normal edits: make a few ordinary edits that use real tokens/utilities and confirm they are NOT blocked.

- [ ] **Step 4: No version bump here** (releases are a separate explicit step, per project convention).

---

## Self-review notes (author)

- **Spec coverage:** the spec's single mechanism (paren/var dead-ref check in `validateTokenClasses.mjs`, reusing `loadTokenNames`/exit-2) = Task 1. One-frame data fix + manual gate = Task 2. All spec sections mapped.
- **Refinements beyond the spec (deliberate, for the hard no-false-alarms rule) — call out for review:** (1) scope the dead-ref check to `projects/*/frames/*` files only (studio src would false-flag); (2) union the project `theme-overrides.css` + same-file local `--defs` into the resolvable set (both genuinely render); (3) hyphen-guard in `extractTokenRefs` so JS `(--i)` decrement is never captured. The spec's rev-2 said "resolvable via loadTokenNames + local defs" — (1) and (2) make that concretely false-alarm-proof.
- **Honest limitation carried from the spec:** `suggestRealTokens` is a leading-prefix hint, NOT a semantic color matcher — for `bg-orange-subtle` it surfaces other `bg-*` tokens, not the semantically-ideal `core-marmalade-orange-200` (which shares no leading segment). That's acceptable: the message's job is to say "this is dead, pick a real one"; the agent re-derives the right token from the user's intent. Do not build a color matcher (YAGNI / fidelity-keystone territory).
- **Type consistency:** `detectDeadTokenRefs` returns `{ref, suggestions}[]`; `formatDeadTokenError` consumes exactly that; `main()` unions `classViolations` + `deadRefs` into one `exit(2)`. `extractTokenRefs`/`extractTokenNames` both return `Set<string>` of names sans `--`.
- **Fail-open paths:** empty DS set (styles.css unreadable) → dead-ref check skipped in `main()` (guard `tokenNames.size > 0`) AND in `detectDeadTokenRefs` (guard `resolvable.size === 0`). Unreadable theme-overrides → `""` → contributes nothing. Non-frame file → check skipped.
