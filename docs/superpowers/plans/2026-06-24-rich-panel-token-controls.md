# Rich Panel Slice 1b (Token-first Color + Typography) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inspector's Color and Typography controls token-first — pick arcade design-system tokens (color swatches, named type styles) read from the element's actual applied CSS class, with raw escape hatches, previewed by class-toggle and committed as the exact class.

**Architecture:** Add an applied-class channel beside the existing computed-style channel. `capture()` scans `node.classList` for arcade token classes into a new `appliedTokens` field. A token edit is stored in the pending map as a sentinel string `tok:<className>` (distinguishable from raw values, so the existing `change(key, rawValue)` signature is unchanged). Preview of a token toggles the class on the iframe node (arcade CSS is loaded there); commit emits the exact class. A `tokenCatalog` module sources the color + type token lists from arcade-gen's CSS; swatches resolve via the live computed value of the custom property.

**Tech Stack:** React 19, TypeScript, `@xorkavi/arcade-gen` CSS tokens, Vitest + jsdom + @testing-library/react, Playwright for the visual gate. pnpm.

## Global Constraints

- **pnpm only.** Before running tests: `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` and `export GITHUB_TOKEN_PACKAGES="$GITHUB_TOKEN"`. If `pnpm`/`vitest` are "not found" after those, STOP and report — do NOT assume npm-auth.
- **Run tests from repo root** (`/Users/andrey.sundiev/arcade-prototyper`): `pnpm run studio:test <path>`; full suite `pnpm run studio:test`.
- **Commits:** Conventional Commits, scope `studio/inspector`. Body ends `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — explicit paths only.
- **Component tests** use `// @vitest-environment jsdom` and mock `@xorkavi/arcade-gen` (only the symbols used).
- **editId is a number.** **StyleSnapshot field lists in `editSessionContext.tsx` and `frame/inspector.ts` must stay identical** (documented contract).
- **Read the APPLIED CLASS, never reverse-map computed style.** When an element carries no token class for a slot → "— (no token)", never a guess.
- **Pending token sentinel:** a pending value of the form `tok:<className>` denotes a token-class edit (e.g. `tok:text-(--fg-success-prominent)`, `tok:text-body-medium`). Any other pending string is a raw value (existing behavior). One helper pair: `isTokenPending(v)` / `tokenClass(v)`.
- **Visual gate:** this slice's controls are visual; after the build, screenshot-verify in the running app (Playwright) — passing unit tests are necessary but NOT sufficient (a prior slice shipped a "wall of inputs" that passed every test).

## Reference (read-only)
- Color tokens resolve through `var()` chains, so a swatch must use the LIVE computed value: inside the iframe, `getComputedStyle(document.documentElement).getPropertyValue("--fg-neutral-prominent")`. Do NOT parse the CSS file for hex.
- arcade type classes (from arcade-gen CSS): `text-body`, `text-body-small`, `text-body-bold`, `text-body-large-bold`, `text-title-large`. Color token classes in frames: `text-(--fg-...)`, `bg-(--bg-...)` / `bg-(--surface-...)`, `border-(--stroke-...)`.
- Color token names (fg/bg/stroke/surface, ~51) live in `@xorkavi/arcade-gen/dist/styles.css`. The catalog hardcodes the curated NAME list (stable design-system vocabulary); swatches resolve live. (A future task can generate the list from CSS; this slice hardcodes the curated set — see Task 1.)

---

## File Structure

- **Create** `studio/src/components/inspector/tokenCatalog.ts` — curated color + type token lists + class-name builders. (Task 1)
- **Modify** `studio/src/frame/inspector.ts` — `appliedTokens` on snapshot; classList scan; class-toggle preview + reset. (Task 2)
- **Modify** `studio/src/hooks/editSessionContext.tsx` — mirror `appliedTokens` on StyleSnapshot; add `isTokenPending`/`tokenClass` helpers (exported). (Task 2)
- **Create** `studio/src/components/inspector/TokenSelect.tsx` — token dropdown (swatch+name / label) + "— (no token)" + raw escape slot. (Task 3)
- **Modify** `studio/src/lib/visualEditPreamble.ts` — emit token-class edits as class instructions. (Task 4)
- **Modify** `studio/src/components/inspector/InspectorPanel.tsx` — Color section → TokenSelect+raw per slot; Typography → Style picker replaces size+weight. Route token changes to a `changeToken` that writes the `tok:` sentinel + posts `preview-class`. (Task 5)
- **Manual visual verification** (Task 6).

### Shared contract (Task 1 + Task 2; consumed by 3/4/5)

```ts
// tokenCatalog.ts
export interface ColorToken { token: string; label: string; } // token: "--fg-neutral-prominent"
export type ColorSlot = "color" | "backgroundColor" | "borderColor";
export function colorTokens(): ColorToken[];
export function typeTokens(): { className: string; label: string }[]; // text-body-medium → "Body medium"
export function colorClassName(token: string, slot: ColorSlot): string; // → "text-(--fg-...)" | "bg-(--...)" | "border-(--...)"
export function colorTokenFromClass(cls: string): { token: string; slot: ColorSlot } | null; // inverse, for detection
export function resolveSwatch(token: string, rootEl: Element): string; // live computed value of the custom property

// editSessionContext.tsx (Task 2)
export const TOKEN_PREFIX = "tok:";
export function isTokenPending(v: string | undefined): boolean; // v?.startsWith("tok:")
export function tokenClass(v: string): string; // strip prefix → className

// frame/inspector.ts (Task 2) — StyleSnapshot gains:
//   appliedTokens: { color?: string; backgroundColor?: string; borderColor?: string; typeStyle?: string }
//   (each = the arcade token CLASS found on the node for that slot, or undefined)
```

---

### Task 1: tokenCatalog module

**Files:**
- Create: `studio/src/components/inspector/tokenCatalog.ts`
- Test: `studio/__tests__/components/inspector-token-catalog.test.ts`

**Interfaces:** as in the contract above.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-token-catalog.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { colorTokens, typeTokens, colorClassName, colorTokenFromClass } from "../../src/components/inspector/tokenCatalog";

describe("colorTokens", () => {
  it("returns curated fg/bg/stroke/surface tokens, excludes --component-*", () => {
    const toks = colorTokens();
    expect(toks.length).toBeGreaterThan(20);
    expect(toks.some((t) => t.token === "--fg-neutral-prominent")).toBe(true);
    expect(toks.some((t) => t.token.startsWith("--component-"))).toBe(false);
    // labels are human-ish
    expect(toks.find((t) => t.token === "--fg-neutral-prominent")!.label.length).toBeGreaterThan(0);
  });
});

describe("typeTokens", () => {
  it("lists named arcade type styles with labels", () => {
    const ts = typeTokens();
    expect(ts.some((t) => t.className === "text-body-medium")).toBe(true);
    expect(ts.some((t) => t.className === "text-title-large")).toBe(true);
    expect(ts.find((t) => t.className === "text-body-medium")!.label).toBe("Body medium");
  });
});

describe("colorClassName / colorTokenFromClass round-trip", () => {
  it("builds the right prefix per slot", () => {
    expect(colorClassName("--fg-neutral-prominent", "color")).toBe("text-(--fg-neutral-prominent)");
    expect(colorClassName("--bg-success-medium", "backgroundColor")).toBe("bg-(--bg-success-medium)");
    expect(colorClassName("--stroke-neutral-subtle", "borderColor")).toBe("border-(--stroke-neutral-subtle)");
  });
  it("parses a class back to token + slot", () => {
    expect(colorTokenFromClass("text-(--fg-neutral-prominent)")).toEqual({ token: "--fg-neutral-prominent", slot: "color" });
    expect(colorTokenFromClass("bg-(--surface-canvas)")).toEqual({ token: "--surface-canvas", slot: "backgroundColor" });
    expect(colorTokenFromClass("p-4")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run studio:test __tests__/components/inspector-token-catalog.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement tokenCatalog.ts**

Create `studio/src/components/inspector/tokenCatalog.ts`:

```ts
// Curated arcade design-system token catalogs for the inspector's token-first
// controls. Color NAMES are a curated list of the stable arcade vocabulary
// (fg/bg/stroke/surface; --component-* excluded as those are internal recipes).
// Swatches resolve LIVE (resolveSwatch) because the tokens are var() chains.

export interface ColorToken { token: string; label: string; }
export type ColorSlot = "color" | "backgroundColor" | "borderColor";

// Curated set — the user-facing color choices. Grouped by family for the label.
const COLOR_TOKEN_NAMES: string[] = [
  // foreground (text)
  "--fg-neutral-prominent", "--fg-neutral-medium", "--fg-neutral-subtle",
  "--fg-success-prominent", "--fg-warning-prominent", "--fg-alert-prominent",
  "--fg-info-prominent", "--fg-critical-prominent",
  // background / surface (fill)
  "--bg-neutral-soft", "--bg-neutral-medium", "--bg-neutral-prominent", "--bg-neutral-subtle",
  "--bg-success-subtle", "--bg-success-medium",
  "--bg-warning-subtle", "--bg-warning-medium",
  "--bg-alert-subtle", "--bg-alert-medium",
  "--bg-info-subtle", "--bg-info-medium",
  "--bg-expressive-blue-medium", "--bg-expressive-yellow-medium",
  "--surface-canvas", "--surface-overlay",
  // stroke (border)
  "--stroke-neutral-subtle", "--stroke-neutral-medium",
];

function humanize(token: string): string {
  // "--fg-neutral-prominent" -> "Neutral prominent" (drop the family prefix)
  const body = token.replace(/^--(fg|bg|stroke|surface)-/, "");
  const words = body.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function colorTokens(): ColorToken[] {
  return COLOR_TOKEN_NAMES.map((token) => ({ token, label: humanize(token) }));
}

const TYPE_TOKENS: { className: string; label: string }[] = [
  { className: "text-body", label: "Body" },
  { className: "text-body-medium", label: "Body medium" },
  { className: "text-body-small", label: "Body small" },
  { className: "text-body-bold", label: "Body bold" },
  { className: "text-body-large-bold", label: "Body large bold" },
  { className: "text-title-large", label: "Title large" },
];

export function typeTokens(): { className: string; label: string }[] {
  return TYPE_TOKENS;
}

const SLOT_PREFIX: Record<ColorSlot, string> = {
  color: "text",
  backgroundColor: "bg",
  borderColor: "border",
};

export function colorClassName(token: string, slot: ColorSlot): string {
  return `${SLOT_PREFIX[slot]}-(${token})`;
}

const COLOR_CLASS_RE = /^(text|bg|border)-\((--[a-z0-9-]+)\)$/;
export function colorTokenFromClass(cls: string): { token: string; slot: ColorSlot } | null {
  const m = COLOR_CLASS_RE.exec(cls.trim());
  if (!m) return null;
  const slot: ColorSlot = m[1] === "text" ? "color" : m[1] === "bg" ? "backgroundColor" : "borderColor";
  return { token: m[2], slot };
}

/** Live computed value of a custom property, for the swatch chip. rootEl is the
 *  element whose getComputedStyle resolves the var() chain (the frame root). */
export function resolveSwatch(token: string, rootEl: Element): string {
  try {
    return getComputedStyle(rootEl).getPropertyValue(token).trim() || "transparent";
  } catch {
    return "transparent";
  }
}
```

- [ ] **Step 4: Run green** — `pnpm run studio:test __tests__/components/inspector-token-catalog.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/tokenCatalog.ts studio/__tests__/components/inspector-token-catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): arcade token catalog (color + type) for token-first controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Applied-class channel — capture scan, class-toggle preview, pending sentinel

**Files:**
- Modify: `studio/src/frame/inspector.ts`
- Modify: `studio/src/hooks/editSessionContext.tsx`
- Test: `studio/__tests__/frame/inspector-snapshot.test.ts` (extend), `studio/__tests__/hooks/editSessionContext.test.tsx` (extend)

**Interfaces:**
- Produces: `StyleSnapshot.appliedTokens` (both copies); `inspector.ts` handles `arcade-studio:preview-class` `{ editId, slot, className, prevClassName }` (toggle classes); reset removes applied-by-preview classes. `editSessionContext` exports `TOKEN_PREFIX`, `isTokenPending`, `tokenClass`.

- [ ] **Step 1: Write the failing tests**

In `studio/__tests__/frame/inspector-snapshot.test.ts`, add:

```ts
it("reads applied arcade token classes into appliedTokens", () => {
  const el = document.createElement("p");
  el.className = "text-body-medium text-(--fg-neutral-subtle) px-4";
  el.textContent = "Hi";
  document.body.appendChild(el);
  const snap = readStyleSnapshot(el);
  expect(snap.appliedTokens.typeStyle).toBe("text-body-medium");
  expect(snap.appliedTokens.color).toBe("text-(--fg-neutral-subtle)");
  expect(snap.appliedTokens.backgroundColor).toBeUndefined();
});

it("appliedTokens empty when element carries no token classes", () => {
  const el = document.createElement("div");
  el.className = "flex items-center";
  document.body.appendChild(el);
  expect(readStyleSnapshot(el).appliedTokens.typeStyle).toBeUndefined();
  expect(readStyleSnapshot(el).appliedTokens.color).toBeUndefined();
});

it("preview-class toggles the token class on the captured node", () => {
  const el = document.createElement("p");
  el.className = "text-body";
  el.textContent = "Hi";
  document.body.appendChild(el);
  const { editId } = capture(el);
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "arcade-studio:preview-class", editId, slot: "typeStyle", className: "text-title-large", prevClassName: "text-body" },
  }));
  expect(el.classList.contains("text-title-large")).toBe(true);
  expect(el.classList.contains("text-body")).toBe(false);
});
```

In `studio/__tests__/hooks/editSessionContext.test.tsx`, add:

```ts
it("token pending helpers detect and unwrap the tok: sentinel", () => {
  // imported from the context module
  expect(isTokenPending("tok:text-body")).toBe(true);
  expect(isTokenPending("16px")).toBe(false);
  expect(isTokenPending(undefined)).toBe(false);
  expect(tokenClass("tok:text-(--fg-neutral-subtle)")).toBe("text-(--fg-neutral-subtle)");
});
```
(Add `isTokenPending, tokenClass` to that test file's imports from `../../src/hooks/editSessionContext`.)

- [ ] **Step 2: Run to verify it fails** — run both files → FAIL (appliedTokens / helpers missing). Also expect existing StyleSnapshot literal compile errors (the new field) — those get fixed in Step 5.

- [ ] **Step 3: Add appliedTokens + classList scan in inspector.ts**

In `studio/src/frame/inspector.ts`:

Add to `StyleSnapshot` (after `opacity`/`borderRadius`):
```ts
  appliedTokens: { color?: string; backgroundColor?: string; borderColor?: string; typeStyle?: string };
```

Add a scanner + call it in `readStyleSnapshot`:
```ts
const TYPE_CLASS_RE = /^text-(body|title|caption|heading|display|label)[a-z-]*$/;
const COLOR_CLASS_RE = /^(text|bg|border)-\(--[a-z0-9-]+\)$/;

function scanAppliedTokens(node: Element): StyleSnapshot["appliedTokens"] {
  const out: StyleSnapshot["appliedTokens"] = {};
  for (const cls of Array.from(node.classList)) {
    if (TYPE_CLASS_RE.test(cls)) out.typeStyle = cls;
    else {
      const m = /^(text|bg|border)-\((--[a-z0-9-]+)\)$/.exec(cls);
      if (m) {
        if (m[1] === "text") out.color = cls;
        else if (m[1] === "bg") out.backgroundColor = cls;
        else out.borderColor = cls;
      }
    }
  }
  return out;
}
```
In `readStyleSnapshot`'s returned object add: `appliedTokens: scanAppliedTokens(node),`.

Add the class-toggle preview handler. In `onMessage`, add a branch:
```ts
  } else if (t === "arcade-studio:preview-class") {
    const { editId, slot, className, prevClassName } = data as
      { editId?: number; slot?: string; className?: string; prevClassName?: string };
    if (typeof editId === "number" && typeof className === "string") {
      applyPreviewClass(editId, className, prevClassName);
    }
  }
```
And the function (track preview-added classes so reset can remove them):
```ts
const previewClasses = new Map<number, Set<string>>(); // editId -> classes we added

function applyPreviewClass(editId: number, className: string, prevClassName?: string) {
  const entry = edits.get(editId);
  if (!entry) return;
  // remove the previous token class for this slot if present
  if (prevClassName) entry.node.classList.remove(prevClassName);
  entry.node.classList.add(className);
  let set = previewClasses.get(editId);
  if (!set) { set = new Set(); previewClasses.set(editId, set); }
  set.add(className);
}
```
In `resetOne(editId)`, after clearing inline styles, also strip preview-added classes:
```ts
  const cls = previewClasses.get(editId);
  if (cls) { for (const c of cls) entry.node.classList.remove(c); previewClasses.delete(editId); }
```
(Note: reset removes classes WE added in preview; the element's original classes are untouched because we only `.remove(prevClassName)` of the same slot during preview and re-`.add` on subsequent picks would re-read from source on HMR. Acceptable: preview is disposable; commit is source-authoritative.)

- [ ] **Step 4: Add the field + helpers in editSessionContext.tsx**

Mirror the field on its `StyleSnapshot` (identical list): add the same `appliedTokens: {...}` line.
Add exports:
```ts
export const TOKEN_PREFIX = "tok:";
export function isTokenPending(v: string | undefined): boolean {
  return typeof v === "string" && v.startsWith(TOKEN_PREFIX);
}
export function tokenClass(v: string): string {
  return v.startsWith(TOKEN_PREFIX) ? v.slice(TOKEN_PREFIX.length) : v;
}
```

- [ ] **Step 5: Fix StyleSnapshot literals that no longer compile**

`grep -rln "appliedTokens\|marginLeft:" studio/__tests__ studio/src` to find full StyleSnapshot literals; add `appliedTokens: {},` to each so they compile (the test-helper STYLES consts in inspector-layout-section / inspector-appearance-section tests, visualEditPreamble test, editSessionContext test, InspectorPanel test).

- [ ] **Step 6: Run green** — both extended test files + full suite:
```
pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts __tests__/hooks/editSessionContext.test.tsx
pnpm run studio:test
```
Expected: PASS (fix any remaining literal missing `appliedTokens`).

- [ ] **Step 7: Commit**

```bash
git add studio/src/frame/inspector.ts studio/src/hooks/editSessionContext.tsx studio/__tests__/frame/inspector-snapshot.test.ts studio/__tests__/hooks/editSessionContext.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): applied-class channel — capture token classes + class-toggle preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: TokenSelect control

**Files:**
- Create: `studio/src/components/inspector/TokenSelect.tsx`
- Test: `studio/__tests__/components/inspector-token-select.test.tsx`

**Interfaces:**
- Consumes: tokenCatalog (Task 1), control styles from `inspectorControls`.
- Produces: `export function TokenSelect({ options, value, onPick, placeholder }: { options: { value: string; label: string; swatch?: string }[]; value: string | null; onPick: (value: string) => void; placeholder?: string }): JSX.Element` — a `<select>` styled like INPUT_COMPACT; when `value` is null shows the placeholder ("— (no token)"); each option shows label (and a swatch chip via a leading colored box if `swatch` set — rendered as an adjacent box since native option can't color-chip, so render a swatch box beside the select reflecting the current value).

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-token-select.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TokenSelect } from "../../src/components/inspector/TokenSelect";

afterEach(cleanup);

const OPTS = [
  { value: "text-body", label: "Body" },
  { value: "text-title-large", label: "Title large" },
];

describe("TokenSelect", () => {
  it("shows the selected option label", () => {
    render(<TokenSelect options={OPTS} value="text-title-large" onPick={vi.fn()} ariaLabel="Style" />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe("text-title-large");
  });
  it("shows placeholder when value is null", () => {
    render(<TokenSelect options={OPTS} value={null} onPick={vi.fn()} ariaLabel="Style" placeholder="— (no token)" />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe(""); // placeholder option selected
    expect(screen.getByText("— (no token)")).toBeTruthy();
  });
  it("emits the chosen value", () => {
    const onPick = vi.fn();
    render(<TokenSelect options={OPTS} value="text-body" onPick={onPick} ariaLabel="Style" />);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "text-title-large" } });
    expect(onPick).toHaveBeenCalledWith("text-title-large");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement TokenSelect.tsx**

Create `studio/src/components/inspector/TokenSelect.tsx`:

```tsx
import { INPUT_COMPACT } from "./inspectorControls";

export function TokenSelect({ options, value, onPick, ariaLabel, placeholder, swatch }: {
  options: { value: string; label: string }[];
  value: string | null;
  onPick: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** optional current swatch color (live-resolved) shown as a leading chip */
  swatch?: string;
}) {
  const ph = placeholder ?? "— (no token)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {swatch !== undefined && (
        <span aria-hidden="true" style={{
          width: 16, height: 16, flex: "none", borderRadius: 4,
          border: "1px solid var(--stroke-neutral-subtle)", background: swatch,
        }} />
      )}
      <select aria-label={ariaLabel} style={{ ...INPUT_COMPACT, flex: 1 }}
        value={value ?? ""}
        onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
        {value === null && <option value="">{ph}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Run green** — PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/TokenSelect.tsx studio/__tests__/components/inspector-token-select.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): TokenSelect dropdown (swatch + no-token state)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Commit emits token classes

**Files:**
- Modify: `studio/src/lib/visualEditPreamble.ts`
- Test: `studio/__tests__/lib/visualEditPreamble.test.ts` (extend)

**Interfaces:**
- Consumes: `isTokenPending`, `tokenClass` (Task 2).
- Produces: a pending value `tok:<className>` renders in the preamble as an explicit class instruction.

- [ ] **Step 1: Write the failing test**

In `studio/__tests__/lib/visualEditPreamble.test.ts`, add:

```ts
it("renders a token-class pending edit as an explicit class instruction", () => {
  const STYLES = { /* full StyleSnapshot incl. appliedTokens:{} */ } as any;
  const el = { selection: { editId: 1, file: "/p/frames/home/index.tsx", line: 5, column: 2, componentName: "Text", tagName: "p", textEditable: true, styles: STYLES },
    pending: { color: "tok:text-(--fg-success-prominent)", typeStyle: "tok:text-title-large" } };
  const out = buildVisualEditPreamble([el], "home/index.tsx");
  expect(out).toContain("text-(--fg-success-prominent)");
  expect(out).toContain("text-title-large");
  expect(out).toMatch(/class/i);
});
```
(Copy the file's existing full STYLES literal, add `appliedTokens: {}`.)

NOTE: `typeStyle` is a new pending KEY (not a StyleSnapshot style field). The preamble iterates `Object.keys(e.pending)`. `typeStyle` will appear as a key; its LABEL needs an entry. Add `typeStyle: "type style"` to the LABELS-equivalent OR handle token keys generically (see Step 3).

- [ ] **Step 2: Run to verify it fails** — FAIL (token edits not rendered as class instructions).

- [ ] **Step 3: Update elementBlock in visualEditPreamble.ts**

Import the helpers:
```ts
import { isTokenPending, tokenClass } from "../hooks/editSessionContext";
```
In `elementBlock`, change the per-key line builder to special-case token edits and the `typeStyle` key:
```ts
  const lines = keys.map((k) => {
    const raw = e.pending[k] as string;
    if (isTokenPending(raw)) {
      return `  - apply class \`${tokenClass(raw)}\` (replace any existing ${LABELS[k] ?? k} class)`;
    }
    const from = s.styles[k as keyof typeof s.styles];
    const to = raw;
    return k === "text"
      ? `  - text content: "${from}" -> "${to}"`
      : `  - ${LABELS[k as keyof typeof LABELS] ?? k}: ${from} -> ${to}`;
  });
```
Add `typeStyle` to `LABELS` (it's a pending key now, though not a StyleSnapshot style field — widen the LABELS type or use a separate lookup):
```ts
const LABELS: Record<string, string> = { /* existing... */, typeStyle: "type style" };
```
(Change the `LABELS` declaration from `Record<keyof StyleSnapshot, string>` to `Record<string, string>` so `typeStyle` fits. Keep all existing entries.)
Also ensure the keys filter still treats `typeStyle` as a real pending key (it is — it's in `e.pending`). The preamble's closing instruction already says "Express every change with idiomatic Tailwind/arcade tokens" — token edits now name the exact class, which is even stronger.

- [ ] **Step 4: Run green** — preamble test PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/visualEditPreamble.ts studio/__tests__/lib/visualEditPreamble.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): commit emits exact token classes for token-first edits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire token controls into the panel

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/InspectorPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `TokenSelect` (3), tokenCatalog (1), `isTokenPending`/`tokenClass`/`TOKEN_PREFIX` (2).
- Produces: Color section = per-slot TokenSelect (applied token preselected) + raw escape field; Typography = Style TokenSelect replacing Font-size + Weight; a `changeToken(slot, className)` that writes `tok:<className>` to pending and posts `arcade-studio:preview-class`.

- [ ] **Step 1: Read InspectorPanel.tsx fully** — note the existing `change(key, rawValue)` (writes pending + posts `arcade-studio:preview`), the `frameWindow` ref, the Color section (3 raw Field inputs), the Typography section (Font size + Weight + Align + Italic).

- [ ] **Step 2: Add a token-change handler.** Near the existing `change`:
```ts
import { colorTokens, typeTokens, colorClassName, colorTokenFromClass, resolveSwatch, type ColorSlot } from "./tokenCatalog";
import { TokenSelect } from "./TokenSelect";
import { TOKEN_PREFIX } from "../../hooks/editSessionContext";
```
```ts
  function changeToken(key: keyof StyleSnapshot, className: string, prevClassName?: string) {
    const id = focusedEditId;
    if (id == null) return;
    setField(id, key, `${TOKEN_PREFIX}${className}`);
    frameWindow?.postMessage(
      { type: "arcade-studio:preview-class", editId: id, slot: key, className, prevClassName },
      "*",
    );
  }
```

- [ ] **Step 3: Rebuild the Color section.** Replace the three raw `Field` color inputs with, per slot (`color`/`backgroundColor`/`borderColor`):
- compute the applied token class for the slot: `const appliedCls = focused?.selection.styles.appliedTokens[slot]` (or from pending if a `tok:` is pending: `const pendingTok = isTokenPending(pending[slot]) ? tokenClass(pending[slot]!) : undefined; const current = pendingTok ?? appliedCls ?? null;`)
- build options from `colorTokens()` mapped through `colorClassName(token, slot)` for the value, label = token label; swatch via `resolveSwatch(token, frameRootEl)` — but the panel is in the PARENT document, not the iframe; the var() resolves differently. SIMPLEST: resolve the swatch against the inspector panel's own root if arcade tokens are loaded in the shell (they are — the shell uses arcade-gen). Use `document.documentElement` as the rootEl for `resolveSwatch`. If a token doesn't resolve in the shell, swatch falls back to "transparent" (degrade, per spec).
- render `<Field label={slotLabel}><TokenSelect ariaLabel={slotLabel} value={current} options={...} swatch={current ? resolveSwatch(tokenOfCurrent, document.documentElement) : undefined} onPick={(cls) => changeToken(slot, cls, current ?? undefined)} placeholder="— (no token)" /></Field>` plus the existing raw escape input BELOW it (keep the current raw `<input>` as a secondary "or raw value" field that routes through the existing `change(slot, rawValue)`).

Keep it readable: a small local `ColorRow` component inside the file handling one slot.

- [ ] **Step 4: Rebuild Typography.** Replace the Font size NumberField + Weight select with a single Style `TokenSelect`:
```ts
const typeOpts = typeTokens().map((t) => ({ value: t.className, label: t.label }));
const appliedType = focused?.selection.styles.appliedTokens.typeStyle;
const pendingType = isTokenPending(pending.typeStyle) ? tokenClass(pending.typeStyle!) : undefined;
const currentType = pendingType ?? appliedType ?? null;
```
Render in the Typography grid: `<Field label="Style"><TokenSelect ariaLabel="Type style" value={currentType} options={typeOpts} onPick={(cls) => changeToken("typeStyle" as keyof StyleSnapshot, cls, currentType ?? undefined)} placeholder="— (no token)" /></Field>`. Keep Align + Italic exactly as they are. Remove the Font size + Weight controls.

NOTE: `typeStyle` isn't a `StyleSnapshot` style key — but pending is `Partial<Record<keyof StyleSnapshot, string>>`. Add `typeStyle` to the pending key space: simplest is to add `typeStyle: string` to StyleSnapshot in BOTH copies in Task 2 (a non-style metadata field, always read as "" in readStyleSnapshot is wrong — instead leave it OUT of readStyleSnapshot's computed reads and only let it live as a pending key). To keep types honest WITHOUT polluting the style snapshot: change the pending map key type to `keyof StyleSnapshot | "typeStyle"`.
  - **Decision for the implementer:** add `typeStyle` to the context's pending key union. In `editSessionContext.tsx`, change `PendingEdits` from `Partial<Record<keyof StyleSnapshot, string>>` to `Partial<Record<keyof StyleSnapshot | "typeStyle", string>>`. Update `setField`/`resetField` signatures to accept that union. This keeps `typeStyle` a first-class pending key without forcing it into the computed StyleSnapshot. (This is a small Task-2 addition — do it in Task 2 when you touch the context; Task 5 consumes it.)

- [ ] **Step 5: Update InspectorPanel.test.tsx.** The existing test asserts Font-size present (`getByLabelText("Font size")` / "W" etc. — confirm which). Typography no longer has Font size/Weight → update those assertions to assert the Style picker (`getByLabelText("Type style")`) and a Color TokenSelect (`getByLabelText("Text")` is now a TokenSelect — assert it's a combobox/select). Keep meaningful assertions (no-Text-input, commit-sends-batch, batch list, Layout present). Do NOT weaken.

- [ ] **Step 6: Run the panel test + full suite.**
```
pnpm run studio:test __tests__/components/InspectorPanel.test.tsx
pnpm run studio:test
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/src/hooks/editSessionContext.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): token-first Color + Typography controls

Color = arcade token dropdown (swatch + name) + raw escape per slot; Typography
= named type-style picker replacing size+weight. Reads the applied class; token
edits preview by class-toggle and commit as the exact class.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manual visual verification (the real gate)

**Files:** none.

- [ ] **Step 1: Restart the app** (Task 2 changed the frame inspector). `pnpm run studio` → `localhost:5556` (or confirm it's already serving).

- [ ] **Step 2: Open a project with frames, pick a text element** that carries a type class (e.g. a heading: `text-title-large`).

- [ ] **Step 3: Typography.** Expected: the **Style** dropdown shows "Title large" selected (read from the applied class), NOT a raw "13" font-size. Pick "Body medium" → the frame text restyles live. There is NO Font-size or Weight numeric field.

- [ ] **Step 4: No-token element.** Pick an element with no type class → Style shows "— (no token)". Picking a token still applies it.

- [ ] **Step 5: Color.** The Text/Fill/Border controls show a token dropdown with a swatch chip; for an element using `text-(--fg-...)` the applied token is preselected. Pick a different color token → frame restyles live. The raw escape field is present below.

- [ ] **Step 6: Commit.** Make a type + color token change, Commit. Open the frame source → confirm it now uses the EXACT picked classes (`text-title-large`, `text-(--fg-success-prominent)`), not raw values.

- [ ] **Step 7: Screenshot the panel** (Playwright, crop the inspector aside) and compare to design-mode's palette/style pickers — the controls must look like token pickers (swatch + name / named styles), not raw value fields. Attach before/after to the PR.

- [ ] **Step 8: Confirm no regression** — Layout/Appearance (slice 1) still work; bulk edit, in-place text, overlay all intact.

---

## Self-Review

**Spec coverage:**
- Read applied class, not reverse-map → Task 2 (`scanAppliedTokens`). ✓
- Color token dropdown + swatch + raw escape → Tasks 1 (catalog), 3 (TokenSelect), 5 (Color section). ✓
- Typography Style picker replaces size+weight → Task 5 (+ typeStyle pending key in Task 2). ✓
- Applied-class channel: capture scan, class-toggle preview, class commit → Tasks 2, 4. ✓
- "— (no token)" empty state → Task 3 (placeholder) + Task 5 (null current). ✓
- Catalog sourced from arcade vocabulary; swatch live-resolved → Task 1. ✓
- Pending sentinel `tok:` distinguishing token vs raw → Task 2 helpers, used in 4 + 5. ✓
- Raw escape hatch retained → Task 5 Color raw input; Align/Italic unchanged. ✓
- Visual gate → Task 6 (screenshot vs design-mode). ✓

**Placeholder scan:** No TBD/TODO. The one genuine design decision (where `typeStyle` lives in the type system) is resolved explicitly in Task 5 Step 4 (pending key union `keyof StyleSnapshot | "typeStyle"`, added in Task 2). Swatch-resolution-context ambiguity resolved (shell `document.documentElement`, degrade to transparent). Catalog-from-CSS-vs-hardcoded resolved (hardcoded curated list this slice, noted as future-generatable).

**Type consistency:** `appliedTokens` shape identical in both StyleSnapshot copies (Task 2). `PendingEdits` widened to `keyof StyleSnapshot | "typeStyle"` (Task 2), consumed by 4/5. `isTokenPending`/`tokenClass`/`TOKEN_PREFIX` defined Task 2, used 4/5. `colorTokens`/`typeTokens`/`colorClassName`/`colorTokenFromClass`/`resolveSwatch`/`ColorSlot` defined Task 1, used 5. `TokenSelect` props (options/value/onPick/ariaLabel/placeholder/swatch) defined Task 3, used 5. Message verb `arcade-studio:preview-class {editId,slot,className,prevClassName}` consistent Task 2 (handler) ↔ Task 5 (sender).

**Known risk flagged for implementer:** (1) `typeStyle` is a pending key that is NOT a computed StyleSnapshot style — keep it out of `readStyleSnapshot`'s computed reads; it only ever lives in `pending` and `appliedTokens.typeStyle`. (2) Swatch color resolves against the SHELL document (panel lives in the parent, not the iframe); arcade tokens are loaded in the shell so this works, but if a token doesn't resolve, degrade to a transparent chip (don't crash). (3) Task 5 is the integration point — keep the raw escape field so non-token values stay editable; the token control is additive, not a replacement of the raw channel for color. (4) This slice is VISUAL — Task 6's screenshot gate is mandatory, tests alone are insufficient (prior slice shipped a passing-but-ugly wall).
