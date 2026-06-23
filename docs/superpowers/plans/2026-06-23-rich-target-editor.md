# Rich Target Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side visual inspector that lets a user edit a picked frame element's Text / Typography / Color / Spacing with live inline preview, then commit the batch to idiomatic source via the existing Claude chat pipeline.

**Architecture:** Extends the existing element picker (`studio/src/frame/picker.ts`) and target context (`studio/src/hooks/targetSelectionContext.tsx`). A new in-iframe `inspector.ts` retains the picked DOM node, reads its computed styles, and applies throwaway inline-style previews on message. A new shell-side `InspectorPanel.tsx` renders the controls, stores pending edits in the (extended) target context, posts preview messages to the targeted frame's window, and on Commit serializes pending edits via a pure `buildVisualEditPreamble()` into the existing `send()` chat path. No new server endpoint, no managed stylesheet, no MCP.

**Tech Stack:** React 19, TypeScript, Vite, `@xorkavi/arcade-gen` (design-system components + tokens), Vitest + jsdom + @testing-library/react. Package manager **pnpm**.

## Global Constraints

- **pnpm only** — never `npm`/`yarn` (breaks lockfile).
- **Run tests:** `pnpm run studio:test <path>` for a single file; `pnpm run studio:test` for the full suite (~90s). Run from the **repo root**, not `studio/`.
- **Commits:** Conventional Commits, scope `studio/<area>`, e.g. `feat(studio/inspector): ...`. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — stage explicit paths only (repo root has loose untracked files).
- **Vite middleware/plugins do NOT hot-reload.** Editing `server/plugins/frameMountPlugin.ts` requires a full restart of `pnpm run studio`.
- **Dev-only feature.** Picker/inspector use React internals + iframe introspection — same dev-only constraint as today's `picker.ts`. Manual verification runs under `pnpm run studio`.
- **Tokens, not hex.** Committed source must use Tailwind utilities + arcade-gen design tokens (the whole reason commit goes through Claude). Live preview may use raw CSS values; only the commit path must be idiomatic.
- **Component tests** run with `// @vitest-environment jsdom` and `vi.mock("@xorkavi/arcade-gen", ...)` exporting only the symbols the component uses.

---

## File Structure

- **Create** `studio/src/frame/inspector.ts` — in-iframe: retain picked node, read computed-style snapshot, apply/reset inline preview on `arcade-studio:preview` messages. ~120 lines.
- **Create** `studio/src/lib/visualEditPreamble.ts` — pure `buildVisualEditPreamble(target, pending)` → Claude instruction string. ~60 lines.
- **Create** `studio/src/components/inspector/InspectorPanel.tsx` — right-side panel UI + Commit/Discard. ~260 lines.
- **Modify** `studio/src/hooks/targetSelectionContext.tsx` — add `StyleSnapshot`, `styles` on `TargetSelection`, `pending` edits + setters, `inspectorOpen`, `frameWindow`.
- **Modify** `studio/src/frame/picker.ts` — on pick, call `inspector.capture(node, sel)` and include `styles` in the posted message (instead of discarding the node).
- **Modify** `studio/src/components/viewport/FrameCard.tsx` — on pick register the frame `Window` + open the inspector; crosshair opens inspector; clearing closes it.
- **Modify** `studio/src/routes/ProjectDetail.tsx` — mount `InspectorPanel` as a 4th grid column gated on `inspectorOpen`, passing `send`.
- **Modify** `studio/server/plugins/frameMountPlugin.ts:237` — add `import "arcade-studio/frame/inspector";` to the frame bootstrap.
- **Create** tests: `studio/__tests__/lib/visualEditPreamble.test.ts`, `studio/__tests__/hooks/targetSelectionContext.test.tsx`, `studio/__tests__/frame/inspector-snapshot.test.ts`, `studio/__tests__/components/InspectorPanel.test.tsx`.

### Shared types (defined in Task 1, consumed everywhere)

```ts
// studio/src/hooks/targetSelectionContext.tsx
export interface StyleSnapshot {
  text: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;       // "normal" | "italic"
  textAlign: string;       // "left" | "center" | "right" | "justify"
  color: string;           // rgb(...) as read from getComputedStyle
  backgroundColor: string;
  borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  width: string; height: string;
}

export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;
```

`PendingEdits` keys are exactly the `StyleSnapshot` keys (including `text`). A key present means "changed"; absent means "unchanged". This is the single representation used by the panel, the preview messages, and `buildVisualEditPreamble`.

---

### Task 1: Extend the target/edit-session context

**Files:**
- Modify: `studio/src/hooks/targetSelectionContext.tsx`
- Test: `studio/__tests__/hooks/targetSelectionContext.test.tsx`

**Interfaces:**
- Produces: `StyleSnapshot`, `PendingEdits` (types above); `TargetSelection` now includes `styles: StyleSnapshot`; context value `Ctx` with `{ target, setTarget, clear, pending, setPendingField, resetPendingField, clearPending, inspectorOpen, setInspectorOpen, frameWindow, setFrameWindow }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/hooks/targetSelectionContext.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  TargetSelectionProvider,
  useTargetSelection,
  type StyleSnapshot,
} from "../../src/hooks/targetSelectionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", width: "80px", height: "32px",
};

function wrap({ children }: { children: React.ReactNode }) {
  return <TargetSelectionProvider>{children}</TargetSelectionProvider>;
}

describe("targetSelectionContext", () => {
  it("sets a target with styles and reports inspector closed by default", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    expect(result.current.target).toBeNull();
    expect(result.current.inspectorOpen).toBe(false);
    act(() => {
      result.current.setTarget({
        file: "/frames/a/index.tsx", line: 10, column: 5,
        componentName: "Button", tagName: "button", frameSlug: "a", styles: STYLES,
      });
    });
    expect(result.current.target?.styles.fontSize).toBe("14px");
  });

  it("sets and resets a pending field", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    act(() => result.current.setPendingField("fontSize", "18px"));
    expect(result.current.pending.fontSize).toBe("18px");
    act(() => result.current.resetPendingField("fontSize"));
    expect(result.current.pending.fontSize).toBeUndefined();
  });

  it("clear() wipes target, pending, inspectorOpen and frameWindow", () => {
    const { result } = renderHook(() => useTargetSelection(), { wrapper: wrap });
    act(() => {
      result.current.setInspectorOpen(true);
      result.current.setPendingField("color", "rgb(1,2,3)");
    });
    act(() => result.current.clear());
    expect(result.current.target).toBeNull();
    expect(result.current.pending).toEqual({});
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.frameWindow).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/hooks/targetSelectionContext.test.tsx`
Expected: FAIL — `StyleSnapshot` / `setPendingField` not exported.

- [ ] **Step 3: Rewrite the context module**

Replace the entire contents of `studio/src/hooks/targetSelectionContext.tsx` with:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface StyleSnapshot {
  text: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  width: string; height: string;
}

export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;

export interface TargetSelection {
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  /** Slug of the frame the element was picked from. */
  frameSlug: string;
  /** Computed-style snapshot read at pick time, used to seed the panel. */
  styles: StyleSnapshot;
}

interface Ctx {
  target: TargetSelection | null;
  setTarget: (t: TargetSelection | null) => void;
  clear: () => void;
  pending: PendingEdits;
  setPendingField: (key: keyof StyleSnapshot, value: string) => void;
  resetPendingField: (key: keyof StyleSnapshot) => void;
  clearPending: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  frameWindow: Window | null;
  setFrameWindow: (w: Window | null) => void;
}

const TargetCtx = createContext<Ctx | null>(null);

export function TargetSelectionProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<TargetSelection | null>(null);
  const [pending, setPending] = useState<PendingEdits>({});
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [frameWindow, setFrameWindow] = useState<Window | null>(null);

  const value = useMemo<Ctx>(
    () => ({
      target,
      setTarget: (t) => {
        // Switching targets must drop any pending edits from the old one.
        setPending({});
        setTargetState(t);
      },
      clear: () => {
        setTargetState(null);
        setPending({});
        setInspectorOpen(false);
        setFrameWindow(null);
      },
      pending,
      setPendingField: (key, val) => setPending((p) => ({ ...p, [key]: val })),
      resetPendingField: (key) =>
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        }),
      clearPending: () => setPending({}),
      inspectorOpen,
      setInspectorOpen,
      frameWindow,
      setFrameWindow,
    }),
    [target, pending, inspectorOpen, frameWindow],
  );
  return <TargetCtx.Provider value={value}>{children}</TargetCtx.Provider>;
}

export function useTargetSelection(): Ctx {
  const ctx = useContext(TargetCtx);
  if (!ctx) {
    throw new Error("useTargetSelection must be used inside <TargetSelectionProvider>");
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/hooks/targetSelectionContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing FrameCard test to catch the breaking `styles` requirement**

Run: `pnpm run studio:test __tests__/components/frameCard.test.tsx`
Expected: It MAY fail if it constructs a `TargetSelection` without `styles`. If it fails, that is expected — Task 5 fixes FrameCard. If green, even better. Do NOT fix FrameCard here; note the result and continue.

- [ ] **Step 6: Commit**

```bash
git add studio/src/hooks/targetSelectionContext.tsx studio/__tests__/hooks/targetSelectionContext.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): extend target context with styles + pending edits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: In-iframe inspector (capture node + preview)

**Files:**
- Create: `studio/src/frame/inspector.ts`
- Test: `studio/__tests__/frame/inspector-snapshot.test.ts`

**Interfaces:**
- Consumes: `StyleSnapshot` (Task 1) — re-declared structurally here as the iframe module must not import from the shell tree across the bundle boundary; keep the field list identical to Task 1.
- Produces: `export function readStyleSnapshot(node: Element): StyleSnapshot`; `export function capture(node: HTMLElement): StyleSnapshot` (retains node + returns snapshot); a module-load `message` listener handling `arcade-studio:preview` `{ field, value }` and `arcade-studio:preview-reset`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/inspector-snapshot.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readStyleSnapshot } from "../../src/frame/inspector";

describe("readStyleSnapshot", () => {
  it("reads text content and the documented style fields", () => {
    const el = document.createElement("button");
    el.textContent = "Save";
    el.style.fontSize = "18px";
    el.style.paddingLeft = "12px";
    document.body.appendChild(el);

    const snap = readStyleSnapshot(el);
    expect(snap.text).toBe("Save");
    expect(snap.fontSize).toBe("18px");
    expect(snap.paddingLeft).toBe("12px");
    // every documented field must be present (string, never undefined)
    for (const key of [
      "text","fontSize","fontWeight","fontStyle","textAlign","color",
      "backgroundColor","borderColor","paddingTop","paddingRight","paddingBottom",
      "paddingLeft","marginTop","marginRight","marginBottom","marginLeft","width","height",
    ]) {
      expect(typeof (snap as Record<string, unknown>)[key]).toBe("string");
    }
  });

  it("uses only the element's own direct text, not descendant text", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `Hello <span>world</span>`;
    document.body.appendChild(wrap);
    // direct text node is "Hello " — descendant <span> text excluded
    expect(readStyleSnapshot(wrap).text).toBe("Hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: FAIL — cannot import `readStyleSnapshot`.

- [ ] **Step 3: Implement `inspector.ts`**

Create `studio/src/frame/inspector.ts`:

```ts
/**
 * In-iframe companion to picker.ts. After the picker resolves a clicked
 * element, it hands the DOM node here via `capture()`. We retain that node,
 * read a computed-style snapshot to seed the shell's inspector panel, and
 * apply throwaway INLINE-style previews when the parent posts
 * `arcade-studio:preview` messages.
 *
 * Why inline (not a managed stylesheet): Studio frames are className-styled
 * static prototypes and the picker intercepts clicks during a session, so
 * React never reconciles the `style` prop we set out-of-band. Preview is
 * disposable — the committed result always comes from the shell's `pending`
 * state, never read back from here.
 *
 * Dev-only: relies on the same iframe/React-internals constraints as picker.ts.
 */

export interface StyleSnapshot {
  text: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  width: string; height: string;
}

// CSS properties we preview (every key except `text`). Kept as a const so the
// message handler can validate incoming field names.
const STYLE_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "textAlign", "color",
  "backgroundColor", "borderColor", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "width", "height",
] as const;

/** Direct (own) text of an element, trimmed — descendant text excluded. */
function ownText(node: Element): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
  }
  return out.trim();
}

export function readStyleSnapshot(node: Element): StyleSnapshot {
  const cs = window.getComputedStyle(node);
  return {
    text: ownText(node),
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    textAlign: cs.textAlign,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    borderColor: cs.borderTopColor,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginRight: cs.marginRight,
    marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
    width: cs.width, height: cs.height,
  };
}

let editingNode: HTMLElement | null = null;
let originalSnapshot: StyleSnapshot | null = null;

/** Called by picker.ts on a successful pick. Retains the node + returns its snapshot. */
export function capture(node: HTMLElement): StyleSnapshot {
  editingNode = node;
  originalSnapshot = readStyleSnapshot(node);
  return originalSnapshot;
}

function applyField(field: string, value: string) {
  if (!editingNode) return;
  if (field === "text") {
    editingNode.textContent = value;
    return;
  }
  if ((STYLE_FIELDS as readonly string[]).includes(field)) {
    // border preview needs a visible style+width or color alone won't paint
    if (field === "borderColor" && editingNode.style.borderStyle === "") {
      editingNode.style.borderStyle = "solid";
      if (editingNode.style.borderWidth === "") editingNode.style.borderWidth = "1px";
    }
    (editingNode.style as unknown as Record<string, string>)[field] = value;
  }
}

function resetAll() {
  if (!editingNode || !originalSnapshot) return;
  // Clearing our inline overrides returns the node to its className-driven styles.
  for (const field of STYLE_FIELDS) {
    (editingNode.style as unknown as Record<string, string>)[field] = "";
  }
  editingNode.style.borderStyle = "";
  editingNode.style.borderWidth = "";
  editingNode.textContent = originalSnapshot.text;
}

function onMessage(e: MessageEvent) {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  const t = (data as { type?: unknown }).type;
  if (t === "arcade-studio:preview") {
    const { field, value } = data as { field?: string; value?: string };
    if (typeof field === "string" && typeof value === "string") applyField(field, value);
  } else if (t === "arcade-studio:preview-reset") {
    resetAll();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("message", onMessage);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire picker.ts to capture the node + post styles**

In `studio/src/frame/picker.ts`, add the import at the top (after the file header comment, before `interface PickerSelection`):

```ts
import { capture, type StyleSnapshot } from "./inspector";
```

Extend the `PickerSelection` interface to carry styles:

```ts
interface PickerSelection {
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  styles: StyleSnapshot;
}
```

`resolveSelection` currently returns the source fields. Change its signature to also take the clicked node and include styles. Replace the `resolveSelection` function's `return` block so it captures the node:

Find:
```ts
        return { ...parsed, componentName, tagName };
```
Replace with:
```ts
        return { ...parsed, componentName, tagName, styles: capture(domNode) };
```

And change the function signature + the call site to thread the DOM node through. Replace the `resolveSelection` declaration line:
```ts
function resolveSelection(fiber: FiberLike): PickerSelection | null {
```
with:
```ts
function resolveSelection(fiber: FiberLike, domNode: HTMLElement): PickerSelection | null {
```

In `onClick`, replace:
```ts
  const sel = resolveSelection(fiber);
```
with:
```ts
  const sel = resolveSelection(fiber, target as HTMLElement);
```

- [ ] **Step 6: Add the inspector to the frame bootstrap**

In `studio/server/plugins/frameMountPlugin.ts`, find line ~237:
```ts
    import "arcade-studio/frame/picker";
```
Add immediately after it:
```ts
    import "arcade-studio/frame/inspector";
```

(picker.ts already imports `capture` from inspector, so this explicit line just guarantees the message listener registers even if tree-shaking is aggressive. Harmless if redundant.)

- [ ] **Step 7: Verify nothing else broke + commit**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts`
Expected: PASS.

```bash
git add studio/src/frame/inspector.ts studio/src/frame/picker.ts studio/server/plugins/frameMountPlugin.ts studio/__tests__/frame/inspector-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): in-iframe node capture + inline preview

picker.ts now retains the clicked node and posts a computed-style snapshot;
inspector.ts applies/resets throwaway inline-style previews on message.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `buildVisualEditPreamble()` pure function

**Files:**
- Create: `studio/src/lib/visualEditPreamble.ts`
- Test: `studio/__tests__/lib/visualEditPreamble.test.ts`

**Interfaces:**
- Consumes: `TargetSelection`, `PendingEdits` (Task 1).
- Produces: `export function buildVisualEditPreamble(target: TargetSelection, pending: PendingEdits): string`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/lib/visualEditPreamble.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildVisualEditPreamble } from "../../src/lib/visualEditPreamble";
import type { TargetSelection } from "../../src/hooks/targetSelectionContext";

const TARGET: TargetSelection = {
  file: "/Users/x/projects/demo/frames/home/index.tsx",
  line: 42, column: 7, componentName: "Button", tagName: "button",
  frameSlug: "home",
  styles: {
    text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
    textAlign: "left", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)",
    borderColor: "rgb(0,0,0)", paddingTop: "0px", paddingRight: "0px",
    paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
    marginBottom: "0px", marginLeft: "0px", width: "80px", height: "32px",
  },
};

describe("buildVisualEditPreamble", () => {
  it("includes the relative frame path and line:column", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px" });
    expect(out).toContain("frames/home/index.tsx:42:7");
  });

  it("lists each pending change as an original -> new line", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px", color: "rgb(37,99,235)" });
    expect(out).toContain("font size: 14px -> 18px");
    expect(out).toContain("text color: rgb(0,0,0) -> rgb(37,99,235)");
  });

  it("renders a text-content change in quotes", () => {
    const out = buildVisualEditPreamble(TARGET, { text: "Submit" });
    expect(out).toContain(`text content: "Save" -> "Submit"`);
  });

  it("instructs idiomatic Tailwind/token output and forbids a no-op turn", () => {
    const out = buildVisualEditPreamble(TARGET, { fontSize: "18px" });
    expect(out).toMatch(/Tailwind|token/i);
    expect(out).toContain("Edit");
  });

  it("returns an empty string when there are no pending changes", () => {
    expect(buildVisualEditPreamble(TARGET, {})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/visualEditPreamble.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the function**

Create `studio/src/lib/visualEditPreamble.ts`:

```ts
import type { TargetSelection, PendingEdits, StyleSnapshot } from "../hooks/targetSelectionContext";

/** Human-readable label for each editable field. */
const LABELS: Record<keyof StyleSnapshot, string> = {
  text: "text content",
  fontSize: "font size",
  fontWeight: "font weight",
  fontStyle: "font style",
  textAlign: "text align",
  color: "text color",
  backgroundColor: "background color",
  borderColor: "border color",
  paddingTop: "padding top", paddingRight: "padding right",
  paddingBottom: "padding bottom", paddingLeft: "padding left",
  marginTop: "margin top", marginRight: "margin right",
  marginBottom: "margin bottom", marginLeft: "margin left",
  width: "width", height: "height",
};

/**
 * Serialize a batch of visual edits + the target source location into a single
 * instruction for the existing Claude generator. Pure + deterministic so it can
 * be unit-tested. Returns "" when nothing changed (caller should not send).
 */
export function buildVisualEditPreamble(target: TargetSelection, pending: PendingEdits): string {
  const keys = (Object.keys(pending) as (keyof StyleSnapshot)[]).filter(
    (k) => pending[k] !== undefined,
  );
  if (keys.length === 0) return "";

  const rel = target.file.split("/frames/").pop() ?? target.file;
  const label =
    target.tagName && target.tagName !== target.componentName
      ? `<${target.tagName}> inside <${target.componentName}>`
      : `<${target.componentName}>`;

  const changeLines = keys.map((k) => {
    const from = target.styles[k];
    const to = pending[k] as string;
    if (k === "text") return `- text content: "${from}" -> "${to}"`;
    return `- ${LABELS[k]}: ${from} -> ${to}`;
  });

  return [
    `Target element: ${label}`,
    `Source: frames/${rel}:${target.line}:${target.column}`,
    "",
    "Apply these visual changes to that element:",
    ...changeLines,
    "",
    `Read frames/${rel} first — do not edit from memory. The line:column above identifies the targeted element. Apply the changes ONLY to this element; do not modify other files or unrelated parts of this file.`,
    "",
    "Express every change with idiomatic Tailwind utility classes and arcade-gen design tokens (e.g. text-(--fg-...), bg-(--bg-...), p-4, text-lg, font-semibold) — map raw px/colors to the nearest token or scale step. Do NOT write raw hex or inline style props.",
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit reports zero or multiple matches, widen the surrounding context and retry, or fall back to Write with the full new file contents.",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/visualEditPreamble.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/visualEditPreamble.ts studio/__tests__/lib/visualEditPreamble.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): buildVisualEditPreamble serializes edits for commit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: InspectorPanel UI

**Files:**
- Create: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/InspectorPanel.test.tsx`

**Interfaces:**
- Consumes: `useTargetSelection()` (Task 1), `buildVisualEditPreamble` (Task 3).
- Produces: `export function InspectorPanel({ onSend, busy }: { onSend: (prompt: string, images?: string[]) => void; busy: boolean }): JSX.Element | null`. Renders nothing when `inspectorOpen` is false.

**Design note (no-placeholder rationale):** arcade-gen exports no Slider / ColorPicker / NumberField. To avoid inventing prop shapes, the panel builds its controls from native inputs styled with design tokens — exactly how the existing shell builds bespoke controls (see `PromptInput.tsx` / `FrameCard.tsx` raw `<button>`/`<input>` with `var(--...)`). arcade-gen is used only for `Button` (Commit/Discard), which the test mocks.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/InspectorPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

import { InspectorPanel } from "../../src/components/inspector/InspectorPanel";
import {
  TargetSelectionProvider,
  useTargetSelection,
  type StyleSnapshot,
  type TargetSelection,
} from "../../src/hooks/targetSelectionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", width: "80px", height: "32px",
};
const TARGET: TargetSelection = {
  file: "/p/frames/home/index.tsx", line: 1, column: 1,
  componentName: "Button", tagName: "button", frameSlug: "home", styles: STYLES,
};

// Harness exposing the context so the test can drive setTarget/setInspectorOpen.
function Harness({ onSend }: { onSend: any }) {
  const ctx = useTargetSelection();
  return (
    <>
      <button onClick={() => { ctx.setInspectorOpen(true); ctx.setTarget(TARGET); }}>
        open
      </button>
      <InspectorPanel onSend={onSend} busy={false} />
      <span data-testid="pending-fontSize">{ctx.pending.fontSize ?? ""}</span>
    </>
  );
}

afterEach(cleanup);

describe("InspectorPanel", () => {
  it("renders nothing until the inspector is open", () => {
    render(<TargetSelectionProvider><InspectorPanel onSend={vi.fn()} busy={false} /></TargetSelectionProvider>);
    expect(screen.queryByText(/Commit/i)).toBeNull();
  });

  it("shows the empty state when open with no target", () => {
    function OpenOnly() {
      const ctx = useTargetSelection();
      React.useEffect(() => ctx.setInspectorOpen(true), []); // eslint-disable-line
      return <InspectorPanel onSend={vi.fn()} busy={false} />;
    }
    render(<TargetSelectionProvider><OpenOnly /></TargetSelectionProvider>);
    expect(screen.getByText(/click an element/i)).toBeTruthy();
  });

  it("seeds controls from target styles and records a pending edit", () => {
    render(<TargetSelectionProvider><Harness onSend={vi.fn()} /></TargetSelectionProvider>);
    fireEvent.click(screen.getByText("open"));
    const fontSize = screen.getByLabelText(/font size/i) as HTMLInputElement;
    expect(fontSize.value).toBe("14"); // px stripped for the numeric field
    fireEvent.change(fontSize, { target: { value: "18" } });
    expect(screen.getByTestId("pending-fontSize").textContent).toBe("18px");
  });

  it("Commit calls onSend with a preamble containing the change, then clears", () => {
    const onSend = vi.fn();
    render(<TargetSelectionProvider><Harness onSend={onSend} /></TargetSelectionProvider>);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "18" } });
    fireEvent.click(screen.getByText(/Commit/i));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain("font size: 14px -> 18px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

Create `studio/src/components/inspector/InspectorPanel.tsx`:

```tsx
import { Button } from "@xorkavi/arcade-gen";
import { useTargetSelection, type StyleSnapshot, type PendingEdits } from "../../hooks/targetSelectionContext";
import { buildVisualEditPreamble } from "../../lib/visualEditPreamble";

/** Strip a trailing "px" for numeric inputs; pass other units through as-is. */
function toNumberInput(v: string): string {
  return v.endsWith("px") ? v.slice(0, -2) : v;
}
/** Re-attach "px" for a numeric field's pending value. */
function fromNumberInput(v: string): string {
  return v === "" ? "" : `${v}px`;
}

/** Current value for a field: pending override if present, else the original. */
function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}

const SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--stroke-neutral-subtle)",
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const LABEL: React.CSSProperties = {
  fontSize: 11,
  color: "var(--fg-neutral-subtle)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const INPUT: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)",
  background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)",
  fontSize: 12,
};

export function InspectorPanel({
  onSend,
  busy,
}: {
  onSend: (prompt: string, images?: string[]) => void;
  busy: boolean;
}) {
  const {
    target, pending, setPendingField, resetPendingField, inspectorOpen, clear, frameWindow,
  } = useTargetSelection();

  if (!inspectorOpen) return null;

  // Apply a change: store pending (or reset if back to original) + preview it live.
  function change(key: keyof StyleSnapshot, rawValue: string) {
    if (!target) return;
    const original = target.styles[key];
    if (rawValue === original || rawValue === "") {
      resetPendingField(key);
    } else {
      setPendingField(key, rawValue);
    }
    frameWindow?.postMessage(
      { type: "arcade-studio:preview", field: key, value: rawValue || original },
      "*",
    );
  }

  function discard() {
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset" }, "*");
    clear();
  }

  function commit() {
    if (!target) return;
    const preamble = buildVisualEditPreamble(target, pending);
    if (!preamble) {
      discard();
      return;
    }
    onSend(preamble, []);
    // Source rewrite + HMR will repaint the frame; drop the throwaway preview.
    frameWindow?.postMessage({ type: "arcade-studio:preview-reset" }, "*");
    clear();
  }

  const hasChanges = Object.values(pending).some((v) => v !== undefined);

  return (
    <aside
      style={{
        width: 280,
        borderLeft: "1px solid var(--stroke-neutral-subtle)",
        background: "var(--surface-overlay)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 44, flex: "none", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 14px",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
          fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)",
        }}
      >
        <span>Edit element</span>
        <button
          type="button" onClick={discard} aria-label="Close inspector"
          style={{ background: "transparent", border: "none", color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!target ? (
          <div style={{ padding: 24, color: "var(--fg-neutral-subtle)", fontSize: 13, textAlign: "center" }}>
            Click an element in the frame to edit it.
          </div>
        ) : (
          <>
            {/* Text */}
            <div style={SECTION}>
              <span style={LABEL}>Text</span>
              <input
                aria-label="Text content"
                style={INPUT}
                value={fieldValue(target.styles, pending, "text")}
                onChange={(e) => change("text", e.target.value)}
              />
            </div>

            {/* Typography */}
            <div style={SECTION}>
              <span style={LABEL}>Typography</span>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontSize" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Font size</label>
                <input
                  id="ins-fontSize" type="number" aria-label="Font size" style={INPUT}
                  value={toNumberInput(fieldValue(target.styles, pending, "fontSize"))}
                  onChange={(e) => change("fontSize", fromNumberInput(e.target.value))}
                />
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontWeight" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Weight</label>
                <select
                  id="ins-fontWeight" aria-label="Font weight" style={INPUT}
                  value={fieldValue(target.styles, pending, "fontWeight")}
                  onChange={(e) => change("fontWeight", e.target.value)}
                >
                  {["300", "400", "500", "600", "700"].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-textAlign" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Align</label>
                <select
                  id="ins-textAlign" aria-label="Text align" style={INPUT}
                  value={fieldValue(target.styles, pending, "textAlign")}
                  onChange={(e) => change("textAlign", e.target.value)}
                >
                  {["left", "center", "right", "justify"].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div style={FIELD_ROW}>
                <label htmlFor="ins-fontStyle" style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>Italic</label>
                <input
                  id="ins-fontStyle" type="checkbox" aria-label="Italic"
                  checked={fieldValue(target.styles, pending, "fontStyle") === "italic"}
                  onChange={(e) => change("fontStyle", e.target.checked ? "italic" : "normal")}
                />
              </div>
            </div>

            {/* Color */}
            <div style={SECTION}>
              <span style={LABEL}>Color</span>
              {(["color", "backgroundColor", "borderColor"] as const).map((key) => (
                <div style={FIELD_ROW} key={key}>
                  <label htmlFor={`ins-${key}`} style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>
                    {key === "color" ? "Text" : key === "backgroundColor" ? "Fill" : "Border"}
                  </label>
                  <input
                    id={`ins-${key}`} aria-label={key} style={INPUT}
                    value={fieldValue(target.styles, pending, key)}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* Spacing & size */}
            <div style={SECTION}>
              <span style={LABEL}>Spacing &amp; size</span>
              {(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "width", "height"] as const).map((key) => (
                <div style={FIELD_ROW} key={key}>
                  <label htmlFor={`ins-${key}`} style={{ width: 72, fontSize: 12, color: "var(--fg-neutral-medium)" }}>{key}</label>
                  <input
                    id={`ins-${key}`} type="number" aria-label={key} style={INPUT}
                    value={toNumberInput(fieldValue(target.styles, pending, key))}
                    onChange={(e) => change(key, fromNumberInput(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <Button variant="tertiary" onClick={discard}>Discard</Button>
        <Button variant="primary" onClick={commit} disabled={!hasChanges || busy}>Commit</Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Expected: PASS (4 tests). If the mocked `Button` ignores `variant`, that's fine — the mock only forwards `onClick`/`disabled`.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): InspectorPanel UI with live preview + commit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire FrameCard to open the inspector + register the frame window

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Test: `studio/__tests__/components/frameCard.test.tsx` (update if it breaks on the new `styles` field / behavior)

**Interfaces:**
- Consumes: `useTargetSelection()` now exposes `setInspectorOpen`, `setFrameWindow`, `inspectorOpen` (Task 1).
- Produces: clicking the crosshair opens the inspector + enters picking; a successful pick registers the frame's `contentWindow` and keeps the inspector open; clearing closes it.

- [ ] **Step 1: Read the current handler**

Read `studio/src/components/viewport/FrameCard.tsx` lines 59–152 and 244–258 (already in context). The change set:
1. Pull `setInspectorOpen` + `setFrameWindow` from the context hook.
2. When the crosshair starts picking, also `setInspectorOpen(true)`.
3. In the `frame-picked` handler, after `setTarget`, also `setFrameWindow(iframeRef.current?.contentWindow ?? null)`. Drop the toast (the panel now provides feedback) — or keep it; keeping is fine.
4. When clearing the target via the crosshair, `setInspectorOpen(false)` + `setFrameWindow(null)` (the context `clear()` already resets these, so call `clear()` instead of `setTarget(null)`).

- [ ] **Step 2: Apply the edits**

In `FrameCard.tsx`, change the context destructure (line ~64):
```ts
  const { target, setTarget } = useTargetSelection();
```
to:
```ts
  const { target, setTarget, setInspectorOpen, setFrameWindow, clear } = useTargetSelection();
```

In the `frame-picked` branch (line ~116), replace:
```ts
        if (sel) {
          setTarget({ ...sel, frameSlug: frame.slug });
          const name = sel.componentName || sel.tagName || "element";
          toast({
            title: `Targeted <${name}>`,
            description: "Added to the chat input as context",
          });
        }
        setPicking(false);
```
with:
```ts
        if (sel) {
          setTarget({ ...sel, frameSlug: frame.slug });
          setFrameWindow(iframeRef.current?.contentWindow ?? null);
          setInspectorOpen(true);
        }
        setPicking(false);
```

Note the `frame-picked` message handler reads `sel` as `{ file, line, column, componentName, tagName }`. Extend its inline type to include `styles` so TypeScript is happy — update the type annotation at line ~108:
```ts
        const sel = (data as {
          selection?: {
            file: string;
            line: number;
            column: number;
            componentName: string;
            tagName: string;
            styles: import("../../hooks/targetSelectionContext").StyleSnapshot;
          };
        }).selection;
```

In the crosshair `onClick` (line ~245), replace:
```ts
              onClick={() => {
                if (picking) {
                  setPicking(false);
                  return;
                }
                if (isTargetedFrame) {
                  setTarget(null);
                  return;
                }
                setPicking(true);
              }}
```
with:
```ts
              onClick={() => {
                if (picking) {
                  setPicking(false);
                  setInspectorOpen(false);
                  return;
                }
                if (isTargetedFrame) {
                  clear();
                  return;
                }
                setInspectorOpen(true);
                setPicking(true);
              }}
```

- [ ] **Step 3: Run the FrameCard test**

Run: `pnpm run studio:test __tests__/components/frameCard.test.tsx`
Expected: PASS. If it fails because the test simulated a `frame-picked` message without `styles`, update that test's mock message to include a minimal `styles` object (copy the `STYLES` const shape from Task 1's test). If it fails because it asserted the old toast, update the assertion to check `setInspectorOpen`/target state instead. Fix the test to match the new behavior, do not revert the component.

- [ ] **Step 4: Run the full suite to catch context-consumer fallout**

Run: `pnpm run studio:test`
Expected: PASS. Any failure referencing `TargetSelection` missing `styles` is a test that builds a target literal — add the `styles` field to it.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/frameCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): FrameCard opens inspector + registers frame window on pick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Mount InspectorPanel in the ProjectDetail layout

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`

**Interfaces:**
- Consumes: `InspectorPanel` (Task 4); `useTargetSelection().inspectorOpen` for the grid template; `source.send` + `chatStream.state.phase` for `onSend`/`busy`.
- Produces: a 4th grid column that appears when the inspector is open.

- [ ] **Step 1: Add the import**

In `studio/src/routes/ProjectDetail.tsx`, after the `DevModePanel` import (line ~5):
```ts
import { InspectorPanel } from "../components/inspector/InspectorPanel";
```

- [ ] **Step 2: Read `inspectorOpen` inside the provider's subtree**

`InspectorPanel` and the grid template both need `inspectorOpen`, but `ProjectDetailShell` renders `<TargetSelectionProvider>` *inside* its own return — the hook can't be called above it. Extract the inner grid into a small child component that lives under the provider so it can call `useTargetSelection()`.

Replace the closing render block (lines ~313 onward, `return ( <ChatStreamProvider...> <TargetSelectionProvider> <div grid...> ... </div> </TargetSelectionProvider> </ChatStreamProvider> )`) so the grid `<div>` and everything inside it is moved into a new inner function component `ProjectGrid` defined just below `ProjectDetailShell`, and `ProjectDetailShell` returns:

```tsx
  return (
    <ChatStreamProvider value={chatStream}>
      <TargetSelectionProvider>
        <ProjectGrid
          project={project}
          routeKey={routeKey}
          reloadKey={reloadKey}
          chatOpen={chatOpen} chatWidth={chatWidth} resizing={resizing}
          devOpen={devOpen}
          frameWidth={frameWidth} onFrameWidthChange={setFrameWidth}
          zoom={zoom} onZoomChange={setZoom}
          phase={chatStream.state.phase}
          send={source.send}
          seedChatRef={seedChatRef}
          chatHistory={chatHistory} chimeIns={chimeIns}
          onApplyChimeIn={handleApplyChimeIn} onDismissChimeIn={handleDismissChimeIn}
          onBack={onBack} onOpenProject={onOpenProject}
          onToggleChat={() => setChatOpen((o) => !o)}
          leftTab={leftTab} onLeftTab={setLeftTab}
          onToggleMode={toggleProjectMode}
          onToggleDev={() => setDevOpen((o) => !o)}
          onStartResize={startResize} onResetChatWidth={resetChatWidth}
        />
      </TargetSelectionProvider>
    </ChatStreamProvider>
  );
```

Define `ProjectGrid` to accept those props (mirror the existing JSX exactly — header + grid `<div>` + the three columns). At the top of `ProjectGrid`:
```tsx
  const { inspectorOpen } = useTargetSelection();
```

Add `useTargetSelection` to the existing import from `../hooks/targetSelectionContext` (it currently imports only `TargetSelectionProvider`):
```ts
import { TargetSelectionProvider, useTargetSelection } from "../hooks/targetSelectionContext";
```

> **Right-sizing note:** this extraction is mechanical but touches ~120 lines of JSX. Move the existing markup verbatim — do not redesign it. The only *new* markup is the grid-template change (Step 3) and the panel mount (Step 4).

- [ ] **Step 3: Add the inspector column to the grid template**

In the moved grid `<div>`'s `gridTemplateColumns`, change:
```ts
          gridTemplateColumns: `${chatOpen ? `${chatWidth}px` : "0px"} 1fr${devOpen ? " auto" : ""}`,
```
to:
```ts
          gridTemplateColumns: `${chatOpen ? `${chatWidth}px` : "0px"} 1fr${devOpen ? " auto" : ""}${inspectorOpen ? " auto" : ""}`,
```

- [ ] **Step 4: Mount the panel**

Immediately after `{devOpen && <DevModePanel slug={project.slug} />}` inside the grid `<div>`, add:
```tsx
        <InspectorPanel onSend={(p, imgs) => send(p, imgs)} busy={phase === "running"} />
```
(`InspectorPanel` self-hides when `inspectorOpen` is false, so it's always rendered; the grid column only appears because of the template change in Step 3.)

- [ ] **Step 5: Type-check**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Then a TypeScript check across the route:
Run: `cd /Users/andrey.sundiev/arcade-prototyper && pnpm exec tsc -p studio/tsconfig.json --noEmit`
Expected: no errors in `ProjectDetail.tsx` / `InspectorPanel.tsx`. (If the repo has no `studio/tsconfig.json`, skip this and rely on Step 6's full suite + manual run.)

- [ ] **Step 6: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add studio/src/routes/ProjectDetail.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): mount InspectorPanel as a right-side grid column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual end-to-end verification

**Files:** none (verification only).

This feature's wiring (iframe postMessage preview, HMR commit round-trip) is integration that the unit suite cannot cover — verify it live, per the dev-only constraint.

- [ ] **Step 1: Start the app**

Run: `pnpm run studio`
Expected: browser opens at `localhost:5556`. (Full restart needed because Task 2 edited `frameMountPlugin.ts`.)

- [ ] **Step 2: Generate or open a project with at least one frame.** Prompt e.g. "a settings page with a save button" if empty.

- [ ] **Step 3: Open the inspector.** Click the crosshair on a frame. Expected: the right-side panel slides in showing "Click an element in the frame to edit it."

- [ ] **Step 4: Pick an element.** Click a text/button element. Expected: panel populates — Text field shows the element's text; Font size shows its px value; Color fields show rgb values.

- [ ] **Step 5: Live preview.** Change Font size to a larger number, edit the Text field, change Fill color. Expected: the element in the frame updates instantly on each change.

- [ ] **Step 6: Discard.** Click Discard. Expected: the frame element snaps back to its original look; the panel closes.

- [ ] **Step 7: Commit.** Re-pick, make 2–3 changes, click Commit. Expected: a chat turn starts ("Working…"), Claude edits the frame source, the frame hot-reloads with the new look rendered from real code, and the panel closes. Open the frame's `index.tsx` (via the Code/dev panel) and confirm the change used Tailwind classes / tokens, not raw hex or inline `style`.

- [ ] **Step 8: Record the result** in the PR description (screenshots of before/after + the committed diff). No commit for this task.

---

## Self-Review

**Spec coverage:**
- Experience flow (crosshair → empty panel → pick → populate → live edit → Commit/Discard) → Tasks 4, 5, 6, 7. ✓
- Four edit categories (Text, Typography, Color, Spacing/size) → Task 4 control sections. ✓
- Live preview via inline `node.style.*` on retained node → Task 2. ✓
- Commit via existing `send()` + `buildVisualEditPreamble`, no new endpoint → Tasks 3, 6. ✓
- Pending folded into existing `targetSelectionContext` (no new context) → Task 1. ✓
- Idiomatic Tailwind/token output instruction → Task 3 preamble + Task 7 step 7 verification. ✓
- Error handling: pick-fail reuses existing cancel path (untouched in picker.ts); phantom-edit retry inherited via `send()` (no code needed); vanished-node preview reverts harmlessly (inline style lost) — covered by design, no task. ✓
- Out-of-scope items (MCP, stylesheet, drag handles, layers, effects, motion) → not implemented. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. Tests contain real assertions.

**Type consistency:** `StyleSnapshot`/`PendingEdits` defined in Task 1, re-declared structurally in Task 2's `inspector.ts` (documented why — iframe bundle boundary), consumed by Tasks 3/4. `buildVisualEditPreamble(target, pending)` signature consistent across Task 3 (def), Task 4 (call). Message verbs `arcade-studio:preview` `{field,value}` + `arcade-studio:preview-reset` consistent across Task 2 (handler) and Task 4 (sender). Context field names (`setInspectorOpen`, `setFrameWindow`, `clear`, `setPendingField`, `resetPendingField`) consistent across Tasks 1, 4, 5, 6.

**Known risk flagged for the implementer:** Task 6 extracts `ProjectGrid` from inline JSX — the largest single edit. If the verbatim move is error-prone, an acceptable alternative is to lift `TargetSelectionProvider` up one level (wrap `ProjectDetailShell`'s entire return) so `inspectorOpen` can be read without extraction. Either reaches the same end; pick whichever keeps the diff smallest.
