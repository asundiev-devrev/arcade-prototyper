# Figma Export — Slice 0 (Thin Vertical) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the entire Figma-export chain on ONE component — stamp a `ChatBubble`, serialize a one-bubble frame to Studio Layout JSON (SLJ), and place ONE real `ChatBubble` *instance* (not a rectangle) in Figma via the figma-console Bridge.

**Architecture:** A kit-boundary wrapper stamps `data-arcade-*` onto `ChatBubble`'s root div. A pure DOM-walk serializer (geometry + style injected, so it's deterministic in tests) turns a stamped DOM subtree into SLJ. A read-only server endpoint stores/serves the SLJ per frame. The Studio shell reads the same-origin iframe's live DOM, serializes, and saves. Claude then drives the figma-console Bridge to consume the saved SLJ and create a real component instance.

**Tech Stack:** TypeScript, React 19, Vite middleware, esbuild, Vitest + @testing-library/react (jsdom), @xorkavi/arcade-gen, figma-console MCP.

**Spec:** `docs/superpowers/specs/2026-06-05-figma-export-design.md` (see "Slice 0 — thin vertical").

---

## Slice-0-only shortcuts (deliberate; replaced in #1–#3)

These are scaffolding to prove the chain fast. Each is flagged where it's introduced.

1. **Wrapper-stamping, not JSX transform.** Slice 0 stamps only `ChatBubble`, via a wrapper in `prototype-kit/arcade-components.tsx` (the existing Button/IconButton pattern). The spec's general mechanism is a JSX transform — that is sub-project **#1**, not here.
2. **Serialize from the shell, not inside the iframe.** Frames are same-origin (`:5556`), so the shell reads `iframe.contentDocument` + `getComputedStyle` directly. No frame-side script / postMessage. Sub-project **#1** decides whether to keep this or move in-iframe.
3. **Claude is the Bridge consumer.** Studio emits + saves SLJ; Claude calls the figma-console tools to create the instance. Sub-project **#3** productizes a real consumer (Bridge script → plugin).
4. **One component, no fallback, no images, no variable binding.** `ChatBubble` only; unmapped-fallback, images-as-fills, and token→variable binding are #2/#3.

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `studio/src/export/slj.ts` | SLJ v1 TypeScript types — the contract | New |
| `studio/src/export/inferLayout.ts` | Derive auto-layout `{mode,gap,padding,align}` from a computed style | New |
| `studio/src/export/tokenIndex.ts` | Build a value→token-names index from `:root` custom properties; resolve a value | New |
| `studio/src/export/serializeFrame.ts` | Pure DOM-walk → SLJ tree (geometry + style injected) | New |
| `studio/prototype-kit/arcade-components.tsx` | Add `ChatBubble` wrapper that stamps `data-arcade-*` | Mod |
| `studio/server/middleware/export.ts` | `GET`/`POST /api/projects/:slug/export/:frame.slj.json` | New |
| `studio/vite.config.ts` | Register `exportMiddleware()` | Mod |
| `studio/src/lib/exportFrameToSlj.ts` | Shell-side: read same-origin iframe DOM → SLJ → POST to endpoint | New |
| `studio/__tests__/export/*.test.ts(x)` | Unit tests for each unit above | New |
| `studio/__tests__/prototype-kit/arcade-components-shim.test.tsx` | Extend with ChatBubble stamp assertion | Mod |

---

## Task 1: SLJ v1 types (the contract)

**Files:**
- Create: `studio/src/export/slj.ts`
- Test: `studio/__tests__/export/slj.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/slj.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SLJ_VERSION, isComponentNode, isElementNode, type SljNode } from "../../src/export/slj";

describe("slj contract", () => {
  it("declares schema version 1", () => {
    expect(SLJ_VERSION).toBe(1);
  });

  it("discriminates component vs element nodes", () => {
    const comp: SljNode = {
      kind: "component",
      component: "ChatBubble",
      source: "arcade/components",
      props: { variant: "receiver" },
      box: { x: 0, y: 0, width: 10, height: 10 },
      layout: null,
      children: [],
    };
    const el: SljNode = {
      kind: "element",
      tag: "div",
      box: { x: 0, y: 0, width: 10, height: 10 },
      layout: null,
      style: {},
      children: [],
    };
    expect(isComponentNode(comp)).toBe(true);
    expect(isComponentNode(el)).toBe(false);
    expect(isElementNode(el)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/slj.test.ts`
Expected: FAIL — cannot resolve `../../src/export/slj`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/slj.ts
// Studio Layout JSON (SLJ) v1 — the component-aware contract every Figma-export
// producer and consumer shares. See docs/superpowers/specs/2026-06-05-figma-export-design.md.

export const SLJ_VERSION = 1 as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Auto-layout for a container, or null when the container is "irregular"
 *  (absolute children / overlap / negative margins) and children carry
 *  absolute geometry for the fallback path. */
export interface Layout {
  mode: "horizontal" | "vertical";
  gap: number;
  /** [top, right, bottom, left] in px. */
  padding: [number, number, number, number];
  align: "start" | "center" | "end" | "stretch";
}

export interface ElementStyle {
  /** Token name(s) (e.g. "--bg-neutral-soft") when resolvable, else a raw "#rrggbb"/rgb() string. */
  fill?: string;
  cornerRadius?: number;
  stroke?: { color: string; width: number };
  // text-only:
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
}

export interface ComponentNode {
  kind: "component";
  component: string;
  source: "arcade/components" | "arcade-prototypes";
  props: Record<string, unknown>;
  box: Box;
  layout: Layout | null;
  children: SljNode[];
}

export interface ElementNode {
  kind: "element";
  tag: string; // "div" | "text" | "img" | ...
  box: Box;
  layout: Layout | null;
  style: ElementStyle;
  children: SljNode[];
}

export type SljNode = ComponentNode | ElementNode;

export interface SljDocument {
  slj: typeof SLJ_VERSION;
  frame: { slug: string; project: string; width: number; mode: "light" | "dark" };
  root: SljNode;
}

export function isComponentNode(n: SljNode): n is ComponentNode {
  return n.kind === "component";
}
export function isElementNode(n: SljNode): n is ElementNode {
  return n.kind === "element";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/slj.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/slj.ts studio/__tests__/export/slj.test.ts
git commit -m "feat(studio/export): SLJ v1 contract types"
```

---

## Task 2: Layout inference

**Files:**
- Create: `studio/src/export/inferLayout.ts`
- Test: `studio/__tests__/export/inferLayout.test.ts`

The serializer must turn a computed style into a `Layout` or `null`. `inferLayout`
takes a minimal style shape (so it's testable without a browser) and the child
boxes (to detect overlap / non-monotonic offsets → irregular → null).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/inferLayout.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { inferLayout, type StyleLike } from "../../src/export/inferLayout";
import type { Box } from "../../src/export/slj";

const flexCol: StyleLike = {
  display: "flex",
  flexDirection: "column",
  columnGap: "0px",
  rowGap: "8px",
  paddingTop: "12px",
  paddingRight: "16px",
  paddingBottom: "12px",
  paddingLeft: "16px",
  alignItems: "flex-start",
  marginLeft: "0px",
};

describe("inferLayout", () => {
  it("maps a flex column to vertical auto-layout with gap + padding + align", () => {
    const layout = inferLayout(flexCol, []);
    expect(layout).toEqual({
      mode: "vertical",
      gap: 8,
      padding: [12, 16, 12, 16],
      align: "start",
    });
  });

  it("maps a flex row to horizontal and translates align values", () => {
    const layout = inferLayout(
      { ...flexCol, flexDirection: "row", columnGap: "6px", rowGap: "0px", alignItems: "center" },
      [],
    );
    expect(layout).toEqual({ mode: "horizontal", gap: 6, padding: [12, 16, 12, 16], align: "center" });
  });

  it("returns null for a non-flex container (irregular → absolute fallback)", () => {
    expect(inferLayout({ ...flexCol, display: "block" }, [])).toBeNull();
  });

  it("returns null when any child overlaps another along the main axis", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 0, y: 10, width: 100, height: 20 }, // overlaps the first vertically
    ];
    expect(inferLayout(flexCol, boxes)).toBeNull();
  });

  it("returns null when a negative margin is present", () => {
    expect(inferLayout({ ...flexCol, marginLeft: "-6px" }, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/inferLayout.test.ts`
Expected: FAIL — cannot resolve `../../src/export/inferLayout`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/inferLayout.ts
import type { Box, Layout } from "./slj";

/** The subset of a computed style inferLayout reads. window.getComputedStyle
 *  satisfies this (all values are px/keyword strings). */
export interface StyleLike {
  display: string;
  flexDirection: string;
  columnGap: string;
  rowGap: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  alignItems: string;
  marginLeft: string;
}

const px = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function mapAlign(alignItems: string): Layout["align"] {
  switch (alignItems) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "stretch":
      return "stretch";
    default:
      return "start";
  }
}

/** Overlap along the main axis means it's not a clean stack → irregular. */
function hasMainAxisOverlap(boxes: Box[], mode: "horizontal" | "vertical"): boolean {
  const sorted = [...boxes].sort((a, b) => (mode === "vertical" ? a.y - b.y : a.x - b.x));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevEnd = mode === "vertical" ? prev.y + prev.height : prev.x + prev.width;
    const curStart = mode === "vertical" ? cur.y : cur.x;
    if (curStart < prevEnd) return true;
  }
  return false;
}

export function inferLayout(style: StyleLike, childBoxes: Box[]): Layout | null {
  if (style.display !== "flex" && style.display !== "inline-flex") return null;
  // Negative margins have no auto-layout equivalent → fall back to absolute.
  if (px(style.marginLeft) < 0) return null;

  const mode: Layout["mode"] = style.flexDirection.startsWith("row") ? "horizontal" : "vertical";
  if (hasMainAxisOverlap(childBoxes, mode)) return null;

  const gap = mode === "horizontal" ? px(style.columnGap) : px(style.rowGap);
  return {
    mode,
    gap,
    padding: [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)],
    align: mapAlign(style.alignItems),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/inferLayout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/inferLayout.ts studio/__tests__/export/inferLayout.test.ts
git commit -m "feat(studio/export): auto-layout inference with irregular-container fallback"
```

---

## Task 3: Token index (value → token names)

**Files:**
- Create: `studio/src/export/tokenIndex.ts`
- Test: `studio/__tests__/export/tokenIndex.test.ts`

`getComputedStyle` returns resolved colors, not `var(--token)`. We build a
reverse index from the token custom properties present on `:root` and resolve a
resolved value back to candidate token name(s). Reading happens from an injected
reader so the unit is browser-free.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/tokenIndex.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTokenIndex, resolveToken } from "../../src/export/tokenIndex";

// A fake reader standing in for getComputedStyle(:root): name -> resolved value.
const fakeRoot = {
  "--fg-neutral-prominent": "rgb(23, 23, 23)",
  "--bg-neutral-soft": "rgb(245, 245, 245)",
  "--surface-overlay": "rgb(245, 245, 245)", // collides with bg-neutral-soft
};

describe("tokenIndex", () => {
  it("indexes known token names by their resolved value", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(idx.get("rgb(23, 23, 23)")).toEqual(["--fg-neutral-prominent"]);
  });

  it("returns all candidates when a value is shared (collision deferred to consumer)", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(idx.get("rgb(245, 245, 245)")).toEqual(["--bg-neutral-soft", "--surface-overlay"]);
  });

  it("resolveToken returns the single candidate name, the raw value when unknown", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(resolveToken(idx, "rgb(23, 23, 23)")).toBe("--fg-neutral-prominent");
    expect(resolveToken(idx, "rgb(0, 0, 0)")).toBe("rgb(0, 0, 0)"); // unknown → raw passthrough
  });

  it("normalizes whitespace so 'rgb(23,23,23)' and 'rgb(23, 23, 23)' match", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(resolveToken(idx, "rgb(23,23,23)")).toBe("--fg-neutral-prominent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/tokenIndex.test.ts`
Expected: FAIL — cannot resolve `../../src/export/tokenIndex`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/tokenIndex.ts
// Resolved-value → token-name index. getComputedStyle gives us resolved colors,
// not var() refs, so we reverse-map them against the tokens DevRevThemeProvider
// injected on :root. Collisions are expected (semantic aliases share a value);
// the SLJ carries candidate names and the Figma consumer (#2) disambiguates by
// the property the value is used for.

export type TokenIndex = Map<string, string[]>;

const norm = (v: string): string => v.replace(/\s+/g, "").toLowerCase();

/** @param names token custom-property names present on :root (e.g. ["--fg-neutral-prominent"]).
 *  @param read returns the resolved value for a given name (wrap getComputedStyle(:root).getPropertyValue). */
export function buildTokenIndex(names: string[], read: (name: string) => string): TokenIndex {
  const idx: TokenIndex = new Map();
  for (const name of names) {
    const value = read(name).trim();
    if (!value) continue;
    const key = norm(value);
    const list = idx.get(key);
    if (list) list.push(name);
    else idx.set(key, [name]);
  }
  return idx;
}

/** Single candidate → its name; multiple → first candidate (deterministic);
 *  none → the raw value unchanged. (Multi-candidate disambiguation is #2's job;
 *  Slice 0 keeps the first so output is stable.) */
export function resolveToken(idx: TokenIndex, resolvedValue: string): string {
  const hit = idx.get(norm(resolvedValue));
  return hit && hit.length > 0 ? hit[0] : resolvedValue;
}

/** Enumerate the token custom-property names on a root element's computed style.
 *  Used at runtime in the browser; not exercised by unit tests. */
export function tokenNamesFromRoot(rootStyle: CSSStyleDeclaration): string[] {
  const names: string[] = [];
  for (let i = 0; i < rootStyle.length; i += 1) {
    const prop = rootStyle.item(i);
    if (prop.startsWith("--fg-") || prop.startsWith("--bg-") || prop.startsWith("--stroke-") ||
        prop.startsWith("--surface-") || prop.startsWith("--corner-")) {
      names.push(prop);
    }
  }
  return names;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/tokenIndex.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/tokenIndex.ts studio/__tests__/export/tokenIndex.test.ts
git commit -m "feat(studio/export): resolved-value to token-name reverse index"
```

---

## Task 4: The DOM-walk serializer

**Files:**
- Create: `studio/src/export/serializeFrame.ts`
- Test: `studio/__tests__/export/serializeFrame.test.ts`

The serializer walks a DOM tree. To stay deterministic in tests, geometry and
computed style are injected via a `DomReader`. The test builds a stamped
`ChatBubble`-shaped DOM by hand (a `div[data-arcade-component]` with a text child)
and a fake reader, and asserts the SLJ tree.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/serializeFrame.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { serializeFrame, type DomReader } from "../../src/export/serializeFrame";
import { buildTokenIndex } from "../../src/export/tokenIndex";
import { isComponentNode, isElementNode } from "../../src/export/slj";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  return host.firstElementChild as HTMLElement;
}

// Minimal style every node reports; overridden per-node where needed.
const baseStyle: Record<string, string> = {
  display: "block", flexDirection: "row", columnGap: "0px", rowGap: "0px",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  alignItems: "stretch", marginLeft: "0px",
  backgroundColor: "rgba(0, 0, 0, 0)", borderTopLeftRadius: "0px",
  borderTopWidth: "0px", borderTopColor: "rgb(0, 0, 0)",
  color: "rgb(23, 23, 23)", fontFamily: "Inter", fontSize: "14px",
  fontWeight: "400", lineHeight: "20px",
};

function makeReader(overrides: Map<Element, Partial<Record<string, string>>>): DomReader {
  return {
    style: (node) => {
      const o = overrides.get(node) ?? {};
      const merged = { ...baseStyle, ...o };
      return { getPropertyValue: (p: string) => merged[camelToKebabSafe(p)] ?? (merged as any)[p] ?? "" } as any;
    },
    box: () => ({ x: 0, y: 0, width: 100, height: 40 }),
  };
}
// our serializer reads camelCase keys off the snapshot; the fake just returns them
function camelToKebabSafe(p: string) { return p; }

describe("serializeFrame", () => {
  it("emits a component node for a stamped ChatBubble with its props + text child", () => {
    const bubble = el(
      `<div data-arcade-component="ChatBubble" data-arcade-source="arcade/components" ` +
      `data-arcade-props='{"variant":"receiver","tail":false}'>Hello there</div>`,
    );
    const overrides = new Map<Element, Partial<Record<string, string>>>([
      [bubble, { backgroundColor: "rgb(245, 245, 245)" }],
    ]);
    const tokenIndex = buildTokenIndex(["--bg-neutral-soft"], () => "rgb(245, 245, 245)");

    const root = serializeFrame(bubble, { reader: makeReader(overrides), tokenIndex });

    expect(isComponentNode(root)).toBe(true);
    if (!isComponentNode(root)) throw new Error("unreachable");
    expect(root.component).toBe("ChatBubble");
    expect(root.source).toBe("arcade/components");
    expect(root.props).toEqual({ variant: "receiver", tail: false });
    // text child
    expect(root.children).toHaveLength(1);
    const child = root.children[0];
    expect(isElementNode(child)).toBe(true);
    if (!isElementNode(child)) throw new Error("unreachable");
    expect(child.tag).toBe("text");
    expect(child.style.characters).toBe("Hello there");
  });

  it("emits an element node (not component) for a plain div", () => {
    const div = el(`<div>plain</div>`);
    const root = serializeFrame(div, { reader: makeReader(new Map()), tokenIndex: new Map() });
    expect(isElementNode(root)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/serializeFrame.test.ts`
Expected: FAIL — cannot resolve `../../src/export/serializeFrame`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/serializeFrame.ts
import type { Box, ElementStyle, Layout, SljNode } from "./slj";
import { inferLayout, type StyleLike } from "./inferLayout";
import { resolveToken, type TokenIndex } from "./tokenIndex";

/** A computed-style snapshot. window.getComputedStyle(el) satisfies this. */
export interface StyleSnapshot {
  getPropertyValue(prop: string): string;
}

export interface DomReader {
  style(node: Element): StyleSnapshot;
  box(node: Element): Box;
}

interface Ctx {
  reader: DomReader;
  tokenIndex: TokenIndex;
}

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", "rgba(0,0,0,0)"]);

function readStyleLike(s: StyleSnapshot): StyleLike {
  const g = (p: string) => s.getPropertyValue(p);
  return {
    display: g("display"),
    flexDirection: g("flexDirection"),
    columnGap: g("columnGap"),
    rowGap: g("rowGap"),
    paddingTop: g("paddingTop"),
    paddingRight: g("paddingRight"),
    paddingBottom: g("paddingBottom"),
    paddingLeft: g("paddingLeft"),
    alignItems: g("alignItems"),
    marginLeft: g("marginLeft"),
  };
}

function elementStyle(s: StyleSnapshot, idx: TokenIndex): ElementStyle {
  const out: ElementStyle = {};
  const bg = s.getPropertyValue("backgroundColor");
  if (bg && !TRANSPARENT.has(bg.trim())) out.fill = resolveToken(idx, bg);
  const radius = parseFloat(s.getPropertyValue("borderTopLeftRadius"));
  if (Number.isFinite(radius) && radius > 0) out.cornerRadius = radius;
  const strokeW = parseFloat(s.getPropertyValue("borderTopWidth"));
  if (Number.isFinite(strokeW) && strokeW > 0) {
    out.stroke = { color: resolveToken(idx, s.getPropertyValue("borderTopColor")), width: strokeW };
  }
  return out;
}

/** A node whose only content is text → emit a text element node. */
function isTextOnly(node: Element): boolean {
  return node.childElementCount === 0 && (node.textContent ?? "").trim().length > 0;
}

function textNode(node: Element, s: StyleSnapshot, idx: TokenIndex, box: Box): SljNode {
  return {
    kind: "element",
    tag: "text",
    box,
    layout: null,
    style: {
      characters: (node.textContent ?? "").trim(),
      color: resolveToken(idx, s.getPropertyValue("color")),
      fontFamily: s.getPropertyValue("fontFamily"),
      fontSize: parseFloat(s.getPropertyValue("fontSize")) || undefined,
      fontWeight: parseFloat(s.getPropertyValue("fontWeight")) || undefined,
      lineHeight: parseFloat(s.getPropertyValue("lineHeight")) || undefined,
    },
    children: [],
  };
}

function walk(node: Element, ctx: Ctx): SljNode {
  const s = ctx.reader.style(node);
  const box = ctx.reader.box(node);

  // Text leaf
  if (isTextOnly(node)) return textNode(node, s, ctx.tokenIndex, box);

  const childEls = Array.from(node.children);
  const children = childEls.map((c) => walk(c, ctx));
  const childBoxes = childEls.map((c) => ctx.reader.box(c));
  const layout: Layout | null = inferLayout(readStyleLike(s), childBoxes);

  const stamp = node.getAttribute("data-arcade-component");
  if (stamp) {
    const source = (node.getAttribute("data-arcade-source") as
      | "arcade/components"
      | "arcade-prototypes") ?? "arcade/components";
    let props: Record<string, unknown> = {};
    const raw = node.getAttribute("data-arcade-props");
    if (raw) {
      try {
        props = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        props = {};
      }
    }
    return { kind: "component", component: stamp, source, props, box, layout, children };
  }

  return {
    kind: "element",
    tag: node.tagName.toLowerCase(),
    box,
    layout,
    style: elementStyle(s, ctx.tokenIndex),
    children,
  };
}

export function serializeFrame(root: Element, ctx: Ctx): SljNode {
  return walk(root, ctx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/serializeFrame.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/serializeFrame.ts studio/__tests__/export/serializeFrame.test.ts
git commit -m "feat(studio/export): DOM-walk serializer to SLJ (injected geometry/style)"
```

---

## Task 5: Stamp ChatBubble at the kit boundary

**Files:**
- Modify: `studio/prototype-kit/arcade-components.tsx` (add after the `IconButton` wrapper, before/after the existing exports — see Step 3)
- Modify (test): `studio/__tests__/prototype-kit/arcade-components-shim.test.tsx`

> **Slice-0 shortcut:** a wrapper stamps only `ChatBubble`. Sub-project #1 replaces this with a JSX transform that stamps every kit component. `ChatBubble` extends `HTMLAttributes<HTMLDivElement>` and spreads props to its root `<div>`, so `data-*` lands on the rendered node.

- [ ] **Step 1: Write the failing test** (append to the existing shim test file)

```tsx
// append to studio/__tests__/prototype-kit/arcade-components-shim.test.tsx
import { render } from "@testing-library/react";
import { ChatBubble } from "../../prototype-kit/arcade-components";

describe("ChatBubble stamping (Slice 0)", () => {
  it("stamps data-arcade-* onto the rendered root div", () => {
    const { container } = render(<ChatBubble variant="receiver">Hello</ChatBubble>);
    const stamped = container.querySelector('[data-arcade-component="ChatBubble"]') as HTMLElement;
    expect(stamped).toBeTruthy();
    expect(stamped.getAttribute("data-arcade-source")).toBe("arcade/components");
    expect(JSON.parse(stamped.getAttribute("data-arcade-props") ?? "{}")).toEqual({
      variant: "receiver",
    });
    expect(stamped.textContent).toContain("Hello");
  });

  it("omits undefined props from the serialized payload", () => {
    const { container } = render(<ChatBubble variant="sender" tail>Hi</ChatBubble>);
    const stamped = container.querySelector('[data-arcade-component="ChatBubble"]') as HTMLElement;
    expect(JSON.parse(stamped.getAttribute("data-arcade-props") ?? "{}")).toEqual({
      variant: "sender",
      tail: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/prototype-kit/arcade-components-shim.test.tsx`
Expected: FAIL — `ChatBubble` is the un-stamped re-export (no `data-arcade-component`).

- [ ] **Step 3: Write minimal implementation**

In `studio/prototype-kit/arcade-components.tsx`, add the import alias and the wrapper. The existing file does `export * from "@xorkavi/arcade-gen"` then defines local `Button`/`IconButton` that shadow the star export — add `ChatBubble` the same way.

Add to the existing import block from `@xorkavi/arcade-gen`:

```tsx
import {
  Button as RawButton,
  IconButton as RawIconButton,
  ChatBubble as RawChatBubble,
  type ButtonProps as RawButtonProps,
  type IconButtonProps as RawIconButtonProps,
  type ChatBubbleProps as RawChatBubbleProps,
} from "@xorkavi/arcade-gen";
```

Add the wrapper after the `IconButton` definition:

```tsx
// Slice-0 stamping: tag ChatBubble's root div with component identity + props so
// the Figma-export serializer can recognise it in the rendered DOM. Sub-project
// #1 replaces per-component wrappers with a JSX transform across the whole kit.
// Only JSON-serializable props are stamped (ChatBubble's are all scalars).
const CHAT_BUBBLE_STAMP_PROPS = ["variant", "tail", "timestamp"] as const;

export const ChatBubble = React.forwardRef<HTMLDivElement, RawChatBubbleProps>(
  function ChatBubble(props, ref) {
    const stamped: Record<string, unknown> = {};
    for (const key of CHAT_BUBBLE_STAMP_PROPS) {
      const v = (props as Record<string, unknown>)[key];
      if (v !== undefined) stamped[key] = v;
    }
    return (
      <RawChatBubble
        ref={ref}
        data-arcade-component="ChatBubble"
        data-arcade-source="arcade/components"
        data-arcade-props={JSON.stringify(stamped)}
        {...props}
      />
    );
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/prototype-kit/arcade-components-shim.test.tsx`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Verify the full kit still builds + boundary test passes**

Run: `pnpm run studio:test __tests__/prototype-kit-boundary.test.ts`
Expected: PASS (ChatBubble is re-exported, not removed).

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/arcade-components.tsx studio/__tests__/prototype-kit/arcade-components-shim.test.tsx
git commit -m "feat(studio/export): stamp ChatBubble root with data-arcade-* (Slice 0)"
```

---

## Task 6: Export endpoint (save + serve SLJ)

**Files:**
- Create: `studio/server/middleware/export.ts`
- Test: `studio/__tests__/server/middleware/export.test.ts`
- Modify: `studio/vite.config.ts`

Mirrors `liftMiddleware` (`server/middleware/lift.ts`). Adds `POST` (save SLJ
written by the shell) + `GET` (serve it). Route:
`/api/projects/:slug/export/:frame.slj.json`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/middleware/export.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { exportMiddleware } from "../../../server/middleware/export";
import { createProject } from "../../../server/projects";

let server: http.Server; let port: number; let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-export-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer((req, res) => {
    exportMiddleware()(req, res, () => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "next called" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const slj = { slj: 1, frame: { slug: "p", project: "p", width: 1440, mode: "light" }, root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 1, height: 1 }, layout: null, style: {}, children: [] } };

describe("/api/projects/:slug/export/:frame.slj.json", () => {
  it("stores a POSTed SLJ and serves it back on GET", async () => {
    const p = await createProject({ name: "P", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slj),
    });
    expect(post.status).toBe(200);

    const get = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(slj);
  });

  it("404s when no SLJ has been saved", async () => {
    const p = await createProject({ name: "Q", theme: "arcade", mode: "light" });
    const get = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/99-none.slj.json`);
    expect(get.status).toBe(404);
  });

  it("rejects a non-JSON body with 400", async () => {
    const p = await createProject({ name: "R", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(post.status).toBe(400);
  });

  it("passes through on unrelated URLs", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("next called");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/export.test.ts`
Expected: FAIL — cannot resolve `../../../server/middleware/export`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/middleware/export.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";

const ROUTE = /^\/api\/projects\/([a-z0-9-]+)\/export\/([a-z0-9-]+)\.slj\.json(?:\?.*)?$/;
const FILENAME = "SLJ.json";
const MAX_BYTES = 8 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

export function exportMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = (req.url ?? "/").match(ROUTE);
    if (!m) return next?.();
    const [, slug, frame] = m;
    const file = path.join(frameDir(slug, frame), FILENAME);

    if (req.method === "GET") {
      try {
        const body = await fs.readFile(file, "utf-8");
        return send(res, 200, body);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return send(res, 404, JSON.stringify({ error: { code: "not_found", message: "SLJ not found" } }));
        }
        return send(res, 500, JSON.stringify({ error: { code: "read_failed", message: err.message } }));
      }
    }

    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const c of req) {
        total += c.length;
        if (total > MAX_BYTES) {
          req.resume();
          return send(res, 413, JSON.stringify({ error: { message: "SLJ too large" } }));
        }
        chunks.push(Buffer.from(c));
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        JSON.parse(raw); // validate it's JSON
      } catch {
        return send(res, 400, JSON.stringify({ error: { code: "bad_json", message: "Body is not valid JSON" } }));
      }
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, raw, "utf-8");
        return send(res, 200, JSON.stringify({ ok: true }));
      } catch (err: any) {
        return send(res, 500, JSON.stringify({ error: { code: "write_failed", message: err.message } }));
      }
    }

    return next?.();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/export.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the middleware**

In `studio/vite.config.ts`, find where `liftMiddleware()` is registered (search for `liftMiddleware`) and add `exportMiddleware()` directly after it, mirroring the import + `server.middlewares.use(...)` call:

```ts
// near the other middleware imports
import { exportMiddleware } from "./server/middleware/export";
// ... where liftMiddleware() is used:
server.middlewares.use(exportMiddleware());
```

- [ ] **Step 6: Verify the server boots with the new middleware**

Run: `pnpm run studio` (then Ctrl-C once it prints the :5556 URL)
Expected: server starts without error; no TypeScript/import error for `exportMiddleware`.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/export.ts studio/__tests__/server/middleware/export.test.ts studio/vite.config.ts
git commit -m "feat(studio/export): SLJ save+serve endpoint, mirrors lift middleware"
```

---

## Task 7: Shell-side export trigger

**Files:**
- Create: `studio/src/lib/exportFrameToSlj.ts`
- Test: `studio/__tests__/lib/exportFrameToSlj.test.ts`

A function the shell calls with a frame iframe. It reads the same-origin
iframe's live DOM + token CSSOM, serializes to SLJ, and POSTs it to the endpoint.
Geometry/style use the *real* `window.getComputedStyle` here; the function takes
the iframe element so it can be unit-tested with a jsdom-built fake iframe.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/exportFrameToSlj.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportFrameToSlj } from "../../src/lib/exportFrameToSlj";

afterEach(() => vi.restoreAllMocks());

function fakeIframe(): HTMLIFrameElement {
  // jsdom iframe: build a contentDocument with a stamped bubble + a mount root.
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    `<div id="root"><div data-arcade-component="ChatBubble" ` +
    `data-arcade-source="arcade/components" ` +
    `data-arcade-props='{"variant":"receiver"}'>Hi</div></div>`;
  return iframe;
}

describe("exportFrameToSlj", () => {
  it("serializes the iframe's mount root and POSTs the SLJ to the endpoint", async () => {
    const iframe = fakeIframe();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const slj = await exportFrameToSlj({
      iframe,
      projectSlug: "demo",
      frameSlug: "01-bubble",
      mode: "light",
      width: 1440,
    });

    expect(slj.slj).toBe(1);
    expect(slj.frame).toEqual({ slug: "01-bubble", project: "demo", width: 1440, mode: "light" });
    // POST happened to the right endpoint with the SLJ body
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/demo/export/01-bubble.slj.json",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws a clear error when the iframe document is unreachable", async () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: null });
    await expect(
      exportFrameToSlj({ iframe, projectSlug: "d", frameSlug: "f", mode: "light", width: 100 }),
    ).rejects.toThrow(/iframe/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/exportFrameToSlj.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/exportFrameToSlj`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/lib/exportFrameToSlj.ts
import { serializeFrame, type DomReader } from "../export/serializeFrame";
import { buildTokenIndex, tokenNamesFromRoot } from "../export/tokenIndex";
import { SLJ_VERSION, type SljDocument } from "../export/slj";

interface ExportArgs {
  iframe: HTMLIFrameElement;
  projectSlug: string;
  frameSlug: string;
  mode: "light" | "dark";
  width: number;
}

/** Read the same-origin frame iframe's live DOM, serialize to SLJ, POST it. */
export async function exportFrameToSlj(args: ExportArgs): Promise<SljDocument> {
  const doc = args.iframe.contentDocument;
  const win = args.iframe.contentWindow;
  if (!doc || !win) throw new Error("Frame iframe document is unreachable (cross-origin or not loaded)");

  const mount = doc.getElementById("root")?.firstElementChild ?? doc.body.firstElementChild;
  if (!mount) throw new Error("Frame iframe has no mounted content to export");

  // Token index from the iframe's :root computed style (DevRevThemeProvider injected them).
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const tokenNames = tokenNamesFromRoot(rootStyle);
  const tokenIndex = buildTokenIndex(tokenNames, (n) => rootStyle.getPropertyValue(n));

  const reader: DomReader = {
    style: (node) => win.getComputedStyle(node as Element),
    box: (node) => {
      const r = (node as Element).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
  };

  const root = serializeFrame(mount, { reader, tokenIndex });
  const slj: SljDocument = {
    slj: SLJ_VERSION,
    frame: { slug: args.frameSlug, project: args.projectSlug, width: args.width, mode: args.mode },
    root,
  };

  const res = await fetch(`/api/projects/${args.projectSlug}/export/${args.frameSlug}.slj.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slj),
  });
  if (!res.ok) throw new Error(`SLJ save failed: ${res.status}`);
  return slj;
}
```

> **Note on `getComputedStyle` keys:** `serializeFrame`/`inferLayout` read camelCase keys (`flexDirection`, `paddingTop`) via `getPropertyValue`. Browser `CSSStyleDeclaration.getPropertyValue` expects kebab-case (`flex-direction`). Before wiring the live path, confirm in Step 4's manual check; if values come back empty, change the reader to translate camelCase→kebab in `style()`. (Unit tests inject a fake reader so they're unaffected; this only matters for the live browser path.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/exportFrameToSlj.test.ts`
Expected: PASS (2 tests). If the camelCase/kebab issue above bites the live path later, the unit tests still pass (fake reader) — it's caught in Task 8's live run.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/exportFrameToSlj.ts studio/__tests__/lib/exportFrameToSlj.test.ts
git commit -m "feat(studio/export): shell-side iframe-to-SLJ export + save"
```

---

## Task 8: Live end-to-end — produce a real SLJ from a running frame

**Files:** none (manual verification using the running app).

This proves the producer half against a real browser (real geometry, real
tokens) before the Bridge step. It also catches the camelCase/kebab
`getComputedStyle` caveat from Task 7.

- [ ] **Step 1: Create a one-bubble fixture frame**

Create `~/Library/Application Support/arcade-studio/projects/figma-export-poc/frames/01-bubble/index.tsx`:

```tsx
import * as React from "react";
import { ChatMessages } from "arcade-prototypes";
import { ChatBubble } from "arcade/components";

export default function BubblePoc() {
  return (
    <div style={{ padding: 40 }}>
      <ChatMessages>
        <ChatBubble variant="receiver">Hello from Studio — exported to Figma.</ChatBubble>
      </ChatMessages>
    </div>
  );
}
```

(Create `project.json` for the project if the app doesn't auto-create it — launch the app, it will register the project dir.)

- [ ] **Step 2: Run the app and open the frame**

Run: `pnpm run studio`
Open: `http://localhost:5556/api/frames/figma-export-poc/01-bubble`
Expected: a single receiver chat bubble renders.

- [ ] **Step 3: Serialize from the devtools console**

In the page devtools console (the frame is same-origin), paste a call that imports nothing — instead, temporarily exercise the saved-endpoint path by running the shell helper. Simplest manual check: in the **frame** console,

```js
const root = document.getElementById("root").firstElementChild;
const s = getComputedStyle(root);
console.log(root.querySelector("[data-arcade-component]")?.getAttribute("data-arcade-props"));
console.log(getComputedStyle(document.documentElement).getPropertyValue("--bg-neutral-soft"));
```

Expected: prints `{"variant":"receiver"}` and a non-empty resolved color (confirms stamping + token CSSOM are live).

- [ ] **Step 4: Drive the real export + save**

Add a temporary button to the viewport that calls `exportFrameToSlj` with the frame iframe (or call it from the shell console with the iframe element). Confirm it POSTs and the file lands:

Run: `cat "~/Library/Application Support/arcade-studio/projects/figma-export-poc/frames/01-bubble/SLJ.json"`
Expected: a JSON document with `"slj":1`, a `ChatBubble` component node with `props.variant === "receiver"`, a text child whose `style.characters` is the bubble text, and `style.fill` resolved to `--bg-...` (a token name, not raw hex). If `fill`/layout values are empty, apply the camelCase→kebab reader fix from Task 7 Step 3 and re-run.

- [ ] **Step 5: Confirm via the GET endpoint**

Run: `curl -s http://localhost:5556/api/projects/figma-export-poc/export/01-bubble.slj.json | python3 -m json.tool`
Expected: the same SLJ served back.

- [ ] **Step 6: Commit any reader fix**

If Task 7's reader needed the kebab-case fix:
```bash
git add studio/src/lib/exportFrameToSlj.ts
git commit -m "fix(studio/export): translate computed-style keys to kebab-case for live reader"
```
Otherwise no commit (manual verification only).

---

## Task 9: Bridge consumer — place ONE real ChatBubble instance in Figma

**Files:** none (manual, run by Claude via the figma-console MCP).

> **Prerequisite (confirmed):** the DevRev component library is **published** (components + variables). The figma-console Bridge must be running: Figma desktop open on a target file, the Console Bridge plugin running, MCP connected. (Studio's generator blocks `mcp__figma-console` at `claudeCode.ts:121`; that block is on the headless *generator* subprocess only — these calls run in Claude's tool context, not there.)

- [ ] **Step 1: Confirm the Bridge is live**

Call `mcp__figma-console__figma_get_status` (or `figma_diagnose`).
Expected: connected, a file open. If not connected, the operator opens Figma + the Bridge plugin first.

- [ ] **Step 2: Find the published ChatBubble component key**

Call `mcp__figma-console__figma_search_components` with a query for `ChatBubble` (or the library's bubble component name).
Expected: a result with a component (set) key + its variant property names/values. Record the key and the variant property that corresponds to sender/receiver (it may be named e.g. `Type=Receiver` — note the exact property name + value, since our prop is `variant: "receiver"`). This is the seed of the #2 mapping table.

- [ ] **Step 3: Read the saved SLJ**

Read `~/Library/Application Support/arcade-studio/projects/figma-export-poc/frames/01-bubble/SLJ.json`.
Confirm: one `ChatBubble` component node, `props.variant === "receiver"`, text child characters.

- [ ] **Step 4: Create the instance + set variant + text**

Using the recorded key and variant mapping, call the Bridge to:
1. `figma_instantiate_component` with the ChatBubble key → an instance.
2. Set the variant property to the Receiver value (via `figma_set_instance_properties` or `figma_execute` running `instance.setProperties({...})`).
3. `figma_set_text` (or `figma_execute`) to set the bubble's text to the SLJ text child's `characters`.
4. Place it inside one auto-layout frame (`figma_execute`: `figma.createFrame()` with `layoutMode = "VERTICAL"`, append the instance).

Expected: the call returns node IDs without error.

- [ ] **Step 5: Verify visually**

Call `mcp__figma-console__figma_take_screenshot` (or `figma_capture_screenshot`) of the created frame.
Expected: a real **receiver** ChatBubble *instance* (an instance node, not a rectangle) showing the SLJ text, inside an auto-layout frame.

- [ ] **Step 6: Record the proven mapping**

Append the confirmed `ChatBubble` → published-key + variant-property mapping to the spec's #2 seed (a note in the spec or a scratch file `studio/src/lift/figma-component-keys.md`). This is the first real entry of the #2 mapping table.

```bash
git add studio/src/lift/figma-component-keys.md
git commit -m "docs(studio/export): record proven ChatBubble Figma component key (Slice 0)"
```

---

## Task 10: Full-suite green + Slice 0 wrap

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: all pass (the new export tests + the extended shim test + everything pre-existing). The 3 known pre-existing TS errors in `zoomSteps.ts`/`useProjectFromMirror.ts` are unrelated and do not block tests.

- [ ] **Step 2: Confirm Slice 0 "Done"**

Checklist (matches the spec's Slice 0 Done):
- A real `ChatBubble` **instance** (not a rectangle) appears in a Figma file — ✅ Task 9 Step 5.
- Correct variant (receiver) + text from the SLJ — ✅ Task 9 Steps 4–5.
- Produced via the SLJ contract end-to-end (stamp → serialize → save → Bridge) — ✅ Tasks 5–9.

- [ ] **Step 3: Commit any remaining changes + note next step**

```bash
git add -A studio/src/export studio/__tests__/export
git commit -m "chore(studio/export): Slice 0 complete — chain proven on ChatBubble"
```

Next: sub-project **#1** (widen the serializer to all components via a JSX transform), then **#2** (mapping table), then **#3** (productized Bridge → plugin consumer).

---

## Notes for the executor

- **Run tests from the repo root**, not `studio/`: `pnpm run studio:test <path>` (the scripts live at the root and operate on `studio/`).
- **Vite middleware does NOT hot-reload** — after Task 6, restart the app to pick up `exportMiddleware`.
- **Never `git add -A` at the repo root** — the root has loose untracked screenshots/scratch; stage explicit paths (the `-A` in Task 10 Step 3 is scoped to `studio/src/export` + `studio/__tests__/export` only).
- **The fixture frame (Task 8) lives in user-data**, not the repo — it is not committed.
- **figma-console calls (Task 9) need a live operator-side Figma + Bridge** — they are manual, not automatable in CI.
