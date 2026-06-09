# Figma Export — Widen to Primitive-Level Real Components — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Tasks marked **[TDD]** are subagent-friendly test-first code. Tasks marked **[BRIDGE]** / **[LIVE]** are orchestrator-driven (need the figma-console Bridge on Arcade 0.3 + the Studio dev server); a subagent cannot do them.

**Goal:** Make the Figma export produce the real Arcade Studio UI — real primitive component instances (bubbles, buttons, Computer Items, avatars, icons) assembled inside auto-layout frames — by replacing the DOM-stamp serializer front-end with a runtime React **fiber walk**, reusing the proven planner / executor / mapping behind it.

**Architecture:** A new `fiberWalk` reads the rendered frame's React fiber tree (component name + props from the fiber, geometry + style from the fiber's host DOM node) and produces the EXISTING `SljNode` tree. At a mapped primitive it emits a component node and prunes (the planner already does instance + text-extract + no-recurse). Composites/hosts become element frames; recognized primitives + icons at any depth become component nodes. The existing `planFigmaOps` → `componentMap`/`tokenMap`/(new)`iconMap` → `executeFigmaOps` pipeline is reused unchanged.

**Tech Stack:** TypeScript, Vitest (jsdom + node), React 19 fiber internals, figma-console Bridge (live tasks only).

**Spec:** `docs/superpowers/specs/2026-06-08-figma-export-widen-design.md` (fiber-walk spike PROVEN section).

---

## Proven facts (from the spike + code read — build on these, don't re-discover)

- Fiber reached via `domNode["__reactFiber$…"]`; climb `.return` to root, walk `.child`/`.sibling`.
- `nameOf(fiber)`: `type.name`/`type.displayName` for function components; `type.displayName` or `type.render.name` for forwardRef/memo (objects); `null` for host (string `type`) and text.
- A component fiber's geometry/style comes from its **host DOM node**: descend `.child` until `stateNode instanceof Element`.
- Live-confirmed: `ChatBubble{variant:"sender"}`, `IconButton{variant,size}`→`<button>`, `Item{active,children:"<label>"}`→239×36 div, `ChevronLeftSmall{size:16}`→`<svg>`. `.map`-rows resolve (Item×34, ChatBubble×30).
- Radix/wrapper noise to skip (descend through, emit nothing): `MenuProvider`, `DropdownMenuProvider`, `(obj component)` with no usable name, `Root`/`Group` from Radix.
- The planner (`planSlj.ts:51-73`) ALREADY does prune-with-text for mapped components (instance + `firstText` + no recurse). No planner change needed for pruning.
- Studio composites that are NOT in 0.3 (ComputerSidebar, ComputerPage, ChatMessages, the panel) → unmapped → planner emits a frame + recurses. Correct.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `studio/src/export/fiberTypes.ts` | minimal fiber type + `FiberReader` interface (testable seam) | T1 |
| `studio/src/export/fiberWalk.ts` | walk fiber tree → `SljNode` (component/element, prune-with-text, skip-list) | T2,T3,T4 |
| `studio/src/export/figma/iconEntries.ts` | arcade-gen icon name → `Icons/*` Figma key + size | T5 [BRIDGE] |
| `studio/src/export/figma/iconMap.ts` | `findIconMapping(name)` lookup | T6 |
| `studio/src/export/figma/componentEntries.ts` (MOD) | add primitives + composite sub-parts (Computer Item, Avatar, …) | T7 [BRIDGE] |
| `studio/src/lib/exportFrameToSlj.ts` (MOD) | use fiberWalk instead of serializeFrame | T8 |
| `studio/server/plugins/frameMountPlugin.ts` + `cloudflare/bundler.ts` (MOD) | `keepNames: true` | T8 |
| `studio/__tests__/export/fiberWalk.test.ts` | fiber-walk unit tests (fake fiber trees) | T2-T4 |
| `studio/__tests__/export/figma/iconMap.test.ts` | icon lookup tests | T6 |

---

## Task 1 [TDD]: Fiber types + reader seam

**Files:** Create `studio/src/export/fiberTypes.ts` + test `studio/__tests__/export/fiberTypes.test.ts`.

The fiber walk must be unit-testable WITHOUT a real React tree. Define a minimal
fiber shape + a `FiberReader` that abstracts the two real-DOM reads (name is on
the fiber; box+style come from the host DOM node).

- [ ] **Step 1: failing test**

```ts
// studio/__tests__/export/fiberTypes.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fiberName, type MinimalFiber } from "../../src/export/fiberTypes";

describe("fiberName", () => {
  it("reads a function component name", () => {
    expect(fiberName({ type: function ChatBubble() {}, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("ChatBubble");
  });
  it("prefers displayName over name", () => {
    const fn: any = function X() {}; fn.displayName = "ComputerSidebar.Item";
    expect(fiberName({ type: fn, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("ComputerSidebar.Item");
  });
  it("reads forwardRef/memo object component via render name", () => {
    const obj: any = { render: function IconButton() {} };
    expect(fiberName({ type: obj, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("IconButton");
  });
  it("returns null for host string types and text", () => {
    expect(fiberName({ type: "div", child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBeNull();
    expect(fiberName({ type: null, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBeNull();
  });
});
```

- [ ] **Step 2: run → FAIL** `pnpm run studio:test __tests__/export/fiberTypes.test.ts`

- [ ] **Step 3: implement**

```ts
// studio/src/export/fiberTypes.ts
import type { Box } from "./slj";

/** The subset of a React fiber the walk reads. A real React 19 fiber satisfies this. */
export interface MinimalFiber {
  type: unknown;                       // string (host) | function | {render|displayName} | null (text)
  child: MinimalFiber | null;
  sibling: MinimalFiber | null;
  memoizedProps: Record<string, unknown> | null;
  stateNode?: unknown;                 // Element for host fibers
}

/** Component name for a fiber, or null for host elements / text / unnamed. */
export function fiberName(f: MinimalFiber): string | null {
  const t = f.type as any;
  if (typeof t === "function") return t.displayName || t.name || null;
  if (t && typeof t === "object") return t.displayName || (t.render && (t.render.displayName || t.render.name)) || null;
  return null; // host string, or null (text)
}

/** Abstracts the host-DOM reads (geometry + computed style + tag + text) for a
 *  fiber, so fiberWalk is testable with fakes. The live impl resolves the
 *  fiber's host DOM node (descend .child to first Element stateNode). */
export interface FiberReader {
  /** Host tag for a host fiber (e.g. "div","svg","button"), or null if none. */
  hostTag(f: MinimalFiber): string | null;
  /** Frame-relative box of the fiber's host node. */
  box(f: MinimalFiber): Box;
  /** A computed-style getter for the fiber's host node (kebab CSS props). */
  style(f: MinimalFiber): { getPropertyValue(prop: string): string };
  /** Visible text directly in the fiber's host node subtree (for prune-with-text + text leaves). */
  text(f: MinimalFiber): string | null;
}
```

- [ ] **Step 4: run → PASS (4)**  •  **Step 5: commit**
```bash
git add studio/src/export/fiberTypes.ts studio/__tests__/export/fiberTypes.test.ts
git commit -m "feat(studio/export): fiber types + reader seam"
```
End every commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 2 [TDD]: fiberWalk — host elements + text + skip-list

**Files:** Create `studio/src/export/fiberWalk.ts` + test `studio/__tests__/export/fiberWalk.test.ts`.

`walkFiber(rootFiber, ctx)` → `SljNode`. ctx = `{ reader: FiberReader; tokenIndex; isComponent(name): "primitive"|"composite"|"icon"|null; resolveColor(value): string }`. This task: host fibers → ElementNode (tag/box/layout/style), text → text ElementNode, skip-list wrappers transparent. Component handling is T3, icons T4. Use injected fakes — no React.

- [ ] **Step 1: failing test** (fake fibers + fake reader)

```ts
// studio/__tests__/export/fiberWalk.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 10, height: 10 };
function host(tag: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  return chain({ type: tag, memoizedProps: props } as any, children);
}
function comp(name: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  const fn: any = function () {}; Object.defineProperty(fn, "name", { value: name });
  return chain({ type: fn, memoizedProps: props } as any, children);
}
function chain(node: any, children: MinimalFiber[]): MinimalFiber {
  node.child = children[0] ?? null; node.sibling = null;
  for (let i = 0; i < children.length - 1; i++) (children[i] as any).sibling = children[i + 1];
  return node;
}
const reader: FiberReader = {
  hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
  box: () => box,
  style: () => ({ getPropertyValue: (p) => (p === "display" ? "flex" : p === "flex-direction" ? "column" : p === "background-color" ? "rgba(0, 0, 0, 0)" : "0px") }),
  text: (f) => (f as any).__text ?? null,
};
const ctx: WalkCtx = {
  reader,
  isComponent: (n) => (n === "ChatBubble" ? "primitive" : n === "ComputerSidebar" ? "composite" : null),
  resolveColor: (v) => v,
  isSkippable: (n) => n === "MenuProvider" || n === "Root",
};

describe("walkFiber — host + text + skip", () => {
  it("emits an element node for a host div", () => {
    const root = host("div");
    const node = walkFiber(root, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
  });
  it("skips a skippable wrapper, descending to its child host", () => {
    const inner = host("section");
    const wrapper = comp("MenuProvider", [inner]);
    const node = walkFiber(wrapper, ctx);
    // skip-list wrapper is transparent: the result is the child host node
    expect(isElementNode(node) && node.tag).toBe("section");
  });
  it("emits a text node for a fiber whose host carries text and no element children", () => {
    const t = host("span"); (t as any).__text = "Hello";
    const node = walkFiber(t, ctx);
    expect(isElementNode(node) && node.tag).toBe("text");
    if (isElementNode(node)) expect(node.style.characters).toBe("Hello");
  });
});
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement** (host + text + skip; component/icon branches throw "TODO T3" placeholder ONLY as `return null`-guarded unreachable — actually implement the full file here so later tasks just add tests; see below)

```ts
// studio/src/export/fiberWalk.ts
import type { Box, ElementNode, ElementStyle, Layout, SljNode } from "./slj";
import { inferLayout, type StyleLike } from "./inferLayout";
import { fiberName, type FiberReader, type MinimalFiber } from "./fiberTypes";

export interface WalkCtx {
  reader: FiberReader;
  /** Classify a component name: a mapped Figma primitive, an icon, a composite (frame+recurse), or null=unknown (treat as composite). */
  isComponent: (name: string) => "primitive" | "icon" | "composite" | null;
  /** Resolve a computed color to a token name or raw value (the existing tokenIndex resolveToken, curried). */
  resolveColor: (value: string) => string;
  /** Radix/internal wrappers to pass through transparently. */
  isSkippable: (name: string) => boolean;
}

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", "rgba(0,0,0,0)"]);

function readStyleLike(s: { getPropertyValue(p: string): string }): StyleLike {
  const g = (p: string) => s.getPropertyValue(p);
  return { display: g("display"), flexDirection: g("flex-direction"), columnGap: g("column-gap"), rowGap: g("row-gap"),
    paddingTop: g("padding-top"), paddingRight: g("padding-right"), paddingBottom: g("padding-bottom"), paddingLeft: g("padding-left"),
    alignItems: g("align-items"), marginLeft: g("margin-left") };
}

function elementStyle(s: { getPropertyValue(p: string): string }, resolveColor: (v: string) => string): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("background-color");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveColor(bg);
  const radius = parseFloat(s.getPropertyValue("border-top-left-radius"));
  if (Number.isFinite(radius) && radius > 0) out.cornerRadius = radius;
  const sw = parseFloat(s.getPropertyValue("border-top-width"));
  if (Number.isFinite(sw) && sw > 0) out.stroke = { color: resolveColor(s.getPropertyValue("border-top-color")), width: sw };
  return out;
}

/** Serializable scalar props only (drop functions, ReactNodes). */
function scalarProps(props: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

/** The element-children fibers under a fiber: descend skip-list wrappers, collect
 *  the next host OR named-component fibers (stop at each — do not go inside them). */
function childFibers(f: MinimalFiber, ctx: WalkCtx): MinimalFiber[] {
  const out: MinimalFiber[] = [];
  const visit = (c: MinimalFiber | null) => {
    for (let n = c; n; n = n.sibling) {
      const nm = fiberName(n);
      if (nm && ctx.isSkippable(nm)) { visit(n.child); continue; } // transparent
      if (nm || ctx.reader.hostTag(n) !== null) { out.push(n); continue; } // a real node (component or host)
      visit(n.child); // unnamed non-host (fragment/context) → descend
    }
  };
  visit(f.child);
  return out;
}

export function walkFiber(rootFiber: MinimalFiber, ctx: WalkCtx): SljNode {
  function walk(f: MinimalFiber): SljNode | null {
    const nm = fiberName(f);

    // Skip-list wrapper: pass through to its single meaningful child.
    if (nm && ctx.isSkippable(nm)) {
      const kids = childFibers(f, ctx);
      return kids.length ? walk(kids[0]) : null;
    }

    if (nm) {
      const cls = ctx.isComponent(nm);
      if (cls === "primitive" || cls === "icon") {
        // PRUNE-WITH-TEXT: emit a component node; do NOT serialize internals.
        // Text is carried so the planner's firstText() override works: attach a
        // single text child when the host subtree has visible text.
        const box = ctx.reader.box(f);
        const text = ctx.reader.text(f);
        const children: SljNode[] = text ? [{ kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] }] : [];
        return { kind: "component", component: nm, source: cls === "icon" ? "arcade/components" : "arcade/components", props: scalarProps(f.memoizedProps), box, layout: null, children };
      }
      // composite / unknown → element frame that recurses (planner maps unmapped → frame + recurse)
      // represented as a component node so the planner's unmapped path makes a frame;
      // but composites aren't in the map, so use an element frame to carry layout/box.
    }

    // host element (or composite treated as frame)
    const tag = ctx.reader.hostTag(f);
    const box = ctx.reader.box(f);
    const text = ctx.reader.text(f);
    const kids = childFibers(f, ctx);
    // text leaf: a host with text and no element children
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] };
    }
    const childNodes = kids.map(walk).filter((n): n is SljNode => n !== null);
    const childBoxes = kids.map((k) => ctx.reader.box(k));
    const s = ctx.reader.style(f);
    const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);
    return { kind: "element", tag: tag ?? "div", box, layout, style: elementStyle(s, ctx.resolveColor), children: childNodes };
  }
  const root = walk(rootFiber);
  if (!root) throw new Error("fiberWalk: root produced no node");
  return root;
}
```

- [ ] **Step 4: run → PASS (3)**  •  **Step 5: commit**
```bash
git add studio/src/export/fiberWalk.ts studio/__tests__/export/fiberWalk.test.ts
git commit -m "feat(studio/export): fiber walk — host elements, text, skip-list wrappers"
```

---

## Task 3 [TDD]: fiberWalk — mapped primitives (prune-with-text) + props

**Files:** append to `studio/__tests__/export/fiberWalk.test.ts` (fiberWalk.ts already implements this from T2).

- [ ] **Step 1: append tests**

```ts
describe("walkFiber — mapped primitives", () => {
  it("emits a component node + prunes internals, keeping text", () => {
    // ChatBubble with internal host structure + text; internals must NOT appear as children
    const innerText = host("span"); (innerText as any).__text = "Hi there";
    const innerStruct = host("div", [innerText]);
    const bubble = comp("ChatBubble", [innerStruct], { variant: "receiver", onClick: () => {} });
    (bubble as any).__text = "Hi there"; // reader.text returns the subtree text
    const node = walkFiber(bubble, ctx);
    if (node.kind !== "component") throw new Error("expected component");
    expect(node.component).toBe("ChatBubble");
    expect(node.props).toEqual({ variant: "receiver" });   // function dropped
    // pruned: children is ONLY the synthesized text node, not innerStruct/innerText frames
    expect(node.children).toHaveLength(1);
    expect(node.children[0].kind).toBe("element");
    if (node.children[0].kind === "element") {
      expect(node.children[0].tag).toBe("text");
      expect(node.children[0].style.characters).toBe("Hi there");
    }
  });

  it("a composite is NOT pruned — it becomes a frame and recurses to its primitive children", () => {
    const bubble = comp("ChatBubble", [], { variant: "sender" });
    const sidebar = comp("ComputerSidebar", [host("div", [bubble])]);
    const node = walkFiber(sidebar, ctx);
    // composite → element frame; descend finds the ChatBubble as a component node somewhere inside
    const found: string[] = [];
    const collect = (n: any) => { if (n.kind === "component") found.push(n.component); (n.children||[]).forEach(collect); };
    collect(node);
    expect(found).toContain("ChatBubble");
  });
});
```

- [ ] **Step 2: run → PASS** (T2's impl already does prune-with-text + scalarProps). If FAIL, fix fiberWalk.ts.
`pnpm run studio:test __tests__/export/fiberWalk.test.ts`  → expect 5 total.

- [ ] **Step 3: commit**
```bash
git add studio/__tests__/export/fiberWalk.test.ts studio/src/export/fiberWalk.ts
git commit -m "test(studio/export): fiber walk prune-with-text + scalar props"
```

---

## Task 4 [TDD]: fiberWalk — icon classification

**Files:** append to `studio/__tests__/export/fiberWalk.test.ts`.

- [ ] **Step 1: append test** (icon classified → component node, pruned like a primitive)

```ts
describe("walkFiber — icons", () => {
  it("emits an icon as a component node carrying its name + size prop", () => {
    const iconCtx: WalkCtx = { ...ctx, isComponent: (n) => (n === "ChevronLeftSmall" ? "icon" : n === "ChatBubble" ? "primitive" : null) };
    const icon = comp("ChevronLeftSmall", [], { size: 16 });
    const node = walkFiber(icon, iconCtx);
    if (node.kind !== "component") throw new Error("expected component");
    expect(node.component).toBe("ChevronLeftSmall");
    expect(node.props).toEqual({ size: 16 });
  });
});
```

- [ ] **Step 2: run → PASS** (icon path = primitive path in T2). Expect 6 total.
- [ ] **Step 3: commit**
```bash
git add studio/__tests__/export/fiberWalk.test.ts
git commit -m "test(studio/export): fiber walk classifies icons as component nodes"
```

---

## Task 5 [BRIDGE]: Capture icon-name → Icons/* mapping

**Driver:** orchestrator. Needs Bridge on Arcade 0.3.

**Files:** Create `studio/src/export/figma/iconEntries.ts`.

- [ ] **Step 1: enumerate icon names used by frames.** From the fiber spike, the
  common ones: `PlusSmall`, `ChevronLeftSmall`, `ChevronRightSmall`,
  `DotInLeftWindow`, `DotInRightWindow`, `Document`, `Clock`, `AgentStudio`,
  `Bell`, `MagnifyingGlass`, `ThreeDotsHorizontal`. (Extend as live runs surface more.)

- [ ] **Step 2: resolve each to an `Icons/*` component set key.** Per name, call
  `mcp__figma-console__figma_search_components` (libraryFileKey
  `a2uKnm88LxRXEWAL1kOqeQ`, query the icon concept, e.g. "chevron", "plus",
  "document", "clock"). The library has an `Icons/*` set (e.g. `Icons/Computer`,
  `Icons/Chat.bubbles`, `Icons/At.symbol`). Match arcade-gen name → the
  `Icons/<X>` set + record its key + Size variant options.

- [ ] **Step 3: write `iconEntries.ts`**
```ts
// studio/src/export/figma/iconEntries.ts
// arcade-gen icon component name -> Arcade 0.3 Icons/* component set. Captured Bridge-assisted.
// Size resolved from the icon's rendered `size` prop -> the set's Size variant.
export type IconMapping = {
  arcadeGen: string;                 // "ChevronLeftSmall"
  figma: { componentSetKey: string; setName: string } | null; // null = ambiguous/no match
  sizeProp?: string;                 // Figma variant prop for size (usually "Size")
  note: string;
};
export const ICON_ENTRIES: IconMapping[] = [
  // EXAMPLE (fill with REAL keys captured in Step 2):
  // { arcadeGen: "PlusSmall", figma: { componentSetKey: "<key>", setName: "Icons/Plus.in.chat.bubble" }, sizeProp: "Size", note: "..." },
  // ... ambiguous ones: figma: null, note explains.
];
```
(Orchestrator fills REAL keys. Unmatched icons → `figma: null` → fall back to a small frame, honest.)

- [ ] **Step 4: commit**
```bash
git add studio/src/export/figma/iconEntries.ts
git commit -m "feat(studio/export): capture arcade-gen icon -> Icons/* mapping"
```

---

## Task 6 [TDD]: iconMap lookup + planner icon support

**Files:** Create `studio/src/export/figma/iconMap.ts` + test; MODIFY `planSlj.ts` minimally if needed.

- [ ] **Step 1: failing test**
```ts
// studio/__tests__/export/figma/iconMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findIconMapping } from "../../../src/export/figma/iconMap";
import { ICON_ENTRIES } from "../../../src/export/figma/iconEntries";

describe("iconMap", () => {
  it("looks up a known icon by arcade-gen name", () => {
    const first = ICON_ENTRIES.find((e) => e.figma);
    if (first) expect(findIconMapping(first.arcadeGen)?.figma?.setName).toBe(first.figma!.setName);
  });
  it("returns null for an unknown icon", () => {
    expect(findIconMapping("NotAnIcon")).toBeNull();
  });
  it("every entry is well-formed", () => {
    for (const e of ICON_ENTRIES) {
      expect(typeof e.arcadeGen).toBe("string");
      if (e.figma) expect(typeof e.figma.componentSetKey).toBe("string");
    }
  });
});
```

- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: implement**
```ts
// studio/src/export/figma/iconMap.ts
import { ICON_ENTRIES, type IconMapping } from "./iconEntries";
const BY_NAME = new Map<string, IconMapping>(ICON_ENTRIES.map((e) => [e.arcadeGen, e]));
export function findIconMapping(name: string): IconMapping | null { return BY_NAME.get(name) ?? null; }
```
- [ ] **Step 4: run → PASS (3).**

- [ ] **Step 5: wire icons into the export's component classification.** Icons are
  component nodes; the planner already turns mapped component nodes into
  instances IF `findComponentMapping` returns a mapping. Two clean options
  (pick the simpler): (a) at the `exportFrameToSlj` wiring (T8), the
  `isComponent` classifier returns "icon" and the SljNode `component` is the
  icon name; extend the planner's `findComponentMapping` lookup to also consult
  `findIconMapping` (a small change in the maps passed to `planFigmaOps`); OR
  (b) merge icon entries into `componentEntries` so they resolve via the existing
  `findComponentMapping`. **Recommended: (b)** — icons become ordinary component
  entries with a `Size` variant, zero planner change. If (b), this task instead
  adds the icon entries to componentEntries (after T5's capture) and iconMap.ts
  is just a thin re-export. Decide at build time based on whether icon size→variant
  needs special handling.

- [ ] **Step 6: commit**
```bash
git add studio/src/export/figma/iconMap.ts studio/__tests__/export/figma/iconMap.test.ts
git commit -m "feat(studio/export): icon mapping lookup"
```

---

## Task 7 [BRIDGE]: Widen componentEntries to primitives + composite sub-parts

**Driver:** orchestrator. Needs Bridge on Arcade 0.3.

**Files:** MODIFY `studio/src/export/figma/componentEntries.ts`.

The #2 table has 18 primitives. The fiber walk surfaces more that appear in real
frames and HAVE a 0.3 counterpart — add them. From the spike: **`Item`
(ComputerSidebar.Item) → `Computer Item`**, **avatars → `Computer Avatar`**, the
sidebar `User` footer, `CountBadge`. Plus confirm coverage of `Markdown` (likely
NOT a 0.3 component → leave unmapped → frame, fine).

- [ ] **Step 1: list the named components a real frame's fiber tree produces** that
  aren't yet mapped (from the spike: `Item`, `Avatar` already mapped?, `User`,
  `CountBadge`, `FileIcon`, `Document`, `Group`, `Root`). Cross-check against the
  18 existing entries.

- [ ] **Step 2: for each genuinely-mappable one, resolve the 0.3 key** via
  `figma_search_components` + apply the #2 convention (unprefixed → [0.2] →
  reject [DLS]/[WIP]/[DEPRECATED]). The big one: `Computer Item` (key
  `d5ad9a6ba7dc57408feb37155343e2e96029b455` from earlier search, variants
  State/Expanded/hasUpdate) for the sidebar rows. Map the kit's compound
  sub-part NAME as the fiber reports it (`Item`) — **resolve the bare-name
  collision risk**: if multiple composites expose `.Item`, add a `displayName`
  convention to the kit sub-parts (`ComputerSidebar.Item.displayName =
  "ComputerSidebar.Item"`) and key the entry on that. Record in the note.

- [ ] **Step 3: add entries** to `COMPONENT_ENTRIES` (same shape as existing;
  `status:"mapped"`, real key, variant valueMap, `generation`). Unmappable →
  `status:"ambiguous"`.

- [ ] **Step 4: run the existing mapping invariant test** (it asserts well-formedness):
`pnpm run studio:test __tests__/export/figma/componentMap.test.ts` — adjust the
expected-count assertion to the new total.

- [ ] **Step 5: commit**
```bash
git add studio/src/export/figma/componentEntries.ts studio/__tests__/export/figma/componentMap.test.ts
git commit -m "feat(studio/export): widen component map — Computer Item, sub-parts, primitives"
```

---

## Task 8 [TDD+LIVE]: Wire fiberWalk into the export + keepNames

**Files:** MODIFY `studio/src/lib/exportFrameToSlj.ts`, `studio/server/plugins/frameMountPlugin.ts`, `studio/server/cloudflare/bundler.ts`. Test: `studio/__tests__/lib/exportFrameToSlj.test.ts` (update).

- [ ] **Step 1: build the live FiberReader + classifier in `exportFrameToSlj.ts`.**
  Replace the `serializeFrame(mount, …)` call with `walkFiber(rootFiber, ctx)`:
  - Get `rootFiber`: from `mount` DOM node, read `mount[key]` where key starts
    `__reactFiber$`; climb `.return` to the top app fiber (or start at the
    frame's own component fiber).
  - `FiberReader.hostTag(f)`: descend `.child` to first `stateNode instanceof
    win.Element`; return its `tagName.toLowerCase()` (or null).
  - `box(f)`: that host node's `getBoundingClientRect`.
  - `style(f)`: `win.getComputedStyle(hostNode)`.
  - `text(f)`: visible text of the host subtree (`hostNode.textContent` trimmed)
    — for prune-with-text. (Refine to the primary label later if needed; the
    planner uses firstText.)
  - `isComponent(name)`: "icon" if `findIconMapping(name)`; else "primitive" if
    `findComponentMapping(name)?.status === "mapped"`; else "composite".
  - `isSkippable(name)`: a set — `MenuProvider`, `DropdownMenuProvider`,
    `DropdownMenu`, `MenuProvider`, `Provider`, `Root`, `Group`, `Slot`,
    `FrameErrorBoundary`, `FrameFontProxy`, `DevRevThemeProvider` (the harness
    wrappers, not real UI).
  - `resolveColor`: curry the existing `resolveToken(tokenIndex, value)`.
  Keep the POST-to-endpoint + SljDocument envelope unchanged.

- [ ] **Step 2: keepNames.** In `frameMountPlugin.ts` and `cloudflare/bundler.ts`
  esbuild configs, add `keepNames: true`. (Dev already preserves names; this
  protects minified/share builds.)

- [ ] **Step 3: update the unit test** `__tests__/lib/exportFrameToSlj.test.ts` —
  it builds a jsdom iframe; adapt it to attach a minimal fake fiber to the mount
  node (or assert the function wires walkFiber + posts). Keep it green.
`pnpm run studio:test __tests__/lib/exportFrameToSlj.test.ts`

- [ ] **Step 4 [LIVE]: full E2E.** Studio server up + Bridge on Arcade 0.3.
  1. Open the Computer-with-panel frame; run the real `exportFrameToSlj` (browser
     console / a temporary viewport button) → saves SLJ from the FIBER walk.
  2. Inspect the saved SLJ: confirm component nodes for ChatBubble×N, Computer
     Item rows, IconButton, Avatar, icons — NOT a sea of divs.
  3. `planFigmaOps(slj, maps)` (maps include findComponentMapping + iconMap +
     tokenNameToVariableKey) → op list. Confirm createInstance for the sidebar
     rows + icons, not just bubbles.
  4. Execute via the live Bridge (reuse the #3 executor / the proven local-node
     instancing; chunk if large).
  5. **Screenshot.** Compare to the Studio render: real sidebar (Computer Item
     rows, New Chat, avatars, icons) + real ChatBubble instances with REAL text +
     header/input. Record summary + screenshot in `docs/superpowers/scratch/`.

- [ ] **Step 5: commit** (code only; the live run is manual verification)
```bash
git add studio/src/lib/exportFrameToSlj.ts studio/server/plugins/frameMountPlugin.ts studio/server/cloudflare/bundler.ts studio/__tests__/lib/exportFrameToSlj.test.ts
git commit -m "feat(studio/export): export via fiber walk + keepNames"
```

---

## Task 9: Full suite + PR

- [ ] **Step 1:** `pnpm run studio:test` → all pass (new fiber + icon tests + everything pre-existing; 3 known pre-existing TS errors in zoomSteps/useProjectFromMirror are unrelated).
- [ ] **Step 2: Done check (the bar that matters):** the live screenshot from T8.5
  recognizably shows Arcade Studio — real primitive instances (sidebar rows,
  buttons, avatars, icons, bubbles) in faithful auto-layout frames, with real
  text — NOT bubbles + black rectangles.
- [ ] **Step 3: PR** via superpowers:finishing-a-development-branch.

---

## Notes for the executor

- Tests run from REPO ROOT: `pnpm run studio:test <path>`.
- **T5, T7, T8.4 are orchestrator/live** — need the Bridge on Arcade 0.3
  (`a2uKnm88LxRXEWAL1kOqeQ`) + Studio dev server. Subagents do T1-T4, T6, the
  code parts of T8, T9.
- **The planner/executor are NOT modified** (except possibly merging icon lookup
  into the maps object). fiberWalk produces the same SljNode contract.
- **Never `git add -A`** — stage explicit paths.
- **Biggest build risk: the live FiberReader** (T8.1) — climbing fiber→host node
  and text extraction. The spike proved the reads work; T8.4 is where it's
  validated end-to-end. If text/box correlation is off, that's the iterate point.
- **Fallback:** the DOM-stamp serializer (serializeFrame) stays in the tree as a
  fallback path if fiber access proves fragile in any environment.
