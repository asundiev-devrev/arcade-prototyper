# Props-First Component Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed detach/Customize apparatus with props-first editing — select a component → edit the nearest in-frame ancestor component's props (instant, deterministic) → anything props don't cover goes to the agent as a scoped chat request.

**Architecture:** Reuse the existing kit-prop machinery (`kitPropsFor` + `/api/kit-props` + the `prop:` attribute write path through `/api/visual-edit`). The panel, for a component selection, resolves the nearest in-frame ancestor component (innermost owner-chain link whose call-site is the frame's `index.tsx`), shows "Editing `<Name>`" + its prop controls (instant writes) + an "Ask AI to change this" button (the only non-prop path). Then delete the detach/Customize/marker/pick-marked/armReselect apparatus (keeping the Figma-export fiber walk, which shares `buildWalkContext`).

**Tech Stack:** React (inspector panel), the existing code-writer prop path (TS AST), Vitest.

## Global Constraints

- **Package manager is pnpm.** Tests via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`). Never npm/yarn.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/canvas`.
- **Vite middleware does NOT hot-reload** — `server/*` changes need an app restart to test live; unit tests don't. (This plan is mostly client-side; no new server.)
- **Props are the default component-edit surface; everything else → the agent.** No detach, no eject, no marker, no fiber-find-for-customize.
- **Nearest in-frame ancestor:** for a component selection, edit the INNERMOST owner-chain link whose call-site file is `/frames/<frameSlug>/` (the component nearest the click that the frame actually authored). The panel header NAMES it.
- **Keep:** the Figma-export fiber walk (`exportFrameToSlj.ts` `buildWalkContext`/`findComponentFiber`) — it has a live consumer (`exportFrameToSlj`). Only the Customize CONSUMER of the walk (`serializeTargetToJsx` in `customizeClient.ts`) is removed.
- **Keep:** instant deterministic STYLE editing on raw `isInFrame` elements (unchanged); the `ownerChain` on selections (picker + resolver use it); the `/api/visual-edit` `prop:` write path.
- **Exact copy:** the agent button reads **"Ask AI to change this"**. The no-props note reads **"No editable properties — use Ask AI to change this."** The panel header reads **"Editing <Name>"** (with the resolved component name).
- **Out of scope:** on-canvas handles; re-introducing detach; reflecting committed-on-disk prop values (panel reflects the pending value).

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/src/frame/resolveCustomizeTarget.ts` → rename to `resolveInFrameComponent.ts` | resolve the NEAREST (innermost) in-frame ancestor component | 1 |
| `studio/src/components/inspector/InspectorPanel.tsx` | component mode = props section ("Editing <Name>" + dropdowns, instant) + "Ask AI to change this"; remove runCustomize/Customize button/marker/armReselect | 2 |
| `studio/src/components/viewport/FrameCard.tsx` | remove armReselect listener + pick-marked posts | 3 |
| `studio/src/frame/picker.ts` | remove the pick-marked handler; keep buildOwnerChain + OwnerLink | 3 |
| `studio/src/lib/customizeClient.ts` | remove serializeTargetToJsx, markJsxRoot, newCustomizeToken, postCustomize/postCustomizeUndo, buildCustomizePayload (verify no other consumer) | 3 |
| deleted tests | customize/marker/pick-marked/panel-customize tests for removed features | 3 |

> Task 1 = the resolver (isolated, unit-testable). Task 2 = the panel rewrite (the core: props-first UI + removing the Customize trigger). Task 3 = delete the dead apparatus + grep-clean. Keep `buildWalkContext`/`findComponentFiber` (Figma export), `/api/visual-edit`, `/api/kit-props`, `kitPropsFor`, the `prop:` write path, `ownerChain`.

---

## Task 1: Resolve the nearest in-frame ancestor component

**Files:**
- Rename: `studio/src/frame/resolveCustomizeTarget.ts` → `studio/src/frame/resolveInFrameComponent.ts`
- Modify: the resolver to return the INNERMOST in-frame link (was outermost)
- Update import sites: `studio/src/frame/picker.ts` (imports `OwnerLink` type), `studio/src/hooks/editSessionContext.tsx` (imports `OwnerLink` type via dynamic import path)
- Test: `studio/__tests__/frame/resolveInFrameComponent.test.ts` (rename/replace the old `resolveCustomizeTarget.test.ts`)

**Interfaces:**
- Consumes: `OwnerLink { componentName, file, line, column }` (kept, same shape).
- Produces:
  - `interface InFrameComponent { componentName: string; line: number; column: number }`
  - `resolveInFrameComponent(chain: OwnerLink[], frameSlug: string): InFrameComponent | null` — chain is innermost→outermost; return the FIRST (innermost) link whose `file` contains `/frames/<frameSlug>/`; null if none.
  - `OwnerLink` interface unchanged + re-exported (picker/editSession import it from here).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/frame/resolveInFrameComponent.test.ts
import { describe, it, expect } from "vitest";
import { resolveInFrameComponent, type OwnerLink } from "../../src/frame/resolveInFrameComponent";

const KIT = "/p/studio/prototype-kit/dist/templates/SettingsPage.js";
const FRAME = "/p/projects/demo/frames/01-page/index.tsx";

describe("resolveInFrameComponent", () => {
  it("returns the INNERMOST in-frame component (nested in-source case)", () => {
    // innermost → outermost: Button(in-frame) inside Card(in-frame) inside the page
    const chain: OwnerLink[] = [
      { componentName: "Button", file: FRAME, line: 9, column: 7 },
      { componentName: "Card", file: FRAME, line: 8, column: 5 },
    ];
    expect(resolveInFrameComponent(chain, "01-page")).toEqual({ componentName: "Button", line: 9, column: 7 });
  });
  it("returns the only in-frame component when the click is deep in a composite", () => {
    // <aside> deep inside SettingsPage: its owners up to SettingsPage are kit; SettingsPage is in-frame
    const chain: OwnerLink[] = [
      { componentName: "SettingsSidebar", file: KIT, line: 12, column: 3 },
      { componentName: "SettingsPage", file: FRAME, line: 7, column: 25 },
    ];
    expect(resolveInFrameComponent(chain, "01-page")).toEqual({ componentName: "SettingsPage", line: 7, column: 25 });
  });
  it("returns null when no owner is in the frame source", () => {
    const chain: OwnerLink[] = [{ componentName: "X", file: KIT, line: 1, column: 1 }];
    expect(resolveInFrameComponent(chain, "01-page")).toBeNull();
  });
  it("ignores a different frame's file", () => {
    const chain: OwnerLink[] = [{ componentName: "Y", file: "/p/projects/demo/frames/99-other/index.tsx", line: 1, column: 1 }];
    expect(resolveInFrameComponent(chain, "01-page")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/resolveInFrameComponent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `resolveInFrameComponent.ts`**

```ts
// studio/src/frame/resolveInFrameComponent.ts
export interface OwnerLink { componentName: string; file: string; line: number; column: number }
export interface InFrameComponent { componentName: string; line: number; column: number }

/**
 * Given the fiber owner chain (innermost → outermost) of a clicked element,
 * return the NEAREST (innermost) owner authored in the frame's own index.tsx —
 * the component instance closest to the click that the frame actually placed,
 * and the one whose props we can write. null when no owner is in-source.
 */
export function resolveInFrameComponent(chain: OwnerLink[], frameSlug: string): InFrameComponent | null {
  const needle = `/frames/${frameSlug}/`;
  for (const link of chain) {
    if (link.file.includes(needle)) {
      return { componentName: link.componentName, line: link.line, column: link.column };
    }
  }
  return null;
}
```

- [ ] **Step 4: Update the import sites**

- `studio/src/frame/picker.ts`: change `import type { OwnerLink } from "./resolveCustomizeTarget";` → `from "./resolveInFrameComponent";`.
- `studio/src/hooks/editSessionContext.tsx`: change the dynamic import path `import("../frame/resolveCustomizeTarget").OwnerLink` → `import("../frame/resolveInFrameComponent").OwnerLink`.
- Delete the old `studio/src/frame/resolveCustomizeTarget.ts` (`git rm`) and the old `studio/__tests__/frame/resolveCustomizeTarget.test.ts`.

- [ ] **Step 5: Run test + frame suite**

Run: `pnpm run studio:test __tests__/frame/resolveInFrameComponent.test.ts && pnpm run studio:test __tests__/frame`
Expected: PASS (new resolver test + frame suite; picker still compiles with the new import).

- [ ] **Step 6: Commit**

```bash
git add studio/src/frame/resolveInFrameComponent.ts studio/src/frame/picker.ts studio/src/hooks/editSessionContext.tsx studio/__tests__/frame/resolveInFrameComponent.test.ts
git rm studio/src/frame/resolveCustomizeTarget.ts studio/__tests__/frame/resolveCustomizeTarget.test.ts
git commit -m "feat(studio/canvas): resolve the nearest in-frame ancestor component (props-first)"
```

---

## Task 2: Panel props-first component mode

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Test: `studio/__tests__/components/panel-props-first.test.tsx`

**Interfaces:**
- Consumes: `resolveInFrameComponent` (Task 1), `isInFrame` (`visualEditClient`), `kitPropsFor` via `/api/kit-props` (existing fetch), the `change("prop:<name>", value)` path (existing, writes via `/api/visual-edit`), `onSend` (chat).
- Produces: the props-first component panel; removes the Customize trigger from the panel (the deletion of the now-orphaned `runCustomize`/marker happens in Task 3, but this task stops RENDERING the Customize button and stops calling it).

> Context: today the component section renders grayed style fields + a "Customize" button calling `runCustomize`. This task replaces that with: a header "Editing `<Name>`" (the resolved nearest-in-frame component), the existing prop dropdowns (made EDITABLE — they write `prop:` deterministically), a no-props note when there are none, and an "Ask AI to change this" button. Style-field sections are NOT shown for a component (they were never editable on a component). Raw `isInFrame` elements keep their existing instant style sections.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/panel-props-first.test.tsx
// Renders InspectorPanel with a focused selection inside EditSessionProvider +
// EditBlocksProvider, using the same mock scaffold as InspectorPanel.test.tsx.
// Asserts the props-first component mode. Copy provider + @xorkavi/arcade-gen
// mock + editSession seeding from InspectorPanel.test.tsx (read it first).
//
//  1. A COMPONENT selection (ownerChain has an in-frame component; selection.file
//     is NOT under the frame) → panel shows "Editing <SettingsPage>" + (if
//     kitProps) editable prop dropdowns + an "Ask AI to change this" button. NO
//     "Customize" button anywhere.
//  2. Changing a prop dropdown calls change("prop:<name>", value) → posts
//     /api/visual-edit (stub fetch → {ok:true}) for the resolved in-frame
//     component (line/col from the resolver).
//  3. "Ask AI to change this" calls onSend with an instruction naming the component.
//  4. A component with NO kitProps → shows "No editable properties — use Ask AI
//     to change this." + the Ask AI button (no dropdowns).
import { describe, it, expect, vi } from "vitest";
// ... scaffold per InspectorPanel.test.tsx; mock /api/kit-props fetch to return
//     {props:[{name:"columns",values:["2","3","4"]}]} for the component case,
//     {props:[]} for the no-props case; stub onSend; seed a focused selection
//     with an ownerChain whose innermost in-frame link is SettingsPage @ 7:25.

describe("panel props-first", () => {
  it("shows 'Editing <Name>' + prop dropdowns + Ask AI, NO Customize", () => { /* … */ });
  it("changing a prop posts visual-edit for the resolved in-frame component", async () => { /* … */ });
  it("Ask AI to change this sends a scoped onSend naming the component", () => { /* … */ });
  it("no kitProps → shows the no-properties note + Ask AI, no dropdowns", () => { /* … */ });
});
```

> Implementer: flesh the four bodies from the real `InspectorPanel.test.tsx` scaffold. The selection's `ownerChain` must contain an in-frame `SettingsPage` link (`file` under `/frames/<slug>/`, line 7 col 25) and the selection.file itself a kit path (so it's component mode). Keep assertions real: header text, dropdown→`/api/visual-edit` POST with the RESOLVED component's line/col, onSend naming the component, no-props note. Assert NO element with text "Customize".

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/panel-props-first.test.tsx`
Expected: FAIL — still renders the Customize button / grayed-fields model.

- [ ] **Step 3: Rewrite the component section in `InspectorPanel.tsx`**

a. Add import: `import { resolveInFrameComponent } from "../../frame/resolveInFrameComponent";`. Remove the `resolveCustomizeTarget` import.

b. Where `focused`/`styles` are in scope, compute the component context:
```tsx
const isComponentSel = !!focused && !isInFrame(focused.selection.file, frameSlug ?? "");
const inFrameComp = isComponentSel && focused
  ? resolveInFrameComponent(focused.selection.ownerChain, frameSlug ?? "")
  : null;
```

c. Fetch kitProps for the RESOLVED component (not the clicked one). Change the kit-props effect to use `inFrameComp?.componentName`:
```tsx
useEffect(() => {
  const name = inFrameComp?.componentName;
  if (!name || !/^[A-Z]/.test(name)) { setKitProps([]); return; }
  let cancelled = false;
  fetch(`/api/kit-props/${encodeURIComponent(name)}`)
    .then((r) => r.json())
    .then((d) => { if (!cancelled) setKitProps(d.props ?? []); })
    .catch(() => { if (!cancelled) setKitProps([]); });
  return () => { cancelled = true; };
}, [inFrameComp?.componentName]);
```

d. Replace the entire component section (the `isComponentSel`/`kitProps`-gated block AND the grayed style-sections wrapper) with the props-first UI. A prop change must target the RESOLVED in-frame component's line/col, NOT the clicked element. Add a dedicated `changeProp`:
```tsx
function changeProp(propName: string, value: string) {
  if (!inFrameComp) return;
  // Write prop:<name> on the RESOLVED in-frame component instance.
  const sel = { ...focused!.selection, line: inFrameComp.line, column: inFrameComp.column };
  if (value === "") return; // "—" = no change
  void postVisualEdit(slug, buildSingleEdit(sel, `prop:${propName}`, value, frameSlug ?? ""))
    .then((det) => {
      if (det.ok) addBlock({ label: `${inFrameComp.componentName}.${propName} → ${value}`, kind: "instant", status: "applied", frameSlug: frameSlug ?? "" });
      else askAi(`set its ${propName} to ${value}`);
    });
}
function askAi(change: string) {
  if (!inFrameComp) return;
  onSend(`In frames/${frameSlug}/index.tsx, on the <${inFrameComp.componentName}> at line ${inFrameComp.line}, ${change}.`);
}
```

Render (replacing the old component block):
```tsx
{isComponentSel && (
  <Section title={inFrameComp ? `Editing <${inFrameComp.componentName}>` : "Component"}>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {kitProps.length > 0 ? (
        kitProps.map((p) => (
          <Field key={p.name} label={p.name}>
            <select aria-label={p.name} style={INPUT_COMPACT}
              value={(pending[`prop:${p.name}`] as string) ?? ""}
              onChange={(e) => changeProp(p.name, e.target.value)}>
              <option value="">—</option>
              {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        ))
      ) : (
        <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", lineHeight: 1.45 }}>
          No editable properties — use Ask AI to change this.
        </span>
      )}
      <Button variant="primary" onClick={() => askAi("describe the change")}>Ask AI to change this</Button>
    </div>
  </Section>
)}
```

(For the Ask-AI button, prefer seeding a free-text prompt if the panel has an input pattern; the minimal version sends a generic scoped instruction the user can refine in chat. The implementer may render a tiny textarea instead of the generic string if it fits the existing chat-seed pattern — keep it simple.)

e. Do NOT render the grayed style-sections wrapper for `isComponentSel`. Keep the style sections ONLY for raw in-frame elements (the `!isComponentSel` branch). The Customize button + its render are removed.

f. The orphaned `runCustomize`/`customizeRef`/marker code becomes dead after this — leave the dead code for Task 3's sweep (don't half-delete here), but ensure NOTHING renders or calls it.

- [ ] **Step 4: Run the focused test**

Run: `pnpm run studio:test __tests__/components/panel-props-first.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the components suite**

Run: `pnpm run studio:test __tests__/components`
Expected: PASS. The old `panel-customize.test.tsx` will fail (Customize button gone) — leave it for Task 3 to delete (it tests a removed feature). If it blocks the run, you may `git rm` it now and note it; otherwise Task 3 handles it.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/__tests__/components/panel-props-first.test.tsx
git commit -m "feat(studio/canvas): props-first component panel (edit props + Ask AI), no Customize"
```

---

## Task 3: Delete the detach/Customize apparatus

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx` (remove `runCustomize`/`customizeRef`/marker imports + the `armReselect` dispatch + confirm/toast-for-customize)
- Modify: `studio/src/lib/customizeClient.ts` (remove `serializeTargetToJsx`, `markJsxRoot`, `newCustomizeToken`, `postCustomize`, `postCustomizeUndo`, `buildCustomizePayload` — verify no other consumer first)
- Modify: `studio/src/frame/picker.ts` (remove the `pick-marked` handler branch + `pickMarked` fn)
- Modify: `studio/src/components/viewport/FrameCard.tsx` (remove the `armReselect` listener + `pick-marked` posts + `armedTokenRef`)
- Delete: `studio/__tests__/components/panel-customize.test.tsx`, `studio/__tests__/frame/picker-pick-marked.test.ts`, `studio/__tests__/lib/customize-marker.test.ts`, and any other test of the removed features (NOT `resolveInFrameComponent.test.ts` / `panel-props-first.test.tsx`).
- Test: surviving suites green + grep-clean.

**Interfaces:**
- Consumes: nothing new.
- Produces: a codebase with the detach/Customize apparatus removed; the Figma-export `buildWalkContext`/`findComponentFiber` KEPT (live consumer `exportFrameToSlj`).

> Before deleting from `customizeClient.ts`, grep each export for remaining consumers. `serializeTargetToJsx`/`markJsxRoot`/`newCustomizeToken`/`postCustomize`/`postCustomizeUndo`/`buildCustomizePayload` should have ZERO non-test consumers after Task 2. `buildSingleEdit`/`postVisualEdit`/`postEditUndo`/`isInFrame`/`toElementEdits` STAY (used by the instant-edit + props path). `findComponentFiber`/`buildWalkContext` in `exportFrameToSlj.ts` STAY (Figma export).

- [ ] **Step 1: Grep the removal targets**

Run:
```
grep -rnE "serializeTargetToJsx|markJsxRoot|newCustomizeToken|postCustomize|postCustomizeUndo|buildCustomizePayload|customizeRef|runCustomize|armReselect|pick-marked|pickMarked" studio/src | grep -v "__tests__"
```
Note every non-test consumer. After Task 2, the only consumers should be the dead code in InspectorPanel + the definitions themselves + picker/FrameCard wiring. (If something unexpected consumes one — e.g. the customize server endpoint is hit elsewhere — STOP and report; otherwise proceed.)

- [ ] **Step 2: Remove from `customizeClient.ts`**

Delete `serializeTargetToJsx`, `markJsxRoot`, `newCustomizeToken`, `postCustomize`, `postCustomizeUndo`, `buildCustomizePayload` and their now-unused imports (`buildWalkContext`, `sljToJsx`, `CustomizeTarget`). KEEP `buildSingleEdit`, `postVisualEdit`, `postEditUndo`, `isInFrame`, `toElementEdits`, `FieldEdit`/`ElementEdit`/`VisualEditPayload` types.

- [ ] **Step 3: Remove from `InspectorPanel.tsx`**

Delete `customizeRef` + the `runCustomize` function body, the `armReselect` dispatch, the customize confirm/toast, and the now-unused imports (`resolveInFrameComponent` STAYS; remove `markJsxRoot`/`newCustomizeToken`/`serializeTargetToJsx`/`postCustomize`/`postCustomizeUndo`/`buildCustomizePayload`/`useDialogs` if confirm is now unused — verify `confirm` has no other use; if it does, keep it). Keep `changeProp`/`askAi` (Task 2). Keep the success-toast infra only if still used by instant edits (it is — `lastSuccessToastId`/`dismiss` may still be referenced; verify and keep what's used).

- [ ] **Step 4: Remove from `picker.ts`**

Delete the `else if (t === "arcade-studio:pick-marked")` branch in `onParentMessage` and the `pickMarked` function. KEEP `buildOwnerChain`, `OwnerLink` re-export (now from `resolveInFrameComponent`), `onClick`, `resolveSelection`, etc.

- [ ] **Step 5: Remove from `FrameCard.tsx`**

Delete the `armReselect` listener effect, the `pick-marked` posts, `armedTokenRef`, and the onLoad pick-marked path. KEEP the normal frame rendering + pick wiring.

- [ ] **Step 6: Delete the dead tests + grep-clean**

```bash
git rm studio/__tests__/components/panel-customize.test.tsx studio/__tests__/frame/picker-pick-marked.test.ts studio/__tests__/lib/customize-marker.test.ts
```
(Also remove any other test referencing the deleted functions — grep `__tests__` for them.)

Run the grep-clean (MUST be empty):
```
grep -rnE "serializeTargetToJsx|markJsxRoot|newCustomizeToken|postCustomize|postCustomizeUndo|buildCustomizePayload|customizeRef|runCustomize|armReselect|pick-marked|pickMarked|resolveCustomizeTarget" studio/src studio/__tests__
```
Expected: NO matches (all detach/Customize/marker wiring gone). `findComponentFiber`/`buildWalkContext` in `exportFrameToSlj.ts` are NOT in this list (kept for Figma export).

- [ ] **Step 7: Run the full suite**

Run: `pnpm run studio:test`
Expected: all green except the known pre-existing items (verify any failure is unrelated to this change — e.g. the historical figmaBridge flake, if it reappears, passes in isolation). No NEW failures; no dangling-import compile errors.

- [ ] **Step 8: Commit**

```bash
git add studio/src/lib/customizeClient.ts studio/src/components/inspector/InspectorPanel.tsx studio/src/frame/picker.ts studio/src/components/viewport/FrameCard.tsx studio/__tests__/
git commit -m "refactor(studio/canvas): remove the detach/Customize apparatus (props-first replaces it)"
```

---

## Task 4: Full suite + manual gate

- [ ] **Step 1: Full suite**

Run: `pnpm run studio:test`
Expected: all green (modulo any known pre-existing unrelated failure — verify in isolation).

- [ ] **Step 2: Manual gate (HUMAN, app restart)**

`pnpm run studio` on a generated frame (e.g. "a page with a few cards and a save button"):
1. Click a component (e.g. the page, a card, a button) → panel shows **"Editing `<Name>`"** + its props (if any) + **"Ask AI to change this"**. NO "Customize", NO "prebuilt component" dead-end, NO detach crash.
2. Change a prop (e.g. a Button's `variant`, the page's `columns`) → applies + persists (✓ block + Undo). No agent, no spinner.
3. A component with no editable props → "No editable properties — use Ask AI to change this."
4. "Ask AI to change this" → a scoped chat turn naming the component.
5. If the frame has a raw authored element, clicking it → instant style editing (unchanged).

Record results in the ledger. This is the gate that's failed every prior attempt — it is the real arbiter.

---

## Final verification

- [ ] **Full suite green** (modulo known pre-existing unrelated failures, verified in isolation).
- [ ] **Grep-clean:** no detach/Customize/marker/pick-marked/armReselect/resolveCustomizeTarget references remain (Figma-export `findComponentFiber` excepted).
- [ ] **Manual gate scenarios 1–5 pass** — props edit + persist, Ask AI sends a scoped turn, no dead-ends/crashes.
- [ ] **Frame never broken:** a prop write that fails reparse aborts (file untouched) + falls to Ask AI.

## Notes on deferred scope

- On-canvas resize/move handles (separate phase).
- Richer Ask-AI seeding (free-text box) if the generic instruction proves too coarse.
- Reflecting committed-on-disk prop values in the panel (picker-snapshot limitation).
