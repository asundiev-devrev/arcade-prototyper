# Direct Canvas Editing (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user restyle / retext / reorder a frame's elements through the existing Inspector and have the change written directly into the frame's `index.tsx` — deterministically, no Claude round-trip — with a silent fall back to the existing chat path when the change can't be mapped to code.

**Architecture:** One new server module (`codeWriter`) parses the frame's TSX with the TypeScript compiler API, locates the JSX element at the picker-supplied `line:column`, and applies the change by **string-splicing** the source at TS-provided node positions (preserves formatting; never reprints the file). A re-parse guard discards any patch that breaks syntax. A new `POST /api/visual-edit/:slug` endpoint drives it. The Inspector's existing `commit()` is forked to try this endpoint first and fall back to today's `onSend(preamble)` chat flow on `{ ok: false }`. The risky pixel→source resolution is already shipped (picker + inspector); this plan only adds the write-back.

**Tech Stack:** TypeScript compiler API (`typescript` 5.9.3, already a dependency — NOT Babel), Vite dev-server middleware, Vitest, React (Inspector UI).

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. Tests run via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`), not from `studio/`.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/<area>`: e.g. `feat(studio/canvas): ...`.
- **Vite middleware does NOT hot-reload** — after editing anything under `server/middleware/*` or `vite.config.ts`, a full app restart is required to test live. Unit tests don't need a restart.
- **Express only in Tailwind utility classes / arcade-gen tokens** when writing classes into source — never raw hex or inline `style` props. (Matches `visualEditPreamble.ts`.)
- **Path safety:** every disk write must resolve through `frameDir(slug, frameSlug)` from `server/paths.ts` (which calls `requireSlug`), and must confirm the resolved path stays inside the project dir before writing.
- **Deterministic coverage is a fixed list** (see Task 5). Anything outside it returns `{ ok: false, reason }` and the client falls back to chat. A missed bail that writes broken/wrong code is the worst failure — bail conservatively.
- All new server code is TypeScript ESM under `studio/server/`; tests under `studio/__tests__/server/`.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/server/codeWriter/pxScale.ts` | Pure: raw CSS value (`"24px"`, `"600"`, `"0.5"`) + field → Tailwind class, or `null` | 1 |
| `studio/server/codeWriter/classFamily.ts` | Pure: field → class-family matcher + add/remove a class within its family on a className string | 2 |
| `studio/server/codeWriter/locateJsx.ts` | TS AST: find the JSX opening element at a 1-based `line:column` | 3 |
| `studio/server/codeWriter/patchSource.ts` | TS AST + string-splice: read/replace a className literal; replace a single text child; with typed bail reasons | 4 |
| `studio/server/codeWriter/index.ts` | Orchestrator: translate an `EditedElement[]` batch → patches, apply, re-parse guard, return `{ ok, reason }` | 5 |
| `studio/server/middleware/visualEdit.ts` | `POST /api/visual-edit/:slug` endpoint | 6 |
| `studio/vite.config.ts` | Register the new middleware | 6 |
| `studio/src/components/inspector/InspectorPanel.tsx` | Fork `commit()`: deterministic-first, chat fallback; auto-apply on text-blur & token-pick; success flash | 7 |
| `studio/src/lib/visualEditClient.ts` | Client helper: POST the batch, return `{ ok, reason }` | 7 |
| `studio/server/codeWriter/reorder.ts` + endpoint/UI wiring | Sibling up/down move op | 8 |
| `studio/server/codeWriter/kitProps.ts` + Inspector kit UI | Kit-component prop introspection, gray-the-rest, prop-attribute patch | 9 |

**Shared types** (define once in Task 5, `index.ts`, consumed by 6–9):

```ts
// A single field change requested by the inspector.
// value is either a raw computed CSS value ("24px") or a token-prefixed class ("tok:bg-(--bg-neutral-medium)").
export interface FieldEdit { field: string; value: string }

// One element's worth of edits, mirroring the client EditedElement shape.
export interface ElementEdit {
  file: string;          // absolute path from picker (…/frames/<frameSlug>/index.tsx)
  line: number;          // 1-based
  column: number;        // 1-based
  text?: string;         // new text content if a text edit is present
  fields: FieldEdit[];   // style/class edits (excludes text & iconSwap)
  iconSwap?: string;     // present ⇒ always bail to chat in Phase A
}

export interface VisualEditRequest { frameSlug: string; edits: ElementEdit[] }

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: string };
```

---

## Task 1: px / raw-value → Tailwind class mapper

**Files:**
- Create: `studio/server/codeWriter/pxScale.ts`
- Test: `studio/__tests__/server/codeWriter/pxScale.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pxToSpace(px: number): string | null` — px → Tailwind 4px-grid step token (`"6"` for 24px), or null if not an exact step.
  - `pxToRadius(px: number): string | null` — px → rounded suffix (`"md"`, `"full"`, or `""` for the bare `rounded`), or null.
  - `translateField(field: string, value: string): string | null` — field + raw value → a complete Tailwind class (`"pt-6"`, `"font-semibold"`, `"opacity-50"`), or null to signal "cannot map → bail".
  - `SPACE_FIELDS: ReadonlySet<string>` — the per-side spacing field names this module handles.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/pxScale.test.ts
import { describe, it, expect } from "vitest";
import { pxToSpace, pxToRadius, translateField } from "../../../server/codeWriter/pxScale";

describe("pxToSpace", () => {
  it("maps exact grid steps", () => {
    expect(pxToSpace(0)).toBe("0");
    expect(pxToSpace(16)).toBe("4");
    expect(pxToSpace(24)).toBe("6");
    expect(pxToSpace(2)).toBe("0.5");
  });
  it("returns null for off-grid", () => {
    expect(pxToSpace(23)).toBeNull();
    expect(pxToSpace(17)).toBeNull();
  });
});

describe("pxToRadius", () => {
  it("maps the radius scale", () => {
    expect(pxToRadius(0)).toBe("none");
    expect(pxToRadius(4)).toBe("");      // bare `rounded`
    expect(pxToRadius(6)).toBe("md");
    expect(pxToRadius(9999)).toBe("full");
  });
  it("returns null off-scale", () => {
    expect(pxToRadius(5)).toBeNull();
  });
});

describe("translateField", () => {
  it("per-side padding/margin/gap", () => {
    expect(translateField("paddingTop", "24px")).toBe("pt-6");
    expect(translateField("marginLeft", "16px")).toBe("ml-4");
    expect(translateField("gap", "8px")).toBe("gap-2");
  });
  it("radius", () => {
    expect(translateField("borderRadius", "6px")).toBe("rounded-md");
    expect(translateField("borderRadius", "4px")).toBe("rounded");
  });
  it("font weight / align / style / opacity", () => {
    expect(translateField("fontWeight", "600")).toBe("font-semibold");
    expect(translateField("textAlign", "center")).toBe("text-center");
    expect(translateField("fontStyle", "italic")).toBe("italic");
    expect(translateField("fontStyle", "normal")).toBe("not-italic");
    expect(translateField("opacity", "0.5")).toBe("opacity-50");
  });
  it("bails (null) for unsupported fields & off-scale values", () => {
    expect(translateField("fontSize", "18px")).toBeNull();   // typography → AI
    expect(translateField("width", "247px")).toBeNull();     // sizing → AI in v1
    expect(translateField("paddingTop", "23px")).toBeNull(); // off-grid
    expect(translateField("opacity", "0.37")).toBeNull();    // not /5 step
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/pxScale.test.ts`
Expected: FAIL — `Cannot find module '../../../server/codeWriter/pxScale'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/pxScale.ts
const SPACE_STEPS: Record<number, string> = {
  0: "0", 2: "0.5", 4: "1", 6: "1.5", 8: "2", 10: "2.5", 12: "3", 14: "3.5",
  16: "4", 20: "5", 24: "6", 28: "7", 32: "8", 36: "9", 40: "10", 44: "11",
  48: "12", 56: "14", 64: "16", 80: "20", 96: "24",
};
const RADIUS_STEPS: Record<number, string> = {
  0: "none", 2: "sm", 4: "", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl", 9999: "full",
};
const WEIGHTS: Record<string, string> = {
  "100": "font-thin", "200": "font-extralight", "300": "font-light",
  "400": "font-normal", "500": "font-medium", "600": "font-semibold",
  "700": "font-bold", "800": "font-extrabold", "900": "font-black",
};
const SIDE_PREFIX: Record<string, string> = {
  paddingTop: "pt", paddingRight: "pr", paddingBottom: "pb", paddingLeft: "pl",
  marginTop: "mt", marginRight: "mr", marginBottom: "mb", marginLeft: "ml",
  gap: "gap",
};
export const SPACE_FIELDS: ReadonlySet<string> = new Set(Object.keys(SIDE_PREFIX));

function px(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

export function pxToSpace(n: number): string | null {
  return Object.prototype.hasOwnProperty.call(SPACE_STEPS, n) ? SPACE_STEPS[n] : null;
}
export function pxToRadius(n: number): string | null {
  return Object.prototype.hasOwnProperty.call(RADIUS_STEPS, n) ? RADIUS_STEPS[n] : null;
}

export function translateField(field: string, value: string): string | null {
  if (SPACE_FIELDS.has(field)) {
    const n = px(value);
    if (n === null) return null;
    const step = pxToSpace(n);
    return step === null ? null : `${SIDE_PREFIX[field]}-${step}`;
  }
  if (field === "borderRadius") {
    const n = px(value);
    if (n === null) return null;
    const r = pxToRadius(n);
    if (r === null) return null;
    return r === "" ? "rounded" : `rounded-${r}`;
  }
  if (field === "fontWeight") return WEIGHTS[value.trim()] ?? null;
  if (field === "textAlign") {
    return ["left", "center", "right", "justify"].includes(value.trim())
      ? `text-${value.trim()}` : null;
  }
  if (field === "fontStyle") {
    if (value.trim() === "italic") return "italic";
    if (value.trim() === "normal") return "not-italic";
    return null;
  }
  if (field === "opacity") {
    const f = Number(value);
    if (!Number.isFinite(f)) return null;
    const pct = Math.round(f * 100);
    return pct % 5 === 0 && pct >= 0 && pct <= 100 ? `opacity-${pct}` : null;
  }
  // fontSize, width, height, minWidth, maxWidth, minHeight, maxHeight, display,
  // flexDirection → bail to AI in Phase A.
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/pxScale.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/pxScale.ts studio/__tests__/server/codeWriter/pxScale.test.ts
git commit -m "feat(studio/canvas): add raw-value → Tailwind class mapper for direct edits"
```

---

## Task 2: className family editor

**Files:**
- Create: `studio/server/codeWriter/classFamily.ts`
- Test: `studio/__tests__/server/codeWriter/classFamily.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `familyRegexFor(targetClass: string): RegExp | null` — given the NEW class we want to set, the regex matching existing classes in the same family (so they can be removed). `null` ⇒ unknown family (caller bails).
  - `applyClass(className: string, targetClass: string): string` — remove same-family classes from the space-separated `className`, append `targetClass`, return the new string (no duplicate, original order preserved otherwise).
  - `hasSpacingShorthand(className: string, perSideClass: string): boolean` — true if a shorthand (`p-`,`px-`,`py-`,`m-`,`mx-`,`my-`) is present that conflicts with a per-side edit (`pt-6` etc.). Caller bails when true.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/classFamily.test.ts
import { describe, it, expect } from "vitest";
import { applyClass, familyRegexFor, hasSpacingShorthand } from "../../../server/codeWriter/classFamily";

describe("applyClass", () => {
  it("swaps within the per-side padding family", () => {
    expect(applyClass("pt-4 text-sm", "pt-6")).toBe("text-sm pt-6");
  });
  it("swaps a token color family", () => {
    expect(applyClass("text-(--fg-default) font-bold", "text-(--fg-muted)"))
      .toBe("font-bold text-(--fg-muted)");
  });
  it("swaps a type-style token", () => {
    expect(applyClass("text-body-md p-4", "text-title-sm")).toBe("p-4 text-title-sm");
  });
  it("adds when the family is absent", () => {
    expect(applyClass("flex gap-2", "rounded-md")).toBe("flex gap-2 rounded-md");
  });
  it("collapses whitespace and avoids duplicates", () => {
    expect(applyClass("  pt-6   text-sm ", "pt-6")).toBe("text-sm pt-6");
  });
});

describe("familyRegexFor", () => {
  it("knows the families it supports", () => {
    expect(familyRegexFor("pt-6")!.test("pt-4")).toBe(true);
    expect(familyRegexFor("pt-6")!.test("pb-4")).toBe(false);
    expect(familyRegexFor("font-semibold")!.test("font-bold")).toBe(true);
    expect(familyRegexFor("text-(--fg-muted)")!.test("text-(--fg-default)")).toBe(true);
    expect(familyRegexFor("text-(--fg-muted)")!.test("text-center")).toBe(false);
    expect(familyRegexFor("text-center")!.test("text-left")).toBe(true);
    expect(familyRegexFor("text-title-sm")!.test("text-body-md")).toBe(true);
  });
  it("returns null for an unknown class shape", () => {
    expect(familyRegexFor("totally-unknown-xyz")).toBeNull();
  });
});

describe("hasSpacingShorthand", () => {
  it("flags p-/px- conflicts with a per-side padding edit", () => {
    expect(hasSpacingShorthand("p-4 flex", "pt-6")).toBe(true);
    expect(hasSpacingShorthand("px-4 flex", "pt-6")).toBe(true);
    expect(hasSpacingShorthand("py-4 flex", "pt-6")).toBe(true);
  });
  it("does not flag when only per-side classes exist", () => {
    expect(hasSpacingShorthand("pt-4 pb-2", "pt-6")).toBe(false);
  });
  it("ignores non-spacing targets", () => {
    expect(hasSpacingShorthand("p-4", "font-bold")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/classFamily.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/classFamily.ts

// Ordered list of (matcher for the TARGET class) → (family regex for removal).
// Specific entries first; the parenthesised token colors must precede the
// text-align / type-style entries because all three start with "text-".
const FAMILIES: Array<{ when: RegExp; family: RegExp }> = [
  { when: /^p[trbl]-/,            family: /^p[trbl]-/ },   // matched per-side below by exact side
  { when: /^m[trbl]-/,            family: /^m[trbl]-/ },
  { when: /^gap-/,                family: /^gap-/ },
  { when: /^rounded(-|$)/,        family: /^rounded(-|$)/ },
  { when: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
    family: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/ },
  { when: /^opacity-/,            family: /^opacity-/ },
  { when: /^italic$|^not-italic$/, family: /^italic$|^not-italic$/ },
  { when: /^text-\((--[a-z0-9-]+)\)$/,    family: /^text-\((--[a-z0-9-]+)\)$/ },
  { when: /^bg-\((--[a-z0-9-]+)\)$/,      family: /^bg-\((--[a-z0-9-]+)\)$/ },
  { when: /^border-\((--[a-z0-9-]+)\)$/,  family: /^border-\((--[a-z0-9-]+)\)$/ },
  { when: /^text-(body|title|caption|heading|display|label)[a-z-]*$/,
    family: /^text-(body|title|caption|heading|display|label)[a-z-]*$/ },
  { when: /^text-(left|center|right|justify)$/, family: /^text-(left|center|right|justify)$/ },
];

// Per-side spacing needs the EXACT side prefix as its family (pt only removes pt-*).
function perSideFamily(targetClass: string): RegExp | null {
  const m = /^([pm][trbl]|gap)-/.exec(targetClass);
  if (!m) return null;
  return new RegExp(`^${m[1]}-`);
}

export function familyRegexFor(targetClass: string): RegExp | null {
  const perSide = perSideFamily(targetClass);
  if (perSide) return perSide;
  for (const { when, family } of FAMILIES) {
    if (when.test(targetClass)) return family;
  }
  return null;
}

export function applyClass(className: string, targetClass: string): string {
  const family = familyRegexFor(targetClass);
  const tokens = className.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => t !== targetClass && !(family && family.test(t)));
  kept.push(targetClass);
  return kept.join(" ");
}

export function hasSpacingShorthand(className: string, targetClass: string): boolean {
  if (!/^[pm][trbl]-/.test(targetClass)) return false;
  const axis = targetClass[0]; // "p" or "m"
  const shorthand = new RegExp(`^${axis}(x|y)?-`);
  return className.split(/\s+/).filter(Boolean).some((t) => shorthand.test(t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/classFamily.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/classFamily.ts studio/__tests__/server/codeWriter/classFamily.test.ts
git commit -m "feat(studio/canvas): add family-aware className editor for direct edits"
```

---

## Task 3: locate a JSX element at line:column (TS AST)

**Files:**
- Create: `studio/server/codeWriter/locateJsx.ts`
- Test: `studio/__tests__/server/codeWriter/locateJsx.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface JsxHit { tagName: string; openingStart: number; openingEnd: number; elementStart: number; elementEnd: number; selfClosing: boolean }`
    (offsets are absolute character positions into the source string.)
  - `locateJsx(source: string, line: number, column: number): JsxHit | null`
    `line`/`column` are 1-based (picker convention). Returns the JSX opening element whose tag-name identifier is on `line` and nearest to `column`; `null` if none.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/locateJsx.test.ts
import { describe, it, expect } from "vitest";
import { locateJsx } from "../../../server/codeWriter/locateJsx";

const SRC = `export default function F() {
  return (
    <div className="p-4">
      <span className="text-sm">Hi</span>
    </div>
  );
}
`;

describe("locateJsx", () => {
  it("finds the outer div at its tag position", () => {
    // line 3, column 6 == the "div" identifier (1-based: "    <div" → '<' at col 5, 'd' at col 6)
    const hit = locateJsx(SRC, 3, 6);
    expect(hit?.tagName).toBe("div");
    expect(hit?.selfClosing).toBe(false);
  });
  it("finds the inner span on its own line", () => {
    const hit = locateJsx(SRC, 4, 8);
    expect(hit?.tagName).toBe("span");
  });
  it("returns null when no JSX is on the line", () => {
    expect(locateJsx(SRC, 1, 1)).toBeNull();
  });
  it("handles a self-closing element", () => {
    const src2 = `const x = <img src="a.png" />;\n`;
    const hit = locateJsx(src2, 1, 12);
    expect(hit?.tagName).toBe("img");
    expect(hit?.selfClosing).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/locateJsx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/locateJsx.ts
import ts from "typescript";

export interface JsxHit {
  tagName: string;
  openingStart: number;   // start of the opening element (the "<")
  openingEnd: number;     // end of the opening element (after ">")
  elementStart: number;   // start of the whole JsxElement (== openingStart)
  elementEnd: number;     // end of the whole JsxElement (after </tag> or "/>")
  selfClosing: boolean;
}

function tagNameOf(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return node.tagName.getText();
}

export function locateJsx(source: string, line: number, column: number): JsxHit | null {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const target0 = { line: line - 1, character: column - 1 }; // TS is 0-based
  let best: { hit: JsxHit; colDelta: number } | null = null;

  function visit(node: ts.Node) {
    let opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
    let elementEnd = node.getEnd();
    let selfClosing = false;
    if (ts.isJsxElement(node)) { opening = node.openingElement; }
    else if (ts.isJsxSelfClosingElement(node)) { opening = node; selfClosing = true; }

    if (opening) {
      // Position of the tag-name identifier.
      const namePos = opening.tagName.getStart(sf);
      const lc = sf.getLineAndCharacterOfPosition(namePos);
      if (lc.line === target0.line) {
        const colDelta = Math.abs(lc.character - target0.character);
        const hit: JsxHit = {
          tagName: tagNameOf(opening),
          openingStart: (ts.isJsxSelfClosingElement(node) ? node : (node as ts.JsxElement).openingElement).getStart(sf),
          openingEnd: opening.getEnd(),
          elementStart: node.getStart(sf),
          elementEnd,
          selfClosing,
        };
        if (!best || colDelta < best.colDelta) best = { hit, colDelta };
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return best ? best.hit : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/locateJsx.test.ts`
Expected: PASS. If the `column` assertions are off by one for your TS version, adjust the test's expected columns to the actual identifier position — do NOT loosen `locateJsx` to a wide tolerance (nearest-on-line is intentional).

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/locateJsx.ts studio/__tests__/server/codeWriter/locateJsx.test.ts
git commit -m "feat(studio/canvas): locate JSX element at line:column via TS AST"
```

---

## Task 4: patch primitives — className literal & text child

**Files:**
- Create: `studio/server/codeWriter/patchSource.ts`
- Test: `studio/__tests__/server/codeWriter/patchSource.test.ts`

**Interfaces:**
- Consumes: `JsxHit`, `locateJsx` (Task 3).
- Produces:
  - `type Patch = { kind: "className"; current: string; start: number; end: number; insertAttr: boolean } | { kind: "text"; start: number; end: number }`
  - `readClassName(source: string, hit: JsxHit): { ok: true; current: string; valueStart: number; valueEnd: number } | { ok: true; insertAt: number; insertAttr: true; current: "" } | { ok: false; reason: string }`
    — finds the `className` attribute. Plain string literal (`className="…"` or `className={"…"}`) ⇒ returns its inner text range. No `className` attr ⇒ returns an insertion point right after the tag name with `insertAttr: true`. `cn(...)` / template / identifier / conditional ⇒ `{ ok: false, reason: "dynamic-classname" }`.
  - `readTextChild(source: string, hit: JsxHit): { ok: true; start: number; end: number } | { ok: false; reason: string }`
    — single `JsxText` child ⇒ its range. `{expr}` child, multiple element/expression children ⇒ `{ ok: false, reason: "dynamic-text" | "non-leaf-text" }`.
  - `splice(source: string, start: number, end: number, replacement: string): string` — pure string splice.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/patchSource.test.ts
import { describe, it, expect } from "vitest";
import { locateJsx } from "../../../server/codeWriter/locateJsx";
import { readClassName, readTextChild, splice } from "../../../server/codeWriter/patchSource";

function hitFor(src: string, line: number, col: number) {
  const h = locateJsx(src, line, col);
  if (!h) throw new Error("no hit");
  return h;
}

describe("readClassName", () => {
  it("reads a plain string-literal className", () => {
    const src = `const x = <div className="p-4 flex">y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.current).toBe("p-4 flex");
    expect(src.slice(r.valueStart, r.valueEnd)).toBe("p-4 flex");
  });
  it("reads className={\"...\"}", () => {
    const src = `const x = <div className={"p-4"}>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.current).toBe("p-4");
  });
  it("signals insertion when there is no className", () => {
    const src = `const x = <div>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.insertAttr).toBe(true);
    expect(r.current).toBe("");
  });
  it("bails on cn() / dynamic className", () => {
    const src = `const x = <div className={cn("p-4", active && "x")}>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-classname");
  });
});

describe("readTextChild", () => {
  it("reads a single text child", () => {
    const src = `const x = <span>Save</span>;\n`;
    const r = readTextChild(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(src.slice(r.start, r.end)).toBe("Save");
  });
  it("bails on {expr} text", () => {
    const src = `const x = <span>{label}</span>;\n`;
    const r = readTextChild(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-text");
  });
});

describe("splice", () => {
  it("replaces a range", () => {
    expect(splice("abcdef", 2, 4, "XY")).toBe("abXYef");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/patchSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/patchSource.ts
import ts from "typescript";
import type { JsxHit } from "./locateJsx";

export function splice(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}

function openingNodeAt(sf: ts.SourceFile, hit: JsxHit):
  ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.getStart(sf) === hit.openingStart) {
      found = node;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

export type ReadClassName =
  | { ok: true; current: string; valueStart: number; valueEnd: number; insertAttr?: false }
  | { ok: true; current: ""; insertAt: number; insertAttr: true }
  | { ok: false; reason: string };

export function readClassName(source: string, hit: JsxHit): ReadClassName {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const opening = openingNodeAt(sf, hit);
  if (!opening) return { ok: false, reason: "opening-not-found" };
  const attr = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className",
  );
  if (!attr) {
    // insert ` className="…"` right after the tag name
    return { ok: true, current: "", insertAt: opening.tagName.getEnd(), insertAttr: true };
  }
  const init = attr.initializer;
  if (!init) return { ok: false, reason: "dynamic-classname" };
  // className="..."
  if (ts.isStringLiteral(init)) {
    return { ok: true, current: init.text, valueStart: init.getStart(sf) + 1, valueEnd: init.getEnd() - 1 };
  }
  // className={ ... }
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
    const lit = init.expression;
    return { ok: true, current: lit.text, valueStart: lit.getStart(sf) + 1, valueEnd: lit.getEnd() - 1 };
  }
  return { ok: false, reason: "dynamic-classname" };
}

export type ReadText =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: string };

export function readTextChild(source: string, hit: JsxHit): ReadText {
  if (hit.selfClosing) return { ok: false, reason: "no-children" };
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element: ts.JsxElement | null = null;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.getStart(sf) === hit.openingStart) element = node;
    if (!element) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!element) return { ok: false, reason: "element-not-found" };
  const kids = (element as ts.JsxElement).children.filter(
    (c) => !(ts.isJsxText(c) && c.getText().trim() === ""),
  );
  if (kids.length !== 1) return { ok: false, reason: "non-leaf-text" };
  const only = kids[0];
  if (ts.isJsxText(only)) {
    const raw = only.getText();
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    return { ok: true, start: only.getStart(sf) + lead, end: only.getEnd() - trail };
  }
  if (ts.isJsxExpression(only)) return { ok: false, reason: "dynamic-text" };
  return { ok: false, reason: "non-leaf-text" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/patchSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/patchSource.ts studio/__tests__/server/codeWriter/patchSource.test.ts
git commit -m "feat(studio/canvas): add className/text patch primitives with dynamic-code bails"
```

---

## Task 5: code-writer orchestrator + re-parse guard

**Files:**
- Create: `studio/server/codeWriter/index.ts`
- Test: `studio/__tests__/server/codeWriter/index.test.ts`

**Interfaces:**
- Consumes: `translateField`/`SPACE_FIELDS` (1), `applyClass`/`hasSpacingShorthand` (2), `locateJsx` (3), `readClassName`/`readTextChild`/`splice` (4).
- Produces (the shared types from the File map, plus):
  - `applyEditsToSource(source: string, edit: ElementEdit): WriteResult & { source?: string }`
    — pure: applies ONE element's edits to a source string; returns `{ ok: true, source }` or `{ ok: false, reason }`. Bails (whole element) on the first un-mappable field, on dynamic className/text, on a spacing-shorthand conflict, on `iconSwap`, and on any re-parse failure.
  - `writeBatch(frameSlug: string, edits: ElementEdit[]): Promise<WriteResult>`
    — resolves the frame file via `frameDir`, applies every element's edits in one read-modify-write, re-parses once at the end, writes only if valid. If ANY element bails, the whole batch returns `{ ok: false }` and the file is untouched.

**Field-value protocol:** a `FieldEdit.value` beginning with `"tok:"` is already a Tailwind class (strip the prefix, use verbatim with `applyClass`). Otherwise it's a raw CSS value → `translateField`. `text` and `iconSwap` are NOT in `fields` (text is the element's `text`; iconSwap presence forces a bail).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/index.test.ts
import { describe, it, expect } from "vitest";
import { applyEditsToSource, type ElementEdit } from "../../../server/codeWriter/index";

const FILE = "/x/frames/01-demo/index.tsx";
function srcWith(jsx: string) {
  return `export default function F() {\n  return (\n    ${jsx}\n  );\n}\n`;
}
// helper to build an edit whose line:column points at the JSX on line 3
function edit(partial: Partial<ElementEdit>): ElementEdit {
  return { file: FILE, line: 3, column: 6, fields: [], ...partial };
}

describe("applyEditsToSource", () => {
  it("swaps a per-side padding (raw px) deterministically", () => {
    const src = srcWith(`<div className="p-0 pt-4 flex">hi</div>`);
    // NOTE: column must point at the div tag; the helper assumes col 6 on line 3
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "24px" }] }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain("pt-6");
    expect(r.source).not.toContain("pt-4");
  });

  it("applies a token color class verbatim", () => {
    const src = srcWith(`<div className="text-(--fg-default)">hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "color", value: "tok:text-(--fg-muted)" }],
    }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain("text-(--fg-muted)");
    expect(r.source).not.toContain("text-(--fg-default)");
  });

  it("replaces text content", () => {
    const src = srcWith(`<span>Old</span>`);
    const r = applyEditsToSource(src, edit({ text: "New", fields: [] }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain(">New<");
  });

  it("bails on a spacing-shorthand conflict", () => {
    const src = srcWith(`<div className="p-4">hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "24px" }] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("spacing-shorthand-conflict");
  });

  it("bails on an off-scale raw value", () => {
    const src = srcWith(`<div className="flex">hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "23px" }] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unmappable-field:paddingTop");
  });

  it("bails on dynamic className", () => {
    const src = srcWith(`<div className={cn("flex")}>hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-classname");
  });

  it("bails when an iconSwap is requested", () => {
    const src = srcWith(`<div className="flex">hi</div>`);
    const r = applyEditsToSource(src, edit({ iconSwap: "Trash", fields: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("icon-swap");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/index.test.ts`
Expected: FAIL — module not found.

> Note for the implementer: the test helper hard-codes `column: 6` for a JSX tag indented 4 spaces on line 3. If `locateJsx` resolves a different column for your TS version, fix the helper's `column`, not the production code.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/index.ts
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { frameDir } from "../paths";
import { translateField } from "./pxScale";
import { applyClass, hasSpacingShorthand } from "./classFamily";
import { locateJsx } from "./locateJsx";
import { readClassName, readTextChild, splice } from "./patchSource";

export interface FieldEdit { field: string; value: string }
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
}
export interface VisualEditRequest { frameSlug: string; edits: ElementEdit[] }
export type WriteResult = { ok: true } | { ok: false; reason: string };

const TOKEN_PREFIX = "tok:";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // ts.SourceFile carries parseDiagnostics on the internal field; check for any.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

/** Apply one element's edits to a source string. Pure. Bails on the first problem. */
export function applyEditsToSource(
  source: string, edit: ElementEdit,
): (WriteResult & { source?: string }) {
  if (edit.iconSwap) return { ok: false, reason: "icon-swap" };

  let out = source;

  // 1. className edits (must re-locate after each splice; offsets shift).
  for (const f of edit.fields) {
    const targetClass = f.value.startsWith(TOKEN_PREFIX)
      ? f.value.slice(TOKEN_PREFIX.length)
      : translateField(f.field, f.value);
    if (targetClass === null) return { ok: false, reason: `unmappable-field:${f.field}` };

    const hit = locateJsx(out, edit.line, edit.column);
    if (!hit) return { ok: false, reason: "element-not-found" };
    const cn = readClassName(out, hit);
    if (!cn.ok) return { ok: false, reason: cn.reason };

    if ("insertAttr" in cn && cn.insertAttr) {
      out = splice(out, cn.insertAt, cn.insertAt, ` className="${targetClass}"`);
      continue;
    }
    if (hasSpacingShorthand(cn.current, targetClass)) {
      return { ok: false, reason: "spacing-shorthand-conflict" };
    }
    const next = applyClass(cn.current, targetClass);
    out = splice(out, cn.valueStart, cn.valueEnd, next);
  }

  // 2. text content (after class edits; re-locate).
  if (typeof edit.text === "string") {
    const hit = locateJsx(out, edit.line, edit.column);
    if (!hit) return { ok: false, reason: "element-not-found" };
    const tc = readTextChild(out, hit);
    if (!tc.ok) return { ok: false, reason: tc.reason };
    out = splice(out, tc.start, tc.end, edit.text);
  }

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}

/** Apply a whole batch atomically: all-or-nothing. */
export async function writeBatch(frameSlug: string, edits: ElementEdit[]): Promise<WriteResult> {
  if (edits.length === 0) return { ok: false, reason: "empty-batch" };
  // All edits in a batch share one frame; derive the project slug from the path.
  const file = edits[0].file;
  const m = /\/projects\/([^/]+)\/frames\//.exec(file);
  if (!m) return { ok: false, reason: "unresolved-project" };
  const projectSlug = m[1];
  const filePath = path.join(frameDir(projectSlug, frameSlug), "index.tsx");

  // Path-safety: ensure resolved path is inside the project's frames dir.
  const base = frameDir(projectSlug, frameSlug);
  if (!path.resolve(filePath).startsWith(path.resolve(base))) {
    return { ok: false, reason: "path-escape" };
  }

  let source: string;
  try { source = await fs.readFile(filePath, "utf-8"); }
  catch { return { ok: false, reason: "frame-read-failed" }; }

  let working = source;
  for (const e of edits) {
    const r = applyEditsToSource(working, e);
    if (!r.ok) return r;            // whole batch bails on any element
    working = r.source!;
  }
  if (working === source) return { ok: false, reason: "no-change" };

  await fs.writeFile(filePath, working, "utf-8");
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/index.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/index.ts studio/__tests__/server/codeWriter/index.test.ts
git commit -m "feat(studio/canvas): code-writer orchestrator with all-or-nothing batch + reparse guard"
```

---

## Task 6: `POST /api/visual-edit/:slug` endpoint + Vite wiring

**Files:**
- Create: `studio/server/middleware/visualEdit.ts`
- Modify: `studio/vite.config.ts` (import + register)
- Test: `studio/__tests__/server/visualEdit.test.ts`

**Interfaces:**
- Consumes: `writeBatch`, `VisualEditRequest`, `WriteResult` (Task 5).
- Produces: a Connect-style middleware `visualEditMiddleware()` matching the existing `runtimeErrorMiddleware` shape. Responds `200 { ok: true }` on success, `200 { ok: false, reason }` on a deterministic bail (NOT an HTTP error — the client expects a body either way), `400` on malformed input.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/visualEdit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const writeBatch = vi.fn();
vi.mock("../../server/codeWriter/index", () => ({ writeBatch: (...a: unknown[]) => writeBatch(...a) }));

import { visualEditMiddleware } from "../../server/middleware/visualEdit";

function mkReq(url: string, method: string, body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req: any = (async function* () { for (const c of chunks) yield c; })();
  req.url = url; req.method = method;
  return req as IncomingMessage;
}
function mkRes() {
  const res: any = { statusCode: 0, body: "", headers: {} };
  res.writeHead = (s: number, h: Record<string, string>) => { res.statusCode = s; res.headers = h; };
  res.end = (b?: string) => { res.body = b ?? ""; };
  return res as ServerResponse & { statusCode: number; body: string };
}

describe("visualEditMiddleware", () => {
  beforeEach(() => writeBatch.mockReset());

  it("passes valid batches to writeBatch and returns ok", async () => {
    writeBatch.mockResolvedValue({ ok: true });
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST",
      { frameSlug: "01-x", edits: [{ file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6, fields: [] }] }),
      res, () => {});
    expect(writeBatch).toHaveBeenCalledWith("01-x", expect.any(Array));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("returns the bail reason with 200", async () => {
    writeBatch.mockResolvedValue({ ok: false, reason: "dynamic-classname" });
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST",
      { frameSlug: "01-x", edits: [{ file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6, fields: [] }] }),
      res, () => {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: false, reason: "dynamic-classname" });
  });

  it("400s on missing frameSlug/edits", async () => {
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST", { edits: [] }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("calls next for unrelated routes", async () => {
    const mw = visualEditMiddleware();
    const next = vi.fn();
    await mw(mkReq("/api/other", "GET", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/visualEdit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/middleware/visualEdit.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeBatch, type VisualEditRequest } from "../codeWriter/index";

async function readJson(req: IncomingMessage): Promise<unknown> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * POST /api/visual-edit/:slug — apply a batch of deterministic element edits
 * directly to the frame source. Returns { ok:true } on success or
 * { ok:false, reason } when the change can't be mapped (client then falls back
 * to the chat path). HTTP 200 either way; 400 only for malformed input.
 */
export function visualEditMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/visual-edit/")) return next?.();

    const body = (await readJson(req)) as Partial<VisualEditRequest>;
    if (typeof body.frameSlug !== "string" || !Array.isArray(body.edits) || body.edits.length === 0) {
      return send(res, 400, { ok: false, reason: "bad_request" });
    }
    try {
      const result = await writeBatch(body.frameSlug, body.edits);
      send(res, 200, result);
    } catch (err) {
      send(res, 200, { ok: false, reason: "writer-threw" });
      console.warn("[visualEdit] writeBatch threw:", err);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/visualEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the middleware in Vite**

In `studio/vite.config.ts`, add the import alongside the others (near line 32):

```ts
import { visualEditMiddleware } from "./server/middleware/visualEdit";
```

And register it inside `configureServer(server)` near the other `server.middlewares.use(...)` lines (after `chatMiddleware()`):

```ts
      server.middlewares.use(visualEditMiddleware());
```

- [ ] **Step 6: Run the full server suite to confirm nothing regressed**

Run: `pnpm run studio:test __tests__/server`
Expected: PASS (existing tests + the new file).

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/visualEdit.ts studio/vite.config.ts studio/__tests__/server/visualEdit.test.ts
git commit -m "feat(studio/canvas): add POST /api/visual-edit endpoint + wire into Vite"
```

---

## Task 7: client fork — deterministic-first commit, chat fallback, success flash

**Files:**
- Create: `studio/src/lib/visualEditClient.ts`
- Modify: `studio/src/components/inspector/InspectorPanel.tsx` (the `commit()` function + the text-changed effect)
- Test: `studio/__tests__/lib/visualEditClient.test.ts`

**Interfaces:**
- Consumes: `EditedElement` (`editSessionContext`), `isTokenPending`/`tokenClass`, `buildVisualEditPreamble` (unchanged fallback).
- Produces:
  - `toElementEdits(batch: EditedElement[]): { frameSlug: string; edits: ElementEdit[] }` — pure: translate the client batch into the server payload. `tok:`-prefixed pending values become `value: "tok:<class>"`; raw values pass through; `text` becomes `edit.text`; `iconSwap` becomes `edit.iconSwap`; `typeStyle` pending maps to `field: "typeStyle"` with a `tok:` value.
  - `postVisualEdit(slug: string, payload): Promise<{ ok: boolean; reason?: string }>` — POSTs to `/api/visual-edit/:slug`, returns parsed body (or `{ ok: false }` on network error).

> The server `ElementEdit` type lives in `server/codeWriter/index.ts`. The client re-declares a structural copy in `visualEditClient.ts` (no cross-`src`/`server` type import in this repo). Keep the field names identical: `file, line, column, text?, fields[], iconSwap?` and `fields[]` items `{ field, value }`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/visualEditClient.test.ts
import { describe, it, expect } from "vitest";
import { toElementEdits } from "../../src/lib/visualEditClient";
import type { EditedElement } from "../../src/hooks/editSessionContext";

function el(over: Partial<EditedElement["selection"]>, pending: EditedElement["pending"]): EditedElement {
  return {
    selection: {
      editId: 1, file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6,
      componentName: "div", tagName: "div", textEditable: true,
      styles: {} as any, ...over,
    },
    pending,
  };
}

describe("toElementEdits", () => {
  it("derives frameSlug from the file path", () => {
    const r = toElementEdits([el({}, { paddingTop: "24px" })]);
    expect(r.frameSlug).toBe("01-x");
  });
  it("passes raw values through and strips text/icon into their own fields", () => {
    const r = toElementEdits([el({}, {
      paddingTop: "24px",
      color: "tok:text-(--fg-muted)",
      text: "Save",
      iconSwap: "Trash",
    })]);
    const e = r.edits[0];
    expect(e.text).toBe("Save");
    expect(e.iconSwap).toBe("Trash");
    expect(e.fields).toContainEqual({ field: "paddingTop", value: "24px" });
    expect(e.fields).toContainEqual({ field: "color", value: "tok:text-(--fg-muted)" });
    // text & iconSwap must NOT appear in fields
    expect(e.fields.find((f) => f.field === "text")).toBeUndefined();
    expect(e.fields.find((f) => f.field === "iconSwap")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/visualEditClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/lib/visualEditClient.ts
import type { EditedElement } from "../hooks/editSessionContext";

export interface FieldEdit { field: string; value: string }
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
}
export interface VisualEditPayload { frameSlug: string; edits: ElementEdit[] }

export function toElementEdits(batch: EditedElement[]): VisualEditPayload {
  const frameSlug =
    batch[0]?.selection.file.split("/frames/").pop()?.split("/")[0] ?? "";
  const edits: ElementEdit[] = batch.map((e) => {
    const fields: FieldEdit[] = [];
    let text: string | undefined;
    let iconSwap: string | undefined;
    for (const [field, value] of Object.entries(e.pending)) {
      if (value === undefined) continue;
      if (field === "text") { text = value; continue; }
      if (field === "iconSwap") { iconSwap = value; continue; }
      fields.push({ field, value });
    }
    const { file, line, column } = e.selection;
    return { file, line, column, text, fields, iconSwap };
  });
  return { frameSlug, edits };
}

export async function postVisualEdit(
  slug: string, payload: VisualEditPayload,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/visual-edit/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { ok: false, reason: "network" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/visualEditClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Fork `commit()` in InspectorPanel to try deterministic first**

The component currently has (around `InspectorPanel.tsx:174`):

```tsx
  function commit() {
    if (batch.length === 0) { discard(); return; }
    const frameRel = batch[0].selection.file.split("/frames/").pop() ?? batch[0].selection.file;
    const preamble = buildVisualEditPreamble(batch, frameRel);
    if (!preamble) { discard(); return; }
    onSend(preamble, []);
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
```

Add the slug to the component props and make `commit` async. First extend the props type and the destructure at the top of the component:

```tsx
export function InspectorPanel({
  onSend, busy, slug,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
  slug: string;
}) {
```

Add the import at the top of the file:

```tsx
import { toElementEdits, postVisualEdit } from "../../lib/visualEditClient";
```

Then replace `commit()`:

```tsx
  async function commit() {
    if (batch.length === 0) { discard(); return; }
    const frameRel = batch[0].selection.file.split("/frames/").pop() ?? batch[0].selection.file;

    // 1. Try the deterministic code-writer.
    const payload = toElementEdits(batch);
    const det = await postVisualEdit(slug, payload);
    if (det.ok) {
      // Vite will hot-reload the frame from disk; drop the inline preview.
      frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
      clear();
      return;
    }

    // 2. Fall back to the chat path (unchanged behaviour).
    const preamble = buildVisualEditPreamble(batch, frameRel);
    if (!preamble) { discard(); return; }
    onSend(preamble, []);
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
```

And update the Commit button to tolerate the async handler (it already calls `onClick={commit}`; no change needed since `onClick` accepts a `() => void` and `commit` returns a Promise — but silence the floating-promise lint by wrapping):

```tsx
        <Button variant="primary" onClick={() => { void commit(); }} disabled={totalChanges === 0 || busy}>Commit</Button>
```

- [ ] **Step 6: Pass `slug` from the render site**

In `studio/src/routes/ProjectDetail.tsx:430`, change:

```tsx
        <InspectorPanel onSend={(p, imgs) => source.send(p, imgs)} busy={chatStream.state.phase === "running"} />
```

to:

```tsx
        <InspectorPanel onSend={(p, imgs) => source.send(p, imgs)} busy={chatStream.state.phase === "running"} slug={project.slug} />
```

- [ ] **Step 7: Run the affected component/lib suites**

Run: `pnpm run studio:test __tests__/lib/visualEditClient.test.ts && pnpm run studio:test __tests__/components`
Expected: PASS. If a `ProjectDetail`/inspector component test mocks `InspectorPanel` props, add `slug="x"` there (see auto-memory `arcade-gen-mock-projectdetail-tests`).

- [ ] **Step 8: Manual smoke test (requires app restart — middleware changed)**

Run: `pnpm run studio`, open a project, pick a raw `<div>`, change its padding to a clean step (e.g. 24px) and a token text color, click Commit. Expected: NO "Thinking…", the frame hot-reloads with the change, and `frames/<frame>/index.tsx` on disk shows `pt-6` / `text-(--fg-...)`. Then pick an element whose `className` is `cn(...)`, change something, Commit → "Thinking…" appears (chat fallback). Confirm both paths.

- [ ] **Step 9: Commit**

```bash
git add studio/src/lib/visualEditClient.ts studio/src/components/inspector/InspectorPanel.tsx studio/src/routes/ProjectDetail.tsx studio/__tests__/lib/visualEditClient.test.ts
git commit -m "feat(studio/canvas): commit visual edits deterministically with chat fallback"
```

---

## Task 8: sibling reorder (up/down move within layout)

**Files:**
- Create: `studio/server/codeWriter/reorder.ts`
- Modify: `studio/server/codeWriter/index.ts` (export a `moveSibling` orchestrator + extend the endpoint contract), `studio/server/middleware/visualEdit.ts` (accept a `move` op), `studio/src/components/inspector/InspectorPanel.tsx` (up/down buttons in the batch list)
- Test: `studio/__tests__/server/codeWriter/reorder.test.ts`

**Interfaces:**
- Consumes: `locateJsx` (3), `splice` (4), `frameDir`.
- Produces:
  - `moveSiblingInSource(source: string, line: number, column: number, dir: "up" | "down"): { ok: true; source: string } | { ok: false; reason: string }` — pure: finds the JSX element at `line:column`, finds its element siblings in the parent, swaps it with the previous/next element sibling by splicing their source ranges. Bails (`"no-sibling"`) at the boundary, (`"dynamic-parent"`) if the parent's children include non-element expressions that make a textual swap unsafe.
  - `moveSibling(frameSlug: string, file: string, line: number, column: number, dir): Promise<WriteResult>` — read-modify-write wrapper mirroring `writeBatch` (path-safety + reparse guard + write).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/reorder.test.ts
import { describe, it, expect } from "vitest";
import { moveSiblingInSource } from "../../../server/codeWriter/reorder";

const SRC = `export default function F() {
  return (
    <div>
      <span>A</span>
      <span>B</span>
      <span>C</span>
    </div>
  );
}
`;

describe("moveSiblingInSource", () => {
  it("moves B up (swaps with A)", () => {
    // line 5 == the second <span> (B)
    const r = moveSiblingInSource(SRC, 5, 8, "up") as any;
    expect(r.ok).toBe(true);
    const order = [...r.source.matchAll(/<span>([ABC])<\/span>/g)].map((m: any) => m[1]);
    expect(order).toEqual(["B", "A", "C"]);
  });
  it("moves A down (swaps with B)", () => {
    const r = moveSiblingInSource(SRC, 4, 8, "down") as any;
    expect(r.ok).toBe(true);
    const order = [...r.source.matchAll(/<span>([ABC])<\/span>/g)].map((m: any) => m[1]);
    expect(order).toEqual(["B", "A", "C"]);
  });
  it("bails at the top boundary", () => {
    const r = moveSiblingInSource(SRC, 4, 8, "up") as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-sibling");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/reorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/reorder.ts
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { frameDir } from "../paths";
import type { WriteResult } from "./index";
import { splice } from "./patchSource";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

export function moveSiblingInSource(
  source: string, line: number, column: number, dir: "up" | "down",
): { ok: true; source: string } | { ok: false; reason: string } {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const target0 = { line: line - 1, character: column - 1 };

  // Find the target JSX element (element or self-closing) at line:column.
  let target: ts.JsxChild | null = null;
  let parentChildren: ts.NodeArray<ts.JsxChild> | null = null;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      for (const child of node.children) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          const open = ts.isJsxElement(child) ? child.openingElement : child;
          const lc = sf.getLineAndCharacterOfPosition(open.tagName.getStart(sf));
          if (lc.line === target0.line) { target = child; parentChildren = node.children; }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!target || !parentChildren) return { ok: false, reason: "element-not-found" };

  // Element siblings only (ignore whitespace-only JsxText).
  const sibs = parentChildren.filter(
    (c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
  );
  const idx = sibs.indexOf(target);
  const otherIdx = dir === "up" ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= sibs.length) return { ok: false, reason: "no-sibling" };

  const a = idx < otherIdx ? target : sibs[otherIdx];
  const b = idx < otherIdx ? sibs[otherIdx] : target;
  const aStart = a.getStart(sf), aEnd = a.getEnd();
  const bStart = b.getStart(sf), bEnd = b.getEnd();
  const aText = source.slice(aStart, aEnd);
  const bText = source.slice(bStart, bEnd);

  // Swap by splicing the later range first (so earlier offsets stay valid).
  let out = splice(source, bStart, bEnd, aText);
  out = splice(out, aStart, aEnd, bText);

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}

export async function moveSibling(
  frameSlug: string, file: string, line: number, column: number, dir: "up" | "down",
): Promise<WriteResult> {
  const m = /\/projects\/([^/]+)\/frames\//.exec(file);
  if (!m) return { ok: false, reason: "unresolved-project" };
  const base = frameDir(m[1], frameSlug);
  const filePath = path.join(base, "index.tsx");
  if (!path.resolve(filePath).startsWith(path.resolve(base))) return { ok: false, reason: "path-escape" };

  let source: string;
  try { source = await fs.readFile(filePath, "utf-8"); }
  catch { return { ok: false, reason: "frame-read-failed" }; }

  const r = moveSiblingInSource(source, line, column, dir);
  if (!r.ok) return r;
  await fs.writeFile(filePath, r.source, "utf-8");
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the endpoint to accept a move op**

In `studio/server/middleware/visualEdit.ts`, add a branch BEFORE the batch handling. Add the import:

```ts
import { moveSibling } from "../codeWriter/reorder";
```

Inside the handler, after parsing `body`, handle a move-shaped payload (`{ frameSlug, move: { file, line, column, dir } }`):

```ts
    const move = (body as { move?: { file: string; line: number; column: number; dir: "up" | "down" } }).move;
    if (typeof body.frameSlug === "string" && move) {
      try {
        const result = await moveSibling(body.frameSlug, move.file, move.line, move.column, move.dir);
        return send(res, 200, result);
      } catch (err) {
        console.warn("[visualEdit] moveSibling threw:", err);
        return send(res, 200, { ok: false, reason: "move-threw" });
      }
    }
```

- [ ] **Step 6: Add up/down controls to the Inspector batch list**

In `studio/src/components/inspector/InspectorPanel.tsx`, in the batch-list row (near the per-element `×` remove button, `InspectorPanel.tsx:240`), add two small buttons that POST a move and let Vite reload. Add a helper near the other handlers:

```tsx
  async function move(el: EditedElement, dir: "up" | "down") {
    const frameSlug = el.selection.file.split("/frames/").pop()?.split("/")[0] ?? "";
    await fetch(`/api/visual-edit/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameSlug, move: {
        file: el.selection.file, line: el.selection.line, column: el.selection.column, dir,
      } }),
    });
    // frame hot-reloads; the picked element's line moves, so drop the selection.
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
```

And render the buttons inside the row (before the remove `×`):

```tsx
                    <button type="button" aria-label="Move element up" title="Move up"
                      onClick={(ev) => { ev.stopPropagation(); void move(e, "up"); }}
                      style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>↑</button>
                    <button type="button" aria-label="Move element down" title="Move down"
                      onClick={(ev) => { ev.stopPropagation(); void move(e, "down"); }}
                      style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>↓</button>
```

- [ ] **Step 7: Run server + component suites**

Run: `pnpm run studio:test __tests__/server/codeWriter/reorder.test.ts && pnpm run studio:test __tests__/components`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add studio/server/codeWriter/reorder.ts studio/server/middleware/visualEdit.ts studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/server/codeWriter/reorder.test.ts
git commit -m "feat(studio/canvas): sibling reorder (up/down) via deterministic node move"
```

---

## Task 9: kit-component prop introspection + gray-the-rest

**Files:**
- Create: `studio/server/codeWriter/kitProps.ts`
- Create: `studio/server/middleware/kitProps.ts` (`GET /api/kit-props/:component`)
- Modify: `studio/vite.config.ts` (register), `studio/server/codeWriter/index.ts` (support a `prop` field edit), `studio/src/components/inspector/InspectorPanel.tsx` (kit section: editable prop dropdowns + grayed style controls)
- Test: `studio/__tests__/server/codeWriter/kitProps.test.ts`

**Interfaces:**
- Consumes: the kit `.d.mts` resolution pattern from `server/figma/kitBarrel.ts:34` (`require.resolve("@xorkavi/arcade-gen")` → `path.join(dirname, "index.d.mts")`).
- Produces:
  - `interface KitProp { name: string; values: string[] }` (string-union props only; e.g. `{ name: "variant", values: ["primary","secondary","tertiary"] }`).
  - `kitPropsFor(componentName: string): KitProp[]` — parse the kit `.d.mts` with the TS AST, find the component's props interface/type, return its string-literal-union props. `[]` for unknown components or components with no enumerable props. Cached per component.
  - `isKitComponent(componentName: string): boolean` — true if `componentName` is an uppercase export of the kit barrel.
  - In `codeWriter/index.ts`: extend `FieldEdit` handling so a field named `prop:<propName>` writes/replaces the JSX **attribute** `<propName>="<value>"` on the element (string-literal attr only; bail `dynamic-attr` if the existing attr value is an expression).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/kitProps.test.ts
import { describe, it, expect } from "vitest";
import { parsePropsFromDts } from "../../../server/codeWriter/kitProps";

// parsePropsFromDts is the pure core (no disk) so it's unit-testable.
const DTS = `
export interface ButtonProps {
  variant?: "primary" | "secondary" | "tertiary";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  onClick?: () => void;
}
export declare const Button: React.FC<ButtonProps>;
`;

describe("parsePropsFromDts", () => {
  it("extracts string-union props for a component", () => {
    const props = parsePropsFromDts(DTS, "Button");
    expect(props).toContainEqual({ name: "variant", values: ["primary", "secondary", "tertiary"] });
    expect(props).toContainEqual({ name: "size", values: ["sm", "md", "lg"] });
  });
  it("omits non-union props (boolean, functions)", () => {
    const props = parsePropsFromDts(DTS, "Button");
    expect(props.find((p) => p.name === "disabled")).toBeUndefined();
    expect(props.find((p) => p.name === "onClick")).toBeUndefined();
  });
  it("returns [] for an unknown component", () => {
    expect(parsePropsFromDts(DTS, "Nonexistent")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/kitProps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/codeWriter/kitProps.ts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

export interface KitProp { name: string; values: string[] }

/** Pure: given a .d.ts source, return string-union props of `<Component>Props`. */
export function parsePropsFromDts(dts: string, componentName: string): KitProp[] {
  const sf = ts.createSourceFile("kit.d.ts", dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = `${componentName}Props`;
  const out: KitProp[] = [];
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === wanted) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
        if (!ts.isUnionTypeNode(member.type)) continue;
        const values: string[] = [];
        let allStrings = true;
        for (const t of member.type.types) {
          if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
          else allStrings = false;
        }
        if (allStrings && values.length > 0) out.push({ name: member.name.getText(), values });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

let dtsCache: string | null = null;
function readKitDts(): string {
  if (dtsCache !== null) return dtsCache;
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen");
    const dir = path.dirname(mainEntry);
    for (const f of ["index.d.mts", "index.d.cts", "index.d.ts"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) { dtsCache = fs.readFileSync(p, "utf-8"); return dtsCache; }
    }
  } catch { /* fall through */ }
  dtsCache = "";
  return dtsCache;
}

const propCache = new Map<string, KitProp[]>();
export function kitPropsFor(componentName: string): KitProp[] {
  if (propCache.has(componentName)) return propCache.get(componentName)!;
  const props = parsePropsFromDts(readKitDts(), componentName);
  propCache.set(componentName, props);
  return props;
}

export function isKitComponent(componentName: string): boolean {
  return /^[A-Z]/.test(componentName) && kitPropsFor(componentName).length >= 0
    && readKitDts().includes(componentName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/kitProps.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a prop-attribute patch to the code-writer**

In `studio/server/codeWriter/patchSource.ts`, add a primitive to read/replace a string-literal attribute (sibling of `readClassName`):

```ts
export type ReadAttr =
  | { ok: true; valueStart: number; valueEnd: number }
  | { ok: true; insertAt: number; insertAttr: true }
  | { ok: false; reason: string };

export function readAttr(source: string, hit: JsxHit, attrName: string): ReadAttr {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const opening = openingNodeAt(sf, hit);
  if (!opening) return { ok: false, reason: "opening-not-found" };
  const attr = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === attrName,
  );
  if (!attr) return { ok: true, insertAt: opening.tagName.getEnd(), insertAttr: true };
  const init = attr.initializer;
  if (init && ts.isStringLiteral(init)) {
    return { ok: true, valueStart: init.getStart(sf) + 1, valueEnd: init.getEnd() - 1 };
  }
  return { ok: false, reason: "dynamic-attr" };
}
```

(`openingNodeAt` is already defined in this file from Task 4 — reuse it.)

Then in `studio/server/codeWriter/index.ts`, inside the `for (const f of edit.fields)` loop, handle a `prop:` field BEFORE the className logic:

```ts
    if (f.field.startsWith("prop:")) {
      const propName = f.field.slice("prop:".length);
      const hit = locateJsx(out, edit.line, edit.column);
      if (!hit) return { ok: false, reason: "element-not-found" };
      const a = readAttr(out, hit, propName);
      if (!a.ok) return { ok: false, reason: a.reason };
      if ("insertAttr" in a && a.insertAttr) {
        out = splice(out, a.insertAt, a.insertAt, ` ${propName}="${f.value}"`);
      } else {
        out = splice(out, a.valueStart, a.valueEnd, f.value);
      }
      continue;
    }
```

(Add `readAttr` to the existing import from `./patchSource`.)

- [ ] **Step 6: Add a kit-props endpoint**

```ts
// studio/server/middleware/kitProps.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { kitPropsFor } from "../codeWriter/kitProps";

export function kitPropsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "GET" || !url.startsWith("/api/kit-props/")) return next?.();
    const component = decodeURIComponent(url.slice("/api/kit-props/".length).split("?")[0]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ props: kitPropsFor(component) }));
  };
}
```

Register it in `studio/vite.config.ts` (import + `server.middlewares.use(kitPropsMiddleware());` near the others).

- [ ] **Step 7: Add the kit section to the Inspector UI**

In `InspectorPanel.tsx`, when `focused.selection.componentName` is uppercase (a kit component), fetch its props once and render a "Component" section with a dropdown per `KitProp`; changing one calls `change` with field `prop:<name>` then routes through `commit`/the deterministic POST. Render the existing style sections **disabled** (grayed) for kit components, with the note "part of the <Name> component" and an "Ask AI to customize" button that calls `onSend` with a scoped instruction. Minimal version:

```tsx
  // near other hooks
  const [kitProps, setKitProps] = useState<{ name: string; values: string[] }[]>([]);
  useEffect(() => {
    const name = focused?.selection.componentName;
    if (!name || !/^[A-Z]/.test(name)) { setKitProps([]); return; }
    let cancelled = false;
    fetch(`/api/kit-props/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setKitProps(d.props ?? []); })
      .catch(() => { if (!cancelled) setKitProps([]); });
    return () => { cancelled = true; };
  }, [focused?.selection.componentName]);
```

Render, inside the `focused && styles` block, ahead of the style sections:

```tsx
                {kitProps.length > 0 && (
                  <Section title={`${focused.selection.componentName} component`}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {kitProps.map((p) => (
                        <Field key={p.name} label={p.name}>
                          <select aria-label={p.name} style={INPUT_COMPACT}
                            onChange={(e) => change(("prop:" + p.name) as any, e.target.value)}>
                            <option value="">—</option>
                            {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </Field>
                      ))}
                      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)" }}>
                        Inner styles are part of this component. Use “Ask AI to customize” to change them.
                      </span>
                    </div>
                  </Section>
                )}
```

(When `kitProps.length > 0`, wrap the Layout/Appearance/Typography/Color sections so they render with `opacity: 0.5` and `pointerEvents: "none"`, plus a single "Ask AI to customize" `Button` that calls `onSend(\`In frames/${frameRel}, customize the <${name}> at line ${line} …\`)`. Keep the disabled styling consistent with the existing `SECTION` style.)

> `change()` currently types its `key` param as `keyof StyleSnapshot`. Widen it to `keyof StyleSnapshot | "typeStyle" | "iconSwap" | \`prop:${string}\`` (or accept `string` and cast at the `setField` call), so `prop:variant` type-checks. `prop:` fields skip the `frameWindow.postMessage` preview (no inline preview for prop changes) — guard the preview call to only fire for real style fields.

- [ ] **Step 8: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS (all suites). Fix any inspector component test that now needs the kit-props fetch mocked (stub `global.fetch` to return `{ props: [] }`).

- [ ] **Step 9: Manual smoke test (app restart required)**

Run `pnpm run studio`. Pick a `<Button>` → the "Button component" section shows `variant`/`size` dropdowns; the style sections are grayed with the note. Change `variant` → Commit → disk shows `variant="..."`, no "Thinking…". Click "Ask AI to customize" → "Thinking…" appears (chat path).

- [ ] **Step 10: Commit**

```bash
git add studio/server/codeWriter/kitProps.ts studio/server/middleware/kitProps.ts studio/server/codeWriter/patchSource.ts studio/server/codeWriter/index.ts studio/vite.config.ts studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/server/codeWriter/kitProps.test.ts
git commit -m "feat(studio/canvas): kit-component prop editing + gray internal styles"
```

---

## Final verification

- [ ] **Run the entire studio suite:** `pnpm run studio:test` — Expected: all PASS.
- [ ] **Confirm both edit paths on a real frame** (deterministic + AI fallback) per the Task 7 & 9 smoke tests.
- [ ] **Confirm the file is never left broken:** intentionally pick an element with a `cn()` className, edit, Commit → frame still renders (chat fallback ran), disk file unchanged until Claude edits it.

## Notes on deferred scope (Phase B — separate spec/plan)

- On-canvas drag handles, selection box, freeform manipulation, inline-caret text editing — all reuse this plan's code-writer; B maps canvas-space gestures onto the same `writeBatch`/`moveSibling` calls.
- Dedicated undo: the seam is `server/frameChangeContract.ts` (`snapshotProjectFiles`/`diffSnapshots`); today there is no undo and direct edits inherit that. Out of scope here.
