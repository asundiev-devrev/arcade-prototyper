# Figma Export — Icon Capture & Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the real icon inside each IconButton/Button during the fiber walk, carry it through the manifest and swap plan, and set it on the Figma instance by swapping the IconButton's inner `Icons/*` child — so exported buttons show their real glyph (chevron, clock, send) instead of the default circular plus.

**Architecture:** The fiber walk prunes at a mapped primitive and already extracts its text; add a parallel scan that finds the first icon-mapped descendant and records its arcade-gen name on the `ComponentNode`. That `icon` flows through `flattenManifest` → `planSwap` (resolve to an `Icons/*` set key via the existing `iconMap`) → `executeSwap` (find the inner `Icons/*` child of the created instance, resolve the key to a LOCAL node, pick the Size-matched variant, `swapComponent`).

**Tech Stack:** TypeScript, Vitest (node env), existing `studio/src/export/figma/*` units (`swapOps`, `swapPlan`, `executeSwap`, `iconMap`/`iconEntries`), `studio/src/export/fiberWalk.ts` + `slj.ts`, figma-console Bridge for the live run.

---

## Background the engineer needs

- **The pipeline (already built, this plan extends it):** the fiber walk in
  `studio/src/lib/exportFrameToSlj.ts` produces an `SljDocument` (tree of `ComponentNode`
  / `ElementNode` from `studio/src/export/slj.ts`). `flattenManifest` (`swapOps.ts`) pulls
  the `ComponentNode`s into `ManifestComponent[]`. `planSwap` (`swapPlan.ts`) emits
  `SwapOp[]`. `executeSwap` (`executeSwap.ts`) applies them over a `SwapBridge`. All pure
  units have Vitest fixtures; the executor uses a fake bridge.

- **Where prune happens:** `studio/src/export/fiberWalk.ts`, `walkFiber`, the branch at
  lines ~73–85: when a fiber's name classifies as `"primitive"` or `"icon"`, it emits a
  `ComponentNode` and stops descending (carrying only a text child). This is where icon
  capture is added.

- **`WalkCtx`** (`fiberWalk.ts`) is the injected dependency bag: `{ reader, isComponent,
  resolveColor, isSkippable }`. We add `iconNameFor`. The live impl is wired in
  `exportFrameToSlj.ts` (the `ctx` object at ~line 84); tests pass a fake `ctx`.

- **`iconMap`** (`studio/src/export/figma/iconMap.ts`): `findIconMapping(name)` →
  `IconMapping | null`. `IconMapping = { arcadeGen, figma: { componentSetKey, setName } |
  null, sizeProp?, note }`. A mapped icon has non-null `figma`; ambiguous ones have
  `figma: null`. Entries live in `iconEntries.ts` (e.g. `ChevronLeftSmall` →
  `Icons/Chevron.left`).

- **Live-proven mechanism (do NOT redesign):** the 0.3 Icon Button's icon prop is a
  Figma **SLOT** (not settable via `setProperties`), but the created instance contains an
  `Icons/*` INSTANCE child. `iconChild.swapComponent(targetVariantComponent)` works.
  `importComponentByKeyAsync` FAILS for `Icons/*` keys (library drift) — the target must
  be resolved by **local node id**, then pick the variant COMPONENT (nearest `Size`,
  default 16), then `swapComponent`. This local resolution lives ONLY in the live
  `SwapBridge` impl (Task 6 is the contract; the live wiring is Task 7, the live run).

- **Run tests from repo root:** `pnpm run studio:test <path>` (single file). Node-env test
  files start with `// @vitest-environment node`.

- **fiberWalk test harness** (`studio/__tests__/export/fiberWalk.test.ts`) provides
  `comp(name, children, props)` and `host(tag, children, props)` fiber builders + a
  `WalkCtx` fake. Reuse them.

- **Branch:** `feat/figma-export-widen` (current). Commit there. Stage ONLY explicit
  paths; never `git add -A`/`.` (loose untracked screenshots + an unstaged
  `studio/CLAUDE.md` must NOT be committed).

---

## File Structure

- `studio/src/export/slj.ts` — `ComponentNode` gains optional `icon?: string`.
- `studio/src/export/fiberWalk.ts` — `WalkCtx` gains `iconNameFor`; prune branch sets `icon`.
- `studio/src/export/figma/swapOps.ts` — `ManifestComponent.icon?`; `flattenManifest` reads it; `SwapOp.replaceWithInstance.icon?`.
- `studio/src/export/figma/swapPlan.ts` — `SwapPlanMaps.findIconSetKey`; emit `icon` on the op.
- `studio/src/export/figma/executeSwap.ts` — `SwapBridge.setIconChild`; call it after create.
- `studio/src/lib/exportFrameToSlj.ts` — wire `iconNameFor` into the live `ctx` (Task 7, live).
- Tests alongside each.

---

## Task 1: `ComponentNode.icon` field

**Files:**
- Modify: `studio/src/export/slj.ts`
- Test: `studio/__tests__/export/slj-icon.test.ts` (new, a tiny type/shape guard)

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/slj-icon.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isComponentNode, type ComponentNode } from "../../src/export/slj";

describe("ComponentNode.icon", () => {
  it("accepts an optional icon (arcade-gen icon name)", () => {
    const n: ComponentNode = {
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 0, y: 0, width: 20, height: 20 }, layout: null,
      children: [], icon: "ChevronLeftSmall",
    };
    expect(isComponentNode(n)).toBe(true);
    expect(n.icon).toBe("ChevronLeftSmall");
  });

  it("allows omitting icon (non-icon components)", () => {
    const n: ComponentNode = {
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: {}, box: { x: 0, y: 0, width: 10, height: 10 }, layout: null, children: [],
    };
    expect(n.icon).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/slj-icon.test.ts`
Expected: FAIL — TS error, `icon` does not exist on `ComponentNode`.

- [ ] **Step 3: Add the field**

In `studio/src/export/slj.ts`, add `icon` to the `ComponentNode` interface (after `children`):

```ts
export interface ComponentNode {
  kind: "component";
  component: string;
  source: "arcade/components" | "arcade-prototypes";
  props: Record<string, unknown>;
  box: Box;
  layout: Layout | null;
  children: SljNode[];
  /** arcade-gen icon name of the glyph inside this component (e.g. an
   *  IconButton's "ChevronLeftSmall"), captured at prune time. Absent for
   *  components with no recognized icon. */
  icon?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/slj-icon.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/slj.ts studio/__tests__/export/slj-icon.test.ts
git commit -m "feat(studio/export): ComponentNode.icon field for captured glyph identity"
```

---

## Task 2: Capture icon at prune time in `fiberWalk`

**Files:**
- Modify: `studio/src/export/fiberWalk.ts`
- Test: `studio/__tests__/export/fiberWalk.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the existing file)**

Append a new `describe` block. Reuse the existing `comp`/`host` builders and `reader`.
Define a local `ctx` with the new `iconNameFor` member:

```ts
describe("walkFiber — icon capture at prune", () => {
  const iconCtx: WalkCtx = {
    reader,
    isComponent: (n) => (n === "IconButton" ? "primitive" : null),
    resolveColor: (v) => v,
    isSkippable: () => false,
    iconNameFor: (f) => {
      // fake: an IconButton fiber tagged with __icon returns that icon name
      return (f as any).__icon ?? null;
    },
  };

  it("records the icon name on a pruned primitive when iconNameFor returns one", () => {
    const inner = host("svg");
    const btn = comp("IconButton", [inner], { variant: "tertiary" });
    (btn as any).__icon = "ChevronLeftSmall";
    const node = walkFiber(btn, iconCtx);
    expect(node.kind).toBe("component");
    if (node.kind === "component") expect(node.icon).toBe("ChevronLeftSmall");
  });

  it("leaves icon undefined when iconNameFor returns null", () => {
    const btn = comp("IconButton", [host("svg")], {});
    const node = walkFiber(btn, iconCtx);
    if (node.kind === "component") expect(node.icon).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/fiberWalk.test.ts`
Expected: FAIL — TS error: `iconNameFor` not on `WalkCtx`; new tests fail.

- [ ] **Step 3: Add `iconNameFor` to `WalkCtx` and call it at prune**

In `studio/src/export/fiberWalk.ts`, add to the `WalkCtx` interface:

```ts
export interface WalkCtx {
  reader: FiberReader;
  isComponent: (name: string) => "primitive" | "icon" | "composite" | null;
  resolveColor: (value: string) => string;
  isSkippable: (name: string) => boolean;
  /** For a fiber being pruned as a mapped primitive, the arcade-gen name of the
   *  first icon-mapped descendant (e.g. "ChevronLeftSmall"), or null. Lets the
   *  walk record the glyph identity without un-pruning the subtree. */
  iconNameFor: (f: MinimalFiber) => string | null;
}
```

In the prune branch (where `cls === "primitive" || cls === "icon"`), capture the icon
and include it on the emitted node:

```ts
      if (cls === "primitive" || cls === "icon") {
        const box = ctx.reader.box(f);
        const text = ctx.reader.text(f);
        const children: SljNode[] = text
          ? [{ kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] }]
          : [];
        const icon = ctx.iconNameFor(f) ?? undefined;
        return { kind: "component", component: nm, source: "arcade/components", props: scalarProps(f.memoizedProps), box, layout: null, children, icon };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/fiberWalk.test.ts`
Expected: PASS — the new 2 tests + all pre-existing fiberWalk tests still pass.

Note: pre-existing fiberWalk tests construct `ctx` WITHOUT `iconNameFor`. Adding a required
member breaks them at the type level. To keep them green, update the SHARED `ctx` fixture
at the top of `fiberWalk.test.ts` to include `iconNameFor: () => null`. Do this in Step 3
(it's part of making the suite compile). Show the one-line addition:

```ts
const ctx: WalkCtx = {
  reader,
  isComponent: (n) => (n === "ChatBubble" ? "primitive" : n === "ComputerSidebar" ? "composite" : null),
  resolveColor: (v) => v,
  isSkippable: (n) => n === "MenuProvider" || n === "Root",
  iconNameFor: () => null,
};
```

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/fiberWalk.ts studio/__tests__/export/fiberWalk.test.ts
git commit -m "feat(studio/export): capture icon name at prune in fiberWalk"
```

---

## Task 3: `flattenManifest` surfaces `icon`

**Files:**
- Modify: `studio/src/export/figma/swapOps.ts`
- Test: `studio/__tests__/export/figma/swapOps.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("flattenManifest — icon", () => {
  it("carries the ComponentNode.icon onto the manifest entry", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "IconButton", source: "arcade/components",
        props: { variant: "tertiary" }, box: { x: 0, y: 0, width: 20, height: 20 },
        layout: null, children: [], icon: "ChevronLeftSmall",
      },
    };
    const m = flattenManifest(slj);
    expect(m).toHaveLength(1);
    expect(m[0].icon).toBe("ChevronLeftSmall");
  });

  it("leaves icon undefined when the node has none", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "ChatBubble", source: "arcade/components",
        props: {}, box: { x: 0, y: 0, width: 10, height: 10 }, layout: null, children: [],
      },
    };
    expect(flattenManifest(slj)[0].icon).toBeUndefined();
  });
});
```

(The file already imports `flattenManifest`, `SljDocument`. If `SljDocument` is not
imported there, add `import type { SljDocument } from "../../../src/export/slj";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapOps.test.ts`
Expected: FAIL — `m[0].icon` is undefined (field not on `ManifestComponent` / not read).

- [ ] **Step 3: Add `icon` to `ManifestComponent` and read it**

In `studio/src/export/figma/swapOps.ts`:

```ts
export interface ManifestComponent {
  component: string;
  box: Box;
  props: Record<string, unknown>;
  text: string | null;
  /** arcade-gen icon name of the glyph inside this component, if any. */
  icon?: string;
}
```

In `flattenManifest`, where it pushes the entry:

```ts
    if (isComponentNode(node)) {
      out.push({ component: node.component, box: node.box, props: node.props, text: firstText(node), icon: node.icon });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapOps.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/swapOps.ts studio/__tests__/export/figma/swapOps.test.ts
git commit -m "feat(studio/export): flattenManifest carries icon identity"
```

---

## Task 4: `SwapOp.replaceWithInstance.icon`

**Files:**
- Modify: `studio/src/export/figma/swapOps.ts`
- Test: `studio/__tests__/export/figma/swapOps.test.ts` (the type is exercised in Task 5's planner test; here just extend the type)

- [ ] **Step 1: Extend the op type**

In `studio/src/export/figma/swapOps.ts`, add `icon?` to the `replaceWithInstance` variant:

```ts
export type SwapOp =
  | {
      op: "replaceWithInstance";
      targetNodeId: string;
      componentSetKey: string;
      variant?: Record<string, string>;
      box: Box;
      parentNodeId: string;
      text?: { propName?: string; characters: string };
      binds?: { field: "fill" | "stroke"; variableKey: string }[];
      /** Set the instance's inner Icons/* child to this component-set key. */
      icon?: { setKey: string };
    }
  | {
      op: "injectInstances";
      containerNodeId: string;
      clearChildren: boolean;
      instances: Array<{
        componentSetKey: string;
        variant?: Record<string, string>;
        box: Box;
        text?: { propName?: string; characters: string };
      }>;
    };
```

- [ ] **Step 2: Run the existing swapOps tests (no behavior change yet)**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapOps.test.ts`
Expected: PASS (the added optional field breaks nothing).

- [ ] **Step 3: Commit**

```bash
git add studio/src/export/figma/swapOps.ts
git commit -m "feat(studio/export): replaceWithInstance op carries optional icon setKey"
```

---

## Task 5: `planSwap` resolves + emits the icon key

**Files:**
- Modify: `studio/src/export/figma/swapPlan.ts`
- Test: `studio/__tests__/export/figma/swapPlan.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the discrete `describe`)**

```ts
  it("emits icon.setKey on replaceWithInstance when the component has a mapped icon", () => {
    const iconButton: FigmaComponentMapping = {
      arcadeGen: "IconButton", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "ICON_BUTTON_KEY", setName: "Icon Button" }, variants: [], note: "",
    };
    const ibMaps: SwapPlanMaps = {
      findComponentMapping: (n) => (n === "IconButton" ? iconButton : null),
      tokenNameToVariableKey: () => null,
      findIconSetKey: (icon) => (icon === "ChevronLeftSmall" ? "ICONS_CHEVRON_LEFT" : null),
    };
    const manifest: ManifestComponent[] = [
      { component: "IconButton", box: { x: 201, y: 12, width: 20, height: 20 }, props: {}, text: null, icon: "ChevronLeftSmall" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("flatIB", "Button - Back", 201, 12, 20, 20, "chrome"),
      cap("chrome", "WindowChrome", 0, 0, 255, 44, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, ibMaps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "replaceWithInstance", icon: { setKey: "ICONS_CHEVRON_LEFT" } });
  });

  it("omits icon when the icon is unmapped (findIconSetKey returns null)", () => {
    const iconButton: FigmaComponentMapping = {
      arcadeGen: "IconButton", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "ICON_BUTTON_KEY", setName: "Icon Button" }, variants: [], note: "",
    };
    const ibMaps: SwapPlanMaps = {
      findComponentMapping: (n) => (n === "IconButton" ? iconButton : null),
      tokenNameToVariableKey: () => null,
      findIconSetKey: () => null,
    };
    const manifest: ManifestComponent[] = [
      { component: "IconButton", box: { x: 201, y: 12, width: 20, height: 20 }, props: {}, text: null, icon: "DotInLeftWindow" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("flatIB", "Button", 201, 12, 20, 20, "chrome"),
      cap("chrome", "WindowChrome", 0, 0, 255, 44, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, ibMaps) as any[];
    expect(ops).toHaveLength(1);
    expect(ops[0].icon).toBeUndefined();
  });
```

Note: every existing `SwapPlanMaps` literal in this test file (e.g. `maps`, `maps2`,
`ibMaps` from earlier tasks) must gain a `findIconSetKey` member to satisfy the type. Add
`findIconSetKey: () => null,` to each existing maps object in the file as part of Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: FAIL — `findIconSetKey` not on `SwapPlanMaps`; new tests fail.

- [ ] **Step 3: Add `findIconSetKey` to `SwapPlanMaps` and emit the icon**

In `studio/src/export/figma/swapPlan.ts`, extend the interface:

```ts
export interface SwapPlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
  /** arcade-gen icon name → Icons/* component-set key, or null if unmapped/ambiguous. */
  findIconSetKey: (arcadeGenIconName: string) => string | null;
}
```

In the discrete-region loop, build the icon payload and add it to the op:

```ts
  for (const comp of manifest) {
    if (TRANSCRIPT_COMPONENTS.has(comp.component)) continue;
    const mapping = maps.findComponentMapping(comp.component);
    if (!mapping || mapping.status !== "mapped" || !mapping.figma) continue;
    const candidates = captureNodes.filter((n) => !used.has(n.id));
    const match = matchByGeometry(comp.box, candidates);
    if (!match || match.parentId === null) continue;
    used.add(match.id);
    const iconSetKey = comp.icon ? maps.findIconSetKey(comp.icon) : null;
    const op: SwapOp = {
      op: "replaceWithInstance",
      targetNodeId: match.id,
      componentSetKey: mapping.figma.componentSetKey,
      variant: resolveVariant(mapping, comp.props),
      box: { x: match.x, y: match.y, width: match.width, height: match.height },
      parentNodeId: match.parentId,
      text: textPayload(mapping, comp.text),
    };
    if (iconSetKey) (op as Extract<SwapOp, { op: "replaceWithInstance" }>).icon = { setKey: iconSetKey };
    ops.push(op);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/swapPlan.ts studio/__tests__/export/figma/swapPlan.test.ts
git commit -m "feat(studio/export): planSwap resolves + emits icon setKey"
```

---

## Task 6: `executeSwap` sets the icon child

**Files:**
- Modify: `studio/src/export/figma/executeSwap.ts`
- Test: `studio/__tests__/export/figma/executeSwap.test.ts` (append + extend fake bridge)

- [ ] **Step 1: Write the failing test (append)**

The existing `makeBridge` (from Task 6 of the prior plan) builds a fake `SwapBridge` and
records calls. Add `setIconChild` to it and a new test:

```ts
  it("replaceWithInstance with icon: calls setIconChild after create/position", async () => {
    const ops: SwapOp[] = [{
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "IB", parentNodeId: "side",
      box: { x: 201, y: 12, width: 20, height: 20 }, icon: { setKey: "ICONS_CHEVRON_LEFT" },
    }];
    const { bridge, calls } = makeBridge();
    const r = await executeSwap(ops, bridge);
    expect(calls).toContain("icon:inst-0:ICONS_CHEVRON_LEFT");
    // ordering: icon set after the instance is created
    expect(calls.indexOf("icon:inst-0:ICONS_CHEVRON_LEFT")).toBeGreaterThan(calls.indexOf("createInstance:IB->side:"));
    expect(r.summary.replaced).toBe(1);
    expect(r.summary.failures).toBe(0);
  });

  it("does not call setIconChild when the op has no icon", async () => {
    const ops: SwapOp[] = [{
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "IB", parentNodeId: "side",
      box: { x: 0, y: 0, width: 1, height: 1 },
    }];
    const { bridge, calls } = makeBridge();
    await executeSwap(ops, bridge);
    expect(calls.some((c) => c.startsWith("icon:"))).toBe(false);
  });

  it("a failing setIconChild is caught; instance still counts as replaced", async () => {
    const ops: SwapOp[] = [{
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "IB", parentNodeId: "side",
      box: { x: 0, y: 0, width: 1, height: 1 }, icon: { setKey: "BAD" },
    }];
    const { bridge } = makeBridge({ async setIconChild() { throw new Error("no icon child"); } });
    const r = await executeSwap(ops, bridge);
    expect(r.summary.replaced).toBe(1);   // icon failure must NOT fail the whole op
    expect(r.summary.failures).toBe(0);
  });
```

Add `setIconChild` to the fake `makeBridge` base (in the same file):

```ts
    async setIconChild(id, iconSetKey) { calls.push(`icon:${id}:${iconSetKey}`); },
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/executeSwap.test.ts`
Expected: FAIL — `setIconChild` not on `SwapBridge`; new tests fail.

- [ ] **Step 3: Add `setIconChild` to `SwapBridge` and call it (best-effort)**

In `studio/src/export/figma/executeSwap.ts`, add to the interface:

```ts
export interface SwapBridge {
  createInstance(componentSetKey: string, parentNodeId: string, variant?: Record<string, string>): Promise<string>;
  positionNode(nodeId: string, box: Box): Promise<void>;
  setInstanceText(nodeId: string, propName: string | undefined, characters: string): Promise<void>;
  bindVariable(nodeId: string, field: "fill" | "stroke", variableKey: string): Promise<void>;
  /** Swap the instance's inner Icons/* child to the given Icons/* component-set key. */
  setIconChild(nodeId: string, iconSetKey: string): Promise<void>;
  clearChildren(nodeId: string): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
}
```

In the `replaceWithInstance` branch, after text/binds and BEFORE `removeNode`, set the
icon best-effort (an icon failure must not abort the swap — wrap it so it can't throw out
of the op):

```ts
      if (op.op === "replaceWithInstance") {
        const id = await bridge.createInstance(op.componentSetKey, op.parentNodeId, op.variant);
        await bridge.positionNode(id, op.box);
        if (op.text) await bridge.setInstanceText(id, op.text.propName, op.text.characters);
        for (const b of op.binds ?? []) await bridge.bindVariable(id, b.field, b.variableKey);
        if (op.icon) {
          try { await bridge.setIconChild(id, op.icon.setKey); }
          catch (e) { perOp.push({ op: "setIconChild", ok: false, error: String((e as Error).message ?? e) }); }
        }
        await bridge.removeNode(op.targetNodeId);
        summary.replaced++;
        perOp.push({ op: op.op, ok: true });
      }
```

(The icon failure is recorded in `perOp` but does NOT increment `summary.failures` nor
abort the op — the instance is real, it just keeps its default glyph.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/executeSwap.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/executeSwap.ts studio/__tests__/export/figma/executeSwap.test.ts
git commit -m "feat(studio/export): executeSwap sets icon child (best-effort)"
```

---

## Task 7: Wire `iconNameFor` + `findIconSetKey` into the live export, then live run

**Files:**
- Modify: `studio/src/lib/exportFrameToSlj.ts` (wire `iconNameFor` into `ctx`)
- Test: full suite green; the icon behavior itself is proven by the live run (no unit test
  for the live wiring — it reaches the fiber/Bridge).

- [ ] **Step 1: Wire `iconNameFor` into the live `ctx`**

In `studio/src/lib/exportFrameToSlj.ts`, the `ctx: WalkCtx` object (~line 84) needs the
new member. Add an `iconNameFor` that scans the fiber subtree for the first
`findIconMapping`-resolvable component name. Add near the top of the function (after the
existing imports are already present: `findIconMapping`, `fiberName`):

```ts
  // For a pruned primitive, find the arcade-gen name of the first icon-mapped
  // descendant fiber (the glyph inside an IconButton/Button). Bounded BFS so a
  // deep subtree can't stall the walk.
  const iconNameFor = (f: MinimalFiber): string | null => {
    const queue: (MinimalFiber | null)[] = [f.child];
    let guard = 0;
    while (queue.length && guard++ < 200) {
      const n = queue.shift();
      if (!n) continue;
      const name = fiberName(n);
      if (name && findIconMapping(name)) return name;
      if (n.child) queue.push(n.child);
      if (n.sibling) queue.push(n.sibling);
    }
    return null;
  };
```

Add it to the `ctx` object:

```ts
  const ctx: WalkCtx = {
    reader,
    isComponent: (name) => {
      if (findIconMapping(name)) return "icon";
      const m = findComponentMapping(name);
      if (m && m.status === "mapped") return "primitive";
      return "composite";
    },
    resolveColor: (value) => resolveToken(tokenIndex, value),
    isSkippable: (name) => SKIPPABLE.has(name),
    iconNameFor,
  };
```

Confirm `fiberName` is imported in this file (it imports from `../export/fiberTypes` —
add `fiberName` to that import if not already present). `findIconMapping` is already
imported.

- [ ] **Step 2: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS — all green, the new icon tests included, no type errors from the `ctx`
wiring.

- [ ] **Step 3: Commit the wiring**

```bash
git add studio/src/lib/exportFrameToSlj.ts
git commit -m "feat(studio/export): wire iconNameFor into the live fiber-walk ctx"
```

- [ ] **Step 4: Live run — capture icon keys + swap**

This is the visual proof, agent-driven over the Bridge (not an automated test):

1. Ensure the kit `dist` is built (`pnpm exec tsx studio/prototype-kit/scripts/build-package.mts`)
   and the dev server is running; load the populated Computer-with-panel frame.
2. Export the live SLJ via `exportFrameToSlj` — confirm IconButton/Button `ComponentNode`s
   now carry `icon` (e.g. `ChevronLeftSmall`, `Clock`, `ArrowUpSmall`, `HumanSilhouetteWithPlus`).
3. Build the manifest + `buildSwapOps` with `maps = { findComponentMapping, tokenNameToVariableKey,
   findIconSetKey: (n) => findIconMapping(n)?.figma?.componentSetKey ?? null }`. Confirm the
   `replaceWithInstance` ops for icon-buttons carry `icon.setKey`.
4. In the live `figma_execute` swap script, implement `setIconChild(instanceId, iconSetKey)`:
   - find the inner `Icons/*` INSTANCE child of the created instance (`findOne(n => n.type
     === "INSTANCE" && /Icons\//.test(n.name))`);
   - resolve `iconSetKey` → LOCAL node id (a key→localNodeId map, captured by searching the
     Icons page / `figma_search_components` per icon — `importComponentByKeyAsync` FAILS,
     do NOT use it);
   - from the local `Icons/*` set, pick the variant COMPONENT whose `Size` is nearest the
     icon child's rendered width (default `16`);
   - `iconChild.swapComponent(targetVariant)`. Catch + log per icon.
5. Run on a fresh clone of the capture; **screenshot**.

- [ ] **Step 5: Verify + record**

Expected: IconButtons show real glyphs — chevron-left/right on the nav arrows, clock on
history, send arrow on the input, add-collaborator in the header, the New Chat plus —
instead of the default circular plus. Icons not in `iconMap` keep the default (no
regression). Update the spec's "Done =" with the observed icon-swap count + any `iconEntries`
keys that needed re-confirming (library drift). Commit any `iconEntries.ts` key fixes
separately:

```bash
git add studio/src/export/figma/iconEntries.ts
git commit -m "fix(studio/export): re-confirm Icons/* keys surfaced by the live icon swap"
```

---

## Task 8: Update the PR

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: all pass.

- [ ] **Step 2: Push + update PR #11**

```bash
git push origin feat/figma-export-widen
```
Update the PR body: icons now captured + swapped (IconButtons show real glyphs); note the
live-run screenshot result and the icon-swap count. Move "wrong icons" from the
follow-ups list to done.

---

## Self-review notes

- **Spec coverage:** ComponentNode.icon (T1) ✓; capture in walk via iconNameFor (T2) ✓;
  manifest carries it (T3) ✓; op carries setKey (T4) ✓; planner resolves via findIconSetKey
  (T5) ✓; executor setIconChild best-effort (T6) ✓; live wiring + local-node resolve +
  swapComponent + screenshot (T7) ✓; degrade-on-unmapped (T5 omit + T6 catch) ✓.
- **Type consistency across tasks:** `icon?: string` (slj.ts → ManifestComponent identical);
  `icon?: { setKey: string }` on the op (T4) consumed by executor (T6) + emitted by planner
  (T5); `iconNameFor(f: MinimalFiber): string | null` (T2 WalkCtx) wired in T7;
  `findIconSetKey(name): string | null` (T5 SwapPlanMaps) wired in T7; `setIconChild(nodeId,
  iconSetKey)` (T6 SwapBridge) implemented live in T7.
- **Carried-over test maintenance:** adding a required `WalkCtx.iconNameFor` (T2) and
  `SwapPlanMaps.findIconSetKey` (T5) forces updating existing fixture literals in those
  test files — called out explicitly in T2 Step 3 and T5 Step 1 so the suites stay green.
- **Risk (from spec):** stale `Icons/*` keys (library drift) — handled by local-node
  resolution in T7 + best-effort catch in T6; re-confirm keys during the live run (T7 Step 5).
