# Figma Export #2 — Component + Token Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. NOTE: Tasks marked **[BRIDGE]** are live, interactive Figma-Bridge captures driven by the orchestrator (Claude) — NOT subagent TDD tasks; they require Figma Desktop + the Console Bridge plugin connected to the Arcade 0.3 library. Tasks marked **[TDD]** are normal subagent-friendly test-first code tasks.

**Goal:** Build the lookup knowledge that turns an SLJ node into a real Figma instance — a curated arcade-gen→Arcade-0.3 component table, a derived token→Figma-variable map over a committed variable snapshot, and a role-aware token disambiguation resolver — all pure data/logic, no Figma writes.

**Architecture:** New module `studio/src/export/figma/`. Pure functions + committed data snapshots. Three logic units (`tokenMap`, `disambiguate`, `componentMap`) consume two Bridge-captured data files (`figma-variables.json`, the curated component entries). The #3 consumer (later) reads these to create instances + bind variables.

**Tech Stack:** TypeScript, Vitest (node env), the figma-console MCP Bridge (capture-time only).

**Spec:** `docs/superpowers/specs/2026-06-06-figma-export-mapping-design.md`.

---

## Naming-prefix convention (load-bearing — from the spec)

Per arcade-gen primitive, the canonical Figma component-set pick, in priority order:
1. **unprefixed** name (Arcade 0.3 target) — `generation: "0.3"`
2. else **`[0.2]`** set (valid; not yet migrated to 0.3) — `generation: "0.2"`
3. never `[DLS]` / `[WIP]` / `[🔴DEPRECATED]`

Record the chosen generation + what was rejected in each entry's `note`.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `studio/src/export/figma/types.ts` | Shared types: `FigmaComponentMapping`, `VariantAxis`, `TextNodeHint`, `ColorRole` | T2 |
| `studio/src/export/figma/figma-variables.json` | Bridge-captured snapshot: 750 variable `{name,key,type,collection}` | T1 [BRIDGE] |
| `studio/src/export/figma/tokenMap.ts` | `tokenNameToVariableKey(cssToken)` — naming rule + overrides over the snapshot | T3 [TDD] |
| `studio/src/export/figma/disambiguate.ts` | `resolveTokenForRole(index,value,role)` — role filter + semantic-over-core | T4 [TDD] |
| `studio/src/export/figma/componentEntries.ts` | The curated 18-primitive data array (Bridge-captured keys/variants) | T5 [BRIDGE] |
| `studio/src/export/figma/componentMap.ts` | `findComponentMapping(name)` + the well-formedness invariants | T6 [TDD] |
| `studio/src/export/figma/index.ts` | Barrel re-export of the public API | T6 [TDD] |
| `studio/__tests__/export/figma/*.test.ts` | Unit tests per logic unit + snapshot integrity | T3,T4,T6 |

---

## Task 1 [BRIDGE]: Capture the variable snapshot

**Driver:** orchestrator (Claude), live via the figma-console Bridge. Not a subagent task.

**Files:**
- Create: `studio/src/export/figma/figma-variables.json`

- [ ] **Step 1: Confirm Bridge is on the Arcade 0.3 library**

Call `mcp__figma-console__figma_get_status` with `probe:true`. Expect
`currentFileKey: "a2uKnm88LxRXEWAL1kOqeQ"` (Arcade UI Kit v0.3). If not, ask the
operator to open that file with the Bridge plugin running.

- [ ] **Step 2: Capture all local variables (name → key → type → collection)**

Run via `figma_execute` (the active file IS the library, so variables are local):

```js
const vars = await figma.variables.getLocalVariablesAsync();
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const colName = {}; for (const c of cols) colName[c.id] = c.name;
return vars.map(v => ({ name: v.name, key: v.key, type: v.resolvedType, collection: colName[v.variableCollectionId] || "?" }));
```

If the response is too large for one call, chunk by slicing
(`vars.slice(0,375)` / `.slice(375)`) across two calls and concatenate.

- [ ] **Step 3: Write the snapshot file**

Write the captured array to `studio/src/export/figma/figma-variables.json` as:
```json
{ "capturedFrom": "Arcade UI Kit v0.3", "fileKey": "a2uKnm88LxRXEWAL1kOqeQ", "variables": [ { "name": "FG/Neutral/Prominent", "key": "35a2c2a2c7ee47ad73f7918c0f9643a06be79ce1", "type": "COLOR", "collection": "Mode" }, ... ] }
```
Expect ~750 entries. Sanity: grep that `FG/Neutral/Prominent`, `BG/Neutral/Soft`,
`Stroke/Neutral/Subtle`, `Bubble/Self/BG` are all present.

- [ ] **Step 4: Commit**

```bash
git add studio/src/export/figma/figma-variables.json
git commit -m "feat(studio/export): capture Arcade 0.3 variable snapshot (name->key)"
```

---

## Task 2 [TDD]: Shared types

**Files:**
- Create: `studio/src/export/figma/types.ts`
- Test: `studio/__tests__/export/figma/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/types.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isMappedEntry, type FigmaComponentMapping } from "../../../src/export/figma/types";

describe("figma mapping types", () => {
  it("isMappedEntry narrows mapped entries with non-null figma + generation", () => {
    const mapped: FigmaComponentMapping = {
      arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "edd2821d", setName: "Bubble" },
      variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver" } }],
      note: "unprefixed canonical",
    };
    const ambiguous: FigmaComponentMapping = {
      arcadeGen: "DevRevThemeProvider", status: "ambiguous", generation: null,
      figma: null, variants: [], note: "provider, no Figma analogue",
    };
    expect(isMappedEntry(mapped)).toBe(true);
    expect(isMappedEntry(ambiguous)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/figma/types.test.ts`
Expected: FAIL — cannot resolve `../../../src/export/figma/types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/types.ts
export type ColorRole = "fill" | "stroke" | "text";

export type VariantAxis = {
  prop: string;                      // SLJ prop name, e.g. "variant"
  figmaProp: string;                 // Figma variant property, e.g. "Type"
  valueMap: Record<string, string>;  // {"receiver":"Receiver"}
};

export type TextNodeHint =
  | { strategy: "lowest-depth" }
  | { strategy: "by-name"; name: string };

export type FigmaComponentMapping = {
  arcadeGen: string;
  status: "mapped" | "ambiguous";
  generation: "0.3" | "0.2" | null;
  figma: { componentSetKey: string; setName: string } | null;
  variants: VariantAxis[];
  textNode?: TextNodeHint;
  note: string;
};

/** A mapped entry has a non-null figma target and a concrete generation. */
export function isMappedEntry(
  e: FigmaComponentMapping,
): e is FigmaComponentMapping & { status: "mapped"; figma: NonNullable<FigmaComponentMapping["figma"]>; generation: "0.3" | "0.2" } {
  return e.status === "mapped" && e.figma !== null && (e.generation === "0.3" || e.generation === "0.2");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/types.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/types.ts studio/__tests__/export/figma/types.test.ts
git commit -m "feat(studio/export): figma mapping shared types"
```

---

## Task 3 [TDD]: Token → variable mapping

**Files:**
- Create: `studio/src/export/figma/tokenMap.ts`
- Test: `studio/__tests__/export/figma/tokenMap.test.ts`

Maps a CSS token name (`--fg-neutral-prominent`) to a Figma variable key by
normalized-name compare against the committed snapshot, with an override list
for non-conforming names. Reads the snapshot via an injected list so the unit is
testable without the real file.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/tokenMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTokenMap, OVERRIDES } from "../../../src/export/figma/tokenMap";

const SNAPSHOT = [
  { name: "FG/Neutral/Prominent", key: "k-fg-neutral-prominent", type: "COLOR", collection: "Mode" },
  { name: "BG/Neutral/Soft", key: "k-bg-neutral-soft", type: "COLOR", collection: "Mode" },
  { name: "Stroke/Neutral/Subtle", key: "k-stroke-neutral-subtle", type: "COLOR", collection: "Mode" },
  { name: "Bubble/Self/BG", key: "k-bubble-self-bg", type: "COLOR", collection: "Component" },
];

describe("tokenMap", () => {
  it("maps a CSS token to its variable key by normalized name compare", () => {
    const map = buildTokenMap(SNAPSHOT);
    expect(map.tokenNameToVariableKey("--fg-neutral-prominent")).toBe("k-fg-neutral-prominent");
    expect(map.tokenNameToVariableKey("--bg-neutral-soft")).toBe("k-bg-neutral-soft");
    expect(map.tokenNameToVariableKey("--stroke-neutral-subtle")).toBe("k-stroke-neutral-subtle");
  });

  it("is robust to slash/dash/case differences", () => {
    const map = buildTokenMap(SNAPSHOT);
    // CSS dash form vs Figma slash+mixedcase form both normalize equal
    expect(map.tokenNameToVariableKey("--FG-Neutral-Prominent")).toBe("k-fg-neutral-prominent");
  });

  it("returns null for an unknown token", () => {
    const map = buildTokenMap(SNAPSHOT);
    expect(map.tokenNameToVariableKey("--does-not-exist")).toBeNull();
  });

  it("applies an override before the naming rule", () => {
    // Simulate an override entry: a css token that maps to a differently-named variable.
    const map = buildTokenMap(SNAPSHOT, { "--chat-bubble-mine": "Bubble/Self/BG" });
    expect(map.tokenNameToVariableKey("--chat-bubble-mine")).toBe("k-bubble-self-bg");
  });

  it("OVERRIDES is an object (the committed override list)", () => {
    expect(typeof OVERRIDES).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/figma/tokenMap.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/tokenMap.ts
export type VariableSnapshotEntry = { name: string; key: string; type: string; collection: string };

/** CSS tokens whose name does NOT follow the FG/Neutral/Prominent <-> --fg-neutral-prominent
 *  rule. Maps the CSS token name -> the exact Figma variable NAME. Filled in during
 *  curation (T7) as real non-conformers are found; starts empty. */
export const OVERRIDES: Record<string, string> = {};

/** Normalize a token/variable name for comparison: lowercase, drop --, /, -, spaces. */
function norm(name: string): string {
  return name.replace(/^--/, "").replace(/[-/\s]/g, "").toLowerCase();
}

export function buildTokenMap(
  snapshot: VariableSnapshotEntry[],
  overrides: Record<string, string> = OVERRIDES,
) {
  // name(normalized) -> key, and exactName -> key (for override resolution)
  const byNorm = new Map<string, string>();
  const byExactName = new Map<string, string>();
  for (const v of snapshot) {
    byExactName.set(v.name, v.key);
    const n = norm(v.name);
    if (!byNorm.has(n)) byNorm.set(n, v.key);
  }

  function tokenNameToVariableKey(cssTokenName: string): string | null {
    // 1. Override: css token -> exact variable name -> key.
    const overrideName = overrides[cssTokenName];
    if (overrideName) return byExactName.get(overrideName) ?? null;
    // 2. Naming rule: normalized compare.
    return byNorm.get(norm(cssTokenName)) ?? null;
  }

  return { tokenNameToVariableKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/tokenMap.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/tokenMap.ts studio/__tests__/export/figma/tokenMap.test.ts
git commit -m "feat(studio/export): token-name to Figma-variable-key mapping"
```

---

## Task 4 [TDD]: Role-aware token disambiguation

**Files:**
- Create: `studio/src/export/figma/disambiguate.ts`
- Test: `studio/__tests__/export/figma/disambiguate.test.ts`

Fixes the Slice 0 collision: a resolved color has multiple candidate token
names; pick the right one by CSS property role, then prefer semantic over core.
Takes a `lookup(value) → string[]` function (Slice 0's tokenIndex exposes this)
so it's testable in isolation.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/disambiguate.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveTokenForRole } from "../../../src/export/figma/disambiguate";

// The live Slice 0 collision: one resolved value, two candidate tokens.
const lookup = (v: string): string[] =>
  v === "rgb(23,23,23)" ? ["--bg-neutral-prominent", "--fg-neutral-prominent"]
  : v === "rgb(1,1,1)" ? ["Husk/1200", "--fg-neutral-black"]
  : [];

describe("resolveTokenForRole", () => {
  it("picks the --fg token for a text role (the Slice 0 bug)", () => {
    expect(resolveTokenForRole(lookup, "rgb(23,23,23)", "text")).toBe("--fg-neutral-prominent");
  });

  it("picks the --bg token for a fill role", () => {
    expect(resolveTokenForRole(lookup, "rgb(23,23,23)", "fill")).toBe("--bg-neutral-prominent");
  });

  it("prefers a semantic token over a core color within the survivors", () => {
    // both survive a 'text' filter loosely; semantic --fg-neutral-black beats core Husk/1200
    expect(resolveTokenForRole(lookup, "rgb(1,1,1)", "text")).toBe("--fg-neutral-black");
  });

  it("falls back to the first candidate when the role filter empties the set", () => {
    const onlyBg = (_: string) => ["--bg-neutral-soft"];
    expect(resolveTokenForRole(onlyBg, "x", "text")).toBe("--bg-neutral-soft");
  });

  it("returns the raw value when there are no candidates", () => {
    expect(resolveTokenForRole(() => [], "rgb(9,9,9)", "fill")).toBe("rgb(9,9,9)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/figma/disambiguate.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/disambiguate.ts
import type { ColorRole } from "./types";

// Token-name prefixes preferred for each CSS property role.
const ROLE_PREFIXES: Record<ColorRole, string[]> = {
  text: ["--fg-", "--surface-fg", "--input-fg", "--control-fg"],
  fill: ["--bg-", "--surface-", "--control-bg", "--input-bg"],
  stroke: ["--stroke-", "--border-", "--outline-"],
};

/** A candidate is "semantic" if it looks like a CSS custom property (starts with --).
 *  Core library colors (e.g. "Husk/1200") do not and are preferred LAST. */
function isSemantic(name: string): boolean {
  return name.startsWith("--");
}

export function resolveTokenForRole(
  lookup: (value: string) => string[],
  resolvedValue: string,
  role: ColorRole,
): string {
  const candidates = lookup(resolvedValue);
  if (candidates.length === 0) return resolvedValue;

  // 1. Filter by role prefix.
  const prefixes = ROLE_PREFIXES[role];
  const roleMatched = candidates.filter((c) => prefixes.some((p) => c.startsWith(p)));
  const pool = roleMatched.length > 0 ? roleMatched : candidates;

  // 2. Prefer semantic over core within the surviving pool.
  const semantic = pool.filter(isSemantic);
  const ranked = semantic.length > 0 ? semantic : pool;

  // 3. First survivor.
  return ranked[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/disambiguate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/disambiguate.ts studio/__tests__/export/figma/disambiguate.test.ts
git commit -m "feat(studio/export): role-aware token disambiguation (fixes Slice 0 fg/bg collision)"
```

---

## Task 5 [BRIDGE]: Curate the 18-primitive component entries

**Driver:** orchestrator (Claude), live via the Bridge. Not a subagent task.

**Files:**
- Create: `studio/src/export/figma/componentEntries.ts`

The 18 arcade-gen primitives (from `src/lift/mappings/primitives.ts`): Button,
IconButton, Input, Select, Checkbox, Switch, Modal, Popover, Menu, Tabs, Badge,
Tooltip, Avatar, ChatBubble, Tag, Breadcrumb, Separator, DevRevThemeProvider.

- [ ] **Step 1: For each primitive, find the canonical set**

Per primitive, call `mcp__figma-console__figma_search_components` with
`libraryFileKey: "a2uKnm88LxRXEWAL1kOqeQ"` and the primitive name. From the
results, apply the convention: pick the **unprefixed** set; else the **`[0.2]`**
set; never `[DLS]`/`[WIP]`/`[🔴DEPRECATED]`. Record the chosen
`componentSetKey`, `setName`, and `generation`.

- [ ] **Step 2: For each chosen set, read its variant properties**

Call `mcp__figma-console__figma_get_library_component_by_key` with the chosen
set key, `format: "summary"`. Read `properties` → find the VARIANT axis(es) the
arcade-gen prop drives (e.g. arcade-gen `variant` → Figma `Variant` with values
Primary/Secondary/...). Build the `valueMap`. Note any axis name quirks (e.g.
`Varient` sic on `[DLS]` sets — but those are rejected anyway).

- [ ] **Step 3: Decide the text-node hint**

For components with a text label (Button, ChatBubble, Badge, Tag, Breadcrumb,
Tooltip), record `textNode`. Prefer `{ strategy: "by-name", name: "..." }` when
the set exposes a TEXT component-property (e.g. Button's `✏️ Content`); else
`{ strategy: "lowest-depth" }`. Components with no text (Switch, Checkbox,
Separator) omit `textNode`.

- [ ] **Step 4: Mark provider/no-analogue entries ambiguous**

`DevRevThemeProvider` (and any primitive with no clean canonical 0.3 set) →
`status: "ambiguous"`, `generation: null`, `figma: null`, with a note. These
degrade to the #3 fallback.

- [ ] **Step 5: Write `componentEntries.ts`**

```ts
// studio/src/export/figma/componentEntries.ts
import type { FigmaComponentMapping } from "./types";

// Curated arcade-gen -> Arcade 0.3 component mappings. Captured Bridge-assisted.
// Convention: unprefixed (0.3) preferred; [0.2] fallback; [DLS]/[WIP]/[DEPRECATED] rejected.
// Each entry's note records the chosen generation + what was rejected.
export const COMPONENT_ENTRIES: FigmaComponentMapping[] = [
  // EXAMPLE shape (ChatBubble seed, already proven in Slice 0):
  {
    arcadeGen: "ChatBubble",
    status: "mapped",
    generation: "0.3",
    figma: { componentSetKey: "edd2821db8a05b808da334a1c6aed7646d23e82e", setName: "Bubble" },
    variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
    textNode: { strategy: "lowest-depth" },
    note: "Unprefixed canonical; rejected [DLS]Bubble, [WIP]Bubble, [0.2]Bubble. Proven in Slice 0.",
  },
  // ... 17 more, captured live in Steps 1-4 ...
];
```

(The orchestrator fills all 18 entries with REAL captured keys/variants — no
placeholders. ChatBubble's real key is already known from Slice 0.)

- [ ] **Step 6: Commit**

```bash
git add studio/src/export/figma/componentEntries.ts
git commit -m "feat(studio/export): curate 18 arcade-gen -> Arcade 0.3 component mappings"
```

---

## Task 6 [TDD]: Component map lookup + invariants + barrel

**Files:**
- Create: `studio/src/export/figma/componentMap.ts`
- Create: `studio/src/export/figma/index.ts`
- Test: `studio/__tests__/export/figma/componentMap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/componentMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findComponentMapping } from "../../../src/export/figma/componentMap";
import { COMPONENT_ENTRIES } from "../../../src/export/figma/componentEntries";
import { isMappedEntry } from "../../../src/export/figma/types";

describe("componentMap", () => {
  it("finds the ChatBubble seed (mapped, generation 0.3)", () => {
    const m = findComponentMapping("ChatBubble");
    expect(m).not.toBeNull();
    expect(m!.status).toBe("mapped");
    expect(m!.generation).toBe("0.3");
    expect(m!.figma?.setName).toBe("Bubble");
  });

  it("returns null for an unknown component", () => {
    expect(findComponentMapping("NotAThing")).toBeNull();
  });

  it("every entry is well-formed (status/figma/generation consistency)", () => {
    for (const e of COMPONENT_ENTRIES) {
      if (e.status === "mapped") {
        expect(e.figma, `${e.arcadeGen} mapped => figma non-null`).not.toBeNull();
        expect(["0.3", "0.2"], `${e.arcadeGen} mapped => concrete generation`).toContain(e.generation);
        expect(isMappedEntry(e)).toBe(true);
      } else {
        expect(e.figma, `${e.arcadeGen} ambiguous => figma null`).toBeNull();
        expect(e.generation, `${e.arcadeGen} ambiguous => generation null`).toBeNull();
      }
    }
  });

  it("mapped entries that declare a variant prop have a non-empty valueMap", () => {
    for (const e of COMPONENT_ENTRIES) {
      for (const v of e.variants) {
        expect(Object.keys(v.valueMap).length, `${e.arcadeGen}.${v.prop}`).toBeGreaterThan(0);
      }
    }
  });

  it("no entry maps to a rejected-prefix set name", () => {
    for (const e of COMPONENT_ENTRIES) {
      if (e.figma) {
        expect(/^\[(DLS|WIP|🔴DEPRECATED)\]/.test(e.figma.setName), e.arcadeGen).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/figma/componentMap.test.ts`
Expected: FAIL — cannot resolve `componentMap`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/componentMap.ts
import type { FigmaComponentMapping } from "./types";
import { COMPONENT_ENTRIES } from "./componentEntries";

const BY_NAME = new Map<string, FigmaComponentMapping>(
  COMPONENT_ENTRIES.map((e) => [e.arcadeGen, e]),
);

export function findComponentMapping(arcadeGenName: string): FigmaComponentMapping | null {
  return BY_NAME.get(arcadeGenName) ?? null;
}
```

```ts
// studio/src/export/figma/index.ts
export * from "./types";
export { findComponentMapping } from "./componentMap";
export { COMPONENT_ENTRIES } from "./componentEntries";
export { buildTokenMap, OVERRIDES, type VariableSnapshotEntry } from "./tokenMap";
export { resolveTokenForRole } from "./disambiguate";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/componentMap.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/componentMap.ts studio/src/export/figma/index.ts studio/__tests__/export/figma/componentMap.test.ts
git commit -m "feat(studio/export): component-map lookup + well-formedness invariants + barrel"
```

---

## Task 7 [TDD]: Snapshot integrity test + override wiring

**Files:**
- Create: `studio/__tests__/export/figma/snapshot.test.ts`
- Modify: `studio/src/export/figma/tokenMap.ts` (wire `OVERRIDES` with any real non-conformers found during T1/T5 capture; if none found, leave `{}`)

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/snapshot.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import snapshot from "../../../src/export/figma/figma-variables.json";
import { buildTokenMap } from "../../../src/export/figma/tokenMap";

describe("variable snapshot integrity", () => {
  it("parses with the expected shape and is non-trivial", () => {
    expect(snapshot.fileKey).toBe("a2uKnm88LxRXEWAL1kOqeQ");
    expect(Array.isArray(snapshot.variables)).toBe(true);
    expect(snapshot.variables.length).toBeGreaterThan(500);
    for (const v of snapshot.variables.slice(0, 20)) {
      expect(typeof v.name).toBe("string");
      expect(typeof v.key).toBe("string");
    }
  });

  it("resolves the common semantic color families against the REAL snapshot", () => {
    const map = buildTokenMap(snapshot.variables);
    for (const t of ["--fg-neutral-prominent", "--bg-neutral-soft", "--stroke-neutral-subtle", "--surface-overlay"]) {
      expect(map.tokenNameToVariableKey(t), t).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes if T1 captured already)**

Run: `pnpm run studio:test __tests__/export/figma/snapshot.test.ts`
Expected: FAIL if snapshot not yet present; PASS once T1 committed it. (If the
import errors on JSON resolution, ensure `resolveJsonModule` is on in the studio
tsconfig — it is, per existing `figma-token-values.json` import in `src/lift`.)

- [ ] **Step 3: Wire any real overrides**

If T1/T5 capture surfaced CSS tokens whose names don't follow the rule (the
`resolves common families` test will pass without them, but e.g. component
tokens or core colors used directly by frames might need them), add them to
`OVERRIDES` in `tokenMap.ts` as `{ "--css-token": "Figma/Variable/Name" }`.
If none needed, leave `OVERRIDES = {}` and note that in the commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/`
Expected: PASS (whole figma mapping suite green).

- [ ] **Step 5: Commit**

```bash
git add studio/__tests__/export/figma/snapshot.test.ts studio/src/export/figma/tokenMap.ts
git commit -m "feat(studio/export): variable-snapshot integrity test + override wiring"
```

---

## Task 8: Full-suite green + wrap

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: all pass (new figma mapping tests + everything pre-existing; the 3
known pre-existing TS errors in `zoomSteps.ts`/`useProjectFromMirror.ts` are
unrelated and don't block tests).

- [ ] **Step 2: Confirm #2 "Done"**

- `findComponentMapping` returns curated keys for the 18 primitives (or honest
  `ambiguous`), no rejected-prefix set names — T6 invariants.
- `tokenNameToVariableKey` resolves the common `--fg/--bg/--stroke/--surface`
  families against the REAL snapshot — T7.
- `resolveTokenForRole` fixes the Slice 0 fg-vs-bg collision — T4.
- All unit-tested, no Figma writes.

- [ ] **Step 3: Open the PR** (via superpowers:finishing-a-development-branch)

---

## Notes for the executor

- **Tests run from the repo ROOT:** `pnpm run studio:test <path>`.
- **[BRIDGE] tasks (T1, T5) are orchestrator-only** — they need a live Figma
  Bridge on the Arcade 0.3 library (`a2uKnm88LxRXEWAL1kOqeQ`) and human/Claude
  judgment per component. A subagent cannot do them. Run them inline; hand the
  resulting committed data files to subagents for the [TDD] tasks.
- **Capture before logic:** T1 (snapshot) and T5 (entries) must be committed
  before T3/T6/T7 tests pass against real data. T2/T4 are pure logic and don't
  need the captures.
- **Never `git add -A`** — stage explicit paths.
- **`resolveJsonModule`** is already enabled in the studio tsconfig (existing
  `src/lift/figma-token-values.json` import proves it); the snapshot JSON import
  in T7 relies on it.
