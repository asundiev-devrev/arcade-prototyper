# Edit Reliability — Dead-Token Resolvability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent can no longer report an edit as "done" when it wrote a design-token reference (`bg-(--x)` / `var(--x)`) that resolves to nothing — a write-time hook flags the dead reference against the COMPLETE token set and the agent self-corrects to a real token (or its value) before the turn completes.

**Architecture:** Extend the shipped PostToolUse hook `studio/server/hooks/validateTokenClasses.mjs`. Build a resolvable-name UNION = the live kit CSS (`loadTokenNames()`, already in the file) ∪ a checked-in ADS color seed ∪ the project's `theme-overrides.css` ∪ same-file local `--defs`. A referenced `--x` that isn't in the union is flagged via the existing `exit(2)` self-correct lane; if it's in the ADS seed but unresolvable at render (kit doesn't ship it), the message hands the agent its real value. Neither ADS nor the kit CSS is complete alone — the union is the authority.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Tailwind v4, DevRev ADS tokens.

## Global Constraints

- Package manager **pnpm**. Focused test: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`. Full suite: `pnpm run studio:test` (~90s; flakes under load — a failure that passes in isolation is contention; clear ports 9223-9232 if wsServer/bridge tests fail).
- **`command git` for ALL git** (a bare `git` is intercepted by a failing rtk hook). Same for any intercepted `grep`/`node`.
- **No false alarms is a HARD requirement.** A valid frame must never be flagged. This drives the union (kit-CSS half is load-bearing), the frame-files-only scope, and the object-key local-def fix. Do not weaken them.
- **TWO sets, do NOT conflate (the flaw a plan review caught):** RESOLVABLE (renders) = `loadTokenNames()` kit CSS ∪ project theme-overrides ∪ same-file local defs. The **ADS seed is NOT in resolvable** — it's a SEPARATE classification oracle, consulted only for refs that fail the resolvable set (real-DS-token → give its value; else typo). Putting the seed into `resolvable` silently accepts kit-absent tokens like `--bg-expressive-orange-subtle` = the exact bug. The kit-CSS half of resolvable is load-bearing (carries the 7 `*-on-prominent`/`transparent` tokens lossy ADS normalization drops); the seed is load-bearing for the value-lane. Both mandatory, in their OWN roles.
- **No live ADS pull.** `getVariables` is Enterprise-gated (null in production). The ADS half is a checked-in seed; refreshing it is a manual dev step.
- **Do NOT change `figmaVarNameToKitToken`** in `kitTokens.ts` — the kit-emit path uses it; its camelCase-lossiness is COVERED by the kit-CSS union, not by editing the normalizer.
- **The hook reads `new_string` on Edit** (not disk). Integration tests use `Write` with full content.
- **Fail open everywhere:** a source that won't load contributes nothing; an empty union skips the check. Never block generation on our own inability to load a source.

---

## Task 1: Checked-in ADS color seed

**Files:**
- Create: `studio/server/figma/adsColorSeed.mjs` (a `.mjs` so the `.mjs` hook can `import` it with no bundler)
- Test: `studio/__tests__/server/figma/adsColorSeed.test.ts` (new)

**Interfaces:**
- Produces: `export const ADS_COLOR_SEED = { "<kit-token-name-sans-dashes>": "<#hex Light value>", … }` — keys are the `figmaVarNameToKitToken` normalization of each ADS color variable name WITHOUT the leading `--` (to match how `extractTokenNames`/`loadTokenNames` store names: lowercase, no `--`). Also `export const ADS_SEED_PROVENANCE = "Arcade Design System, Figma file a2uKnm88LxRXEWAL1kOqeQ; regenerate via the figma-console Desktop Bridge (figma_get_variables, resolveAliases) — see plan Task 1.";`

**Context:** The ADS color set was captured via the Desktop Bridge at authoring. Each ADS name like `BG/Expressive/Orange/Subtle` normalizes (lowercase, `/`→`-`, collapse `-`) to key `bg-expressive-orange-subtle`. Values are the resolved **Light** hex. This is a static mirror of the COMPLETE semantic-color set (the kit-CSS union keeps kit-shipped tokens live regardless of seed age).

- [ ] **Step 1: Write the seed file**

Create `studio/server/figma/adsColorSeed.mjs` with the captured ADS colors. Keys = normalized name sans `--`, values = Light hex. Include AT MINIMUM these (the full set from the capture — add every row from the source material; the ones below are load-bearing for tests):

Write EXACTLY this content (the complete captured ADS color set — Light values; names already normalized to kit form). This is the full data, NOT a sample — do not abbreviate:

```javascript
// ADS semantic color tokens — the design-system source of truth for color.
// Keys = kit custom-property form (sans leading --); values = ADS Light hex.
// Provenance: Arcade Design System, Figma file a2uKnm88LxRXEWAL1kOqeQ (collection "Mode").
// Regenerate via the figma-console Desktop Bridge: figma_get_variables
// (format=filtered, namePattern=^(BG|FG|Surface|Stroke|Icon)/, resolveAliases=true),
// then normalize each name (lowercase, / and whitespace -> -, collapse -).
// This is a checked-in MIRROR: getVariables is Enterprise-gated -> null in prod,
// so the ADS half of the check cannot be pulled live.
export const ADS_COLOR_SEED = {
  // Neutral
  "fg-neutral-prominent": "#211E20", "fg-neutral-on-prominent": "#FFFFFF",
  "fg-neutral-medium": "#737072", "fg-neutral-subtle": "#A5A0A3",
  "fg-neutral-black": "#211E20", "fg-neutral-white": "#FFFFFF",
  "bg-neutral-prominent": "#211E20", "bg-neutral-soft": "#C7C3C557",
  "bg-neutral-subtle": "#211E2026", "bg-neutral-medium": "#211E20E8",
  "bg-neutral-inverted": "#FFFFFF",
  "surface-backdrop": "#FFFFFF", "surface-overlay": "#FFFFFF", "surface-shallow": "#FAF9F9",
  "stroke-neutral-subtle": "#C7C3C5", "stroke-neutral-medium": "#898587",
  "stroke-neutral-prominent": "#211E20", "stroke-neutral-soft": "#ECEAEB",
  "stroke-neutral-inverted": "#FFFFFF",
  // Alert / Info / Success / Warning / Intelligence (semantic)
  "bg-alert-subtle": "#FFE5DB", "bg-alert-medium": "#FFCCBB", "bg-alert-prominent": "#D10000",
  "fg-alert-prominent": "#94030A", "fg-alert-on-prominent": "#FFF2EB", "stroke-alert": "#94030A",
  "bg-info-subtle": "#E7FBFF", "bg-info-medium": "#92E0FF", "bg-info-prominent": "#0053E7",
  "fg-info-prominent": "#002AB0", "fg-info-on-prominent": "#CFF4FF", "stroke-info": "#002AB0",
  "bg-success-subtle": "#EEFFD6", "bg-success-medium": "#C4FF66", "bg-success-prominent": "#4B8100",
  "fg-success-prominent": "#2B5500", "fg-success-on-prominent": "#EEFFD6", "stroke-success": "#2B5500",
  "bg-warning-subtle": "#FFFFBB", "bg-warning-medium": "#FFE000", "bg-warning-prominent": "#F6C800",
  "fg-warning-prominent": "#714400", "fg-warning-on-prominent": "#4F2900", "stroke-warning": "#A07000",
  "bg-intelligence-subtle": "#F6E5FF", "bg-intelligence-medium": "#D5ABFF", "bg-intelligence-prominent": "#4700AB",
  "fg-intelligence-prominent": "#4700AB", "fg-intelligence-on-prominent": "#F6E5FF", "stroke-intelligence": "#4700AB",
  // Expressive — Blue
  "bg-expressive-blue-subtle": "#E7FBFF", "bg-expressive-blue-medium": "#92E0FF", "bg-expressive-blue-prominent": "#0053E7",
  "fg-expressive-blue-prominent": "#077CFF", "fg-expressive-blue-on-prominent": "#E7FBFF",
  // Expressive — Orange
  "bg-expressive-orange-subtle": "#FCECD2", "bg-expressive-orange-medium": "#FFDAA3", "bg-expressive-orange-prominent": "#D14600",
  "fg-expressive-orange-prominent": "#FF7924", "fg-expressive-orange-on-prominent": "#FFF8EB",
  // Expressive — Yellow
  "bg-expressive-yellow-subtle": "#FFFA9B", "bg-expressive-yellow-medium": "#FFF049", "bg-expressive-yellow-prominent": "#FFE000",
  "fg-expressive-yellow-prominent": "#F6C800", "fg-expressive-yellow-on-prominent": "#FFFFBB",
  // Expressive — Green
  "bg-expressive-green-subtle": "#E1FFB2", "bg-expressive-green-medium": "#A0ED1A", "bg-expressive-green-prominent": "#74AE00",
  "fg-expressive-green-prominent": "#74AE00", "fg-expressive-green-on-prominent": "#EEFFD6",
  // Expressive — Red
  "bg-expressive-red-subtle": "#FFE5DB", "bg-expressive-red-medium": "#FFAB99", "bg-expressive-red-prominent": "#D10000",
  "fg-expressive-red-prominent": "#FF342D", "fg-expressive-red-on-prominent": "#FFF2EB",
  // Expressive — Teal
  "bg-expressive-teal-subtle": "#C6FFE3", "bg-expressive-teal-medium": "#3DF2B9", "bg-expressive-teal-prominent": "#006139",
  "fg-expressive-teal-prominent": "#00BF89", "fg-expressive-teal-on-prominent": "#E4FFEF",
  // Expressive — Purple
  "bg-expressive-purple-subtle": "#F6E5FF", "bg-expressive-purple-medium": "#D5ABFF", "bg-expressive-purple-prominent": "#4700AB",
  "fg-expressive-purple-prominent": "#A46FFF", "fg-expressive-purple-on-prominent": "#FBF2FF",
  // Expressive — Pink
  "bg-expressive-pink-subtle": "#FFE4F9", "bg-expressive-pink-medium": "#FF91D5", "bg-expressive-pink-prominent": "#E00274",
  "fg-expressive-pink-prominent": "#FF52A8", "fg-expressive-pink-on-prominent": "#FFF2FC",
};
export const ADS_SEED_PROVENANCE =
  "Arcade Design System, Figma file a2uKnm88LxRXEWAL1kOqeQ; regenerate via figma-console Desktop Bridge.";
```

(This is the color set captured from ADS at authoring, ~85 rows. If a future edit references a real ADS color token absent here, re-pull via the Bridge and add the row — but the kit-CSS union already resolves every token arcade-gen ships, so a seed gap only affects kit-ABSENT ADS tokens.)

- [ ] **Step 2: Write the seed test**

```typescript
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { ADS_COLOR_SEED } from "../../../server/figma/adsColorSeed.mjs";

describe("ADS color seed", () => {
  it("carries the expressive-orange family the kit CSS lacks", () => {
    expect(ADS_COLOR_SEED["bg-expressive-orange-subtle"]).toBe("#FCECD2");
  });
  it("keys are normalized kit form (lowercase, hyphenated, no leading --)", () => {
    for (const k of Object.keys(ADS_COLOR_SEED)) {
      expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/); // multi-segment, no slashes/caps/--
    }
  });
  it("values are hex", () => {
    for (const v of Object.values(ADS_COLOR_SEED)) {
      expect(v).toMatch(/^#[0-9A-Fa-f]{6,8}$/);
    }
  });
});
```

- [ ] **Step 3: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/figma/adsColorSeed.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
command git add studio/server/figma/adsColorSeed.mjs studio/__tests__/server/figma/adsColorSeed.test.ts
command git commit -m "feat(studio/figma): checked-in ADS color seed (design-system token source of truth)"
```

---

## Task 2: Dead-token-ref detector + union + wire into the hook

**Files:**
- Modify: `studio/server/hooks/validateTokenClasses.mjs`
- Test: `studio/__tests__/server/hooks/validateTokenClasses.test.ts` (EXISTS; imports the hook's pure `.mjs` exports with a `// @ts-expect-error` line — add new imports to that same block. The `runHook`/`tmpFrame` harness lives in the SIBLING `validateArcadeImports.test.ts` (~`:296`/`:309`) — port it, see Step 6.)

**Interfaces:**
- Consumes (already exported): `extractTokenNames(cssText)→Set<string>`, `loadTokenNames()→Set<string>`, `parseClassNames(source)→string[]`, `detectTokenClassViolations`, `formatTokenClassError`. From Task 1: `ADS_COLOR_SEED`.
- Produces:
  - `extractTokenRefs(source)→Set<string>` — custom-property names (sans `--`) referenced via `(--x)`/`var(--x)`, ≥1 internal hyphen.
  - `extractLocalDefs(source)→Set<string>` — custom-property names DEFINED in the source, incl. React object-key forms `{ "--x": v }` / `{ ["--x"]: v }` and CSS `--x:`.
  - `buildResolvableSet()→Set<string>` — `loadTokenNames()` ∪ `Object.keys(ADS_COLOR_SEED)` (the union authority; theme-overrides + local defs unioned per-invocation in `main()`).
  - `detectDeadTokenRefs(source, resolvable, seed)→Array<{ref, realValue|null, suggestions}>` — refs not in `resolvable`; `realValue` = `seed[ref]` when present (ADS-real but unresolvable), else null (typo).
  - `suggestRealTokens(deadName, resolvable, limit=3)→string[]` — longest-shared-leading-segment names from the union.
  - `formatDeadTokenError(violations)→string`; `isFrameFile(filePath)→boolean`; `readProjectThemeOverrides(frameFilePath)→string`.

- [ ] **Step 1: Write the failing unit tests**

Add `extractTokenRefs, extractLocalDefs, detectDeadTokenRefs, suggestRealTokens` to the file's existing `@ts-expect-error` import block, then:

```typescript
const UNION = new Set([
  "bg-neutral-subtle", "fg-neutral-medium", "surface-shallow",
  "fg-neutral-on-prominent", "bg-neutral-transparent",       // kit-CSS-only (lossy ADS)
  "bg-expressive-yellow-subtle",
]);
const SEED = { "bg-expressive-orange-subtle": "#FCECD2" };    // ADS-real, kit-absent

describe("extractTokenRefs", () => {
  it("captures the Tailwind paren-var form", () => {
    expect([...extractTokenRefs(`<div className="bg-(--bg-orange-subtle)" />`)]).toEqual(["bg-orange-subtle"]);
  });
  it("captures var() in inline styles", () => {
    expect([...extractTokenRefs(`style={{ background: "var(--surface-overlay)" }}`)]).toEqual(["surface-overlay"]);
  });
  it("ignores a JS decrement (--i) — no internal hyphen", () => {
    expect([...extractTokenRefs(`arr[(--i)]`)]).toEqual([]);
  });
});

describe("extractLocalDefs (React object-key syntax)", () => {
  it("captures a quoted object-key CSS var", () => {
    expect(extractLocalDefs(`style={{ "--my-thing": "#fff" }}`).has("my-thing")).toBe(true);
  });
  it("captures a computed object-key CSS var", () => {
    expect(extractLocalDefs(`style={{ ["--my-thing"]: "#fff" }}`).has("my-thing")).toBe(true);
  });
});

describe("detectDeadTokenRefs", () => {
  it("flags a ref absent from the union as a typo (no realValue)", () => {
    const v = detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, UNION, SEED);
    expect(v.map(x => x.ref)).toEqual(["bg-orange-subtle"]);
    expect(v[0].realValue).toBeNull();
  });
  it("flags an ADS-real-but-kit-absent ref WITH its real value", () => {
    const v = detectDeadTokenRefs(`className="bg-(--bg-expressive-orange-subtle)"`, UNION, SEED);
    expect(v).toHaveLength(1);
    expect(v[0].realValue).toBe("#FCECD2");
  });
  it("does NOT flag a kit-shipped *-on-prominent token (rev-4 false-alarm regression guard)", () => {
    expect(detectDeadTokenRefs(`className="text-(--fg-neutral-on-prominent)"`, UNION, SEED)).toEqual([]);
  });
  it("does NOT flag a resolvable token", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-neutral-subtle)"`, UNION, SEED)).toEqual([]);
  });
  it("does NOT flag an author-local var (unioned by caller)", () => {
    const withLocal = new Set([...UNION, "my-thing"]);
    expect(detectDeadTokenRefs(`style={{ ["--my-thing"]: "#fff", color: "var(--my-thing)" }}`, withLocal, SEED)).toEqual([]);
  });
  it("fails open on an empty union", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, new Set(), SEED)).toEqual([]);
  });
});

describe("suggestRealTokens", () => {
  it("returns union tokens sharing the leading segment, capped", () => {
    const s = suggestRealTokens("bg-orange-subtle", UNION, 3);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.every(t => UNION.has(t) && t.startsWith("bg-"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement the detector functions**

Add to `validateTokenClasses.mjs` (after `detectTokenClassViolations`, before `loadTokenNames`); import the seed at the top:

```javascript
// @ts-nocheck stays implicit — plain .mjs
import { ADS_COLOR_SEED } from "../figma/adsColorSeed.mjs";
```

```javascript
/**
 * Custom-property REFERENCES: Tailwind `bg-(--x)`, CSS `var(--x)`, `[var(--x)]`
 * (all contain the `(--x)` substring). Requires ≥1 internal hyphen so a JS
 * decrement `(--i)` is never captured (every DS token is multi-segment).
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
 * Custom-property DEFINITIONS in the source, so an author's own inline var is
 * never flagged as dead. Matches THREE forms:
 *   --x:                       (CSS / style string)      →  --x\s*:
 *   { "--x": v } / { '--x': v }(React quoted object key) →  ["']--x["']\s*:
 *   { ["--x"]: v }             (React computed key)       →  \[\s*["']--x["']\s*\]\s*:
 * The base regex `/--([a-z0-9-]+)\s*:/` (used by extractTokenNames) misses the
 * quoted/bracketed forms because a "/] sits between name and colon.
 */
export function extractLocalDefs(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;
  // Plain --x: and quoted "--x": / '--x': and computed ["--x"]: — the optional
  // quote/bracket chars between the name and the colon are what the base regex lacks.
  const re = /(?:\[\s*)?["']?--([a-z0-9-]+)["']?\s*\]?\s*:/gi;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Longest-shared-leading-segment names from the resolvable set (a hint, not a
 *  color matcher). Must share ≥1 leading segment. */
export function suggestRealTokens(deadName, resolvable, limit = 3) {
  const segs = String(deadName).split("-");
  const scored = [];
  for (const name of resolvable) {
    const other = name.split("-");
    let shared = 0;
    while (shared < segs.length && shared < other.length && segs[shared] === other[shared]) shared++;
    if (shared === 0) continue;
    scored.push({ name, shared });
  }
  scored.sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

/**
 * References to a `--custom-property` absent from the resolvable UNION. Each
 * violation carries realValue = the ADS seed value when the token is a REAL
 * design-system token the kit just doesn't ship (→ tell the agent the value),
 * else null (→ typo/hallucination, suggest nearest real). Fails open on an
 * empty union.
 */
export function detectDeadTokenRefs(source, resolvable, seed = ADS_COLOR_SEED) {
  if (!resolvable || resolvable.size === 0) return [];
  const out = [];
  for (const ref of extractTokenRefs(source)) {
    if (resolvable.has(ref)) continue;
    const realValue = (seed && Object.prototype.hasOwnProperty.call(seed, ref)) ? seed[ref] : null;
    out.push({ ref, realValue, suggestions: realValue ? [] : suggestRealTokens(ref, resolvable) });
  }
  return out;
}

export function formatDeadTokenError(violations) {
  if (!violations.length) return "";
  const lines = ["Blocked: these CSS-variable references resolve to NO design-system token",
    "(the class compiles but paints nothing — a silent no-op). Fix each:", ""];
  for (const v of violations) {
    if (v.realValue) {
      lines.push(`  - \`--${v.ref}\` is a REAL design-system token but the kit doesn't ship it as CSS.`);
      lines.push(`    Define it in the project's theme-overrides.css (theme-reactive), e.g.`);
      lines.push(`      :root { --${v.ref}: ${v.realValue}; }`);
      lines.push(`    or use the literal value: the \`(--${v.ref})\` → \`[${v.realValue}]\`.`);
    } else {
      const hint = v.suggestions.length
        ? ` Nearest real tokens: ${v.suggestions.map((s) => `--${s}`).join(", ")}.`
        : ` (No near match — use a real design-system token that matches the intent.)`;
      lines.push(`  - \`--${v.ref}\` is not a design-system token.${hint}`);
    }
  }
  lines.push("", "This hook runs on every Write/Edit and will block again until the references resolve.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify detector tests pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS (all Step-1 cases).

- [ ] **Step 5: Frame-file gate + theme-overrides reader + wire into `main()`**

Add near `isInScope`/`extractContent`:

```javascript
/** The dead-token-ref check runs ONLY on generated frame files
 *  (…/projects/<slug>/frames/<id>/*.tsx|ts). Studio's own src/** .tsx would
 *  false-flag. The existing named-form check keeps its broader .tsx scope. */
function isFrameFile(filePath) {
  if (typeof filePath !== "string") return false;
  const s = path.sep;
  return filePath.includes(`${s}projects${s}`) && filePath.includes(`${s}frames${s}`) &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".ts"));
}

/** A project's theme-overrides.css tokens genuinely resolve at render — union
 *  them in. Best-effort; "" on any miss. */
function readProjectThemeOverrides(frameFilePath) {
  try {
    const marker = `${path.sep}frames${path.sep}`;
    const idx = frameFilePath.indexOf(marker);
    if (idx === -1) return "";
    return readFileSync(path.join(frameFilePath.slice(0, idx), "theme-overrides.css"), "utf-8");
  } catch { return ""; }
}
```

Extend `main()` — keep the existing class-violation path, ADD the dead-ref path, union into ONE exit(2):

```javascript
  const tokenNames = loadTokenNames();
  const classes = parseClassNames(content);
  const classViolations = detectTokenClassViolations(classes, tokenNames);

  let deadRefs = [];
  if (isFrameFile(toolInput?.file_path)) {
    // RESOLVABLE = what actually RENDERS: kit CSS (load-bearing — carries
    // *-on-prominent) ∪ project overrides ∪ same-file local defs. The ADS seed
    // is NOT in here — it's the classification oracle passed separately. A seed
    // token the kit doesn't ship does NOT render, so it must NOT be resolvable
    // (else it silently passes = the exact bug). Fail open: empty → skip.
    const resolvable = new Set(tokenNames);                        // kit CSS (renders)
    for (const t of extractTokenNames(readProjectThemeOverrides(toolInput.file_path))) resolvable.add(t);
    for (const t of extractLocalDefs(content)) resolvable.add(t);   // author-local vars
    if (resolvable.size > 0) deadRefs = detectDeadTokenRefs(content, resolvable, ADS_COLOR_SEED);
  }

  if (classViolations.length === 0 && deadRefs.length === 0) process.exit(0);

  const message = [
    classViolations.length ? formatTokenClassError(classViolations) : "",
    deadRefs.length ? formatDeadTokenError(deadRefs) : "",
  ].filter(Boolean).join("\n\n");
  process.stderr.write(message);
  process.exit(2);
```

Replace the existing tail of `main()` (`const tokenNames = loadTokenNames(); … process.exit(2);`) with the above. Do NOT change `loadTokenNames`/`extractTokenNames`/`parseClassNames`/`detectTokenClassViolations`/`formatTokenClassError`.

- [ ] **Step 6: Port the integration harness + add end-to-end cases**

`runHook`/`tmpFrame` are in `validateArcadeImports.test.ts` (~`:296`/`:309`), NOT this file — port both, pointing `HOOK` at `validateTokenClasses.mjs`. **`tmpFrame` MUST write under a `/projects/<slug>/frames/<id>/` path** or `isFrameFile` rejects it and the check wrongly passes:

```typescript
function tmpFrame(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-token-"));
  const frameDir = path.join(dir, "projects", "p", "frames", "01");
  fs.mkdirSync(frameDir, { recursive: true });
  const file = path.join(frameDir, "index.tsx");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}
```

```typescript
it("exit 2 on a typo token in a frame file (Write, full content)", () => {
  const f = tmpFrame(`export default () => <div className="bg-(--bg-orange-subtle)" />;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(2);
  expect(p.stderr).toMatch(/bg-orange-subtle/);
});
it("exit 2 with the real value for an ADS-real-but-kit-absent token", () => {
  const f = tmpFrame(`export default () => <div className="bg-(--bg-expressive-orange-subtle)" />;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(2);
  expect(p.stderr).toMatch(/#FCECD2/i);
});
it("exit 0 for a kit-shipped *-on-prominent token (rev-4 regression guard)", () => {
  const f = tmpFrame(`export default () => <div className="text-(--fg-neutral-on-prominent)" />;`);
  const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
  expect(p.status).toBe(0);
});
```

Use `proc.status`/`proc.stderr` (NOT `exitCode`).

- [ ] **Step 7: Run to verify pass + no regression to named-form tests**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateTokenClasses.test.ts`
Expected: PASS — new cases AND all pre-existing named-form tests.

- [ ] **Step 8: Commit**

```bash
command git add studio/server/hooks/validateTokenClasses.mjs studio/__tests__/server/hooks/validateTokenClasses.test.ts
command git commit -m "feat(studio/hooks): flag dead token refs vs the ADS∪kit union so silent no-op edits self-correct"
```

---

## Task 3: One-frame data fix + full suite + manual acceptance

**Files:** (data, not repo) `~/Library/Application Support/arcade-studio/projects/implement-this-precisely/frames/01-figma-4368-19734/index.tsx:9`

- [ ] **Step 1: Fix the live repro frame (data)**

In that frame's `index.tsx:9`, change `className="bg-(--bg-orange-subtle)"` → `className="bg-[#FCECD2]"` (the ADS value for `BG/Expressive/Orange/Subtle`). Do NOT `git add` — it's outside the repo.

- [ ] **Step 2: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS. Re-run any failing file in isolation to confirm contention, not regression.

- [ ] **Step 3: Manual acceptance (the live gate — jsdom can't exercise the self-correct loop)**

`pnpm run studio` (fully quit + restart first — hook `.mjs` changes load per spawned process, but restart avoids stale state). Then, in `implement-this-precisely`:
- Confirm frame `01-figma-4368-19734` now shows the orange (`#FCECD2`) from Step 1.
- Ask the agent (chat) to set the background to `bg/expressive/orange/subtle` (the ORIGINAL failing request). Confirm: it does NOT report a silent success on a dead token — the hook feeds back the real value (`#FCECD2`) and the agent applies a rendering form (theme-overrides def or `bg-[#FCECD2]`); the visible background changes.
- Ask for a real, kit-shipped token (e.g. "make the background the subtle neutral surface") → applies with no hook block.
- Ask for pure nonsense (`bg/floogle/plonk`) → hook flags it as a typo (not in the union, no real value), agent picks a real token or asks.
- Confirm NO false alarm on ordinary edits using real tokens/utilities (incl. a frame that uses `text-(--fg-neutral-on-prominent)` — the rev-4 regression case) and on a frame with an author-local `style={{ "--x": ... }}` var.

- [ ] **Step 4: No version bump here** (releases are a separate explicit step, per project convention).

---

## Self-review notes (author)

- **Spec coverage:** ADS seed (Part A) = Task 1; union + object-key fix + detector + wire-in (Part B) = Task 2; one-frame fix + manual gate = Task 3. All rev-5 sections mapped.
- **Both rev-4 flaws are fixed AND regression-guarded:** kit-CSS union is load-bearing (Global Constraints + Task 2 Step 5), with a dedicated `*-on-prominent` exit-0 test (Task 2 Steps 1+6); no live pull (seed is checked-in, Task 1).
- **`figmaVarNameToKitToken` is NOT edited** (kit-emit uses it); its lossiness is covered by the union, per the review's recommendation.
- **Object-key local-def extraction** (the sole author-var false-alarm guard) has its regex pinned (Task 2 Step 3 `extractLocalDefs`) + two tests.
- **Type consistency:** `detectDeadTokenRefs` → `{ref, realValue, suggestions}[]`; `formatDeadTokenError` consumes exactly that; `main()` unions `classViolations`+`deadRefs` into one `exit(2)`. All name-sets are `Set<string>` of names sans `--`, lowercased.
- **Fail-open paths:** empty union → skip (Task 2 Step 5 guard); unreadable overrides → `""`; non-frame file → skip; missing seed import would throw at load, so the seed is checked in (Task 1) and its test guarantees shape.
- **Acknowledged non-goal (from spec):** the `new_string`-only read means a dead token written by an earlier edit whose later edit doesn't touch that line isn't re-seen; the dominant case (the edit that introduces it) is caught.
