# Rich Panel Slice 1 (Shell + Layout + Appearance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inspector's flat Spacing section with a collapsible-section shell plus rich Layout (box model + sizing + layout-mode toggle) and Appearance (opacity + corner radius) sections, in design-mode's structure painted with arcade tokens.

**Architecture:** Widen `StyleSnapshot` by 8 fields (reusing the proven v2 pipeline). Add a reusable `Section` collapsible-shell component + a shared `inspectorControls` module (lifting the panel's existing `change`/`fieldValue`/px helpers + new `NumberField`/`SegmentedToggle`/`ExpandableSpacing` primitives). Build `LayoutSection` + `AppearanceSection` on those, wire them into `InspectorPanel` (removing the old Spacing block, wrapping the kept Typography/Color in `Section` shells too). All edits feed the existing `pending` batch; Commit is unchanged.

**Tech Stack:** React 19, TypeScript, `@xorkavi/arcade-gen` (Button + icons), Vitest + jsdom + @testing-library/react. pnpm.

## Global Constraints

- **pnpm only.** Before running tests in this environment, the shell needs:
  `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` and
  `export GITHUB_TOKEN_PACKAGES="$GITHUB_TOKEN"`. If `pnpm`/`vitest` are still
  "not found" after those exports, STOP and report — do NOT assume npm-auth.
- **Run tests from the repo root** (`/Users/andrey.sundiev/arcade-prototyper`):
  `pnpm run studio:test <path>` (path relative to `studio/`); full suite
  `pnpm run studio:test`.
- **Commits:** Conventional Commits, scope `studio/inspector`. End each commit
  body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — stage explicit paths only.
- **Component tests** use `// @vitest-environment jsdom` and mock
  `@xorkavi/arcade-gen` (export only the symbols the component uses).
- **editId is a number.** **Live preview stays raw CSS** (`node.style.*`); token
  mapping happens only at commit via Claude — do not token-map in the controls.
- **Enum fields** (`display`, `flexDirection`) must NOT pass through px
  helpers (`toNumberInput`/`fromNumberInput`) — they're like the existing
  `fontWeight`/`textAlign`/`fontStyle`.
- **StyleSnapshot field lists must stay identical** between the shell copy
  (`editSessionContext.tsx`) and the iframe structural re-declaration
  (`frame/inspector.ts`) — documented contract.
- **design-mode borrow** is MIT (already attributed in `THIRD-PARTY.md`); any
  copied SVG keeps that attribution.

---

## File Structure

- **Modify** `studio/src/hooks/editSessionContext.tsx` — add 8 `StyleSnapshot` fields. (Task 1)
- **Modify** `studio/src/frame/inspector.ts` — add the 8 to its `StyleSnapshot` + `STYLE_FIELDS` + `readStyleSnapshot`. (Task 1)
- **Modify** `studio/src/lib/visualEditPreamble.ts` — add 8 `LABELS`. (Task 1)
- **Create** `studio/src/components/inspector/Section.tsx` — collapsible section shell. (Task 2)
- **Create** `studio/src/components/inspector/inspectorControls.tsx` — shared styles + helpers + control primitives. (Task 3)
- **Create** `studio/src/components/inspector/LayoutSection.tsx` — Layout section. (Task 4)
- **Create** `studio/src/components/inspector/AppearanceSection.tsx` — Appearance section. (Task 5)
- **Modify** `studio/src/components/inspector/InspectorPanel.tsx` — compose sections, drop Spacing block. (Task 6)
- Tests alongside in `studio/__tests__/`.

### Shared types (Task 1; consumed by all later tasks)

After Task 1, `StyleSnapshot` (in BOTH `editSessionContext.tsx` and
`inspector.ts`) is the current 19 fields **plus**:
```ts
minWidth: string; maxWidth: string; minHeight: string; maxHeight: string;
display: string; flexDirection: string; opacity: string; borderRadius: string;
```

### Control-helper contract (Task 3; consumed by Tasks 4, 5, 6)

```ts
// studio/src/components/inspector/inspectorControls.tsx
export const FIELD_ROW: React.CSSProperties;
export const COL_LABEL: React.CSSProperties;
export const INPUT: React.CSSProperties;
export const SECTION_BODY: React.CSSProperties; // column flex, gap 10
export function toNumberInput(v: string): string;   // strip trailing "px"
export function fromNumberInput(v: string): string; // re-add "px" (""→"")
export function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string;
// A controlled change callback shape sections use:
export type ChangeFn = (key: keyof StyleSnapshot, rawValue: string) => void;
// Primitives:
export function NumberField(props: { id: string; label: string; valuePx: string; onChange: (px: string) => void }): JSX.Element;
export function SegmentedToggle(props: { ariaLabel: string; options: { value: string; label: string; icon?: React.ReactNode }[]; value: string; onChange: (v: string) => void }): JSX.Element;
```

---

### Task 1: Widen StyleSnapshot (8 fields) across context, inspector, preamble

**Files:**
- Modify: `studio/src/hooks/editSessionContext.tsx`
- Modify: `studio/src/frame/inspector.ts`
- Modify: `studio/src/lib/visualEditPreamble.ts`
- Test: `studio/__tests__/frame/overlay/`... NO — Test: extend `studio/__tests__/frame/inspector-snapshot.test.ts` and `studio/__tests__/lib/visualEditPreamble.test.ts`

**Interfaces:**
- Produces: `StyleSnapshot` with the 8 new fields (identical in both copies); `readStyleSnapshot` populates them; `STYLE_FIELDS` includes the 7 style ones (NOT `text`, which is already separate — the 8 new are all style fields); `LABELS` covers all 8.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `studio/__tests__/frame/inspector-snapshot.test.ts`, extend the `readStyleSnapshot` field-presence test to include the new fields. Add to the existing field-list assertion (find the test that checks each documented field is a string) these keys:
```ts
"minWidth","maxWidth","minHeight","maxHeight","display","flexDirection","opacity","borderRadius",
```
And add a focused assertion:
```ts
it("reads the slice-1 layout/appearance fields", () => {
  const el = document.createElement("div");
  el.style.minWidth = "10px"; el.style.opacity = "0.5"; el.style.display = "flex";
  document.body.appendChild(el);
  const snap = readStyleSnapshot(el);
  expect(snap.minWidth).toBe("10px");
  expect(snap.opacity).toBe("0.5");
  expect(snap.display).toBe("flex");
  expect(typeof snap.flexDirection).toBe("string");
  expect(typeof snap.borderRadius).toBe("string");
});
```

In `studio/__tests__/lib/visualEditPreamble.test.ts`, add:
```ts
it("labels the slice-1 layout/appearance fields", () => {
  const STYLES = { /* a full StyleSnapshot literal — copy the test's existing one and add the 8 new fields with "0px"/"none"/"1"/"block"/"row" defaults */ } as any;
  const el = { selection: { editId: 1, file: "/p/frames/home/index.tsx", line: 5, column: 2, componentName: "Box", tagName: "div", textEditable: false, styles: STYLES }, pending: { minWidth: "100px", opacity: "0.5", display: "flex" } };
  const out = buildVisualEditPreamble([el], "home/index.tsx");
  expect(out).toContain("min width: ");
  expect(out).toContain("opacity: ");
  expect(out).toContain("display: ");
});
```
(When you copy the existing full-StyleSnapshot literal in that test file, you MUST add the 8 new keys to it or the type won't compile — do that for every StyleSnapshot literal in the changed test files.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts __tests__/lib/visualEditPreamble.test.ts`
Expected: FAIL — new fields missing from snapshot/labels (and TS errors on incomplete StyleSnapshot literals).

- [ ] **Step 3: Add the fields to editSessionContext.tsx**

In `studio/src/hooks/editSessionContext.tsx`, in the `StyleSnapshot` interface, after the existing fields (after `gap: string; width: string; height: string;`) add:
```ts
  minWidth: string; maxWidth: string; minHeight: string; maxHeight: string;
  display: string; flexDirection: string;
  opacity: string; borderRadius: string;
```

- [ ] **Step 4: Add to inspector.ts (interface + STYLE_FIELDS + readStyleSnapshot)**

In `studio/src/frame/inspector.ts`:
1. Add the SAME 8 fields to its `StyleSnapshot` interface (identical list/order).
2. In `STYLE_FIELDS` (the array of previewable style keys), add the 8:
   ```ts
   "minWidth", "maxWidth", "minHeight", "maxHeight", "display", "flexDirection", "opacity", "borderRadius",
   ```
3. In `readStyleSnapshot`, add to the returned object:
   ```ts
   minWidth: cs.minWidth, maxWidth: cs.maxWidth, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
   display: cs.display, flexDirection: cs.flexDirection,
   opacity: cs.opacity, borderRadius: cs.borderTopLeftRadius,
   ```
   (Use `cs.borderTopLeftRadius` as the representative radius — `getComputedStyle().borderRadius` is often `""` when corners differ, same pattern as the borderColor→borderTopColor proxy already in the file.)

- [ ] **Step 5: Add labels to visualEditPreamble.ts**

In `studio/src/lib/visualEditPreamble.ts` `LABELS`, add:
```ts
  minWidth: "min width", maxWidth: "max width", minHeight: "min height", maxHeight: "max height",
  display: "display", flexDirection: "flex direction",
  opacity: "opacity", borderRadius: "corner radius",
```

- [ ] **Step 6: Fix any other StyleSnapshot literals that now fail to compile**

Run a grep to find every full StyleSnapshot literal in tests:
```
grep -rln "fontWeight:" studio/__tests__ | xargs grep -l "marginLeft:"
```
For each, add the 8 new keys (sensible defaults: `minWidth:"0px", maxWidth:"none", minHeight:"0px", maxHeight:"none", display:"block", flexDirection:"row", opacity:"1", borderRadius:"0px"`) so they compile.

- [ ] **Step 7: Run green**

Run: `pnpm run studio:test __tests__/frame/inspector-snapshot.test.ts __tests__/lib/visualEditPreamble.test.ts`
Expected: PASS.
Run the full suite to catch other StyleSnapshot-literal compile breaks:
Run: `pnpm run studio:test`
Expected: PASS (fix any remaining literal in a test by adding the 8 keys).

- [ ] **Step 8: Commit**

```bash
git add studio/src/hooks/editSessionContext.tsx studio/src/frame/inspector.ts studio/src/lib/visualEditPreamble.ts studio/__tests__/frame/inspector-snapshot.test.ts studio/__tests__/lib/visualEditPreamble.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/inspector): widen StyleSnapshot for Layout + Appearance (slice 1)

Adds min/max W/H, display, flexDirection, opacity, borderRadius across the
shell + iframe snapshot + preview fields + commit labels.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Section shell component

**Files:**
- Create: `studio/src/components/inspector/Section.tsx`
- Test: `studio/__tests__/components/inspector-section.test.tsx`

**Interfaces:**
- Produces: `export function Section({ title, icon, defaultOpen, children }: { title: string; icon?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }): JSX.Element`. Header row (icon + title + a collapse chevron button on the right); clicking the header toggles a local `open` state (initialized from `defaultOpen ?? true`); body renders `children` only when open.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-section.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Section } from "../../src/components/inspector/Section";

afterEach(cleanup);

describe("Section", () => {
  it("renders title and shows children when open by default", () => {
    render(<Section title="Layout"><div>body-content</div></Section>);
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByText("body-content")).toBeTruthy();
  });
  it("collapses and expands on header click", () => {
    render(<Section title="Layout"><div>body-content</div></Section>);
    fireEvent.click(screen.getByText("Layout"));
    expect(screen.queryByText("body-content")).toBeNull();
    fireEvent.click(screen.getByText("Layout"));
    expect(screen.getByText("body-content")).toBeTruthy();
  });
  it("respects defaultOpen=false", () => {
    render(<Section title="Layout" defaultOpen={false}><div>body-content</div></Section>);
    expect(screen.queryByText("body-content")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm run studio:test __tests__/components/inspector-section.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement Section.tsx**

Create `studio/src/components/inspector/Section.tsx`:
```tsx
import { useState, type ReactNode } from "react";

const HEADER: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
  padding: "10px 14px", borderTop: "1px solid var(--stroke-neutral-subtle)",
  userSelect: "none",
};
const TITLE: React.CSSProperties = {
  flex: 1, fontSize: 12, fontWeight: 600, color: "var(--fg-neutral-prominent)",
};
const BODY: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10, padding: "0 14px 12px",
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ color: "var(--fg-neutral-subtle)", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 120ms ease" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function Section({
  title, icon, defaultOpen = true, children,
}: {
  title: string; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div style={HEADER} onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open}>
        {icon && <span style={{ display: "flex", color: "var(--fg-neutral-medium)" }} aria-hidden="true">{icon}</span>}
        <span style={TITLE}>{title}</span>
        <Chevron open={open} />
      </div>
      {open && <div style={BODY}>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run green** — Run the test → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/Section.tsx studio/__tests__/components/inspector-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): collapsible Section shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shared control helpers + primitives

**Files:**
- Create: `studio/src/components/inspector/inspectorControls.tsx`
- Test: `studio/__tests__/components/inspector-controls.test.tsx`

**Interfaces:** as in the "Control-helper contract" above. `NumberField` is a labeled `type="number"` input that strips/re-adds px around its `valuePx` prop. `SegmentedToggle` renders a row of buttons (icon and/or label), the active one highlighted, calling `onChange(value)`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-controls.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NumberField, SegmentedToggle, toNumberInput, fromNumberInput } from "../../src/components/inspector/inspectorControls";

afterEach(cleanup);

describe("px helpers", () => {
  it("strip and re-add px", () => {
    expect(toNumberInput("16px")).toBe("16");
    expect(fromNumberInput("16")).toBe("16px");
    expect(fromNumberInput("")).toBe("");
  });
});

describe("NumberField", () => {
  it("shows the px value without unit and emits px on change", () => {
    const onChange = vi.fn();
    render(<NumberField id="w" label="W" valuePx="120px" onChange={onChange} />);
    const input = screen.getByLabelText("W") as HTMLInputElement;
    expect(input.value).toBe("120");
    fireEvent.change(input, { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith("200px");
  });
});

describe("SegmentedToggle", () => {
  it("renders options and emits the chosen value", () => {
    const onChange = vi.fn();
    render(<SegmentedToggle ariaLabel="Layout mode" value="block"
      options={[{ value: "block", label: "Free" }, { value: "flex", label: "Row" }]}
      onChange={onChange} />);
    fireEvent.click(screen.getByText("Row"));
    expect(onChange).toHaveBeenCalledWith("flex");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm run studio:test __tests__/components/inspector-controls.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement inspectorControls.tsx**

Create `studio/src/components/inspector/inspectorControls.tsx`:
```tsx
import type { ReactNode } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";

export const SECTION_BODY: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
export const FIELD_ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
export const COL_LABEL: React.CSSProperties = { width: 84, fontSize: 12, color: "var(--fg-neutral-medium)", flex: "none" };
export const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-prominent)", fontSize: 12,
};

export function toNumberInput(v: string): string { return v.endsWith("px") ? v.slice(0, -2) : v; }
export function fromNumberInput(v: string): string { return v === "" ? "" : `${v}px`; }
export function fieldValue(styles: StyleSnapshot, pending: PendingEdits, key: keyof StyleSnapshot): string {
  return pending[key] ?? styles[key];
}

export type ChangeFn = (key: keyof StyleSnapshot, rawValue: string) => void;

export function NumberField({ id, label, valuePx, onChange }: {
  id: string; label: string; valuePx: string; onChange: (px: string) => void;
}) {
  return (
    <div style={FIELD_ROW}>
      <label htmlFor={id} style={COL_LABEL}>{label}</label>
      <input id={id} type="number" aria-label={label} style={INPUT}
        value={toNumberInput(valuePx)}
        onChange={(e) => onChange(fromNumberInput(e.target.value))} />
    </div>
  );
}

export function SegmentedToggle({ ariaLabel, options, value, onChange }: {
  ariaLabel: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg-neutral-soft)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={active}
            onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              height: 26, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12,
              background: active ? "var(--surface-overlay)" : "transparent",
              color: active ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
            }}>
            {o.icon}
            {!o.icon && o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run green** — Run the test → PASS (3 describes).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/inspectorControls.tsx studio/__tests__/components/inspector-controls.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): shared control helpers + NumberField/SegmentedToggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: LayoutSection

**Files:**
- Create: `studio/src/components/inspector/LayoutSection.tsx`
- Test: `studio/__tests__/components/inspector-layout-section.test.tsx`

**Interfaces:**
- Consumes: `NumberField`, `SegmentedToggle`, `fieldValue`, `SECTION_BODY`, `FIELD_ROW`, `COL_LABEL`, `INPUT` (Task 3); `StyleSnapshot`/`PendingEdits` (Task 1).
- Produces: `export function LayoutSection({ styles, pending, change }: { styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn }): JSX.Element`.
- Behavior:
  - **Layout mode** SegmentedToggle (4 options): Free→`display:block`, Row→`display:flex`+`flexDirection:row`, Col→`display:flex`+`flexDirection:column`, Grid→`display:grid`. Current selection derived from `fieldValue(...,"display")` + `flexDirection`. On select, call `change("display", ...)` and (for row/col) `change("flexDirection", ...)`.
  - **W / H** NumberFields + an **aspect-lock** toggle button (a small button between/after them). When locked, editing W writes H = round(W * ratio) and previews both; ratio captured from `styles.width`/`styles.height` at the moment lock is enabled (parse px; if either isn't finite, lock is a no-op).
  - **min-W / max-W / min-H / max-H** NumberFields.
  - **margin** + **padding**: each a uniform NumberField + an expand button; when expanded, show the 4 side NumberFields (top/right/bottom/left). Uniform field writes all four sides at once (e.g. uniform margin → change marginTop/Right/Bottom/Left to the same value). Expand state is local `useState`.
  - **gap** NumberField, shown only when the effective display is `flex` or `grid` (read `fieldValue(...,"display")`).

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-layout-section.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LayoutSection } from "../../src/components/inspector/LayoutSection";
import type { StyleSnapshot } from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "", fontSize: "16px", fontWeight: "400", fontStyle: "normal", textAlign: "left",
  color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", borderColor: "rgb(0,0,0)",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
  gap: "0px", width: "200px", height: "100px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
};
afterEach(cleanup);

describe("LayoutSection", () => {
  it("layout-mode Row writes display:flex + flexDirection:row", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByTitle("Row"));
    expect(change).toHaveBeenCalledWith("display", "flex");
    expect(change).toHaveBeenCalledWith("flexDirection", "row");
  });
  it("Grid writes display:grid", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByTitle("Grid"));
    expect(change).toHaveBeenCalledWith("display", "grid");
  });
  it("editing W writes width in px", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "300" } });
    expect(change).toHaveBeenCalledWith("width", "300px");
  });
  it("aspect-lock: editing W also writes H at the same ratio", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    // ratio H/W = 100/200 = 0.5
    fireEvent.click(screen.getByLabelText(/lock aspect/i));
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "400" } });
    expect(change).toHaveBeenCalledWith("width", "400px");
    expect(change).toHaveBeenCalledWith("height", "200px");
  });
  it("gap hidden unless flex/grid", () => {
    const change = vi.fn();
    const { rerender } = render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    expect(screen.queryByLabelText("Gap")).toBeNull();
    rerender(<LayoutSection styles={STYLES} pending={{ display: "flex" }} change={change} />);
    expect(screen.getByLabelText("Gap")).toBeTruthy();
  });
  it("expand padding reveals four side fields", () => {
    const change = vi.fn();
    render(<LayoutSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.click(screen.getByLabelText(/expand padding/i));
    expect(screen.getByLabelText("Padding top")).toBeTruthy();
    expect(screen.getByLabelText("Padding left")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm run studio:test __tests__/components/inspector-layout-section.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement LayoutSection.tsx**

Create `studio/src/components/inspector/LayoutSection.tsx`:
```tsx
import { useState, useRef } from "react";
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import {
  NumberField, SegmentedToggle, fieldValue, toNumberInput, fromNumberInput,
  FIELD_ROW, COL_LABEL, type ChangeFn,
} from "./inspectorControls";

const ICON = (path: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);
// Minimal inline glyphs (no external icon dep). Free=dashed square, Row=cols, Col=rows, Grid=grid.
const FREE = ICON(<rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />);
const ROW = ICON(<><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></>);
const COL = ICON(<><rect x="4" y="3" width="16" height="7" rx="1" /><rect x="4" y="14" width="16" height="7" rx="1" /></>);
const GRID = ICON(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);

function px(v: string): number { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }

const EXPAND_BTN: React.CSSProperties = {
  width: 28, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--stroke-neutral-subtle)", borderRadius: 6, background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-subtle)", cursor: "pointer",
};

export function LayoutSection({ styles, pending, change }: {
  styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn;
}) {
  const [aspectLocked, setAspectLocked] = useState(false);
  const ratioRef = useRef<number | null>(null);
  const [marginExpanded, setMarginExpanded] = useState(false);
  const [paddingExpanded, setPaddingExpanded] = useState(false);

  const display = fieldValue(styles, pending, "display");
  const flexDir = fieldValue(styles, pending, "flexDirection");
  const mode =
    display === "grid" ? "grid"
    : display === "flex" ? (flexDir === "column" ? "col" : "row")
    : "free";

  function setMode(v: string) {
    if (v === "free") change("display", "block");
    else if (v === "grid") change("display", "grid");
    else { change("display", "flex"); change("flexDirection", v === "col" ? "column" : "row"); }
  }

  function toggleLock() {
    const next = !aspectLocked;
    if (next) {
      const w = px(fieldValue(styles, pending, "width"));
      const h = px(fieldValue(styles, pending, "height"));
      ratioRef.current = Number.isFinite(w) && Number.isFinite(h) && w > 0 ? h / w : null;
    }
    setAspectLocked(next);
  }
  function onW(pxVal: string) {
    change("width", pxVal);
    if (aspectLocked && ratioRef.current != null) {
      const w = px(pxVal);
      if (Number.isFinite(w)) change("height", `${Math.round(w * ratioRef.current)}px`);
    }
  }
  function onH(pxVal: string) {
    change("height", pxVal);
    if (aspectLocked && ratioRef.current != null && ratioRef.current > 0) {
      const h = px(pxVal);
      if (Number.isFinite(h)) change("width", `${Math.round(h / ratioRef.current)}px`);
    }
  }
  function uniform(side4: ("Top"|"Right"|"Bottom"|"Left")[], base: "margin"|"padding", pxVal: string) {
    for (const s of side4) change(`${base}${s}` as keyof StyleSnapshot, pxVal);
  }

  const showGap = display === "flex" || display === "grid";

  return (
    <div style={SECTION_BODY_LOCAL}>
      <SegmentedToggle ariaLabel="Layout mode" value={mode} onChange={setMode}
        options={[
          { value: "free", label: "Free", icon: FREE },
          { value: "row", label: "Row", icon: ROW },
          { value: "col", label: "Col", icon: COL },
          { value: "grid", label: "Grid", icon: GRID },
        ]} />

      <div style={{ ...FIELD_ROW }}>
        <NumberField id="ins-w" label="W" valuePx={fieldValue(styles, pending, "width")} onChange={onW} />
        <button type="button" aria-label={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
          aria-pressed={aspectLocked} onClick={toggleLock} style={{ ...EXPAND_BTN, color: aspectLocked ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)" }} title="Lock aspect">
          {aspectLocked ? "🔒" : "🔓"}
        </button>
        <NumberField id="ins-h" label="H" valuePx={fieldValue(styles, pending, "height")} onChange={onH} />
      </div>

      <NumberField id="ins-minw" label="Min W" valuePx={fieldValue(styles, pending, "minWidth")} onChange={(v) => change("minWidth", v)} />
      <NumberField id="ins-maxw" label="Max W" valuePx={fieldValue(styles, pending, "maxWidth")} onChange={(v) => change("maxWidth", v)} />
      <NumberField id="ins-minh" label="Min H" valuePx={fieldValue(styles, pending, "minHeight")} onChange={(v) => change("minHeight", v)} />
      <NumberField id="ins-maxh" label="Max H" valuePx={fieldValue(styles, pending, "maxHeight")} onChange={(v) => change("maxHeight", v)} />

      {/* Margin */}
      <div style={FIELD_ROW}>
        <NumberField id="ins-margin" label="Margin" valuePx={fieldValue(styles, pending, "marginTop")} onChange={(v) => uniform(["Top","Right","Bottom","Left"], "margin", v)} />
        <button type="button" aria-label="Expand margin" onClick={() => setMarginExpanded((x) => !x)} style={EXPAND_BTN} title="Per-side">⤢</button>
      </div>
      {marginExpanded && (["Top","Right","Bottom","Left"] as const).map((s) => (
        <NumberField key={s} id={`ins-margin-${s}`} label={`Margin ${s.toLowerCase()}`} valuePx={fieldValue(styles, pending, `margin${s}` as keyof StyleSnapshot)} onChange={(v) => change(`margin${s}` as keyof StyleSnapshot, v)} />
      ))}

      {/* Padding */}
      <div style={FIELD_ROW}>
        <NumberField id="ins-padding" label="Padding" valuePx={fieldValue(styles, pending, "paddingTop")} onChange={(v) => uniform(["Top","Right","Bottom","Left"], "padding", v)} />
        <button type="button" aria-label="Expand padding" onClick={() => setPaddingExpanded((x) => !x)} style={EXPAND_BTN} title="Per-side">⤢</button>
      </div>
      {paddingExpanded && (["Top","Right","Bottom","Left"] as const).map((s) => (
        <NumberField key={s} id={`ins-padding-${s}`} label={`Padding ${s.toLowerCase()}`} valuePx={fieldValue(styles, pending, `padding${s}` as keyof StyleSnapshot)} onChange={(v) => change(`padding${s}` as keyof StyleSnapshot, v)} />
      ))}

      {showGap && (
        <NumberField id="ins-gap" label="Gap" valuePx={fieldValue(styles, pending, "gap")} onChange={(v) => change("gap", v)} />
      )}
    </div>
  );
}

const SECTION_BODY_LOCAL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
```

(Note: the uniform margin/padding field reads `marginTop`/`paddingTop` as its displayed value — a reasonable representative of a uniform value; `toNumberInput`/`fromNumberInput` come via NumberField.)

- [ ] **Step 4: Run green**

Run: `pnpm run studio:test __tests__/components/inspector-layout-section.test.tsx`
Expected: PASS (6 tests). If the aspect-lock label test can't find the button by `/lock aspect/i`, ensure the button's `aria-label` contains "aspect" in both states (it does: "Lock aspect ratio"/"Unlock aspect ratio").

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/LayoutSection.tsx studio/__tests__/components/inspector-layout-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): Layout section — mode toggle, box model, aspect lock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: AppearanceSection

**Files:**
- Create: `studio/src/components/inspector/AppearanceSection.tsx`
- Test: `studio/__tests__/components/inspector-appearance-section.test.tsx`

**Interfaces:**
- Consumes: `NumberField`, `fieldValue`, `FIELD_ROW`, `COL_LABEL`, `INPUT` (Task 3); types (Task 1).
- Produces: `export function AppearanceSection({ styles, pending, change }: { styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn }): JSX.Element`.
- Behavior:
  - **Opacity**: a plain number field (0–100) bound to `opacity` — but `opacity` is unitless (CSS `0`–`1`). Display as percent: show `Math.round(parseFloat(opacity)*100)`; on change write `String(pct/100)`. So a dedicated handler, NOT NumberField (which assumes px).
  - **Corner radius**: NumberField bound to `borderRadius`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-appearance-section.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppearanceSection } from "../../src/components/inspector/AppearanceSection";
import type { StyleSnapshot } from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "", fontSize: "16px", fontWeight: "400", fontStyle: "normal", textAlign: "left",
  color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", borderColor: "rgb(0,0,0)",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
  gap: "0px", width: "200px", height: "100px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
};
afterEach(cleanup);

describe("AppearanceSection", () => {
  it("shows opacity as percent and writes the unitless value", () => {
    const change = vi.fn();
    render(<AppearanceSection styles={STYLES} pending={{}} change={change} />);
    const op = screen.getByLabelText("Opacity") as HTMLInputElement;
    expect(op.value).toBe("100");
    fireEvent.change(op, { target: { value: "50" } });
    expect(change).toHaveBeenCalledWith("opacity", "0.5");
  });
  it("corner radius writes px", () => {
    const change = vi.fn();
    render(<AppearanceSection styles={STYLES} pending={{}} change={change} />);
    fireEvent.change(screen.getByLabelText("Corner radius"), { target: { value: "8" } });
    expect(change).toHaveBeenCalledWith("borderRadius", "8px");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm run studio:test __tests__/components/inspector-appearance-section.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement AppearanceSection.tsx**

Create `studio/src/components/inspector/AppearanceSection.tsx`:
```tsx
import type { StyleSnapshot, PendingEdits } from "../../hooks/editSessionContext";
import { NumberField, fieldValue, FIELD_ROW, COL_LABEL, INPUT, type ChangeFn } from "./inspectorControls";

export function AppearanceSection({ styles, pending, change }: {
  styles: StyleSnapshot; pending: PendingEdits; change: ChangeFn;
}) {
  const opacityRaw = fieldValue(styles, pending, "opacity");
  const pct = Math.round((parseFloat(opacityRaw) || 0) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={FIELD_ROW}>
        <label htmlFor="ins-opacity" style={COL_LABEL}>Opacity</label>
        <input id="ins-opacity" type="number" aria-label="Opacity" min={0} max={100} style={INPUT}
          value={String(pct)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            const clamped = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
            change("opacity", String(clamped / 100));
          }} />
      </div>
      <NumberField id="ins-radius" label="Corner radius" valuePx={fieldValue(styles, pending, "borderRadius")} onChange={(v) => change("borderRadius", v)} />
    </div>
  );
}
```

(Per-corner radius expand is deferred — the spec lists it, but the single radius + the proven `borderTopLeftRadius` proxy covers the common case; adding 4-corner is a small follow-up. NOTE: this is a deliberate scope trim — see Self-Review. If the spec's per-corner is required, add a `borderRadius`-only field now and the 4-corner expand in a follow-up task.)

- [ ] **Step 4: Run green** — Run the test → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/AppearanceSection.tsx studio/__tests__/components/inspector-appearance-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): Appearance section — opacity (%) + corner radius

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire sections into InspectorPanel; remove old Spacing block

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/InspectorPanel.test.tsx` (update)

**Interfaces:**
- Consumes: `Section` (Task 2), `LayoutSection` (Task 4), `AppearanceSection` (Task 5), and the shared helpers (Task 3).
- Produces: the panel renders, for the focused element, `<Section title="Layout">`, `<Section title="Appearance">`, plus the existing Typography + Color wrapped in `<Section>` shells; the old free-standing Spacing block is gone.

- [ ] **Step 1: Read InspectorPanel.tsx fully.** It currently has inline `change`, `fieldValue`, `toNumberInput`, `fromNumberInput`, the style consts (SECTION/LABEL/FIELD_ROW/COL_LABEL/INPUT), and three section blocks (Typography lines ~189-220, Color ~222-235, Spacing ~237-248).

- [ ] **Step 2: Swap the local helpers for the shared module.** Replace the local `toNumberInput`/`fromNumberInput`/`fieldValue` (lines 10-14) with an import from `./inspectorControls`:
```ts
import { fieldValue } from "./inspectorControls";
```
Keep the local `change()` function as-is (it already matches the `ChangeFn` shape `(key, rawValue) => void`). Keep `countChanges` local. Remove the now-unused `toNumberInput`/`fromNumberInput` locals (the Typography/Color blocks still inline-use them — so either keep them OR have those blocks use the shared ones; simplest: import `toNumberInput, fromNumberInput` too and delete the locals).

- [ ] **Step 3: Add imports** at the top:
```ts
import { Section } from "./Section";
import { LayoutSection } from "./LayoutSection";
import { AppearanceSection } from "./AppearanceSection";
```

- [ ] **Step 4: Replace the three section blocks.** Where the focused-element sections render (the `{focused && styles && (...)}` block), replace the Typography / Color / Spacing `<div style={SECTION}>` blocks with `<Section>`-wrapped content:
- Keep the Typography fields, wrapped: `<Section title="Typography">...the existing 4 Typography rows...</Section>`.
- Keep the Color fields, wrapped: `<Section title="Color">...the existing 3 color rows...</Section>`.
- **DELETE the entire Spacing `<div style={SECTION}>` block** (the one iterating padding/margin/gap/width/height).
- Add `<Section title="Layout"><LayoutSection styles={styles} pending={pending} change={change} /></Section>` and `<Section title="Appearance"><AppearanceSection styles={styles} pending={pending} change={change} /></Section>`.
- Order: Layout, Appearance, Typography, Color (Layout first — it's the most-used; matches design-mode's ordering with Layout/Appearance high).

Keep the text-editable hint, the batch list, header, Commit/Discard, resize handle exactly as they are.

- [ ] **Step 5: Update InspectorPanel.test.tsx**

Run the existing test first: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`. It likely has an assertion tied to the old Spacing inputs or the flat section. Update any assertion that referenced the removed Spacing block to instead assert the Layout section is present (e.g. `screen.getByText("Layout")`). Do NOT weaken the meaningful assertions (the no-Text-input check, commit-sends-batch, batch-list-count, focused-controls-seed all stay). If the test asserted `screen.getByLabelText("paddingTop")` etc. from the old block, switch to asserting the Layout section renders W/H (`screen.getByLabelText("W")`).

- [ ] **Step 6: Run the panel test + full suite**

Run: `pnpm run studio:test __tests__/components/InspectorPanel.test.tsx`
Expected: PASS.
Run: `pnpm run studio:test`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): compose Layout + Appearance sections; drop flat Spacing

Wraps all focused-element controls in collapsible Section shells; Layout
(box model + sizing + mode toggle) replaces the old flat Spacing block.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual end-to-end verification

**Files:** none.

- [ ] **Step 1: Restart the app** (Task 1 touched the frame bootstrap's inspector). `pnpm run studio` → `localhost:5556`.

- [ ] **Step 2: Pick an element.** Expected: panel shows collapsible sections — **Layout**, **Appearance**, Typography, Color. Each collapses/expands on header click.

- [ ] **Step 3: Layout mode.** Toggle Free/Row/Col/Grid on a container. Expected: the frame element's layout changes live (children reflow); Gap field appears for Row/Col/Grid.

- [ ] **Step 4: Box model.** Set W/H; toggle aspect-lock and change W → H tracks the ratio live. Expand padding → 4 side fields; set them → live preview. Set min/max.

- [ ] **Step 5: Appearance.** Set opacity to 50 → element goes half-transparent live. Set corner radius → element rounds live.

- [ ] **Step 6: Commit.** Make a few Layout + Appearance changes, Commit. Expected: chat turn runs; frame source rewritten with idiomatic Tailwind (`flex`, `flex-col`, `grid`, `p-4`, `min-w-*`, `opacity-*`, `rounded-*`) — open the frame source and confirm tokens, not raw px/inline style.

- [ ] **Step 7: Bulk + the rest unchanged.** Confirm bulk edit (2 elements), in-place text, the overlay, resize all still work — slice 1 didn't regress v2/Phase1.

- [ ] **Step 8: Record** before/after screenshots (the new collapsible Layout/Appearance panel + a committed token diff) in the PR. No commit.

---

## Self-Review

**Spec coverage:**
- Section shell (collapsible) → Task 2. ✓
- Layout: mode toggle, W/H + aspect-lock, min/max, margin/padding uniform+expand, gap-conditional → Task 4. ✓
- Appearance: opacity (%), corner radius → Task 5. ✓ **Gap vs spec:** the spec lists corner-radius **per-corner expand**; Task 5 ships single radius only and explicitly flags the per-corner expand as a deferred follow-up (the `borderTopLeftRadius` proxy + single field covers the common case). This is a deliberate, flagged trim — surface it to the human at review so they can require the 4-corner expand if wanted.
- 8 new StyleSnapshot fields across context/inspector/preamble → Task 1. ✓
- Layout replaces Spacing; Typography/Color kept (now in Section shells) → Task 6. ✓
- design-mode structure + arcade tokens; token-first; live=raw CSS, commit=Claude → Tasks 3/4/5 use arcade `var(--...)` tokens + raw-CSS preview via the existing `change()`. ✓
- Commit unchanged → Task 6 keeps commit()/buildVisualEditPreamble. ✓
- Bulk/preview/resize unchanged → Task 6 leaves them intact; Task 7 step 7 verifies. ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. The Task 5 per-corner deferral is explicitly called out (not a silent gap). Tasks 6 step 5 gives concrete test-update guidance (assert Layout present, keep meaningful assertions).

**Type consistency:** `StyleSnapshot` 8-field extension defined in Task 1, used by Tasks 4/5 (sections take `styles`/`pending`) and the test literals. `ChangeFn = (key, rawValue) => void` defined in Task 3, matches `InspectorPanel`'s existing `change` (Task 6 passes it down). `NumberField`/`SegmentedToggle`/`fieldValue`/`toNumberInput`/`fromNumberInput` defined in Task 3, consumed in 4/5/6. `Section` props `{title, icon?, defaultOpen?, children}` defined in Task 2, used in Task 6. Enum fields (`display`/`flexDirection`) handled without px helpers in Task 4's `setMode` (raw string values).

**Known risk flagged for implementer:** Task 6 is the integration point — read the current panel fully, preserve the batch list / header / Commit-Discard / resize / text-hint exactly, only swap the focused-element section blocks. The aspect-lock ratio is captured at lock-toggle time from the *current* (pending-or-original) W/H; if W/H are `auto`/non-px the lock no-ops that axis (don't divide by zero). The opacity field is the one NON-px control in the slice (unitless 0–1 shown as 0–100%) — don't route it through NumberField.
