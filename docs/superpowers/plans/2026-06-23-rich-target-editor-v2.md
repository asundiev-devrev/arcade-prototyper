# Rich Target Editor v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the single-element inspector into a multi-element batch editor with in-place text editing and a resizable panel, fixing the container-disappears bug by construction.

**Architecture:** Rename `targetSelectionContext` → `editSessionContext` holding an ordered batch of `EditedElement` records keyed by a monotonic `editId`. `inspector.ts` keeps a `Map<editId, {node, original}>`, previews each element's style overrides independently via inline `node.style.*`, and handles in-place text editing via `contenteditable` on leaf text nodes only (never `textContent` on containers — that was the bug). `picker.ts` stays active after a pick and stamps `editId`. `InspectorPanel` shows a batch list + the focused element's controls (no Text input) and is resizable. Commit serializes the whole batch through the existing `onSend` chat pipeline.

**Tech Stack:** React 19, TypeScript, Vite, `@xorkavi/arcade-gen`, Vitest + jsdom + @testing-library/react. pnpm.

## Global Constraints

- **pnpm only.** Before running tests in this environment, the shell needs:
  `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` and
  `export GITHUB_TOKEN_PACKAGES="$GITHUB_TOKEN"`. If `pnpm`/`vitest` are still
  "not found" after those exports, STOP and report — do NOT assume npm-auth.
- **Run tests from the repo root** (`/Users/andrey.sundiev/arcade-prototyper`):
  `pnpm run studio:test <path>` (path relative to `studio/`); full suite
  `pnpm run studio:test`.
- **Commits:** Conventional Commits, scope `studio/inspector`. End each commit
  message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — stage explicit paths only.
- **Vite plugins/middleware don't hot-reload** — `frameMountPlugin.ts` changes
  need a full app restart (does not affect tests).
- **Dev-only feature** — React internals + iframe introspection, same constraint
  as `picker.ts`. Not production-safe by design; don't try to make it so.
- **Tokens, not hex.** Committed source uses Tailwind utilities + arcade-gen
  tokens (the reason commit goes through Claude). Live preview may use raw CSS.
- **Component tests** use `// @vitest-environment jsdom` and mock
  `@xorkavi/arcade-gen` (export only the symbols the component uses).
- **`editId` is a number** stamped as the DOM attribute `data-arcade-edit-id`
  and used as the React key and the batch map key everywhere — never a string.

## Context note: this is a forward-rewrite

v1 shipped these files on this same branch (`feat/rich-target-editor`). v2
rewrites them forward. The old `targetSelectionContext.tsx` is **renamed** to
`editSessionContext.tsx`; update every import. v1 tests for the renamed/rewritten
modules are replaced by v2 tests in the same task.

---

## File Structure

- **Rename + rewrite** `studio/src/hooks/targetSelectionContext.tsx` →
  `studio/src/hooks/editSessionContext.tsx` — batch state. (Task 1)
- **Rewrite** `studio/src/frame/inspector.ts` — Map of edited nodes, per-editId
  style preview, contenteditable text flow, `textEditable` classification, NO
  container textContent writes. (Task 2)
- **Modify** `studio/src/frame/picker.ts` — stay active after pick, stamp
  `editId`, report `editId` + `textEditable`, allow double-click text edit. (Task 2)
- **Rewrite** `studio/src/lib/visualEditPreamble.ts` — batch → one instruction. (Task 3)
- **Rewrite** `studio/src/components/inspector/InspectorPanel.tsx` — batch list +
  focused controls (no Text row) + resize handle + wider default. (Task 4)
- **Rewrite** `studio/src/components/viewport/FrameCard.tsx` pick wiring — batch
  add/focus, frame-switch guard, keep picker active, Save-as-component uses
  focused element. (Task 5)
- **Modify** `studio/src/components/chat/PromptInput.tsx` — remove `TargetChip`,
  `buildTargetPreamble`, and the target import. (Task 5)
- **Modify** `studio/src/components/viewport/Viewport.tsx` — frame-delete clears
  that frame's elements from the batch. (Task 5)
- **Modify** `studio/src/components/assets/SaveComponentModal.tsx` — accept
  `ElementSelection`. (Task 5)
- **Modify** `studio/src/routes/ProjectDetail.tsx` — import path rename, pass
  `inspectorWidth` to the grid track. (Task 6)
- **Modify** `studio/server/plugins/frameMountPlugin.ts` — unchanged import line
  already present; verify only. (Task 2)
- Tests under `studio/__tests__/...` rewritten per task.

### Shared types (defined in Task 1, consumed everywhere)

```ts
// studio/src/hooks/editSessionContext.tsx
export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
}
export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;

export interface ElementSelection {
  editId: number;
  file: string; line: number; column: number;
  componentName: string; tagName: string;
  textEditable: boolean;
  styles: StyleSnapshot;
}
export interface EditedElement {
  selection: ElementSelection;
  pending: PendingEdits;
}
```

---

### Task 1: Rename context → editSessionContext with batch state

**Files:**
- Rename+rewrite: `studio/src/hooks/targetSelectionContext.tsx` → `studio/src/hooks/editSessionContext.tsx`
- Test: `studio/__tests__/hooks/editSessionContext.test.tsx` (replaces `targetSelectionContext.test.tsx` — delete the old one)

**Interfaces:**
- Produces: types above; hook `useEditSession()` returning:
  ```ts
  interface Ctx {
    batch: EditedElement[];
    focusedEditId: number | null;
    frameSlug: string | null;
    frameWindow: Window | null;
    inspectorOpen: boolean;
    inspectorWidth: number;
    /** Add a freshly-picked element (or re-focus if its editId is already in the batch). Sets frameSlug/frameWindow. */
    addOrFocus: (sel: ElementSelection, frameSlug: string, frameWindow: Window | null) => void;
    focus: (editId: number) => void;
    removeElement: (editId: number) => void;
    setField: (editId: number, key: keyof StyleSnapshot, value: string) => void;
    resetField: (editId: number, key: keyof StyleSnapshot) => void;
    clear: () => void;
    setInspectorOpen: (open: boolean) => void;
    setInspectorWidth: (px: number) => void;
  }
  export function useEditSession(): Ctx;
  export function EditSessionProvider({ children }: { children: ReactNode }): JSX.Element;
  ```
- `addOrFocus`: if `sel.editId` already in batch → just set `focusedEditId = sel.editId` (no dup, keep its pending). Else append `{ selection: sel, pending: {} }` and focus it. Always set `frameSlug`/`frameWindow` to the args.
- `focused` element = `batch.find(e => e.selection.editId === focusedEditId) ?? null` (derive in consumers; not stored).

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/hooks/editSessionContext.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
} from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
};
function sel(editId: number, over: Partial<ElementSelection> = {}): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES, ...over,
  };
}
const wrap = ({ children }: { children: React.ReactNode }) => (
  <EditSessionProvider>{children}</EditSessionProvider>
);

describe("editSessionContext", () => {
  it("addOrFocus appends a new element and focuses it", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => result.current.addOrFocus(sel(1), "home", null));
    expect(result.current.batch).toHaveLength(1);
    expect(result.current.focusedEditId).toBe(1);
    expect(result.current.frameSlug).toBe("home");
  });

  it("addOrFocus on an existing editId re-focuses without duplicating or losing pending", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => result.current.addOrFocus(sel(1), "home", null));
    act(() => result.current.setField(1, "fontSize", "18px"));
    act(() => result.current.addOrFocus(sel(2), "home", null));
    act(() => result.current.addOrFocus(sel(1), "home", null)); // re-pick #1
    expect(result.current.batch).toHaveLength(2);
    expect(result.current.focusedEditId).toBe(1);
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.fontSize).toBe("18px");
  });

  it("setField / resetField mutate only the named element", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.addOrFocus(sel(2), "home", null); });
    act(() => result.current.setField(1, "color", "rgb(1,2,3)"));
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.color).toBe("rgb(1,2,3)");
    expect(result.current.batch.find((e) => e.selection.editId === 2)!.pending.color).toBeUndefined();
    act(() => result.current.resetField(1, "color"));
    expect(result.current.batch.find((e) => e.selection.editId === 1)!.pending.color).toBeUndefined();
  });

  it("removeElement drops it and re-points focus", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.addOrFocus(sel(2), "home", null); });
    act(() => result.current.removeElement(2));
    expect(result.current.batch).toHaveLength(1);
    expect(result.current.focusedEditId).toBe(1);
  });

  it("clear wipes batch, focus, frame, inspectorOpen, frameWindow", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    act(() => { result.current.addOrFocus(sel(1), "home", null); result.current.setInspectorOpen(true); });
    act(() => result.current.clear());
    expect(result.current.batch).toHaveLength(0);
    expect(result.current.focusedEditId).toBeNull();
    expect(result.current.frameSlug).toBeNull();
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.frameWindow).toBeNull();
  });

  it("inspectorWidth defaults to 360 and is settable", () => {
    const { result } = renderHook(() => useEditSession(), { wrapper: wrap });
    expect(result.current.inspectorWidth).toBe(360);
    act(() => result.current.setInspectorWidth(420));
    expect(result.current.inspectorWidth).toBe(420);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/hooks/editSessionContext.test.tsx`
Expected: FAIL — module `editSessionContext` not found.

- [ ] **Step 3: Create the new context module**

Create `studio/src/hooks/editSessionContext.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
}
export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;

export interface ElementSelection {
  editId: number;
  file: string; line: number; column: number;
  componentName: string; tagName: string;
  textEditable: boolean;
  styles: StyleSnapshot;
}
export interface EditedElement {
  selection: ElementSelection;
  pending: PendingEdits;
}

const DEFAULT_WIDTH = 360;

interface Ctx {
  batch: EditedElement[];
  focusedEditId: number | null;
  frameSlug: string | null;
  frameWindow: Window | null;
  inspectorOpen: boolean;
  inspectorWidth: number;
  addOrFocus: (sel: ElementSelection, frameSlug: string, frameWindow: Window | null) => void;
  focus: (editId: number) => void;
  removeElement: (editId: number) => void;
  setField: (editId: number, key: keyof StyleSnapshot, value: string) => void;
  resetField: (editId: number, key: keyof StyleSnapshot) => void;
  clear: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorWidth: (px: number) => void;
}

const EditCtx = createContext<Ctx | null>(null);

export function EditSessionProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<EditedElement[]>([]);
  const [focusedEditId, setFocusedEditId] = useState<number | null>(null);
  const [frameSlug, setFrameSlug] = useState<string | null>(null);
  const [frameWindow, setFrameWindow] = useState<Window | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_WIDTH);

  const value = useMemo<Ctx>(
    () => ({
      batch, focusedEditId, frameSlug, frameWindow, inspectorOpen, inspectorWidth,
      addOrFocus: (sel, slug, win) => {
        setFrameSlug(slug);
        setFrameWindow(win);
        setBatch((b) =>
          b.some((e) => e.selection.editId === sel.editId)
            ? b
            : [...b, { selection: sel, pending: {} }],
        );
        setFocusedEditId(sel.editId);
      },
      focus: (id) => setFocusedEditId(id),
      removeElement: (id) =>
        setBatch((b) => {
          const next = b.filter((e) => e.selection.editId !== id);
          setFocusedEditId((cur) =>
            cur === id ? (next.length ? next[next.length - 1].selection.editId : null) : cur,
          );
          return next;
        }),
      setField: (id, key, val) =>
        setBatch((b) =>
          b.map((e) =>
            e.selection.editId === id ? { ...e, pending: { ...e.pending, [key]: val } } : e,
          ),
        ),
      resetField: (id, key) =>
        setBatch((b) =>
          b.map((e) => {
            if (e.selection.editId !== id) return e;
            const pending = { ...e.pending };
            delete pending[key];
            return { ...e, pending };
          }),
        ),
      clear: () => {
        setBatch([]);
        setFocusedEditId(null);
        setFrameSlug(null);
        setFrameWindow(null);
        setInspectorOpen(false);
      },
      setInspectorOpen,
      setInspectorWidth,
    }),
    [batch, focusedEditId, frameSlug, frameWindow, inspectorOpen, inspectorWidth],
  );
  return <EditCtx.Provider value={value}>{children}</EditCtx.Provider>;
}

export function useEditSession(): Ctx {
  const ctx = useContext(EditCtx);
  if (!ctx) throw new Error("useEditSession must be used inside <EditSessionProvider>");
  return ctx;
}
```

- [ ] **Step 4: Delete the old context + its test**

```bash
git rm studio/src/hooks/targetSelectionContext.tsx studio/__tests__/hooks/targetSelectionContext.test.tsx
```

(Consumers still importing the old path will fail to compile — Tasks 4/5/6 fix them. The full suite will be red between tasks; that's expected for a rename. Each consumer task re-greens its own files. This task's gate is the new context test only.)

- [ ] **Step 5: Run the new test to verify it passes**

Run: `pnpm run studio:test __tests__/hooks/editSessionContext.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add studio/src/hooks/editSessionContext.tsx studio/__tests__/hooks/editSessionContext.test.tsx
git rm --cached studio/src/hooks/targetSelectionContext.tsx studio/__tests__/hooks/targetSelectionContext.test.tsx 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(studio/inspector): rename context to editSessionContext with batch state

Single-target model replaced by an editId-keyed batch of EditedElement
records. Old targetSelectionContext removed; consumers updated in later tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewrite inspector.ts (Map of nodes + contenteditable) + picker stays active

**Files:**
- Rewrite: `studio/src/frame/inspector.ts`
- Modify: `studio/src/frame/picker.ts`
- Verify: `studio/server/plugins/frameMountPlugin.ts` (import line already present)
- Test: `studio/__tests__/frame/inspector-snapshot.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing from shell (iframe bundle boundary — re-declare `StyleSnapshot` structurally, identical field list to Task 1).
- Produces:
  - `export function readStyleSnapshot(node: Element): StyleSnapshot`
  - `export function isTextEditable(node: Element): boolean` — true iff `ownText(node) !== ""` AND node has no child *element* nodes.
  - `export function capture(node: HTMLElement): { editId: number; textEditable: boolean; styles: StyleSnapshot }` — stamps `data-arcade-edit-id` (monotonic), stores `{node, original}` in a Map keyed by editId, returns the descriptor. If the node already has an editId attribute, reuse it (re-pick).
  - message handlers for `arcade-studio:preview {editId, field, value}`, `arcade-studio:preview-reset {editId}` or `{all:true}`.
  - in-iframe `dblclick` listener: if the double-clicked node is a captured, text-editable element, set `contenteditable=true` + focus; on `blur`, read own-text, post `arcade-studio:text-changed {editId, text}`, remove contenteditable.
- picker.ts: `resolveSelection` now returns `{file,line,column,componentName,tagName}` AND the chosen DOM node so onClick can `capture()` it and post `{selection: {...source, editId, textEditable, styles}}`. picker no longer calls `deactivate()` in `onClick`'s success path (stays active for the next pick); still deactivates on Escape and on `frame-pick-stop`.

- [ ] **Step 1: Write the failing tests**

Rewrite `studio/__tests__/frame/inspector-snapshot.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readStyleSnapshot, isTextEditable, capture } from "../../src/frame/inspector";

beforeEach(() => { document.body.innerHTML = ""; });

describe("readStyleSnapshot", () => {
  it("reads own text + documented style fields incl. gap", () => {
    const el = document.createElement("button");
    el.textContent = "Save";
    el.style.fontSize = "18px";
    document.body.appendChild(el);
    const snap = readStyleSnapshot(el);
    expect(snap.text).toBe("Save");
    expect(snap.fontSize).toBe("18px");
    expect(typeof snap.gap).toBe("string");
  });
});

describe("isTextEditable", () => {
  it("true for a leaf element with own text", () => {
    const el = document.createElement("button"); el.textContent = "Click";
    document.body.appendChild(el);
    expect(isTextEditable(el)).toBe(true);
  });
  it("false for a container with child elements", () => {
    const div = document.createElement("div");
    div.innerHTML = `<span>a</span><span>b</span>`;
    document.body.appendChild(div);
    expect(isTextEditable(div)).toBe(false);
  });
  it("false for an empty leaf", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isTextEditable(el)).toBe(false);
  });
});

describe("capture + preview", () => {
  it("stamps a numeric editId and reuses it on re-capture", () => {
    const el = document.createElement("button"); el.textContent = "X";
    document.body.appendChild(el);
    const a = capture(el);
    expect(typeof a.editId).toBe("number");
    const b = capture(el);
    expect(b.editId).toBe(a.editId);
    expect(el.getAttribute("data-arcade-edit-id")).toBe(String(a.editId));
  });

  it("REGRESSION: previewing/resetting a CONTAINER never deletes its children", () => {
    const card = document.createElement("div");
    card.innerHTML = `<h2>Title</h2><p>Body</p>`;
    document.body.appendChild(card);
    const { editId } = capture(card); // container: textEditable false
    // simulate a style preview + reset round trip via the message handler
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId, field: "backgroundColor", value: "rgb(1,2,3)" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-reset", editId },
    }));
    // children MUST survive (the v1 bug deleted them via textContent="")
    expect(card.querySelector("h2")).not.toBeNull();
    expect(card.querySelector("p")).not.toBeNull();
    expect(card.style.backgroundColor).toBe("");
  });

  it("style preview targets the right element by editId", () => {
    const a = document.createElement("button"); a.textContent = "A"; document.body.appendChild(a);
    const b = document.createElement("button"); b.textContent = "B"; document.body.appendChild(b);
    const ca = capture(a); const cb = capture(b);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId: ca.editId, field: "fontSize", value: "40px" },
    }));
    expect(a.style.fontSize).toBe("40px");
    expect(b.style.fontSize).toBe("");
    expect(cb.editId).not.toBe(ca.editId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: FAIL — `isTextEditable`/new `capture` signature not found.

- [ ] **Step 3: Rewrite `inspector.ts`**

Replace the entire contents of `studio/src/frame/inspector.ts`:

```ts
/**
 * In-iframe companion to picker.ts. The picker hands each clicked element here
 * via `capture()`. We retain a MAP of edited nodes keyed by a stamped numeric
 * editId, read computed-style snapshots to seed the shell panel, and apply
 * throwaway INLINE-style previews per element on `arcade-studio:preview`.
 *
 * Text is edited IN PLACE: double-clicking a captured, text-editable leaf makes
 * it contenteditable; on blur we post the new text to the shell. We NEVER write
 * `textContent` on a container — doing so deleted child elements (the v1 bug).
 *
 * Why inline styles (not a managed stylesheet): Studio frames are
 * className-styled static prototypes and the picker intercepts clicks during a
 * session, so React doesn't reconcile the `style` we set. Preview is disposable;
 * the committed result always comes from the shell's batch state, never read
 * back from here. Dev-only — same React-internals constraints as picker.ts.
 */

export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
}

const STYLE_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "textAlign", "color",
  "backgroundColor", "borderColor", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "gap", "width", "height",
] as const;

const EDIT_ID_ATTR = "data-arcade-edit-id";

/** Direct (own) text of an element, trimmed — descendant element text excluded. */
function ownText(node: Element): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
  }
  return out.trim();
}

/** A node is text-editable iff it has own text AND no child ELEMENT nodes. */
export function isTextEditable(node: Element): boolean {
  if (ownText(node) === "") return false;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) return false;
  }
  return true;
}

export function readStyleSnapshot(node: Element): StyleSnapshot {
  const cs = window.getComputedStyle(node);
  return {
    text: ownText(node),
    fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
    textAlign: cs.textAlign, color: cs.color, backgroundColor: cs.backgroundColor,
    // getComputedStyle().borderColor is "" when sides differ; top is a stable proxy
    borderColor: cs.borderTopColor,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginRight: cs.marginRight,
    marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
    gap: cs.gap, width: cs.width, height: cs.height,
  };
}

interface Entry { node: HTMLElement; original: StyleSnapshot; }
const edits = new Map<number, Entry>();
let nextId = 1;

/** Retain a clicked node under a stamped numeric editId (reused if already stamped). */
export function capture(node: HTMLElement): { editId: number; textEditable: boolean; styles: StyleSnapshot } {
  const existing = node.getAttribute(EDIT_ID_ATTR);
  const editId = existing ? Number(existing) : nextId++;
  if (!existing) node.setAttribute(EDIT_ID_ATTR, String(editId));
  const styles = readStyleSnapshot(node);
  if (!edits.has(editId)) edits.set(editId, { node, original: styles });
  return { editId, textEditable: isTextEditable(node), styles };
}

function applyPreview(editId: number, field: string, value: string) {
  const entry = edits.get(editId);
  if (!entry) return;
  if (!(STYLE_FIELDS as readonly string[]).includes(field)) {
    console.warn(`[inspector] ignored unknown preview field "${field}"`);
    return;
  }
  if (field === "borderColor" && entry.node.style.borderStyle === "") {
    entry.node.style.borderStyle = "solid";
    if (entry.node.style.borderWidth === "") entry.node.style.borderWidth = "1px";
  }
  (entry.node.style as unknown as Record<string, string>)[field] = value;
}

/** Reset one element's inline style overrides. NEVER touches textContent. */
function resetOne(editId: number) {
  const entry = edits.get(editId);
  if (!entry) return;
  for (const field of STYLE_FIELDS) {
    (entry.node.style as unknown as Record<string, string>)[field] = "";
  }
  entry.node.style.borderStyle = "";
  entry.node.style.borderWidth = "";
}

function resetAll() {
  for (const id of edits.keys()) resetOne(id);
}

function onMessage(e: MessageEvent) {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  const t = (data as { type?: unknown }).type;
  if (t === "arcade-studio:preview") {
    const { editId, field, value } = data as { editId?: number; field?: string; value?: string };
    if (typeof editId === "number" && typeof field === "string" && typeof value === "string") {
      applyPreview(editId, field, value);
    }
  } else if (t === "arcade-studio:preview-reset") {
    const { editId, all } = data as { editId?: number; all?: boolean };
    if (all) resetAll();
    else if (typeof editId === "number") resetOne(editId);
  }
}

/** In-place text editing: double-click a captured, text-editable leaf to edit. */
function onDblClick(e: MouseEvent) {
  const node = e.target as HTMLElement | null;
  if (!node) return;
  const idAttr = node.getAttribute?.(EDIT_ID_ATTR);
  if (!idAttr) return;
  const editId = Number(idAttr);
  if (!edits.has(editId) || !isTextEditable(node)) return;
  e.preventDefault();
  e.stopPropagation();
  node.setAttribute("contenteditable", "true");
  node.focus();
  const finish = () => {
    node.removeAttribute("contenteditable");
    node.removeEventListener("blur", finish);
    try {
      window.parent?.postMessage(
        { type: "arcade-studio:text-changed", editId, text: ownText(node) }, "*",
      );
    } catch { /* ignore */ }
  };
  node.addEventListener("blur", finish);
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onMessage);
  document.addEventListener("dblclick", onDblClick, true);
}
```

- [ ] **Step 4: Run the inspector test green**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: PASS (all groups, incl. the container-regression test).

- [ ] **Step 5: Modify `picker.ts` — capture + stay active**

In `studio/src/frame/picker.ts`:

The import already reads `import { capture, type StyleSnapshot } from "./inspector";`. Change it to:
```ts
import { capture } from "./inspector";
```
(The `PickerSelection` interface no longer carries `styles` directly — see below.)

Change the `PickerSelection` interface to the message payload shape:
```ts
interface PickerSelection {
  editId: number;
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  textEditable: boolean;
  styles: import("./inspector").StyleSnapshot;
}
```

In `resolveSelection`, the current success return is:
```ts
        return { ...parsed, componentName, tagName, styles: capture(domNode) };
```
Replace with:
```ts
        const cap = capture(domNode);
        return {
          ...parsed, componentName, tagName,
          editId: cap.editId, textEditable: cap.textEditable, styles: cap.styles,
        };
```

In `onClick`, the success branch currently is:
```ts
  flashOutlineAndFinish(true, () => {
    postPicked(sel);
    deactivate();
  });
```
Replace with (stay active for the next pick — bulk):
```ts
  flashOutlineAndFinish(true, () => {
    postPicked(sel);
    // Do NOT deactivate — bulk editing keeps the picker live until the panel
    // is closed/committed/discarded (parent sends frame-pick-stop) or Escape.
  });
```

Leave `onKeyDown` (Escape → deactivate) and `onParentMessage` (`frame-pick-stop` → deactivate) unchanged — those remain the ways picking ends.

- [ ] **Step 6: Verify the bootstrap import is present**

Confirm `studio/server/plugins/frameMountPlugin.ts` still contains
`import "arcade-studio/frame/inspector";` near the `picker` import (~line 237).
No change needed; just confirm. If absent, add it after the picker import.

- [ ] **Step 7: Run inspector test + the frame/picker-related suite**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: PASS.
Then run the full suite to surface rename fallout (expected red in consumer files until Tasks 4-6):
Run: `pnpm run studio:test 2>&1 | tail -20`
Expected: failures ONLY in files importing the old `targetSelectionContext` path (PromptInput, FrameCard, Viewport, ProjectDetail, InspectorPanel, SaveComponentModal + their tests). Note them; do not fix here. inspector + editSessionContext tests PASS.

- [ ] **Step 8: Commit**

```bash
git add studio/src/frame/inspector.ts studio/src/frame/picker.ts studio/__tests__/frame/inspector-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): multi-element capture map + in-place text + bug fix

inspector.ts keys retained nodes by stamped editId, previews each independently,
and edits text via contenteditable on leaf nodes only — never textContent on a
container (fixes the disappearing-block bug). picker.ts stays active after a
pick for bulk selection and reports editId + textEditable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rewrite visualEditPreamble for a batch

**Files:**
- Rewrite: `studio/src/lib/visualEditPreamble.ts`
- Test: `studio/__tests__/lib/visualEditPreamble.test.ts` (rewrite)

**Interfaces:**
- Consumes: `EditedElement`, `StyleSnapshot` (Task 1).
- Produces: `export function buildVisualEditPreamble(elements: EditedElement[], frameRel: string): string`. `frameRel` is the relative `frames/...` path (caller derives it once from any element's `file`). Returns "" if no element has any pending change.

- [ ] **Step 1: Write the failing test**

Rewrite `studio/__tests__/lib/visualEditPreamble.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildVisualEditPreamble } from "../../src/lib/visualEditPreamble";
import type { EditedElement, StyleSnapshot } from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)",
  borderColor: "rgb(0,0,0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
};
function el(editId: number, pending: EditedElement["pending"], over: Partial<StyleSnapshot> = {}): EditedElement {
  return {
    selection: {
      editId, file: "/p/frames/home/index.tsx", line: editId * 10, column: 3,
      componentName: "Button", tagName: "button", textEditable: true,
      styles: { ...STYLES, ...over },
    },
    pending,
  };
}

describe("buildVisualEditPreamble (batch)", () => {
  it("returns '' when no element has pending changes", () => {
    expect(buildVisualEditPreamble([el(1, {}), el(2, {})], "home/index.tsx")).toBe("");
  });

  it("lists each changed element with its line:column and changes", () => {
    const out = buildVisualEditPreamble(
      [el(1, { fontSize: "18px" }), el(2, { color: "rgb(37,99,235)" })],
      "home/index.tsx",
    );
    expect(out).toContain("frames/home/index.tsx");
    expect(out).toContain(":10:3");
    expect(out).toContain("font size: 14px -> 18px");
    expect(out).toContain(":20:3");
    expect(out).toContain("text color: rgb(0,0,0) -> rgb(37,99,235)");
  });

  it("skips elements with no pending changes but keeps changed ones", () => {
    const out = buildVisualEditPreamble([el(1, {}), el(2, { fontSize: "20px" })], "home/index.tsx");
    expect(out).toContain(":20:3");
    expect(out).not.toContain(":10:3");
  });

  it("renders a text change in quotes and demands token-idiomatic output", () => {
    const out = buildVisualEditPreamble([el(1, { text: "Submit" })], "home/index.tsx");
    expect(out).toContain(`text content: "Save" -> "Submit"`);
    expect(out).toMatch(/Tailwind|token/i);
    expect(out).toContain("Edit");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/lib/visualEditPreamble.test.ts`
Expected: FAIL — signature mismatch / `editSessionContext` import.

- [ ] **Step 3: Rewrite the function**

Replace the entire contents of `studio/src/lib/visualEditPreamble.ts`:

```ts
import type { EditedElement, StyleSnapshot } from "../hooks/editSessionContext";

const LABELS: Record<keyof StyleSnapshot, string> = {
  text: "text content", fontSize: "font size", fontWeight: "font weight",
  fontStyle: "font style", textAlign: "text align", color: "text color",
  backgroundColor: "background color", borderColor: "border color",
  paddingTop: "padding top", paddingRight: "padding right",
  paddingBottom: "padding bottom", paddingLeft: "padding left",
  marginTop: "margin top", marginRight: "margin right",
  marginBottom: "margin bottom", marginLeft: "margin left",
  gap: "gap", width: "width", height: "height",
};

function elementBlock(e: EditedElement): string | null {
  const keys = (Object.keys(e.pending) as (keyof StyleSnapshot)[]).filter(
    (k) => e.pending[k] !== undefined,
  );
  if (keys.length === 0) return null;
  const s = e.selection;
  const label =
    s.tagName && s.tagName !== s.componentName
      ? `<${s.tagName}> inside <${s.componentName}>`
      : `<${s.componentName}>`;
  const lines = keys.map((k) => {
    const from = s.styles[k];
    const to = e.pending[k] as string;
    return k === "text"
      ? `  - text content: "${from}" -> "${to}"`
      : `  - ${LABELS[k]}: ${from} -> ${to}`;
  });
  return [`Element ${label} at line ${s.line}:${s.column}:`, ...lines].join("\n");
}

/**
 * Serialize a whole batch of edited elements (all in one frame file) into a
 * single Claude instruction. Pure + deterministic. Returns "" if nothing changed.
 */
export function buildVisualEditPreamble(elements: EditedElement[], frameRel: string): string {
  const blocks = elements.map(elementBlock).filter((b): b is string => b !== null);
  if (blocks.length === 0) return "";
  return [
    `Apply these visual changes in frames/${frameRel}. Read the file first — do not edit from memory.`,
    "",
    ...blocks.flatMap((b) => [b, ""]),
    "Apply each change ONLY to the element identified by its line:column; do not modify unrelated parts of the file or other files.",
    "",
    "Express every change with idiomatic Tailwind utility classes and arcade-gen design tokens (e.g. text-(--fg-...), bg-(--bg-...), p-4, text-lg, font-semibold) — map raw px/colors to the nearest token or scale step. Do NOT write raw hex or inline style props.",
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit reports zero or multiple matches, widen the surrounding context and retry, or fall back to Write with the full new file contents.",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run green**

Run: `pnpm run studio:test __tests__/lib/visualEditPreamble.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/visualEditPreamble.ts studio/__tests__/lib/visualEditPreamble.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): batch preamble — multiple elements, one instruction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite InspectorPanel — batch list, focused controls, resize, in-place text

**Files:**
- Rewrite: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/InspectorPanel.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `useEditSession()` (Task 1), `buildVisualEditPreamble` (Task 3).
- Produces: `export function InspectorPanel({ onSend, busy }: { onSend: (prompt: string, images?: string[]) => void; busy: boolean }): JSX.Element | null`. Renders null when `inspectorOpen` is false.
- Behavior:
  - Width = `inspectorWidth` from context; left-edge drag handle updates it (clamp 280–560).
  - When batch is empty: empty state "Click elements in the frame to edit them."
  - Batch list at top: one row per element ("`<tag>` · N changes", × to remove, click to focus). Focused row highlighted.
  - Focused element's controls: Typography / Color / Spacing&size (NO Text input — text is edited in place in the frame). For a `textEditable` focused element show a hint "Double-click the element in the frame to edit its text."
  - Each control change → `setField(focusedEditId, key, value)` (or `resetField` if back to original/empty) → post `{type:"arcade-studio:preview", editId, field, value}` to `frameWindow`.
  - Listens for `arcade-studio:text-changed {editId, text}` → `setField(editId, "text", text)`.
  - Commit: `buildVisualEditPreamble(batch, frameRel)` where `frameRel` derived from the first batch element's `file`; if "" → discard; else `onSend(preamble, [])` + post `{type:"arcade-studio:preview-reset", all:true}` + `clear()`.
  - Discard / close (×): post `{type:"arcade-studio:preview-reset", all:true}` + `clear()`.

- [ ] **Step 1: Write the failing test**

Rewrite `studio/__tests__/components/InspectorPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
} from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
};
function sel(editId: number): ElementSelection {
  return {
    editId, file: "/p/frames/home/index.tsx", line: editId, column: 1,
    componentName: "Button", tagName: "button", textEditable: true, styles: STYLES,
  };
}
function Harness({ onSend }: { onSend: any }) {
  const ctx = useEditSession();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.addOrFocus(sel(1), "home", null); }}>open1</button>
      <button onClick={() => ctx.addOrFocus(sel(2), "home", null)}>add2</button>
      <InspectorPanel onSend={onSend} busy={false} />
      <span data-testid="count">{ctx.batch.length}</span>
      <span data-testid="focused">{ctx.focusedEditId ?? ""}</span>
    </>
  );
}
afterEach(cleanup);

describe("InspectorPanel (batch)", () => {
  it("renders null when inspector closed", () => {
    render(<EditSessionProvider><InspectorPanel onSend={vi.fn()} busy={false} /></EditSessionProvider>);
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("seeds focused controls and records a pending edit on the focused element", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    const fontSize = screen.getByLabelText(/font size/i) as HTMLInputElement;
    expect(fontSize.value).toBe("14");
    fireEvent.change(fontSize, { target: { value: "18" } });
    // batch element #1 now has the pending change; commit proves it (below)
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("shows a batch list with two elements after a second pick", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    fireEvent.click(screen.getByText("add2"));
    expect(screen.getByTestId("count").textContent).toBe("2");
    // two list rows labelled by tag
    expect(screen.getAllByText(/button/i).length).toBeGreaterThanOrEqual(2);
  });

  it("Commit sends a preamble with the batch change then clears", () => {
    const onSend = vi.fn();
    render(<EditSessionProvider><Harness onSend={onSend} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "18" } });
    fireEvent.click(screen.getByText(/Commit/i));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain("font size: 14px -> 18px");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("does NOT render a Text input (text is edited in place)", () => {
    render(<EditSessionProvider><Harness onSend={vi.fn()} /></EditSessionProvider>);
    fireEvent.click(screen.getByText("open1"));
    expect(screen.queryByLabelText(/text content/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Expected: FAIL — module imports `editSessionContext`/new API not present.

- [ ] **Step 3: Implement the panel**

Replace the entire contents of `studio/src/components/inspector/InspectorPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Button } from "@xorkavi/arcade-gen";
import {
  useEditSession, type StyleSnapshot, type PendingEdits, type EditedElement,
} from "../../hooks/editSessionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";

const MIN_W = 280, MAX_W = 560;

function toNumberInput(v: string): string { return v.endsWith("px") ? v.slice(0, -2) : v; }
function fromNumberInput(v: string): string { return v === "" ? "" : `${v}px`; }
function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}
function countChanges(e: EditedElement): number {
  return Object.values(e.pending).filter((v) => v !== undefined).length;
}

const SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--stroke-neutral-subtle)", padding: "12px 14px",
  display: "flex", flexDirection: "column", gap: 10,
};
const LABEL: React.CSSProperties = {
  fontSize: 11, color: "var(--fg-neutral-subtle)", textTransform: "uppercase", letterSpacing: 0.4,
};
const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const COL_LABEL: React.CSSProperties = { width: 84, fontSize: 12, color: "var(--fg-neutral-medium)", flex: "none" };
const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)", fontSize: 12,
};

export function InspectorPanel({
  onSend, busy,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
}) {
  const {
    batch, focusedEditId, frameWindow, inspectorOpen, inspectorWidth,
    setField, resetField, removeElement, focus, clear, setInspectorWidth,
  } = useEditSession();
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // In-place text edits arrive from the iframe as text-changed messages.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "arcade-studio:text-changed") return;
      if (typeof d.editId === "number" && typeof d.text === "string") {
        setField(d.editId, "text", d.text);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [setField]);

  // Resize drag (mirrors the chat-pane handle in ProjectDetail).
  useEffect(() => {
    if (!resizeRef.current) return;
    function onMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
      // Panel is on the RIGHT, handle on its LEFT edge → dragging left widens.
      const next = s.startWidth + (s.startX - e.clientX);
      setInspectorWidth(Math.min(MAX_W, Math.max(MIN_W, next)));
    }
    function onUp() { resizeRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  });

  if (!inspectorOpen) return null;

  const focused = batch.find((e) => e.selection.editId === focusedEditId) ?? null;

  function change(key: keyof StyleSnapshot, rawValue: string) {
    if (!focused) return;
    const id = focused.selection.editId;
    const original = focused.selection.styles[key];
    if (rawValue === original || rawValue === "") resetField(id, key);
    else setField(id, key, rawValue);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", editId: id, field: key, value: rawValue || original }, "*",
    );
  }
  function discard() {
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  function commit() {
    if (batch.length === 0) { discard(); return; }
    const frameRel = batch[0].selection.file.split("/frames/").pop() ?? batch[0].selection.file;
    const preamble = buildVisualEditPreamble(batch, frameRel);
    if (!preamble) { discard(); return; }
    onSend(preamble, []);
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
    clear();
  }
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: inspectorWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const totalChanges = batch.reduce((n, e) => n + countChanges(e), 0);
  const styles = focused?.selection.styles;
  const pending = focused?.pending ?? {};

  return (
    <aside
      style={{
        width: inspectorWidth, borderLeft: "1px solid var(--stroke-neutral-subtle)",
        background: "var(--surface-overlay)", display: "flex", flexDirection: "column",
        minHeight: 0, overflow: "hidden", position: "relative",
      }}
    >
      {/* left-edge resize handle */}
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize inspector"
        onMouseDown={startResize}
        style={{ position: "absolute", top: 0, left: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 2 }}
      />
      <div style={{
        height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 14px", borderBottom: "1px solid var(--stroke-neutral-subtle)",
        fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)",
      }}>
        <span>Edit elements{batch.length ? ` (${batch.length})` : ""}</span>
        <button type="button" onClick={discard} aria-label="Close inspector"
          style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {batch.length === 0 ? (
          <div style={{ padding: 24, color: "var(--fg-neutral-subtle)", fontSize: 13, textAlign: "center" }}>
            Click elements in the frame to edit them.
          </div>
        ) : (
          <>
            {/* batch list */}
            <div style={{ ...SECTION, borderTop: "none" }}>
              <span style={LABEL}>Edited elements</span>
              {batch.map((e) => {
                const isFocused = e.selection.editId === focusedEditId;
                const n = countChanges(e);
                return (
                  <div key={e.selection.editId} style={{
                    ...FIELD_ROW, justifyContent: "space-between", padding: "4px 8px", borderRadius: 6,
                    background: isFocused ? "var(--bg-neutral-soft)" : "transparent", cursor: "pointer",
                  }} onClick={() => focus(e.selection.editId)}>
                    <span style={{ fontSize: 12, color: "var(--fg-neutral-prominent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      &lt;{e.selection.tagName || e.selection.componentName}&gt;{n ? ` · ${n}` : ""}
                    </span>
                    <button type="button" aria-label={`Remove element ${e.selection.editId}`}
                      onClick={(ev) => { ev.stopPropagation(); removeElement(e.selection.editId); }}
                      style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>

            {focused && styles && (
              <>
                {focused.selection.textEditable && (
                  <div style={{ ...SECTION }}>
                    <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                      Double-click the element in the frame to edit its text.
                    </span>
                  </div>
                )}

                {/* Typography */}
                <div style={SECTION}>
                  <span style={LABEL}>Typography</span>
                  <div style={FIELD_ROW}>
                    <label htmlFor="ins-fontSize" style={COL_LABEL}>Font size</label>
                    <input id="ins-fontSize" type="number" aria-label="Font size" style={INPUT}
                      value={toNumberInput(fieldValue(styles, pending, "fontSize"))}
                      onChange={(e) => change("fontSize", fromNumberInput(e.target.value))} />
                  </div>
                  <div style={FIELD_ROW}>
                    <label htmlFor="ins-fontWeight" style={COL_LABEL}>Weight</label>
                    <select id="ins-fontWeight" aria-label="Font weight" style={INPUT}
                      value={fieldValue(styles, pending, "fontWeight")}
                      onChange={(e) => change("fontWeight", e.target.value)}>
                      {["300","400","500","600","700"].map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div style={FIELD_ROW}>
                    <label htmlFor="ins-textAlign" style={COL_LABEL}>Align</label>
                    <select id="ins-textAlign" aria-label="Text align" style={INPUT}
                      value={fieldValue(styles, pending, "textAlign")}
                      onChange={(e) => change("textAlign", e.target.value)}>
                      {["left","center","right","justify"].map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div style={FIELD_ROW}>
                    <label htmlFor="ins-fontStyle" style={COL_LABEL}>Italic</label>
                    <input id="ins-fontStyle" type="checkbox" aria-label="Italic"
                      checked={fieldValue(styles, pending, "fontStyle") === "italic"}
                      onChange={(e) => change("fontStyle", e.target.checked ? "italic" : "normal")} />
                  </div>
                </div>

                {/* Color */}
                <div style={SECTION}>
                  <span style={LABEL}>Color</span>
                  {(["color","backgroundColor","borderColor"] as const).map((key) => (
                    <div style={FIELD_ROW} key={key}>
                      <label htmlFor={`ins-${key}`} style={COL_LABEL}>
                        {key === "color" ? "Text" : key === "backgroundColor" ? "Fill" : "Border"}
                      </label>
                      <input id={`ins-${key}`} aria-label={key} style={INPUT}
                        value={fieldValue(styles, pending, key)}
                        onChange={(e) => change(key, e.target.value)} />
                    </div>
                  ))}
                </div>

                {/* Spacing & size */}
                <div style={SECTION}>
                  <span style={LABEL}>Spacing &amp; size</span>
                  {(["paddingTop","paddingRight","paddingBottom","paddingLeft","marginTop","marginRight","marginBottom","marginLeft","gap","width","height"] as const).map((key) => (
                    <div style={FIELD_ROW} key={key}>
                      <label htmlFor={`ins-${key}`} style={COL_LABEL}>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</label>
                      <input id={`ins-${key}`} type="number" aria-label={key} style={INPUT}
                        value={toNumberInput(fieldValue(styles, pending, key))}
                        onChange={(e) => change(key, fromNumberInput(e.target.value))} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Discard</Button>
        <Button variant="primary" onClick={commit} disabled={totalChanges === 0 || busy}>Commit</Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run green**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): batch panel — element list, focused controls, resize

No Text input (text edited in place in the frame). Left-edge drag handle
resizes; default 360px. Listens for text-changed from the iframe.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rewire consumers — FrameCard, PromptInput, Viewport, SaveComponentModal

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Modify: `studio/src/components/viewport/Viewport.tsx`
- Modify: `studio/src/components/assets/SaveComponentModal.tsx`
- Test: `studio/__tests__/components/frameCard.test.tsx` (update import + mock), plus any test importing the old context path.

**Interfaces:**
- Consumes: `useEditSession()` (Task 1), `capture`-driven message shape (Task 2: `frame-picked` now carries `selection: ElementSelection` with `editId`/`textEditable`).
- Produces: picking adds/focuses into the batch and keeps the picker active; PromptInput no longer references the edit context; Viewport removes a deleted frame's elements from the batch; SaveComponentModal accepts `ElementSelection`.

- [ ] **Step 1: Update SaveComponentModal to ElementSelection**

In `studio/src/components/assets/SaveComponentModal.tsx`, change the import + prop type:
```ts
import { type TargetSelection } from "../../hooks/targetSelectionContext";
```
→
```ts
import { type ElementSelection } from "../../hooks/editSessionContext";
```
and the prop `target: TargetSelection;` → `target: ElementSelection;`. The fields used (`componentName`, `tagName`, `frameSlug`?, `line`, `column`) — note `ElementSelection` does NOT carry `frameSlug` (the batch holds frameSlug at the session level, not per element). Check the modal's POST body (it referenced `target.frameSlug`). Replace `target.frameSlug` usage: add a `frameSlug: string` prop to `SaveComponentModal` and pass it from FrameCard (which knows `frame.slug`). Update the modal's props interface + the POST body to use the new `frameSlug` prop.

- [ ] **Step 2: Rewrite FrameCard pick wiring**

In `studio/src/components/viewport/FrameCard.tsx`:

Replace the context import:
```ts
import { useTargetSelection } from "../../hooks/targetSelectionContext";
```
→
```ts
import { useEditSession } from "../../hooks/editSessionContext";
```

Replace the destructure (line ~64):
```ts
const { target, setTarget, setInspectorOpen, setFrameWindow, clear, frameWindow } = useTargetSelection();
```
→
```ts
const { batch, frameSlug: sessionFrameSlug, addOrFocus, setInspectorOpen, clear, frameWindow } = useEditSession();
```

The `frame-picked` message handler currently parses `sel` as the old shape and calls `setTarget`. Replace its body so it reads the new `selection: ElementSelection` and routes to the batch, with the cross-frame guard:
```ts
      if (t === "arcade-studio:frame-picked") {
        const selection = (data as { selection?: import("../../hooks/editSessionContext").ElementSelection }).selection;
        if (selection) {
          const win = iframeRef.current?.contentWindow ?? null;
          // Cross-frame guard: a batch is single-frame. If the user picks in a
          // different frame than the active batch, reset the old frame's
          // previews and start fresh in this frame.
          if (sessionFrameSlug && sessionFrameSlug !== frame.slug) {
            frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
            clear();
          }
          addOrFocus(selection, frame.slug, win);
          setInspectorOpen(true);
        }
        // NOTE: do NOT setPicking(false) — bulk picking stays active.
      }
```
(Keep the `frame-pick-cancelled` branch as-is. Remove the `setPicking(false)` that was in the picked branch — picking continues. The effect should keep `picking` true across picks; only the crosshair toggle / Escape / panel close stops it.)

Update the inline `isTargetedFrame` logic (line ~184) — it used `target`. Replace with batch-aware:
```ts
const isTargetedFrame = sessionFrameSlug === frame.slug && batch.length > 0;
```
Update the crosshair tooltip/aria that referenced `target?.componentName` to a generic string (e.g. `Editing ${batch.length} element(s) — click to clear`). Update the crosshair `onClick` three-state:
```ts
              onClick={() => {
                if (picking) { setPicking(false); setInspectorOpen(false); return; }
                if (isTargetedFrame) { clear(); return; }
                setInspectorOpen(true); setPicking(true);
              }}
```
Update the Save-as-component block (line ~392) — it used `target`. Use the focused batch element. Add near the top of the component:
```ts
const focusedSelection = batch.find((e) => e.selection.editId === /* focused */ undefined)?.selection ?? batch[batch.length - 1]?.selection ?? null;
```
Simpler: the Save-as-component button should save the LAST-picked element. Use `batch[batch.length - 1]?.selection`. Render the modal with `target={lastSel}` and `frameSlug={frame.slug}` when `isTargetedFrame && lastSel`. (The Save-as-component flow is orthogonal to bulk style editing — it saves one element as a reusable component. Wire it to the most-recently focused element.)

> **Implementer note:** FrameCard is the biggest rewire. Read the whole file first. The pick effect's dependency array must include the new context fns used in the handler (`addOrFocus`, `setInspectorOpen`, `clear`, `frameWindow`, `sessionFrameSlug`). Keep the iframe `postMessage` pick-start/stop effect intact.

- [ ] **Step 3: Strip the edit context from PromptInput**

In `studio/src/components/chat/PromptInput.tsx`:
- Remove the import line `import { useTargetSelection, type TargetSelection } from "../../hooks/targetSelectionContext";`.
- Remove the `buildTargetPreamble` function (lines ~47-61).
- Remove `const { target, clear: clearTarget } = useTargetSelection();` (line ~70).
- In `submit()` (line ~215) change `const finalPrompt = target ? \`${buildTargetPreamble(target)}${p}\` : p;` → `const finalPrompt = p;`.
- Remove `clearTarget();` (line ~233).
- In the `attachments` prop (line ~348), remove `target` from the condition and remove the `{target && <TargetChip .../>}` block.
- Remove the `TargetChip` function (lines ~408-447).

- [ ] **Step 4: Update Viewport frame-delete**

In `studio/src/components/viewport/Viewport.tsx`:
- Replace import `import { useTargetSelection } from "../../hooks/targetSelectionContext";` → `import { useEditSession } from "../../hooks/editSessionContext";`.
- Replace `const { target, setTarget } = useTargetSelection();` → `const { frameSlug, clear } = useEditSession();`.
- The frame-delete handler (line ~68) `if (target?.frameSlug === frameSlug) setTarget(null);` → `if (frameSlug === <deletedFrameSlug>) clear();` (match the variable name in scope — read the handler; the local is the slug being deleted). This clears the whole batch if its frame is deleted (acceptable: the batch is single-frame).

- [ ] **Step 5: Fix remaining old-path imports in tests**

Update `studio/__tests__/components/frameCard.test.tsx`: change any `targetSelectionContext` import to `editSessionContext`, and the mocked context value to the new API (`addOrFocus`, `batch: []`, `setInspectorOpen`, `clear`, `frameWindow`, `frameSlug`). The wipe-animation tests don't exercise picking, so a minimal stub object is fine.
Grep for any other test importing the old path and update:
```
grep -rl "targetSelectionContext" studio/__tests__ studio/src
```
Every hit must move to `editSessionContext` (there should be none left in `src` after Tasks 1-5).

- [ ] **Step 6: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS, no remaining references to the old context. If a test built a `TargetSelection`/old-API literal, update it to the new `ElementSelection`/batch shape (assert the new behavior, don't weaken).

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/viewport/FrameCard.tsx studio/src/components/chat/PromptInput.tsx studio/src/components/viewport/Viewport.tsx studio/src/components/assets/SaveComponentModal.tsx studio/__tests__/components/frameCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): rewire consumers to batch editing; drop chat target chip

FrameCard adds picks into the batch and keeps the picker active (with a
cross-frame guard); PromptInput's TargetChip/buildTargetPreamble removed (the
inspector is the one edit surface); Viewport clears the batch when its frame is
deleted; SaveComponentModal takes ElementSelection + an explicit frameSlug.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: ProjectDetail — rename import + width-driven grid track

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`

**Interfaces:**
- Consumes: `EditSessionProvider`, `useEditSession` (Task 1); `InspectorPanel` (Task 4).
- Produces: provider renamed, inspector column width driven by `inspectorWidth`.

- [ ] **Step 1: Rename the provider import + usage**

In `studio/src/routes/ProjectDetail.tsx`:
- Change `import { TargetSelectionProvider, useTargetSelection } from "../hooks/targetSelectionContext";` → `import { EditSessionProvider, useEditSession } from "../hooks/editSessionContext";`.
- Replace `<TargetSelectionProvider>` / `</TargetSelectionProvider>` with `<EditSessionProvider>` / `</EditSessionProvider>`.
- Replace the `const { inspectorOpen } = useTargetSelection();` call (in `ProjectDetailShell`) → `const { inspectorOpen, inspectorWidth } = useEditSession();`.

- [ ] **Step 2: Width-driven grid track**

The grid template currently appends `${inspectorOpen ? " auto" : ""}`. Change it to use the width:
```ts
gridTemplateColumns: `${chatOpen ? `${chatWidth}px` : "0px"} 1fr${devOpen ? " auto" : ""}${inspectorOpen ? ` ${inspectorWidth}px` : ""}`,
```
(The panel's own `width: inspectorWidth` and the grid track now agree, and the resize handle updates both via context.)

- [ ] **Step 3: Full suite + type sanity**

Run: `pnpm run studio:test`
Expected: PASS (no remaining `targetSelectionContext` references anywhere).
Run: `grep -rn "targetSelectionContext" studio/src studio/__tests__ || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add studio/src/routes/ProjectDetail.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): wire EditSessionProvider + width-driven inspector column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Restart the app** (Task 2 touched the frame bootstrap import path indirectly; do a clean restart). `pnpm run studio` → `localhost:5556`.

- [ ] **Step 2: Bug gone.** Open a project with a frame that has a container block (a card with children). Click the crosshair, then click the container. Expected: it is selected and **does NOT disappear**. Repeat clicking several elements — none vanish.

- [ ] **Step 3: Bulk select.** With the picker active, click element A, change its font size (frame updates live). Without leaving pick mode, click element B, change its color. Expected: the panel shows a 2-element list; both previews are visible in the frame simultaneously; the list shows change counts.

- [ ] **Step 4: Focus + remove.** Click element A's row in the list → panel shows A's controls. Click the × on B's row → B reverts in the frame and leaves the list.

- [ ] **Step 5: In-place text.** Pick a text element (button/heading). **Double-click** it in the frame → caret appears; type new text; click away. Expected: text updates live; the element's row shows a change. (Double-clicking a container does nothing.)

- [ ] **Step 6: Resize + width.** Drag the panel's left edge → it widens/narrows (clamped). Labels and inputs no longer collide at the default width. Reload → width persists is NOT required (context-only is fine for v1; note if you want localStorage later).

- [ ] **Step 7: Commit the batch.** Click Commit. Expected: one chat turn runs; Claude rewrites the frame source for ALL edited elements; the frame hot-reloads from real code; the panel clears. Open the frame source — confirm Tailwind classes / tokens, not raw hex/inline styles.

- [ ] **Step 8: Cross-frame guard.** Edit an element in frame A, then (still picking) click an element in frame B. Expected: a prompt/confirm to commit-or-discard A's batch first, then a fresh batch starts in B. (If implemented as auto-reset+clear without a prompt per the FrameCard code, verify A reverts and B starts clean — note which behavior shipped.)

- [ ] **Step 9: Record results** in the PR description (before/after screenshots, the committed diff). No commit for this task.

---

## Self-Review

**Spec coverage:**
- Bug fix by construction (no container textContent) → Task 2 (`resetOne` never touches textContent; regression test). ✓
- In-place double-click text editing → Task 2 (`onDblClick` + contenteditable + text-changed) + Task 4 (listener → setField + hint, no Text input). ✓
- Bulk batch, editId, add/focus/remove, same-frame, commit-all → Tasks 1, 4, 5. ✓
- Switch+list panel UX → Task 4. ✓
- Cross-frame guard → Task 5 (FrameCard handler). ✓
- Panel resize + wider default (360) → Tasks 1 (width state), 4 (handle), 6 (grid track). ✓
- Drop chat chip → Task 5 (PromptInput strip). ✓
- Rename context → Tasks 1, 5, 6. ✓
- Commit through existing onSend / token-idiomatic → Task 3 + Task 4 commit(). ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. One spot (Task 5 Step 2 Save-as-component "focused element") gives an explicit rule: use `batch[batch.length - 1]?.selection`. Tests have real assertions.

**Type consistency:** `editId: number` everywhere. `ElementSelection`/`EditedElement`/`StyleSnapshot` defined in Task 1, re-declared structurally in Task 2's inspector.ts (documented boundary), consumed by Tasks 3/4/5. `buildVisualEditPreamble(elements, frameRel)` signature consistent Task 3 (def) ↔ Task 4 (call). Message verbs `arcade-studio:preview {editId,field,value}`, `arcade-studio:preview-reset {editId}|{all}`, `arcade-studio:text-changed {editId,text}`, `arcade-studio:frame-picked {selection}` consistent across Task 2 (iframe) ↔ Task 4/5 (shell). Context API names (`addOrFocus`, `focus`, `removeElement`, `setField`, `resetField`, `clear`, `setInspectorOpen`, `setInspectorWidth`, `frameSlug`, `frameWindow`, `inspectorWidth`, `batch`, `focusedEditId`) consistent across Tasks 1/4/5/6.

**Known risk flagged for implementer:** Task 5 (FrameCard) is the largest rewire — read the whole file, keep the pick-start/stop effect intact, update the effect dep array. The cross-frame guard ships as auto-reset+clear (not a modal prompt) to keep the diff bounded; Task 7 Step 8 notes verifying whichever behavior shipped. A modal confirm can be a follow-up if the auto-reset feels abrupt in manual testing.
