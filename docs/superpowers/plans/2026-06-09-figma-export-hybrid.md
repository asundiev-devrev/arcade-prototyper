# Figma Export — Hybrid (capture layout + swap components) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace recognized flat frames in an HTML→Figma capture with real Arcade 0.3 component instances, using our existing fiber-walk manifest — so the export gets the converter's faithful layout AND our real design-system components.

**Architecture:** A pure planner (`swapPlan`) takes our component manifest (flattened from the SLJ the fiber walk already produces) plus a normalized read of the captured Figma tree (`captureTree`), and emits `SwapOp[]`. Discrete components match the capture by geometry (`geometryMatch`); the chat transcript is special-cased (discard the converter's flat bubbles, inject our ChatBubble instances). An effectful executor (`executeSwap`) applies the ops over the figma-console Bridge using the proven local-node instancing workaround.

**Tech Stack:** TypeScript, Vitest (node environment), the existing `studio/src/export/figma/*` units (`slj.ts`, `componentMap.ts`, `tokenMap.ts`, `types.ts`), figma-console MCP Bridge for live execution.

---

## Background the engineer needs

- **The SLJ is our manifest source.** `studio/src/lib/exportFrameToSlj.ts` already walks the live React fiber and produces an `SljDocument` (`studio/src/export/slj.ts`): a tree of `ComponentNode` (`{kind:"component", component, props, box, layout, children}`) and `ElementNode`. Every recognized 0.3 primitive is a `ComponentNode` carrying its name, frame-relative `box`, props, and (under its children) a text element. We do NOT change the fiber walk. We flatten its `ComponentNode`s into a manifest the swap consumes.

- **`Box`** is `{x, y, width, height}` (frame-relative px), defined in `studio/src/export/slj.ts`. Reuse it everywhere — do not invent a new box type.

- **Component mapping** lives in `studio/src/export/figma/componentMap.ts`: `findComponentMapping(name)` → `FigmaComponentMapping | null` (`studio/src/export/figma/types.ts`). A mapped entry has `status:"mapped"`, `figma:{componentSetKey, setName}`, `variants: VariantAxis[]`, optional `textNode: TextNodeHint`. `ComputerSidebar.Item` maps to "Chat Item" (key `ab11c00fafe90d430bc8dc9532da2d358012c7c9`) with `textNode:{strategy:"by-name", name:"Item name#8536:0"}`. `ChatBubble` maps to "Bubble" (key `edd2821db8a05b808da334a1c6aed7646d23e82e`), variant axis `variant`→`Type` `{receiver:"Receiver", sender:"Sender"}`.

- **Token mapping** lives in `studio/src/export/figma/tokenMap.ts`: `buildTokenMap(snapshot.variables).tokenNameToVariableKey(cssName)` → variable key or null. The snapshot is `studio/src/export/figma/figma-variables.json` (`{variables: VariableSnapshotEntry[]}`).

- **The proven executor patterns** (from `studio/src/export/figma/executeFigmaOps.ts`, the unit being retired): instance-from-local-node (resolve a component-set key → local node id, pick the variant child, `.createInstance()`) because `importComponentByKeyAsync` hangs cross-file; in-file `importVariableByKeyAsync` is fast (~12ms) and `figma.variables.setBoundVariableForPaint` binds it. These move into `executeSwap`.

- **Test pattern for effectful exec:** see `studio/__tests__/export/figma/executeFigmaOps.test.ts` — a `fakeBridge()` records calls; assert op→call mapping. Mirror it for `executeSwap`.

- **Run tests from the repo root:** `pnpm run studio:test <path>` for one file (fast), `pnpm run studio:test` for all (~90s). Node-environment test files start with `// @vitest-environment node`.

- **Spike fixture data** (real, from capture node `9281:2584` measured against our v2 manifest, frame-relative boxes):
  - Sidebar row: ours `ComputerSidebar.Item (8,148,239,36)` → capture frame `(8,148,239,36)` (boxError 0).
  - New Chat: ours `Button (12,58,112,28)` → capture `FrameLink (12,58,113,28)` (error 1).
  - History: ours `IconButton (132,52,40,40)` → capture `(133,52,40,40)` (error 2).
  - Bubble: ours `ChatBubble (272,64,400,409)` → nearest capture `Container (272,150,400,590)` (error 353 — must NOT match; routes to transcript injection).
  - Transcript container region box: `(256,48,1200,832)`.

---

## File Structure

- `studio/src/export/figma/swapOps.ts` — `SwapOp` union type + `ManifestComponent` type + `flattenManifest(slj)` helper. The shared contract.
- `studio/src/export/figma/captureTree.ts` — `readCaptureTree(bridge, nodeId)` → `CaptureNode[]` (normalized, frame-relative boxes). The one Bridge-read unit.
- `studio/src/export/figma/geometryMatch.ts` — pure `matchByGeometry(target, candidates, opts)` → best `CaptureNode | null`. Edge-distance score + area filter + threshold + ambiguity guard.
- `studio/src/export/figma/swapPlan.ts` — pure `planSwap(manifest, captureNodes, regions)` → `SwapOp[]`. Region splitter + calls `geometryMatch`.
- `studio/src/export/figma/executeSwap.ts` — effectful `executeSwap(ops, bridge)` → `SwapResult`. Local-node instancing, set property, bind variable, inject/remove.
- Tests: `studio/__tests__/export/figma/{swapOps,geometryMatch,swapPlan,executeSwap}.test.ts`.

Deletion of the dead layout code (`planSlj` frame emission, `executeFigmaOps` createFrame path) is deferred to the LAST task so the existing tests keep passing while the new units are built.

---

## Task 1: SwapOp contract + manifest flattening

**Files:**
- Create: `studio/src/export/figma/swapOps.ts`
- Test: `studio/__tests__/export/figma/swapOps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/swapOps.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { flattenManifest, type ManifestComponent } from "../../../src/export/figma/swapOps";
import type { SljDocument } from "../../../src/export/slj";

const slj: SljDocument = {
  slj: 1,
  frame: { slug: "f", project: "p", width: 1280, mode: "light" },
  root: {
    kind: "element", tag: "div", box: { x: 0, y: 0, width: 1280, height: 631 },
    layout: null, style: {}, children: [
      {
        kind: "component", component: "ComputerSidebar.Item", source: "arcade-prototypes",
        props: {}, box: { x: 8, y: 148, width: 239, height: 36 }, layout: null,
        children: [{ kind: "element", tag: "text", box: { x: 8, y: 148, width: 200, height: 16 }, layout: null, style: { characters: "Remove council reference" }, children: [] }],
      },
      {
        kind: "component", component: "ChatBubble", source: "arcade/components",
        props: { variant: "receiver" }, box: { x: 272, y: 64, width: 400, height: 409 }, layout: null,
        children: [{ kind: "element", tag: "text", box: { x: 272, y: 64, width: 380, height: 380 }, layout: null, style: { characters: "Hello there" }, children: [] }],
      },
    ],
  },
};

describe("flattenManifest", () => {
  it("flattens every ComponentNode with name, box, props, and first text", () => {
    const m = flattenManifest(slj);
    expect(m).toHaveLength(2);
    const item = m.find((c) => c.component === "ComputerSidebar.Item")!;
    expect(item.box).toEqual({ x: 8, y: 148, width: 239, height: 36 });
    expect(item.text).toBe("Remove council reference");
    const bubble = m.find((c) => c.component === "ChatBubble")!;
    expect(bubble.props.variant).toBe("receiver");
    expect(bubble.text).toBe("Hello there");
  });

  it("does NOT descend into a component's children for more components (prune-with-text already applied upstream)", () => {
    // A component node whose subtree contains another component name should still
    // only surface the top component (the fiber walk already pruned internals).
    const nested: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "ChatBubble", source: "arcade/components", props: {},
        box: { x: 0, y: 0, width: 10, height: 10 }, layout: null,
        children: [{ kind: "component", component: "Button", source: "arcade/components", props: {}, box: { x: 1, y: 1, width: 2, height: 2 }, layout: null, children: [] }],
      },
    };
    const m = flattenManifest(nested);
    expect(m.map((c) => c.component)).toEqual(["ChatBubble"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapOps.test.ts`
Expected: FAIL — `flattenManifest` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/swapOps.ts
import type { Box, SljDocument, SljNode } from "../slj";
import { isComponentNode } from "../slj";

/** A recognized component pulled out of the SLJ for the swap to place. */
export interface ManifestComponent {
  component: string;                 // e.g. "ComputerSidebar.Item", "ChatBubble"
  box: Box;                          // frame-relative
  props: Record<string, unknown>;
  text: string | null;              // first visible text under the component, or null
}

/** First visible text anywhere under a node (depth-first). */
function firstText(node: SljNode): string | null {
  if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) {
    return node.style.characters;
  }
  for (const c of node.children) {
    const t = firstText(c);
    if (t !== null) return t;
  }
  return null;
}

/** Flatten the SLJ into the list of recognized components. Stops at each
 *  component (does NOT descend past it — the fiber walk already pruned a
 *  mapped primitive's internals, so a component's subtree is only its text). */
export function flattenManifest(slj: SljDocument): ManifestComponent[] {
  const out: ManifestComponent[] = [];
  function walk(node: SljNode): void {
    if (isComponentNode(node)) {
      out.push({ component: node.component, box: node.box, props: node.props, text: firstText(node) });
      return; // do not descend into a component's children
    }
    for (const c of node.children) walk(c);
  }
  walk(slj.root);
  return out;
}

/** Ops the swap planner emits; executeSwap applies them over the Bridge. */
export type SwapOp =
  | {
      op: "replaceWithInstance";
      targetNodeId: string;            // the captured flat frame to replace
      componentSetKey: string;
      variant?: Record<string, string>;
      box: Box;                        // frame-relative target box
      parentNodeId: string;            // captured parent to attach under
      text?: { propName?: string; characters: string };
      binds?: { field: "fill" | "stroke"; variableKey: string }[];
    }
  | {
      op: "injectInstances";
      containerNodeId: string;         // captured transcript container
      clearChildren: boolean;
      instances: Array<{
        componentSetKey: string;
        variant?: Record<string, string>;
        box: Box;                      // relative to the container
        text?: { propName?: string; characters: string };
      }>;
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapOps.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/swapOps.ts studio/__tests__/export/figma/swapOps.test.ts
git commit -m "feat(studio/export): SwapOp contract + manifest flattening"
```

---

## Task 2: Geometry matcher

**Files:**
- Create: `studio/src/export/figma/geometryMatch.ts`
- Test: `studio/__tests__/export/figma/geometryMatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/geometryMatch.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { matchByGeometry, type Rect } from "../../../src/export/figma/geometryMatch";

const cand = (id: string, x: number, y: number, w: number, h: number): Rect & { id: string } =>
  ({ id, x, y, width: w, height: h });

describe("matchByGeometry", () => {
  it("matches an exact box (score 0)", () => {
    const target = { x: 8, y: 148, width: 239, height: 36 };
    const cands = [cand("a", 8, 148, 239, 36), cand("b", 0, 0, 100, 100)];
    expect(matchByGeometry(target, cands)?.id).toBe("a");
  });

  it("matches within the 8px threshold", () => {
    const target = { x: 132, y: 52, width: 40, height: 40 };
    const cands = [cand("hist", 133, 52, 40, 40)];   // edge-distance sum = 2
    expect(matchByGeometry(target, cands)?.id).toBe("hist");
  });

  it("rejects when best score is over threshold (the bubble case)", () => {
    const target = { x: 272, y: 64, width: 400, height: 409 };
    const cands = [cand("container", 272, 150, 400, 590)]; // huge edge distance
    expect(matchByGeometry(target, cands)).toBeNull();
  });

  it("rejects an area-mismatched candidate even if positioned nearby", () => {
    const target = { x: 100, y: 100, width: 400, height: 400 };
    const cands = [cand("dot", 100, 100, 12, 12)]; // area far outside ±25%
    expect(matchByGeometry(target, cands)).toBeNull();
  });

  it("rejects on ambiguity (two candidates within the gap)", () => {
    const target = { x: 10, y: 10, width: 100, height: 100 };
    const cands = [cand("x", 10, 10, 100, 100), cand("y", 11, 10, 100, 100)]; // scores 0 and 2, gap < 4
    expect(matchByGeometry(target, cands)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/geometryMatch.test.ts`
Expected: FAIL — `matchByGeometry` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/geometryMatch.ts
export interface Rect { x: number; y: number; width: number; height: number; }

export interface MatchOpts {
  /** Max accepted edge-distance sum (|Δleft|+|Δright|+|Δtop|+|Δbottom|). */
  threshold: number;
  /** Best must beat the next-best by at least this much, else ambiguous → reject. */
  ambiguityGap: number;
  /** Candidate area must be within ±areaTol of target area (0.25 = ±25%). */
  areaTol: number;
}

export const DEFAULT_MATCH_OPTS: MatchOpts = { threshold: 8, ambiguityGap: 4, areaTol: 0.25 };

function edgeScore(a: Rect, b: Rect): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs((a.x + a.width) - (b.x + b.width)) +
    Math.abs(a.y - b.y) +
    Math.abs((a.y + a.height) - (b.y + b.height))
  );
}

/** Pick the candidate whose box best matches `target`, or null when no candidate
 *  is within threshold, the best is area-mismatched, or the match is ambiguous. */
export function matchByGeometry<T extends Rect>(
  target: Rect,
  candidates: T[],
  opts: MatchOpts = DEFAULT_MATCH_OPTS,
): T | null {
  const targetArea = target.width * target.height;
  const scored = candidates
    .filter((c) => c.width > 0 && c.height > 0)
    .filter((c) => {
      const area = c.width * c.height;
      return area >= targetArea * (1 - opts.areaTol) && area <= targetArea * (1 + opts.areaTol);
    })
    .map((c) => ({ c, score: edgeScore(target, c) }))
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;
  const best = scored[0];
  if (best.score > opts.threshold) return null;
  if (scored.length > 1 && scored[1].score - best.score < opts.ambiguityGap) return null;
  return best.c;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/geometryMatch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/geometryMatch.ts studio/__tests__/export/figma/geometryMatch.test.ts
git commit -m "feat(studio/export): geometry matcher (edge-distance + area + ambiguity)"
```

---

## Task 3: Capture tree reader

**Files:**
- Create: `studio/src/export/figma/captureTree.ts`
- Test: `studio/__tests__/export/figma/captureTree.test.ts`

The reader is thin (one Bridge call returning a node subtree, flattened to frame-relative boxes). It takes a `CaptureBridge` interface so it is testable with a fake.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/captureTree.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readCaptureTree, type CaptureBridge, type RawCaptureNode } from "../../../src/export/figma/captureTree";

// Fake raw tree as the Bridge would return it (absolute coords).
const raw: RawCaptureNode = {
  id: "1:0", name: "Frame", type: "FRAME", absX: 100, absY: 200, width: 1280, height: 631,
  children: [
    { id: "1:1", name: "Root", type: "FRAME", absX: 100, absY: 200, width: 256, height: 631, children: [
      { id: "1:2", name: "FrameLink", type: "FRAME", absX: 112, absY: 258, width: 113, height: 28, children: [] },
    ] },
  ],
};

const fakeBridge: CaptureBridge = { async getSubtree() { return raw; } };

describe("readCaptureTree", () => {
  it("flattens to frame-relative boxes with parent ids", async () => {
    const nodes = await readCaptureTree(fakeBridge, "1:0");
    const link = nodes.find((n) => n.name === "FrameLink")!;
    expect(link.x).toBe(12);   // 112 - 100
    expect(link.y).toBe(58);   // 258 - 200
    expect(link.width).toBe(113);
    expect(link.parentId).toBe("1:1");
    // root frame itself is included at (0,0)
    const rootFrame = nodes.find((n) => n.id === "1:0")!;
    expect(rootFrame.x).toBe(0);
    expect(rootFrame.parentId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/captureTree.test.ts`
Expected: FAIL — `readCaptureTree` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/captureTree.ts

/** Raw node shape as fetched from the Bridge (absolute canvas coords). */
export interface RawCaptureNode {
  id: string;
  name: string;
  type: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  children: RawCaptureNode[];
}

/** A normalized capture node: frame-relative box + parent reference. */
export interface CaptureNode {
  id: string;
  name: string;
  type: string;
  x: number;       // relative to the capture root frame
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

/** Bridge seam: returns the raw subtree (with absolute coords) for a node id.
 *  The live impl runs a figma_execute that walks the node and reports
 *  absoluteBoundingBox; tests pass a fake. */
export interface CaptureBridge {
  getSubtree(nodeId: string): Promise<RawCaptureNode>;
}

/** Read a captured Figma node into a flat, frame-relative CaptureNode list. */
export async function readCaptureTree(bridge: CaptureBridge, rootNodeId: string): Promise<CaptureNode[]> {
  const root = await bridge.getSubtree(rootNodeId);
  const originX = root.absX;
  const originY = root.absY;
  const out: CaptureNode[] = [];
  function walk(n: RawCaptureNode, parentId: string | null): void {
    out.push({
      id: n.id, name: n.name, type: n.type,
      x: Math.round(n.absX - originX), y: Math.round(n.absY - originY),
      width: Math.round(n.width), height: Math.round(n.height),
      parentId,
    });
    for (const c of n.children) walk(c, n.id);
  }
  walk(root, null);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/captureTree.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/captureTree.ts studio/__tests__/export/figma/captureTree.test.ts
git commit -m "feat(studio/export): capture tree reader (normalize to frame-relative)"
```

---

## Task 4: Swap planner — discrete region (geometry replace)

**Files:**
- Create: `studio/src/export/figma/swapPlan.ts`
- Test: `studio/__tests__/export/figma/swapPlan.test.ts`

The planner needs the maps (component + token). To keep it pure and testable, it takes a `SwapPlanMaps` dependency (same shape pattern as `PlannerMaps` in `planSlj.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/swapPlan.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planSwap, type SwapPlanMaps } from "../../../src/export/figma/swapPlan";
import type { ManifestComponent } from "../../../src/export/figma/swapOps";
import type { CaptureNode } from "../../../src/export/figma/captureTree";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const chatItem: FigmaComponentMapping = {
  arcadeGen: "ComputerSidebar.Item", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "CHAT_ITEM_KEY", setName: "Chat Item" }, variants: [],
  textNode: { strategy: "by-name", name: "Item name#8536:0" }, note: "",
};
const maps: SwapPlanMaps = {
  findComponentMapping: (n) => (n === "ComputerSidebar.Item" ? chatItem : null),
  tokenNameToVariableKey: () => null,
};

const cap = (id: string, name: string, x: number, y: number, w: number, h: number, parentId = "root"): CaptureNode =>
  ({ id, name, type: "FRAME", x, y, width: w, height: h, parentId });

describe("planSwap — discrete region", () => {
  it("emits replaceWithInstance for a geometry-matched component with its label", () => {
    const manifest: ManifestComponent[] = [
      { component: "ComputerSidebar.Item", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "Remove council reference" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("flat1", "Button", 8, 148, 239, 36, "side"),
      cap("side", "Root", 0, 0, 256, 631, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "CHAT_ITEM_KEY",
      parentNodeId: "side", text: { propName: "Item name#8536:0", characters: "Remove council reference" },
    });
  });

  it("skips a component with no geometry match (leaves the flat frame)", () => {
    const manifest: ManifestComponent[] = [
      { component: "ComputerSidebar.Item", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "x" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, ""), cap("far", "Button", 900, 900, 239, 36, "root")];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(0);
  });

  it("skips an unmapped component", () => {
    const manifest: ManifestComponent[] = [
      { component: "Unknown", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "x" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, ""), cap("flat1", "Button", 8, 148, 239, 36, "root")];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: FAIL — `planSwap` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/swapPlan.ts
import type { Box } from "../slj";
import type { FigmaComponentMapping } from "./types";
import type { ManifestComponent, SwapOp } from "./swapOps";
import type { CaptureNode } from "./captureTree";
import { matchByGeometry } from "./geometryMatch";

export interface SwapPlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

export interface SwapRegions {
  /** Box of the chat transcript container, or null when the frame has none. */
  transcriptRegion: Box | null;
}

/** Resolve the Figma variant map for a manifest component from its props. */
function resolveVariant(mapping: FigmaComponentMapping, props: Record<string, unknown>): Record<string, string> | undefined {
  const variant: Record<string, string> = {};
  for (const axis of mapping.variants) {
    const raw = props[axis.prop];
    if (typeof raw === "string" && axis.valueMap[raw] !== undefined) variant[axis.figmaProp] = axis.valueMap[raw];
  }
  return Object.keys(variant).length > 0 ? variant : undefined;
}

/** Build the text payload for an instance from the mapping's textNode hint. */
function textPayload(mapping: FigmaComponentMapping, text: string | null): { propName?: string; characters: string } | undefined {
  if (text === null || !mapping.textNode) return undefined;
  if (mapping.textNode.strategy === "by-name") return { propName: mapping.textNode.name, characters: text };
  return { characters: text };
}

/** Plan the discrete-region swaps: geometry-match each mapped component to a
 *  capture node and emit replaceWithInstance. (Transcript handled in Task 5.) */
export function planSwap(
  manifest: ManifestComponent[],
  captureNodes: CaptureNode[],
  _regions: SwapRegions,
  maps: SwapPlanMaps,
): SwapOp[] {
  const ops: SwapOp[] = [];
  const used = new Set<string>();
  for (const comp of manifest) {
    const mapping = maps.findComponentMapping(comp.component);
    if (!mapping || mapping.status !== "mapped" || !mapping.figma) continue;
    const candidates = captureNodes.filter((n) => !used.has(n.id));
    const match = matchByGeometry(comp.box, candidates);
    if (!match || match.parentId === null) continue;
    used.add(match.id);
    ops.push({
      op: "replaceWithInstance",
      targetNodeId: match.id,
      componentSetKey: mapping.figma.componentSetKey,
      variant: resolveVariant(mapping, comp.props),
      box: { x: match.x, y: match.y, width: match.width, height: match.height },
      parentNodeId: match.parentId,
      text: textPayload(mapping, comp.text),
    });
  }
  return ops;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/swapPlan.ts studio/__tests__/export/figma/swapPlan.test.ts
git commit -m "feat(studio/export): swap planner — discrete-region geometry replace"
```

---

## Task 5: Swap planner — transcript region (inject bubbles)

**Files:**
- Modify: `studio/src/export/figma/swapPlan.ts`
- Test: `studio/__tests__/export/figma/swapPlan.test.ts` (add cases)

- [ ] **Step 1: Write the failing test (append to the existing describe)**

```ts
// append to studio/__tests__/export/figma/swapPlan.test.ts
import { ... } from "..."; // (existing imports already present)

const bubbleMapping: FigmaComponentMapping = {
  arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "BUBBLE_KEY", setName: "Bubble" },
  variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
  textNode: { strategy: "lowest-depth" }, note: "",
};
const maps2: SwapPlanMaps = {
  findComponentMapping: (n) => (n === "ChatBubble" ? bubbleMapping : n === "ComputerSidebar.Item" ? chatItem : null),
  tokenNameToVariableKey: () => null,
};

describe("planSwap — transcript region", () => {
  it("routes ChatBubbles to a single injectInstances op into the transcript container", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
      { component: "ChatBubble", box: { x: 272, y: 497, width: 317, height: 41 }, props: { variant: "sender" }, text: "Yo" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("transcript", "Container", 256, 48, 1200, 832, "root"),
      cap("flatBubbleA", "List Item", 306, 261, 352, 21, "transcript"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    const inject = ops.find((o) => o.op === "injectInstances");
    expect(inject).toBeDefined();
    if (inject && inject.op === "injectInstances") {
      expect(inject.containerNodeId).toBe("transcript");
      expect(inject.clearChildren).toBe(true);
      expect(inject.instances).toHaveLength(2);
      // box is relative to the container (272-256, 64-48)
      expect(inject.instances[0].box).toEqual({ x: 16, y: 16, width: 400, height: 409 });
      expect(inject.instances[0].variant).toEqual({ Type: "Receiver" });
      expect(inject.instances[0].text).toEqual({ characters: "Hi" });
      expect(inject.instances[1].variant).toEqual({ Type: "Sender" });
    }
  });

  it("does not emit replaceWithInstance for bubbles (they go through injection only)", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("transcript", "Container", 256, 48, 1200, 832, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    expect(ops.every((o) => o.op !== "replaceWithInstance")).toBe(true);
  });

  it("falls back to leaving bubbles alone when no transcript container is found", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, "")]; // no container near the region
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    expect(ops).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: FAIL — bubbles currently fall through `replaceWithInstance` (no transcript handling).

- [ ] **Step 3: Modify the implementation**

Add transcript handling to `swapPlan.ts`. Treat `ChatBubble` as a transcript component: collect them, find the container node that matches `transcriptRegion` by geometry, emit one `injectInstances`. Exclude bubbles from the discrete loop.

```ts
// studio/src/export/figma/swapPlan.ts  (full replacement of planSwap + a constant)
const TRANSCRIPT_COMPONENTS = new Set(["ChatBubble"]);

export function planSwap(
  manifest: ManifestComponent[],
  captureNodes: CaptureNode[],
  regions: SwapRegions,
  maps: SwapPlanMaps,
): SwapOp[] {
  const ops: SwapOp[] = [];
  const used = new Set<string>();

  // --- transcript region: inject our bubbles, discard their flat ones ---
  const bubbles = manifest.filter((c) => TRANSCRIPT_COMPONENTS.has(c.component));
  if (bubbles.length > 0 && regions.transcriptRegion) {
    const container = matchByGeometry(regions.transcriptRegion, captureNodes);
    if (container) {
      used.add(container.id);
      const instances = bubbles
        .map((b) => {
          const mapping = maps.findComponentMapping(b.component);
          if (!mapping || mapping.status !== "mapped" || !mapping.figma) return null;
          return {
            componentSetKey: mapping.figma.componentSetKey,
            variant: resolveVariant(mapping, b.props),
            box: { x: b.box.x - container.x, y: b.box.y - container.y, width: b.box.width, height: b.box.height },
            text: textPayload(mapping, b.text),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (instances.length > 0) ops.push({ op: "injectInstances", containerNodeId: container.id, clearChildren: true, instances });
    }
  }

  // --- discrete region: geometry-match each remaining mapped component ---
  for (const comp of manifest) {
    if (TRANSCRIPT_COMPONENTS.has(comp.component)) continue;
    const mapping = maps.findComponentMapping(comp.component);
    if (!mapping || mapping.status !== "mapped" || !mapping.figma) continue;
    const candidates = captureNodes.filter((n) => !used.has(n.id));
    const match = matchByGeometry(comp.box, candidates);
    if (!match || match.parentId === null) continue;
    used.add(match.id);
    ops.push({
      op: "replaceWithInstance",
      targetNodeId: match.id,
      componentSetKey: mapping.figma.componentSetKey,
      variant: resolveVariant(mapping, comp.props),
      box: { x: match.x, y: match.y, width: match.width, height: match.height },
      parentNodeId: match.parentId,
      text: textPayload(mapping, comp.text),
    });
  }
  return ops;
}
```

Note: the matcher's area filter must not reject the transcript container. The container area (1200×832) vs region (1200×832) is an exact match, so the ±25% filter passes. If a real capture nests the container with a slightly different box, widen `areaTol` for the container match only by calling `matchByGeometry(region, nodes, { ...DEFAULT_MATCH_OPTS, threshold: 64, areaTol: 0.4 })` — import `DEFAULT_MATCH_OPTS` from `./geometryMatch`. Apply this looser opts object to the container match call (not the discrete loop).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/swapPlan.test.ts`
Expected: PASS (all discrete + transcript tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/swapPlan.ts studio/__tests__/export/figma/swapPlan.test.ts
git commit -m "feat(studio/export): swap planner — transcript inject + bubble routing"
```

---

## Task 6: Swap executor

**Files:**
- Create: `studio/src/export/figma/executeSwap.ts`
- Test: `studio/__tests__/export/figma/executeSwap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/executeSwap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { executeSwap, type SwapBridge } from "../../../src/export/figma/executeSwap";
import type { SwapOp } from "../../../src/export/figma/swapOps";

function fakeBridge() {
  const calls: string[] = [];
  let seq = 0;
  const bridge: SwapBridge = {
    async createInstance(key, parentId, variant) { calls.push(`createInstance:${key}->${parentId}:${variant ? JSON.stringify(variant) : ""}`); return "inst-" + seq++; },
    async positionNode(id, box) { calls.push(`position:${id}:${box.x},${box.y},${box.width},${box.height}`); },
    async setInstanceText(id, propName, chars) { calls.push(`text:${id}:${propName ?? "(auto)"}:${chars}`); },
    async bindVariable(id, field, key) { calls.push(`bind:${id}:${field}:${key}`); },
    async clearChildren(id) { calls.push(`clear:${id}`); },
    async removeNode(id) { calls.push(`remove:${id}`); },
  };
  return { bridge, calls };
}

describe("executeSwap", () => {
  it("replaceWithInstance: creates instance under parent, positions, sets text, removes flat frame (in that order)", async () => {
    const ops: SwapOp[] = [{
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "K", parentNodeId: "side",
      box: { x: 8, y: 148, width: 239, height: 36 }, text: { propName: "Item name#8536:0", characters: "Hi" },
    }];
    const { bridge, calls } = fakeBridge();
    const r = await executeSwap(ops, bridge);
    expect(calls[0]).toBe("createInstance:K->side:");
    expect(calls).toContain("position:inst-0:8,148,239,36");
    expect(calls).toContain("text:inst-0:Item name#8536:0:Hi");
    // flat frame removed only AFTER instance created
    expect(calls.indexOf("remove:flat1")).toBeGreaterThan(calls.indexOf("createInstance:K->side:"));
    expect(r.summary.replaced).toBe(1);
    expect(r.summary.failures).toBe(0);
  });

  it("does NOT remove the flat frame when instance creation fails", async () => {
    const ops: SwapOp[] = [{ op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "K", parentNodeId: "side", box: { x: 0, y: 0, width: 1, height: 1 } }];
    const { calls } = fakeBridge();
    const throwing: SwapBridge = {
      ...((): SwapBridge => { const { bridge } = fakeBridge(); return bridge; })(),
      async createInstance() { throw new Error("boom"); },
      async removeNode(id) { calls.push(`remove:${id}`); },
    };
    const r = await executeSwap(ops, throwing);
    expect(calls).not.toContain("remove:flat1");
    expect(r.summary.failures).toBe(1);
  });

  it("injectInstances: clears the container then creates each instance under it", async () => {
    const ops: SwapOp[] = [{
      op: "injectInstances", containerNodeId: "transcript", clearChildren: true,
      instances: [
        { componentSetKey: "B", variant: { Type: "Receiver" }, box: { x: 16, y: 16, width: 400, height: 409 }, text: { characters: "Hi" } },
        { componentSetKey: "B", variant: { Type: "Sender" }, box: { x: 16, y: 449, width: 317, height: 41 }, text: { characters: "Yo" } },
      ],
    }];
    const { bridge, calls } = fakeBridge();
    const r = await executeSwap(ops, bridge);
    expect(calls[0]).toBe("clear:transcript");
    expect(calls).toContain('createInstance:B->transcript:{"Type":"Receiver"}');
    expect(calls).toContain('createInstance:B->transcript:{"Type":"Sender"}');
    expect(calls).toContain("text:inst-0:(auto):Hi");
    expect(r.summary.injected).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/executeSwap.test.ts`
Expected: FAIL — `executeSwap` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/executeSwap.ts
import type { Box } from "../slj";
import type { SwapOp } from "./swapOps";

/** Bridge surface the executor needs. Live impl wraps figma-console MCP
 *  (local-node instancing for create; in-file variable import for bind);
 *  tests pass a fake. */
export interface SwapBridge {
  createInstance(componentSetKey: string, parentNodeId: string, variant?: Record<string, string>): Promise<string>;
  positionNode(nodeId: string, box: Box): Promise<void>;
  setInstanceText(nodeId: string, propName: string | undefined, characters: string): Promise<void>;
  bindVariable(nodeId: string, field: "fill" | "stroke", variableKey: string): Promise<void>;
  clearChildren(nodeId: string): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
}

export interface SwapResult {
  perOp: Array<{ op: string; ok: boolean; error?: string }>;
  summary: { replaced: number; injected: number; failures: number };
}

export async function executeSwap(ops: SwapOp[], bridge: SwapBridge): Promise<SwapResult> {
  const perOp: SwapResult["perOp"] = [];
  const summary = { replaced: 0, injected: 0, failures: 0 };

  for (const op of ops) {
    try {
      if (op.op === "replaceWithInstance") {
        // Create the real instance FIRST; only remove the flat frame once it exists.
        const id = await bridge.createInstance(op.componentSetKey, op.parentNodeId, op.variant);
        await bridge.positionNode(id, op.box);
        if (op.text) await bridge.setInstanceText(id, op.text.propName, op.text.characters);
        for (const b of op.binds ?? []) await bridge.bindVariable(id, b.field, b.variableKey);
        await bridge.removeNode(op.targetNodeId);
        summary.replaced++;
        perOp.push({ op: op.op, ok: true });
      } else if (op.op === "injectInstances") {
        if (op.clearChildren) await bridge.clearChildren(op.containerNodeId);
        for (const inst of op.instances) {
          const id = await bridge.createInstance(inst.componentSetKey, op.containerNodeId, inst.variant);
          await bridge.positionNode(id, inst.box);
          if (inst.text) await bridge.setInstanceText(id, inst.text.propName, inst.text.characters);
          summary.injected++;
        }
        perOp.push({ op: op.op, ok: true });
      }
    } catch (e) {
      summary.failures++;
      perOp.push({ op: op.op, ok: false, error: String((e as Error).message ?? e) });
    }
  }
  return { perOp, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/executeSwap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/executeSwap.ts studio/__tests__/export/figma/executeSwap.test.ts
git commit -m "feat(studio/export): swap executor (replace + inject, instance-before-remove)"
```

---

## Task 7: Wire a swap entrypoint + transcript region detection

**Files:**
- Create: `studio/src/export/figma/runSwap.ts`
- Test: `studio/__tests__/export/figma/runSwap.test.ts`

This composes the units into one callable: given an SLJ + capture nodes + maps, produce the ops. It also derives the `transcriptRegion` from the SLJ (the box of the subtree that contains the bubbles), so callers do not hand-compute it.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/runSwap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { deriveTranscriptRegion } from "../../../src/export/figma/runSwap";
import type { ManifestComponent } from "../../../src/export/figma/swapOps";

describe("deriveTranscriptRegion", () => {
  it("returns the bounding box enclosing all ChatBubbles", () => {
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: {}, text: "a" },
      { component: "ChatBubble", box: { x: 272, y: 497, width: 317, height: 41 }, props: {}, text: "b" },
      { component: "Button", box: { x: 12, y: 58, width: 112, height: 28 }, props: {}, text: "c" },
    ];
    const r = deriveTranscriptRegion(manifest)!;
    expect(r.x).toBe(272);
    expect(r.y).toBe(64);
    expect(r.width).toBe(400);          // max right (272+400=672) - min left (272)
    expect(r.height).toBe(474);         // max bottom (497+41=538) - min top (64)
  });

  it("returns null when there are no bubbles", () => {
    const manifest: ManifestComponent[] = [{ component: "Button", box: { x: 0, y: 0, width: 1, height: 1 }, props: {}, text: null }];
    expect(deriveTranscriptRegion(manifest)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/runSwap.test.ts`
Expected: FAIL — `deriveTranscriptRegion` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/runSwap.ts
import type { Box, SljDocument } from "../slj";
import type { ManifestComponent, SwapOp } from "./swapOps";
import { flattenManifest } from "./swapOps";
import type { CaptureNode } from "./captureTree";
import { planSwap, type SwapPlanMaps } from "./swapPlan";

const TRANSCRIPT_COMPONENTS = new Set(["ChatBubble"]);

/** Bounding box enclosing every transcript component in the manifest, or null. */
export function deriveTranscriptRegion(manifest: ManifestComponent[]): Box | null {
  const bubbles = manifest.filter((c) => TRANSCRIPT_COMPONENTS.has(c.component));
  if (bubbles.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bubbles) {
    minX = Math.min(minX, b.box.x);
    minY = Math.min(minY, b.box.y);
    maxX = Math.max(maxX, b.box.x + b.box.width);
    maxY = Math.max(maxY, b.box.y + b.box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Compose the swap: SLJ → manifest → ops, deriving the transcript region. */
export function buildSwapOps(slj: SljDocument, captureNodes: CaptureNode[], maps: SwapPlanMaps): SwapOp[] {
  const manifest = flattenManifest(slj);
  const transcriptRegion = deriveTranscriptRegion(manifest);
  return planSwap(manifest, captureNodes, { transcriptRegion }, maps);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/runSwap.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/runSwap.ts studio/__tests__/export/figma/runSwap.test.ts
git commit -m "feat(studio/export): compose swap entrypoint + transcript region detection"
```

---

## Task 8: Live end-to-end run + screenshot verification

**Files:** none (live operation; uses the figma-console Bridge + the running Studio dev server). This task is manual/agent-driven verification, not automated tests.

- [ ] **Step 1: Start the Studio dev server and load the test frame**

```bash
pnpm run studio   # serves :5556
```
Navigate (Playwright or browser) to `http://localhost:5556/api/frames/build-a-computer-chat-screen-with-the/01-computer-with-panel`. Wait for the chat data to render (the transcript must be populated, not the empty state).

- [ ] **Step 2: Export the live SLJ**

In the frame page context, run the existing `exportFrameToSlj` (reaches the fiber via `#root`'s `__reactContainer$` key). Save the returned `SljDocument` to disk (e.g. `/tmp/arcade-slj.json`).
Expected: 8 distinct components incl. `ComputerSidebar.Item` ×30 and `ChatBubble` ×13.

- [ ] **Step 3: Capture the frame with the converter**

Use `generate_figma_design` against `fileKey a2uKnm88LxRXEWAL1kOqeQ` to capture the same localhost frame (temporarily add the capture.js `<script>` to the frame shell in `studio/server/plugins/frameMountPlugin.ts`, restart the server, open the `#figmacapture=...` hash URL, poll to completion, then REVERT the script tag). Record the resulting capture node id.

- [ ] **Step 4: Read the capture tree + build ops**

Run a `figma_execute` that walks the capture node → `RawCaptureNode`, feed it through `readCaptureTree`, then `buildSwapOps(slj, captureNodes, maps)` with the real maps (`findComponentMapping` + `buildTokenMap(figma-variables.json#variables).tokenNameToVariableKey`). Inspect the op counts: expect ~30 `replaceWithInstance` (Chat Items) + buttons/chrome, and 1 `injectInstances` with ~13 bubbles.

- [ ] **Step 5: Execute the swap over the Bridge**

Implement the live `SwapBridge` inline in a `figma_execute` (or a small inline script) using: local-node instancing (resolve component-set key → local node id via `figma_search_components` results, pick variant child, `.createInstance()`); `positionNode` via `node.x/node.y` relative to parent + `resize`; `setInstanceText` via `setProperties({[propName]: chars})` (match propName by base before `#`) with a raw-TEXT fallback; `bindVariable` via `importVariableByKeyAsync` + `setBoundVariableForPaint`; `clearChildren`/`removeNode` via `.remove()`. Run `executeSwap(ops, bridge)`.

- [ ] **Step 6: Screenshot + verify**

Capture the swapped frame (`figma_capture_screenshot`). Verify against the Studio render:
- Sidebar shows real Chat Item rows with real titles + avatars (not flat text).
- Transcript shows real ChatBubble instances with the real message text.
- New Chat Button, history/header IconButtons, Menu are real instances.
- Layout is the converter's faithful 3-pane (NO footer overlap, NO stray floating button, NO clipped header — the bugs the all-ours executor had).
- No region is worse than the pure capture.

Record the screenshot and the `executeSwap` summary (replaced / injected / failures). If any region regressed vs the pure capture, note it as a follow-up — do not block.

- [ ] **Step 7: Commit findings**

```bash
git add docs/superpowers/specs/2026-06-09-figma-export-hybrid-design.md
git commit -m "docs(studio/export): hybrid swap verified live — <summary counts>"
```
(Update the spec's "Done =" section with the actual observed counts + a one-line verdict.)

---

## Task 9: Retire the dead layout code

Only after Task 8 confirms the hybrid works end-to-end. Removes the now-unused frame-building path so the codebase has one export consumer, not two.

**Files:**
- Modify: `studio/src/export/figma/planSlj.ts` (or delete if fully unused)
- Modify: `studio/src/export/figma/executeFigmaOps.ts` (or delete)
- Modify/delete: `studio/__tests__/export/figma/planSlj.test.ts`, `studio/__tests__/export/figma/executeFigmaOps.test.ts`, `studio/__tests__/export/figma/ops.test.ts`

- [ ] **Step 1: Find all importers of the dead units**

Run: `grep -rn "planFigmaOps\|executeFigmaOps\|from \"./ops\"\|from \"../ops\"" studio/src studio/__tests__`
Expected: importers are only the planner/executor and their tests (no production runtime path consumes them — the live run used inline scripts).

- [ ] **Step 2: Delete the dead source files and their tests**

```bash
git rm studio/src/export/figma/planSlj.ts studio/src/export/figma/executeFigmaOps.ts studio/src/export/figma/ops.ts
git rm studio/__tests__/export/figma/planSlj.test.ts studio/__tests__/export/figma/executeFigmaOps.test.ts studio/__tests__/export/figma/ops.test.ts
```
(If `ops.ts`'s `Box`/`FigmaOp` types are still referenced by a kept file, keep `ops.ts` and delete only the `FigmaOp`/`FigmaPlan` exports + the planner/executor. Verify with the grep from Step 1 before deleting.)

- [ ] **Step 3: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS — green with the dead tests removed and the new swap tests present. No import errors from dangling references.

- [ ] **Step 4: Commit**

```bash
git add -A studio/src/export studio/__tests__/export
git commit -m "refactor(studio/export): retire the all-ours layout pipeline (replaced by hybrid swap)"
```

---

## Task 10: Open / update the PR

- [ ] **Step 1: Run the full suite green**

Run: `pnpm run studio:test`
Expected: all pass.

- [ ] **Step 2: Push and update PR #11 (or open a fresh PR off main)**

```bash
git push origin feat/figma-export-widen
```
Update the PR body: the export is now hybrid (capture + swap), the all-ours layout code is retired, link the new spec + plan, and note the live-run screenshot result from Task 8.

---

## Self-review notes

- **Spec coverage:** captureTree (T3) ✓; swapPlan pure + matcher (T2,T4,T5) ✓; executeSwap (T6) ✓; per-region (T4 discrete, T5 transcript) ✓; geometry matcher thresholds (T2) ✓; SwapOp contract (T1) ✓; delete dead layout (T9) ✓; live screenshot run (T8) ✓; engine-agnostic input (capture node id, T3/T8) ✓.
- **Types consistent across tasks:** `Box` (from slj.ts) everywhere; `ManifestComponent` (T1) used by T4/T5/T7; `CaptureNode` (T3) used by T4/T5; `SwapOp` (T1) used by T4/T5/T6; `SwapPlanMaps` (T4) used by T5/T7; `SwapBridge` (T6) for the live run (T8).
- **Risk carried into T8:** transcript container identification — handled by the looser-opts container match in T5 + the "fall back to leaving bubbles" test; T8 verifies on the real capture.
