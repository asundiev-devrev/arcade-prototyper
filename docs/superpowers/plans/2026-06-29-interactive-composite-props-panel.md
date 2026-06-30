# Interactive-Composite Props Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the scalar props (text/toggle/number/select) of a resolved in-frame composite (e.g. ComputerScene) in the edit panel by parsing prototype-kit `.tsx` source, so interactive prototypes get a live editable panel without flattening.

**Architecture:** A new pure TS-AST reader parses a composite's `<Name>Props` type + the component's destructuring defaults into rich prop descriptors. `kitPropsFor` gains a resolver chain (arcade-gen `.d.mts` first, prototype-kit source fallback). The write path adds a `propExpr:` variant (+ a full-initializer reader) for boolean/number props. A small instance-attr read lets the panel prefill the current on-disk value. The panel renders one widget per `kind`, prefilled, with an honesty note.

**Tech Stack:** TypeScript compiler API (NOT Babel), Vite middleware, React (InspectorPanel), Vitest.

## Global Constraints

- **TypeScript compiler API for all parsing — never Babel/regex on code.**
- **pnpm only.** Tests: `pnpm run studio:test <path>`. Full suite: `pnpm run studio:test`.
- **Conventional Commits**, scope `studio/canvas` for server/codeWriter, `studio/inspector` for the panel.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Reparse-guard every write** — never persist unparseable TSX (the existing `reparses()` in `index.ts` already gates the batch; new write variants ride it).
- **Closed-world reads** — composite source only from `studio/prototype-kit/{composites,templates}/<Name>.tsx`, `Name` matched `^[A-Z][A-Za-z0-9]*$`. No path traversal.
- **Scalar-only honesty rule** — a prop is an editable field ONLY if scalar (string / boolean / number / all-string-literal union). A `React.ReactNode` (or `string | ReactNode`) prop is a text field ONLY when its destructuring default is a string literal; otherwise SKIPPED. id-like string props (`name === "id" || /Id$/.test(name)`) are SKIPPED. Arrays/objects/functions/JSX/mixed-unions SKIPPED.
- **Degrade, never crash** — any parse/read failure → `[]` props → "No editable properties — use Ask AI." A bad write → reparse-guard aborts, file untouched.
- **Do NOT cache prototype-kit parses by name** (source is live-edited in dev, no hot-reload) — parse per request, or key a cache on file mtime. arcade-gen's `.d.mts` cache is unchanged (shipped/immutable).

---

### Task 1: Pure composite-props parser

**Files:**
- Create: `studio/server/codeWriter/compositeProps.ts`
- Test: `studio/__tests__/server/codeWriter/compositeProps.test.ts`

**Interfaces:**
- Consumes: `typescript`.
- Produces:
  - `export interface KitProp2 { name: string; kind: "text" | "toggle" | "number" | "select"; values?: string[]; default?: string }`
  - `export function parseCompositeProps(source: string, componentName: string): KitProp2[]` — pure. Parses `<componentName>Props` (both `type X = {…}` and `interface X {…}`) + the component function's destructuring defaults; returns scalar prop descriptors per the scalar-only + ReactNode-string-default + id-exclusion rules.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/compositeProps.test.ts
import { describe, it, expect } from "vitest";
import { parseCompositeProps } from "../../../server/codeWriter/compositeProps";

// Mirrors ComputerScene's real shape (ReactNode text-slots, a union, a boolean,
// plain strings, an id prop, an array, a function).
const SRC = `
import * as React from "react";
type Session = { id: string };
export type ComputerSceneProps = {
  state?: "empty" | "streaming" | "transcript";
  withCanvasPanel?: boolean;
  headerTitle?: React.ReactNode;
  userName?: React.ReactNode;
  userSubtitle?: React.ReactNode;
  userAvatarSrc?: string;
  activeSessionId?: string;
  sessions?: Session[];
  chatInputPlaceholder?: string;
  onOpenSettings?: () => void;
};
export function ComputerScene({
  state = "transcript",
  withCanvasPanel,
  headerTitle,
  userName = "Ava Wright",
  userSubtitle = "DevRev",
  userAvatarSrc,
  activeSessionId: activeSessionIdProp = "strategic",
  sessions = [],
  chatInputPlaceholder = "Ask me anything",
  onOpenSettings,
}: ComputerSceneProps = {}) {
  return null;
}
`;

describe("parseCompositeProps", () => {
  const props = parseCompositeProps(SRC, "ComputerScene");
  const by = (n: string) => props.find((p) => p.name === n);

  it("string-literal union → select with values + default", () => {
    expect(by("state")).toEqual({ name: "state", kind: "select", values: ["empty", "streaming", "transcript"], default: "transcript" });
  });
  it("boolean → toggle", () => {
    expect(by("withCanvasPanel")).toEqual({ name: "withCanvasPanel", kind: "toggle" });
  });
  it("plain string → text (with default when present)", () => {
    expect(by("chatInputPlaceholder")).toEqual({ name: "chatInputPlaceholder", kind: "text", default: "Ask me anything" });
    expect(by("userAvatarSrc")).toEqual({ name: "userAvatarSrc", kind: "text" });
  });
  it("ReactNode WITH string-literal default → text", () => {
    expect(by("userName")).toEqual({ name: "userName", kind: "text", default: "Ava Wright" });
    expect(by("userSubtitle")).toEqual({ name: "userSubtitle", kind: "text", default: "DevRev" });
  });
  it("ReactNode WITHOUT a string default → skipped", () => {
    expect(by("headerTitle")).toBeUndefined();
  });
  it("id-like string prop → skipped", () => {
    expect(by("activeSessionId")).toBeUndefined();
  });
  it("array + function props → skipped", () => {
    expect(by("sessions")).toBeUndefined();
    expect(by("onOpenSettings")).toBeUndefined();
  });
});

describe("parseCompositeProps — other shapes", () => {
  it("handles `interface XProps {…}` the same as a type alias", () => {
    const src = `interface FooProps { label?: string; big?: boolean; }
export function Foo({ label = "Hi", big }: FooProps) { return null; }`;
    const props = parseCompositeProps(src, "Foo");
    expect(props).toContainEqual({ name: "label", kind: "text", default: "Hi" });
    expect(props).toContainEqual({ name: "big", kind: "toggle" });
  });
  it("number → number; mixed non-literal union → skipped", () => {
    const src = `type BarProps = { count?: number; weird?: string | number };
export function Bar({ count = 3 }: BarProps) { return null; }`;
    const props = parseCompositeProps(src, "Bar");
    expect(props).toContainEqual({ name: "count", kind: "number", default: "3" });
    expect(props.find((p) => p.name === "weird")).toBeUndefined();
  });
  it("ReactNode with a JSX default → skipped (default is not a string literal)", () => {
    const src = `import * as React from "react";
type BazProps = { node?: React.ReactNode };
export function Baz({ node = <span/> }: BazProps) { return null; }`;
    expect(parseCompositeProps(src, "Baz").find((p) => p.name === "node")).toBeUndefined();
  });
  it("returns [] when the Props type is absent", () => {
    expect(parseCompositeProps(`export function X(){return null;}`, "X")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/codeWriter/compositeProps.test.ts`
Expected: FAIL — `parseCompositeProps` not exported (module not found).

- [ ] **Step 3: Implement `compositeProps.ts`**

```ts
// studio/server/codeWriter/compositeProps.ts
import ts from "typescript";

export interface KitProp2 {
  name: string;
  kind: "text" | "toggle" | "number" | "select";
  values?: string[];
  default?: string;
}

/** id-like prop names whose value must match an existing item — unsafe as free text. */
function isIdLike(name: string): boolean {
  return name === "id" || /Id$/.test(name);
}

/** A union node whose every member is a string literal → its literal values. Else null. */
function stringUnionValues(typeNode: ts.TypeNode): string[] | null {
  if (!ts.isUnionTypeNode(typeNode)) return null;
  const values: string[] = [];
  for (const t of typeNode.types) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
    else return null;
  }
  return values.length > 0 ? values : null;
}

function typeText(node: ts.TypeNode): string {
  return node.getText();
}

function isReactNode(node: ts.TypeNode): boolean {
  const t = typeText(node).trim();
  return t === "React.ReactNode" || t === "ReactNode";
}

/** A union of only `string` keyword and/or ReactNode (a text-slot the kit widened). */
function isStringOrReactNodeUnion(node: ts.TypeNode): boolean {
  if (!ts.isUnionTypeNode(node)) return false;
  return node.types.every(
    (t) => t.kind === ts.SyntaxKind.StringKeyword || isReactNode(t),
  );
}

/** Find the `<componentName>Props` member list (type alias OR interface). */
function findPropsMembers(sf: ts.SourceFile, componentName: string): ts.NodeArray<ts.TypeElement> | null {
  const wanted = `${componentName}Props`;
  let members: ts.NodeArray<ts.TypeElement> | null = null;
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === wanted) members = node.members;
    else if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === wanted &&
      ts.isTypeLiteralNode(node.type)
    ) members = node.type.members;
    if (!members) ts.forEachChild(node, visit);
  }
  visit(sf);
  return members;
}

/** Map prop name → its destructuring default literal text (string/number/bool), when literal. */
function readDestructuringDefaults(sf: ts.SourceFile, componentName: string): Map<string, { value: string; isString: boolean }> {
  const out = new Map<string, { value: string; isString: boolean }>();
  let params: ts.NodeArray<ts.ParameterDeclaration> | null = null;
  function visit(node: ts.Node) {
    if (params) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) params = node.parameters;
    else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === componentName && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          params = d.initializer.parameters;
        }
      }
    }
    if (!params) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!params || params.length === 0) return out;
  const first = params[0];
  if (!ts.isObjectBindingPattern(first.name)) return out;
  for (const el of first.name.elements) {
    // propertyName is the source prop name when aliased (`activeSessionId: x = …`).
    const propName = (el.propertyName ?? el.name).getText();
    const init = el.initializer;
    if (!init) continue;
    if (ts.isStringLiteral(init)) out.set(propName, { value: init.text, isString: true });
    else if (ts.isNumericLiteral(init)) out.set(propName, { value: init.text, isString: false });
    else if (init.kind === ts.SyntaxKind.TrueKeyword) out.set(propName, { value: "true", isString: false });
    else if (init.kind === ts.SyntaxKind.FalseKeyword) out.set(propName, { value: "false", isString: false });
  }
  return out;
}

/**
 * Pure: parse a composite's `<Name>Props` + the component's destructuring defaults
 * into editable scalar prop descriptors. See the Global Constraints scalar-only rule.
 */
export function parseCompositeProps(source: string, componentName: string): KitProp2[] {
  const sf = ts.createSourceFile("kit.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const members = findPropsMembers(sf, componentName);
  if (!members) return [];
  const defaults = readDestructuringDefaults(sf, componentName);
  const out: KitProp2[] = [];

  for (const m of members) {
    try {
      if (!ts.isPropertySignature(m) || !m.name || !m.type) continue;
      const name = m.name.getText();
      const def = defaults.get(name);
      const t = m.type;

      // string-literal union → select
      const union = stringUnionValues(t);
      if (union) {
        out.push({ name, kind: "select", values: union, ...(def?.isString ? { default: def.value } : {}) });
        continue;
      }
      // boolean
      if (t.kind === ts.SyntaxKind.BooleanKeyword) { out.push({ name, kind: "toggle" }); continue; }
      // number
      if (t.kind === ts.SyntaxKind.NumberKeyword) {
        out.push({ name, kind: "number", ...(def && !def.isString ? { default: def.value } : {}) });
        continue;
      }
      // plain string
      if (t.kind === ts.SyntaxKind.StringKeyword) {
        if (isIdLike(name)) continue; // unsafe as free text
        out.push({ name, kind: "text", ...(def?.isString ? { default: def.value } : {}) });
        continue;
      }
      // ReactNode (or string|ReactNode union) → text ONLY with a string-literal default
      if (isReactNode(t) || isStringOrReactNodeUnion(t)) {
        if (def?.isString) out.push({ name, kind: "text", default: def.value });
        continue; // no string default → skip
      }
      // everything else (arrays, objects, functions, JSX, mixed unions) → skip
    } catch { /* per-prop: skip a weird member, keep the rest */ }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/compositeProps.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/compositeProps.ts studio/__tests__/server/codeWriter/compositeProps.test.ts
git commit -m "feat(studio/canvas): pure parser for editable scalar props of a composite"
```

---

### Task 2: Resolver chain — kitPropsFor returns KitProp2, falls back to composite source

**Files:**
- Modify: `studio/server/codeWriter/kitProps.ts`
- Modify: `studio/__tests__/server/codeWriter/kitProps.test.ts` (update to the new shape)
- Test: `studio/__tests__/server/codeWriter/compositePropsFor.test.ts` (new — the disk path)

**Interfaces:**
- Consumes: `parseCompositeProps` + `KitProp2` (Task 1).
- Produces:
  - `export function compositePropsFor(componentName: string): KitProp2[]` — resolve `prototype-kit/composites/<Name>.tsx` then `templates/<Name>.tsx` (closed-world), read + `parseCompositeProps`; `[]` on miss. NOT cached by name (mtime-keyed or uncached).
  - `kitPropsFor(componentName: string): KitProp2[]` — CHANGED return type. arcade-gen `.d.mts` string-unions mapped to `{ name, kind: "select", values }`; if arcade-gen returns nothing, fall back to `compositePropsFor`.

- [ ] **Step 1: Write the failing test (composite disk path)**

```ts
// studio/__tests__/server/codeWriter/compositePropsFor.test.ts
import { describe, it, expect } from "vitest";
import { compositePropsFor } from "../../../server/codeWriter/kitProps";

describe("compositePropsFor (reads real prototype-kit source)", () => {
  it("surfaces ComputerScene's scalar props from composites/ComputerScene.tsx", () => {
    const props = compositePropsFor("ComputerScene");
    const by = (n: string) => props.find((p) => p.name === n);
    expect(by("state")).toMatchObject({ kind: "select", values: ["empty", "streaming", "transcript"] });
    expect(by("withCanvasPanel")).toMatchObject({ kind: "toggle" });
    expect(by("userName")).toMatchObject({ kind: "text", default: "Ava Wright" });
    expect(by("chatInputPlaceholder")).toMatchObject({ kind: "text", default: "Ask me anything" });
    // skipped surfaces
    expect(by("headerTitle")).toBeUndefined();
    expect(by("activeSessionId")).toBeUndefined();
    expect(by("sessions")).toBeUndefined();
  });
  it("returns [] for an unknown / non-composite name", () => {
    expect(compositePropsFor("NotARealComposite")).toEqual([]);
  });
  it("rejects a non-conforming name (closed-world)", () => {
    expect(compositePropsFor("../../etc/passwd")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`compositePropsFor` not exported).

Run: `pnpm run studio:test __tests__/server/codeWriter/compositePropsFor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `kitProps.ts`** — adapt the arcade-gen reader to `KitProp2`, add `compositePropsFor`, chain them. Replace the file's exported parts as follows (keep `parsePropsFromDts` + `readKitDts` internals; change what they feed):

```ts
// studio/server/codeWriter/kitProps.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { parseCompositeProps, type KitProp2 } from "./compositeProps";

// --- arcade-gen .d.mts reader (UNCHANGED internals; now mapped to KitProp2) ---
export interface KitPropUnion { name: string; values: string[] }

/** Pure: given a .d.ts source, return string-union props of `<Component>Props`. */
export function parsePropsFromDts(dts: string, componentName: string): KitPropUnion[] {
  const sf = ts.createSourceFile("kit.d.ts", dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = `${componentName}Props`;
  const out: KitPropUnion[] = [];
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

// --- prototype-kit composite source reader (NEW) ---
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// kitProps.ts is at studio/server/codeWriter/ → prototype-kit is ../../prototype-kit
const KIT_ROOT = path.resolve(MODULE_DIR, "..", "..", "prototype-kit");
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** Read a composite's editable scalar props from its .tsx source. [] on any miss.
 *  NOT cached by name — composite source is live-edited in dev (no hot-reload). */
export function compositePropsFor(componentName: string): KitProp2[] {
  if (!NAME_RE.test(componentName)) return [];
  for (const sub of ["composites", "templates"]) {
    const file = path.join(KIT_ROOT, sub, `${componentName}.tsx`);
    try {
      const src = fs.readFileSync(file, "utf-8");
      return parseCompositeProps(src, componentName);
    } catch { /* try next dir */ }
  }
  return [];
}

const unionCache = new Map<string, KitProp2[]>();

/** Editable props for a component: arcade-gen string-unions first (cached, shipped),
 *  else the prototype-kit composite source reader. Returns KitProp2[]. */
export function kitPropsFor(componentName: string): KitProp2[] {
  if (unionCache.has(componentName)) {
    const cached = unionCache.get(componentName)!;
    if (cached.length > 0) return cached;
  }
  const unions = parsePropsFromDts(readKitDts(), componentName);
  if (unions.length > 0) {
    const mapped: KitProp2[] = unions.map((u) => ({ name: u.name, kind: "select", values: u.values }));
    unionCache.set(componentName, mapped);
    return mapped;
  }
  // Not an arcade-gen union component → try prototype-kit source (uncached).
  return compositePropsFor(componentName);
}

export function isKitComponent(componentName: string): boolean {
  return /^[A-Z]/.test(componentName) && kitPropsFor(componentName).length > 0;
}
```

- [ ] **Step 4: Update the existing arcade-gen test to the new shape**

In `studio/__tests__/server/codeWriter/kitProps.test.ts`, `parsePropsFromDts` still returns `{name, values}` (unchanged) — those assertions stay. But ADD a check that `kitPropsFor` now shapes unions as `kind:"select"`:

```ts
import { parsePropsFromDts, kitPropsFor, isKitComponent } from "../../../server/codeWriter/kitProps";
// … existing parsePropsFromDts tests UNCHANGED …

describe("kitPropsFor shape", () => {
  it("shapes arcade-gen string-unions as kind:select with values", () => {
    const props = kitPropsFor("Button");
    // Button may or may not have unions in the installed kit; if present, they're selects.
    for (const p of props) {
      expect(p.kind).toBe("select");
      expect(Array.isArray(p.values)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Grep callers of `kitPropsFor` for shape breakage**

Run: `grep -rn "kitPropsFor\|\.values\b" studio/server studio/src | grep -i kitprop`
Expected: only `kitProps.ts`, the `/api/kit-props` middleware (passes through), and `isKitComponent`. The panel consumes the endpoint JSON (updated in Task 5), not `kitPropsFor` directly. If any OTHER caller reads `.values` assuming it's always present, note it for Task 5. (Expected: none.)

- [ ] **Step 6: Run tests**

Run: `pnpm run studio:test __tests__/server/codeWriter/compositePropsFor.test.ts __tests__/server/codeWriter/kitProps.test.ts`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add studio/server/codeWriter/kitProps.ts studio/__tests__/server/codeWriter/kitProps.test.ts studio/__tests__/server/codeWriter/compositePropsFor.test.ts
git commit -m "feat(studio/canvas): kitPropsFor resolves composite source, returns KitProp2"
```

---

### Task 3: Write path — full-initializer reader + propExpr variant

**Files:**
- Modify: `studio/server/codeWriter/patchSource.ts` (add `readAttrInitializer`)
- Modify: `studio/server/codeWriter/index.ts` (add `propExpr:` branch)
- Test: `studio/__tests__/server/codeWriter/propExpr.test.ts`

**Interfaces:**
- Consumes: `locateJsx`, `splice` (existing).
- Produces:
  - `patchSource.ts`: `export type ReadAttrInit = { ok: true; valueStart: number; valueEnd: number; insertAttr?: false } | { ok: true; insertAt: number; insertAttr: true } | { ok: false; reason: string }` and `export function readAttrInitializer(source: string, hit: JsxHit, attrName: string): ReadAttrInit` — returns the FULL initializer span (the `"…"` literal OR the entire `{…}` JsxExpression), or an `insertAt` when the attr is absent. Does NOT bail on expression initializers.
  - `index.ts`: a `propExpr:<name>` field branch — insert ` name={value}`; replace the full initializer span with `{value}`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/propExpr.test.ts
import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

// <C ... /> on line 2, col 3 (the tag-name position locateJsx keys on).
function frame(attrs: string) {
  return `export default function F() {\n  <C${attrs} />;\n}\n`;
}
const at = (field: string, value: string) =>
  ({ file: "frames/x/index.tsx", line: 2, column: 3, fields: [{ field, value }] });

describe("propExpr write", () => {
  it("inserts an expression attr on a self-closing element", () => {
    const r = applyEditsToSource(frame(""), at("propExpr:withCanvasPanel", "true"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain("withCanvasPanel={true}");
  });
  it("replaces an existing expression attr", () => {
    const r = applyEditsToSource(frame(" count={2}"), at("propExpr:count", "5"));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain("count={5}"); expect(r.source).not.toContain("count={2}"); }
  });
  it("replaces an existing STRING attr with an expression (string→number prop)", () => {
    const r = applyEditsToSource(frame(` n="2"`), at("propExpr:n", "5"));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain("n={5}"); expect(r.source).not.toContain(`n="2"`); }
  });
  it("string prop: still writes a quoted attr (existing prop: path unchanged)", () => {
    const r = applyEditsToSource(frame(""), at("prop:userName", "Ada"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`userName="Ada"`);
  });
  it("reparse-guard aborts a malformed expression (file untouched)", () => {
    const r = applyEditsToSource(frame(""), at("propExpr:x", "{[}"));
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`propExpr:` unhandled → falls to class path → `unmappable-field`, so `count={5}` assertions fail).

Run: `pnpm run studio:test __tests__/server/codeWriter/propExpr.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `readAttrInitializer` to `patchSource.ts`** (append after `readAttr`; do NOT change `readAttr`):

```ts
export type ReadAttrInit =
  | { ok: true; valueStart: number; valueEnd: number; insertAttr?: false }
  | { ok: true; insertAt: number; insertAttr: true }
  | { ok: false; reason: string };

/** Like readAttr, but returns the FULL initializer span (string literal `"x"` OR
 *  the entire JsxExpression `{x}`) so a caller can overwrite it wholesale with a
 *  new expression. Does NOT bail on expression initializers. */
export function readAttrInitializer(source: string, hit: JsxHit, attrName: string): ReadAttrInit {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const opening = openingNodeAt(sf, hit);
  if (!opening) return { ok: false, reason: "opening-not-found" };
  const attr = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === attrName,
  );
  if (!attr) return { ok: true, insertAt: opening.tagName.getEnd(), insertAttr: true };
  const init = attr.initializer;
  if (!init) {
    // bare boolean attr `foo` (no initializer) → overwrite from the attr name's end
    return { ok: true, valueStart: attr.getEnd(), valueEnd: attr.getEnd() };
  }
  // String literal OR JsxExpression: overwrite the WHOLE initializer span.
  return { ok: true, valueStart: init.getStart(sf), valueEnd: init.getEnd() };
}
```

- [ ] **Step 4: Add the `propExpr:` branch to `index.ts`** — import `readAttrInitializer` and handle the field BEFORE the class path (mirror the `prop:` block). Update the import line and add the branch:

```ts
// at top: extend the existing import
import { readClassName, readTextChild, readAttr, readAttrInitializer, splice } from "./patchSource";
```

```ts
// inside applyEditsToSource's `for (const f of edit.fields)`, right AFTER the
// existing `if (f.field.startsWith("prop:")) { … continue; }` block:
    if (f.field.startsWith("propExpr:")) {
      const propName = f.field.slice("propExpr:".length);
      const hit = locateJsx(out, edit.line, edit.column);
      if (!hit) return { ok: false, reason: "element-not-found" };
      const a = readAttrInitializer(out, hit, propName);
      if (!a.ok) return { ok: false, reason: a.reason };
      if ("insertAttr" in a && a.insertAttr) {
        out = splice(out, a.insertAt, a.insertAt, ` ${propName}={${f.value}}`);
      } else {
        // Overwrite the full initializer; for a bare-boolean attr (valueStart==valueEnd
        // == attr end) this appends `={value}` turning `foo` into `foo={value}`.
        out = splice(out, a.valueStart, a.valueEnd, `={${f.value}}`);
      }
      continue;
    }
```

> NOTE on the replace form: `readAttrInitializer` returns the span of the initializer INCLUDING any leading `=`? No — `init.getStart` is at the `"` or `{`, AFTER the `=`. So for a replace we must overwrite from the `=`. Simpler + uniform: always overwrite `[valueStart, valueEnd]` with `={value}` and have `valueStart` point at the `=`. Adjust `readAttrInitializer`: when `init` exists, set `valueStart` to the position of the `=` (i.e. `attr.name.getEnd()`), `valueEnd = init.getEnd()`, and the splice replacement is `={value}`. For the bare-boolean case `valueStart = valueEnd = attr.getEnd()` and replacement `={value}` appends `={value}`. Implement it that way (one uniform replacement string `={value}`):

```ts
// FINAL readAttrInitializer initializer branch (replaces the two lines above):
  if (!init) {
    return { ok: true, valueStart: attr.getEnd(), valueEnd: attr.getEnd() };
  }
  return { ok: true, valueStart: attr.name.getEnd(), valueEnd: init.getEnd() };
```

```ts
// FINAL propExpr replace splice (uniform — covers insert via insertAttr, and both
// existing-string and existing-expression via the initializer span):
      if ("insertAttr" in a && a.insertAttr) {
        out = splice(out, a.insertAt, a.insertAt, ` ${propName}={${f.value}}`);
      } else {
        out = splice(out, a.valueStart, a.valueEnd, `={${f.value}}`);
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/codeWriter/propExpr.test.ts`
Expected: PASS (5 cases). The reparse-guard case relies on the existing `reparses(out)` at the end of `applyEditsToSource` returning `{ok:false, reason:"reparse-failed"}` for `x={{[}}`.

- [ ] **Step 6: Run the existing codeWriter suite (no regression on the `prop:`/class paths)**

Run: `pnpm run studio:test __tests__/server/codeWriter`
Expected: PASS (existing visual-edit/prop tests + the new ones).

- [ ] **Step 7: Commit**

```bash
git add studio/server/codeWriter/patchSource.ts studio/server/codeWriter/index.ts studio/__tests__/server/codeWriter/propExpr.test.ts
git commit -m "feat(studio/canvas): propExpr write variant + full-initializer reader for expression props"
```

---

### Task 4: Instance-attr read — current on-disk prop values for prefill

**Files:**
- Create: `studio/server/codeWriter/instanceAttrs.ts`
- Create: `studio/server/middleware/instanceProps.ts`
- Modify: `studio/vite.config.ts` (register the middleware)
- Test: `studio/__tests__/server/codeWriter/instanceAttrs.test.ts`

**Interfaces:**
- Consumes: `locateJsx`, `typescript`.
- Produces:
  - `instanceAttrs.ts`: `export function readInstanceAttrs(source: string, line: number, column: number): Record<string, string>` — locate the JSX element at (line,col), return a map of its set attributes → a display string (string literal → its text; `{expr}` → the expression's source text; bare boolean → `"true"`). `{}` on miss.
  - `instanceProps.ts`: middleware `GET /api/instance-props/:slug?frame=<frameSlug>&line=<n>&col=<n>` → `{ attrs: Record<string,string> }`. Reads `frameDir(slug, frameSlug)/index.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/instanceAttrs.test.ts
import { describe, it, expect } from "vitest";
import { readInstanceAttrs } from "../../../server/codeWriter/instanceAttrs";

const SRC = `export default function F() {\n  return <ComputerScene userName="Ada" withCanvasPanel={true} count={3} bare />;\n}\n`;

describe("readInstanceAttrs", () => {
  it("returns set attrs as display strings", () => {
    const a = readInstanceAttrs(SRC, 2, 11); // tag-name col of <ComputerScene
    expect(a.userName).toBe("Ada");
    expect(a.withCanvasPanel).toBe("true");
    expect(a.count).toBe("3");
    expect(a.bare).toBe("true");
  });
  it("returns {} when nothing matches", () => {
    expect(readInstanceAttrs(SRC, 99, 1)).toEqual({});
  });
});
```

(Note: the tag-name column for `<ComputerScene` in the fixture is the position of `C` in `ComputerScene` — `  return <` is 10 chars, so col 11. If the test's located element is wrong, adjust the column to the tag-name start; `locateJsx` keys on the tag-name position. Verify by the assertions.)

- [ ] **Step 2: Run it — FAIL** (module not found).

Run: `pnpm run studio:test __tests__/server/codeWriter/instanceAttrs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `instanceAttrs.ts`**

```ts
// studio/server/codeWriter/instanceAttrs.ts
import ts from "typescript";
import { locateJsx } from "./locateJsx";

/** Current set attributes of the JSX element at (line,col), as display strings:
 *  string literal → its text; `{expr}` → the expression source; bare attr → "true".
 *  Pure; {} on miss. Used to prefill the props panel with what's actually in source. */
export function readInstanceAttrs(source: string, line: number, column: number): Record<string, string> {
  const hit = locateJsx(source, line, column);
  if (!hit) return {};
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.getStart(sf) === hit!.openingStart) opening = node;
    if (!opening) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!opening) return {};
  const out: Record<string, string> = {};
  for (const p of (opening as ts.JsxOpeningElement | ts.JsxSelfClosingElement).attributes.properties) {
    if (!ts.isJsxAttribute(p) || !p.name) continue;
    const name = p.name.getText();
    const init = p.initializer;
    if (!init) { out[name] = "true"; continue; } // bare boolean attr
    if (ts.isStringLiteral(init)) { out[name] = init.text; continue; }
    if (ts.isJsxExpression(init) && init.expression) { out[name] = init.expression.getText(sf); continue; }
  }
  return out;
}
```

- [ ] **Step 4: Run the test — PASS.**

Run: `pnpm run studio:test __tests__/server/codeWriter/instanceAttrs.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the middleware** `studio/server/middleware/instanceProps.ts` (mirror `kitProps.ts` middleware shape):

```ts
// studio/server/middleware/instanceProps.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { readInstanceAttrs } from "../codeWriter/instanceAttrs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function instancePropsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const raw = req.url ?? "";
    if (req.method !== "GET" || !raw.startsWith("/api/instance-props/")) return next?.();
    try {
      const u = new URL(raw, "http://localhost");
      const slug = decodeURIComponent(u.pathname.slice("/api/instance-props/".length));
      const frame = u.searchParams.get("frame") ?? "";
      const line = Number(u.searchParams.get("line"));
      const col = Number(u.searchParams.get("col"));
      if (!SLUG_RE.test(slug) || !SLUG_RE.test(frame) || !Number.isFinite(line) || !Number.isFinite(col)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ attrs: {} }));
      }
      const file = path.join(frameDir(slug, frame), "index.tsx");
      const src = await fs.readFile(file, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ attrs: readInstanceAttrs(src, line, col) }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ attrs: {} }));
    }
  };
}
```

- [ ] **Step 6: Register the middleware in `vite.config.ts`** — mirror the kit-props registration. Add the import near the other middleware imports:

```ts
import { instancePropsMiddleware } from "./server/middleware/instanceProps";
```

and the `.use(...)` next to `kitPropsMiddleware()`:

```ts
      server.middlewares.use(kitPropsMiddleware());
      server.middlewares.use(instancePropsMiddleware());
```

- [ ] **Step 7: Run the codeWriter suite + confirm vite.config still loads**

Run: `pnpm run studio:test __tests__/server/codeWriter`
Then: `node -e 'require("vite").loadConfigFromFile({command:"serve",mode:"development"},"studio/vite.config.ts").then(()=>console.log("CONFIG OK")).catch(e=>{console.error(e.message);process.exit(1)})'`
Expected: tests PASS; prints `CONFIG OK` (the new middleware import doesn't break config load — it has no kit-barrel dependency).

- [ ] **Step 8: Commit**

```bash
git add studio/server/codeWriter/instanceAttrs.ts studio/server/middleware/instanceProps.ts studio/vite.config.ts studio/__tests__/server/codeWriter/instanceAttrs.test.ts
git commit -m "feat(studio/canvas): read an instance's current attrs for panel prefill"
```

---

### Task 5: Panel — per-kind widgets, prefill, propExpr routing, honesty note

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/inspector-props-panel.test.tsx` (new)

**Interfaces:**
- Consumes: `KitProp2` shape from `/api/kit-props/<Name>` (Task 2), `/api/instance-props/:slug` (Task 4), existing `changeProp`/`askAi`/`Field`/`SegmentedToggle`/`INPUT_COMPACT`.
- Produces: the rewritten component-mode panel section.

- [ ] **Step 1: Write the failing test** (render-level; mocks the kit so it mounts)

```tsx
// studio/__tests__/components/inspector-props-panel.test.tsx
import { describe, it, expect } from "vitest";
import { renderPropField } from "../../src/components/inspector/propField";

// renderPropField is a pure helper extracted from the panel: given a KitProp2 + a
// current value + an onChange, it returns the field descriptor the panel renders.
describe("renderPropField (widget + write-prefix selection)", () => {
  it("text prop → text kind, prop: prefix", () => {
    const d = renderPropField({ name: "userName", kind: "text", default: "Ava Wright" }, undefined);
    expect(d.widget).toBe("text");
    expect(d.writePrefix).toBe("prop:");
    expect(d.value).toBe("Ava Wright"); // default when no current value
  });
  it("current value wins over default", () => {
    const d = renderPropField({ name: "userName", kind: "text", default: "Ava Wright" }, "Ada");
    expect(d.value).toBe("Ada");
  });
  it("select prop → select kind with values, prop: prefix", () => {
    const d = renderPropField({ name: "state", kind: "select", values: ["empty", "streaming", "transcript"], default: "transcript" }, undefined);
    expect(d.widget).toBe("select");
    expect(d.writePrefix).toBe("prop:");
    expect(d.values).toEqual(["empty", "streaming", "transcript"]);
    expect(d.value).toBe("transcript");
  });
  it("toggle prop → toggle kind, propExpr: prefix", () => {
    const d = renderPropField({ name: "withCanvasPanel", kind: "toggle" }, undefined);
    expect(d.widget).toBe("toggle");
    expect(d.writePrefix).toBe("propExpr:");
  });
  it("number prop → number kind, propExpr: prefix", () => {
    const d = renderPropField({ name: "count", kind: "number", default: "3" }, undefined);
    expect(d.widget).toBe("number");
    expect(d.writePrefix).toBe("propExpr:");
    expect(d.value).toBe("3");
  });
});
```

- [ ] **Step 2: Run it — FAIL** (module not found).

Run: `pnpm run studio:test __tests__/components/inspector-props-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Extract the pure `renderPropField` helper** `studio/src/components/inspector/propField.ts`:

```ts
// studio/src/components/inspector/propField.ts
import type { KitProp2 } from "../../../server/codeWriter/compositeProps";

export interface PropFieldDescriptor {
  name: string;
  widget: "text" | "toggle" | "number" | "select";
  writePrefix: "prop:" | "propExpr:";
  value: string;          // resolved prefill: current > default > ""
  values?: string[];      // for select
}

/** Pure: resolve how a prop renders + which write path it uses + its prefill value.
 *  `current` = the value already set on the instance (from /api/instance-props), or
 *  undefined. Prefill precedence: current > default > "". */
export function renderPropField(prop: KitProp2, current: string | undefined): PropFieldDescriptor {
  const writePrefix = prop.kind === "toggle" || prop.kind === "number" ? "propExpr:" : "prop:";
  const value = current ?? prop.default ?? "";
  return {
    name: prop.name,
    widget: prop.kind,
    writePrefix,
    value,
    ...(prop.values ? { values: prop.values } : {}),
  };
}
```

(Importing the server-side `KitProp2` type into client code is type-only — fine under Vite/TS. If the import path trips the build, copy the `KitProp2` interface into `propField.ts` instead and note it; the runtime never crosses.)

- [ ] **Step 4: Run the helper test — PASS.**

Run: `pnpm run studio:test __tests__/components/inspector-props-panel.test.tsx`
Expected: PASS (5 cases).

- [ ] **Step 5: Wire the panel to the new shape.** In `InspectorPanel.tsx`:

(a) Change the kitProps state type (line ~139):
```ts
import type { KitProp2 } from "../../../server/codeWriter/compositeProps";
import { renderPropField } from "./propField";
// …
const [kitProps, setKitProps] = useState<KitProp2[]>([]);
const [instanceAttrs, setInstanceAttrs] = useState<Record<string, string>>({});
```

(b) After the existing kit-props fetch effect (line ~176-185), add an instance-attrs fetch keyed on the resolved component's file/line/col:
```ts
  useEffect(() => {
    if (!inFrameComp || !frameSlug) { setInstanceAttrs({}); return; }
    let cancelled = false;
    const q = `frame=${encodeURIComponent(frameSlug)}&line=${inFrameComp.line}&col=${inFrameComp.column}`;
    fetch(`/api/instance-props/${encodeURIComponent(slug)}?${q}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setInstanceAttrs(d.attrs ?? {}); })
      .catch(() => { if (!cancelled) setInstanceAttrs({}); });
    return () => { cancelled = true; };
  }, [inFrameComp?.file, inFrameComp?.line, inFrameComp?.column, frameSlug, slug]);
```

(c) Replace the component-mode render block (the `kitProps.length > 0 ? kitProps.map(...) : <span>No editable...` region, lines ~442-458) with per-kind widgets + the honesty note + always-visible Ask-AI:

```tsx
                {kitProps.length > 0 ? (
                  kitProps.map((p) => {
                    const pendingVal = pending[`prop:${p.name}`] as string | undefined;
                    const pendingExpr = pending[`propExpr:${p.name}`] as string | undefined;
                    const current = pendingVal ?? pendingExpr ?? instanceAttrs[p.name];
                    const d = renderPropField(p, current);
                    return (
                      <Field key={p.name} label={p.name}>
                        {d.widget === "select" ? (
                          <select aria-label={p.name} style={INPUT_COMPACT} value={d.value}
                            onChange={(e) => changePropByKind(p, e.target.value)}>
                            <option value="">—</option>
                            {(d.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : d.widget === "toggle" ? (
                          <SegmentedToggle ariaLabel={p.name}
                            options={[{ value: "false", label: "Off" }, { value: "true", label: "On" }]}
                            value={d.value === "true" ? "true" : "false"}
                            onChange={(v) => changePropByKind(p, v)} />
                        ) : (
                          <input aria-label={p.name} style={INPUT_COMPACT}
                            type={d.widget === "number" ? "number" : "text"}
                            defaultValue={d.value}
                            onBlur={(e) => changePropByKind(p, e.target.value)} />
                        )}
                      </Field>
                    );
                  })
                ) : (
                  <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", lineHeight: 1.45 }}>
                    No editable properties — use Ask AI to change this.
                  </span>
                )}
                {/* Honesty boundary: the panel edits PROPS; baked-in text/structure is Ask-AI. */}
                <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", lineHeight: 1.45 }}>
                  Text content and structure are edited via Ask AI.
                </span>
                <Button variant="primary" onClick={() => askAi("describe the change")}>Ask AI to change this</Button>
```

(d) Add `changePropByKind` next to `changeProp` (reuse `changeProp`'s body but pick the write prefix by kind):

```ts
  function changePropByKind(prop: KitProp2, value: string) {
    const prefix = prop.kind === "toggle" || prop.kind === "number" ? "propExpr" : "prop";
    if (!inFrameComp || !focused) return;
    if (value === "") return; // "—" = no change
    const sel = { ...focused.selection, file: inFrameComp.file, line: inFrameComp.line, column: inFrameComp.column };
    setField(focused.selection.editId, `${prefix}:${prop.name}` as any, value);
    void postVisualEdit(slug, buildSingleEdit(sel, `${prefix}:${prop.name}`, value, frameSlug ?? ""))
      .then((det) => {
        if (det.ok) {
          addBlock({
            label: `${inFrameComp.componentName}.${prop.name} → ${value}`,
            kind: "instant", status: "applied", frameSlug: frameSlug ?? "",
          });
        } else {
          askAi(`set its ${prop.name} to ${value}`);
        }
      });
  }
```

(Leave the old `changeProp` in place if other code calls it; otherwise replace its single caller. Grep `changeProp(` to confirm — the only caller was the old dropdown.)

- [ ] **Step 6: Run the inspector tests + any existing panel tests**

Run: `pnpm run studio:test __tests__/components`
Expected: PASS. If a pre-existing InspectorPanel test asserted the old dropdown-only shape or `kitProps` `{name,values}`, update it to the new shape (the panel still renders selects for select-kind props; text/toggle are new). Name any test you changed in the report.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/src/components/inspector/propField.ts studio/__tests__/components/inspector-props-panel.test.tsx
git commit -m "feat(studio/inspector): per-kind prop widgets, prefill, propExpr routing, Ask-AI honesty note"
```

---

### Task 6: Full suite + manual gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: green except the KNOWN pre-existing unrelated failures on this branch base (figmaIngest, figmaBridge/wsServer — confirm any failure is one of these via `git stash`/re-run only if a NEW failure appears). The two `✘ ERROR` esbuild lines in output are intentional broken-frame test FIXTURES, not failures.

- [ ] **Step 2: Confirm the dev server boots (config-load guard)**

Run: `node -e 'require("vite").loadConfigFromFile({command:"serve",mode:"development"},"studio/vite.config.ts").then(()=>console.log("CONFIG OK")).catch(e=>{console.error(e.message);process.exit(1)})'`
Expected: `CONFIG OK`.

- [ ] **Step 3: Manual gate (HUMAN — the user runs it)**

A full restart is required (Vite middleware does NOT hot-reload): quit `pnpm run studio`, restart.
1. Open the `computer-chat` project → the ComputerScene frame → click an element inside it.
2. The panel ("Editing `<ComputerScene>`") shows fields, prefilled:
   - **user name** = Ava Wright (text), **subtitle** = DevRev (text), **chat placeholder** = Ask me anything (text), **avatar src** = empty (text), **state** = transcript (dropdown), **canvas panel** = Off/On (toggle).
   - NOT shown (correct): header title, session id, the chat message texts.
3. Edit **user name** → "Ada" → applies + persists (an applied block appears); reselect → still shows "Ada" (instance-attr prefill).
4. Switch **state** → "streaming" → the scene re-renders streaming.
5. Toggle **canvas panel** On → the artefacts panel mounts.
6. The scene STAYS interactive throughout (sessions clickable, input works).
7. The panel shows the "Text content and structure are edited via Ask AI" note, and "Ask AI to change this" is present even with props shown.
PASS = all of the above; no "No editable properties" dead-end for this frame.

- [ ] **Step 4: No commit** (verification task). Report results; on PASS, proceed to the whole-branch review via subagent-driven-development's final review, then `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Composite source reader (text/toggle/number/select) → Task 1 + 2. ✓
- ReactNode-with-string-default rule → Task 1 (parser) + tests. ✓
- id-like exclusion → Task 1. ✓
- arcade-gen path unchanged, resolver chain → Task 2. ✓
- `propExpr:` + full-initializer reader (the flagged hard part) → Task 3. ✓
- Prefill "current value wins" (needs the instance-attr read the picker lacks) → Task 4 + Task 5 wiring. ✓
- Panel per-kind widgets + prefill + honesty note + always-visible Ask-AI → Task 5. ✓
- Cache: composite path uncached → Task 2 (`compositePropsFor` reads per call). ✓
- Closed-world reads → Task 2 (NAME_RE) + Task 4 (SLUG_RE). ✓
- Manual gate matching the corrected prop list → Task 6. ✓

**Placeholder scan:** every code step has complete code; no TBD/TODO. The `propField.ts` type-import caveat and the column-in-fixture caveat are stated with concrete fallbacks, not hand-waves.

**Type consistency:** `KitProp2` defined in Task 1, consumed by Tasks 2/5 with the same shape (`{name, kind, values?, default?}`). `kitPropsFor` returns `KitProp2[]` (Task 2), endpoint passes it through, panel consumes it (Task 5). `readAttrInitializer` (Task 3) / `readInstanceAttrs` (Task 4) names match their callers. `changePropByKind` selects `prop:`/`propExpr:` consistently with Task 3's branches.
