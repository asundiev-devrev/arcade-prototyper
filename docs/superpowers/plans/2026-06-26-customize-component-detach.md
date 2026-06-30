# Customize (Component Detach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a designer click a prebuilt component on the canvas and hit **Customize** to turn it into fully-editable code in that frame only — the shared original untouched — by snapshotting its live rendered tree into JSX and splicing it into the frame's `index.tsx`.

**Architecture:** Reuse the existing in-iframe fiber-walk serializer (`src/export/fiberWalk.ts`) to capture the target component's rendered subtree as SLJ, extended to also capture `className`. A new pure `sljToJsx` printer turns SLJ into a JSX source string. A new `POST /api/customize/:slug` endpoint splices that JSX over the in-source component instance in `frames/<slug>/index.tsx`, reusing Phase A's `locateJsx`/`splice`/reparse-guard. The inspector shows a `💠 Component` chip + Customize action for elements that resolve to shared component source (`!isInFrame`), with confirm + one-step Undo. Target = the outermost component on the fiber owner chain whose call-site file is the frame's own `index.tsx`.

**Tech Stack:** TypeScript (compiler API already used in Phase A — NOT Babel), React (frame iframe + inspector shell), Vite middleware, Vitest.

## Global Constraints

- **Package manager is pnpm.** Tests run via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`), never `npm`/`yarn`.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/<area>` (use `studio/canvas`): e.g. `feat(studio/canvas): ...`.
- **Vite middleware does NOT hot-reload** — editing `server/middleware/*` or `vite.config.ts` needs an app restart to test live; unit tests don't.
- **Express styling only as Tailwind utility classes / arcade-gen tokens** in emitted JSX — never raw hex or inline `style` props.
- **Path safety:** every disk write resolves through `frameDir(projectSlug, frameSlug)` (`server/paths.ts`, calls `requireSlug`) and is confirmed inside the project dir before writing.
- **Never write un-parseable TSX:** every server write re-parses the result and aborts (file untouched) on failure — reuse the Phase A reparse-guard pattern (`(sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics`).
- **Exact UI copy (verbatim):**
  - Chip: `💠 Component · Customize`
  - Panel locked-note: `💠 Parts of this are prebuilt. Customize to change anything inside.`
  - Confirm title: `Customize this component?`
  - Confirm body: `It becomes fully editable in this screen only. The original stays the same everywhere else.`
  - Confirm buttons: `Cancel` / `Customize`
  - After (toast): `✓ Now fully editable.` + `Undo`
- **Customize target rule:** the outermost named component on the fiber owner chain (clicked element → root) whose JSX call-site file is `frames/<slug>/index.tsx`. Snapshot starts from that component's fiber. A snapshot is STATIC (dynamic behavior freezes) — accepted.
- All new server code is TS ESM under `studio/server/`; new client code under `studio/src/`; tests under `studio/__tests__/`.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/src/export/slj.ts` | add optional `className?: string` to `ElementNode` | 1 |
| `studio/src/export/fiberTypes.ts` | add `hostClassName(f)` to `FiberReader` | 1 |
| `studio/src/export/fiberWalk.ts` | emit `className` on element nodes | 1 |
| `studio/src/lib/exportFrameToSlj.ts` | implement `hostClassName` in the live reader | 1 |
| `studio/src/export/sljToJsx.ts` | pure SLJ→JSX-string printer | 2 |
| `studio/src/frame/resolveCustomizeTarget.ts` | pure: owner-chain → in-source target component | 3 |
| `studio/src/frame/picker.ts` | capture the owner chain (file per owner) in the selection | 4 |
| `studio/src/hooks/editSessionContext.tsx` | `ElementSelection` carries `ownerChain` | 4 |
| `studio/src/lib/customizeClient.ts` | client: serialize target → print → POST; payload builder | 5 |
| `studio/server/customize/spliceComponent.ts` | pure-ish: replace the in-source component element with JSX | 6 |
| `studio/server/customize/imports.ts` | reconcile arcade-gen imports for kept kit names | 6 |
| `studio/server/middleware/customize.ts` | `POST /api/customize/:slug` + `POST /api/customize/:slug/undo` | 7 |
| `studio/vite.config.ts` | register the customize middleware | 7 |
| `studio/src/frame/overlay/overlays.ts` | render the `💠 Component` chip on the selection box | 8 |
| `studio/src/components/inspector/InspectorPanel.tsx` | chip wiring, locked-note, Customize confirm + toast/Undo | 9 |

**Shared types** (define in Task 2 `sljToJsx.ts` / Task 3 / Task 5; consumed downstream):

```ts
// resolveCustomizeTarget.ts (Task 3)
export interface OwnerLink { componentName: string; file: string; line: number; column: number }
export interface CustomizeTarget { componentName: string; line: number; column: number }
// returns null when no owner on the chain is in the frame source (→ not customizable)
export function resolveCustomizeTarget(chain: OwnerLink[], frameSlug: string): CustomizeTarget | null;

// customizeClient.ts (Task 5)
export interface CustomizePayload { frameSlug: string; targetComponentName: string; line: number; column: number; jsx: string }
```

---

## Task 1: Capture `className` in the fiber walk

**Files:**
- Modify: `studio/src/export/slj.ts` (add `className?` to `ElementNode`)
- Modify: `studio/src/export/fiberTypes.ts` (add `hostClassName` to `FiberReader`)
- Modify: `studio/src/export/fiberWalk.ts` (emit `className`)
- Modify: `studio/src/lib/exportFrameToSlj.ts` (live impl of `hostClassName`)
- Test: `studio/__tests__/export/fiberWalk-classname.test.ts`

**Interfaces:**
- Consumes: existing `MinimalFiber`, `FiberReader`, `walkFiber`, `SljNode`.
- Produces: `ElementNode.className?: string`; `FiberReader.hostClassName(f: MinimalFiber): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/fiberWalk-classname.test.ts
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

// Minimal fake: one host <div class="flex p-4"> with a text child.
const textFiber: MinimalFiber = { type: null, child: null, sibling: null, memoizedProps: null };
const divFiber: MinimalFiber = { type: "div", child: textFiber, sibling: null, memoizedProps: null };

function reader(): FiberReader {
  return {
    hostTag: (f) => (f === divFiber ? "div" : null),
    hostClassName: (f) => (f === divFiber ? "flex p-4" : null),
    box: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    style: () => ({ getPropertyValue: () => "" }),
    text: (f) => (f === divFiber ? "Hi" : null),
  };
}
const ctx = (): WalkCtx => ({
  reader: reader(),
  isComponent: () => "composite",
  resolveColor: (v) => v,
  isSkippable: () => false,
  iconNameFor: () => null,
});

describe("fiber walk className capture", () => {
  it("puts the host className on the element node", () => {
    const root = walkFiber(divFiber, ctx());
    expect(isElementNode(root)).toBe(true);
    if (isElementNode(root)) expect(root.className).toBe("flex p-4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/fiberWalk-classname.test.ts`
Expected: FAIL — `hostClassName` missing from the `FiberReader` type / `className` undefined on the node.

- [ ] **Step 3: Add `className?` to `ElementNode`**

In `studio/src/export/slj.ts`, inside `ElementNode`:

```ts
export interface ElementNode {
  kind: "element";
  tag: string; // "div" | "text" | "img" | ...
  /** The host element's literal class attribute, for JSX emission (Customize).
   *  Absent on text nodes and the Figma-export path (which ignores it). */
  className?: string;
  box: Box;
  layout: Layout | null;
  style: ElementStyle;
  children: SljNode[];
}
```

- [ ] **Step 4: Add `hostClassName` to the `FiberReader` interface**

In `studio/src/export/fiberTypes.ts`, add to the `FiberReader` interface (after `hostTag`):

```ts
  /** The host element's `class` attribute (space-separated), or null if none / no host. */
  hostClassName(f: MinimalFiber): string | null;
```

- [ ] **Step 5: Emit `className` in `walkFiber`**

In `studio/src/export/fiberWalk.ts`, in the host-element return (the final `return { kind: "element", tag: tag ?? "div", ... }`), add `className`:

```ts
    const cls = ctx.reader.hostClassName(f);
    return {
      kind: "element",
      tag: tag ?? "div",
      ...(cls ? { className: cls } : {}),
      box,
      layout,
      style: elementStyle(s, ctx.resolveColor),
      children: childNodes,
    };
```

(Leave the `tag: "text"` leaf returns unchanged — text nodes carry no className.)

- [ ] **Step 6: Implement `hostClassName` in the live reader**

In `studio/src/lib/exportFrameToSlj.ts`, add to the `reader` object (after `hostTag`):

```ts
    hostClassName: (f) => {
      const h = hostOf(f);
      const c = h?.getAttribute?.("class");
      return c && c.trim().length > 0 ? c : null;
    },
```

- [ ] **Step 7: Run test to verify it passes + no export regression**

Run: `pnpm run studio:test __tests__/export/fiberWalk-classname.test.ts && pnpm run studio:test __tests__/export`
Expected: PASS (new test + existing export suite — the new field is optional, Figma path unaffected).

- [ ] **Step 8: Commit**

```bash
git add studio/src/export/slj.ts studio/src/export/fiberTypes.ts studio/src/export/fiberWalk.ts studio/src/lib/exportFrameToSlj.ts studio/__tests__/export/fiberWalk-classname.test.ts
git commit -m "feat(studio/canvas): capture host className in the fiber walk for JSX emission"
```

---

## Task 2: SLJ → JSX printer

**Files:**
- Create: `studio/src/export/sljToJsx.ts`
- Test: `studio/__tests__/export/sljToJsx.test.ts`

**Interfaces:**
- Consumes: `SljNode`, `ElementNode`, `ComponentNode`, `isComponentNode` (`slj.ts`).
- Produces: `sljToJsx(node: SljNode, indent?: number): string` — a JSX source string; and `collectKitComponents(node: SljNode): string[]` — the distinct kit component names referenced (for import reconciliation in Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/sljToJsx.test.ts
import { describe, it, expect } from "vitest";
import { sljToJsx, collectKitComponents } from "../../src/export/sljToJsx";
import type { SljNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 0, height: 0 };
const textNode = (s: string): SljNode => ({ kind: "element", tag: "text", box, layout: null, style: { characters: s }, children: [] });

describe("sljToJsx", () => {
  it("prints a host element with className and a text child", () => {
    const node: SljNode = { kind: "element", tag: "div", className: "flex p-4", box, layout: null, style: {}, children: [textNode("Hi")] };
    expect(sljToJsx(node)).toBe(`<div className="flex p-4">Hi</div>`);
  });
  it("prints a host element with no className", () => {
    const node: SljNode = { kind: "element", tag: "span", box, layout: null, style: {}, children: [textNode("x")] };
    expect(sljToJsx(node)).toBe(`<span>x</span>`);
  });
  it("prints a kit component node with scalar props", () => {
    const node: SljNode = { kind: "component", component: "Button", source: "arcade/components", props: { variant: "primary", disabled: true, count: 3 }, box, layout: null, children: [textNode("Go")] };
    expect(sljToJsx(node)).toBe(`<Button variant="primary" disabled count={3}>Go</Button>`);
  });
  it("self-closes a childless component", () => {
    const node: SljNode = { kind: "component", component: "Icon", source: "arcade/components", props: { name: "Trash" }, box, layout: null, children: [] };
    expect(sljToJsx(node)).toBe(`<Icon name="Trash" />`);
  });
  it("escapes braces/quotes in text and attribute values", () => {
    const node: SljNode = { kind: "element", tag: "div", className: "x", box, layout: null, style: {}, children: [textNode("a{b}c")] };
    // braces in JSX text must be escaped to render literally
    expect(sljToJsx(node)).toBe(`<div className="x">a{"{"}b{"}"}c</div>`);
  });
  it("nests children with structure", () => {
    const inner: SljNode = { kind: "element", tag: "span", className: "label", box, layout: null, style: {}, children: [textNode("hi")] };
    const node: SljNode = { kind: "element", tag: "div", className: "wrap", box, layout: null, style: {}, children: [inner] };
    expect(sljToJsx(node)).toContain(`<div className="wrap">`);
    expect(sljToJsx(node)).toContain(`<span className="label">hi</span>`);
  });
});

describe("collectKitComponents", () => {
  it("lists distinct component names in the tree", () => {
    const node: SljNode = { kind: "element", tag: "div", box, layout: null, style: {}, children: [
      { kind: "component", component: "Button", source: "arcade/components", props: {}, box, layout: null, children: [] },
      { kind: "component", component: "Icon", source: "arcade/components", props: {}, box, layout: null, children: [] },
      { kind: "component", component: "Button", source: "arcade/components", props: {}, box, layout: null, children: [] },
    ] };
    expect(collectKitComponents(node).sort()).toEqual(["Button", "Icon"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/sljToJsx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/export/sljToJsx.ts
import { type SljNode, isComponentNode } from "./slj";

/** JSX text: escape the two characters that aren't literal in JSX text — { and }. */
function escapeJsxText(s: string): string {
  return s.replace(/[{}]/g, (c) => `{"${c}"}`);
}

/** A double-quoted attribute string value, with embedded double-quotes escaped. */
function attrString(v: string): string {
  return `"${v.replace(/"/g, "&quot;")}"`;
}

/** Render one scalar prop to a JSX attribute, or "" to skip. */
function propAttr(key: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return `${key}=${attrString(value)}`;
  if (typeof value === "boolean") return value ? key : "";       // `disabled` / omit when false
  if (typeof value === "number") return `${key}={${value}}`;
  return ""; // non-scalar: conservatively drop
}

function propsToAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    const a = propAttr(k, v);
    if (a) parts.push(a);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/** Pure: SLJ node → JSX source string (single line per element; callers may prettify). */
export function sljToJsx(node: SljNode): string {
  // text leaf
  if (!isComponentNode(node) && node.tag === "text") {
    return escapeJsxText(node.style.characters ?? "");
  }

  const children = node.children.map(sljToJsx).join("");

  if (isComponentNode(node)) {
    const attrs = propsToAttrs(node.props);
    return node.children.length === 0
      ? `<${node.component}${attrs} />`
      : `<${node.component}${attrs}>${children}</${node.component}>`;
  }

  const cls = node.className ? ` className=${attrString(node.className)}` : "";
  return node.children.length === 0
    ? `<${node.tag}${cls} />`
    : `<${node.tag}${cls}>${children}</${node.tag}>`;
}

/** Distinct kit component names referenced anywhere in the tree (for import reconciliation). */
export function collectKitComponents(node: SljNode): string[] {
  const set = new Set<string>();
  const visit = (n: SljNode) => {
    if (isComponentNode(n)) set.add(n.component);
    n.children.forEach(visit);
  };
  visit(node);
  return [...set];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/sljToJsx.test.ts`
Expected: PASS (all cases). If the escape test's exact string differs, match the test to the real output ONLY if the output still renders the literal braces — do not weaken escaping.

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/sljToJsx.ts studio/__tests__/export/sljToJsx.test.ts
git commit -m "feat(studio/canvas): pure SLJ→JSX printer for Customize"
```

---

## Task 3: Resolve the Customize target (owner-chain → in-source component)

**Files:**
- Create: `studio/src/frame/resolveCustomizeTarget.ts`
- Test: `studio/__tests__/frame/resolveCustomizeTarget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface OwnerLink { componentName: string; file: string; line: number; column: number }`
  - `interface CustomizeTarget { componentName: string; line: number; column: number }`
  - `resolveCustomizeTarget(chain: OwnerLink[], frameSlug: string): CustomizeTarget | null` — `chain` is ordered innermost (clicked element's nearest named owner) → outermost (toward root). Returns the OUTERMOST link whose `file` is the frame's `index.tsx` (`/frames/<frameSlug>/`), as `{componentName,line,column}`; `null` if none is in-source.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/frame/resolveCustomizeTarget.test.ts
import { describe, it, expect } from "vitest";
import { resolveCustomizeTarget, type OwnerLink } from "../../src/frame/resolveCustomizeTarget";

const KIT = "/p/studio/prototype-kit/dist/composites/ChatMessages.js";
const FRAME = "/p/projects/demo/frames/01-computer/index.tsx";

describe("resolveCustomizeTarget", () => {
  it("returns the outermost in-source component (all-composite frame)", () => {
    // innermost → outermost
    const chain: OwnerLink[] = [
      { componentName: "Agent", file: KIT, line: 480, column: 9 },
      { componentName: "ChatMessages", file: KIT, line: 20, column: 5 },
      { componentName: "ComputerScene", file: FRAME, line: 6, column: 5 },
    ];
    expect(resolveCustomizeTarget(chain, "01-computer")).toEqual({ componentName: "ComputerScene", line: 6, column: 5 });
  });
  it("returns the in-source component nearest the click when it is itself in-source", () => {
    const F = "/p/projects/demo/frames/02-page/index.tsx";
    const chain: OwnerLink[] = [
      { componentName: "Button", file: F, line: 9, column: 7 },
      { componentName: "Card", file: F, line: 8, column: 5 },
    ];
    // outermost in-source = Card (the whole card expands; both are in-source)
    expect(resolveCustomizeTarget(chain, "02-page")).toEqual({ componentName: "Card", line: 8, column: 5 });
  });
  it("returns null when no owner is in the frame source", () => {
    const chain: OwnerLink[] = [{ componentName: "Agent", file: KIT, line: 1, column: 1 }];
    expect(resolveCustomizeTarget(chain, "01-computer")).toBeNull();
  });
  it("ignores a different frame's file", () => {
    const chain: OwnerLink[] = [{ componentName: "X", file: "/p/projects/demo/frames/99-other/index.tsx", line: 1, column: 1 }];
    expect(resolveCustomizeTarget(chain, "01-computer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/resolveCustomizeTarget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/frame/resolveCustomizeTarget.ts
export interface OwnerLink { componentName: string; file: string; line: number; column: number }
export interface CustomizeTarget { componentName: string; line: number; column: number }

/**
 * Given the fiber owner chain (innermost → outermost) of a clicked element,
 * return the OUTERMOST owner authored in the frame's own index.tsx — that is the
 * component instance the designer/generator actually placed in the frame, and
 * the only one that can be spliced/replaced in the frame source. null when no
 * owner is in-source (element comes entirely from shared component code with no
 * in-frame anchor — should not happen for a rendered frame, but guard anyway).
 */
export function resolveCustomizeTarget(chain: OwnerLink[], frameSlug: string): CustomizeTarget | null {
  const needle = `/frames/${frameSlug}/`;
  let target: CustomizeTarget | null = null;
  for (const link of chain) {
    if (link.file.includes(needle)) {
      // keep overwriting → ends on the outermost in-source link
      target = { componentName: link.componentName, line: link.line, column: link.column };
    }
  }
  return target;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/resolveCustomizeTarget.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/resolveCustomizeTarget.ts studio/__tests__/frame/resolveCustomizeTarget.test.ts
git commit -m "feat(studio/canvas): resolve Customize target to the in-source component"
```

---

## Task 4: Capture the owner chain in the picker

**Files:**
- Modify: `studio/src/frame/picker.ts` (collect every named owner's call-site, not just the first)
- Modify: `studio/src/hooks/editSessionContext.tsx` (`ElementSelection.ownerChain`)
- Test: `studio/__tests__/frame/picker-owner-chain.test.ts`

**Interfaces:**
- Consumes: `OwnerLink` (Task 3), existing `parseFirstUserFrame`, `resolveSelection`, fiber helpers in `picker.ts`.
- Produces: `ElementSelection.ownerChain: OwnerLink[]` (innermost→outermost) on every picked selection; a pure exported helper `buildOwnerChain(fiber, parse, name): OwnerLink[]` testable without a DOM.

> Context for the implementer: `picker.ts` already walks the fiber chain via
> `node.return` and parses the first user-land stack frame
> (`parseFirstUserFrame`) + reads `_debugOwner` for component names. This task
> generalizes that single-frame resolution into a full chain: for EACH named
> owner fiber up the `.return` chain that parses to a user file, push an
> `OwnerLink`. Keep the existing `file/line/column/componentName` on the
> selection (the innermost link) for backward compat with Phase A; ADD
> `ownerChain`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/frame/picker-owner-chain.test.ts
import { describe, it, expect } from "vitest";
import { buildOwnerChain } from "../../src/frame/picker";

// A fake fiber chain: leaf div (no name) → Agent (kit) → ComputerScene (frame).
// Each named fiber exposes a _debugStack whose top user frame is a known file.
function f(name: string | null, stackTop: string | null, ret: any): any {
  return {
    type: name ? Object.assign(() => null, { displayName: name }) : "div",
    _debugStack: stackTop ? { stack: stackTop } : undefined,
    return: ret,
  };
}
const FRAME = "http://localhost/projects/demo/frames/01-x/index.tsx?v=1:6:5";
const KIT = "http://localhost/prototype-kit/dist/composites/ChatMessages.js:480:9";

describe("buildOwnerChain", () => {
  it("collects each named owner with its call-site, innermost first", () => {
    const scene = f("ComputerScene", FRAME, null);
    const agent = f("Agent", KIT, scene);
    const leaf = f(null, null, agent);
    const chain = buildOwnerChain(leaf);
    expect(chain.map((l) => l.componentName)).toEqual(["Agent", "ComputerScene"]);
    expect(chain[1].file).toContain("/frames/01-x/index.tsx");
    expect(chain[1].line).toBe(6);
    expect(chain[1].column).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/picker-owner-chain.test.ts`
Expected: FAIL — `buildOwnerChain` not exported.

- [ ] **Step 3: Add `buildOwnerChain` to `picker.ts` and export it**

In `studio/src/frame/picker.ts`, add (near `resolveSelection`), reusing the existing `parseFirstUserFrame` and `componentNameFromType`/`_debugStack` logic:

```ts
import type { OwnerLink } from "./resolveCustomizeTarget";

/**
 * Walk the fiber `.return` chain from a node and, for every fiber that both has
 * a name and whose `_debugStack` parses to a user source file, emit an
 * OwnerLink. Order is innermost→outermost. Pure over the fiber shape (testable).
 */
export function buildOwnerChain(start: FiberLike | null): OwnerLink[] {
  const out: OwnerLink[] = [];
  let node: FiberLike | null = start;
  while (node) {
    const name =
      (typeof node.type === "function" || (node.type && typeof node.type === "object"))
        ? componentNameFromType(node.type)
        : null;
    const stack = node._debugStack?.stack;
    if (name && stack) {
      const parsed = parseFirstUserFrame(stack);
      if (parsed) out.push({ componentName: name, file: parsed.file, line: parsed.line, column: parsed.column });
    }
    node = node.return ?? null;
  }
  return out;
}
```

(If `FiberLike` lacks `_debugStack`/`return` in its type, widen the local type as the existing `resolveSelection` already does.)

- [ ] **Step 4: Attach `ownerChain` to the posted selection**

In `picker.ts` `resolveSelection`, when building the returned `PickerSelection`, add `ownerChain: buildOwnerChain(fiber)`. In `studio/src/hooks/editSessionContext.tsx`, add to `ElementSelection`:

```ts
  /** Named-component owner chain (innermost→outermost) with call-site files,
   *  for resolving the Customize target. */
  ownerChain: import("../frame/resolveCustomizeTarget").OwnerLink[];
```

and to the `picker.ts` `PickerSelection` interface:

```ts
  ownerChain: import("./resolveCustomizeTarget").OwnerLink[];
```

- [ ] **Step 5: Run test + the existing frame suite**

Run: `pnpm run studio:test __tests__/frame/picker-owner-chain.test.ts && pnpm run studio:test __tests__/frame`
Expected: PASS. If a frame test constructs an `ElementSelection` literal, add `ownerChain: []` to it (the field is required) — assertion behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add studio/src/frame/picker.ts studio/src/hooks/editSessionContext.tsx studio/__tests__/frame/picker-owner-chain.test.ts
git commit -m "feat(studio/canvas): picker captures the component owner chain"
```

---

## Task 5: Client serialize-print-POST orchestration

**Files:**
- Create: `studio/src/lib/customizeClient.ts`
- Test: `studio/__tests__/lib/customizeClient.test.ts`

**Interfaces:**
- Consumes: `exportFrameToSlj`'s internals are NOT reused directly; instead this module serializes the TARGET subtree. To avoid duplicating the whole walk setup, export a reusable `walkComponentSubtree(iframe, targetFiberSelector)` from `exportFrameToSlj.ts` OR (simpler, chosen) add `serializeTargetToSlj(iframe, target)` to `customizeClient.ts` that reuses the same reader/ctx construction. Consumes `sljToJsx` (Task 2), `CustomizeTarget` (Task 3).
- Produces:
  - `buildCustomizePayload(target: CustomizeTarget, jsx: string, frameSlug: string): CustomizePayload`
  - `postCustomize(slug: string, payload: CustomizePayload): Promise<{ ok: boolean; reason?: string }>`
  - `postCustomizeUndo(slug: string, frameSlug: string): Promise<{ ok: boolean }>`

> Implementer note: the heavy part (locate the target fiber in the iframe by
> `componentName` + call-site, build the reader/ctx exactly as
> `exportFrameToSlj.ts` does, run `walkFiber` from that fiber) shares almost all
> of `exportFrameToSlj.ts`. Refactor the reader/ctx construction in
> `exportFrameToSlj.ts` into an exported helper `buildWalkContext(iframe):
> { walkFrom(fiber): SljNode }` and reuse it here, so there is ONE copy of the
> fiber/token/reader wiring. The unit test below covers only the pure payload +
> POST functions; the fiber-locate path is exercised by the manual gate (Task 9)
> since it needs a live React tree.

- [ ] **Step 1: Write the failing test (pure payload + POST)**

```ts
// studio/__tests__/lib/customizeClient.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCustomizePayload, postCustomize, postCustomizeUndo } from "../../src/lib/customizeClient";

describe("buildCustomizePayload", () => {
  it("assembles the endpoint payload", () => {
    const p = buildCustomizePayload({ componentName: "ComputerScene", line: 6, column: 5 }, "<div>x</div>", "01-x");
    expect(p).toEqual({ frameSlug: "01-x", targetComponentName: "ComputerScene", line: 6, column: 5, jsx: "<div>x</div>" });
  });
});

describe("postCustomize / postCustomizeUndo", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("POSTs the payload and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomize("demo", { frameSlug: "01-x", targetComponentName: "C", line: 1, column: 1, jsx: "<div/>" });
    expect(fetchMock).toHaveBeenCalledWith("/api/customize/demo", expect.objectContaining({ method: "POST" }));
    expect(r).toEqual({ ok: true });
  });
  it("returns ok:false on network throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const r = await postCustomize("demo", { frameSlug: "01-x", targetComponentName: "C", line: 1, column: 1, jsx: "<div/>" });
    expect(r.ok).toBe(false);
  });
  it("undo POSTs to the undo route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await postCustomizeUndo("demo", "01-x");
    expect(fetchMock).toHaveBeenCalledWith("/api/customize/demo/undo", expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/customizeClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// studio/src/lib/customizeClient.ts
import type { CustomizeTarget } from "../frame/resolveCustomizeTarget";

export interface CustomizePayload {
  frameSlug: string; targetComponentName: string; line: number; column: number; jsx: string;
}

export function buildCustomizePayload(target: CustomizeTarget, jsx: string, frameSlug: string): CustomizePayload {
  return { frameSlug, targetComponentName: target.componentName, line: target.line, column: target.column, jsx };
}

export async function postCustomize(slug: string, payload: CustomizePayload): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/customize/${slug}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return await res.json();
  } catch { return { ok: false, reason: "network" }; }
}

export async function postCustomizeUndo(slug: string, frameSlug: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/customize/${slug}/undo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frameSlug }),
    });
    return await res.json();
  } catch { return { ok: false }; }
}
```

> The `serializeTargetToSlj(iframe, target)` function (fiber-locate + walk) is
> added in Task 9 alongside the UI wiring, because it can only be meaningfully
> exercised with a live iframe (manual gate). It reuses the refactored
> `buildWalkContext` from `exportFrameToSlj.ts`. Keep it in this file with a
> clear comment that it is integration-tested via the manual gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/customizeClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/customizeClient.ts studio/__tests__/lib/customizeClient.test.ts
git commit -m "feat(studio/canvas): customize client payload + POST helpers"
```

---

## Task 6: Server splice + import reconciliation

**Files:**
- Create: `studio/server/customize/spliceComponent.ts`
- Create: `studio/server/customize/imports.ts`
- Test: `studio/__tests__/server/customize/spliceComponent.test.ts`
- Test: `studio/__tests__/server/customize/imports.test.ts`

**Interfaces:**
- Consumes: `locateJsx` (`server/codeWriter/locateJsx.ts`), `splice` (`server/codeWriter/patchSource.ts`), `ts` reparse pattern.
- Produces:
  - `spliceComponentInSource(source, componentName, line, column, jsx): { ok: true; source: string } | { ok: false; reason: string }` — find the JSX element named `componentName` at `line:column` in `source` and replace the WHOLE element (open→close, or self-closing) with `jsx`; reparse-guard; bail reasons `"target-not-found"`, `"reparse-failed"`.
  - `reconcileArcadeImports(source, names: string[]): string` — ensure each name is imported from `@xorkavi/arcade-gen` (add missing names to the existing import, or insert a new import line if none); returns updated source.

- [ ] **Step 1: Write the failing tests**

```ts
// studio/__tests__/server/customize/spliceComponent.test.ts
import { describe, it, expect } from "vitest";
import { spliceComponentInSource } from "../../../server/customize/spliceComponent";

const SRC = `import { ComputerScene } from "arcade-prototypes";
export default function F() {
  return (
    <ComputerScene />
  );
}
`;

describe("spliceComponentInSource", () => {
  it("replaces the self-closing component element with the new jsx", () => {
    // <ComputerScene /> is on line 4; column of the tag name ~6
    const r = spliceComponentInSource(SRC, "ComputerScene", 4, 6, `<div className="flex">hi</div>`) as any;
    expect(r.ok).toBe(true);
    expect(r.source).toContain(`<div className="flex">hi</div>`);
    expect(r.source).not.toContain(`<ComputerScene />`);
  });
  it("bails when the replacement would not parse", () => {
    const r = spliceComponentInSource(SRC, "ComputerScene", 4, 6, `<div>`) as any; // unbalanced
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("reparse-failed");
  });
  it("bails when the target isn't found", () => {
    const r = spliceComponentInSource(SRC, "Nope", 4, 6, `<div/>`) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("target-not-found");
  });
});
```

```ts
// studio/__tests__/server/customize/imports.test.ts
import { describe, it, expect } from "vitest";
import { reconcileArcadeImports } from "../../../server/customize/imports";

describe("reconcileArcadeImports", () => {
  it("adds missing names to an existing arcade-gen import", () => {
    const src = `import { Button } from "@xorkavi/arcade-gen";\nexport default function F(){return null}\n`;
    const out = reconcileArcadeImports(src, ["Button", "Icon"]);
    expect(out).toMatch(/import \{ (Button, Icon|Icon, Button) \} from "@xorkavi\/arcade-gen";/);
  });
  it("inserts a new import when none exists", () => {
    const src = `export default function F(){return null}\n`;
    const out = reconcileArcadeImports(src, ["Card"]);
    expect(out).toContain(`import { Card } from "@xorkavi/arcade-gen";`);
  });
  it("is a no-op when all names already imported", () => {
    const src = `import { Button, Icon } from "@xorkavi/arcade-gen";\n`;
    expect(reconcileArcadeImports(src, ["Button"])).toBe(src);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/customize`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `spliceComponent.ts`**

```ts
// studio/server/customize/spliceComponent.ts
import ts from "typescript";
import { locateJsx } from "../codeWriter/locateJsx";
import { splice } from "../codeWriter/patchSource";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

export function spliceComponentInSource(
  source: string, componentName: string, line: number, column: number, jsx: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  const hit = locateJsx(source, line, column);
  if (!hit || hit.tagName !== componentName) {
    // fall back: scan for the named element nearest the requested line
    return { ok: false, reason: "target-not-found" };
  }
  const out = splice(source, hit.elementStart, hit.elementEnd, jsx);
  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
```

- [ ] **Step 4: Write `imports.ts`**

```ts
// studio/server/customize/imports.ts
const ARCADE = "@xorkavi/arcade-gen";

/** Ensure every name in `names` is imported from arcade-gen. Minimal string edit. */
export function reconcileArcadeImports(source: string, names: string[]): string {
  if (names.length === 0) return source;
  const importRe = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${ARCADE.replace(/[/-]/g, "\\$&")}["'];?`);
  const m = importRe.exec(source);
  if (m) {
    const existing = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const merged = [...existing];
    for (const n of names) if (!existing.includes(n)) merged.push(n);
    if (merged.length === existing.length) return source; // no-op
    const rebuilt = `import { ${merged.join(", ")} } from "${ARCADE}";`;
    return source.slice(0, m.index) + rebuilt + source.slice(m.index + m[0].length);
  }
  // no existing arcade-gen import → insert at top
  const line = `import { ${names.join(", ")} } from "${ARCADE}";\n`;
  return line + source;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/customize`
Expected: PASS. If `locateJsx` resolves the `<ComputerScene />` column differently than 6, fix the TEST's column to the real tag-name position (do not loosen `spliceComponentInSource`).

- [ ] **Step 6: Commit**

```bash
git add studio/server/customize/spliceComponent.ts studio/server/customize/imports.ts studio/__tests__/server/customize/spliceComponent.test.ts studio/__tests__/server/customize/imports.test.ts
git commit -m "feat(studio/canvas): server splice-component + arcade-gen import reconciliation"
```

---

## Task 7: Customize endpoint (+ undo) + Vite wiring

**Files:**
- Create: `studio/server/middleware/customize.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/customize/endpoint.test.ts`

**Interfaces:**
- Consumes: `spliceComponentInSource`, `reconcileArcadeImports` (Task 6), `collectKitComponents` (Task 2 — but the server gets the already-printed JSX, so it re-derives kit names from the JSX or the client sends them — see note), `frameDir` (`server/paths.ts`).
- Produces: `customizeMiddleware()` — Connect-style, matches `POST /api/customize/:slug` and `POST /api/customize/:slug/undo`. Mirrors the `visualEditMiddleware` shape from Phase A.

> Note on kit-import names: the printed `jsx` references kit components by tag.
> The endpoint extracts capitalized JSX tags from the `jsx` string
> (`/<([A-Z]\w*)/g`) to feed `reconcileArcadeImports`. (Simpler than threading
> `collectKitComponents` across the boundary, and robust to what's actually in
> the emitted code.)

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/customize/endpoint.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }, readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { customizeMiddleware } from "../../../server/middleware/customize";

function mkReq(url: string, body: unknown): IncomingMessage {
  const req: any = (async function* () { yield Buffer.from(JSON.stringify(body)); })();
  req.url = url; req.method = "POST";
  return req as IncomingMessage;
}
function mkRes() {
  const res: any = { statusCode: 0, body: "" };
  res.writeHead = (s: number) => { res.statusCode = s; };
  res.end = (b?: string) => { res.body = b ?? ""; };
  return res as ServerResponse & { statusCode: number; body: string };
}

const SRC = `import { ComputerScene } from "arcade-prototypes";
export default function F() {
  return (
    <ComputerScene />
  );
}
`;

describe("customizeMiddleware", () => {
  beforeEach(() => { readFile.mockReset(); writeFile.mockReset(); });

  it("splices the jsx, reconciles imports, writes, returns ok", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6,
      jsx: `<div className="flex"><Button>Go</Button></div>`,
    }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain(`<div className="flex">`);
    expect(written).toMatch(/import \{ Button \} from "@xorkavi\/arcade-gen";/);
    expect(written).not.toContain(`<ComputerScene />`);
  });

  it("snapshots before write so undo can restore", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6, jsx: `<div>x</div>`,
    }), res, () => {});
    // undo restores the original
    const res2 = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo/undo", { frameSlug: "01-c" }), res2, () => {});
    expect(JSON.parse(res2.body)).toEqual({ ok: true });
    const restored = writeFile.mock.calls[writeFile.mock.calls.length - 1][1] as string;
    expect(restored).toBe(SRC);
  });

  it("aborts (no write) when reparse fails", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6, jsx: `<div>`,
    }), res, () => {});
    expect(JSON.parse(res.body).ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("400s on malformed body", async () => {
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", { frameSlug: "01-c" }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("calls next for unrelated routes", async () => {
    const next = vi.fn();
    await customizeMiddleware()(mkReq("/api/other", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/customize/endpoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `customize.ts`**

```ts
// studio/server/middleware/customize.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { spliceComponentInSource } from "../customize/spliceComponent";
import { reconcileArcadeImports } from "../customize/imports";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// One pre-Customize snapshot per "<slug>::<frameSlug>", for single-step Undo.
const undoSnapshots = new Map<string, string>();

function framePath(slug: string, frameSlug: string): { file: string; base: string } {
  const base = frameDir(slug, frameSlug);
  return { file: path.join(base, "index.tsx"), base };
}
function kitNamesIn(jsx: string): string[] {
  const set = new Set<string>();
  for (const m of jsx.matchAll(/<([A-Z]\w*)/g)) set.add(m[1]);
  return [...set];
}

export function customizeMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/customize/")) return next?.();

    // .../undo
    if (url.endsWith("/undo")) {
      const slug = url.slice("/api/customize/".length, -"/undo".length);
      const body = await readJson(req);
      const frameSlug = body?.frameSlug;
      if (typeof frameSlug !== "string") return send(res, 400, { ok: false, reason: "bad_request" });
      const key = `${slug}::${frameSlug}`;
      const snap = undoSnapshots.get(key);
      if (snap == null) return send(res, 200, { ok: false, reason: "nothing-to-undo" });
      try {
        const { file, base } = framePath(slug, frameSlug);
        if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
        await fs.writeFile(file, snap, "utf-8");
        undoSnapshots.delete(key);
        return send(res, 200, { ok: true });
      } catch { return send(res, 200, { ok: false, reason: "undo-write-failed" }); }
    }

    const slug = url.slice("/api/customize/".length);
    const body = await readJson(req);
    const { frameSlug, targetComponentName, line, column, jsx } = body ?? {};
    if (typeof frameSlug !== "string" || typeof targetComponentName !== "string" ||
        typeof line !== "number" || typeof column !== "number" || typeof jsx !== "string") {
      return send(res, 400, { ok: false, reason: "bad_request" });
    }
    try {
      const { file, base } = framePath(slug, frameSlug);
      if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
      const source = await fs.readFile(file, "utf-8");
      const spliced = spliceComponentInSource(source, targetComponentName, line, column, jsx);
      if (!spliced.ok) return send(res, 200, spliced);
      const withImports = reconcileArcadeImports(spliced.source, kitNamesIn(jsx));
      undoSnapshots.set(`${slug}::${frameSlug}`, source); // snapshot BEFORE write
      await fs.writeFile(file, withImports, "utf-8");
      return send(res, 200, { ok: true });
    } catch (err) {
      console.warn("[customize] failed:", err);
      return send(res, 200, { ok: false, reason: "customize-threw" });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/customize/endpoint.test.ts`
Expected: PASS (5 cases). Adjust the test's `column: 6` to the real tag position if needed (not the production code).

- [ ] **Step 5: Register in Vite**

In `studio/vite.config.ts`, add the import near the other middleware imports:

```ts
import { customizeMiddleware } from "./server/middleware/customize";
```

and inside `configureServer(server)` after the `visualEditMiddleware()` line:

```ts
      server.middlewares.use(customizeMiddleware());
```

- [ ] **Step 6: Run the whole server suite (vite.config import didn't break anything)**

Run: `pnpm run studio:test __tests__/server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/customize.ts studio/vite.config.ts studio/__tests__/server/customize/endpoint.test.ts
git commit -m "feat(studio/canvas): POST /api/customize endpoint with single-step undo + Vite wiring"
```

---

## Task 8: The `💠 Component` chip on the selection overlay

**Files:**
- Modify: `studio/src/frame/overlay/overlays.ts` (render the chip on the selection box)
- Modify: `studio/src/frame/overlay/index.ts` (expose `setSelectionChip(text, onClick) / clearSelectionChip` or a param on `showSelection`)
- Test: `studio/__tests__/frame/overlay-chip.test.ts` (jsdom)

**Interfaces:**
- Consumes: existing `showSelection(el)`, the `dimensionLabel` DOM-label pattern in `overlays.ts`.
- Produces: a way to show/hide a chip anchored to the selection box top-left reading a given label, with a clickable region that posts `arcade-studio:customize-request` to the parent. Exact export: `showComponentChip(el: HTMLElement)` + `hideComponentChip()` in `overlays.ts`, re-exported from `index.ts`.

> The chip is created like the existing `dimensionLabel`: a positioned `div`
> appended to `document.documentElement`, repositioned in `reposition()`. The
> clickable "Customize" span posts a message to the parent window (the shell
> handles the confirm + flow). The chip text is the verbatim
> `💠 Component · Customize` with "Customize" as the click target.

- [ ] **Step 1: Write the failing test (jsdom)**

```ts
// studio/__tests__/frame/overlay-chip.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { showComponentChip, hideComponentChip } from "../../src/frame/overlay/overlays";

describe("component chip", () => {
  beforeEach(() => { document.documentElement.innerHTML = ""; });
  it("renders a chip with the exact label and a Customize click target", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, right: 110, bottom: 60, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("💠 Component");
    const cust = chip.querySelector("[data-arcade-customize]") as HTMLElement;
    expect(cust).toBeTruthy();
    expect(cust.textContent).toContain("Customize");
  });
  it("clicking Customize posts a customize-request to the parent", () => {
    const post = vi.fn();
    (window as any).parent = { postMessage: post };
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);
    (document.querySelector("[data-arcade-customize]") as HTMLElement).click();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "arcade-studio:customize-request" }), "*");
  });
  it("hideComponentChip removes it", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el); hideComponentChip();
    expect(document.querySelector("[data-arcade-component-chip]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/overlay-chip.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement the chip in `overlays.ts`**

Add to `studio/src/frame/overlay/overlays.ts` (mirroring the `dimensionLabel` create/position pattern; reuse the file's existing positioning helpers):

```ts
let componentChip: HTMLElement | null = null;

export function showComponentChip(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  if (!componentChip) {
    componentChip = document.createElement("div");
    componentChip.setAttribute("data-arcade-component-chip", "");
    componentChip.style.cssText =
      "position:fixed;z-index:2147483646;display:inline-flex;align-items:center;gap:6px;" +
      "font:600 11px system-ui,sans-serif;color:#7c3aed;background:#f3effe;border:1px solid #e3d9fb;" +
      "padding:3px 9px;border-radius:10px;pointer-events:auto;cursor:default;";
    const label = document.createElement("span");
    label.textContent = "💠 Component · ";
    const cust = document.createElement("u");
    cust.setAttribute("data-arcade-customize", "");
    cust.textContent = "Customize";
    cust.style.cursor = "pointer";
    cust.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { window.parent?.postMessage({ type: "arcade-studio:customize-request" }, "*"); } catch { /* noop */ }
    });
    componentChip.appendChild(label); componentChip.appendChild(cust);
    document.documentElement.appendChild(componentChip);
  }
  // anchor top-left, sitting just above the selection box
  componentChip.style.left = `${r.left}px`;
  componentChip.style.top = `${Math.max(0, r.top - 24)}px`;
}

export function hideComponentChip(): void {
  componentChip?.remove();
  componentChip = null;
}
```

Re-export both from `studio/src/frame/overlay/index.ts`:

```ts
export { showComponentChip, hideComponentChip } from "./overlays";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/overlay-chip.test.ts && pnpm run studio:test __tests__/frame`
Expected: PASS (chip tests + existing frame/overlay suite).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/overlays.ts studio/src/frame/overlay/index.ts studio/__tests__/frame/overlay-chip.test.ts
git commit -m "feat(studio/canvas): 💠 Component chip on the selection overlay"
```

---

## Task 9: Wire it together — chip detection, confirm, serialize→print→POST, toast/undo

**Files:**
- Modify: `studio/src/lib/exportFrameToSlj.ts` (extract `buildWalkContext(iframe)` for reuse)
- Modify: `studio/src/lib/customizeClient.ts` (add `serializeTargetToSlj(iframe, target)`)
- Modify: `studio/src/components/inspector/InspectorPanel.tsx` (locked-note for components; receive customize-request; confirm dialog; run flow; toast + Undo)
- Modify: `studio/src/components/viewport/FrameCard.tsx` (show chip when picked element is a component; forward customize-request)
- Test: `studio/__tests__/components/customize-flow.test.tsx`

**Interfaces:**
- Consumes: `resolveCustomizeTarget` (3), `sljToJsx` (2), `buildCustomizePayload`/`postCustomize`/`postCustomizeUndo` (5), `isInFrame` (Phase A), `showComponentChip`/`hideComponentChip` (8), `ownerChain` on the selection (4).
- Produces: the end-to-end Customize interaction. `serializeTargetToSlj(iframe, target): SljNode` in `customizeClient.ts` (integration-tested via manual gate).

> This task is integration + UI. The unit test covers the decision logic and the
> confirm/toast wiring with the network + serialization mocked. The true
> end-to-end (live fiber walk + real frame) is the human manual gate at the end.

- [ ] **Step 1: Extract `buildWalkContext` in `exportFrameToSlj.ts`**

Refactor the reader/ctx/rootFiber construction in `exportFrameToSlj.ts` into an exported helper so Customize reuses ONE copy:

```ts
// add to studio/src/lib/exportFrameToSlj.ts
export interface WalkHandle {
  walkFrom(fiber: MinimalFiber): import("../export/slj").SljNode;
  /** Find the fiber for a named component instance whose call-site is line:col. */
  findComponentFiber(componentName: string, line: number, column: number): MinimalFiber | null;
}
export function buildWalkContext(iframe: HTMLIFrameElement): WalkHandle {
  // ... move the existing rootFiber + reader + ctx construction here ...
  // walkFrom(fiber) => walkFiber(fiber, ctx)
  // findComponentFiber: BFS the tree for a fiber whose fiberName === componentName
  //   (the call-site line:col disambiguates duplicates; match the nearest).
}
```

Have the existing `exportFrameToSlj` call `buildWalkContext(iframe).walkFrom(rootFiber)`. Run `pnpm run studio:test __tests__/export` — existing export tests must still pass (pure refactor).

- [ ] **Step 2: Add `serializeTargetToSlj` to `customizeClient.ts`**

```ts
// in studio/src/lib/customizeClient.ts
import { buildWalkContext } from "./exportFrameToSlj";
import { sljToJsx } from "../export/sljToJsx";
import type { CustomizeTarget } from "../frame/resolveCustomizeTarget";

/** Locate the target component's fiber in the live iframe and serialize its
 *  rendered subtree to a JSX string. Integration-tested via the manual gate. */
export function serializeTargetToJsx(iframe: HTMLIFrameElement, target: CustomizeTarget): string {
  const h = buildWalkContext(iframe);
  const fiber = h.findComponentFiber(target.componentName, target.line, target.column);
  if (!fiber) throw new Error("customize: target component fiber not found");
  return sljToJsx(h.walkFrom(fiber));
}
```

- [ ] **Step 3: Write the failing flow test (mocked serialize + network)**

```tsx
// studio/__tests__/components/customize-flow.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCustomizeTarget } from "../../src/frame/resolveCustomizeTarget";

// This test validates the decision + payload wiring without a live iframe.
describe("customize flow decision", () => {
  it("resolves target then builds a payload from a component selection", async () => {
    const { buildCustomizePayload, postCustomize } = await import("../../src/lib/customizeClient");
    const target = resolveCustomizeTarget(
      [{ componentName: "Agent", file: "/x/prototype-kit/y.js", line: 1, column: 1 },
       { componentName: "ComputerScene", file: "/p/projects/demo/frames/01-c/index.tsx", line: 4, column: 6 }],
      "01-c",
    )!;
    expect(target.componentName).toBe("ComputerScene");
    const payload = buildCustomizePayload(target, `<div>x</div>`, "01-c");
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomize("demo", payload);
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/customize/demo");
  });
});
```

- [ ] **Step 4: Run it (expect PASS once Tasks 2/3/5 exist — this binds them)**

Run: `pnpm run studio:test __tests__/components/customize-flow.test.tsx`
Expected: PASS (it composes already-built units). If it fails, the composition contract drifted — fix the calling code, not the test.

- [ ] **Step 5: Wire the UI in `InspectorPanel.tsx` + `FrameCard.tsx`**

Implement (no new exported API to test in unit scope; covered by the manual gate):
- In `FrameCard.tsx`: when a picked selection is a component (`!isInFrame(selection.file, frame.slug)`), call `showComponentChip(pickedEl)` on selection and `hideComponentChip()` on clear. Listen for `arcade-studio:customize-request` from the iframe and forward it to the shell (set a flag / call a handler passed from `ProjectDetail`).
- In `InspectorPanel.tsx`: for a component selection, render the locked-note `💠 Parts of this are prebuilt. Customize to change anything inside.` under the existing kit-prop section (Task 9 of Phase A already renders the props). On `customize-request`:
  1. `const target = resolveCustomizeTarget(selection.ownerChain, frameSlug)`. If null → toast "Couldn't customize this automatically — describe the change in chat instead." and return.
  2. Show the confirm dialog (title/body/buttons verbatim). On Cancel → abort.
  3. On Customize → `const jsx = serializeTargetToJsx(frameWindowIframe, target)`; `const r = await postCustomize(slug, buildCustomizePayload(target, jsx, frameSlug))`.
  4. If `r.ok` → frame hot-reloads; show toast `✓ Now fully editable.` with an `Undo` action calling `postCustomizeUndo(slug, frameSlug)`. Clear the inspector.
  5. If `!r.ok` → toast "Couldn't customize this automatically — describe the change in chat instead." (no file change happened server-side).

Use the existing modal/toast primitives in the shell (mirror how other confirms/toasts are done — search for an existing confirm dialog or `Modal` usage in `src/components`). Keep all copy verbatim.

- [ ] **Step 6: Run the component + full suite**

Run: `pnpm run studio:test __tests__/components && pnpm run studio:test`
Expected: PASS (full suite green except the known pre-existing `figmaIngest` flake — confirm in isolation if it appears: `pnpm run studio:test __tests__/server/figmaIngest.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add studio/src/lib/exportFrameToSlj.ts studio/src/lib/customizeClient.ts studio/src/components/inspector/InspectorPanel.tsx studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/customize-flow.test.tsx
git commit -m "feat(studio/canvas): wire Customize end-to-end — chip, confirm, serialize→splice, undo"
```

- [ ] **Step 8: Manual fidelity gate (HUMAN, requires app restart)**

`pnpm run studio`. Two checks:
1. **Computer frame:** open the seeded computer reference frame, click the Agent message bubble → `💠 Component · Customize` chip appears → Customize → confirm dialog → after: the frame renders pixel-identically, the clicked element is now a directly-editable element inside expanded markup, `prototype-kit/` is untouched, `index.tsx` now contains the expanded JSX instead of `<ComputerScene/>`. Undo restores `<ComputerScene/>`.
2. **Generated frame:** prompt "a settings page with a few cards and a save button"; pick a `<div>`/heading the frame authored → it should be editable directly (Phase A inspector, no chip). If it placed an in-source `<Card>`/`<Button>`, clicking inside → chip → Customize expands just that component.

Record results in the progress ledger. Visual fidelity + hot-reload cannot be unit-tested; this gate is required before merge.

---

## Final verification

- [ ] **Full suite:** `pnpm run studio:test` — all green (modulo the known `figmaIngest` flake; verify it passes in isolation).
- [ ] **Both manual gate scenarios pass** (Task 9 Step 8).
- [ ] **Frame never left broken:** a Customize whose printed JSX fails reparse leaves `index.tsx` untouched and shows the chat-fallback toast.
- [ ] **Undo restores** the exact pre-Customize source.

## Notes on deferred scope (sub-project B — separate spec/plan)

- On-canvas resize/move handles, arbitrary `w-[300px]` sizing, panel-mirrored precision drag. Once a component is Customized (now plain in-frame markup), B's direct-manipulation handles will operate on it like any frame-authored element.
- General multi-step undo (only single-step Customize undo here).
