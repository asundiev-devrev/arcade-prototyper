# Figma Structured Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the Studio generator a compacted Figma node tree, resolved design tokens, and classifier-suggested `prototype-kit` composites — prefetched on URL detection, injected into the chat turn alongside an auto-exported PNG.

**Architecture:** A new `server/figmaIngest.ts` orchestrator runs four sub-steps (figmanage `get-nodes`, token resolution, Haiku composite classifier, PNG export) behind an in-memory LRU cache. `PromptInput.tsx` fires a prefetch `POST /api/figma/ingest` the moment a Figma URL is detected. `chat.ts` looks the result up at send-time with a 10s await budget and injects a compact YAML `<figma_context>` block into the prompt (and attaches the PNG). Every subsystem degrades gracefully — any failure leaves generation at today's URL-only behavior.

**Tech Stack:** TypeScript, Node's built-in `http` + `child_process`, Vitest for tests. Haiku classifier reuses the existing `claude --bare --model haiku` subprocess path (same Bedrock auth as the generator) — no new SDK dependency. `figmanage` CLI for Figma REST access.

**Spec:** `docs/superpowers/specs/2026-05-01-figma-structured-context-design.md`

## File Structure

**New files (under `studio/`):**

- `server/figma/types.ts` — shared `IngestResult`, `CompactNode`, `ResolvedTokens`, `CompositeSuggestion` types.
- `server/figma/compactTree.ts` — raw figmanage JSON → `CompactNode`. Pure function.
- `server/figma/resolveTokens.ts` — raw figmanage variables response + `CompactNode` → `ResolvedTokens` + tree with token-named styles. Pure function.
- `server/figma/classifyComposites.ts` — spawns `claude --bare --model haiku` with the compacted tree + kit summary; parses JSON reply into `CompositeSuggestion[]`; validates.
- `server/figma/promptBlock.ts` — `IngestResult` → `<figma_context>` YAML string.
- `server/figmaIngest.ts` — orchestrator. Owns LRU + pending-promise dedupe. Public API: `ingest(fileKey, nodeId)`, `getCached(fileKey, nodeId)`, `getPending(fileKey, nodeId)`.
- `__tests__/server/figma/compactTree.test.ts`
- `__tests__/server/figma/resolveTokens.test.ts`
- `__tests__/server/figma/classifyComposites.test.ts`
- `__tests__/server/figma/promptBlock.test.ts`
- `__tests__/server/figmaIngest.test.ts`
- `__tests__/server/middleware/figma-ingest.test.ts`
- `__tests__/server/middleware/chat-figma-context.test.ts`
- `__tests__/fixtures/figma/simple-node.json` — tiny figmanage response (1 frame, 1 text, no variables).
- `__tests__/fixtures/figma/with-variables.json` — figmanage node + `get-variables` pair, one bound color, one bound spacing.
- `__tests__/fixtures/figma/oversized.json` — 250+ nodes, deep nesting, zero-size nodes to strip.

**Modified files (under `studio/`):**

- `server/figmaCli.ts` — add `getVariables(fileKey)` wrapper.
- `server/middleware/figma.ts` — add `POST /api/figma/ingest` handler.
- `server/middleware/chat.ts` — prompt-build step: lookup cache, inject block, attach PNG.
- `src/components/chat/PromptInput.tsx` — prefetch on `detectedFigmaUrl` change.
- `CHANGELOG.md` — `[0.x.0]` entry.

**Commit granularity:** One commit per task. Commit message prefix `feat(studio/figma-ingest): <verb> <noun>` for feature tasks, `test(studio/figma-ingest): ...` for pure test scaffolding, `feat(studio/figma-ingest): wire <thing>` for the integration tasks, `docs(studio): ...` for changelog.

---

### Task 1: Shared types module

**Files:**
- Create: `studio/server/figma/types.ts`

- [ ] **Step 1: Create the types file**

Create `studio/server/figma/types.ts`:

```ts
/**
 * Types shared across the Figma ingestion pipeline. Kept in one module
 * so the pipeline stages (compact → resolve → classify → assemble) all
 * agree on one shape of IngestResult and don't need to import across
 * sibling files.
 */

export interface IngestSource {
  fileKey: string;
  nodeId: string;
  url: string;
  fetchedAt: string;
}

export type NodeType = "frame" | "text" | "instance" | "group" | "vector" | "image";
export type LayoutDirection = "row" | "col" | "none";
export type SizeAxis = number | "fill" | "hug";

export interface CompactLayout {
  direction: LayoutDirection;
  gap?: number;
  padding?: [number, number, number, number];
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between";
  width?: SizeAxis;
  height?: SizeAxis;
}

export interface CompactStyle {
  fill?: string;
  stroke?: string;
  radius?: number;
  shadow?: string;
}

export interface CompactText {
  content: string;
  style?: string;
}

export interface CompactNode {
  id: string;
  type: NodeType;
  name?: string;
  layout?: CompactLayout;
  style?: CompactStyle;
  text?: CompactText;
  children?: CompactNode[];
}

export interface ResolvedTokens {
  colors: Record<string, string>;
  typography: Record<string, string>;
  spacing: Record<string, number>;
}

export type CompositeConfidence = "high" | "medium" | "low";

export interface CompositeSuggestion {
  composite: string;
  path: string;
  confidence: CompositeConfidence;
  reason: string;
}

export interface IngestPng {
  path: string;
  widthPx: number;
  heightPx: number;
}

export interface IngestResult {
  source: IngestSource;
  png: IngestPng | null;
  tree: CompactNode;
  tokens: ResolvedTokens;
  composites: CompositeSuggestion[];
  diagnostics: { warnings: string[] };
}

export interface IngestFailure {
  ok: false;
  reason: string;
  source: Pick<IngestSource, "fileKey" | "nodeId" | "url">;
}

export type IngestOutcome = ({ ok: true } & IngestResult) | IngestFailure;
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm -C studio exec tsc --noEmit`
Expected: no errors introduced by this file. (Other pre-existing errors, if any, are unrelated.)

- [ ] **Step 3: Commit**

```bash
git add studio/server/figma/types.ts
git commit -m "feat(studio/figma-ingest): add shared ingest types"
```

---

### Task 2: Fixture — simple figmanage node

**Files:**
- Create: `studio/__tests__/fixtures/figma/simple-node.json`

- [ ] **Step 1: Create the fixture**

Create `studio/__tests__/fixtures/figma/simple-node.json` — one frame with one text child, no variables, no auto-layout. This shape mirrors what `figmanage reading get-nodes <fileKey> <nodeId> --json` returns: a dict keyed by node id.

```json
{
  "1038:14518": {
    "document": {
      "id": "1038:14518",
      "name": "Card",
      "type": "FRAME",
      "absoluteBoundingBox": { "x": 0, "y": 0, "width": 320, "height": 120 },
      "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1, "a": 1 } }],
      "cornerRadius": 8,
      "layoutMode": "NONE",
      "children": [
        {
          "id": "1038:14519",
          "name": "Title",
          "type": "TEXT",
          "characters": "Hello world",
          "absoluteBoundingBox": { "x": 16, "y": 16, "width": 288, "height": 24 },
          "style": { "fontSize": 16, "fontWeight": 500, "lineHeightPx": 24 },
          "fills": [{ "type": "SOLID", "color": { "r": 0.1, "g": 0.1, "b": 0.1, "a": 1 } }]
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add studio/__tests__/fixtures/figma/simple-node.json
git commit -m "test(studio/figma-ingest): add simple figmanage fixture"
```

---

### Task 3: Fixture — node with variables

**Files:**
- Create: `studio/__tests__/fixtures/figma/with-variables.json`

This fixture holds BOTH the `get-nodes` response and the `get-variables` response, under keys `"node"` and `"variables"`. Tests will pull out whichever half they need.

- [ ] **Step 1: Create the fixture**

Create `studio/__tests__/fixtures/figma/with-variables.json`:

```json
{
  "node": {
    "1:2": {
      "document": {
        "id": "1:2",
        "name": "Sidebar",
        "type": "FRAME",
        "absoluteBoundingBox": { "x": 0, "y": 0, "width": 248, "height": 800 },
        "fills": [{
          "type": "SOLID",
          "color": { "r": 1, "g": 1, "b": 1, "a": 1 },
          "boundVariables": { "color": { "type": "VARIABLE_ALIAS", "id": "VariableID:1:10" } }
        }],
        "layoutMode": "VERTICAL",
        "itemSpacing": 12,
        "paddingLeft": 16,
        "paddingRight": 16,
        "paddingTop": 16,
        "paddingBottom": 16,
        "boundVariables": {
          "itemSpacing": { "type": "VARIABLE_ALIAS", "id": "VariableID:1:11" }
        },
        "children": []
      }
    }
  },
  "variables": {
    "variables": {
      "VariableID:1:10": {
        "id": "VariableID:1:10",
        "name": "surface/default",
        "resolvedType": "COLOR",
        "valuesByMode": { "mode-1": { "r": 1, "g": 1, "b": 1, "a": 1 } }
      },
      "VariableID:1:11": {
        "id": "VariableID:1:11",
        "name": "spacing/md",
        "resolvedType": "FLOAT",
        "valuesByMode": { "mode-1": 12 }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add studio/__tests__/fixtures/figma/with-variables.json
git commit -m "test(studio/figma-ingest): add figmanage fixture with variables"
```

---

### Task 4: Fixture — oversized tree

**Files:**
- Create: `studio/__tests__/fixtures/figma/oversized.json`

This one is big enough to exercise `compactTree`'s truncation, passthrough-group collapse, and zero-size drop. Handwriting it is painful, so generate it with a tiny Node script inline in the test — BUT commit the resulting JSON so tests are deterministic. We'll use a programmatic generator in this step.

- [ ] **Step 1: Write and run a one-off generator**

Run this from the repo root (don't commit the script — just the output):

```bash
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
function frame(id, children, extras = {}) {
  return {
    id, name: `Frame ${id}`, type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    layoutMode: "NONE", children, ...extras,
  };
}
function zeroSize(id) {
  return { id, name: `empty ${id}`, type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 }, children: [] };
}
function passthrough(id, child) {
  // Single-child group with no own visual properties — should be collapsed.
  return { id, name: `Group ${id}`, type: "GROUP",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, children: [child] };
}
const leaves = Array.from({ length: 60 }, (_, i) => frame(`L:${i}`, []));
// deep-nest 10 frames under a passthrough chain to exceed depth cap of 8
let deep = frame("leaf", []);
for (let i = 0; i < 12; i++) deep = passthrough(`p${i}`, deep);
// total node count > 200 after including leaves + a couple of zero-size nodes
const root = frame("root", [
  ...leaves, zeroSize("z1"), zeroSize("z2"), deep,
  ...Array.from({ length: 150 }, (_, i) => frame(`T:${i}`, [])),
]);
const doc = { "root": { document: root } };
const out = path.resolve("studio/__tests__/fixtures/figma/oversized.json");
fs.writeFileSync(out, JSON.stringify(doc));
console.log("wrote", out, "size", fs.statSync(out).size);
'
```

Expected output: `wrote .../oversized.json size <some positive number>`.

- [ ] **Step 2: Confirm the file exists**

Run: `ls -la studio/__tests__/fixtures/figma/oversized.json`
Expected: file exists, size between 10 KB and 200 KB.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/fixtures/figma/oversized.json
git commit -m "test(studio/figma-ingest): add oversized figmanage fixture"
```

---

### Task 5: `compactTree` — happy path test

**Files:**
- Test: `studio/__tests__/server/figma/compactTree.test.ts`
- Create: `studio/server/figma/compactTree.ts`

- [ ] **Step 1: Write the failing happy-path test**

Create `studio/__tests__/server/figma/compactTree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactTree } from "../../../server/figma/compactTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures/figma");
function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf-8"));
}

describe("compactTree (happy path)", () => {
  it("converts a simple figmanage response into a CompactNode tree", () => {
    const raw = loadFixture("simple-node.json");
    const node = raw["1038:14518"].document;
    const { tree, warnings } = compactTree(node);

    expect(warnings).toEqual([]);
    expect(tree.id).toBe("0");
    expect(tree.type).toBe("frame");
    expect(tree.style?.fill).toBe("#FFFFFF");
    expect(tree.style?.radius).toBe(8);
    expect(tree.children).toHaveLength(1);
    const [child] = tree.children!;
    expect(child.id).toBe("0.0");
    expect(child.type).toBe("text");
    expect(child.text?.content).toBe("Hello world");
    expect(child.text?.style).toBe("16/24/500");
    expect(child.name).toBeUndefined(); // "Title" is 5 chars, below the meaningful-name threshold
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/compactTree.test.ts`
Expected: FAIL — `Cannot find module '../../../server/figma/compactTree'`.

- [ ] **Step 3: Implement the minimal `compactTree`**

Create `studio/server/figma/compactTree.ts`:

```ts
import type { CompactLayout, CompactNode, CompactStyle, CompactText, NodeType, SizeAxis } from "./types";

export const DEPTH_CAP = 8;
export const MAX_NODES = 200;

interface CompactResult {
  tree: CompactNode;
  warnings: string[];
}

export function compactTree(raw: any): CompactResult {
  const warnings: string[] = [];
  let count = 0;

  function recur(n: any, pathId: string, depth: number): CompactNode | null {
    if (!n || typeof n !== "object") return null;
    if (isZeroSize(n)) return null;
    if (depth > DEPTH_CAP) {
      warnings.push(`depth cap ${DEPTH_CAP} reached at ${pathId}`);
      return null;
    }
    if (++count > MAX_NODES) {
      warnings.push(`node cap ${MAX_NODES} reached; tree truncated`);
      return null;
    }

    const type = mapType(n.type);
    const rawKids: any[] = Array.isArray(n.children) ? n.children : [];

    // Collapse passthrough wrappers: GROUP/FRAME with no own visuals and a single child.
    if (isPassthrough(n, type) && rawKids.length === 1) {
      return recur(rawKids[0], pathId, depth); // keep the same path id; effectively unwrap
    }

    const layout = readLayout(n);
    const style = readStyle(n);
    const text = readText(n, type);

    const kids: CompactNode[] = [];
    let childIdx = 0;
    for (const k of rawKids) {
      const compacted = recur(k, `${pathId}.${childIdx}`, depth + 1);
      if (compacted) {
        kids.push({ ...compacted, id: `${pathId}.${childIdx}` });
        childIdx++;
      }
    }

    const node: CompactNode = {
      id: pathId,
      type,
      ...(meaningfulName(n.name) ? { name: n.name } : {}),
      ...(layout ? { layout } : {}),
      ...(style ? { style } : {}),
      ...(text ? { text } : {}),
      ...(kids.length ? { children: kids } : {}),
    };
    return node;
  }

  const tree = recur(raw, "0", 0);
  if (!tree) {
    // Root was unrenderable — return a minimal empty frame so callers don't crash.
    return { tree: { id: "0", type: "frame" }, warnings: warnings.concat("root node was empty") };
  }
  return { tree, warnings };
}

function mapType(t: string): NodeType {
  switch (t) {
    case "FRAME": case "RECTANGLE": case "COMPONENT": case "COMPONENT_SET": return "frame";
    case "TEXT": return "text";
    case "INSTANCE": return "instance";
    case "GROUP": return "group";
    case "VECTOR": case "LINE": case "STAR": case "ELLIPSE": case "POLYGON": return "vector";
    case "IMAGE": return "image";
    default: return "frame";
  }
}

function isZeroSize(n: any): boolean {
  const b = n.absoluteBoundingBox;
  if (!b) return false;
  return (b.width ?? 0) <= 0 || (b.height ?? 0) <= 0;
}

function isPassthrough(n: any, type: NodeType): boolean {
  if (type !== "group" && type !== "frame") return false;
  if (type === "frame") {
    // A frame with a fill / stroke / radius / auto-layout is NOT passthrough.
    if (Array.isArray(n.fills) && n.fills.length) return false;
    if (Array.isArray(n.strokes) && n.strokes.length) return false;
    if (n.cornerRadius) return false;
    if (n.layoutMode && n.layoutMode !== "NONE") return false;
  }
  return true;
}

function readLayout(n: any): CompactLayout | undefined {
  const mode = n.layoutMode;
  if (!mode || mode === "NONE") return undefined;
  const direction = mode === "HORIZONTAL" ? "row" : mode === "VERTICAL" ? "col" : "none";
  const layout: CompactLayout = { direction };
  if (typeof n.itemSpacing === "number") layout.gap = n.itemSpacing;
  if ([n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].some((p) => typeof p === "number")) {
    layout.padding = [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0];
  }
  const align = mapAlign(n.counterAxisAlignItems);
  if (align) layout.align = align;
  const justify = mapJustify(n.primaryAxisAlignItems);
  if (justify) layout.justify = justify;
  const w = mapSizing(n.layoutSizingHorizontal, n.absoluteBoundingBox?.width);
  if (w !== undefined) layout.width = w;
  const h = mapSizing(n.layoutSizingVertical, n.absoluteBoundingBox?.height);
  if (h !== undefined) layout.height = h;
  return layout;
}

function mapAlign(v: string | undefined): CompactLayout["align"] {
  switch (v) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "BASELINE": return "stretch"; // close enough for a prompt hint
    default: return undefined;
  }
}
function mapJustify(v: string | undefined): CompactLayout["justify"] {
  switch (v) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "SPACE_BETWEEN": return "space-between";
    default: return undefined;
  }
}
function mapSizing(v: string | undefined, abs: number | undefined): SizeAxis | undefined {
  if (v === "FILL") return "fill";
  if (v === "HUG") return "hug";
  if (typeof abs === "number") return Math.round(abs);
  return undefined;
}

function readStyle(n: any): CompactStyle | undefined {
  const style: CompactStyle = {};
  const fillHex = solidFillHex(n.fills);
  if (fillHex) style.fill = fillHex;
  const strokeHex = solidFillHex(n.strokes);
  if (strokeHex) style.stroke = strokeHex;
  if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) style.radius = n.cornerRadius;
  if (Array.isArray(n.effects)) {
    const shadow = n.effects.find((e: any) => e.type === "DROP_SHADOW" && e.visible !== false);
    if (shadow) style.shadow = `shadow ${shadow.offset?.x ?? 0}/${shadow.offset?.y ?? 0}/${shadow.radius ?? 0}`;
  }
  return Object.keys(style).length ? style : undefined;
}

function solidFillHex(paints: any): string | undefined {
  if (!Array.isArray(paints)) return undefined;
  const solid = paints.find((p) => p?.type === "SOLID" && p.visible !== false);
  if (!solid?.color) return undefined;
  const { r, g, b } = solid.color;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r ?? 0)}${toHex(g ?? 0)}${toHex(b ?? 0)}`;
}

function readText(n: any, type: NodeType): CompactText | undefined {
  if (type !== "text") return undefined;
  const s = n.style || {};
  const tuple = s.fontSize && s.lineHeightPx
    ? `${s.fontSize}/${s.lineHeightPx}/${s.fontWeight ?? 400}`
    : undefined;
  return {
    content: typeof n.characters === "string" ? n.characters : "",
    ...(tuple ? { style: tuple } : {}),
  };
}

const NOISE_NAME_RE = /^(rectangle|frame|group|ellipse|vector|image|line)\s*\d*$/i;
function meaningfulName(name: any): boolean {
  if (typeof name !== "string") return false;
  const n = name.trim();
  if (!n) return false;
  if (NOISE_NAME_RE.test(n)) return false;
  return n.includes(" ") || n.length > 10;
}
```

- [ ] **Step 4: Run the test, expect it to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/compactTree.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/compactTree.ts studio/__tests__/server/figma/compactTree.test.ts
git commit -m "feat(studio/figma-ingest): compact figmanage trees"
```

---

### Task 6: `compactTree` — edge cases

**Files:**
- Test: `studio/__tests__/server/figma/compactTree.test.ts` (extend)

- [ ] **Step 1: Add failing edge-case tests**

Append to `studio/__tests__/server/figma/compactTree.test.ts`:

```ts
describe("compactTree (edge cases)", () => {
  it("drops zero-size nodes", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        { id: "a", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 } },
        { id: "b", type: "TEXT", characters: "keep me",
          absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
          style: { fontSize: 12, lineHeightPx: 16 } },
      ],
    });
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0].type).toBe("text");
  });

  it("collapses passthrough groups", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [{
        id: "grp", type: "GROUP", name: "Group 1",
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        children: [{
          id: "inner", type: "TEXT", characters: "hello",
          absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
          style: { fontSize: 12, lineHeightPx: 16 },
        }],
      }],
    });
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0].type).toBe("text");
    expect(tree.children?.[0].id).toBe("0.0");
  });

  it("filters noisy layer names", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME", name: "Rectangle 47",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [],
    });
    expect(tree.name).toBeUndefined();
  });

  it("caps depth and emits a warning", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fx = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../../fixtures/figma/oversized.json"), "utf-8"));
    const { warnings } = compactTree(fx.root.document);
    expect(warnings.some((w) => /depth cap|node cap/.test(w))).toBe(true);
  });

  it("preserves auto-layout fields", () => {
    const { tree } = compactTree({
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 400 },
      layoutMode: "VERTICAL", itemSpacing: 12,
      paddingTop: 16, paddingRight: 12, paddingBottom: 16, paddingLeft: 12,
      counterAxisAlignItems: "CENTER", primaryAxisAlignItems: "MIN",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      children: [],
    });
    expect(tree.layout?.direction).toBe("col");
    expect(tree.layout?.gap).toBe(12);
    expect(tree.layout?.padding).toEqual([16, 12, 16, 12]);
    expect(tree.layout?.align).toBe("center");
    expect(tree.layout?.justify).toBe("start");
  });
});
```

- [ ] **Step 2: Run the tests, expect them to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/compactTree.test.ts`
Expected: PASS — 6 tests total.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/server/figma/compactTree.test.ts
git commit -m "test(studio/figma-ingest): cover compactTree edge cases"
```

---

### Task 7: `resolveTokens` — test + implementation

**Files:**
- Test: `studio/__tests__/server/figma/resolveTokens.test.ts`
- Create: `studio/server/figma/resolveTokens.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figma/resolveTokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTokens } from "../../../server/figma/resolveTokens";
import { compactTree } from "../../../server/figma/compactTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

describe("resolveTokens", () => {
  it("maps bound color and spacing variables to token names", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(fxDir, "with-variables.json"), "utf-8"));
    const rawNode = fx.node["1:2"].document;
    const { tree } = compactTree(rawNode);

    const { tree: resolvedTree, tokens, warnings } = resolveTokens(tree, rawNode, fx.variables);

    expect(warnings).toEqual([]);
    expect(resolvedTree.style?.fill).toBe("surface/default");
    expect(resolvedTree.layout?.gap).toBe(12);     // numeric value still present
    expect(tokens.colors["surface/default"]).toBe("#FFFFFF");
    expect(tokens.spacing["spacing/md"]).toBe(12);
  });

  it("leaves unbound fills as raw hex and warns in diagnostics", () => {
    const unbound = {
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      children: [],
    };
    const { tree } = compactTree(unbound);
    const { tree: resolved, tokens, warnings } = resolveTokens(tree, unbound, { variables: {} });
    expect(resolved.style?.fill).toBe("#000000");
    expect(Object.keys(tokens.colors)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/unbound/i);
  });

  it("tolerates a missing variables payload", () => {
    const node = {
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [],
    };
    const { tree } = compactTree(node);
    const { tokens, warnings } = resolveTokens(tree, node, null);
    expect(tokens.colors).toEqual({});
    expect(warnings.some((w) => /variables unavailable/i.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/resolveTokens.test.ts`
Expected: FAIL — `Cannot find module '../../../server/figma/resolveTokens'`.

- [ ] **Step 3: Implement `resolveTokens`**

Create `studio/server/figma/resolveTokens.ts`:

```ts
import type { CompactNode, ResolvedTokens } from "./types";

export interface ResolveResult {
  tree: CompactNode;
  tokens: ResolvedTokens;
  warnings: string[];
}

/**
 * Walk the compacted tree and rewrite any style value that is bound to a
 * Figma variable with the variable's name (e.g. "surface/default"). Raw
 * values stay in place when there is no binding.
 *
 * The raw figmanage node tree (`rawRoot`) is walked in parallel so we can
 * read `boundVariables` — we could not preserve them through compactTree
 * without inflating every CompactNode.
 */
export function resolveTokens(
  tree: CompactNode,
  rawRoot: any,
  variablesPayload: any | null,
): ResolveResult {
  const tokens: ResolvedTokens = { colors: {}, typography: {}, spacing: {} };
  const warnings: string[] = [];

  const vars = variablesPayload?.variables;
  if (!vars || typeof vars !== "object") {
    warnings.push("variables unavailable; styles left raw");
    return { tree, tokens, warnings };
  }

  // Cross-walk trees by path. The raw tree may have different structure
  // (passthrough groups were collapsed), so we instead build an index of
  // raw nodes keyed by a synthetic path that matches compactTree's
  // convention when no collapsing happened. When the paths diverge, we
  // fall back to best-effort lookup by node name.
  const rawByPath = indexRaw(rawRoot);

  function recur(node: CompactNode): CompactNode {
    const raw = rawByPath.get(node.id);
    const nextStyle = { ...node.style } as NonNullable<CompactNode["style"]>;

    if (raw?.fills && nextStyle.fill) {
      const tokenName = readColorVar(raw.fills, vars);
      if (tokenName) {
        tokens.colors[tokenName] = nextStyle.fill;
        nextStyle.fill = tokenName;
      } else {
        warnings.push(`unbound fill at ${node.id}`);
      }
    }
    if (raw?.strokes && nextStyle.stroke) {
      const tokenName = readColorVar(raw.strokes, vars);
      if (tokenName) {
        tokens.colors[tokenName] = nextStyle.stroke;
        nextStyle.stroke = tokenName;
      }
    }

    // Spacing: itemSpacing → tokens.spacing, but keep layout.gap numeric
    // so the prompt still shows a usable pixel value.
    if (raw?.boundVariables?.itemSpacing && typeof raw.itemSpacing === "number") {
      const name = vars[raw.boundVariables.itemSpacing.id]?.name;
      if (name) tokens.spacing[name] = raw.itemSpacing;
    }

    const next: CompactNode = { ...node };
    if (Object.keys(nextStyle).length) next.style = nextStyle;
    if (node.children) next.children = node.children.map(recur);
    return next;
  }

  const nextTree = recur(tree);
  return { tree: nextTree, tokens, warnings };
}

function readColorVar(paints: any[], vars: Record<string, any>): string | undefined {
  const solid = paints.find((p) => p?.type === "SOLID" && p.visible !== false);
  const aliasId = solid?.boundVariables?.color?.id;
  if (!aliasId) return undefined;
  return vars[aliasId]?.name;
}

function indexRaw(root: any): Map<string, any> {
  const out = new Map<string, any>();
  function recur(n: any, pathId: string, depth: number): void {
    if (!n || typeof n !== "object") return;
    if (depth > 20) return;
    out.set(pathId, n);
    const kids: any[] = Array.isArray(n.children) ? n.children : [];
    kids.forEach((k, i) => recur(k, `${pathId}.${i}`, depth + 1));
  }
  recur(root, "0", 0);
  return out;
}
```

- [ ] **Step 4: Run the test, expect it to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/resolveTokens.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/resolveTokens.ts studio/__tests__/server/figma/resolveTokens.test.ts
git commit -m "feat(studio/figma-ingest): resolve figma variables to token names"
```

---

### Task 8: `figmaCli.getVariables` wrapper

**Files:**
- Modify: `studio/server/figmaCli.ts`
- Test: `studio/__tests__/server/figmaCli.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

Append to `studio/__tests__/server/figmaCli.test.ts` (match the existing mocked-spawn pattern at the top of that file):

```ts
describe("getVariables", () => {
  it("returns parsed JSON when figmanage exits 0", async () => {
    spawnMock.mockReturnValueOnce(mockSpawn(JSON.stringify({ variables: { x: { name: "t" } } }), 0));
    const { getVariables } = await import("../../server/figmaCli");
    const r = await getVariables("AbC123");
    expect(r).toEqual({ variables: { x: { name: "t" } } });
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["reading", "get-variables", "AbC123", "--json"],
      expect.any(Object),
    );
  });

  it("returns null on non-zero exit instead of throwing", async () => {
    spawnMock.mockReturnValueOnce(mockSpawn("boom", 2));
    const { getVariables } = await import("../../server/figmaCli");
    expect(await getVariables("AbC123")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, expect them to fail**

Run: `pnpm -C studio exec vitest run __tests__/server/figmaCli.test.ts`
Expected: new tests FAIL — `getVariables is not a function`.

- [ ] **Step 3: Add `getVariables` to `figmaCli.ts`**

Open `studio/server/figmaCli.ts`, add at the bottom of the file (after `figmaLoginWithPat`):

```ts
/**
 * Fetch the Figma file's local variable definitions. Returns `null` rather
 * than throwing on figmanage failure — variables are best-effort input to
 * token resolution. A missing response degrades to "tokens left raw" and
 * does not block ingest.
 */
export async function getVariables(fileKey: string): Promise<any | null> {
  const r = await runFigmanage(["reading", "get-variables", fileKey, "--json"]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); }
  catch { return null; }
}
```

- [ ] **Step 4: Run the tests, expect them to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figmaCli.test.ts`
Expected: PASS — all existing tests + 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figmaCli.ts studio/__tests__/server/figmaCli.test.ts
git commit -m "feat(studio/figma-ingest): add figmanage getVariables wrapper"
```

---

### Task 9: `classifyComposites` — test + implementation

**Files:**
- Test: `studio/__tests__/server/figma/classifyComposites.test.ts`
- Create: `studio/server/figma/classifyComposites.ts`

This runs a single `claude --bare --model <classifierModel>` turn with a prompt that asks the model to reply with a strict JSON array. We parse that JSON, drop entries with unknown composite names or invalid paths. The existing `runClaudeTurn` infrastructure is overkill — we just need stdout capture — so we spawn directly and strip SSE framing.

The test stubs `claudeSpawner` (a thin module we create alongside) so no real `claude` process is spawned.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figma/classifyComposites.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { classifyComposites } from "../../../server/figma/classifyComposites";
import type { CompactNode } from "../../../server/figma/types";

function fakeSpawner(reply: string) {
  return vi.fn().mockResolvedValue({ text: reply, exitCode: 0 });
}

const tree: CompactNode = {
  id: "0", type: "frame",
  children: [
    { id: "0.0", type: "frame", name: "Sidebar" },
    { id: "0.1", type: "frame", name: "Main content" },
  ],
};
const compositeNames = ["AppShell", "NavSidebar", "VistaHeader"];

describe("classifyComposites", () => {
  it("parses a well-formed classifier reply", async () => {
    const reply = JSON.stringify([
      { composite: "AppShell",   path: "0",   confidence: "high",   reason: "outer chrome" },
      { composite: "NavSidebar", path: "0.0", confidence: "medium", reason: "fixed-width col" },
    ]);
    const spawn = fakeSpawner(reply);
    const { composites, warnings } = await classifyComposites(tree, compositeNames, { spawn });
    expect(composites).toHaveLength(2);
    expect(composites[0].composite).toBe("AppShell");
    expect(warnings).toEqual([]);
  });

  it("drops entries with unknown composite names", async () => {
    const reply = JSON.stringify([
      { composite: "ImaginaryThing", path: "0", confidence: "high", reason: "x" },
      { composite: "NavSidebar",     path: "0.0", confidence: "high", reason: "y" },
    ]);
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner(reply) });
    expect(composites.map((c) => c.composite)).toEqual(["NavSidebar"]);
    expect(warnings.some((w) => /unknown composite/i.test(w))).toBe(true);
  });

  it("drops entries with paths that do not exist in the tree", async () => {
    const reply = JSON.stringify([
      { composite: "AppShell", path: "9.9.9", confidence: "high", reason: "bogus" },
    ]);
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner(reply) });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /invalid path/i.test(w))).toBe(true);
  });

  it("returns empty on un-parseable reply", async () => {
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner("the model said hi") });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /parse/i.test(w))).toBe(true);
  });

  it("returns empty when the spawn fails (non-zero exit)", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "", exitCode: 1 });
    const { composites, warnings } = await classifyComposites(tree, compositeNames, { spawn });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /classifier failed/i.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/classifyComposites.test.ts`
Expected: FAIL — `Cannot find module '../../../server/figma/classifyComposites'`.

- [ ] **Step 3: Implement `classifyComposites`**

Create `studio/server/figma/classifyComposites.ts`:

```ts
import { spawn } from "node:child_process";
import type { CompactNode, CompositeSuggestion, CompositeConfidence } from "./types";
import { resolveClaudeBin } from "../claudeBin";

export interface ClassifierSpawnResult {
  text: string;
  exitCode: number | null;
}

export interface ClassifyOptions {
  /** Injected for tests — defaults to spawning `claude --bare --model <model>`. */
  spawn?: (prompt: string) => Promise<ClassifierSpawnResult>;
  model?: string;
  timeoutMs?: number;
}

export interface ClassifyResult {
  composites: CompositeSuggestion[];
  warnings: string[];
}

const CONFIDENCE: Record<string, CompositeConfidence> = {
  high: "high", medium: "medium", low: "low",
};

export async function classifyComposites(
  tree: CompactNode,
  compositeNames: string[],
  opts: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const spawner = opts.spawn ?? defaultSpawner(opts.model, opts.timeoutMs ?? 15_000);
  const prompt = buildPrompt(tree, compositeNames);
  const warnings: string[] = [];

  let reply: ClassifierSpawnResult;
  try {
    reply = await spawner(prompt);
  } catch (err: any) {
    return { composites: [], warnings: [`classifier failed: ${err?.message ?? String(err)}`] };
  }

  if (reply.exitCode !== 0) {
    return { composites: [], warnings: [`classifier failed with exit ${reply.exitCode}`] };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(reply.text)); }
  catch {
    return { composites: [], warnings: [`classifier reply parse failed`] };
  }
  if (!Array.isArray(parsed)) {
    return { composites: [], warnings: [`classifier reply not an array`] };
  }

  const knownComposites = new Set(compositeNames);
  const validPaths = collectPaths(tree);

  const composites: CompositeSuggestion[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as any;
    const composite = String(r.composite ?? "");
    const path = String(r.path ?? "");
    const conf = CONFIDENCE[String(r.confidence ?? "").toLowerCase()];
    const reason = typeof r.reason === "string" ? r.reason : "";
    if (!knownComposites.has(composite)) {
      warnings.push(`dropped unknown composite "${composite}"`);
      continue;
    }
    if (!validPaths.has(path)) {
      warnings.push(`dropped invalid path "${path}" for ${composite}`);
      continue;
    }
    if (!conf) continue;
    composites.push({ composite, path, confidence: conf, reason });
  }
  return { composites, warnings };
}

function collectPaths(node: CompactNode, out: Set<string> = new Set()): Set<string> {
  out.add(node.id);
  node.children?.forEach((c) => collectPaths(c, out));
  return out;
}

function buildPrompt(tree: CompactNode, composites: string[]): string {
  return [
    "You are classifying a Figma node tree against a fixed catalog of React composites.",
    "Return ONLY a JSON array. No prose. No markdown fences. Each entry:",
    `  { "composite": "<one of catalog>", "path": "<node id from tree>",`,
    `    "confidence": "high|medium|low", "reason": "<<=80 chars>" }`,
    "Rules:",
    "- Only suggest composites from the catalog.",
    "- Paths must be exact ids from the tree below.",
    "- Prefer fewer, higher-confidence suggestions over many low ones.",
    "- If nothing fits, return `[]`.",
    "",
    `Catalog: ${composites.join(", ")}`,
    "",
    "Tree:",
    "```json",
    JSON.stringify(tree),
    "```",
  ].join("\n");
}

function extractJson(text: string): string {
  // The CLI occasionally wraps the JSON in prose/markdown fences. Pull the
  // first `[...]` segment we can find.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fence ? fence[1] : text;
  const m = stripped.match(/\[[\s\S]*\]/);
  return m ? m[0] : stripped.trim();
}

function defaultSpawner(modelOpt: string | undefined, timeoutMs: number) {
  return (prompt: string) =>
    new Promise<ClassifierSpawnResult>((resolve) => {
      const model = modelOpt
        ?? process.env.ARCADE_STUDIO_CLASSIFIER_MODEL?.trim()
        ?? "haiku";
      const bin = resolveClaudeBin();
      const proc = spawn(bin, ["--bare", "--model", model, "--print", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      proc.stdout.on("data", (c) => { text += c.toString(); });
      // Swallow stderr — we never surface it to the user; only exit code matters.
      proc.stderr.on("data", () => {});
      const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ text, exitCode });
      });
      proc.on("error", () => resolve({ text: "", exitCode: -1 }));
    });
}
```

- [ ] **Step 4: Run the tests, expect them to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/classifyComposites.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/classifyComposites.ts studio/__tests__/server/figma/classifyComposites.test.ts
git commit -m "feat(studio/figma-ingest): composite classifier via claude bare"
```

---

### Task 10: `promptBlock` — test + implementation

**Files:**
- Test: `studio/__tests__/server/figma/promptBlock.test.ts`
- Create: `studio/server/figma/promptBlock.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figma/promptBlock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFigmaContextBlock } from "../../../server/figma/promptBlock";
import type { IngestResult } from "../../../server/figma/types";

const result: IngestResult = {
  source: { fileKey: "k", nodeId: "1:2", url: "https://figma.com/design/k/x?node-id=1-2", fetchedAt: "t" },
  png: { path: "/p.png", widthPx: 1440, heightPx: 900 },
  tree: {
    id: "0", type: "frame", name: "App",
    style: { fill: "surface/default" },
    layout: { direction: "row" },
    children: [
      { id: "0.0", type: "frame", name: "Sidebar", layout: { direction: "col", width: 248, gap: 4 }, style: { fill: "surface/raised" } },
      { id: "0.1", type: "text", text: { content: "Home", style: "body-md" } },
    ],
  },
  tokens: { colors: { "surface/default": "#FFFFFF", "surface/raised": "#F5F5F5" }, typography: {}, spacing: {} },
  composites: [
    { composite: "AppShell", path: "0", confidence: "high", reason: "outer chrome" },
    { composite: "NavSidebar", path: "0.0", confidence: "high", reason: "248px col" },
  ],
  diagnostics: { warnings: [] },
};

describe("buildFigmaContextBlock", () => {
  it("emits a <figma_context> block with tokens, composites, and tree", () => {
    const s = buildFigmaContextBlock(result);
    expect(s.startsWith("<figma_context")).toBe(true);
    expect(s.endsWith("</figma_context>")).toBe(true);
    expect(s).toContain(`url="${result.source.url}"`);
    expect(s).toContain("resolved_tokens:");
    expect(s).toContain("surface/default");
    expect(s).toContain("suggested_composites:");
    expect(s).toContain("AppShell");
    expect(s).toContain("NavSidebar");
    expect(s).toContain("tree:");
    expect(s).toContain("App");
    expect(s).toContain("Sidebar");
  });

  it("indents tree children by depth", () => {
    const s = buildFigmaContextBlock(result);
    const treeSection = s.slice(s.indexOf("tree:"));
    const lines = treeSection.split("\n").filter((l) => l.startsWith("  -") || l.startsWith("    -"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // At least one line at depth 1 (two spaces), at least one at depth 2 (four).
    expect(lines.some((l) => l.startsWith("  -"))).toBe(true);
    expect(lines.some((l) => l.startsWith("    -"))).toBe(true);
  });

  it("omits empty token categories", () => {
    const s = buildFigmaContextBlock({ ...result,
      tokens: { colors: {}, typography: {}, spacing: {} } });
    expect(s).not.toContain("colors:");
    expect(s).not.toContain("typography:");
    expect(s).not.toContain("spacing:");
  });

  it("omits composites section when empty", () => {
    const s = buildFigmaContextBlock({ ...result, composites: [] });
    expect(s).not.toContain("suggested_composites:");
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/promptBlock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `promptBlock`**

Create `studio/server/figma/promptBlock.ts`:

```ts
import type { CompactNode, IngestResult } from "./types";

export function buildFigmaContextBlock(r: IngestResult): string {
  const lines: string[] = [];
  lines.push(`<figma_context url="${r.source.url}">`);

  const hasTokens = Object.keys(r.tokens.colors).length
    || Object.keys(r.tokens.typography).length
    || Object.keys(r.tokens.spacing).length;
  if (hasTokens) {
    lines.push("resolved_tokens:");
    if (Object.keys(r.tokens.colors).length) {
      lines.push(`  colors: ${yamlInlineMap(r.tokens.colors)}`);
    }
    if (Object.keys(r.tokens.typography).length) {
      lines.push(`  typography: ${yamlInlineMap(r.tokens.typography)}`);
    }
    if (Object.keys(r.tokens.spacing).length) {
      lines.push(`  spacing: ${yamlInlineMap(r.tokens.spacing)}`);
    }
    lines.push("");
  }

  if (r.composites.length) {
    lines.push("suggested_composites:");
    for (const c of r.composites) {
      lines.push(`  - ${padRight(c.composite, 16)} (${c.confidence}) at ${c.path} — ${c.reason}`);
    }
    lines.push("");
  }

  lines.push("tree:");
  writeTree(r.tree, 1, lines);

  lines.push("</figma_context>");
  return lines.join("\n");
}

function writeTree(node: CompactNode, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  const label = describeNode(node);
  out.push(`${indent}- ${label}`);
  for (const c of node.children ?? []) writeTree(c, depth + 1, out);
}

function describeNode(n: CompactNode): string {
  const parts: string[] = [n.type];
  if (n.name) parts.push(`"${n.name}"`);
  if (n.style?.fill) parts.push(`fill=${n.style.fill}`);
  if (n.layout) {
    parts.push(`layout=${n.layout.direction}`);
    if (n.layout.width !== undefined) parts.push(`width=${n.layout.width}`);
    if (n.layout.height !== undefined) parts.push(`height=${n.layout.height}`);
    if (n.layout.gap !== undefined) parts.push(`gap=${n.layout.gap}`);
    if (n.layout.padding) parts.push(`padding=[${n.layout.padding.join(",")}]`);
  }
  if (n.text?.content) parts.push(`text="${n.text.content.slice(0, 60)}"`);
  if (n.text?.style) parts.push(`style=${n.text.style}`);
  return parts.join(" ");
}

function yamlInlineMap(obj: Record<string, string | number>): string {
  const pairs = Object.entries(obj).map(([k, v]) =>
    typeof v === "number" ? `${k}: ${v}` : `${k}: "${v}"`);
  return `{ ${pairs.join(", ")} }`;
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
```

- [ ] **Step 4: Run the test, expect it to pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figma/promptBlock.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/promptBlock.ts studio/__tests__/server/figma/promptBlock.test.ts
git commit -m "feat(studio/figma-ingest): build figma_context YAML prompt block"
```

---

### Task 11: `figmaIngest` orchestrator — cache + dedupe

**Files:**
- Test: `studio/__tests__/server/figmaIngest.test.ts`
- Create: `studio/server/figmaIngest.ts`

This task builds the orchestrator with an in-memory LRU and pending-promise dedupe. It composes the four sub-steps. We inject all external functions (figmanage calls, classifier, PNG export) so the test can run without a real process.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/figmaIngest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFigmaIngest } from "../../server/figmaIngest";
import type { IngestResult } from "../../server/figma/types";

function simpleNode() {
  return {
    id: "1:2", type: "FRAME", name: "Card",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    children: [],
  };
}

function makeDeps(overrides: Partial<Parameters<typeof createFigmaIngest>[0]> = {}) {
  return {
    getNode: vi.fn().mockResolvedValue({ "1:2": { document: simpleNode() } }),
    getVariables: vi.fn().mockResolvedValue(null),
    exportPng: vi.fn().mockResolvedValue({ path: "/tmp/shot.png", widthPx: 1440, heightPx: 900 }),
    classify: vi.fn().mockResolvedValue({ composites: [], warnings: [] }),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("figmaIngest", () => {
  it("composes sub-steps into an IngestResult", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const outcome = await ingest.ingest("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.source.fileKey).toBe("file");
    expect(outcome.tree.id).toBe("0");
    expect(deps.getNode).toHaveBeenCalledTimes(1);
    expect(deps.classify).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent ingest calls for the same key", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const url = "https://figma.com/design/file?node-id=1-2";
    const [a, b] = await Promise.all([
      ingest.ingest("file", "1:2", url),
      ingest.ingest("file", "1:2", url),
    ]);
    expect(a).toStrictEqual(b);
    expect(deps.getNode).toHaveBeenCalledTimes(1);
  });

  it("serves hits from the cache without re-fetching", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    await ingest.ingest("file", "1:2", url);
    await ingest.ingest("file", "1:2", url);
    expect(deps.getNode).toHaveBeenCalledTimes(1);
  });

  it("returns a failure outcome if figmanage getNode throws", async () => {
    const deps = makeDeps({ getNode: vi.fn().mockRejectedValue(new Error("not found")) });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const outcome = await ingest.ingest("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    expect(outcome.ok).toBe(false);
  });

  it("getPending returns an in-flight promise", async () => {
    let resolveFn!: (v: any) => void;
    const deps = makeDeps({
      getNode: vi.fn().mockImplementation(() => new Promise((r) => { resolveFn = r; })),
    });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    const p = ingest.ingest("file", "1:2", url);
    const pending = ingest.getPending("file", "1:2");
    expect(pending).toBeDefined();
    resolveFn({ "1:2": { document: simpleNode() } });
    await p;
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -C studio exec vitest run __tests__/server/figmaIngest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `figmaIngest`**

Create `studio/server/figmaIngest.ts`:

```ts
import type {
  CompactNode, IngestOutcome, IngestResult, IngestFailure, ResolvedTokens,
} from "./figma/types";
import { compactTree } from "./figma/compactTree";
import { resolveTokens } from "./figma/resolveTokens";

export interface IngestDeps {
  getNode: (fileKey: string, nodeId: string) => Promise<any>;
  getVariables: (fileKey: string) => Promise<any | null>;
  exportPng: (fileKey: string, nodeId: string) => Promise<{ path: string; widthPx: number; heightPx: number } | null>;
  classify: (tree: CompactNode, composites: string[]) => Promise<{ composites: IngestResult["composites"]; warnings: string[] }>;
  now?: () => number;
}

export interface IngestConfig {
  composites: string[];
  cacheCapacity?: number;
  cacheTtlMs?: number;
}

export interface FigmaIngest {
  ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome>;
  getCached(fileKey: string, nodeId: string): IngestResult | undefined;
  getPending(fileKey: string, nodeId: string): Promise<IngestOutcome> | undefined;
}

interface CacheEntry { value: IngestResult; expiresAt: number }

export function createFigmaIngest(deps: IngestDeps, cfg: IngestConfig): FigmaIngest {
  const capacity = cfg.cacheCapacity ?? 32;
  const ttlMs = cfg.cacheTtlMs ?? 10 * 60 * 1000;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<IngestOutcome>>();
  const now = deps.now ?? Date.now;

  function cacheKey(fileKey: string, nodeId: string) { return `${fileKey}:${nodeId}`; }

  function cacheGet(key: string): IngestResult | undefined {
    const e = cache.get(key);
    if (!e) return undefined;
    if (e.expiresAt < now()) { cache.delete(key); return undefined; }
    // Refresh LRU order.
    cache.delete(key); cache.set(key, e);
    return e.value;
  }

  function cacheSet(key: string, value: IngestResult): void {
    cache.set(key, { value, expiresAt: now() + ttlMs });
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function runOnce(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const warnings: string[] = [];
    let rawDict: any;
    try { rawDict = await deps.getNode(fileKey, nodeId); }
    catch (err: any) {
      const failure: IngestFailure = {
        ok: false,
        reason: `figmanage getNode failed: ${err?.message ?? String(err)}`,
        source: { fileKey, nodeId, url },
      };
      return failure;
    }
    const rawDoc = pickDocument(rawDict, nodeId);
    if (!rawDoc) {
      return { ok: false, reason: "figmanage returned no document for nodeId", source: { fileKey, nodeId, url } };
    }

    const { tree: compacted, warnings: compactWarnings } = compactTree(rawDoc);
    warnings.push(...compactWarnings);

    const varsPayload = await deps.getVariables(fileKey).catch(() => null);
    const { tree: tokenedTree, tokens, warnings: tokenWarnings } = resolveTokens(compacted, rawDoc, varsPayload);
    warnings.push(...tokenWarnings);

    const png = await deps.exportPng(fileKey, nodeId).catch(() => null);
    if (!png) warnings.push("png export failed");

    const { composites, warnings: classifierWarnings } = cfg.composites.length
      ? await deps.classify(tokenedTree, cfg.composites)
      : { composites: [], warnings: [] };
    warnings.push(...classifierWarnings);

    const result: IngestResult = {
      source: { fileKey, nodeId, url, fetchedAt: new Date(now()).toISOString() },
      png,
      tree: tokenedTree,
      tokens,
      composites,
      diagnostics: { warnings },
    };
    cacheSet(cacheKey(fileKey, nodeId), result);
    return { ok: true, ...result };
  }

  async function ingest(fileKey: string, nodeId: string, url: string): Promise<IngestOutcome> {
    const key = cacheKey(fileKey, nodeId);
    const cached = cacheGet(key);
    if (cached) return { ok: true, ...cached };
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const p = runOnce(fileKey, nodeId, url).finally(() => { pending.delete(key); });
    pending.set(key, p);
    return p;
  }

  return {
    ingest,
    getCached(fileKey, nodeId) { return cacheGet(cacheKey(fileKey, nodeId)); },
    getPending(fileKey, nodeId) { return pending.get(cacheKey(fileKey, nodeId)); },
  };
}

function pickDocument(dict: any, nodeId: string): any | null {
  if (!dict || typeof dict !== "object") return null;
  const byId = dict[nodeId] ?? dict[nodeId.replace(":", "-")] ?? Object.values(dict)[0];
  return byId?.document ?? byId ?? null;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm -C studio exec vitest run __tests__/server/figmaIngest.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/server/figmaIngest.ts studio/__tests__/server/figmaIngest.test.ts
git commit -m "feat(studio/figma-ingest): orchestrator with lru + dedupe"
```

---

### Task 12: Wire orchestrator to real dependencies (singleton)

**Files:**
- Modify: `studio/server/figmaIngest.ts`

- [ ] **Step 1: Add a real-deps factory to the file**

Open `studio/server/figmaIngest.ts`.

At the top of the file, add these imports alongside the existing ones:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import {
  exportNodePng,
  getNode as figmanageGetNode,
  getVariables as figmanageGetVariables,
} from "./figmaCli";
import { classifyComposites } from "./figma/classifyComposites";
import { projectsRoot } from "./paths";
```

Just after the imports, add the ESM `__dirname` shim:

```ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

At the bottom of the file, append the singleton factory:

```ts
let singleton: FigmaIngest | null = null;
let cataloging: Promise<string[]> | null = null;

export async function getFigmaIngest(): Promise<FigmaIngest> {
  if (singleton) return singleton;
  cataloging ??= loadCompositeCatalog();
  const composites = await cataloging;
  singleton = createFigmaIngest(
    {
      getNode: (fileKey, nodeId) => figmanageGetNode(fileKey, nodeId),
      getVariables: (fileKey) => figmanageGetVariables(fileKey),
      exportPng: async (fileKey, nodeId) => {
        const dir = path.join(projectsRoot(), "_figma-ingest");
        await fs.mkdir(dir, { recursive: true });
        const out = path.join(dir, `${fileKey}_${nodeId.replace(/:/g, "-")}.png`);
        try {
          const filepath = await exportNodePng(fileKey, nodeId, out, 2);
          return { path: filepath, widthPx: 0, heightPx: 0 };
        } catch { return null; }
      },
      classify: (tree, names) => classifyComposites(tree, names),
    },
    { composites, cacheCapacity: 32, cacheTtlMs: 10 * 60_000 },
  );
  return singleton;
}

async function loadCompositeCatalog(): Promise<string[]> {
  try {
    const manifest = await fs.readFile(
      path.resolve(__dirname, "..", "prototype-kit", "KIT-MANIFEST.md"),
      "utf-8",
    );
    const names = new Set<string>();
    for (const m of manifest.matchAll(/^##\s+([A-Za-z][A-Za-z0-9]+)\s*\((?:composite|template)\)/gm)) {
      names.add(m[1]);
    }
    return [...names];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Re-run existing tests to confirm no regression**

Run: `pnpm -C studio exec vitest run __tests__/server/figmaIngest.test.ts`
Expected: PASS — 5 tests (existing ones still work because they use `createFigmaIngest` directly).

- [ ] **Step 3: Typecheck**

Run: `pnpm -C studio exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add studio/server/figmaIngest.ts
git commit -m "feat(studio/figma-ingest): wire real deps via singleton factory"
```

---

### Task 13: `POST /api/figma/ingest` endpoint

**Files:**
- Modify: `studio/server/middleware/figma.ts`
- Test: `studio/__tests__/server/middleware/figma-ingest.test.ts`

- [ ] **Step 1: Write the failing endpoint test**

Create `studio/__tests__/server/middleware/figma-ingest.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { figmaMiddleware } from "../../../server/middleware/figma";
import * as ingestModule from "../../../server/figmaIngest";

let server: http.Server; let port: number;

beforeEach(async () => {
  vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
    ingest: vi.fn().mockResolvedValue({
      ok: true,
      source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
      png: null, tree: { id: "0", type: "frame" },
      tokens: { colors: {}, typography: {}, spacing: {} },
      composites: [], diagnostics: { warnings: [] },
    }),
    getCached: vi.fn().mockReturnValue(undefined),
    getPending: vi.fn().mockReturnValue(undefined),
  });
  server = http.createServer(figmaMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => { server.close(); vi.restoreAllMocks(); });

describe("POST /api/figma/ingest", () => {
  it("accepts a Figma url and returns an IngestResult", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.figma.com/design/AbC/x?node-id=1-2" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tree.id).toBe("0");
  });

  it("accepts explicit fileKey + nodeId", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: "AbC", nodeId: "1:2" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 on a missing/malformed url", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/figma-ingest.test.ts`
Expected: FAIL — route not handled, returns 404.

- [ ] **Step 3: Add the handler**

Open `studio/server/middleware/figma.ts`. At the top, import:

```ts
import { getFigmaIngest } from "../figmaIngest";
import { parseFigmaUrl } from "../figmaCli";
```

Inside `figmaMiddleware()`, add this branch after the `"/api/figma/status"` branch and before the `POST /api/figma/auth/login` branch:

```ts
if (req.method === "POST" && url === "/api/figma/ingest") {
  let buf = ""; for await (const c of req) buf += c;
  let body: { url?: string; fileKey?: string; nodeId?: string };
  try { body = buf ? JSON.parse(buf) : {}; }
  catch {
    return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
  }

  let fileKey = body.fileKey;
  let nodeId = body.nodeId;
  let sourceUrl = body.url ?? "";
  if ((!fileKey || !nodeId) && body.url) {
    const parsed = parseFigmaUrl(body.url);
    if (!parsed) {
      return send(res, 400, { error: { code: "bad_url", message: "URL is not a recognized Figma link" } });
    }
    fileKey = parsed.fileId;
    nodeId = parsed.nodeId;
    sourceUrl = body.url;
  }
  if (!fileKey || !nodeId) {
    return send(res, 400, { error: { code: "bad_request", message: "url or (fileKey + nodeId) required" } });
  }

  const ingest = await getFigmaIngest();
  const outcome = await ingest.ingest(fileKey, nodeId, sourceUrl || `figma://${fileKey}/${nodeId}`);
  return send(res, 200, outcome);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/figma-ingest.test.ts`
Expected: PASS — 3 tests. Existing `figma.test.ts` should still pass too; confirm:

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/figma.test.ts __tests__/server/middleware/figma-ingest.test.ts`
Expected: PASS — 3 new + all existing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/figma.ts studio/__tests__/server/middleware/figma-ingest.test.ts
git commit -m "feat(studio/figma-ingest): POST /api/figma/ingest endpoint"
```

---

### Task 14: `chat.ts` picks up structured context

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Test: `studio/__tests__/server/middleware/chat-figma-context.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `studio/__tests__/server/middleware/chat-figma-context.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import * as ingestModule from "../../../server/figmaIngest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.join(__dirname, "../../fixtures/fake-claude.sh");

let tmp: string; let server: http.Server; let port: number;

beforeAll(() => fs.chmodSync(FAKE, 0o755));

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-chat-fig-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE;
  process.env.ARCADE_STUDIO_SKIP_SSO_CHECK = "1";
  // Tee everything the fake claude receives into a file so the test can assert
  // on prompt shape. The fake script is expected to write its last arg to
  // ARCADE_TEST_PROMPT_OUT (see Task 14b).
  process.env.ARCADE_TEST_PROMPT_OUT = path.join(tmp, "last-prompt.txt");
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  vi.restoreAllMocks();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
  delete process.env.ARCADE_TEST_PROMPT_OUT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/chat with Figma structured context", () => {
  it("injects <figma_context> when an IngestResult is cached", async () => {
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      getCached: vi.fn().mockReturnValue({
        source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
        png: null, tree: { id: "0", type: "frame", name: "App" },
        tokens: { colors: {}, typography: {}, spacing: {} },
        composites: [], diagnostics: { warnings: [] },
      }),
      getPending: vi.fn().mockReturnValue(undefined),
    });

    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        prompt: "build this https://www.figma.com/design/k/x?node-id=1-2",
      }),
    });
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf-8");
    expect(sent).toContain("<figma_context");
    expect(sent).toContain("</figma_context>");
    expect(sent).toContain("App");
  });

  it("proceeds without <figma_context> on cache miss + timeout", async () => {
    vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
      ingest: vi.fn(),
      getCached: vi.fn().mockReturnValue(undefined),
      getPending: vi.fn().mockReturnValue(undefined),
    });
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        prompt: "build this https://www.figma.com/design/k/x?node-id=1-2",
      }),
    });
    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf-8");
    expect(sent).not.toContain("<figma_context");
  });
});
```

- [ ] **Step 2: Teach the fake claude to dump its prompt**

Open `studio/__tests__/fixtures/fake-claude.sh` and add this line near the top (after the shebang but before any other logic):

```bash
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  # The claude CLI takes the prompt as the last non-flag argument. Dumping the
  # full argv is simpler and sufficient for assertion purposes.
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
```

(If the file already has an `ARCADE_TEST_PROMPT_OUT` hook, skip this step.)

- [ ] **Step 3: Run the chat-figma-context test, expect failure**

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/chat-figma-context.test.ts`
Expected: FAIL — `<figma_context>` isn't in prompt yet.

- [ ] **Step 4: Modify `chat.ts` to inject the block**

Open `studio/server/middleware/chat.ts`. At the top, add imports:

```ts
import { extractFigmaUrl } from "../../src/lib/figmaUrl";
import { parseFigmaUrl } from "../figmaCli";
import { getFigmaIngest } from "../figmaIngest";
import { buildFigmaContextBlock } from "../figma/promptBlock";
```

Add a helper above `runClaudeBranch`:

```ts
async function enrichPromptWithFigmaContext(prompt: string, images: string[]): Promise<{ prompt: string; images: string[] }> {
  const url = extractFigmaUrl(prompt);
  if (!url) return { prompt, images };
  const parsed = parseFigmaUrl(url);
  if (!parsed) return { prompt, images };

  const ingest = await getFigmaIngest();
  let result = ingest.getCached(parsed.fileId, parsed.nodeId);
  if (!result) {
    const pending = ingest.getPending(parsed.fileId, parsed.nodeId);
    if (pending) {
      const raced = await Promise.race([
        pending,
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ]);
      if (raced && "ok" in raced && raced.ok) {
        // Destructure to drop `ok`, yielding an IngestResult.
        const { ok, ...rest } = raced as any;
        void ok;
        result = rest;
      }
    }
  }
  if (!result) {
    console.warn("[studio] figma ingest miss; proceeding without structured context");
    return { prompt, images };
  }

  const block = buildFigmaContextBlock(result);
  const nextImages = result.png ? [...images, result.png.path] : images;
  return { prompt: `${prompt}\n\n${block}`, images: nextImages };
}
```

Then, inside `runClaudeBranch`, replace the line:

```ts
const { res, slug, prompt, images, project } = ctx;
```

with:

```ts
const { res, slug, project } = ctx;
const { prompt, images } = await enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? []);
```

- [ ] **Step 5: Re-run the test, expect pass**

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/chat-figma-context.test.ts`
Expected: PASS — 2 tests.

Also re-run the existing chat test to confirm no regression:

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/chat.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/middleware/chat-figma-context.test.ts studio/__tests__/fixtures/fake-claude.sh
git commit -m "feat(studio/figma-ingest): inject figma_context block into chat prompts"
```

---

### Task 15: Prefetch on paste / type in `PromptInput`

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`

No unit test — this is a one-line fire-and-forget fetch. The chat-middleware test already covers the end-to-end.

- [ ] **Step 1: Add the prefetch effect**

Open `studio/src/components/chat/PromptInput.tsx`. Find the block near the `setDetectedFigmaUrl` declaration. Add a new `useEffect` near the other hooks (after `detectedFigmaUrl` is declared):

```tsx
useEffect(() => {
  if (!detectedFigmaUrl) return;
  const ctrl = new AbortController();
  fetch("/api/figma/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: detectedFigmaUrl }),
    signal: ctrl.signal,
  }).catch(() => { /* fire-and-forget; server logs real failures */ });
  return () => ctrl.abort();
}, [detectedFigmaUrl]);
```

Ensure `useEffect` is in the React imports at the top of the file (it likely already is; add if not).

- [ ] **Step 2: Typecheck**

Run: `pnpm -C studio exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Re-run the full test suite to confirm**

Run: `pnpm -C studio run test`
(If this runs `vitest --run`, great. If it runs in watch mode, use `pnpm -C studio exec vitest run`.)
Expected: PASS — all tests.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/chat/PromptInput.tsx
git commit -m "feat(studio/figma-ingest): prefetch ingest on figma url detection"
```

---

### Task 16: SSE narration for ingest diagnostics

**Files:**
- Modify: `studio/server/middleware/chat.ts`

Surface a one-line `narration` event when structured context is attached, so users can see the system is "doing more" on Figma-referenced turns. Tiny but improves perceived intelligence.

- [ ] **Step 1: Modify `enrichPromptWithFigmaContext` to take a callback**

Open `studio/server/middleware/chat.ts`. Change the signature:

```ts
async function enrichPromptWithFigmaContext(
  prompt: string,
  images: string[],
  onNarration?: (text: string) => void,
): Promise<{ prompt: string; images: string[] }> {
```

Before the `return { prompt: ..., images: ... }` at the end, add:

```ts
  const parts = [`Figma context: ${result.composites.length} composites suggested`];
  if (result.diagnostics.warnings.length) {
    parts.push(`${result.diagnostics.warnings.length} diagnostic${result.diagnostics.warnings.length > 1 ? "s" : ""}`);
  }
  onNarration?.(parts.join(" · "));
```

- [ ] **Step 2: Pass a narration callback from `runClaudeBranch`**

In `runClaudeBranch`, replace the call:

```ts
const { prompt, images } = await enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? []);
```

with:

```ts
const { prompt, images } = await enrichPromptWithFigmaContext(
  ctx.prompt,
  ctx.images ?? [],
  (text) => {
    res.write(`event: narration\n`);
    res.write(`data: ${JSON.stringify({ kind: "narration", text })}\n\n`);
  },
);
```

- [ ] **Step 3: Run existing chat-figma-context tests**

Run: `pnpm -C studio exec vitest run __tests__/server/middleware/chat-figma-context.test.ts`
Expected: PASS — still 2 tests, still green (narration is additive).

- [ ] **Step 4: Commit**

```bash
git add studio/server/middleware/chat.ts
git commit -m "feat(studio/figma-ingest): narrate figma context attachment"
```

---

### Task 17: Live integration test (skipped by default)

**Files:**
- Create: `studio/__tests__/integration/figma-ingest.live.test.ts`

- [ ] **Step 1: Write the gated live test**

Create `studio/__tests__/integration/figma-ingest.live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getFigmaIngest } from "../../server/figmaIngest";

const SHOULD_RUN = process.env.FIGMA_LIVE_TESTS === "1";
const d = SHOULD_RUN ? describe : describe.skip;

d("live figma ingest (FIGMA_LIVE_TESTS=1)", () => {
  it("ingests a real Figma node end-to-end", async () => {
    const fileKey = process.env.FIGMA_LIVE_FILE_KEY;
    const nodeId = process.env.FIGMA_LIVE_NODE_ID;
    if (!fileKey || !nodeId) {
      throw new Error("set FIGMA_LIVE_FILE_KEY and FIGMA_LIVE_NODE_ID");
    }
    const ingest = await getFigmaIngest();
    const outcome = await ingest.ingest(fileKey, nodeId, `https://figma.com/design/${fileKey}/?node-id=${nodeId.replace(":", "-")}`);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.tree).toBeDefined();
    expect(outcome.source.fileKey).toBe(fileKey);
  }, 30_000);
});
```

- [ ] **Step 2: Verify it is skipped by default**

Run: `pnpm -C studio exec vitest run __tests__/integration/figma-ingest.live.test.ts`
Expected: PASS with 1 skipped.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/integration/figma-ingest.live.test.ts
git commit -m "test(studio/figma-ingest): add gated live integration test"
```

---

### Task 18: CHANGELOG entry

**Files:**
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Read the current top entry to match format**

Run: `head -30 studio/CHANGELOG.md`
Note the version heading format and the current top version.

- [ ] **Step 2: Add an entry**

Open `studio/CHANGELOG.md`. Under the topmost `## [unreleased]` heading (or add one at the top if the current top is already a released version), append:

```
### Added
- Figma references are now ingested as **structured context** before generation.
  When you paste a Figma URL, Studio silently prefetches the document tree,
  resolves bound design-system tokens, asks a quick classifier which
  `prototype-kit` composites fit, and attaches a frame PNG — all in parallel
  while you're still typing. The generator no longer has to reverse-engineer
  layout from pixels. Falls back to URL-only behavior if Figma auth is
  missing.

### Changed
- Studio now auto-exports a PNG of the referenced Figma node and attaches it
  to the chat turn (previously users had to paste a screenshot themselves).
```

- [ ] **Step 3: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): changelog entry for figma structured context"
```

---

### Task 19: Full suite + manual smoke

**Files:**
- No code changes.

- [ ] **Step 1: Run the full studio test suite**

Run: `pnpm run studio:test`
Expected: all tests PASS (same pass count as before + new tests from Tasks 5–17).

- [ ] **Step 2: Start the dev server**

Run: `pnpm run studio`
Open the browser that launches automatically.

- [ ] **Step 3: Smoke A — Figma URL, cache hit**

Create a new project. Paste a known Figma URL into the prompt input. Wait 2 seconds. In the server console, look for `[figmaIngest] ...`. Hit Send with a prompt like "build this". In the chat pane, observe a narration like `Figma context: N composites suggested`. Open the generated `index.tsx` — verify:
- Uses suggested composites (look for `NavSidebar`, `AppShell`, etc. where applicable).
- Fills use token names (`bg-surface-default` etc.) not arbitrary hex — or if your arcade-gen styling uses Tailwind utility classes, verify they reference the Figma-resolved tokens rather than inline `style={{ background: "#..." }}`.

- [ ] **Step 4: Smoke B — Figma auth missing**

In a second terminal: `figmanage logout`. Paste a Figma URL + submit a prompt. Observe in the server console that ingest returned `{ ok: false }`; observe in the chat pane that generation still proceeded. There should be no UI error.

Restore auth when done: re-run `figmanage login` from the Studio Settings modal.

- [ ] **Step 5: Smoke C — same node within 10 min**

Paste the same Figma URL again in a new prompt. Verify the server console shows only one `[figmaIngest]` line for this `(fileKey, nodeId)` pair across the session — the second submit should be a cache hit and emit no new line.

- [ ] **Step 6: If all three smokes pass, mark the plan done**

No commit here — the work is complete. If any smoke fails, file a follow-up task to address it.

---

## Self-Review Summary

**Spec coverage:**
- Compact tree: Tasks 5, 6.
- Resolved tokens: Tasks 7, 8.
- Composite classifier: Task 9.
- Prompt block: Task 10.
- Orchestrator + cache + dedupe + graceful degradation: Tasks 11, 12.
- `POST /api/figma/ingest`: Task 13.
- Chat-middleware injection + 10s await + graceful miss: Task 14.
- Prefetch on URL detect: Task 15.
- Narration / observability: Task 16.
- Integration test gate: Task 17.
- Changelog: Task 18.
- Reviewer checklist / smoke: Task 19.

**Deliberate omissions from the spec:**
- `ARCADE_STUDIO_CLASSIFIER_MODEL` env var — wired in Task 9 (default `haiku`, overridable at spawn time).
- "Pending-promise await up to 10s" — Task 14 (the `Promise.race` with a 10s timer).

**Risks I'd flag for the implementer:**
- `exportNodePng`'s returned `widthPx` / `heightPx` are set to `0` in Task 12 — the prompt block doesn't currently use them so it's fine, but if a later feature needs real pixel dimensions, we'll need to read the PNG header.
- `parseFigmaUrl` is imported from `server/figmaCli.ts` in several places — if that import chain ever gets cyclic (`chat.ts → figmaIngest.ts → figmaCli.ts` vs. `chat.ts → figmaCli.ts`), move `parseFigmaUrl` into `server/figma/types.ts` or a new `server/figma/url.ts`.
- Task 12's `loadCompositeCatalog` reads `KIT-MANIFEST.md` at singleton-init time. If the manifest is regenerated during a dev-server session, the catalog is stale until restart. Acceptable for v1; the manifest rarely changes mid-session.
