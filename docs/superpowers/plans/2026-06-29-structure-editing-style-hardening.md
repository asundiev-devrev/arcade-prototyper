# Structure Editing + Frame-Authored Style Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structure editing of a generated chat (insert/delete/move/change-role on the frame's `transcript` array, by message id) via a new pure TS-AST `writeBindStructure`, surfaced as a panel toolbar; plus a reliability pass on the existing frame-authored style path.

**Architecture:** Extend the shipped data-bind machine. A new pure `writeBindStructure` performs array-entry ops on the frame's `const transcript = [...]` (reusing the now-exported `findArrayLiteral`/`unwrap`). It is threaded through the SHIPPED visual-edit pipeline as an optional `structureOp` field on `ElementEdit` (mirroring `bindPath?`), routed via `writeBatch(frameSlug, edits, slug)` — the proven slug path, NOT the `body.move` side-channel. The panel shows a structure toolbar on a bound transcript selection and suppresses the legacy JSX move buttons there.

**Tech Stack:** TypeScript compiler API (NOT Babel), React (InspectorPanel), Vite middleware, Vitest.

## Global Constraints

- **TypeScript compiler API for all source parsing/writing — never Babel/regex on code.**
- **pnpm only.** Tests: `pnpm run studio:test <path>`. Full suite: `pnpm run studio:test`.
- **Conventional Commits**, scope `studio/canvas` (codeWriter/dispatch), `studio/inspector` (panel).
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Reparse-guard every write** — never persist unparseable TSX. Reparse-guard is necessary but NOT sufficient for inserts: also match the array's existing FORMAT (see Task 2).
- **By message `id`, never array index** — structure ops address entries by their `id` literal; insert id = `max(numeric ids)+1`.
- **Slug path:** structure ops go through `body.edits` → `writeBatch(frameSlug, edits, slug)` (slug from the middleware URL). NEVER the `body.move` side-channel (it derives slug from `selection.file`, which is `""` for a bound selection → the known `file:""` misroute bug).
- **Stay off the wall:** structure ops touch ONLY the frame's `const transcript` data literal; never composite-internal JSX. The legacy per-element JSX move ↑/↓ buttons MUST be suppressed for bound transcript selections (they reorder kit-internal JSX = reaching into the composite).
- **Degrade, never crash:** any op that can't resolve (missing id, absent array, reparse fail) → `{ok:false, reason}` → calm error block, never a silent prompt.

---

### Task 1: Export the shared AST helpers from bindEdit.ts

**Files:**
- Modify: `studio/server/codeWriter/bindEdit.ts`
- Test: `studio/__tests__/server/codeWriter/bindEdit-exports.test.ts` (new)

**Interfaces:**
- Produces: `export function findArrayLiteral(sf: ts.SourceFile, name: string): ts.ArrayLiteralExpression | null` and `export function unwrap(expr: ts.Expression): ts.Expression` — currently module-private; `bindStructure.ts` (Task 2) imports them.

**Context (verified):** `bindEdit.ts:22` `unwrap` and `:35` `findArrayLiteral` are declared `function` (no `export`). `findArrayLiteral` already calls `unwrap` to strip `as const`/`satisfies`/parens. `writeBindEdit` uses both. Exporting is purely additive — no behavior change.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/bindEdit-exports.test.ts
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { findArrayLiteral, unwrap } from "../../../server/codeWriter/bindEdit";

describe("exported AST helpers", () => {
  it("findArrayLiteral locates a const array (and unwraps as const)", () => {
    const src = `const transcript = [{ id: 1, text: "a" }] as const;`;
    const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const arr = findArrayLiteral(sf, "transcript");
    expect(arr).not.toBeNull();
    expect(arr!.elements.length).toBe(1);
  });
  it("findArrayLiteral returns null for an unknown name", () => {
    const sf = ts.createSourceFile("f.tsx", `const x = [1];`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(findArrayLiteral(sf, "transcript")).toBeNull();
  });
  it("unwrap strips as/satisfies/parens", () => {
    const src = `const x = ([1] satisfies number[]);`;
    const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let inner: ts.Expression | null = null;
    sf.forEachChild(function v(n): void {
      if (ts.isVariableDeclaration(n) && n.initializer) inner = unwrap(n.initializer);
      else ts.forEachChild(n, v);
    });
    expect(inner && ts.isArrayLiteralExpression(inner)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (not exported).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit-exports.test.ts`
Expected: FAIL (no exported `findArrayLiteral`/`unwrap`).

- [ ] **Step 3: Add `export`**

In `bindEdit.ts`, change `function unwrap(` → `export function unwrap(` (line ~22) and `function findArrayLiteral(` → `export function findArrayLiteral(` (line ~35). Nothing else.

- [ ] **Step 4: Run the test + the existing bindEdit suite (no regression)**

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit-exports.test.ts __tests__/server/codeWriter/bindEdit.test.ts`
Expected: PASS both (exporting doesn't change `writeBindEdit`).

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/bindEdit.ts studio/__tests__/server/codeWriter/bindEdit-exports.test.ts
git commit -m "refactor(studio/canvas): export findArrayLiteral + unwrap for reuse by writeBindStructure"
```

---

### Task 2: writeBindStructure — array-entry ops (the core, pure TS-AST)

**Files:**
- Create: `studio/server/codeWriter/bindStructure.ts`
- Test: `studio/__tests__/server/codeWriter/bindStructure.test.ts` (new)

**Interfaces:**
- Consumes: `findArrayLiteral` (Task 1), `typescript`.
- Produces:
  - `export type StructureOp = { kind: "insert"; afterId: number | null; entry: { role: "user" | "assistant"; text: string } } | { kind: "delete"; id: number } | { kind: "move"; id: number; beforeId: number | null } | { kind: "setRole"; id: number; role: "user" | "assistant" }`
  - `export function writeBindStructure(source: string, arrayName: string, op: StructureOp): { ok: true; source: string } | { ok: false; reason: string }`

**Context (verified):** The array elements are object literals. Three real formats exist: single-line objects with `as const` (the `template-seeds/computer` seed), multi-line one-prop-per-line with a trailing comma on EVERY element incl. last (a generated/lifted frame), and a single-line element with trailing comma (test fixtures). `findArrayLiteral` returns the `ArrayLiteralExpression`; `arr.elements` are the entries; `arr.elements.hasTrailingComma` and each element's `getStart(sf)`/`getEnd()` give splice positions. Detect multi-line by checking whether the array text between `[` and the first element contains a newline.

- [ ] **Step 1: Write the failing tests**

```ts
// studio/__tests__/server/codeWriter/bindStructure.test.ts
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { writeBindStructure } from "../../../server/codeWriter/bindStructure";

function reparses(src: string): boolean {
  const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ((sf as any).parseDiagnostics?.length ?? 0) === 0;
}

// Multi-line, trailing comma on every element (real generated-frame shape).
const MULTI = `const transcript = [
  { id: 1, role: "user", text: "First" },
  { id: 2, role: "assistant", text: "Second", artefact: { tag: "DOC", title: "Brief" } },
];
`;
// Single-line + as const (real seed shape), no trailing comma on last.
const SEED = `const transcript = [{ id: 1, role: "user", text: "Hi" }, { id: 2, role: "assistant", text: "Yo" }] as const;`;

describe("writeBindStructure — insert", () => {
  it("inserts after a given id with a fresh max+1 id, matching multi-line format", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: "New" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(reparses(r.source)).toBe(true);
      expect(r.source).toContain(`text: "New"`);
      expect(r.source).toContain(`id: 3`);            // max(1,2)+1
      // new entry sits between id 1 and id 2
      expect(r.source.indexOf(`"First"`)).toBeLessThan(r.source.indexOf(`"New"`));
      expect(r.source.indexOf(`"New"`)).toBeLessThan(r.source.indexOf(`"Second"`));
      // multi-line format preserved: the new entry is on its own line
      expect(r.source).toMatch(/\n\s+\{ id: 3,[^\n]*"New"[^\n]*\},?\n/);
    }
  });
  it("inserts at end when afterId is null", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: null, entry: { role: "assistant", text: "Last" } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source.indexOf(`"Second"`)).toBeLessThan(r.source.indexOf(`"Last"`)); }
  });
  it("inserts into the single-line as-const seed and still reparses", () => {
    const r = writeBindStructure(SEED, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: "Mid" } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).toContain(`text: "Mid"`); expect(r.source).toContain(`id: 3`); }
  });
  it("computes id from a Date.now()-sized max", () => {
    const big = `const transcript = [\n  { id: 1717000000000, role: "user", text: "x" },\n];\n`;
    const r = writeBindStructure(big, "transcript", { kind: "insert", afterId: null, entry: { role: "user", text: "y" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`id: 1717000000001`);
  });
  it("escapes quotes in the new text", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: `He said "hi"` } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(reparses(r.source)).toBe(true);
  });
});

describe("writeBindStructure — delete / move / setRole", () => {
  it("deletes an entry, leaving others + ids intact, reparse-clean", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "delete", id: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).not.toContain(`"First"`); expect(r.source).toContain(`"Second"`); expect(r.source).toContain(`id: 2`); }
  });
  it("deletes the LAST entry without leaving a dangling/double comma", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "delete", id: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).not.toContain(`"Second"`); }
  });
  it("moves an entry before another id, ids intact", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "move", id: 2, beforeId: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source.indexOf(`"Second"`)).toBeLessThan(r.source.indexOf(`"First"`)); }
  });
  it("setRole flips role and strips artefact when going to user (cosmetic hygiene)", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 2, role: "user" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(reparses(r.source)).toBe(true);
      expect(r.source).toMatch(/\{ id: 2, role: "user", text: "Second"[^}]*\}/);
      expect(r.source).not.toContain(`title: "Brief"`); // artefact stripped
    }
  });
  it("setRole user→assistant leaves text intact", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 1, role: "assistant" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toMatch(/\{ id: 1, role: "assistant", text: "First"/);
  });
});

describe("writeBindStructure — failures (graceful)", () => {
  it("missing id → {ok:false}", () => {
    expect(writeBindStructure(MULTI, "transcript", { kind: "delete", id: 99 }).ok).toBe(false);
    expect(writeBindStructure(MULTI, "transcript", { kind: "move", id: 99, beforeId: 1 }).ok).toBe(false);
    expect(writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 99, role: "user" }).ok).toBe(false);
  });
  it("absent array → {ok:false}, no throw", () => {
    expect(writeBindStructure(`export default () => null;`, "transcript", { kind: "delete", id: 1 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them — FAIL** (module not found).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindStructure.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `bindStructure.ts`**

```ts
// studio/server/codeWriter/bindStructure.ts
import ts from "typescript";
import { findArrayLiteral } from "./bindEdit";

export type StructureOp =
  | { kind: "insert"; afterId: number | null; entry: { role: "user" | "assistant"; text: string } }
  | { kind: "delete"; id: number }
  | { kind: "move"; id: number; beforeId: number | null }
  | { kind: "setRole"; id: number; role: "user" | "assistant" };

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

function parse(source: string) {
  return ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elementId(el: ts.Expression): number | null {
  if (!ts.isObjectLiteralExpression(el)) return null;
  for (const p of el.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText().replace(/['"]/g, "") === "id"
        && ts.isNumericLiteral(p.initializer)) return Number(p.initializer.text);
  }
  return null;
}

function maxId(arr: ts.ArrayLiteralExpression): number {
  let m = 0;
  for (const el of arr.elements) { const id = elementId(el); if (id != null && id > m) m = id; }
  return m;
}

/** True when the array is laid out one-element-per-line (multi-line). */
function isMultiLine(sf: ts.SourceFile, arr: ts.ArrayLiteralExpression): boolean {
  const text = arr.getText(sf);
  // Newline between the opening "[" and the first element ⇒ multi-line layout.
  return /\[\s*\n/.test(text);
}

/** The indent (leading whitespace) of the first element's line, for multi-line inserts. */
function elementIndent(source: string, arr: ts.ArrayLiteralExpression, sf: ts.SourceFile): string {
  if (arr.elements.length === 0) return "  ";
  const start = arr.elements[0].getStart(sf);
  const lineStart = source.lastIndexOf("\n", start) + 1;
  return source.slice(lineStart, start);
}

function entryText(entry: { role: "user" | "assistant"; text: string }, id: number): string {
  return `{ id: ${id}, role: ${JSON.stringify(entry.role)}, text: ${JSON.stringify(entry.text)} }`;
}

export function writeBindStructure(
  source: string, arrayName: string, op: StructureOp,
): { ok: true; source: string } | { ok: false; reason: string } {
  const sf = parse(source);
  const arr = findArrayLiteral(sf, arrayName);
  if (!arr) return { ok: false, reason: "array-not-found" };
  const els = arr.elements;
  const idxOf = (id: number) => els.findIndex((e) => elementId(e) === id);

  let out: string;

  if (op.kind === "insert") {
    const newId = maxId(arr) + 1;
    const entry = entryText(op.entry, newId);
    const multi = isMultiLine(sf, arr);
    const indent = elementIndent(source, arr, sf);
    // UNIFORM insert strategy (correct for all 3 real formats):
    // pick the "anchor" element to insert AFTER — the afterId element, or the
    // LAST element when afterId is null (append). Then insert immediately after
    // that element's own end (its closing `}`), BEFORE any trailing comma. We
    // always emit the new entry as: ", <entry>" (single-line) or ",\n<indent><entry>"
    // (multi-line). Inserting right after the brace (not after the separator
    // comma) guarantees exactly one separator on each side regardless of whether
    // a trailing comma exists, so there is never a doubled or orphaned comma.
    if (els.length === 0) {
      // empty array: drop the entry between the brackets, no separators needed.
      const closeBracket = arr.getEnd() - 1; // position of "]"
      out = source.slice(0, closeBracket) + entry + source.slice(closeBracket);
    } else {
      const anchorIdx = op.afterId == null ? els.length - 1 : idxOf(op.afterId);
      if (anchorIdx === -1) return { ok: false, reason: "afterId-not-found" };
      const anchorEnd = els[anchorIdx].getEnd(); // position just after the anchor element's `}`
      // ", <entry>" places the new entry AFTER the anchor brace and BEFORE the
      // anchor's existing trailing comma (if any). Net sequence becomes:
      //   } , <entry> ,?    → "}, <entry>," (valid) or "}, <entry>" then "]" (valid)
      const ins = multi ? `,\n${indent}${entry}` : `, ${entry}`;
      out = source.slice(0, anchorEnd) + ins + source.slice(anchorEnd);
    }
  } else if (op.kind === "delete") {
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    const el = els[i];
    const start = el.getStart(sf);
    let end = el.getEnd();
    // swallow a trailing comma + following whitespace if present
    const after = source.slice(end, arr.getEnd());
    const cm = after.match(/^\s*,/);
    if (cm) end += cm[0].length;
    // also trim the now-leading whitespace up to the previous newline
    let s = start;
    const before = source.slice(arr.getStart(sf), start);
    const lead = before.match(/\n[ \t]*$/);
    if (lead) s -= lead[0].length;
    out = source.slice(0, s) + source.slice(end);
  } else if (op.kind === "move") {
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    // Simple, format-robust move: delete the entry's text, re-insert before beforeId
    // (or at end if beforeId null). Do it by recomputing on the AST in two passes.
    const elText = els[i].getText(sf).trim();
    const del = writeBindStructure(source, arrayName, { kind: "delete", id: op.id });
    if (!del.ok) return del;
    // Re-find in the deleted source, then insert elText before beforeId.
    const sf2 = parse(del.source);
    const arr2 = findArrayLiteral(sf2, arrayName);
    if (!arr2) return { ok: false, reason: "array-not-found" };
    const multi = isMultiLine(sf2, arr2);
    const indent = elementIndent(del.source, arr2, sf2);
    if (op.beforeId == null) {
      const closeBracket = arr2.getEnd() - 1;
      const lastEnd = arr2.elements.length ? arr2.elements[arr2.elements.length - 1].getEnd() : closeBracket;
      const ins = multi ? `\n${indent}${elText},` : (arr2.elements.length ? `, ${elText}` : elText);
      out = del.source.slice(0, lastEnd) + ins + del.source.slice(lastEnd);
    } else {
      const j = arr2.elements.findIndex((e) => elementId(e) === op.beforeId);
      if (j === -1) return { ok: false, reason: "beforeId-not-found" };
      const beforeStart = arr2.elements[j].getStart(sf2);
      const lineStart = del.source.lastIndexOf("\n", beforeStart) + 1;
      const ins = multi ? `${elText},\n${indent}` : `${elText}, `;
      out = del.source.slice(0, multi ? lineStart : beforeStart) + (multi ? `${indent}${ins}`.replace(indent + indent, indent) : ins) + del.source.slice(multi ? lineStart : beforeStart);
      // Simpler robust fallback: if the above is fragile, just splice before beforeStart.
      if (!reparses(out)) {
        out = del.source.slice(0, beforeStart) + `${elText}, ` + del.source.slice(beforeStart);
      }
    }
  } else { // setRole
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    const el = els[i];
    if (!ts.isObjectLiteralExpression(el)) return { ok: false, reason: "not-object" };
    const roleProp = el.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && p.name.getText().replace(/['"]/g, "") === "role",
    );
    if (!roleProp || !ts.isStringLiteral(roleProp.initializer)) return { ok: false, reason: "role-not-string" };
    // Replace the role value.
    const rs = roleProp.initializer.getStart(sf), re = roleProp.initializer.getEnd();
    let work = source.slice(0, rs) + JSON.stringify(op.role) + source.slice(re);
    // Cosmetic hygiene: going to "user" strips an artefact prop if present. One cheap pass.
    if (op.role === "user") {
      const sf3 = parse(work);
      const arr3 = findArrayLiteral(sf3, arrayName)!;
      const el3 = arr3.elements[idxOf(op.id)];
      if (el3 && ts.isObjectLiteralExpression(el3)) {
        const art = el3.properties.find(
          (p) => ts.isPropertyAssignment(p) && !!p.name && p.name.getText().replace(/['"]/g, "") === "artefact",
        );
        if (art) {
          const as = art.getStart(sf3); let ae = art.getEnd();
          const after = work.slice(ae); const cm = after.match(/^\s*,/); if (cm) ae += cm[0].length;
          let s = as; const before = work.slice(0, as).match(/,\s*$/); if (before) s -= before[0].length;
          work = work.slice(0, s) + work.slice(ae);
        }
      }
    }
    out = work;
  }

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
```

> NOTE to implementer: the `move` multi-line re-insert has a fallback to a plain `before beforeStart` splice if the formatted splice doesn't reparse — keep that safety net. If any op's splice math proves fiddly against the three real formats, the governing rule is: the result MUST reparse (guarded) AND must place the entry in the right position by id; exact indentation is best-effort (the fallback guarantees validity). Make the tests pass; if a format case can't be made clean, prefer the reparse-valid fallback over failing.

- [ ] **Step 4: Run the tests — PASS** (all insert/delete/move/setRole + format + id-scan + failure cases).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindStructure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/bindStructure.ts studio/__tests__/server/codeWriter/bindStructure.test.ts
git commit -m "feat(studio/canvas): writeBindStructure — insert/delete/move/setRole on the transcript array by id"
```

---

### Task 3: Thread structureOp through the edit pipeline + dispatch

**Files:**
- Modify: `studio/src/lib/visualEditClient.ts` (add `structureOp?`+`arrayName?` to `ElementEdit`, add `buildBindStructure`)
- Modify: `studio/server/codeWriter/index.ts` (mirror the fields on the server `ElementEdit`; dispatch branch)
- Test: `studio/__tests__/server/codeWriter/structure-dispatch.test.ts` (new)

**Interfaces:**
- Consumes: `writeBindStructure` + `StructureOp` (Task 2).
- Produces: `export function buildBindStructure(arrayName: string, op: StructureOp, frameSlug: string): VisualEditPayload`; `ElementEdit` gains `structureOp?: StructureOp; arrayName?: string` (both copies).

**Context (verified):** `ElementEdit` is declared in BOTH `visualEditClient.ts:5-11` (client) and `index.ts:12-18` (server) and already carries `bindPath?` as the optional-field precedent. `buildBindEdit` (`visualEditClient.ts:147`) sets `file:""`. The middleware routes `body.edits` → `writeBatch(body.frameSlug, body.edits, slug)` (`visualEdit.ts:58`) with `slug` from the URL — the proven slug path. `applyEditsToSource` (`index.ts:28`) has the bindPath branch as the precedent dispatch.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/structure-dispatch.test.ts
import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

const FRAME = `const transcript = [
  { id: 1, role: "user", text: "First" },
];
export default () => <ComputerScene transcript={transcript} />;
`;

describe("applyEditsToSource — structureOp", () => {
  it("routes an insert structureOp to writeBindStructure", () => {
    const r = applyEditsToSource(FRAME, {
      file: "", line: 0, column: 0, fields: [],
      arrayName: "transcript",
      structureOp: { kind: "insert", afterId: 1, entry: { role: "assistant", text: "Reply" } },
    } as any);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain(`text: "Reply"`); expect(r.source).toContain(`id: 2`); }
  });
  it("a structureOp with a bad id fails (agent fallback upstream)", () => {
    const r = applyEditsToSource(FRAME, {
      file: "", line: 0, column: 0, fields: [],
      arrayName: "transcript",
      structureOp: { kind: "delete", id: 99 },
    } as any);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (structureOp ignored → falls through).

Run: `pnpm run studio:test __tests__/server/codeWriter/structure-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the fields + builder (client) and the dispatch (server)**

In `studio/src/lib/visualEditClient.ts`:
```ts
import type { StructureOp } from "../../server/codeWriter/bindStructure"; // type-only
// extend ElementEdit:
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
  bindPath?: string;
  /** When set, this edit performs a structure op on the frame's named data array. */
  structureOp?: StructureOp;
  arrayName?: string;
}
// new builder (mirrors buildBindEdit; file:"" is safe on the writeBatch(slug) path):
export function buildBindStructure(arrayName: string, op: StructureOp, frameSlug: string): VisualEditPayload {
  return { frameSlug, edits: [{ file: "", line: 0, column: 0, fields: [], arrayName, structureOp: op }] };
}
```
(If the type-only import of `StructureOp` from the server path trips the client build, copy the `StructureOp` union into `visualEditClient.ts` instead and note it — runtime never crosses.)

In `studio/server/codeWriter/index.ts`: mirror `structureOp?: StructureOp; arrayName?: string` on the server `ElementEdit` (import the type from `./bindStructure`), and add a dispatch branch at the TOP of `applyEditsToSource` (alongside the `bindPath` branch), BEFORE the JSX paths:
```ts
import { writeBindStructure } from "./bindStructure";
// …first branches in applyEditsToSource:
  if (edit.structureOp) {
    if (!edit.arrayName) return { ok: false, reason: "structure-no-array" };
    const r = writeBindStructure(source, edit.arrayName, edit.structureOp);
    return r.ok ? { ok: true, source: r.source } : { ok: false, reason: r.reason };
  }
```

- [ ] **Step 4: Run the test + codeWriter suite (no regression)**

Run: `pnpm run studio:test __tests__/server/codeWriter/structure-dispatch.test.ts __tests__/server/codeWriter`
Expected: PASS (existing bindPath/prop/class/text paths unaffected when structureOp absent).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/visualEditClient.ts studio/server/codeWriter/index.ts studio/__tests__/server/codeWriter/structure-dispatch.test.ts
git commit -m "feat(studio/canvas): thread structureOp through visual-edit, dispatch to writeBindStructure"
```

---

### Task 4: Panel structure toolbar + suppress legacy JSX move buttons

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/structure-toolbar.test.tsx` (new)

**Interfaces:**
- Consumes: `buildBindStructure` (Task 3), `StructureOp` type, selection `bindPath`.
- Produces: a pure helper `export function isTranscriptEntry(bindPath: string | undefined): { id: number } | null` (extracted so it's unit-testable) + the toolbar wiring.

**Context (verified):** The batch-list row renders move ↑/↓ buttons at `InspectorPanel.tsx:427-436` calling `move(e, dir)` (the `body.move` side-channel — derives slug from `selection.file`, which is `""` for a bound selection). The focused-section renders the "Double-click … to edit its text" hint at `:452-458` (gated on `selection.textEditable`) and the `isComponentSel` Ask-AI block at `:465`. A bound selection has `bindPath` set → it must show a structure toolbar, NOT the JSX move buttons, NOT Ask-AI. `frameSlug` is available from `useEditSession()` context (already destructured at the top).

- [ ] **Step 1: Write the failing test (pure helper)**

```tsx
// studio/__tests__/components/structure-toolbar.test.tsx
import { describe, it, expect } from "vitest";
import { isTranscriptEntry } from "../../src/components/inspector/InspectorPanel";

describe("isTranscriptEntry", () => {
  it("matches a transcript bindPath and returns the id", () => {
    expect(isTranscriptEntry("transcript[id=3].text")).toEqual({ id: 3 });
    expect(isTranscriptEntry("transcript[id=12].artefact.title")).toEqual({ id: 12 });
  });
  it("rejects non-transcript / undefined", () => {
    expect(isTranscriptEntry(undefined)).toBeNull();
    expect(isTranscriptEntry("sessions[id=1].name")).toBeNull(); // only transcript in v1
    expect(isTranscriptEntry("not a bind")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`isTranscriptEntry` not exported).

Run: `pnpm run studio:test __tests__/components/structure-toolbar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the helper + the toolbar + suppress the JSX move buttons**

Add the exported helper near the top of `InspectorPanel.tsx` (module scope):
```ts
/** A transcript-entry bind (e.g. "transcript[id=3].text") → its message id, else null.
 *  v1: only the `transcript` array is structure-editable. */
export function isTranscriptEntry(bindPath: string | undefined): { id: number } | null {
  if (!bindPath) return null;
  const m = /^transcript\[id=(\d+)\]\./.exec(bindPath);
  return m ? { id: Number(m[1]) } : null;
}
```
Import the builder:
```ts
import { postVisualEdit, isInFrame, buildSingleEdit, buildBindEdit, buildBindStructure } from "../../lib/visualEditClient";
```
Add a `structure(op)` handler next to `applyFieldEdit` (uses the proven slug path via `postVisualEdit`, frameSlug from context, clears selection on success):
```ts
  async function structure(op: import("../../lib/visualEditClient").VisualEditPayload["edits"][number]["structureOp"]) {
    const targetFrame = frameSlug ?? "";
    if (!targetFrame || !op) return;
    const det = await postVisualEdit(slug, buildBindStructure("transcript", op, targetFrame));
    if (det.ok) {
      // array mutated + frame hot-reloads → held selection is stale: clear it
      // (borrow ONLY the selection-clear behavior from move(); NOT its slug derivation).
      frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
      clear();
    } else {
      addBlock({ label: "Couldn't change the conversation structure", kind: "instant", status: "error", frameSlug: targetFrame });
    }
  }
```
Suppress the legacy JSX move buttons for a bound transcript row — at `:427-436`, wrap them so they only render when the row is NOT a transcript entry:
```tsx
{!isTranscriptEntry(e.selection.bindPath) && (
  <>
    <button type="button" aria-label="Move element up" /* …existing… */>↑</button>
    <button type="button" aria-label="Move element down" /* …existing… */>↓</button>
  </>
)}
```
Add the structure toolbar in the focused section. Find where the focused entry id + its neighbors are available (the `batch`/`focused` selection). Render it when `isTranscriptEntry(focused.selection.bindPath)`:
```tsx
{(() => {
  const te = focused ? isTranscriptEntry(focused.selection.bindPath) : null;
  if (!te) return null;
  // neighbor ids from the batch order is unreliable; use the rendered order:
  // afterId for add-below = this id; for add-above we insert with afterId = the
  // PREVIOUS message's id (or null to prepend). v1: add-below + add-above + delete
  // + move up/down + role toggle, all by THIS id; neighbor ids derived server-side
  // are not needed for delete/setRole; for move we pass beforeId = null sentinel
  // handled below.
  return (
    <div style={{ ...SECTION }}>
      <span style={LABEL}>Conversation</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button onClick={() => structure({ kind: "insert", afterId: te.id, entry: { role: "user", text: "New message" } })}>Add below</Button>
        <Button onClick={() => structure({ kind: "delete", id: te.id })}>Delete</Button>
        <Button onClick={() => structure({ kind: "move", id: te.id, beforeId: null })}>Move to end</Button>
        <Button onClick={() => structure({ kind: "setRole", id: te.id, role: "user" })}>Make user</Button>
        <Button onClick={() => structure({ kind: "setRole", id: te.id, role: "assistant" })}>Make assistant</Button>
      </div>
      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)" }}>
        Double-click the message in the frame to edit its text.
      </span>
    </div>
  );
})()}
```
And ensure the `isComponentSel` Ask-AI block does NOT render for a bound
transcript selection. **VERIFY (do not blindly add) — this guard ALREADY EXISTS:**
`InspectorPanel.tsx:175` currently reads
```ts
const isComponentSel = !!focusedNow && !focusedNow.selection.bindPath && !isInFrame(focusedNow.selection.file, frameSlug ?? "");
```
The `!focusedNow.selection.bindPath` clause was added by an earlier task, so a
bound selection already yields `isComponentSel === false` → no Ask-AI block.
CONFIRM it's present and unchanged; do NOT add a duplicate clause and do NOT treat
this as a bug to fix. (If, and only if, the clause is somehow absent, add it.)

> Implementer note on move/add-above: v1 ships the buttons above (Add below, Delete, Move to end, Make user/assistant). "Add above" and per-step "move up/down" need the neighbor id; if deriving the rendered-neighbor id in the panel is clean (from the transcript order the picker knows), add them — otherwise v1's set is sufficient for the manual gate (add/delete/move-to-end/role all exercise writeBindStructure). Do NOT block on add-above.

- [ ] **Step 4: Run the helper test + components suite (no regression)**

Run: `pnpm run studio:test __tests__/components/structure-toolbar.test.tsx __tests__/components`
Expected: PASS. If a pre-existing panel test asserted the move buttons always render, update it to the new conditional (name it in the report).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/structure-toolbar.test.tsx
git commit -m "feat(studio/inspector): structure toolbar on transcript selection; suppress legacy JSX move buttons"
```

---

### Task 5: Frame-authored style reliability pass

**Files:**
- Test: `studio/__tests__/server/codeWriter/frame-authored-style.test.ts` (new — codifies the static-class scope + degrade)
- Modify (only if a gap is found): `studio/src/components/inspector/InspectorPanel.tsx` or the picker resolution

**Interfaces:** none new — verifies + (if needed) fixes the existing instant-style className path.

**Context (verified):** `applyEditsToSource` (`index.ts:48-90`) writes className changes for frame-authored nodes; bails `dynamic-classname` / `spacing-shorthand-conflict` (correct). A frame-authored element shows style fields only when `isComponentSel` is false, i.e. `isInFrame(selection.file, frameSlug)` is true. The open question: on a real Figma-import frame, do raw tags resolve to the frame's own file (editable) or to an imported sub-component (not)? This task answers it.

- [ ] **Step 1: Write a test codifying the static-class scope + degrade**

```ts
// studio/__tests__/server/codeWriter/frame-authored-style.test.ts
import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

const STATIC = `export default () => <div className="flex p-2 text-(--fg-neutral-prominent)">Hi</div>;`;
const DYNAMIC = `export default ({on}: {on:boolean}) => <div className={on ? "p-2" : "p-4"}>Hi</div>;`;

describe("frame-authored style — static class scope", () => {
  it("changes a token class on a static-className element (writes to source)", () => {
    const r = applyEditsToSource(STATIC, {
      file: "frames/x/index.tsx", line: 1, column: 28, fields: [{ field: "color", value: "tok:text-(--fg-neutral-subtle)" }],
    } as any);
    // The instant-style path maps a token field to a class swap; assert it either
    // applied (source changed) or bailed with a REASON (never silently ok+unchanged).
    if (r.ok) expect(r.source).not.toBe(STATIC);
    else expect(typeof r.reason).toBe("string");
  });
  it("degrades (does not silently succeed) on a dynamic className", () => {
    const r = applyEditsToSource(DYNAMIC, {
      file: "frames/x/index.tsx", line: 1, column: 40, fields: [{ field: "paddingTop", value: "8px" }],
    } as any);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
```
(Adjust line/column to hit the element — read `locateJsx`'s convention; the point is: static → applies-or-reasoned; dynamic → `{ok:false}` with a reason, not silent.)

- [ ] **Step 2: Run it.** If it passes, the path is sound — proceed to the live audit (Step 3). If the static case silently returns ok+unchanged or the dynamic case returns ok, that's a real bug → fix it and note it.

Run: `pnpm run studio:test __tests__/server/codeWriter/frame-authored-style.test.ts`

- [ ] **Step 3: Live discovery (the load-bearing part) — does a Figma-import raw tag resolve as frame-authored?**

Pick a real Figma-import frame (e.g. under `~/Library/Application Support/arcade-studio/projects/*/frames/*` with many raw tags). Using the picker resolution logic (`resolveSelection` / `isInFrame`), determine whether a raw `<div>`/`<h1>` in that frame resolves to a `file` containing `/frames/<slug>/` (→ `isComponentSel` false → style fields show) or to an imported component path (→ no style fields). Document the finding in the report.
- If raw tags resolve as frame-authored → the path works; the task is verification + the Step-1 test. Done.
- If raw tags WRONGLY resolve as components (no style fields) → that's the reachability gap; fix the resolution so frame-authored host elements show style fields. If the fix is large, STOP and report — split it to its own spec rather than expanding this task.

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/server/codeWriter/frame-authored-style.test.ts
# + any fix file if a gap was found
git commit -m "test(studio/canvas): codify frame-authored static-class style scope + degrade; audit Figma-import reachability"
```

---

### Task 6: Full suite + manual gate

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `pnpm run studio:test`
Expected: green except KNOWN pre-existing failures (figmaBridge/wsServer — confirm any failure is that, not new). The two `✘ ERROR` esbuild lines are intentional broken-frame fixtures.

- [ ] **Step 2: Config-load**

Run: `node -e 'require("vite").loadConfigFromFile({command:"serve",mode:"development"},"studio/vite.config.ts").then(()=>console.log("CONFIG OK")).catch(e=>{console.error(e.message);process.exit(1)})'`
Expected: `CONFIG OK`.

- [ ] **Step 3: Manual gate (HUMAN — full restart first; Vite middleware doesn't hot-reload)**

On a generated Computer chat (the `transcript={...}` form):
1. **Add below** a message → a new editable bubble appears below it; double-click it → edit its text → persists.
2. **Delete** a message → it's gone; the array in the frame source no longer has it.
3. **Move to end** → the message moves to the bottom; others keep their text.
4. **Make user / Make assistant** on a message → it re-renders as the other role.
5. Scene stays interactive throughout (sessions clickable, typing streams).
6. The legacy ↑/↓ move buttons do NOT appear on a chat message row (only the structure toolbar).
7. STYLE: on a Figma-import frame, click a raw heading → restyle (color token / spacing) → persists. A composite-internal chat bubble → panel offers Ask-AI / structure, NOT a fake style control.
PASS = structure ops are deterministic + persist + scene stays live; frame-authored style persists; no reach into composite internals.

- [ ] **Step 4: No commit.** On PASS → whole-branch review (subagent-driven-development final review) → `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Export findArrayLiteral+unwrap (prereq) → Task 1. ✓
- writeBindStructure insert/delete/move/setRole + format fidelity (3 shapes) + id-scan + union-strip → Task 2. ✓
- structureOp threading (optional field, both ElementEdit copies) + dispatch via writeBatch(slug) → Task 3. ✓
- Panel toolbar + suppress JSX move buttons + Ask-AI gate + selection-clear + frameSlug-from-context → Task 4. ✓
- Frame-authored style reliability (static-class scope + degrade + isInFrame discovery) → Task 5. ✓
- Suite + manual gate → Task 6. ✓
- Slug path = writeBatch(slug), NOT body.move → Task 3 + Task 4 (structure() uses postVisualEdit/buildBindStructure, not move()). ✓
- Composite per-element style OUT (Ask-AI) → not built; Task 4 gate keeps Ask-AI only for non-bound; manual gate verifies. ✓

**Placeholder scan:** every code step has complete code; the move multi-line splice carries an explicit reparse-valid fallback (not a TODO); the style task's "if a gap is found" is bounded with a stop-and-split instruction, not open-ended.

**Type consistency:** `StructureOp` defined in Task 2, imported by Task 3 (both ElementEdit copies) + Task 4 (`buildBindStructure`/`structure()`). `buildBindStructure(arrayName, op, frameSlug)` consistent Task 3 ↔ Task 4. `isTranscriptEntry` defined + exported in Task 4, used by the toolbar + the move-button suppression. `writeBindStructure(source, arrayName, op)` consistent Task 2 ↔ Task 3 dispatch. The `file:""` + `writeBatch(slug)` contract matches the shipped bindPath precedent.
