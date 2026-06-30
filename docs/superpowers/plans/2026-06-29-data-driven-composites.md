# Data-Driven Composites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a generated ComputerScene's chat messages editable by lifting the transcript into frame data, stamping each rendered bubble with a `data-arcade-bind` pointing at its data, and letting a click → inline text edit write that frame array deterministically.

**Architecture:** ComputerScene gains a `transcript` prop (default = today's seed) and stamps each seeded message's text node with `data-arcade-bind="transcript[id=<id>].<field>"`. The in-frame picker reads that attribute and posts a selection carrying a `bindPath`. A new pure TS-AST writer `writeBindEdit` edits the frame's `const transcript` array by message id. The bound edit is threaded as an OPTIONAL `bindPath` field on the existing edit payload (matching the codebase's `text?`/`iconSwap?` optional-field style — NOT a discriminated-union rewrite), so only the commit router and the codeWriter dispatch branch on it.

**Tech Stack:** TypeScript compiler API (NOT Babel), React (ComputerScene + InspectorPanel + picker), Vite middleware, Vitest.

## Global Constraints

- **TypeScript compiler API for all source parsing/writing — never Babel/regex on code.**
- **pnpm only.** Tests: `pnpm run studio:test <path>`. Full suite: `pnpm run studio:test`.
- **Conventional Commits**, scope: `studio/kit` (ComputerScene), `studio/canvas` (codeWriter/picker), `studio/inspector` (panel), `studio/generator` (CLAUDE.md.tpl + reference frame).
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Reparse-guard every write** — never persist unparseable TSX. `applyEditsToSource` already ends with `reparses(out)`; new write paths ride it.
- **Bind by message `id`, NEVER array index** — `data-arcade-bind="transcript[id=<id>].<field>"`. Survives reorder/delete.
- **Optional-field threading, not a discriminated union** — add `bindPath?: string` to the selection + edit records; existing source-coord paths are unchanged when `bindPath` is absent.
- **No regression on bare `<ComputerScene/>`** — `transcript` defaults to `SEED_TRANSCRIPT` AND the streaming signal must stop using array identity (Task 1) or `state="streaming"` breaks for populated frames.
- **Degrade, never crash** — a bind edit that can't resolve (id/field missing, no `transcript` array, reparse fail) → `{ok:false}` → existing agent-fallback. No silent-wrong.
- **v1 user promise: "retype a message"** — text-only inline edit of a bound leaf. Structure/attachment edits are out (agent path).

---

### Task 1: ComputerScene — streaming fix, `transcript` prop, bind stamping

**Files:**
- Modify: `studio/prototype-kit/composites/ComputerScene.tsx`
- Test: `studio/__tests__/prototype-kit/computerScene-transcript.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ComputerSceneProps` gains `transcript?: Message[]`; each seeded message's text + artefact title rendered inside a `<span data-arcade-bind="transcript[id=<id>].<field>">`.

**Context — current code (verified):**
- `SEED_TRANSCRIPT` is a module const (`:134`); `Message` type at `:124-132`: `{ id:number; role:"user"|"assistant"; text:string; artefact?:{tag:string; title:string} }`.
- `:215-216`: `const initialTranscript: Message[] = state === "empty" ? [] : SEED_TRANSCRIPT; const [messages, setMessages] = React.useState(initialTranscript);`
- `:253`: `const showStreaming = state === "streaming" && messages === SEED_TRANSCRIPT;` ← the identity check that breaks.
- `Transcript` renderer (`:462-501`) maps `messages` → `<ChatBubble>{m.text}</ChatBubble>` / `<ChatMessages.Agent>{m.text}{m.artefact?…}</ChatMessages.Agent>`.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/prototype-kit/computerScene-transcript.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ComputerScene } from "../../prototype-kit/composites/ComputerScene";

const TX = [
  { id: 1, role: "user" as const, text: "Custom first message" },
  { id: 2, role: "assistant" as const, text: "Custom reply", artefact: { tag: "DOC", title: "My Brief" } },
];

describe("ComputerScene transcript prop", () => {
  it("renders the passed transcript, not the baked seed", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    expect(container.textContent).toContain("Custom first message");
    expect(container.textContent).toContain("Custom reply");
    expect(container.textContent).not.toContain("Help me prep a marketing keynote");
  });
  it("stamps each seeded message's text with a data-arcade-bind by id", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    const m1 = container.querySelector('[data-arcade-bind="transcript[id=1].text"]');
    const m2 = container.querySelector('[data-arcade-bind="transcript[id=2].text"]');
    expect(m1?.textContent).toContain("Custom first message");
    expect(m2?.textContent).toContain("Custom reply");
  });
  it("stamps the artefact title with its own bind", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    const a = container.querySelector('[data-arcade-bind="transcript[id=2].artefact.title"]');
    expect(a?.textContent).toContain("My Brief");
  });
  it("bare ComputerScene still renders the seed (no regression)", () => {
    const { container } = render(<ComputerScene />);
    expect(container.textContent).toContain("Help me prep a marketing keynote");
  });
  it("state=empty renders no messages even with a transcript", () => {
    const { container } = render(<ComputerScene state="empty" transcript={TX} />);
    expect(container.textContent).not.toContain("Custom first message");
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`transcript` prop ignored; no bind attrs).

Run: `pnpm run studio:test __tests__/prototype-kit/computerScene-transcript.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the prop + fix streaming**

In `ComputerSceneProps` (the `type ComputerSceneProps = {…}` block), add after `sessions?: Session[];`:
```ts
  /** The chat transcript (messages). Defaults to the baked SEED_TRANSCRIPT.
   *  Lift this into the frame to make messages editable. */
  transcript?: Message[];
```
In the destructured params (`:199-210` region), add `transcript = SEED_TRANSCRIPT,`.
Change `:215-216` to seed from the prop:
```ts
  const initialTranscript: Message[] = state === "empty" ? [] : transcript;
  const [messages, setMessages] = React.useState<Message[]>(initialTranscript);
```
Replace the identity-based streaming signal (`:253`) with a non-identity one:
```ts
  // Streaming shows only while the transcript is still the initial seed (the
  // user hasn't typed). Compare LENGTH against the captured initial, not array
  // identity — a passed `transcript` prop is a different reference than the
  // module seed, so `=== SEED_TRANSCRIPT` would always be false for populated frames.
  const showStreaming = state === "streaming" && messages.length === initialTranscript.length;
```

- [ ] **Step 4: Stamp the binds in the `Transcript` renderer**

Pass the authored transcript's id set into `Transcript` so only SEEDED messages (not runtime-appended ones) get a bind. Update the call site (`:298`-region where `<Transcript .../>` or the body is rendered — find where `messages` feeds the body) to pass `boundIds={new Set(initialTranscript.map((m) => m.id))}`. Then wrap the text + artefact title:

```tsx
function Transcript({ messages, streaming, onOpenArtefact, boundIds }: {
  messages: Message[]; streaming: boolean; onOpenArtefact: () => void; boundIds: Set<number>;
}) {
  const bind = (id: number, field: string) =>
    boundIds.has(id) ? { "data-arcade-bind": `transcript[id=${id}].${field}` } : {};
  return (
    <ChatMessages>
      {messages.map((m) =>
        m.role === "user" ? (
          <ChatBubble key={m.id} variant="sender">
            <span {...bind(m.id, "text")}>{m.text}</span>
          </ChatBubble>
        ) : (
          <ChatMessages.Agent key={m.id} thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}>
            <span {...bind(m.id, "text")}>{m.text}</span>
            {m.artefact ? (
              <ArtefactCard
                tag={m.artefact.tag}
                title={<span {...bind(m.id, "artefact.title")}>{m.artefact.title}</span>}
                onOpen={onOpenArtefact}
              />
            ) : null}
            <ChatMessages.Actions />
          </ChatMessages.Agent>
        ),
      )}
      {streaming ? (/* …unchanged streaming block… */) : null}
    </ChatMessages>
  );
}
```
NOTE on the artefact title: `ArtefactCard`'s `title` prop must accept a `ReactNode` for the wrapped span. VERIFY `ArtefactCard.tsx`'s `title` type — if it's `string`-only, widen it to `React.ReactNode` (it's rendered as a child, so this is safe) and note it in the report. If widening is non-trivial, fall back to binding only the message `text` for v1 and record the artefact-title bind as deferred.

- [ ] **Step 5: Run the test — PASS.** Then verify no kit regression.

Run: `pnpm run studio:test __tests__/prototype-kit/computerScene-transcript.test.tsx`
Then: `pnpm run studio:test __tests__/prototype-kit` (if other ComputerScene tests exist, they must still pass — bare render unchanged).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/composites/ComputerScene.tsx studio/__tests__/prototype-kit/computerScene-transcript.test.tsx
# (+ studio/prototype-kit/composites/ArtefactCard.tsx if title was widened)
git commit -m "feat(studio/kit): ComputerScene transcript prop + id-keyed data-arcade-bind + streaming-signal fix"
```

---

### Task 2: `writeBindEdit` — the pure TS-AST array-by-id writer (core unit)

**Files:**
- Create: `studio/server/codeWriter/bindEdit.ts`
- Test: `studio/__tests__/server/codeWriter/bindEdit.test.ts` (new)

**Interfaces:**
- Consumes: `typescript`.
- Produces:
  - `export interface BindPath { array: string; id: number; field: string[] }`
  - `export function parseBindPath(bindPath: string): BindPath | null` — parse `transcript[id=2].text` / `transcript[id=2].artefact.title` → `{array:"transcript", id:2, field:["text"] | ["artefact","title"]}`; null on malformed.
  - `export function writeBindEdit(source: string, bindPath: string, newText: string): { ok: true; source: string } | { ok: false; reason: string }` — pure. Locate `const <array> = [ … ]`, find the element whose `id` property literal === `id`, walk `field` to its string-literal leaf, replace its text. Reparse-guard. No I/O.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/bindEdit.test.ts
import { describe, it, expect } from "vitest";
import { parseBindPath, writeBindEdit } from "../../../server/codeWriter/bindEdit";

const FRAME = `import { ComputerScene } from "arcade-prototypes";
const transcript = [
  { id: 1, role: "user", text: "First message" },
  { id: 2, role: "assistant", text: "Second message", artefact: { tag: "DOC", title: "Brief" } },
];
export default function F() {
  return <ComputerScene transcript={transcript} />;
}
`;

describe("parseBindPath", () => {
  it("parses a text path", () => {
    expect(parseBindPath("transcript[id=2].text")).toEqual({ array: "transcript", id: 2, field: ["text"] });
  });
  it("parses a nested path", () => {
    expect(parseBindPath("transcript[id=2].artefact.title")).toEqual({ array: "transcript", id: 2, field: ["artefact", "title"] });
  });
  it("rejects malformed", () => {
    expect(parseBindPath("garbage")).toBeNull();
    expect(parseBindPath("transcript[2].text")).toBeNull();
  });
});

describe("writeBindEdit", () => {
  it("edits a message's text by id (not position)", () => {
    const r = writeBindEdit(FRAME, "transcript[id=1].text", "Edited first");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain(`text: "Edited first"`);
      expect(r.source).not.toContain(`text: "First message"`);
      expect(r.source).toContain(`text: "Second message"`); // untouched
    }
  });
  it("edits a nested artefact title", () => {
    const r = writeBindEdit(FRAME, "transcript[id=2].artefact.title", "New Brief");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`title: "New Brief"`);
  });
  it("addresses by id after a reorder (id, not index)", () => {
    const reordered = FRAME.replace(
      /const transcript = \[[\s\S]*?\];/,
      `const transcript = [\n  { id: 2, role: "assistant", text: "Second message" },\n  { id: 1, role: "user", text: "First message" },\n];`,
    );
    const r = writeBindEdit(reordered, "transcript[id=1].text", "Edited first");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`text: "Edited first"`);
  });
  it("fails on a missing id", () => {
    expect(writeBindEdit(FRAME, "transcript[id=99].text", "x").ok).toBe(false);
  });
  it("fails on a missing field", () => {
    expect(writeBindEdit(FRAME, "transcript[id=1].nope", "x").ok).toBe(false);
  });
  it("fails when there is no transcript array (bare frame)", () => {
    const bare = `export default () => <ComputerScene />;`;
    expect(writeBindEdit(bare, "transcript[id=1].text", "x").ok).toBe(false);
  });
  it("escapes the value so a quote can't break parse", () => {
    const r = writeBindEdit(FRAME, "transcript[id=1].text", 'He said "hi"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ts = require("typescript");
      const sf = ts.createSourceFile("f.tsx", r.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      expect((sf as any).parseDiagnostics?.length ?? 0).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run it — FAIL** (module not found).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `bindEdit.ts`**

```ts
// studio/server/codeWriter/bindEdit.ts
import ts from "typescript";

export interface BindPath { array: string; id: number; field: string[] }

/** Parse `transcript[id=2].text` / `transcript[id=2].artefact.title`. null on malformed. */
export function parseBindPath(bindPath: string): BindPath | null {
  const m = /^([A-Za-z_$][\w$]*)\[id=(\d+)\]\.(.+)$/.exec(bindPath);
  if (!m) return null;
  const field = m[3].split(".").filter(Boolean);
  if (field.length === 0) return null;
  return { array: m[1], id: Number(m[2]), field };
}

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

/** Find the `const <name> = [ … ]` array literal initializer anywhere in the file. */
function findArrayLiteral(sf: ts.SourceFile, name: string): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) found = node.initializer;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** Within an object literal, the property assignment for `key` (string/numeric/ident name). */
function propByName(obj: ts.ObjectLiteralExpression, key: string): ts.PropertyAssignment | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText().replace(/['"]/g, "") === key) return p;
  }
  return null;
}

export function writeBindEdit(
  source: string, bindPath: string, newText: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  const parsed = parseBindPath(bindPath);
  if (!parsed) return { ok: false, reason: "bad-bindpath" };
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const arr = findArrayLiteral(sf, parsed.array);
  if (!arr) return { ok: false, reason: "array-not-found" };

  // Find the element object whose `id` numeric literal === parsed.id.
  let target: ts.ObjectLiteralExpression | null = null;
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const idProp = propByName(el, "id");
    if (idProp && ts.isNumericLiteral(idProp.initializer) && Number(idProp.initializer.text) === parsed.id) {
      target = el;
      break;
    }
  }
  if (!target) return { ok: false, reason: "id-not-found" };

  // Walk the field path: all but the last must be nested object literals.
  let obj: ts.ObjectLiteralExpression = target;
  for (let i = 0; i < parsed.field.length - 1; i++) {
    const p = propByName(obj, parsed.field[i]);
    if (!p || !ts.isObjectLiteralExpression(p.initializer)) return { ok: false, reason: "field-not-object" };
    obj = p.initializer;
  }
  const leafKey = parsed.field[parsed.field.length - 1];
  const leaf = propByName(obj, leafKey);
  if (!leaf || !ts.isStringLiteral(leaf.initializer)) return { ok: false, reason: "leaf-not-string" };

  // Replace the leaf string-literal value (incl. quotes) with a JSON-encoded
  // double-quoted string so embedded quotes/newlines can't break parse.
  const start = leaf.initializer.getStart(sf);
  const end = leaf.initializer.getEnd();
  const encoded = JSON.stringify(newText);
  const out = source.slice(0, start) + encoded + source.slice(end);

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
```

- [ ] **Step 4: Run the test — PASS** (all cases, incl. reorder-by-id + quote escaping).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/codeWriter/bindEdit.ts studio/__tests__/server/codeWriter/bindEdit.test.ts
git commit -m "feat(studio/canvas): writeBindEdit — edit a frame transcript array entry by message id (TS-AST)"
```

---

### Task 3: Thread `bindPath` through the edit payload + codeWriter dispatch

**Files:**
- Modify: `studio/src/lib/visualEditClient.ts` (add `bindPath?` to `ElementEdit` + `buildSingleEdit`)
- Modify: `studio/server/codeWriter/index.ts` (dispatch a bind edit before the JSX text path)
- Test: `studio/__tests__/server/codeWriter/bindEdit-dispatch.test.ts` (new)

**Interfaces:**
- Consumes: `writeBindEdit` (T2).
- Produces: `ElementEdit` gains `bindPath?: string`; `applyEditsToSource` routes to `writeBindEdit` when `edit.bindPath` is set (text-only).

**Context (verified):** `ElementEdit` is `{ file; line; column; text?; fields; iconSwap? }` in BOTH `src/lib/visualEditClient.ts:5-8` and `server/codeWriter/index.ts:11-14` (two declarations, keep them in sync). `applyEditsToSource` (`index.ts:28`) handles `iconSwap` → prop: → class → text, then `reparses`. `buildSingleEdit(sel, field, value, frameSlug)` builds a one-edit payload.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/codeWriter/bindEdit-dispatch.test.ts
import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

const FRAME = `const transcript = [
  { id: 1, role: "user", text: "First message" },
];
export default () => <ComputerScene transcript={transcript} />;
`;

describe("applyEditsToSource — bindPath edit", () => {
  it("routes a bindPath text edit to writeBindEdit", () => {
    const r = applyEditsToSource(FRAME, {
      file: "frames/x/index.tsx", line: 1, column: 1,
      bindPath: "transcript[id=1].text", text: "Edited", fields: [],
    } as any);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain(`text: "Edited"`); expect(r.source).not.toContain(`"First message"`); }
  });
  it("a non-resolving bindPath fails (agent fallback upstream)", () => {
    const r = applyEditsToSource(FRAME, {
      file: "frames/x/index.tsx", line: 1, column: 1,
      bindPath: "transcript[id=99].text", text: "X", fields: [],
    } as any);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`bindPath` ignored → falls to text path → element-not-found / wrong).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `bindPath?` to both `ElementEdit` declarations + `buildSingleEdit`**

In `studio/src/lib/visualEditClient.ts`:
```ts
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
  /** When set, this edit targets a frame DATA binding (e.g. a ComputerScene
   *  transcript message), not a JSX node. `text` carries the new string. */
  bindPath?: string;
}
```
And in `buildSingleEdit` (find it in the same file), when the field is the special `"bindText"` field, set `bindPath` from the selection. Add a dedicated builder instead of overloading — cleaner:
```ts
export function buildBindEdit(bindPath: string, value: string, frameSlug: string): VisualEditPayload {
  return { frameSlug, edits: [{ file: "", line: 0, column: 0, bindPath, text: value, fields: [] }] };
}
```

In `studio/server/codeWriter/index.ts`, mirror the `bindPath?: string` field on its `ElementEdit` interface (`:11-14`).

- [ ] **Step 4: Dispatch in `applyEditsToSource`**

At the TOP of `applyEditsToSource` (right after `if (edit.iconSwap) return {ok:false, reason:"icon-swap"}` or as the first branch), add:
```ts
import { writeBindEdit } from "./bindEdit";
// …
  // Frame-DATA binding edit (e.g. a transcript message). Bypasses JSX location
  // entirely — targets the named const array by message id.
  if (edit.bindPath) {
    if (typeof edit.text !== "string") return { ok: false, reason: "bind-no-text" };
    const r = writeBindEdit(source, edit.bindPath, edit.text);
    return r.ok ? { ok: true, source: r.source } : { ok: false, reason: r.reason };
  }
```
(It returns directly — a bind edit is standalone, not batched with class/text edits on the same element.)

- [ ] **Step 5: Run the test — PASS.** Then the codeWriter suite (no regression).

Run: `pnpm run studio:test __tests__/server/codeWriter/bindEdit-dispatch.test.ts __tests__/server/codeWriter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/visualEditClient.ts studio/server/codeWriter/index.ts studio/__tests__/server/codeWriter/bindEdit-dispatch.test.ts
git commit -m "feat(studio/canvas): route bindPath edits to writeBindEdit in the visual-edit batch"
```

---

### Task 4: Picker bind-first resolve + `bindPath` on the selection

**Files:**
- Modify: `studio/src/frame/picker.ts` (read `[data-arcade-bind]` first; add `bindPath?` to `PickerSelection`)
- Modify: `studio/src/hooks/editSessionContext.tsx` (add `bindPath?` to `ElementSelection`)
- Test: `studio/__tests__/frame/picker-bind.test.ts` (new) — pure helper test

**Interfaces:**
- Produces: a clicked node under `[data-arcade-bind]` yields a selection carrying `bindPath`; unbound clicks unchanged.

**Context (verified):** `picker.ts` `onClick` (`:175-202`): `const target = e.target`; `getFiberFromNode` → `resolveSelection` → `postCancel("no-source")` when not in a frame source. `PickerSelection` (`:24-35`) is `{editId,file,line,column,componentName,tagName,textEditable,styles,iconCandidate?,ownerChain}`.

- [ ] **Step 1: Write the failing test (pure helper)**

Extract the bind-read as a pure function so it's unit-testable without a DOM picker harness.

```ts
// studio/__tests__/frame/picker-bind.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readBindPath } from "../../src/frame/bindRead";

describe("readBindPath", () => {
  it("reads the bind off the clicked node", () => {
    const el = document.createElement("span");
    el.setAttribute("data-arcade-bind", "transcript[id=2].text");
    expect(readBindPath(el)).toBe("transcript[id=2].text");
  });
  it("reads the bind off an ancestor", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-arcade-bind", "transcript[id=3].text");
    const inner = document.createElement("b");
    outer.appendChild(inner);
    expect(readBindPath(inner)).toBe("transcript[id=3].text");
  });
  it("returns null when no bind ancestor", () => {
    expect(readBindPath(document.createElement("p"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — FAIL** (module not found).

Run: `pnpm run studio:test __tests__/frame/picker-bind.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the pure helper**

```ts
// studio/src/frame/bindRead.ts
/** The bind path of the nearest [data-arcade-bind] ancestor (or self), or null. */
export function readBindPath(el: Element | null): string | null {
  const bound = el?.closest?.("[data-arcade-bind]");
  return bound?.getAttribute("data-arcade-bind") ?? null;
}
```

- [ ] **Step 4: Wire into the picker + selection types**

In `picker.ts`: add `bindPath?: string;` to `PickerSelection`. In `onClick`, BEFORE `getFiberFromNode`:
```ts
import { readBindPath } from "./bindRead";
// … inside onClick, after the overlay-element guard:
  const bindPath = readBindPath(target);
  if (bindPath) {
    // Bound node: still capture the fiber/source for the selection envelope when
    // possible (for the editId/styles), but carry the bindPath so the edit routes
    // to the data writer instead of JSX location.
    const fiber = getFiberFromNode(target);
    const sel = fiber ? resolveSelection(fiber, target as HTMLElement) : null;
    overlay.showSelection(target as HTMLElement);
    postPicked({
      ...(sel ?? makeBareSelection(target as HTMLElement)),
      bindPath,
    });
    return;
  }
```
Where `makeBareSelection` builds a minimal `PickerSelection` (new editId, `file:""`, `line:0`, `column:0`, `componentName` from the tag, `tagName`, `textEditable:true`, `styles` from `capture(target)`, `ownerChain:[]`) — needed because a composite-internal node's `resolveSelection` returns null (the very reason this feature exists). Implement `makeBareSelection` next to `resolveSelection`; reuse `capture()` for styles and the editId counter.

In `editSessionContext.tsx`: add `bindPath?: string;` to `ElementSelection` (`:25-35`).

- [ ] **Step 5: Run the helper test — PASS.** Then build-check the picker compiles.

Run: `pnpm run studio:test __tests__/frame/picker-bind.test.ts`
Then: `pnpm run studio:test __tests__/frame` (any existing picker tests still pass).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/frame/bindRead.ts studio/src/frame/picker.ts studio/src/hooks/editSessionContext.tsx studio/__tests__/frame/picker-bind.test.ts
git commit -m "feat(studio/canvas): picker reads data-arcade-bind and carries bindPath on the selection"
```

---

### Task 5: Bound commit path in the panel (text edit → writeBindEdit)

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx` (`applyFieldEdit` bind branch)
- Test: `studio/__tests__/components/panel-bind-edit.test.tsx` (new)

**Interfaces:**
- Consumes: `buildBindEdit` (T3), selection `bindPath` (T4).
- Produces: a settled text edit on a bound selection POSTs a bind edit (not the `isInFrame`/`locateJsx` path).

**Context (verified):** `applyFieldEdit(sel, field, value)` (`:247-274`) gates `if (!targetFrame || !isInFrame(sel.file, targetFrame)) return;` then `postVisualEdit(slug, buildSingleEdit(...))`. The in-frame text edit arrives via the `text-changed` message → `scheduleApply(sel, "text", value)` → `applyFieldEdit`.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/panel-bind-edit.test.tsx
import { describe, it, expect, vi } from "vitest";
import { buildBindEdit } from "../../src/lib/visualEditClient";

describe("buildBindEdit payload", () => {
  it("builds a bindPath edit carrying the new text", () => {
    const p = buildBindEdit("transcript[id=2].text", "Hello", "01-computer");
    expect(p.frameSlug).toBe("01-computer");
    expect(p.edits[0].bindPath).toBe("transcript[id=2].text");
    expect(p.edits[0].text).toBe("Hello");
    expect(p.edits[0].fields).toEqual([]);
  });
});
```
(The full panel-routing behavior is exercised by the manual gate + the dispatch test in T3; this unit pins the payload builder. If the existing panel test harness supports simulating a `text-changed` on a bound selection cleanly, add that too — but do not fight the harness.)

- [ ] **Step 2: Run it — FAIL** (`buildBindEdit` not found if T3's builder wasn't imported here).

Run: `pnpm run studio:test __tests__/components/panel-bind-edit.test.tsx`
Expected: FAIL (or PASS if T3 exported it — then this is a guard).

- [ ] **Step 3: Add the bind branch to `applyFieldEdit`**

At the TOP of `applyFieldEdit`, before the `isInFrame` gate:
```ts
import { buildBindEdit } from "../../lib/visualEditClient";
// …
  async function applyFieldEdit(sel: EditedElement["selection"], field: string, value: string) {
    const targetFrame = frameSlug ?? "";
    // Bound data edit (e.g. a ComputerScene transcript message): route to the
    // data writer by bindPath, bypassing the JSX-source gate entirely.
    if (sel.bindPath && field === "text") {
      if (!targetFrame) return;
      const det = await postVisualEdit(slug, buildBindEdit(sel.bindPath, value, targetFrame));
      if (det.ok) {
        addBlock({ label: humanLabel("text", value), kind: "instant", status: "applied", frameSlug: targetFrame });
        resetField(sel.editId, field as any);
      } else {
        // Bind couldn't resolve (bare frame / id gone) → scoped agent ask.
        askAiForBind(sel, value); // see Step 4
      }
      return;
    }
    // …existing isInFrame path unchanged…
```

- [ ] **Step 4: Add the agent fallback for a failed bind**

```ts
  function askAiForBind(sel: EditedElement["selection"], value: string) {
    onSend(`In frames/${frameSlug}/index.tsx, change the message bound to ${sel.bindPath} to: "${value}".`);
  }
```
(Graceful degrade — matches the existing "can't map → agent" pattern.)

- [ ] **Step 5: Run the test + the components suite**

Run: `pnpm run studio:test __tests__/components/panel-bind-edit.test.tsx __tests__/components`
Expected: PASS (no regression to existing panel tests — the bind branch only fires when `sel.bindPath` is set).

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/panel-bind-edit.test.tsx
git commit -m "feat(studio/inspector): route a bound text edit to writeBindEdit, agent-fallback on miss"
```

---

### Task 6: Generator default flip — populated form + reference frame + Message shape

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl` (ComputerScene guidance → populated default + Message shape)
- Modify: the seeded reference frame source (`studio/server/projects.ts` seed, or wherever `00-computer-reference` is authored — VERIFY)
- Test: `studio/__tests__/server/generator-policy.test.ts` (new) — asserts the policy text contains the populated form + the Message shape

**Interfaces:** documentation/policy only — no runtime API.

**Context (verified):** `templates/CLAUDE.md.tpl` currently shows `return <ComputerScene />;` as the canonical example (~:282) and tells the agent to copy the bare `00-computer-reference` frame (~:293-300). The KIT-MANIFEST auto-extracts `ComputerSceneProps` but NOT the separate `Message` type — so the agent never sees `{id, role, text, artefact?}` unless it's inlined into the policy.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/generator-policy.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TPL = readFileSync(path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"), "utf-8");

describe("generator policy — ComputerScene populated default", () => {
  it("documents the transcript-as-frame-data form", () => {
    expect(TPL).toMatch(/transcript\s*=\s*\[/);
    expect(TPL).toMatch(/<ComputerScene\s+transcript=\{transcript\}/);
  });
  it("inlines the Message shape so the agent emits the right objects", () => {
    expect(TPL).toContain("id");
    expect(TPL).toMatch(/role:\s*["']user["']\s*\|\s*["']assistant["']|role: "user"/);
    expect(TPL).toContain("artefact");
  });
});
```

- [ ] **Step 2: Run it — FAIL** (tpl still bare-only).

Run: `pnpm run studio:test __tests__/server/generator-policy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `CLAUDE.md.tpl`** — replace the ComputerScene guidance block so the POPULATED form is the documented default for an editable chat. Add:

```md
### ComputerScene — populate the transcript as frame data

When the prototype is a Computer/Agent chat the designer will want to EDIT,
author the conversation as a frame-level `const` and pass it, so messages live
in the frame (editable in place) rather than baked in the kit:

    const transcript = [
      { id: 1, role: "user", text: "…the user's first message…" },
      { id: 2, role: "assistant", text: "…the agent's reply…",
        artefact: { tag: "DOC", title: "…optional attachment title…" } },
      { id: 3, role: "user", text: "…" },
    ];
    export default function Frame() {
      return <ComputerScene transcript={transcript} />;
    }

Message shape: `{ id: number; role: "user" | "assistant"; text: string;
artefact?: { tag: string; title: string } }`. Give each message a unique stable
`id`. Bare `<ComputerScene />` is only for a throwaway scaffold the designer
won't edit.
```
Keep the existing counterexamples (don't wrap in ComputerPage, etc.).

- [ ] **Step 4: Update the seeded reference frame** to the populated form (so "copy the reference" yields editable data). Find where `00-computer-reference` is authored (grep `00-computer-reference` / `ComputerReference` in `server/projects.ts` + the seed assets). Replace its body with a `const transcript = [ …the 4 seed messages… ]; return <ComputerScene transcript={transcript} />;`. If the reference frame is a static asset file rather than generated, edit that file. VERIFY the location and note it in the report.

- [ ] **Step 5: Run the policy test + confirm the reference frame parses**

Run: `pnpm run studio:test __tests__/server/generator-policy.test.ts`
Expected: PASS. Manually confirm the edited reference frame is valid TSX (it renders the same scene, now via the prop).

- [ ] **Step 6: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl studio/__tests__/server/generator-policy.test.ts
# + the reference frame file path you found
git commit -m "feat(studio/generator): default ComputerScene to populated transcript-as-frame-data + inline Message shape"
```

---

### Task 7: Full suite + manual gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: green except KNOWN pre-existing unrelated failures on this branch base (figmaIngest, figmaBridge/wsServer — confirm any failure is one of those, not new, via `git stash`/re-run only if a NEW failure appears). The two `✘ ERROR` esbuild lines elsewhere are intentional broken-frame test FIXTURES.

- [ ] **Step 2: Confirm the dev server config still loads**

Run: `node -e 'require("vite").loadConfigFromFile({command:"serve",mode:"development"},"studio/vite.config.ts").then(()=>console.log("CONFIG OK")).catch(e=>{console.error(e.message);process.exit(1)})'`
Expected: `CONFIG OK`.

- [ ] **Step 3: Manual gate (HUMAN — the user runs it)**

Full restart required (Vite middleware doesn't hot-reload): quit `pnpm run studio`, restart.
1. Generate a Computer chat prototype ("a Computer chat screen about planning a launch"). Confirm the generated frame's `index.tsx` contains `const transcript = [...]` and `<ComputerScene transcript={transcript}/>` (the generator flipped to the populated form).
2. Click a chat message bubble → it becomes editable inline → retype it → it changes and persists. No LLM, no "couldn't target" toast.
3. Reselect the SAME message → edit again → works (id-addressed, not stale).
4. The scene stays interactive: click a sidebar session (switches), type in the command bar (streams a reply).
5. Click the "Q3 launch brief" artefact title → editable too (if the artefact-title bind shipped in T1; if deferred, note it).
PASS = messages are click-to-edit, deterministic, persist, scene stays live. This is the exact thing six prior approaches couldn't do.

- [ ] **Step 4: No commit** (verification). On PASS, proceed to the whole-branch review (subagent-driven-development's final review), then `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Streaming-signal fix → T1 (prerequisite, tested). ✓
- `transcript` prop + id-keyed bind stamping + state×transcript → T1. ✓
- `writeBindEdit` by id (not index), reparse-guard, quote-escape → T2. ✓
- bindPath threaded as optional field + dispatch → T3. ✓
- Picker bind-first + bindPath on selection (+ bare selection for composite-internal nodes) → T4. ✓
- Bound commit path (bypass isInFrame/locateJsx) + agent fallback → T5. ✓
- Generator default flip + reference frame + inline Message shape → T6. ✓
- Full suite + manual gate → T7. ✓
- Per-element styling, structure UI, other composites → out of scope (spec + plan agree). ✓

**Placeholder scan:** every code step has complete code; the two VERIFY points (ArtefactCard title type in T1; reference-frame file location in T6) are stated with concrete fallbacks, not TODOs.

**Type consistency:** `bindPath` is the same field name on `PickerSelection` (T4), `ElementSelection` (T4), `ElementEdit` (T3, both client+server copies). `BindPath`/`parseBindPath`/`writeBindEdit` (T2) consumed by T3's dispatch + T5's payload via `buildBindEdit`. `data-arcade-bind="transcript[id=<id>].<field>"` format identical in T1 (stamp), T2 (parse), T4 (read). `buildBindEdit` defined in T3, used in T5.

**Decision noted for the reviewer:** the spec described a discriminated-union selection refactor across ~8 consumers; this plan instead threads an OPTIONAL `bindPath?` field (matching the codebase's `text?`/`iconSwap?` idiom), so only the picker (T4), the commit router (T5), and the codeWriter dispatch (T3) branch on it. Same behavior, smaller blast radius for the text-only v1. If a reviewer considers the union mandatory, that's a plan-vs-spec call to raise.
