# Figma Export #3 — Bridge Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. NOTE: Task 6 is **[LIVE]** — an orchestrator-driven run against the real figma-console Bridge (needs Figma Desktop + Console Bridge plugin connected to Arcade UI Kit v0.3). All other tasks are subagent-friendly **[TDD]**.

**Goal:** Turn a Studio Layout JSON (SLJ) into real Figma nodes — arcade-gen component instances, design tokens bound to Figma variables, unmapped components degraded to styled auto-layout frames — via a pure planner + a thin Bridge executor.

**Architecture:** `planFigmaOps(slj, maps)` (pure) walks the SLJ + the #2 maps into a flat, ordered list of typed `FigmaOp`s using planner-assigned synthetic ids. `executeFigmaOps(ops, bridge)` (thin) runs them over an injected bridge: imports each distinct component/variable key once (cached), creates nodes, maps synthetic→real ids, captures per-op errors. The future plugin reuses the planner, swapping only the bridge.

**Tech Stack:** TypeScript, Vitest (node env), figma-console MCP Bridge (Task 6 only).

**Spec:** `docs/superpowers/specs/2026-06-06-figma-export-consumer-design.md`.

---

## Inputs this builds on (already on main)

- SLJ types — `studio/src/export/slj.ts`: `SljDocument`, `SljNode` = `ComponentNode | ElementNode`, `Box`, `Layout`, `ElementStyle`, `isComponentNode`, `isElementNode`.
  - `ComponentNode`: `{ kind:"component", component, source, props, box, layout, children }`
  - `ElementNode`: `{ kind:"element", tag, box, layout, style, children }` (tag `"text"` for text)
  - `ElementStyle`: `{ fill?, cornerRadius?, stroke?{color,width}, characters?, color?, fontFamily?, fontSize?, fontWeight?, lineHeight? }` — fill/color/stroke.color are a token name (`--*`) OR a raw color string.
- #2 maps — `studio/src/export/figma/`:
  - `findComponentMapping(name): FigmaComponentMapping | null` (componentMap.ts)
  - `FigmaComponentMapping` / `VariantAxis` / `TextNodeHint` / `isMappedEntry` (types.ts)
  - `buildTokenMap(snapshot).tokenNameToVariableKey(css): string | null` (tokenMap.ts)
  - committed snapshot `figma-variables.json`

## Token binding (decided during planning — matches SLJ reality)

The SLJ stores a single resolved value per color (token name `--*` or raw). The
planner binds directly: value starts with `--` → `tokenNameToVariableKey` → if a
key, `bindVariable`; else `setFill` with the value. `disambiguate.ts` is NOT used
on this path (a deferred #1 follow-up would carry candidates+role). No role logic
in #3.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `studio/src/export/figma/ops.ts` | `FigmaOp` union + `FigmaPlan` types | T1 |
| `studio/src/export/figma/planSlj.ts` | `planFigmaOps(slj, maps)` — pure SLJ→ops | T2,T3,T4 |
| `studio/src/export/figma/executeFigmaOps.ts` | `executeFigmaOps(ops, bridge)` + `FigmaBridge` interface | T5 |
| `studio/__tests__/export/figma/planSlj.test.ts` | planner unit tests | T2,T3,T4 |
| `studio/__tests__/export/figma/executeFigmaOps.test.ts` | executor tests (fake bridge) | T5 |

---

## Task 1 [TDD]: Operation types

**Files:**
- Create: `studio/src/export/figma/ops.ts`
- Test: `studio/__tests__/export/figma/ops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/ops.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { FigmaOp, FigmaPlan } from "../../../src/export/figma/ops";
import { isCreateOp } from "../../../src/export/figma/ops";

describe("figma ops types", () => {
  it("isCreateOp distinguishes node-creating ops from mutation ops", () => {
    const frame: FigmaOp = { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } };
    const inst: FigmaOp = { op: "createInstance", id: "n1", parent: "n0", componentKey: "k" };
    const text: FigmaOp = { op: "setText", target: "n1", textNodeHint: { strategy: "lowest-depth" }, characters: "hi" };
    expect(isCreateOp(frame)).toBe(true);
    expect(isCreateOp(inst)).toBe(true);
    expect(isCreateOp(text)).toBe(false);
    const plan: FigmaPlan = { rootId: "n0", ops: [frame, inst, text] };
    expect(plan.ops).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run → confirm FAIL**

Run: `pnpm run studio:test __tests__/export/figma/ops.test.ts`
Expected: FAIL — cannot resolve `../../../src/export/figma/ops`.

- [ ] **Step 3: Implement**

```ts
// studio/src/export/figma/ops.ts
import type { Box, Layout } from "../slj";
import type { TextNodeHint } from "./types";

/** A flat, ordered, executable operation. Parent/child is expressed by the
 *  planner-assigned synthetic `id` / `parent` / `target` references; the executor
 *  maps each synthetic id to the real Figma node id it creates. */
export type FigmaOp =
  | { op: "createFrame"; id: string; parent: string | null; layout: Layout | null; box: Box }
  | { op: "createInstance"; id: string; parent: string; componentKey: string; variant?: Record<string, string> }
  | { op: "setText"; target: string; textNodeHint: TextNodeHint; characters: string }
  | { op: "bindVariable"; target: string; field: "fill" | "stroke"; variableKey: string }
  | { op: "setFill"; target: string; field: "fill" | "stroke"; color: string };

export type FigmaPlan = { rootId: string; ops: FigmaOp[] };

/** True for ops that create a node (and therefore assign an `id`). */
export function isCreateOp(op: FigmaOp): op is Extract<FigmaOp, { id: string }> {
  return op.op === "createFrame" || op.op === "createInstance";
}
```

- [ ] **Step 4: Run → expect PASS (1 test)**

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/ops.ts studio/__tests__/export/figma/ops.test.ts
git commit -m "feat(studio/export): FigmaOp operation vocabulary"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 2 [TDD]: Planner — element nodes (frames, text, fills)

**Files:**
- Create: `studio/src/export/figma/planSlj.ts`
- Test: `studio/__tests__/export/figma/planSlj.test.ts`

This task handles ELEMENT nodes only (frames + text + token/raw fills). Component
nodes come in T3, recursion/nesting assertions in T4. The planner signature takes
an injected `maps` object so tests need no real #2 data.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/planSlj.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planFigmaOps, type PlannerMaps } from "../../../src/export/figma/planSlj";
import type { SljDocument } from "../../../src/export/slj";

// A maps stub: ChatBubble is mapped; tokens resolve only for --bg-neutral-soft.
const MAPS: PlannerMaps = {
  findComponentMapping: (name) =>
    name === "ChatBubble"
      ? { arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
          figma: { componentSetKey: "k-bubble", setName: "Bubble" },
          variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver" } }],
          textNode: { strategy: "lowest-depth" }, note: "" }
      : null,
  tokenNameToVariableKey: (n) => (n === "--bg-neutral-soft" ? "var-bg-neutral-soft" : null),
};

function doc(root: SljDocument["root"]): SljDocument {
  return { slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" }, root };
}

const box = { x: 0, y: 0, width: 10, height: 10 };

describe("planFigmaOps — element nodes", () => {
  it("emits a root createFrame for an element root with its layout", () => {
    const plan = planFigmaOps(doc({
      kind: "element", tag: "div", box,
      layout: { mode: "vertical", gap: 8, padding: [4, 4, 4, 4], align: "start" },
      style: {}, children: [],
    }), MAPS);
    expect(plan.ops[0]).toMatchObject({ op: "createFrame", parent: null, layout: { mode: "vertical", gap: 8 } });
    expect(plan.rootId).toBe(plan.ops[0].op === "createFrame" ? plan.ops[0].id : "");
  });

  it("binds a token fill to a variable, and emits setFill for a raw fill", () => {
    const tokenFill = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "--bg-neutral-soft" }, children: [] }), MAPS);
    expect(tokenFill.ops).toContainEqual(expect.objectContaining({ op: "bindVariable", field: "fill", variableKey: "var-bg-neutral-soft" }));

    const rawFill = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "rgb(1,2,3)" }, children: [] }), MAPS);
    expect(rawFill.ops).toContainEqual(expect.objectContaining({ op: "setFill", field: "fill", color: "rgb(1,2,3)" }));

    const unknownToken = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "--not-a-real-token" }, children: [] }), MAPS);
    // unknown --token has no key → falls back to setFill with the name as-is
    expect(unknownToken.ops).toContainEqual(expect.objectContaining({ op: "setFill", field: "fill", color: "--not-a-real-token" }));
  });

  it("emits a text node's characters via setText and binds its color", () => {
    const plan = planFigmaOps(doc({
      kind: "element", tag: "text", box, layout: null,
      style: { characters: "Hello", color: "--bg-neutral-soft" }, children: [],
    }), MAPS);
    expect(plan.ops).toContainEqual(expect.objectContaining({ op: "setText", characters: "Hello" }));
    expect(plan.ops).toContainEqual(expect.objectContaining({ op: "bindVariable", field: "fill", variableKey: "var-bg-neutral-soft" }));
  });
});
```

- [ ] **Step 2: Run → confirm FAIL**

Run: `pnpm run studio:test __tests__/export/figma/planSlj.test.ts`
Expected: FAIL — cannot resolve `planSlj`.

- [ ] **Step 3: Implement**

```ts
// studio/src/export/figma/planSlj.ts
import type { SljDocument, SljNode, ElementNode, ComponentNode, ElementStyle } from "../slj";
import { isComponentNode } from "../slj";
import type { FigmaComponentMapping } from "./types";
import type { FigmaOp, FigmaPlan } from "./ops";

export interface PlannerMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

/** Emit fill/stroke ops for a style: bindVariable when a --token resolves to a
 *  Figma variable key, else setFill with the value as-is. */
function colorOps(maps: PlannerMaps, targetId: string, style: ElementStyle): FigmaOp[] {
  const out: FigmaOp[] = [];
  const emit = (field: "fill" | "stroke", value: string | undefined) => {
    if (!value) return;
    if (value.startsWith("--")) {
      const key = maps.tokenNameToVariableKey(value);
      if (key) { out.push({ op: "bindVariable", target: targetId, field, variableKey: key }); return; }
    }
    out.push({ op: "setFill", target: targetId, field, color: value });
  };
  // text nodes carry the foreground in `color`; elements carry bg in `fill`.
  emit("fill", style.characters !== undefined ? style.color : style.fill);
  if (style.stroke) emit("stroke", style.stroke.color);
  return out;
}

export function planFigmaOps(slj: SljDocument, maps: PlannerMaps): FigmaPlan {
  const ops: FigmaOp[] = [];
  let counter = 0;
  const nextId = () => `n${counter++}`;

  function walk(node: SljNode, parent: string | null): string {
    if (isComponentNode(node)) return walkComponent(node, parent);
    return walkElement(node, parent);
  }

  function walkElement(node: ElementNode, parent: string | null): string {
    const id = nextId();
    ops.push({ op: "createFrame", id, parent, layout: node.layout, box: node.box });
    if (node.tag === "text" && node.style.characters !== undefined) {
      ops.push({ op: "setText", target: id, textNodeHint: { strategy: "lowest-depth" }, characters: node.style.characters });
    }
    for (const c of colorOps(maps, id, node.style)) ops.push(c);
    for (const child of node.children) walk(child, id);
    return id;
  }

  function walkComponent(node: ComponentNode, parent: string | null): string {
    const mapping = maps.findComponentMapping(node.component);
    if (mapping && mapping.status === "mapped" && mapping.figma) {
      const id = nextId();
      const variant: Record<string, string> = {};
      for (const axis of mapping.variants) {
        const raw = node.props[axis.prop];
        if (typeof raw === "string" && axis.valueMap[raw]) variant[axis.figmaProp] = axis.valueMap[raw];
      }
      const instOp: FigmaOp = { op: "createInstance", id, parent: parent ?? "", componentKey: mapping.figma.componentSetKey };
      if (Object.keys(variant).length > 0) (instOp as { variant?: Record<string,string> }).variant = variant;
      ops.push(instOp);
      // text override: the first text descendant's characters, via the entry's hint
      if (mapping.textNode) {
        const chars = firstText(node);
        if (chars !== null) ops.push({ op: "setText", target: id, textNodeHint: mapping.textNode, characters: chars });
      }
      return id;
    }
    // ambiguous / unmapped → styled fallback frame + recurse children
    const id = nextId();
    ops.push({ op: "createFrame", id, parent, layout: node.layout, box: node.box });
    for (const child of node.children) walk(child, id);
    return id;
  }

  function firstText(node: SljNode): string | null {
    if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) return node.style.characters;
    for (const c of node.children) { const r = firstText(c); if (r !== null) return r; }
    return null;
  }

  const rootId = walk(slj.root, null);
  return { rootId, ops };
}
```

NOTE on `createInstance.parent`: the root may be a component node, in which case
its `parent` is `null` but the op type requires a string. The planner sets
`parent ?? ""` and the executor treats `""` (and `null`) as "append to the export
root". The createFrame root op uses `parent: null`. Tests assert behavior, not
this internal sentinel.

- [ ] **Step 4: Run → expect PASS (3 tests)**

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/planSlj.ts studio/__tests__/export/figma/planSlj.test.ts
git commit -m "feat(studio/export): SLJ planner — element frames, text, token/raw fills"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 3 [TDD]: Planner — mapped components + variant + fallback

**Files:**
- Modify: `studio/__tests__/export/figma/planSlj.test.ts` (append)
- (planSlj.ts already handles these from T2's implementation — these tests verify it)

- [ ] **Step 1: Append the failing tests**

```ts
// append to studio/__tests__/export/figma/planSlj.test.ts
describe("planFigmaOps — component nodes", () => {
  it("emits createInstance with the mapped key + variant valueMap applied", () => {
    const plan = planFigmaOps(doc({
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: { variant: "receiver" }, box, layout: null,
      children: [{ kind: "element", tag: "text", box, layout: null, style: { characters: "Hi" }, children: [] }],
    }), MAPS);
    const inst = plan.ops.find((o) => o.op === "createInstance");
    expect(inst).toMatchObject({ op: "createInstance", componentKey: "k-bubble", variant: { Type: "Receiver" } });
    // text override applied via the entry's textNode hint
    expect(plan.ops).toContainEqual(expect.objectContaining({ op: "setText", characters: "Hi" }));
  });

  it("does NOT set a variant when the prop value is not in the valueMap", () => {
    const plan = planFigmaOps(doc({
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: { variant: "nonsense" }, box, layout: null, children: [],
    }), MAPS);
    const inst = plan.ops.find((o) => o.op === "createInstance") as { variant?: object };
    expect(inst.variant).toBeUndefined();
  });

  it("degrades an unmapped component to a fallback frame and recurses children", () => {
    const plan = planFigmaOps(doc({
      kind: "component", component: "Unmapped", source: "arcade/components",
      props: {}, box, layout: { mode: "vertical", gap: 0, padding: [0,0,0,0], align: "start" },
      children: [{ kind: "component", component: "ChatBubble", source: "arcade/components", props: { variant: "receiver" }, box, layout: null, children: [] }],
    }), MAPS);
    // wrapper is a frame, not an instance
    expect(plan.ops[0]).toMatchObject({ op: "createFrame", parent: null });
    // the mapped child still becomes a real instance, parented to the fallback frame
    const inst = plan.ops.find((o) => o.op === "createInstance");
    expect(inst).toMatchObject({ componentKey: "k-bubble" });
    expect((inst as { parent: string }).parent).toBe((plan.ops[0] as { id: string }).id);
  });
});
```

- [ ] **Step 2: Run → expect PASS immediately** (T2's planSlj.ts already implements component handling).

Run: `pnpm run studio:test __tests__/export/figma/planSlj.test.ts`
Expected: PASS (T2's 3 + these 3 = 6). If any FAIL, fix planSlj.ts (not the test) — the spec'd behavior is: mapped→instance+variant+text-override; unmatched-prop→no variant; unmapped→fallback frame+recurse.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/export/figma/planSlj.test.ts studio/src/export/figma/planSlj.ts
git commit -m "feat(studio/export): planner component mapping — instance, variant, fallback"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 4 [TDD]: Planner — nesting order + topological invariant

**Files:**
- Modify: `studio/__tests__/export/figma/planSlj.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
// append to studio/__tests__/export/figma/planSlj.test.ts
describe("planFigmaOps — ordering invariants", () => {
  const nested = doc({
    kind: "element", tag: "div", box, layout: { mode: "vertical", gap: 0, padding: [0,0,0,0], align: "start" }, style: {},
    children: [
      { kind: "element", tag: "div", box, layout: null, style: {}, children: [
        { kind: "component", component: "ChatBubble", source: "arcade/components", props: { variant: "receiver" }, box, layout: null, children: [] },
      ]},
    ],
  });

  it("assigns unique synthetic ids", () => {
    const plan = planFigmaOps(nested, MAPS);
    const ids = plan.ops.filter((o) => o.op === "createFrame" || o.op === "createInstance").map((o) => (o as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("creates every parent before any op that targets it or its children (topological)", () => {
    const plan = planFigmaOps(nested, MAPS);
    const created = new Set<string>();
    for (const o of plan.ops) {
      if (o.op === "createFrame" || o.op === "createInstance") {
        if (o.parent !== null && o.parent !== "") {
          expect(created.has(o.parent), `parent ${o.parent} created before child ${o.id}`).toBe(true);
        }
        created.add(o.id);
      } else {
        expect(created.has(o.target), `target ${o.target} created before mutation`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run → expect PASS** (depth-first walk already yields topological order — parent pushed before recursing).

Run: `pnpm run studio:test __tests__/export/figma/planSlj.test.ts`
Expected: PASS (9 total). If the topological test FAILS, the walk order is wrong in planSlj.ts — parent's create-op must be pushed before walking its children (it is, in T2's impl). Fix impl, not test.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/export/figma/planSlj.test.ts
git commit -m "test(studio/export): planner nesting + topological-order invariants"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 5 [TDD]: Executor with a fake bridge

**Files:**
- Create: `studio/src/export/figma/executeFigmaOps.ts`
- Test: `studio/__tests__/export/figma/executeFigmaOps.test.ts`

The executor is the only Bridge-touching unit. It takes an injected `FigmaBridge`
so it's testable with a fake. The real bridge (figma-console MCP wrapper) is NOT
built here — the orchestrator wires it in Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/executeFigmaOps.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { executeFigmaOps, type FigmaBridge } from "../../../src/export/figma/executeFigmaOps";
import type { FigmaOp } from "../../../src/export/figma/ops";

// A fake bridge: records calls, returns deterministic node ids, counts imports.
function fakeBridge() {
  const calls: string[] = [];
  const imported: string[] = [];
  let nodeSeq = 0;
  const bridge: FigmaBridge = {
    async importComponent(key) { imported.push(key); return { ok: true }; },
    async importVariable(key) { imported.push("var:" + key); return { ok: true }; },
    async createFrame(parentRealId) { calls.push("createFrame"); return "real-" + nodeSeq++; },
    async createInstance(key, parentRealId, variant) { calls.push(`createInstance:${key}:${variant ? JSON.stringify(variant) : ""}`); return "real-" + nodeSeq++; },
    async setText(realId, hint, characters) { calls.push(`setText:${characters}`); },
    async bindVariable(realId, field, variableKey) { calls.push(`bindVariable:${field}:${variableKey}`); },
    async setFill(realId, field, color) { calls.push(`setFill:${field}:${color}`); },
  };
  return { bridge, calls, imported };
}

const ops: FigmaOp[] = [
  { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } },
  { op: "createInstance", id: "n1", parent: "n0", componentKey: "k-bubble", variant: { Type: "Receiver" } },
  { op: "createInstance", id: "n2", parent: "n0", componentKey: "k-bubble" }, // same key again
  { op: "setText", target: "n1", textNodeHint: { strategy: "lowest-depth" }, characters: "Hi" },
  { op: "bindVariable", target: "n1", field: "fill", variableKey: "var-x" },
];

describe("executeFigmaOps", () => {
  it("imports each distinct component key exactly once (dedup)", async () => {
    const { bridge, imported } = fakeBridge();
    await executeFigmaOps(ops, bridge);
    expect(imported.filter((k) => k === "k-bubble")).toHaveLength(1); // not 2
    expect(imported).toContain("var:var-x");
  });

  it("runs ops in order and maps synthetic ids to real ids for later ops", async () => {
    const { bridge, calls } = fakeBridge();
    const result = await executeFigmaOps(ops, bridge);
    expect(calls[0]).toBe("createFrame");
    expect(calls).toContain("createInstance:k-bubble:{\"Type\":\"Receiver\"}");
    expect(calls).toContain("setText:Hi");
    expect(calls).toContain("bindVariable:fill:var-x");
    expect(result.rootNodeId).toBe("real-0");
    expect(result.summary.instances).toBe(2);
    expect(result.summary.failures).toBe(0);
  });

  it("records a per-op error instead of throwing when a bridge call fails", async () => {
    const { bridge } = fakeBridge();
    const throwing: FigmaBridge = { ...bridge, async createInstance() { throw new Error("boom"); } };
    const result = await executeFigmaOps(ops, throwing);
    expect(result.summary.failures).toBeGreaterThan(0);
    expect(result.perOp.some((p) => !p.ok && /boom/.test(p.error ?? ""))).toBe(true);
    // a later op targeting the failed node is skipped, not crashed
    expect(result).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → confirm FAIL**

Run: `pnpm run studio:test __tests__/export/figma/executeFigmaOps.test.ts`
Expected: FAIL — cannot resolve `executeFigmaOps`.

- [ ] **Step 3: Implement**

```ts
// studio/src/export/figma/executeFigmaOps.ts
import type { FigmaOp } from "./ops";
import type { TextNodeHint } from "./types";

/** The Bridge surface the executor needs. The real implementation wraps the
 *  figma-console MCP; tests pass a fake. Each create* returns the real Figma
 *  node id. import* are idempotent at the Figma layer; the executor still
 *  dedupes to avoid redundant slow cross-file imports. */
export interface FigmaBridge {
  importComponent(key: string): Promise<{ ok: boolean; error?: string }>;
  importVariable(key: string): Promise<{ ok: boolean; error?: string }>;
  createFrame(parentRealId: string | null): Promise<string>;
  createInstance(componentKey: string, parentRealId: string | null, variant?: Record<string, string>): Promise<string>;
  setText(realId: string, hint: TextNodeHint, characters: string): Promise<void>;
  bindVariable(realId: string, field: "fill" | "stroke", variableKey: string): Promise<void>;
  setFill(realId: string, field: "fill" | "stroke", color: string): Promise<void>;
}

export type ExecResult = {
  rootNodeId: string | null;
  perOp: Array<{ op: string; ok: boolean; error?: string }>;
  summary: { instances: number; frames: number; boundVariables: number; failures: number };
};

export async function executeFigmaOps(ops: FigmaOp[], bridge: FigmaBridge): Promise<ExecResult> {
  // 1. Import distinct keys once.
  const compKeys = new Set<string>();
  const varKeys = new Set<string>();
  for (const o of ops) {
    if (o.op === "createInstance") compKeys.add(o.componentKey);
    if (o.op === "bindVariable") varKeys.add(o.variableKey);
  }
  const perOp: ExecResult["perOp"] = [];
  for (const k of compKeys) { try { await bridge.importComponent(k); } catch (e) { perOp.push({ op: "importComponent", ok: false, error: String((e as Error).message ?? e) }); } }
  for (const k of varKeys) { try { await bridge.importVariable(k); } catch (e) { perOp.push({ op: "importVariable", ok: false, error: String((e as Error).message ?? e) }); } }

  // 2. Execute in order, mapping synthetic id -> real node id.
  const real = new Map<string, string>();
  const summary = { instances: 0, frames: 0, boundVariables: 0, failures: 0 };
  let rootNodeId: string | null = null;

  const realParent = (p: string | null): string | null => (p && p !== "" ? real.get(p) ?? null : null);

  for (const o of ops) {
    try {
      if (o.op === "createFrame") {
        const rid = await bridge.createFrame(realParent(o.parent));
        real.set(o.id, rid); summary.frames++;
        if (rootNodeId === null) rootNodeId = rid;
      } else if (o.op === "createInstance") {
        const rid = await bridge.createInstance(o.componentKey, realParent(o.parent), o.variant);
        real.set(o.id, rid); summary.instances++;
        if (rootNodeId === null) rootNodeId = rid;
      } else if (o.op === "setText") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.setText(rid, o.textNodeHint, o.characters);
      } else if (o.op === "bindVariable") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.bindVariable(rid, o.field, o.variableKey); summary.boundVariables++;
      } else if (o.op === "setFill") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.setFill(rid, o.field, o.color);
      }
      perOp.push({ op: o.op, ok: true });
    } catch (e) {
      perOp.push({ op: o.op, ok: false, error: String((e as Error).message ?? e) });
      summary.failures++;
    }
  }

  return { rootNodeId, perOp, summary };
}
```

- [ ] **Step 4: Run → expect PASS (3 tests)**

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/executeFigmaOps.ts studio/__tests__/export/figma/executeFigmaOps.test.ts
git commit -m "feat(studio/export): Figma executor — import-once cache, id mapping, per-op error capture"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 6 [LIVE]: One rich frame, end-to-end over the Bridge

**Driver:** orchestrator (Claude), live via figma-console MCP. Not a subagent task.
**Files:** none committed as app code (a throwaway driver run); optionally a screenshot.

- [ ] **Step 1: Confirm Bridge + a target file**

`mcp__figma-console__figma_get_status` probe:true. The target file for OUTPUT can
be any Figma file with the Bridge running; the Arcade 0.3 library must be
reachable for component/variable import (it is — same file or subscribed).

- [ ] **Step 2: Get a rich frame's SLJ**

Use the build-a-computer-chat-screen frame that pulls real data (from Slice 0's
work), or re-export one via the #1 path. Read its saved `SLJ.json` from
`~/Library/Application Support/arcade-studio/projects/<slug>/frames/<frame>/SLJ.json`.
It must contain: ≥1 mapped component (ChatBubble), ≥1 element wrapper, a token
fill, and ideally an unmapped component (fallback). If none has all, hand-extend
a small SLJ to include an unmapped component node.

- [ ] **Step 3: Plan**

In a node/tsx scratch (or inline), import `planFigmaOps` + the real #2 maps
(`findComponentMapping` from componentMap, `buildTokenMap(figma-variables.json).tokenNameToVariableKey`),
run `planFigmaOps(slj, maps)`. Inspect the op list: confirm createInstance ops
carry real keys, bindVariable ops carry real variable keys, fallback frames for
unmapped.

- [ ] **Step 4: Execute via a live FigmaBridge**

Implement the real `FigmaBridge` inline as figma-console calls:
- `importComponent(key)` → async-kick `importComponentByKeyAsync` + poll globalThis (Slice 0 pattern).
- `importVariable(key)` → `importVariableByKeyAsync`, cache.
- `createFrame` → `figma_execute`: `figma.createFrame()` + layout props + appendChild.
- `createInstance` → cached component `.createInstance()` + `setProperties(variant)` + append.
- `setText` / `bindVariable` / `setFill` → the matching plugin calls.
Run `executeFigmaOps(plan.ops, liveBridge)`.

- [ ] **Step 5: Verify by screenshot**

`figma_capture_screenshot` of the created root frame. Confirm: real bubble
INSTANCES (not rectangles), the unmapped wrapper as a plain auto-layout frame,
≥1 fill bound to a variable (check via the node's boundVariables), nesting + text
correct. Record the `ExecResult.summary` (instances/frames/boundVariables/failures).

- [ ] **Step 6: Record the proven run**

Append the outcome (summary counts + screenshot note + any per-op failures like
Popover) to `studio/src/export/figma/CURATION-NOTES.md` or a short
`docs/superpowers/scratch/` note. Commit only if a committed artifact was produced.

---

## Task 7: Full-suite green + wrap

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: all pass (new ops/planner/executor tests + everything pre-existing; the
3 known pre-existing TS errors in `zoomSteps.ts`/`useProjectFromMirror.ts` are
unrelated and don't block tests).

- [ ] **Step 2: Confirm #3 "Done"**

- planner exhaustively unit-tested (element/component/fallback/nesting/token) — T2–T4.
- executor import-cache + id-mapping + per-op error tested with a fake bridge — T5.
- one rich multi-component frame round-tripped SLJ→Figma live, screenshot-verified — T6.

- [ ] **Step 3: Open the PR** (via superpowers:finishing-a-development-branch)

---

## Notes for the executor

- **Tests run from the repo ROOT:** `pnpm run studio:test <path>`.
- **T6 is orchestrator-only** — needs a live Bridge; a subagent cannot do it. Run inline.
- **Never `git add -A`** — stage explicit paths.
- **The planner is pure** — no figma-console import in planSlj.ts/ops.ts. Only
  the live driver (T6) and a future plugin touch a real bridge; executeFigmaOps
  stays bridge-agnostic via the injected `FigmaBridge`.
