# Rich Panel Slice 1c (Token+Raw Row Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Color + Typography controls into preview-led rows with an editable token/raw chip, restore typography raw size/weight, make color swatches mandatory (always show the live color), and turn alignment into an icon button group.

**Architecture:** Presentation-only over slice-1b's existing token/raw channels — no data model, message, or commit change. A new `EditableTokenChip` composes a token dropdown that flips to a raw text input on typing. ColorRow becomes one chip (swatch always shown). Typography gains an `EditableTokenChip` for Style plus restored raw Size/Weight rows, and Align switches from a `<select>` to the existing `SegmentedToggle` with align icons.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom + @testing-library/react, Playwright for the visual gate. pnpm.

## Global Constraints

- **pnpm only.** Before tests: `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` + `export GITHUB_TOKEN_PACKAGES="$GITHUB_TOKEN"`. If `pnpm`/`vitest` still "not found", STOP and report — do NOT assume npm-auth.
- **Run tests from repo root** (`/Users/andrey.sundiev/arcade-prototyper`): `pnpm run studio:test <path>`; full suite `pnpm run studio:test`.
- **Commits:** Conventional Commits, scope `studio/inspector`. Body ends `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — explicit paths only.
- **Component tests** use `// @vitest-environment jsdom` (no arcade-gen import in these inspector components — pure React + native inputs/SVG, so no mock needed).
- **Presentation-only:** do NOT change the token/raw pending model, the `arcade-studio:preview`/`preview-class` messages, `buildVisualEditPreamble`, or `tok:` sentinel. Reuse the existing `change` (raw) and `changeToken` (token) handlers in InspectorPanel.
- **Swatch always visible for color:** token mode → resolveSwatch(token); raw/no-token → the element's COMPUTED color for that slot (`styles[slot]`), so a visible element never shows a blank chip.
- **Align = icon button group** (reuse `SegmentedToggle`), NOT a `<select>`.
- **Visual gate mandatory** (Task 4): screenshot the panel; tests alone insufficient (a prior slice shipped a passing-but-wrong "wall of inputs").

## Reference (current state, read-only)
- `SegmentedToggle({ ariaLabel, options: {value,label,icon?}[], value, onChange })` exists in `inspectorControls.tsx` (slice 1) — renders icon buttons + active state. Reuse it for Align.
- `TokenSelect({ options, value, onPick, ariaLabel, placeholder, swatch })` exists — a native `<select>` + optional swatch chip. `EditableTokenChip` builds on this for its token mode.
- ColorRow (InspectorPanel.tsx) currently renders a `TokenSelect` + a separate raw `<input>` in two stacked `Field`s — this slice collapses them into one chip.
- Typography currently: Style `TokenSelect`, then Align `<select>` + Italic checkbox. Font-size + Weight were removed in 1b — this slice RESTORES them as raw rows.
- The pending channels: `change(key, rawValue)` writes a raw pending edit + posts `arcade-studio:preview`; `changeToken(key, className, prevClassName?)` writes `tok:<class>` + posts `arcade-studio:preview-class`. Both exist in InspectorPanel.

---

## File Structure

- **Create** `studio/src/components/inspector/EditableTokenChip.tsx` — the two-mode chip. (Task 1)
- **Modify** `studio/src/components/inspector/InspectorPanel.tsx` — ColorRow → one EditableTokenChip (swatch always); Typography → Style chip + restored Size/Weight raw rows + Align as SegmentedToggle. (Task 2)
- **Modify** `studio/__tests__/components/InspectorPanel.test.tsx` — update assertions (align is buttons; size/weight present; chip present). (Task 2)
- Tests: `studio/__tests__/components/inspector-editable-token-chip.test.tsx` (Task 1).
- **Manual visual gate** (Task 3).

### EditableTokenChip contract (Task 1; consumed by Task 2)

```ts
// studio/src/components/inspector/EditableTokenChip.tsx
export function EditableTokenChip(props: {
  ariaLabel: string;
  tokenValue: string | null;              // current token (className) or null
  tokenOptions: { value: string; label: string }[];
  rawValue: string;                        // current raw value (for raw mode + the dim line)
  onPickToken: (value: string) => void;    // token chosen from dropdown
  onRawChange: (raw: string) => void;      // raw value typed
  swatch?: string;                         // color chip (color rows only); omit for type
  rawEnabled?: boolean;                    // default true; false = token-only (type Style chip)
  placeholder?: string;                    // token-mode empty label, default "— (no token)"
}): JSX.Element;
```

Behavior: default **token mode** = a `TokenSelect`-style dropdown (swatch chip if `swatch` set) showing `tokenValue` (or placeholder). A small "edit raw" affordance (a tiny pencil/`#` button, or focus) switches to **raw mode** = a text `<input>` seeded with `rawValue`, calling `onRawChange` on change; a "back to tokens" affordance returns to token mode. When `rawEnabled === false`, no raw mode (token-only). The dim raw value line is rendered by the CONSUMER beneath the chip (keeps the chip focused), OR optionally inside — plan keeps it in the consumer for layout control.

---

### Task 1: EditableTokenChip component

**Files:**
- Create: `studio/src/components/inspector/EditableTokenChip.tsx`
- Test: `studio/__tests__/components/inspector-editable-token-chip.test.tsx`

**Interfaces:** as the contract above. Consumes `INPUT_COMPACT` from inspectorControls; reuses `TokenSelect` for the token-mode dropdown.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/inspector-editable-token-chip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditableTokenChip } from "../../src/components/inspector/EditableTokenChip";

afterEach(cleanup);
const OPTS = [{ value: "text-body", label: "Body" }, { value: "text-title-large", label: "Title large" }];

describe("EditableTokenChip", () => {
  it("token mode: shows the token dropdown and emits onPickToken", () => {
    const onPick = vi.fn();
    render(<EditableTokenChip ariaLabel="Style" tokenValue="text-body" tokenOptions={OPTS}
      rawValue="13px" onPickToken={onPick} onRawChange={vi.fn()} />);
    const sel = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(sel.value).toBe("text-body");
    fireEvent.change(sel, { target: { value: "text-title-large" } });
    expect(onPick).toHaveBeenCalledWith("text-title-large");
  });

  it("switches to raw mode and emits onRawChange", () => {
    const onRaw = vi.fn();
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(0,0,0)" onPickToken={vi.fn()} onRawChange={onRaw} />);
    // an "edit raw" control toggles to a text input
    fireEvent.click(screen.getByLabelText("Edit Text raw value"));
    const input = screen.getByLabelText("Text raw") as HTMLInputElement;
    expect(input.value).toBe("rgb(0,0,0)");
    fireEvent.change(input, { target: { value: "#ff0000" } });
    expect(onRaw).toHaveBeenCalledWith("#ff0000");
  });

  it("renders a swatch when swatch prop is set", () => {
    render(<EditableTokenChip ariaLabel="Text" tokenValue={null} tokenOptions={OPTS}
      rawValue="rgb(1,2,3)" onPickToken={vi.fn()} onRawChange={vi.fn()} swatch="rgb(1,2,3)" />);
    const sw = screen.getByTestId("token-chip-swatch");
    expect(sw.style.background).toBe("rgb(1, 2, 3)");
  });

  it("rawEnabled=false hides the raw toggle (token-only)", () => {
    render(<EditableTokenChip ariaLabel="Style" tokenValue="text-body" tokenOptions={OPTS}
      rawValue="" onPickToken={vi.fn()} onRawChange={vi.fn()} rawEnabled={false} />);
    expect(screen.queryByLabelText("Edit Style raw value")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run studio:test __tests__/components/inspector-editable-token-chip.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement EditableTokenChip.tsx**

Create `studio/src/components/inspector/EditableTokenChip.tsx`:

```tsx
import { useState } from "react";
import { INPUT_COMPACT } from "./inspectorControls";
import { TokenSelect } from "./TokenSelect";

export function EditableTokenChip({
  ariaLabel, tokenValue, tokenOptions, rawValue, onPickToken, onRawChange,
  swatch, rawEnabled = true, placeholder,
}: {
  ariaLabel: string;
  tokenValue: string | null;
  tokenOptions: { value: string; label: string }[];
  rawValue: string;
  onPickToken: (value: string) => void;
  onRawChange: (raw: string) => void;
  swatch?: string;
  rawEnabled?: boolean;
  placeholder?: string;
}) {
  const [rawMode, setRawMode] = useState(false);

  if (rawMode && rawEnabled) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {swatch !== undefined && (
          <span data-testid="token-chip-swatch" aria-hidden="true" style={{
            width: 16, height: 16, flex: "none", borderRadius: 4,
            border: "1px solid var(--stroke-neutral-subtle)", background: swatch,
          }} />
        )}
        <input aria-label={`${ariaLabel} raw`} style={{ ...INPUT_COMPACT, flex: 1 }}
          autoFocus value={rawValue}
          onChange={(e) => onRawChange(e.target.value)}
          onBlur={() => setRawMode(false)} />
        <button type="button" aria-label={`${ariaLabel} use tokens`} title="Use a token"
          onClick={() => setRawMode(false)}
          style={iconBtn}>↤</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TokenSelect ariaLabel={ariaLabel} value={tokenValue} options={tokenOptions}
          onPick={onPickToken} placeholder={placeholder} swatch={swatch} />
      </div>
      {rawEnabled && (
        <button type="button" aria-label={`Edit ${ariaLabel} raw value`} title="Type a raw value"
          onClick={() => setRawMode(true)} style={iconBtn}>#</button>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 24, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--stroke-neutral-subtle)", borderRadius: 6, background: "var(--bg-neutral-soft)",
  color: "var(--fg-neutral-subtle)", cursor: "pointer", fontSize: 12,
};
```

> Note on the swatch test: `TokenSelect` already renders a swatch with the same inline style, but it lacks the `data-testid`. To make the swatch testable in BOTH modes, the chip's raw-mode swatch carries `data-testid="token-chip-swatch"`. For token mode the swatch lives inside TokenSelect (already tested in slice 1b). The test's swatch case uses raw mode implicitly? No — it renders default (token) mode with tokenValue null. So ADD `data-testid="token-chip-swatch"` to TokenSelect's swatch span too (one-line change to TokenSelect.tsx), so the testid exists in token mode. Do that in Step 3.

- [ ] **Step 3b: Add the testid to TokenSelect's swatch**

In `studio/src/components/inspector/TokenSelect.tsx`, add `data-testid="token-chip-swatch"` to the swatch `<span>` (the one gated on `swatch !== undefined`). One attribute, no behavior change.

- [ ] **Step 4: Run green** — `pnpm run studio:test __tests__/components/inspector-editable-token-chip.test.tsx` → PASS (4 tests). Also run the existing TokenSelect test (testid add is additive): `pnpm run studio:test __tests__/components/inspector-token-select.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/inspector/EditableTokenChip.tsx studio/src/components/inspector/TokenSelect.tsx studio/__tests__/components/inspector-editable-token-chip.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): EditableTokenChip — token dropdown that flips to raw input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Recompose Color + Typography rows in InspectorPanel

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/InspectorPanel.test.tsx`

**Interfaces:**
- Consumes: `EditableTokenChip` (Task 1); existing `change`/`changeToken`, `colorTokens`/`typeTokens`/`colorClassName`/`colorTokenFromClass`/`resolveSwatch`, `SegmentedToggle`, `Field`, `NumberField`, `fieldValue`, `isTokenPending`/`tokenClass`.
- Produces: ColorRow = one EditableTokenChip (swatch always) + dim raw line; Typography = Style chip + Size + Weight raw rows + Align SegmentedToggle.

- [ ] **Step 1: Read InspectorPanel.tsx fully.** Note: `ColorRow` helper (top of file) currently renders TokenSelect + a separate raw `<input>`; the Typography `<Section>` block; the `change`/`changeToken` handlers; imports.

- [ ] **Step 2: Add imports + align icons.**
```ts
import { EditableTokenChip } from "./EditableTokenChip";
import { SegmentedToggle } from "./inspectorControls"; // add to the existing inspectorControls import
```
Add align icon glyphs near the top of the file (inline SVG, like LayoutSection's):
```tsx
const ALIGN_ICON = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>
);
const ALIGN_OPTS = [
  { value: "left",    label: "Left",    icon: ALIGN_ICON("M3 6h18M3 12h12M3 18h15") },
  { value: "center",  label: "Center",  icon: ALIGN_ICON("M3 6h18M7 12h10M5 18h14") },
  { value: "right",   label: "Right",   icon: ALIGN_ICON("M3 6h18M9 12h12M6 18h15") },
  { value: "justify", label: "Justify", icon: ALIGN_ICON("M3 6h18M3 12h18M3 18h18") },
];
```

- [ ] **Step 3: Rewrite ColorRow** to one chip + dim raw line. Replace the ColorRow body's return with:
```tsx
  const appliedCls = styles.appliedTokens[slot] ?? null;
  const pendingTok = isTokenPending(pending[slot]) ? tokenClass(pending[slot]!) : undefined;
  const currentToken = pendingTok ?? appliedCls ?? null;
  const tokenOpts = colorTokens().map((t) => ({ value: colorClassName(t.token, slot), label: t.label }));
  const rawComputed = isTokenPending(pending[slot]) ? styles[slot] : fieldValue(styles, pending, slot);
  // swatch ALWAYS: token's live value if a token is current, else the computed color
  let swatch = rawComputed;
  if (currentToken) {
    const parsed = colorTokenFromClass(currentToken);
    if (parsed) swatch = resolveSwatch(parsed.token, document.documentElement) || rawComputed;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Field label={label}>
        <EditableTokenChip
          ariaLabel={label}
          tokenValue={currentToken}
          tokenOptions={tokenOpts}
          rawValue={fieldValue(styles, pending, slot)}
          onPickToken={(cls) => changeToken(slot, cls, currentToken ?? undefined)}
          onRawChange={(raw) => change(slot, raw)}
          swatch={swatch}
          placeholder="— (no token)"
        />
      </Field>
      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", fontVariantNumeric: "tabular-nums", paddingLeft: 22 }}>
        {rawComputed}
      </span>
    </div>
  );
```
(Swatch is now ALWAYS a string — no `undefined` — so it always renders. The dim raw line shows the computed color.)

- [ ] **Step 4: Rewrite the Typography section.** Replace the Typography `<Section>` body with: Style chip (token-only), restored Size + Weight raw rows, Align button group, Italic kept.
```tsx
                <Section title="Typography">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(() => {
                      const typeOptValues = new Set(typeTokens().map((t) => t.className));
                      const rawType = isTokenPending(pending.typeStyle)
                        ? tokenClass(pending.typeStyle!)
                        : (styles.appliedTokens.typeStyle ?? null);
                      const current = rawType && typeOptValues.has(rawType) ? rawType : null;
                      return (
                        <Field label="Style">
                          <EditableTokenChip
                            ariaLabel="Type style"
                            tokenValue={current}
                            tokenOptions={typeTokens().map((t) => ({ value: t.className, label: t.label }))}
                            rawValue=""
                            rawEnabled={false}
                            onPickToken={(cls) => changeToken("typeStyle", cls, rawType ?? undefined)}
                            onRawChange={() => {}}
                            placeholder="— (no token)"
                          />
                        </Field>
                      );
                    })()}
                    <div style={GRID_2}>
                      <NumberField id="ins-fontSize" label="Size" valuePx={fieldValue(styles, pending, "fontSize")}
                        onChange={(v) => change("fontSize", v)} />
                      <Field label="Weight" htmlFor="ins-fontWeight">
                        <select id="ins-fontWeight" aria-label="Font weight" style={INPUT_COMPACT}
                          value={fieldValue(styles, pending, "fontWeight")}
                          onChange={(e) => change("fontWeight", e.target.value)}>
                          {["300","400","500","600","700"].map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div style={GRID_2}>
                      <Field label="Align">
                        <SegmentedToggle ariaLabel="Text align" value={fieldValue(styles, pending, "textAlign")}
                          options={ALIGN_OPTS}
                          onChange={(v) => change("textAlign", v)} />
                      </Field>
                      <Field label="Italic" htmlFor="ins-fontStyle">
                        <div style={{ height: 28, display: "flex", alignItems: "center" }}>
                          <input id="ins-fontStyle" type="checkbox" aria-label="Italic"
                            checked={fieldValue(styles, pending, "fontStyle") === "italic"}
                            onChange={(e) => change("fontStyle", e.target.checked ? "italic" : "normal")} />
                        </div>
                      </Field>
                    </div>
                  </div>
                </Section>
```
(`NumberField` is imported already. `INPUT_COMPACT`, `GRID_2`, `Field`, `fieldValue` already imported.)

- [ ] **Step 5: Update InspectorPanel.test.tsx.** The current test likely asserts the Align `<select>` (`getByLabelText("Text align")` resolving to a select) and may assert no Font size. Update:
- Align is now a button GROUP — assert `screen.getByRole("group", { name: "Text align" })` exists, OR that clicking the "Center" align button fires the change (find via `title="Center"` or the group's buttons). Keep it asserting real align behavior.
- Size is back — assert `screen.getByLabelText("Size")` (the NumberField) present.
- Color "Text" is now an EditableTokenChip — `getByLabelText("Text")` is still the token select inside it (TokenSelect keeps ariaLabel="Text"); that assertion still holds. Add: a swatch is present (`getAllByTestId("token-chip-swatch").length >= 1`).
- Keep meaningful assertions (no-Text-input via in-place editing, commit-sends-batch, batch list, Layout present). Do NOT weaken.

- [ ] **Step 6: Run the panel test + full suite.**
```
pnpm run studio:test __tests__/components/InspectorPanel.test.tsx
pnpm run studio:test
```
Expected: green. Fix assertions to the new structure as needed (assert new behavior, never weaken).

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/InspectorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio/inspector): preview-led token+raw rows; restore type size/weight; align buttons

Color rows use the editable token/raw chip with an always-on swatch (live color,
incl. the no-token case). Typography shows the Style token chip plus restored
raw Size + Weight rows; Align is an icon button group (SegmentedToggle), not a
select. Presentation-only over the existing token/raw channels.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manual visual gate (the real test)

**Files:** none.

- [ ] **Step 1: Restart/confirm the app.** `pnpm run studio` → `localhost:5556` (or confirm serving). (Task 2 only touched shell components, no frame-bootstrap change, so HMR likely suffices — but a clean reload is safest.)

- [ ] **Step 2: Pick a text element with a type + color token** (e.g. a `text-body-small` element).

- [ ] **Step 3: Color rows — swatches mandatory.** Each of Text/Fill/Border shows a color swatch chip — INCLUDING when it's "— (no token)" (swatch = the element's computed color, never blank). Verify a real color is visible.

- [ ] **Step 4: Editable chip.** Click the `#` (edit-raw) affordance on a color row → it becomes a text input seeded with the computed `rgb(...)`; type `#ff0000` → frame previews red live. Click the back-to-tokens affordance → returns to the token dropdown.

- [ ] **Step 5: Typography raw restored.** The Style token chip is present AND there are Size + Weight rows beneath. Change Size → frame text resizes live (raw preview). Pick a Style token → restyles live.

- [ ] **Step 6: Align buttons.** Alignment is a 4-icon button group (left/center/right/justify), current one highlighted; click Center → frame text centers live. No `<select>`.

- [ ] **Step 7: Commit + screenshot.** Make a color-token + a raw-size + an align change, Commit → source uses the token class for color, idiomatic for size/align. Screenshot the panel (Playwright, crop the inspector) and compare to design-mode — preview-led rows, swatches, button-group align. Attach before/after to the PR.

- [ ] **Step 8: No regression** — Layout/Appearance unchanged; bulk/in-place text/overlay intact.

---

## Self-Review

**Spec coverage:**
- Editable token/raw chip (Model A) → Task 1 (EditableTokenChip) + Task 2 (ColorRow + Style use it). ✓
- Color swatch ALWAYS (incl. no-token via computed color) → Task 2 ColorRow (swatch is always a string now). ✓
- Typography raw Size + Weight restored → Task 2 (Size NumberField + Weight select rows). ✓
- Align = icon button group (SegmentedToggle), not select → Task 2 (ALIGN_OPTS + SegmentedToggle). ✓
- Preview-led rows replacing the column → Task 2 (chip + dim raw line). ✓
- Presentation-only (no channel/commit change) → Tasks reuse change/changeToken; no preamble/message edits. ✓
- Visual gate → Task 3 (screenshot vs design-mode). ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. The swatch-testid wrinkle is resolved explicitly (Step 3b adds it to TokenSelect). Test-update guidance is concrete (assert group + Size present; keep meaningful assertions).

**Type consistency:** `EditableTokenChip` prop names (ariaLabel/tokenValue/tokenOptions/rawValue/onPickToken/onRawChange/swatch/rawEnabled/placeholder) defined Task 1, consumed Task 2. ColorRow passes `change(slot, raw)` and `changeToken(slot, cls, prev)` — matching the existing handler signatures. `SegmentedToggle` options shape `{value,label,icon}` matches its slice-1 definition. `NumberField`/`fieldValue`/`Field`/`INPUT_COMPACT`/`GRID_2` already imported in InspectorPanel.

**Known risk flagged for implementer:** (1) The Style chip is `rawEnabled={false}` (token-only) — its `onRawChange` is a no-op; raw size/weight live in their OWN rows, NOT in the Style chip. Don't wire Style's chip to a raw value. (2) Swatch for color is now ALWAYS a non-undefined string (computed color fallback) so it always renders — that's the #3 fix; don't reintroduce the `undefined` gate. (3) Task 3 visual gate is mandatory — the chip's token↔raw toggle and the always-on swatches are exactly what unit tests can't judge for look/feel.
