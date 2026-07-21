# Edit Reliability — Agent Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent stops claiming a change it didn't make. It KNOWS the kit's real component capabilities (so it doesn't invent props like `Select multiple`), must REPORT honestly when it improvised or couldn't do the ask (Deviations, not "None"), and is HARD-BLOCKED at write time when it writes a known-invented prop/shape.

**Architecture:** Three changes at verified layers, all extending shipped systems. **(A)** a `PRIMITIVE_CAPABILITIES` table rendered into the kit manifest (`kitManifest.ts`) — the agent's "know the limits" reference. **(B)** reword `templates/CLAUDE.md.tpl` §Response-shape so `Deviations: None` is a verified claim, not the appended default. **(C)** a 4th PostToolUse hook `validateComponentProps.mjs` that AST-detects a bounded denylist of invented props/shapes and `exit(2)`-self-corrects. A + B are soft (prompt-level); C is the hard guarantee.

**Tech Stack:** Node ESM (`.mjs`) + `typescript` (a direct dep) for the hook AST walk; Vitest; the shipped manifest renderer + CLAUDE.md template pipeline.

## Global Constraints

- Package manager **pnpm**. Focused tests: `pnpm run studio:test <path>` from repo root `/Users/andrey.sundiev/arcade-prototyper`. Full suite `pnpm run studio:test` (~90s; flakes under load — `chat-figma-context.test.ts` is a KNOWN contention flake, passes in isolation, unrelated; clear ports 9223-9232 if bridge tests flake; `[ERROR]` lines are intentional esbuild fixtures).
- **`command git` for ALL git** (bare git blocked by a failing rtk hook). Prefix any intercepted `grep`/`node` with `command`.
- **No false alarms is a HARD requirement** for the hook (Part C). The repo's own hook principle: "misses OK, false alarms NOT" (`validateTokenClasses.mjs`).
- **Type facts are LOCKED (verified vs real Radix types) — do NOT lump components:**
  - `Select` (`react-select`): NO `multiple` prop; `value`/`defaultValue` are **strings**. Kit has no multi-select Select.
  - `Tabs` (`react-tabs`): `value`/`defaultValue` **strings**; no multi-value.
  - `ToggleGroup` (`react-toggle-group`): **discriminated union on `type`** — `type="single"` → string; `type="multiple"` → **string[]**. NO boolean `multiple` prop (multi-select is `type="multiple"`).
  - `Accordion`: SAME `type` single/multiple union as ToggleGroup. NOT in the v1 denylist, but if ever added it MUST use the type-gated rule, never the Select/Tabs unconditional one.
- **Part C detection MUST key on the capitalized member-tag** (`Select.Root`/`Tabs.Root`/`ToggleGroup.Root`), NOT a bare attribute scan — so native lowercase `<select multiple>` / `<input multiple>` (valid HTML) are NEVER flagged.
- **ToggleGroup array rule is type-gated:** flag an array `value`/`defaultValue` ONLY when the sibling `type` is a LITERAL `"single"` or ABSENT. Dynamic `type={x}` → **SKIP** (may resolve to "multiple"). `type="multiple"` → valid.
- **Part B must NOT make the agent refuse/stall** (the tpl §`:14` says "never refuse, never stall"; the generator is headless — `AskUserQuestion` disallowed). Reword lands as "build the closest thing + flag it as a Deviation," never "ask the user / decline."
- **Do NOT touch `deviationsContract.ts` for prop-detection** — it sees narration text + file hashes only, structurally can't see the written prop. Part C (the hook) is the enforcement.
- The manifest reaches every turn via `--append-system-prompt` (`claudeCode.ts`); the tpl renders into the project cwd `CLAUDE.md` (obeyed harder). Both confirmed.

---

## Task 1: Part A — PRIMITIVE_CAPABILITIES block in the kit manifest

**Files:**
- Modify: `studio/server/kitManifest.ts` (add the table + render it in `renderManifestMarkdown` at `:302`)
- Test: `studio/__tests__/server/kitManifest.test.ts` (confirm it exists; if not, create — mirror an existing server test)
- Regenerated artifact: `studio/prototype-kit/KIT-MANIFEST.md` (committed after a regen so the checked-in file matches the new render — see Step 5)

**Interfaces:**
- Produces: `export const PRIMITIVE_CAPABILITIES` (a small typed table: component → { props summary, absences, value shapes }) + `renderManifestMarkdown` output now contains a `## Primitive capabilities` section built from it. Consumed by the agent via the manifest append-system-prompt (no code consumer — it's reference text).

- [ ] **Step 1: Write the failing test**

Add to `studio/__tests__/server/kitManifest.test.ts` (create if absent, mirroring a server unit test's imports):

```typescript
import { describe, it, expect } from "vitest";
import { renderManifestMarkdown, PRIMITIVE_CAPABILITIES } from "../../server/kitManifest";

describe("PRIMITIVE_CAPABILITIES manifest section", () => {
  it("renders a Primitive capabilities section", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toContain("## Primitive capabilities");
  });
  it("states Select is single-value with no multiple prop (the repro)", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toMatch(/Select[\s\S]*no `?multiple`?/i);
    expect(md).toMatch(/Select[\s\S]*string/i);
  });
  it("states ToggleGroup DOES support multi-select via type='multiple' (NOT 'no multi-select')", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toMatch(/ToggleGroup[\s\S]*type="?multiple"?/i);
    expect(md).not.toMatch(/ToggleGroup has no multi-select/i);
  });
  it("PRIMITIVE_CAPABILITIES covers the misused primitives", () => {
    for (const c of ["Select", "ToggleGroup", "Tabs"]) expect(PRIMITIVE_CAPABILITIES[c]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/kitManifest.test.ts`
Expected: FAIL — `PRIMITIVE_CAPABILITIES` / the section don't exist.

- [ ] **Step 3: Add the table + render it**

In `kitManifest.ts`, add near the top (exported):

```typescript
/**
 * Real capability/prop facts for the props-bearing arcade-gen primitives the
 * agent commonly reaches for. Type-accurate against the installed Radix types
 * (see the `.d.ts` line cited per fact) — do NOT lump: Select/Tabs are
 * string-only; ToggleGroup/Accordion are `type` single|multiple unions.
 * Rendered into the manifest as reference so the agent knows a capability
 * exists (or doesn't) BEFORE inventing a prop.
 */
export const PRIMITIVE_CAPABILITIES: Record<string, string> = {
  Select:
    "single-value. `value`/`defaultValue` are STRINGS. NO `multiple` prop — the kit has no multi-select Select. (react-select index.d.ts: defaultValue?: string)",
  Tabs:
    "`value`/`defaultValue` are STRINGS. No multi-value. (react-tabs index.d.ts: defaultValue?: string)",
  ToggleGroup:
    "supports BOTH `type=\"single\"` (`value`/`defaultValue`: string) and `type=\"multiple\"` (`value`/`defaultValue`: string[]). Multi-select IS supported — via `type=\"multiple\"`, NOT a `multiple` prop. (react-toggle-group index.d.ts: union on `type`)",
  Switch: "boolean. `checked`/`defaultChecked`. No value array.",
  Input: "text control. `value`/`defaultValue` strings; `onChange`. No `multiple`.",
  Button: "`variant`/`size`/`disabled`/`onClick`. Not a form-value control.",
};

/** Render the capability table as a manifest markdown section. */
export function renderPrimitiveCapabilities(): string {
  const lines = [
    "## Primitive capabilities",
    "",
    "> Real prop/value facts for common arcade-gen primitives — check BEFORE",
    "> using a prop. If a capability isn't here, it may not exist; do not invent.",
    "",
  ];
  for (const [name, desc] of Object.entries(PRIMITIVE_CAPABILITIES)) {
    lines.push(`- **${name}** — ${desc}`);
  }
  return lines.join("\n");
}
```

Then inject it into `renderManifestMarkdown`'s `body` (the section list at `:315`), e.g. prepend it before Templates:

```typescript
  const body = [
    renderPrimitiveCapabilities(),
    "\n## Templates\n",
    ...templates.map(renderEntry),
    "\n## Composites\n",
    ...composites.map(renderEntry),
  ].join("\n\n");
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/kitManifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the committed manifest so the artifact matches the render**

The checked-in `KIT-MANIFEST.md` is generated. Regenerate it so it carries the new section (else the repo file diverges from what the generator now emits). **Do NOT try `node -e require('./studio/server/kitManifest')` — it's a `.ts` file, plain node can't load it (no ts-node) and it will throw.** Use the dev-server path: start `pnpm run studio`, let `kitManifestPlugin.buildStart` regenerate `KIT-MANIFEST.md` (it calls `writeMergedManifest`→`renderManifestMarkdown` — both writers route through the same renderer, so the new section lands), then stop it. Confirm `studio/prototype-kit/KIT-MANIFEST.md` now contains `## Primitive capabilities`.

- [ ] **Step 6: Commit**

```bash
command git add studio/server/kitManifest.ts studio/__tests__/server/kitManifest.test.ts studio/prototype-kit/KIT-MANIFEST.md
command git commit -m "feat(studio/kit): PRIMITIVE_CAPABILITIES in the manifest so the agent knows real component props"
```

---

## Task 2: Part B — reword the Deviations contract so "None." is a verified claim

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl` (§"Response shape", the `None.`-default line ~`:75`)
- Test: `studio/__tests__/server/projects-claude-md-refresh.test.ts` (or wherever the tpl render is tested — confirm; add an assertion the reworded rule is present)

**Interfaces:** none (prompt text). The tpl renders into each project's `CLAUDE.md` via `renderTemplate`/`readTemplate` in `server/projects.ts`.

**Context:** `CLAUDE.md.tpl:75` currently reads *"The `### Deviations` section is non-optional. Even a trivial edit ('change the heading') gets `### Deviations\n\nNone.` appended."* — presenting `None.` as the appended default. Line 73 defines `None.` as "when the whole frame maps cleanly to the kit." Line 101 already says "Uncertainty counts as a deviation." The reword extends that to: capability-you-couldn't-deliver counts too; `None.` is earned, not default.

- [ ] **Step 1: Write the failing test**

Find the tpl-render test (`command grep -rln "CLAUDE.md.tpl\|renderTemplate\|Response shape\|Deviations" studio/__tests__`). Add an assertion that the rendered/loaded tpl contains the verified-claim wording:

```typescript
// in the CLAUDE.md tpl/render test:
import { readFileSync } from "node:fs";
import path from "node:path";
const tpl = readFileSync(path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"), "utf-8");

it("frames None. as a verified claim, not an appended default", () => {
  // the old 'Even a trivial edit gets None. appended' default must be gone
  expect(tpl).not.toMatch(/gets `### Deviations\\n\\nNone\.` appended/);
  // and the NEW verified-claim wording present — a distinctive phrase from the
  // reworded line, so this doesn't pass vacuously on the old text (both looser
  // patterns matched the UNMODIFIED tpl per review). Match the reword verbatim-ish:
  expect(tpl).toMatch(/`?None\.?`?\s+is a VERIFIED claim/i);
  expect(tpl).toMatch(/never (write `?None\.?`?|silently claim success you did ?n['’]?t deliver)/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test <the tpl test path>`
Expected: FAIL.

- [ ] **Step 3: Reword `CLAUDE.md.tpl:75`**

Replace the line:
`The \`### Deviations\` section is non-optional. Even a trivial edit ("change the heading") gets \`### Deviations\n\nNone.\` appended.`

with (keep the surrounding lines 73/74 intact):

```
The `### Deviations` section is non-optional. `None.` is a VERIFIED claim, not a default — write it ONLY when every component, prop, and token you used actually exists in the kit AND you fully did what was asked. If you used a prop or component the kit does not have, or you could NOT do the literal ask (e.g. the kit has no multi-select Select), that is a Deviation: build the closest real thing and say what you did instead — never write `None.` and never silently claim success you didn't deliver. (You never refuse or stall — you approximate and flag.)
```

Do NOT alter line 14 ("request is LAW … never refuse, never stall") or line 101 ("Uncertainty counts as a deviation") — the reword is consistent with both.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test <the tpl test path>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/templates/CLAUDE.md.tpl studio/__tests__/<the tpl test file>
command git commit -m "feat(studio): Deviations 'None.' is a verified claim, not a default — agent must report unfulfilled asks"
```

---

## Task 3: Part C — validateComponentProps.mjs (the hard write-time guarantee)

**Files:**
- Create: `studio/server/hooks/validateComponentProps.mjs`
- Modify: `studio/server/claudeCode.ts` (register a 4th PostToolUse `Write|Edit` hook + the `VALIDATE_COMPONENT_PROPS_HOOK` path const, mirroring the existing two)
- Test: `studio/__tests__/server/hooks/validateComponentProps.test.ts` (new)

**Interfaces:**
- Produces: `export function detectComponentPropViolations(source) → Array<{ component, issue, message }>` — AST-walks for the denylist; `main()` reads the written file + `exit(2)` on violations. Exit codes: 0 = ok, 2 = block (self-correct).

**Context:** Mirror `validateArcadeImports.mjs` exactly — it reads the post-edit file from disk (`readFileSync`), parses with `ts.createSourceFile(..., ScriptKind.TSX)`, walks the AST, and `exit(2)` with a stderr message the agent treats as "fix it." `typescript` is a direct dep (import works in the `.mjs`). Register alongside the other two hooks in the `PostToolUse` array (`claudeCode.ts:276`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { detectComponentPropViolations } from "../../../server/hooks/validateComponentProps.mjs";

const V = (src: string) => detectComponentPropViolations(src).length;

describe("detectComponentPropViolations", () => {
  // POSITIVE (must flag)
  it("flags Select.Root multiple", () => {
    expect(V(`<Select.Root multiple><Select.Item value="a"/></Select.Root>`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on Select.Root", () => {
    expect(V(`<Select.Root defaultValue={["a"]} />`)).toBeGreaterThan(0);
  });
  it("flags ToggleGroup.Root multiple (use type= instead)", () => {
    expect(V(`<ToggleGroup.Root multiple />`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on ToggleGroup.Root type='single'", () => {
    expect(V(`<ToggleGroup.Root type="single" defaultValue={["a","b"]} />`)).toBeGreaterThan(0);
  });

  // EXEMPTIONS (must NOT flag — the false-alarm guards)
  it("does NOT flag a valid string defaultValue Select", () => {
    expect(V(`<Select.Root defaultValue="a" />`)).toBe(0);
  });
  it("does NOT flag native <select multiple> (lowercase HTML)", () => {
    expect(V(`<select multiple><option/></select>`)).toBe(0);
  });
  it("does NOT flag native <input multiple>", () => {
    expect(V(`<input type="file" multiple />`)).toBe(0);
  });
  it("does NOT flag a valid multi-toggle ToggleGroup type='multiple' with array", () => {
    expect(V(`<ToggleGroup.Root type="multiple" defaultValue={["a","b"]} />`)).toBe(0);
  });
  it("does NOT flag ToggleGroup with a DYNAMIC type (may resolve to multiple)", () => {
    expect(V(`<ToggleGroup.Root type={mode} defaultValue={["a","b"]} />`)).toBe(0);
  });
});
```

Also add an end-to-end exit-code test using the sibling harness (`runHook`/`tmpFrame` from `validateArcadeImports.test.ts` — port it, writing under a `/projects/<slug>/frames/<id>/` path so any frame-scope gate matches; use `proc.status`): `<Select.Root multiple>` → status 2; `<Select.Root defaultValue="a">` → status 0.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateComponentProps.test.ts`
Expected: FAIL (function not exported).

- [ ] **Step 3: Implement the hook**

Model the file on `validateArcadeImports.mjs` (top-of-file `import ts from "typescript"`, `readFileSync`, `isInScope`, `main()` reads the post-edit file, `exit(0)`/`exit(2)`). Core detector:

```javascript
import ts from "typescript";

const UNION_TYPE_COMPONENTS = new Set(["ToggleGroup", "Accordion"]); // discriminated on `type`
const STRING_ONLY_COMPONENTS = new Set(["Select", "Tabs"]);          // no multiple, string value/defaultValue
const NO_MULTIPLE_PROP = new Set(["Select", "Tabs", "ToggleGroup", "Accordion"]); // none take a boolean `multiple`

/** The kit-component name for a JSX tag, or null if it's not a capitalized
 *  member-expression tag (e.g. native lowercase `select`/`input` → null, so
 *  native HTML `<select multiple>` is never flagged). Returns "Select" for
 *  `<Select.Root>`, "ToggleGroup" for `<ToggleGroup.Root>`, etc. */
function kitComponentOf(tagNode) {
  // tagNode is the JSX tagName. We want <Name.Member> where Name starts uppercase.
  if (ts.isPropertyAccessExpression(tagNode) && ts.isIdentifier(tagNode.expression)) {
    const name = tagNode.expression.text;
    if (name && name[0] === name[0].toUpperCase()) return name;
  }
  return null;
}

function attr(openingEl, propName) {
  const props = openingEl.attributes?.properties ?? [];
  // Use `.name.text` — NEVER `.getText()`. The tree is built with
  // setParentNodes=false (below), so `.getText()` walks a null parent chain
  // and THROWS (the `?.` does NOT catch a throw), which would crash the whole
  // detector → the hook fails open → does nothing. `.text` reads the identifier
  // directly and is safe on a parentless node (same pattern the sibling
  // validateArcadeImports.mjs uses: it reads `.text`, never `.getText()`).
  return props.find((p) => ts.isJsxAttribute(p) && p.name && p.name.text === propName);
}

function isArrayLiteralInitializer(a) {
  // defaultValue={[ ... ]}  → JsxExpression wrapping ArrayLiteralExpression
  const init = a?.initializer;
  return init && ts.isJsxExpression(init) && init.expression && ts.isArrayLiteralExpression(init.expression);
}

function typeLiteral(openingEl) {
  // returns "single"|"multiple" for a LITERAL string type=, or null for
  // absent OR dynamic (type={x}) — dynamic must NOT be treated as "single".
  const a = attr(openingEl, "type");
  if (!a) return { present: false, value: null, dynamic: false };
  const init = a.initializer;
  if (init && ts.isStringLiteral(init)) return { present: true, value: init.text, dynamic: false };
  // type="single" is a StringLiteral initializer; type={"single"} or type={x} is a JsxExpression
  if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression))
    return { present: true, value: init.expression.text, dynamic: false };
  return { present: true, value: null, dynamic: true }; // type={x} dynamic
}

export function detectComponentPropViolations(source) {
  if (typeof source !== "string" || !source) return [];
  let sf;
  try { sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX); }
  catch { return []; } // fail open
  const out = [];
  const visit = (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement
      : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const comp = kitComponentOf(opening.tagName);
      if (comp) {
        // 1) invented `multiple` prop
        if (NO_MULTIPLE_PROP.has(comp) && attr(opening, "multiple")) {
          out.push({ component: comp, issue: "multiple-prop",
            message: STRING_ONLY_COMPONENTS.has(comp)
              ? `<${comp}.Root> has no \`multiple\` prop and no multi-select — remove it (keep it single, or approximate + note as a Deviation).`
              : `<${comp}.Root> has no \`multiple\` prop — multi-select is \`type="multiple"\`.` });
        }
        // 2) array value/defaultValue where a string is required
        for (const prop of ["value", "defaultValue"]) {
          const a = attr(opening, prop);
          if (!a || !isArrayLiteralInitializer(a)) continue;
          if (STRING_ONLY_COMPONENTS.has(comp)) {
            out.push({ component: comp, issue: `array-${prop}`,
              message: `<${comp}.Root> \`${prop}\` is a string, not an array — pass a single value.` });
          } else if (UNION_TYPE_COMPONENTS.has(comp)) {
            const t = typeLiteral(opening);
            // array is VALID only under type="multiple"; flag only literal "single"/absent; SKIP dynamic.
            if (!t.dynamic && t.value !== "multiple") {
              out.push({ component: comp, issue: `array-${prop}`,
                message: `<${comp}.Root> \`${prop}\` is an array but \`type\` is not "multiple" — set \`type="multiple"\` for multi-value.` });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
```

`main()`: mirror `validateArcadeImports.mjs` — read the post-edit file (Edit) / `content` (Write), `const v = detectComponentPropViolations(content); if (!v.length) process.exit(0); process.stderr.write(formatted); process.exit(2);`. Fail open on read/parse errors. Frame-files-only scope IF the sibling hooks scope that way (match their `isInScope`).

NOTE (verified against TS 5.9.3 by adversarial review — build the AST and confirm before trusting): `<Select.Root>` tagName IS a `PropertyAccessExpression` with `.expression` an `Identifier` (`.text==="Select"`); a `multiple` shorthand is a `JsxAttribute` with `initializer===undefined`; `type="single"` initializer IS a `StringLiteral` (`ts.isStringLiteral(init)` true); `defaultValue={[…]}` is a `JsxExpression` wrapping an `ArrayLiteralExpression`; dynamic `type={x}` inner is an `Identifier`; native `<select>` tagName is a lowercase `Identifier` (not PropertyAccess → `kitComponentOf` returns null → never flagged). The ONLY unsafe API is `.getText()` on this parentless tree — it THROWS (crashing the detector → hook fails open → does nothing), so `attr` uses `.name.text` exclusively. `visit` runs OUTSIDE the try/catch, so a throw there is NOT swallowed — keep the accessor safe.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateComponentProps.test.ts`
Expected: PASS — all positives flag, all exemptions (native select/input, ToggleGroup type=multiple, dynamic type) → 0.

- [ ] **Step 5: Register the hook**

In `claudeCode.ts`, add near the other two hook path consts:
```typescript
const VALIDATE_COMPONENT_PROPS_HOOK = path.resolve(MODULE_DIR, "hooks", "validateComponentProps.mjs");
```
and a third entry in the `PostToolUse` array (`:276`):
```typescript
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: hookCommand(VALIDATE_COMPONENT_PROPS_HOOK) }],
        },
```

- [ ] **Step 6: Update the hook-count assertion, then run the hooks + claudeCode tests**

`studio/__tests__/server/claudeCode.test.ts` (~`:114`) asserts the flattened Pre+Post hook command count `toBe(3)` (2 PostToolUse + 1 PreToolUse today). Registering the 4th hook makes it 4 → this test WILL go red if not updated. Bump `toBe(3)` → `toBe(4)` and add `expect(commands.some((c) => c.includes("validateComponentProps.mjs"))).toBe(true)`.

Run: `pnpm run studio:test studio/__tests__/server/hooks/ studio/__tests__/server/claudeCode.test.ts`
Expected: PASS. Confirm the new hook is in the registered set.

- [ ] **Step 7: Commit**

```bash
command git add studio/server/hooks/validateComponentProps.mjs studio/server/claudeCode.ts studio/__tests__/server/hooks/validateComponentProps.test.ts
command git commit -m "feat(studio/hooks): validateComponentProps blocks invented props (Select multiple, array defaultValue) at write time"
```

---

## Task 4: Full suite

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test` (clear ports 9223-9232 first). Expected: PASS. Re-run any failing file in isolation — the `chat-figma-context.test.ts` contention flake is known/unrelated; anything else is a real regression to fix.

---

## Task 5: Manual acceptance (running app — user)

- [ ] **Step 1: Manual gate — the repro + honesty**

`pnpm run studio` (fully quit + restart — server + hook + tpl changed). In `computer-settings` (or any project):
- Ask again: "change the Selects to multi-select." **Expect:** the agent does NOT silently claim success with an invented `multiple` prop — either (a) it knows (from the capability manifest) the kit's Select has no multi-select and says so + approximates, reporting it as a Deviation; or (b) if it still writes `<Select.Root multiple>` / array `defaultValue`, the write-time hook blocks it and it self-corrects. Either way: no "Changed to multi-select. Deviations: None" over an unchanged/broken frame.
- Ask for a legit multi-select **toggle** ("make this a multi-select segmented toggle"). **Expect:** it uses `<ToggleGroup.Root type="multiple">` and it is NOT blocked (the type-gated rule + capability manifest allow it).
- Ordinary edits with real props → NOT blocked (no false alarm).
- Confirm the Deviations section reads honestly (when it couldn't do something, it says so, not "None").

- [ ] **Step 2: Report.** If the agent still fakes success on a class the hook doesn't cover, that's the honest denylist bound (add a row) — capture it. If a legit edit is blocked, that's a false alarm to fix.

- [ ] **Step 3: No version bump here.** All FIVE edit-reliability features ship under ONE release once the gates pass — separate explicit step.

---

## Self-review notes (author)

- **Spec coverage:** Part A = Task 1 (manifest capability block, rendered not hand-edited, artifact regenerated); Part B = Task 2 (tpl reword, None.-as-verified); Part C = Task 3 (the hook, type-accurate denylist + member-tag keying + dynamic-type skip); full suite = Task 4; manual gate = Task 5.
- **Every locked type fact + the two false-alarm classes the reviews found are guarded by tests:** native `<select multiple>`/`<input multiple>` → 0; `ToggleGroup type="multiple"` array → 0; dynamic `type={x}` → 0; string `defaultValue` → 0. Positives: Select `multiple`, array Select `defaultValue`, ToggleGroup `multiple`, ToggleGroup `type="single"` array.
- **Accordion** is in `UNION_TYPE_COMPONENTS` (so if its `multiple`/array is ever hit it uses the type-gated rule, never the string-only one) but is otherwise not in the active positive path unless a frame uses `<Accordion.Root>` — consistent with "named so a future row can't mis-lump it."
- **Deviations contract stays in the hook, not `deviationsContract.ts`** (narration/hash-only) — per the spec correction.
- **Type/name consistency:** `detectComponentPropViolations` returns `{component, issue, message}[]`; `main()` formats + exit-2s; test helper `V()` counts. `PRIMITIVE_CAPABILITIES` keys are component names matching the hook's sets.
- **`ts` API caveat flagged** (Task 3 Step 3 NOTE): the `attr`/`.name.text` JSX-attribute access must be verified against the installed TS version before relying on it — the implementer confirms, since a wrong API silently returns no violations (a miss, safe direction, but defeats the feature).
