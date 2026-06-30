# Predictable Editing Redesign (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make panel editing predictable and honest — instant deterministic edits self-apply (no Commit, no spinner) as done-with-Undo blocks in the chat panel; only un-mappable edits become pending AI Apply/Discard blocks — and expand deterministic coverage so width/size/any px apply instantly via Tailwind arbitrary values.

**Architecture:** Extend the existing className code-writer to emit Tailwind arbitrary values (`w-[300px]`) so nearly every numeric/color/font edit is deterministic. Each edit writes immediately through `/api/visual-edit` after pushing a per-frame undo snapshot (new LIFO stack + `/api/edit-undo`). A new client `EditBlocks` context records every change as a block; the inspector's `change()` is rewritten to write-on-edit and emit blocks (the Commit button is removed); the chat panel renders the block stream with Undo / Apply / Discard. Plus two defect fixes: clearable number inputs and a reachable Customize chip.

**Tech Stack:** TypeScript (TS compiler API already used — NOT Babel), React (inspector + chat panel), Vite middleware, Vitest. Tailwind v4 (arbitrary-value classes).

## Global Constraints

- **Package manager is pnpm.** Tests run via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`), never `npm`/`yarn`.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/canvas`.
- **Vite middleware does NOT hot-reload** — editing `server/middleware/*` or `vite.config.ts` needs an app restart to test live; unit tests don't.
- **Emit only Tailwind utility classes / arcade-gen tokens** — never raw hex or inline `style` props. Off-scale numeric values use Tailwind arbitrary-value syntax (`w-[300px]`, `p-[18px]`, `text-[15px]`, `opacity-[0.37]`).
- **Never write un-parseable TSX:** every server write re-parses and aborts (file untouched) on failure — reuse the reparse-guard pattern `(sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics`.
- **Path safety:** disk writes resolve through `frameDir(projectSlug, frameSlug)` (`server/paths.ts`) and stay inside the project dir.
- **No Commit button.** Instant (deterministic) edits self-apply → an `applied` block with Undo. Only AI-needed edits are `pending` blocks with Apply/Discard. "Applied" always means "written to code."
- **Undo = per-change file snapshots, LIFO.** Snapshot the frame `index.tsx` BEFORE each applied write (deterministic and AI); Undo pops + restores the top.
- **Debounce the write, not the preview.** Live preview is immediate per keystroke/drag; the deterministic file write + snapshot fires on commit (blur / slider release / Enter), once per settled value — never per intermediate value.
- **Out of scope (later phases):** on-canvas resize/move handles; reverse-patch / out-of-order undo; absolute x/y.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/server/codeWriter/pxScale.ts` | emit arbitrary `[..]` values; sizing fields stop bailing | 1 |
| `studio/server/codeWriter/classFamily.ts` | add `w-`/`h-`/`min/max` + `text-[..]` size families so arbitrary values swap | 1 |
| `studio/server/editHistory.ts` | LIFO per-frame undo snapshot stack | 2 |
| `studio/server/middleware/editUndo.ts` | `POST /api/edit-undo/:slug` | 2 |
| `studio/server/middleware/visualEdit.ts` | push undo snapshot before each write | 2 |
| `studio/vite.config.ts` | register editUndo middleware | 2 |
| `studio/src/lib/visualEditClient.ts` | single-field edit payload + `postEditUndo` | 3 |
| `studio/src/hooks/editBlocksContext.tsx` | client block-stream state (applied/pending/working) | 4 |
| `studio/src/components/inspector/inspectorControls.tsx` | clearable text NumberField (defect #1) | 5 |
| `studio/src/frame/overlay/overlays.ts` | reachable Customize chip (defect #4) | 6 |
| `studio/src/components/inspector/InspectorPanel.tsx` | write-on-edit, emit blocks, REMOVE Commit | 7 |
| `studio/src/components/chat/EditBlockRow.tsx` | render a block (Undo / Apply / Discard) | 8 |
| `studio/src/components/chat/MessageList.tsx` | render the block stream inline | 8 |
| `studio/src/routes/ProjectDetail.tsx` | wrap in EditBlocksProvider; pass apply handler | 8 |

**Shared types** (Task 4, `editBlocksContext.tsx`; consumed by 7 + 8):

```ts
export type EditBlockKind = "instant" | "ai";
export type EditBlockStatus = "applied" | "pending" | "working" | "error" | "undone";
export interface EditBlock {
  id: string;            // stable per block
  label: string;         // human text, e.g. "padding → 24" / "make this responsive"
  kind: EditBlockKind;
  status: EditBlockStatus;
  frameSlug: string;
}
```

---

## Task 1: Deterministic coverage — arbitrary Tailwind values + sizing families

**Files:**
- Modify: `studio/server/codeWriter/pxScale.ts`
- Modify: `studio/server/codeWriter/classFamily.ts`
- Test: `studio/__tests__/server/codeWriter/pxScale-arbitrary.test.ts`
- Test: `studio/__tests__/server/codeWriter/classFamily-sizing.test.ts`

**Interfaces:**
- Consumes: existing `translateField`, `SPACE_FIELDS`, `pxToSpace`, `pxToRadius`; existing `familyRegexFor`, `applyClass`.
- Produces: `translateField` returns a class for ALL numeric/color/font fields (arbitrary `[..]` when off-scale), only returning `null` for truly non-expressible cases; `familyRegexFor` recognizes `w-`/`h-`/`min-w-`/`max-w-`/`min-h-`/`max-h-`/`text-[..]` families.

- [ ] **Step 1: Write the failing tests**

```ts
// studio/__tests__/server/codeWriter/pxScale-arbitrary.test.ts
import { describe, it, expect } from "vitest";
import { translateField } from "../../../server/codeWriter/pxScale";

describe("translateField arbitrary values", () => {
  it("snaps spacing to a scale step when exact", () => {
    expect(translateField("paddingTop", "24px")).toBe("pt-6");
  });
  it("emits an arbitrary spacing value when off-scale", () => {
    expect(translateField("paddingTop", "18px")).toBe("pt-[18px]");
    expect(translateField("gap", "7px")).toBe("gap-[7px]");
  });
  it("emits width/height as arbitrary values (no longer bails)", () => {
    expect(translateField("width", "300px")).toBe("w-[300px]");
    expect(translateField("height", "48px")).toBe("h-[48px]");
    expect(translateField("minWidth", "120px")).toBe("min-w-[120px]");
    expect(translateField("maxWidth", "640px")).toBe("max-w-[640px]");
    expect(translateField("minHeight", "40px")).toBe("min-h-[40px]");
    expect(translateField("maxHeight", "80px")).toBe("max-h-[80px]");
  });
  it("emits font size as arbitrary value", () => {
    expect(translateField("fontSize", "15px")).toBe("text-[15px]");
  });
  it("emits opacity arbitrary when off the /5 step", () => {
    expect(translateField("opacity", "0.5")).toBe("opacity-50");   // on step
    expect(translateField("opacity", "0.37")).toBe("opacity-[0.37]"); // off step
  });
  it("snaps radius to scale or emits arbitrary", () => {
    expect(translateField("borderRadius", "6px")).toBe("rounded-md");
    expect(translateField("borderRadius", "5px")).toBe("rounded-[5px]");
  });
  it("still bails (null) for non-px junk on a numeric field", () => {
    expect(translateField("width", "auto")).toBeNull();
    expect(translateField("paddingTop", "")).toBeNull();
  });
  it("keeps enum fields as-is (display/flexDirection not numeric)", () => {
    // display/flexDirection are written as raw enum classes elsewhere; translateField
    // returns null for them so the caller routes them through its enum path.
    expect(translateField("display", "flex")).toBeNull();
  });
});
```

```ts
// studio/__tests__/server/codeWriter/classFamily-sizing.test.ts
import { describe, it, expect } from "vitest";
import { applyClass, familyRegexFor } from "../../../server/codeWriter/classFamily";

describe("sizing families", () => {
  it("recognizes width/height families incl. arbitrary values", () => {
    expect(familyRegexFor("w-[300px]")!.test("w-64")).toBe(true);
    expect(familyRegexFor("w-[300px]")!.test("w-[200px]")).toBe(true);
    expect(familyRegexFor("w-[300px]")!.test("h-10")).toBe(false);
    expect(familyRegexFor("h-[48px]")!.test("h-12")).toBe(true);
    expect(familyRegexFor("min-w-[120px]")!.test("min-w-0")).toBe(true);
    expect(familyRegexFor("max-w-[640px]")!.test("max-w-full")).toBe(true);
  });
  it("recognizes the font-size family (text-[..] vs scale)", () => {
    expect(familyRegexFor("text-[15px]")!.test("text-sm")).toBe(true);
    expect(familyRegexFor("text-[15px]")!.test("text-[20px]")).toBe(true);
    // must NOT collide with token color text-(--..) or align text-center or type text-body
    expect(familyRegexFor("text-[15px]")!.test("text-(--fg-muted)")).toBe(false);
    expect(familyRegexFor("text-[15px]")!.test("text-center")).toBe(false);
    expect(familyRegexFor("text-[15px]")!.test("text-body-md")).toBe(false);
  });
  it("swaps an arbitrary width over an existing one", () => {
    expect(applyClass("flex w-64", "w-[300px]")).toBe("flex w-[300px]");
    expect(applyClass("w-[200px] gap-2", "w-[300px]")).toBe("gap-2 w-[300px]");
  });
  it("swaps an arbitrary spacing over a scale step", () => {
    expect(applyClass("pt-4 text-sm", "pt-[18px]")).toBe("text-sm pt-[18px]");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/codeWriter/pxScale-arbitrary.test.ts __tests__/server/codeWriter/classFamily-sizing.test.ts`
Expected: FAIL — width/fontSize return null today; w-/h-/text-size families unknown.

- [ ] **Step 3: Extend `pxScale.ts`**

Add sizing prefixes and an arbitrary-value fallback. Replace the body of `translateField` so numeric fields emit arbitrary values instead of bailing:

```ts
// add near SIDE_PREFIX
const SIZE_PREFIX: Record<string, string> = {
  width: "w", height: "h", minWidth: "min-w", maxWidth: "max-w",
  minHeight: "min-h", maxHeight: "max-h",
};
const SIZE_FIELDS: ReadonlySet<string> = new Set(Object.keys(SIZE_PREFIX));
```

Then in `translateField`, after the existing `SPACE_FIELDS` block change it to fall through to an arbitrary value instead of returning null, and add the new blocks:

```ts
export function translateField(field: string, value: string): string | null {
  if (SPACE_FIELDS.has(field)) {
    const n = px(value);
    if (n === null) return null;            // non-px junk → bail
    const step = pxToSpace(n);
    return step !== null ? `${SIDE_PREFIX[field]}-${step}` : `${SIDE_PREFIX[field]}-[${n}px]`;
  }
  if (SIZE_FIELDS.has(field)) {
    const n = px(value);
    if (n === null) return null;
    return `${SIZE_PREFIX[field]}-[${n}px]`;  // sizing: always arbitrary (scale steps are rare/ambiguous)
  }
  if (field === "fontSize") {
    const n = px(value);
    if (n === null) return null;
    return `text-[${n}px]`;
  }
  if (field === "borderRadius") {
    const n = px(value);
    if (n === null) return null;
    const r = pxToRadius(n);
    if (r !== null) return r === "" ? "rounded" : `rounded-${r}`;
    return `rounded-[${n}px]`;
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
    if (pct < 0 || pct > 100) return null;
    return pct % 5 === 0 ? `opacity-${pct}` : `opacity-[${f}]`;
  }
  // display / flexDirection are enum classes handled by the caller's enum path.
  return null;
}
```

- [ ] **Step 4: Extend `classFamily.ts`**

Add sizing + font-size families. `perSideFamily` already handles `[pm][trbl]`/`gap`; add a sizing matcher and a `text-[..]` family. The key correctness point: the font-size arbitrary family (`text-[..]`) must NOT collide with token color (`text-(--..)`), align (`text-center`), or type style (`text-body-md`).

```ts
// in familyRegexFor, BEFORE the generic FAMILIES loop:
function sizingFamily(targetClass: string): RegExp | null {
  const m = /^(min-w|max-w|min-h|max-h|w|h)-/.exec(targetClass);
  if (!m) return null;
  return new RegExp(`^${m[1]}-`);
}
// font-size arbitrary: text-[..] only (brackets), distinct from text-( / text-word
function fontSizeFamily(targetClass: string): RegExp | null {
  return /^text-\[/.test(targetClass) ? /^text-(\[|sm$|base$|lg$|xl$|[0-9])/ : null;
}
```

Wire them into `familyRegexFor` (after `perSideFamily`, before the FAMILIES loop):

```ts
export function familyRegexFor(targetClass: string): RegExp | null {
  const perSide = perSideFamily(targetClass);
  if (perSide) return perSide;
  const sizing = sizingFamily(targetClass);
  if (sizing) return sizing;
  const fontSize = fontSizeFamily(targetClass);
  if (fontSize) return fontSize;
  for (const { when, family } of FAMILIES) {
    if (when.test(targetClass)) return family;
  }
  return null;
}
```

> Note for the implementer: the `fontSizeFamily` regex must match Tailwind text-size utilities (`text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-[15px]`) but NOT `text-(--fg-..)`, `text-center/left/right/justify`, or `text-body/title/...`. The test in Step 1 pins these exact cases — make the regex satisfy the test; widen only as the test requires. If `text-2xl`-style multi-char suffixes need matching, extend the alternation to cover them while still excluding the three forbidden forms.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/codeWriter/pxScale-arbitrary.test.ts __tests__/server/codeWriter/classFamily-sizing.test.ts`
Expected: PASS. Then run the whole codeWriter suite to confirm no Phase-A regression: `pnpm run studio:test __tests__/server/codeWriter` — Expected: PASS (the prior pxScale/classFamily tests still hold; on-scale values still snap).

- [ ] **Step 6: Commit**

```bash
git add studio/server/codeWriter/pxScale.ts studio/server/codeWriter/classFamily.ts studio/__tests__/server/codeWriter/pxScale-arbitrary.test.ts studio/__tests__/server/codeWriter/classFamily-sizing.test.ts
git commit -m "feat(studio/canvas): emit Tailwind arbitrary values so width/size/off-scale apply deterministically"
```

---

## Task 2: Undo snapshot stack + endpoint

**Files:**
- Create: `studio/server/editHistory.ts`
- Create: `studio/server/middleware/editUndo.ts`
- Modify: `studio/server/middleware/visualEdit.ts` (push snapshot before write)
- Modify: `studio/vite.config.ts` (register editUndo)
- Test: `studio/__tests__/server/editHistory.test.ts`
- Test: `studio/__tests__/server/editUndo.test.ts`

**Interfaces:**
- Consumes: `frameDir` (`server/paths.ts`).
- Produces:
  - `editHistory.ts`: `pushSnapshot(slug, frameSlug, source: string): void`, `popSnapshot(slug, frameSlug): string | null`, `hasSnapshot(slug, frameSlug): boolean`, `clearHistory(slug, frameSlug): void`. LIFO per `slug::frameSlug`.
  - `editUndoMiddleware()`: `POST /api/edit-undo/:slug` body `{ frameSlug }` → pop + restore the top snapshot to the frame file; `{ ok: true }` / `{ ok: false, reason: "nothing-to-undo" | "path-escape" | "undo-write-failed" }`.

- [ ] **Step 1: Write the failing tests**

```ts
// studio/__tests__/server/editHistory.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { pushSnapshot, popSnapshot, hasSnapshot, clearHistory } from "../../server/editHistory";

describe("editHistory LIFO", () => {
  beforeEach(() => clearHistory("p", "f"));
  it("pops snapshots most-recent-first", () => {
    pushSnapshot("p", "f", "v1");
    pushSnapshot("p", "f", "v2");
    expect(popSnapshot("p", "f")).toBe("v2");
    expect(popSnapshot("p", "f")).toBe("v1");
    expect(popSnapshot("p", "f")).toBeNull();
  });
  it("isolates per slug::frameSlug", () => {
    pushSnapshot("p", "f", "A");
    pushSnapshot("p", "g", "B");
    expect(popSnapshot("p", "g")).toBe("B");
    expect(popSnapshot("p", "f")).toBe("A");
  });
  it("hasSnapshot reflects the stack", () => {
    expect(hasSnapshot("p", "f")).toBe(false);
    pushSnapshot("p", "f", "x");
    expect(hasSnapshot("p", "f")).toBe(true);
    popSnapshot("p", "f");
    expect(hasSnapshot("p", "f")).toBe(false);
  });
});
```

```ts
// studio/__tests__/server/editUndo.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { writeFile: (...a: unknown[]) => writeFile(...a) }, writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { editUndoMiddleware } from "../../server/middleware/editUndo";
import { pushSnapshot, clearHistory } from "../../server/editHistory";

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

describe("editUndoMiddleware", () => {
  beforeEach(() => { writeFile.mockReset(); clearHistory("demo", "01-x"); });
  it("restores the top snapshot and returns ok", async () => {
    pushSnapshot("demo", "01-x", "ORIGINAL SOURCE");
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", { frameSlug: "01-x" }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(writeFile.mock.calls[0][1]).toBe("ORIGINAL SOURCE");
  });
  it("nothing-to-undo on empty stack", async () => {
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", { frameSlug: "01-x" }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("400 on malformed body", async () => {
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", {}), res, () => {});
    expect(res.statusCode).toBe(400);
  });
  it("next() for other routes", async () => {
    const next = vi.fn();
    await editUndoMiddleware()(mkReq("/api/other", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/editHistory.test.ts __tests__/server/editUndo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `editHistory.ts`**

```ts
// studio/server/editHistory.ts
const stacks = new Map<string, string[]>();
const key = (slug: string, frameSlug: string) => `${slug}::${frameSlug}`;

export function pushSnapshot(slug: string, frameSlug: string, source: string): void {
  const k = key(slug, frameSlug);
  const s = stacks.get(k) ?? [];
  s.push(source);
  stacks.set(k, s);
}
export function popSnapshot(slug: string, frameSlug: string): string | null {
  const s = stacks.get(key(slug, frameSlug));
  if (!s || s.length === 0) return null;
  return s.pop() ?? null;
}
export function hasSnapshot(slug: string, frameSlug: string): boolean {
  const s = stacks.get(key(slug, frameSlug));
  return !!s && s.length > 0;
}
export function clearHistory(slug: string, frameSlug: string): void {
  stacks.delete(key(slug, frameSlug));
}
```

- [ ] **Step 4: Write `editUndo.ts`**

```ts
// studio/server/middleware/editUndo.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { popSnapshot } from "../editHistory";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function editUndoMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/edit-undo/")) return next?.();
    const slug = url.slice("/api/edit-undo/".length);
    const body = await readJson(req);
    const frameSlug = body?.frameSlug;
    if (typeof frameSlug !== "string") return send(res, 400, { ok: false, reason: "bad_request" });
    const snap = popSnapshot(slug, frameSlug);
    if (snap == null) return send(res, 200, { ok: false, reason: "nothing-to-undo" });
    try {
      const base = frameDir(slug, frameSlug);
      const file = path.join(base, "index.tsx");
      if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
      await fs.writeFile(file, snap, "utf-8");
      return send(res, 200, { ok: true });
    } catch { return send(res, 200, { ok: false, reason: "undo-write-failed" }); }
  };
}
```

- [ ] **Step 5: Push a snapshot before each visual-edit write**

In `studio/server/middleware/visualEdit.ts`, the handler reads the frame source then calls `writeBatch`. Snapshot the CURRENT source before the write so undo can restore it. Add the import:

```ts
import { pushSnapshot } from "../editHistory";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
```

(If some already imported, don't duplicate.) Before the `writeBatch` call in the batch branch, read + snapshot:

```ts
      // Snapshot the pre-write source for one-step undo, then write.
      try {
        const file = path.join(frameDir(slug, body.frameSlug), "index.tsx");
        const before = await fs.readFile(file, "utf-8");
        const result = await writeBatch(body.frameSlug, body.edits);
        if (result.ok) pushSnapshot(slug, body.frameSlug, before);
        return send(res, 200, result);
      } catch (err) { ... existing catch ... }
```

> Note: snapshot only when the write SUCCEEDS (`result.ok`) — a bailed deterministic edit didn't change the file, so it must not push a snapshot. The `slug` here is the route slug (`/api/visual-edit/:slug`); `body.frameSlug` is the frame. Keep the existing move-branch unchanged for now (reorder snapshots can be a follow-up; not required for v1's block undo of style edits).

- [ ] **Step 6: Register editUndo in Vite**

In `studio/vite.config.ts`: import `editUndoMiddleware` near the others, and `server.middlewares.use(editUndoMiddleware());` after `visualEditMiddleware()`.

- [ ] **Step 7: Run tests + server suite**

Run: `pnpm run studio:test __tests__/server/editHistory.test.ts __tests__/server/editUndo.test.ts && pnpm run studio:test __tests__/server`
Expected: PASS (new + existing server suite; the visualEdit snapshot addition shouldn't break its tests — if a visualEdit test asserts no fs.readFile, update it to allow the snapshot read while keeping its real assertions).

- [ ] **Step 8: Commit**

```bash
git add studio/server/editHistory.ts studio/server/middleware/editUndo.ts studio/server/middleware/visualEdit.ts studio/vite.config.ts studio/__tests__/server/editHistory.test.ts studio/__tests__/server/editUndo.test.ts
git commit -m "feat(studio/canvas): LIFO undo snapshot stack + /api/edit-undo, snapshot before each write"
```

---

## Task 3: Client — single-field edit + undo helper

**Files:**
- Modify: `studio/src/lib/visualEditClient.ts`
- Test: `studio/__tests__/lib/visualEditClient-single.test.ts`

**Interfaces:**
- Consumes: existing `toElementEdits`, `postVisualEdit`, `EditedElement`.
- Produces:
  - `buildSingleEdit(sel, field, value, frameSlug): VisualEditPayload` — a one-element, one-field payload (reuses the existing `ElementEdit` shape; `value` may be raw px or `tok:` class; `text`/`iconSwap` handled like `toElementEdits`).
  - `postEditUndo(slug, frameSlug): Promise<{ ok: boolean; reason?: string }>` — POST `/api/edit-undo/:slug`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/visualEditClient-single.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildSingleEdit, postEditUndo } from "../../src/lib/visualEditClient";
import type { EditedElement } from "../../src/hooks/editSessionContext";

const sel: EditedElement["selection"] = {
  editId: 1, file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6,
  componentName: "div", tagName: "div", textEditable: true, styles: {} as any, ownerChain: [],
};

describe("buildSingleEdit", () => {
  it("makes a one-field payload targeting the session frame", () => {
    const p = buildSingleEdit(sel, "paddingTop", "24px", "01-x");
    expect(p.frameSlug).toBe("01-x");
    expect(p.edits).toHaveLength(1);
    expect(p.edits[0].fields).toContainEqual({ field: "paddingTop", value: "24px" });
    expect(p.edits[0].line).toBe(3);
  });
  it("routes text into edit.text, not fields", () => {
    const p = buildSingleEdit(sel, "text", "Hello", "01-x");
    expect(p.edits[0].text).toBe("Hello");
    expect(p.edits[0].fields.find((f) => f.field === "text")).toBeUndefined();
  });
});

describe("postEditUndo", () => {
  it("POSTs to the undo route, returns parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postEditUndo("demo", "01-x");
    expect(fetchMock).toHaveBeenCalledWith("/api/edit-undo/demo", expect.objectContaining({ method: "POST" }));
    expect(r).toEqual({ ok: true });
  });
  it("ok:false on network throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect((await postEditUndo("demo", "01-x")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/visualEditClient-single.test.ts`
Expected: FAIL — `buildSingleEdit`/`postEditUndo` not exported.

- [ ] **Step 3: Add to `visualEditClient.ts`**

```ts
export function buildSingleEdit(
  sel: EditedElement["selection"], field: string, value: string, frameSlug: string,
): VisualEditPayload {
  const fields: { field: string; value: string }[] = [];
  let text: string | undefined;
  let iconSwap: string | undefined;
  if (field === "text") text = value;
  else if (field === "iconSwap") iconSwap = value;
  else fields.push({ field, value });
  return {
    frameSlug,
    edits: [{ file: sel.file, line: sel.line, column: sel.column, text, fields, iconSwap }],
  };
}

export async function postEditUndo(slug: string, frameSlug: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/edit-undo/${slug}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frameSlug }),
    });
    return await res.json();
  } catch { return { ok: false, reason: "network" }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/visualEditClient-single.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/visualEditClient.ts studio/__tests__/lib/visualEditClient-single.test.ts
git commit -m "feat(studio/canvas): single-field visual-edit payload + edit-undo client helper"
```

---

## Task 4: EditBlocks context (client block-stream state)

**Files:**
- Create: `studio/src/hooks/editBlocksContext.tsx`
- Test: `studio/__tests__/hooks/editBlocksContext.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the shared `EditBlock*` types (above) + a provider/hook:
  - `EditBlocksProvider`, `useEditBlocks(): { blocks: EditBlock[]; addBlock(b: Omit<EditBlock,"id">): string; setStatus(id, status): void; removeBlock(id): void }`.
  - `addBlock` returns the generated id. Ordering: newest last (append).

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/hooks/editBlocksContext.test.tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EditBlocksProvider, useEditBlocks } from "../../src/hooks/editBlocksContext";

const wrap = ({ children }: { children: React.ReactNode }) => <EditBlocksProvider>{children}</EditBlocksProvider>;

describe("editBlocks", () => {
  it("adds a block and returns its id", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "padding → 24", kind: "instant", status: "applied", frameSlug: "01-x" }); });
    expect(id).toBeTruthy();
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].label).toBe("padding → 24");
  });
  it("setStatus updates a block", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "x", kind: "ai", status: "pending", frameSlug: "01-x" }); });
    act(() => { result.current.setStatus(id, "working"); });
    expect(result.current.blocks[0].status).toBe("working");
  });
  it("removeBlock drops it", () => {
    const { result } = renderHook(() => useEditBlocks(), { wrapper: wrap });
    let id = "";
    act(() => { id = result.current.addBlock({ label: "x", kind: "instant", status: "applied", frameSlug: "01-x" }); });
    act(() => { result.current.removeBlock(id); });
    expect(result.current.blocks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/hooks/editBlocksContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `editBlocksContext.tsx`**

```tsx
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type EditBlockKind = "instant" | "ai";
export type EditBlockStatus = "applied" | "pending" | "working" | "error" | "undone";
export interface EditBlock {
  id: string; label: string; kind: EditBlockKind; status: EditBlockStatus; frameSlug: string;
}

interface Ctx {
  blocks: EditBlock[];
  addBlock: (b: Omit<EditBlock, "id">) => string;
  setStatus: (id: string, status: EditBlockStatus) => void;
  removeBlock: (id: string) => void;
}
const BlocksCtx = createContext<Ctx | null>(null);

export function EditBlocksProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState<EditBlock[]>([]);
  const counter = useRef(0);
  const value = useMemo<Ctx>(() => ({
    blocks,
    addBlock: (b) => {
      const id = `blk-${++counter.current}`;
      setBlocks((prev) => [...prev, { ...b, id }]);
      return id;
    },
    setStatus: (id, status) => setBlocks((prev) => prev.map((x) => x.id === id ? { ...x, status } : x)),
    removeBlock: (id) => setBlocks((prev) => prev.filter((x) => x.id !== id)),
  }), [blocks]);
  return <BlocksCtx.Provider value={value}>{children}</BlocksCtx.Provider>;
}

export function useEditBlocks(): Ctx {
  const ctx = useContext(BlocksCtx);
  if (!ctx) throw new Error("useEditBlocks must be used inside <EditBlocksProvider>");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/hooks/editBlocksContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/hooks/editBlocksContext.tsx studio/__tests__/hooks/editBlocksContext.test.tsx
git commit -m "feat(studio/canvas): edit-blocks context for the change stream"
```

---

## Task 5: Clearable number input (defect #1)

**Files:**
- Modify: `studio/src/components/inspector/inspectorControls.tsx` (`NumberField`)
- Test: `studio/__tests__/components/number-field.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `NumberField` that uses a free-text input (allows empty + mid-edit states), commits a px value on blur/Enter, emits nothing while empty, rejects non-numeric.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/number-field.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NumberField } from "../../src/components/inspector/inspectorControls";

describe("NumberField", () => {
  it("lets you clear the field fully (no value forced)", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");           // empty is allowed (not snapped back)
  });
  it("commits px on blur with a numeric value", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("300px");
  });
  it("commits on Enter", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("48px");
  });
  it("emits nothing when blurred empty", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("ignores non-numeric on commit", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<NumberField id="w" label="W" valuePx="20px" onChange={onChange} />);
    const input = getByLabelText("W") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/number-field.test.tsx`
Expected: FAIL — current `type="number"` + `fromNumberInput` calls `onChange` on every change, doesn't allow free empty editing, doesn't commit-on-blur.

- [ ] **Step 3: Rewrite `NumberField`**

Replace the `NumberField` function in `inspectorControls.tsx` with a controlled-by-local-state text input that commits on blur/Enter:

```tsx
import { useEffect, useState } from "react";

export function NumberField({ id, label, displayLabel, valuePx, onChange, placeholder, trailing }: {
  id: string; label: string; displayLabel?: string; valuePx: string;
  onChange: (px: string) => void; placeholder?: string; trailing?: ReactNode;
}) {
  // Local draft so the user can clear/edit freely; commit to px on blur/Enter.
  const [draft, setDraft] = useState<string>(toNumberInput(valuePx));
  useEffect(() => { setDraft(toNumberInput(valuePx)); }, [valuePx]);

  function commit() {
    const t = draft.trim();
    if (t === "") return;                       // empty → no edit
    const n = Number(t);
    if (!Number.isFinite(n)) { setDraft(toNumberInput(valuePx)); return; } // junk → revert
    onChange(`${n}px`);
  }

  const input = (
    <input id={id} type="text" inputMode="decimal" aria-label={label} style={INPUT_COMPACT}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
  );
  return (
    <Field label={displayLabel ?? label} htmlFor={id}>
      {trailing
        ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>{input}{trailing}</div>
        : input}
    </Field>
  );
}
```

(Keep `toNumberInput`/`fromNumberInput` exports — other code may use `fromNumberInput`; `NumberField` no longer needs `fromNumberInput`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/number-field.test.tsx`
Expected: PASS. Then `pnpm run studio:test __tests__/components` — fix any inspector test that drove the old number input via a single `change` event expecting an immediate `onChange`; update it to fire blur/Enter (the new commit trigger), keeping assertions real.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/inspectorControls.tsx studio/__tests__/components/number-field.test.tsx
git commit -m "fix(studio/canvas): clearable number input that commits px on blur/Enter"
```

---

## Task 6: Reachable Customize chip (defect #4)

**Files:**
- Modify: `studio/src/frame/overlay/overlays.ts` (`showComponentChip`)
- Test: `studio/__tests__/frame/overlay-chip-reach.test.ts`

**Interfaces:**
- Consumes: existing `showComponentChip`/`hideComponentChip`.
- Produces: a chip with a reliably clickable Customize target — `pointer-events: auto`, a high z-index above frame content, an enlarged hit area (min 24px tall, padded), and positioned so it never sits off the top of the viewport (clamp `top >= 0`, and if the element is at the very top, place the chip just BELOW the selection instead of above).

> Context: the user reported the cursor cannot reach the Customize link. Likely causes: the chip sits at `top - 24` which can be off-screen / under the toolbar for top elements, the hit area is a thin `<u>`, or z-index/pointer-events let frame content intercept. This task hardens all three; the manual gate confirms reachability.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/frame/overlay-chip-reach.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { showComponentChip, hideComponentChip } from "../../src/frame/overlay/overlays";

function rect(el: HTMLElement, r: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, toJSON: () => ({}), ...r } as DOMRect);
}

describe("component chip reachability", () => {
  beforeEach(() => { document.documentElement.innerHTML = ""; hideComponentChip(); });

  it("never positions the chip above the top of the viewport", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 5, left: 40 }); // near the very top
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    const top = parseFloat(chip.style.top);
    expect(top).toBeGreaterThanOrEqual(0);   // clamped, not -19
  });
  it("the Customize target has an enlarged, pointer-enabled hit area", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 200, left: 40 });
    showComponentChip(el);
    const cust = document.querySelector("[data-arcade-customize]") as HTMLElement;
    expect(cust).toBeTruthy();
    expect(cust.style.pointerEvents).toBe("auto");
    // padded hit area (not a bare inline underline)
    expect(cust.style.padding === "" ? "" : cust.style.padding).not.toBe("");
  });
  it("chip itself has high z-index + pointer-events auto", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 200, left: 40 });
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    expect(Number(chip.style.zIndex)).toBeGreaterThan(2147483000);
    expect(chip.style.pointerEvents).toBe("auto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/overlay-chip-reach.test.ts`
Expected: FAIL — current chip uses `top - 24` unclamped, the Customize element is a bare `<u>` without padding/pointer-events.

- [ ] **Step 3: Harden `showComponentChip`**

Update the chip creation + positioning in `overlays.ts`:

```ts
// In showComponentChip, where the Customize element is created, give it a hit area:
    cust.style.cssText = "cursor:pointer;pointer-events:auto;padding:2px 6px;margin:-2px -2px -2px 0;border-radius:6px;text-decoration:underline;";
// On the chip container, ensure pointer-events + a top-of-stack z-index:
    componentChip.style.pointerEvents = "auto";
    componentChip.style.zIndex = "2147483647";
// Positioning: clamp to viewport top; place below the box if there's no room above.
  const r = el.getBoundingClientRect();
  const ABOVE = 24;
  const top = r.top >= ABOVE ? r.top - ABOVE : r.bottom + 4;
  componentChip.style.left = `${Math.max(0, r.left)}px`;
  componentChip.style.top = `${Math.max(0, top)}px`;
```

(Keep the existing `data-arcade-component-chip` / `data-arcade-customize` attrs, the `💠 Component · ` + `Customize` copy, and the customize-request postMessage on click — those are correct and tested.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/overlay-chip-reach.test.ts && pnpm run studio:test __tests__/frame`
Expected: PASS (new + existing frame/overlay suite, including the existing chip test).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/overlays.ts studio/__tests__/frame/overlay-chip-reach.test.ts
git commit -m "fix(studio/canvas): make the Customize chip a reachable click target"
```

---

## Task 7: Inspector rewrite — write-on-edit, emit blocks, remove Commit

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/inspector-instant-apply.test.tsx`

**Interfaces:**
- Consumes: `buildSingleEdit`/`postVisualEdit` (3), `useEditBlocks`/`addBlock`/`setStatus` (4), `isInFrame` + `buildVisualEditPreamble` (existing).
- Produces: an inspector where each settled edit (a) previews live, (b) debounced, writes deterministically via `/api/visual-edit`, (c) on `{ok:true}` adds an `instant`/`applied` block; on `{ok:false}` adds an `ai`/`pending` block (NOT auto-sent). The **Commit button is removed**. A `humanLabel(field, value)` helper produces the block label.

> This is the central rewrite. Context: today `change()` stages into a `batch` and a `commit()` button sends everything (deterministic-then-chat-fallback). New model: there is no batch-commit; each settled field edit applies on its own and produces a block. Keep the live-preview postMessage exactly as-is (that's the instant visual). Remove the `commit()` function and the Commit `<Button>`. The pending-AI block's Apply is wired in Task 8 (the panel renders blocks); here, emitting the pending block is enough — store the element selection + field/value on the block-creating call so Task 8 can apply it. Use a module-local map keyed by block id → the scoped chat preamble, OR include enough on the block; SIMPLEST: when creating an `ai` block, immediately build its preamble via `buildVisualEditPreamble([elementWithThisPending], frameRel)` and stash it; Task 8's Apply calls `onSend(preamble)`. Expose an `applyBlock(id)` through context or a ref. To keep Task 7 self-contained and testable, this task: writes deterministically, adds the correct block kind, and removes Commit. The Apply wiring (calling onSend for ai blocks) lands in Task 8.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/inspector-instant-apply.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
// NOTE: this test renders InspectorPanel inside EditSessionProvider + EditBlocksProvider
// with a focused element, drives a field change, and asserts:
//  - a deterministic field POSTs /api/visual-edit and yields an "applied" instant block
//  - a deterministic-bail (mock {ok:false}) yields a "pending" ai block, NOT an onSend
//  - there is NO "Commit" button in the document
// The harness mirrors the existing InspectorPanel test (mock @xorkavi/arcade-gen, stub fetch).
// See studio/__tests__/components/InspectorPanel.test.tsx for the provider/mocks setup to copy.

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import { EditSessionProvider } from "../../src/hooks/editSessionContext";
import { EditBlocksProvider } from "../../src/hooks/editBlocksContext";

// ... copy the mock/provider scaffold from InspectorPanel.test.tsx ...

describe("inspector instant-apply model", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders NO Commit button", () => {
    // render with a focused element (use the existing test's helper to seed editSession)
    // expect(queryByText("Commit")).toBeNull();
  });

  it("a deterministic edit POSTs visual-edit and creates an applied instant block", async () => {
    // stub fetch → {ok:true}; fire a padding change + blur;
    // await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/visual-edit/...", ...));
    // assert a block with kind "instant", status "applied" exists (via a test hook into useEditBlocks)
  });

  it("a deterministic bail creates a pending ai block and does NOT onSend", async () => {
    // stub fetch → {ok:false, reason:"dynamic-classname"}; fire change + blur;
    // assert a block kind "ai" status "pending"; assert onSend NOT called
  });
});
```

> Implementer: flesh out the three test bodies using the EXACT provider + arcade-gen mock scaffold already in `studio/__tests__/components/InspectorPanel.test.tsx` (copy its `beforeEach`, the `EditSessionProvider` seeding of a focused element, and the `@xorkavi/arcade-gen` mock). Drive the field change through the rendered control (fire change + blur on the NumberField, or click a token swatch). To assert block state, render a tiny probe component that calls `useEditBlocks()` and exposes `blocks` (the test reads it), since blocks live in context. Keep all three assertions REAL (POST called / block kind+status / onSend not called).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/inspector-instant-apply.test.tsx`
Expected: FAIL — Commit button still present; no block emitted on edit.

- [ ] **Step 3: Rewrite the change/commit flow**

In `InspectorPanel.tsx`:

1. Add imports: `useEditBlocks` from `../../hooks/editBlocksContext`; `buildSingleEdit` from `../../lib/visualEditClient`.
2. Add `const { addBlock, setStatus } = useEditBlocks();`.
3. Add a label helper:

```tsx
function humanLabel(field: string, value: string): string {
  if (field === "text") return `text → "${value}"`;
  const v = value.startsWith("tok:") ? value.slice(4) : value;
  return `${field} → ${v}`;
}
```

4. Add a debounced deterministic apply (write on settled value):

```tsx
  const applyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  async function applyFieldEdit(sel: EditedElement["selection"], field: string, value: string) {
    const targetFrame = frameSlug ?? "";
    if (!targetFrame || !isInFrame(sel.file, targetFrame)) {
      // off-frame (kit) → that's the Customize path, not a field edit; ignore here
      return;
    }
    const det = await postVisualEdit(slug, buildSingleEdit(sel, field, value, targetFrame));
    if (det.ok) {
      addBlock({ label: humanLabel(field, value), kind: "instant", status: "applied", frameSlug: targetFrame });
    } else {
      // can't map deterministically → pending AI block (NOT auto-sent)
      addBlock({ label: humanLabel(field, value), kind: "ai", status: "pending", frameSlug: targetFrame });
    }
  }
  function scheduleApply(sel: EditedElement["selection"], field: string, value: string) {
    const k = `${sel.editId}:${field}`;
    clearTimeout(applyTimers.current[k]);
    applyTimers.current[k] = setTimeout(() => { void applyFieldEdit(sel, field, value); }, 350);
  }
```

5. In `change()` and `changeToken()`, AFTER posting the live preview, call `scheduleApply(focused.selection, key, value-or-tokclass)` instead of staging for Commit. (For `changeToken`, the value is `tok:${className}`.)
6. **Remove** the `commit()` function and the Commit `<Button>` from the footer (keep Discard/close as a "clear selection" control, or remove the footer Commit specifically — leave Discard if present, but it no longer "commits").
7. Text edits (the `text-changed` message handler) → call `scheduleApply(sel, "text", newText)` too.

> The pending-AI block carries enough to apply later: store the `{sel, field, value}` on a side map keyed by the returned block id so Task 8's Apply can call `onSend(buildVisualEditPreamble(...))`. Expose `applyAiBlock(id)` via a ref or context set in Task 8. For THIS task, emitting the correct block kind + removing Commit is the deliverable; the test asserts those.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/inspector-instant-apply.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the components suite**

Run: `pnpm run studio:test __tests__/components`
Expected: PASS. The existing `InspectorPanel.test.tsx` "Commit sends a preamble" test will now FAIL (Commit removed) — update it to the new model: assert that an edit produces a block / posts visual-edit, and remove the Commit-specific assertion. This is a legitimate model change, not a weakening — the test must now verify instant-apply, not Commit.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/inspector-instant-apply.test.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "feat(studio/canvas): instant-apply edits as blocks, remove Commit button"
```

---

## Task 8: Render the block stream + Undo/Apply/Discard + wire providers (+ manual gate)

**Files:**
- Create: `studio/src/components/chat/EditBlockRow.tsx`
- Modify: `studio/src/components/chat/MessageList.tsx` (render blocks)
- Modify: `studio/src/routes/ProjectDetail.tsx` (EditBlocksProvider + apply/undo wiring)
- Modify: `studio/src/components/inspector/InspectorPanel.tsx` (register `applyAiBlock`)
- Test: `studio/__tests__/components/edit-block-row.test.tsx`

**Interfaces:**
- Consumes: `useEditBlocks` (4), `postEditUndo` (3), `onSend` (existing chat send), the pending-block preamble map (7).
- Produces: a rendered block stream in the chat panel; per block — `instant/applied` shows label + **Undo**; `ai/pending` shows label + **Apply** / **Discard**; `working` shows a spinner; Undo calls `postEditUndo` and sets status `undone`.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/edit-block-row.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { EditBlockRow } from "../../src/components/chat/EditBlockRow";

describe("EditBlockRow", () => {
  it("instant/applied shows label + Undo", () => {
    const onUndo = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b1", label: "padding → 24", kind: "instant", status: "applied", frameSlug: "f" }}
        onUndo={onUndo} onApply={vi.fn()} onDiscard={vi.fn()} />);
    getByText("padding → 24");
    fireEvent.click(getByText("Undo"));
    expect(onUndo).toHaveBeenCalledWith("b1");
  });
  it("ai/pending shows Apply + Discard", () => {
    const onApply = vi.fn(); const onDiscard = vi.fn();
    const { getByText } = render(
      <EditBlockRow block={{ id: "b2", label: "make responsive", kind: "ai", status: "pending", frameSlug: "f" }}
        onUndo={vi.fn()} onApply={onApply} onDiscard={onDiscard} />);
    fireEvent.click(getByText("Apply"));
    expect(onApply).toHaveBeenCalledWith("b2");
    fireEvent.click(getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledWith("b2");
  });
  it("undone block shows a muted undone state (no Undo button)", () => {
    const { queryByText } = render(
      <EditBlockRow block={{ id: "b3", label: "x", kind: "instant", status: "undone", frameSlug: "f" }}
        onUndo={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(queryByText("Undo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/edit-block-row.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `EditBlockRow.tsx`**

```tsx
import type { EditBlock } from "../../hooks/editBlocksContext";

export function EditBlockRow({ block, onUndo, onApply, onDiscard }: {
  block: EditBlock;
  onUndo: (id: string) => void;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const muted = block.status === "undone";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      padding: "6px 10px", borderRadius: 8, fontSize: 12,
      background: "var(--bg-neutral-soft)", opacity: muted ? 0.5 : 1,
      border: "1px solid var(--stroke-neutral-subtle)",
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {block.status === "applied" && "✓ "}
        {block.status === "working" && "⏳ "}
        {block.label}
      </span>
      <span style={{ display: "flex", gap: 6, flex: "none" }}>
        {block.kind === "instant" && block.status === "applied" && (
          <button type="button" onClick={() => onUndo(block.id)} style={btn}>Undo</button>
        )}
        {block.kind === "ai" && block.status === "pending" && (
          <>
            <button type="button" onClick={() => onApply(block.id)} style={btn}>Apply</button>
            <button type="button" onClick={() => onDiscard(block.id)} style={btn}>Discard</button>
          </>
        )}
      </span>
    </div>
  );
}
const btn: React.CSSProperties = {
  background: "transparent", border: "none", color: "var(--fg-accent)",
  cursor: "pointer", fontSize: 12, padding: 0,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/edit-block-row.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the stream into the chat panel + providers**

1. `ProjectDetail.tsx`: wrap the chat/inspector subtree in `<EditBlocksProvider>` (inside `EditSessionProvider`, alongside `ChatStreamProvider`). Pass an `onUndo` that calls `postEditUndo(slug, block.frameSlug)` then `setStatus(id, "undone")`, and `onApply`/`onDiscard` handlers (Apply → `onSend(preamble for that block)` + `setStatus(id,"working")`; Discard → `removeBlock(id)`).
2. `MessageList.tsx`: render the `useEditBlocks().blocks` as `EditBlockRow`s in the stream (after history, before the live turn, or interleaved by creation — simplest: a block section under the message history). Keep existing message rendering intact.
3. `InspectorPanel.tsx`: store each pending-AI block's scoped preamble in a context-exposed map so `onApply(id)` can retrieve + `onSend` it. (Add `applyText: Record<id,string>` to the blocks context, or a ref passed down — pick the simplest that the Apply handler in ProjectDetail can read.)

- [ ] **Step 6: Run components suite + full suite**

Run: `pnpm run studio:test __tests__/components && pnpm run studio:test`
Expected: PASS (full suite green except the known pre-existing `figmaIngest` flake — verify in isolation if it appears).

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/chat/EditBlockRow.tsx studio/src/components/chat/MessageList.tsx studio/src/routes/ProjectDetail.tsx studio/src/components/inspector/InspectorPanel.tsx studio/src/hooks/editBlocksContext.tsx studio/__tests__/components/edit-block-row.test.tsx
git commit -m "feat(studio/canvas): render edit-block stream with Undo/Apply/Discard in chat panel"
```

- [ ] **Step 8: Manual gate (HUMAN, app restart)**

`pnpm run studio` on a **generated** frame (e.g. "a settings page with cards + a save button"):
1. **Instant + predictable:** select a heading → change padding (a scale value) → applies instantly, no spinner, ✓ block appears in chat with Undo. Change **width to 300** → applies instantly (`w-[300px]` in source), ✓ block. **No Commit button anywhere.**
2. **Number input:** clear a width field fully, type a new value → works without fighting the input.
3. **Undo:** click Undo on a block → the change reverts in the frame; block shows undone.
4. **AI block:** make an edit the writer can't map (e.g. on a dynamic-className element) → a pending block with Apply/Discard appears; Apply sends to the agent (working → applied), Discard removes it (no agent call).
5. **Customize chip:** select a kit component → the 💠 Component · Customize chip is reachable and clickable.
Record results in the ledger. Visual/hot-reload behavior + Tailwind arbitrary-value compilation can't be unit-tested — this gate is required before merge.

---

## Final verification

- [ ] **Full suite:** `pnpm run studio:test` — all green (modulo the known figmaIngest flake; verify in isolation).
- [ ] **All 5 manual-gate scenarios pass** (Task 8 Step 8).
- [ ] **Frame never left broken:** a deterministic write that fails reparse leaves the file untouched and produces a pending AI block instead.
- [ ] **Undo restores** the prior frame source, LIFO.

## Notes on deferred scope (later phases)

- On-canvas resize/move HANDLES (the grab-the-corner gesture) — separate spec; rides this task's deterministic writer (arbitrary px already supported).
- Reverse-patch / out-of-order undo (this plan is LIFO only).
- Reorder (move-branch) undo snapshots — add a snapshot push to the move branch when reorder joins the block model.
