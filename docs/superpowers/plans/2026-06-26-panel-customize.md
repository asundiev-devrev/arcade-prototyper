# Panel-Based Customize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Customize from the unreachable in-iframe chip into the inspector panel — a component selection shows grayed style fields + a panel Customize button; clicking it ejects the component to editable code, the frame reloads, and the now-editable element is auto-reselected so styles go live.

**Architecture:** The panel decides "component mode" by `!isInFrame(selection.file, frameSlug)` (NOT by kitProps count — composites have zero string-union props yet are still components). In component mode, ALL style/prop fields are grayed (can't emit, so can't silently revert) and a header Customize button calls the existing `runCustomize()` (confirm → serialize → /api/customize). The customize write tags the ejected root with `data-arcade-customized="<token>"`; after the frame hot-reloads, FrameCard asks the picker to re-find that marked node and re-select it. The in-iframe chip (`showComponentChip`/`customize-request`/picker chip-guard) is removed.

**Tech Stack:** React (inspector panel, FrameCard), the in-iframe picker (`src/frame/picker.ts`), the customize machinery (`src/lib/customizeClient.ts`, `server/customize/*`), Vitest.

## Global Constraints

- **Package manager is pnpm.** Tests via `pnpm run studio:test <path>` from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`). Never npm/yarn.
- **Never `git add -A` / `git add .`** — stage explicit paths only.
- **Conventional Commits**, scope `studio/canvas`.
- **Vite middleware does NOT hot-reload** — `server/*` / `vite.config.ts` changes need an app restart to test live; unit tests don't.
- **Component mode = `!isInFrame(selection.file, frameSlug)`** — this, not `kitProps.length`, gates grayed fields + the Customize button. (A composite with no declared props is still a component.)
- **Pre-customize: ALL fields grayed** (opacity 0.5 + `pointerEvents:none`) so no edit can be emitted (closes the silent-revert path by construction). After customize the element becomes frame-authored → fields live.
- **Customize confirm copy (verbatim, already constants in InspectorPanel.tsx):** `CUSTOMIZE_CONFIRM_TITLE` = "Customize this component?"; `CUSTOMIZE_CONFIRM_BODY` = "It becomes fully editable in this screen only. The original stays the same everywhere else."; buttons `Customize`/`Cancel`; `CUSTOMIZE_SUCCESS` = "✓ Now fully editable."; `CUSTOMIZE_FALLBACK` = "Couldn't customize this automatically — describe the change in chat instead." Reuse the existing constants; do not re-type the strings.
- **Marker attribute:** `data-arcade-customized="<token>"` on the ejected JSX root; token generated client-side, passed in the customize payload, written by the splice. Left in source (harmless data-attr) for v1.
- **Reparse-guard / all-or-nothing / path-safety / snapshot** behavior of the customize endpoint is unchanged — the marker is added to the printed JSX before the splice, nothing else changes.
- **Out of scope:** on-canvas handles; stripping the marker; auto-customize-on-edit.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `studio/src/lib/customizeClient.ts` | `serializeTargetToJsx` adds the marker token to the emitted root; payload carries token | 1 |
| `studio/src/frame/picker.ts` | handle `pick-marked` → re-find `[data-arcade-customized]` + post frame-picked | 2 |
| `studio/src/components/inspector/InspectorPanel.tsx` | component-mode = !isInFrame; gray all fields; panel Customize button → runCustomize; emit token + after-success arm auto-reselect; drop chip teardown | 3 |
| `studio/src/components/viewport/FrameCard.tsx` | remove chip posts + customize-request forward + picker chip-guard usage; after customize reload, post `pick-marked` | 3 |
| `studio/src/frame/overlay/overlays.ts` | remove `showComponentChip`/`hideComponentChip` (chip gone) — keep selection box | 4 |
| `studio/src/frame/picker.ts` | remove the chip-ignore guard added in the prior fix (chip no longer exists) | 4 |

> Tasks 1–2 are isolated + unit-testable. Task 3 is the panel+FrameCard wiring (the core). Task 4 is the chip removal cleanup. The customize confirm/serialize/toast (`runCustomize`) ALREADY EXISTS — Tasks reuse it; the work is re-triggering it from the panel, graying fields, the marker, and auto-reselect.

---

## Task 1: Marker token on the ejected root

**Files:**
- Modify: `studio/src/lib/customizeClient.ts`
- Test: `studio/__tests__/lib/customize-marker.test.ts`

**Interfaces:**
- Consumes: existing `serializeTargetToJsx(iframe, target)`, `sljToJsx`, `buildCustomizePayload`.
- Produces:
  - `markJsxRoot(jsx: string, token: string): string` — inserts `data-arcade-customized="<token>"` as an attribute on the OUTERMOST JSX element of the string. If the root is a host element `<div …>` → add the attr after the tag name; if it's a component `<Comp …>` → same. Returns jsx unchanged if it can't find a root tag (defensive).
  - `newCustomizeToken(): string` — a short unique token. NOTE: `Math.random`/`Date.now` are fine in app runtime (only the workflow sandbox forbids them); use `"cz-" + Math.random().toString(36).slice(2, 8)`.
  - `serializeTargetToJsx` stays the pure-ish serialize, but the CALLER (Task 3) will call `markJsxRoot(serializeTargetToJsx(...), token)`. So Task 1 only needs to EXPORT `markJsxRoot` + `newCustomizeToken`; it does not change `serializeTargetToJsx` itself.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/customize-marker.test.ts
import { describe, it, expect } from "vitest";
import { markJsxRoot, newCustomizeToken } from "../../src/lib/customizeClient";

describe("markJsxRoot", () => {
  it("adds the marker attr to a host-element root", () => {
    const out = markJsxRoot(`<div className="flex">x</div>`, "cz-abc123");
    expect(out).toBe(`<div data-arcade-customized="cz-abc123" className="flex">x</div>`);
  });
  it("adds the marker attr to a component root", () => {
    const out = markJsxRoot(`<Card variant="x"><b>y</b></Card>`, "cz-zzz999");
    expect(out).toBe(`<Card data-arcade-customized="cz-zzz999" variant="x"><b>y</b></Card>`);
  });
  it("handles a self-closing root", () => {
    const out = markJsxRoot(`<Icon name="Trash" />`, "cz-1");
    expect(out).toBe(`<Icon data-arcade-customized="cz-1" name="Trash" />`);
  });
  it("returns input unchanged when no root tag is found", () => {
    expect(markJsxRoot(`not jsx`, "cz-1")).toBe(`not jsx`);
  });
  it("ignores leading whitespace before the root", () => {
    expect(markJsxRoot(`  <span>z</span>`, "cz-2")).toBe(`  <span data-arcade-customized="cz-2">z</span>`);
  });
});

describe("newCustomizeToken", () => {
  it("produces a cz- prefixed token", () => {
    expect(newCustomizeToken()).toMatch(/^cz-[a-z0-9]+$/);
  });
  it("produces distinct tokens", () => {
    expect(newCustomizeToken()).not.toBe(newCustomizeToken());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/customize-marker.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement in `customizeClient.ts`**

```ts
/** A short unique token used to re-find a just-customized element after reload. */
export function newCustomizeToken(): string {
  return "cz-" + Math.random().toString(36).slice(2, 8);
}

/** Insert data-arcade-customized="<token>" on the outermost JSX element of `jsx`.
 *  Matches the first `<TagName` (optionally after leading whitespace) and inserts
 *  the attr right after the tag name. Returns `jsx` unchanged if no root tag. */
export function markJsxRoot(jsx: string, token: string): string {
  // first `<` + tag name (letters/numbers/dot for Foo.Bar), capture up to end of tag name
  const m = /^(\s*<)([A-Za-z][\w.]*)/.exec(jsx);
  if (!m) return jsx;
  const insertAt = m[1].length + m[2].length; // after `<TagName`
  return jsx.slice(0, insertAt) + ` data-arcade-customized="${token}"` + jsx.slice(insertAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/customize-marker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/customizeClient.ts studio/__tests__/lib/customize-marker.test.ts
git commit -m "feat(studio/canvas): mark the ejected customize root for post-reload re-selection"
```

---

## Task 2: Picker re-finds the marked node (`pick-marked`)

**Files:**
- Modify: `studio/src/frame/picker.ts`
- Test: `studio/__tests__/frame/picker-pick-marked.test.ts`

**Interfaces:**
- Consumes: existing `getFiberFromNode`, `resolveSelection`, `postPicked`, the `onParentMessage` handler.
- Produces: the picker handles a new parent message `{ type: "arcade-studio:pick-marked", token: string }` → finds `document.querySelector('[data-arcade-customized="<token>"]')`, resolves its selection via the existing fiber path, and posts `frame-picked` (same shape as a click pick). If no node / no fiber / no source, posts nothing (best-effort, no error). This works even when the picker is NOT in active picking mode (it's an explicit re-select request).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/frame/picker-pick-marked.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// The picker resolves fibers via getFiberFromNode (React internals). For this
// test we stub a fiber on the marked node so resolveSelection can run, and
// assert a frame-picked message is posted for the marked element.
// NOTE: picker.ts attaches a window 'message' listener at import time; we drive
// it by dispatching a MessageEvent and capturing window.parent.postMessage.

describe("picker pick-marked re-selection", () => {
  let posts: any[];
  beforeEach(() => {
    document.documentElement.innerHTML = "";
    posts = [];
    (window as any).parent = { postMessage: (m: any) => posts.push(m) };
  });

  it("posts frame-picked for the node carrying the marker token", async () => {
    await import("../../src/frame/picker");
    const el = document.createElement("div");
    el.setAttribute("data-arcade-customized", "cz-abc");
    el.textContent = "hi";
    document.body.appendChild(el);
    // Stamp a minimal React fiber the picker's getFiberFromNode can read.
    // (Mirror how picker-owner-chain stubs fibers: a __reactFiber$ key with a
    //  _debugStack that parses to a user file.)
    const STACK = "    at Demo (http://localhost/projects/p/frames/01-x/index.tsx?v=1:3:5)";
    (el as any).__reactFiber$test = {
      type: Object.assign(() => null, { displayName: "Demo" }),
      _debugStack: { stack: STACK },
      return: null,
    };

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:pick-marked", token: "cz-abc" },
    }));

    const picked = posts.find((m) => m?.type === "arcade-studio:frame-picked");
    expect(picked).toBeDefined();
  });

  it("posts nothing when no node carries the token", async () => {
    await import("../../src/frame/picker");
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:pick-marked", token: "cz-missing" },
    }));
    expect(posts.find((m) => m?.type === "arcade-studio:frame-picked")).toBeUndefined();
  });
});
```

> Implementer note: `getFiberFromNode` looks for a `__reactFiber$*` key on the node. Match how `__tests__/frame/picker-owner-chain.test.ts` constructs a fake fiber. If `resolveSelection` needs `getFiberFromNode` to find the key by prefix, stamp the exact key shape the impl scans for (read `fiber.ts` `getFiberFromNode`). If the fiber stub can't satisfy `resolveSelection` cleanly in jsdom, assert instead that the picker CALLS the query + attempts resolution (spy on `document.querySelector`); keep the assertion real (it must look up the token and act only when found). Explain any adaptation in the report.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/picker-pick-marked.test.ts`
Expected: FAIL — picker doesn't handle `pick-marked`.

- [ ] **Step 3: Add the handler in `picker.ts`**

Add a function and wire it into the existing `onParentMessage`:

```ts
function pickMarked(token: string) {
  const node = document.querySelector(`[data-arcade-customized="${token}"]`);
  if (!node) return;
  const fiber = getFiberFromNode(node as Element);
  if (!fiber) return;
  const sel = resolveSelection(fiber, node as HTMLElement);
  if (!sel) return;
  overlay.showSelection(node as HTMLElement);
  postPicked(sel);
}
```

In `onParentMessage`, add a branch:

```ts
  else if (t === "arcade-studio:pick-marked") {
    const token = (data as { token?: unknown }).token;
    if (typeof token === "string") pickMarked(token);
  }
```

(`postPicked`, `getFiberFromNode`, `resolveSelection`, `overlay` are all already in scope in picker.ts.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/picker-pick-marked.test.ts`
Expected: PASS. (Adapt the fiber stub per the implementer note if jsdom resolution needs it.)

- [ ] **Step 5: Run the frame suite**

Run: `pnpm run studio:test __tests__/frame`
Expected: PASS (existing picker/overlay tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add studio/src/frame/picker.ts studio/__tests__/frame/picker-pick-marked.test.ts
git commit -m "feat(studio/canvas): picker re-selects a node by customize marker token"
```

---

## Task 3: Panel Customize button + grayed component mode + auto-reselect wiring

**Files:**
- Modify: `studio/src/components/inspector/InspectorPanel.tsx`
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Test: `studio/__tests__/components/panel-customize.test.tsx`

**Interfaces:**
- Consumes: `runCustomize` (existing, in InspectorPanel), `isInFrame`, `markJsxRoot`/`newCustomizeToken` (Task 1), `serializeTargetToJsx`/`buildCustomizePayload`/`postCustomize` (existing), `resolveCustomizeTarget`.
- Produces: component-mode panel UI driven by `!isInFrame`; a Customize button calling the flow; the flow marks the root + after success posts `pick-marked` so the element re-selects.

> Context: `runCustomize()` already does confirm → `serializeTargetToJsx` → `postCustomize` → success toast. This task: (a) component-mode = `!isInFrame` (not kitProps); (b) replace the stray "Ask AI to customize" tertiary button with a real **Customize** button calling `runCustomize`; (c) gray ALL field sections in component mode; (d) in `runCustomize`, generate a token, `markJsxRoot` the serialized jsx, pass the token into the payload, and on success arm auto-reselect (dispatch a window event FrameCard listens for, carrying frameSlug+token); (e) FrameCard, after the frame reload, posts `pick-marked` with the token to the iframe.

- [ ] **Step 1: Write the failing test**

```tsx
// studio/__tests__/components/panel-customize.test.tsx
// Renders InspectorPanel with a focused COMPONENT selection (file NOT under the
// frame, i.e. !isInFrame) inside EditSessionProvider + EditBlocksProvider, using
// the same mock scaffold as InspectorPanel.test.tsx. Asserts:
//  1. component mode shows a "Customize" button.
//  2. the style sections are rendered grayed (pointerEvents:none) — assert the
//     wrapper style or that a field control can't fire change.
//  3. clicking Customize calls confirm; on confirm, serializeTargetToJsx +
//     postCustomize are invoked with a payload whose jsx contains
//     data-arcade-customized.
// Copy the provider/arcade-gen-mock scaffold from InspectorPanel.test.tsx; mock
// customizeClient (serializeTargetToJsx, postCustomize, buildCustomizePayload
// pass-through, markJsxRoot real, newCustomizeToken stub) + useDialogs confirm→true.
import { describe, it, expect, vi } from "vitest";
// ... scaffold per InspectorPanel.test.tsx ...

describe("panel customize", () => {
  it("shows a Customize button for a component selection", () => {
    // render with !isInFrame selection → getByText("Customize") present
  });
  it("does not show Customize for an in-frame element", () => {
    // render with in-frame selection → queryByText("Customize") null; fields live
  });
  it("clicking Customize confirms then posts a marked-jsx payload", async () => {
    // stub confirm→true, serializeTargetToJsx→'<div>x</div>', postCustomize→{ok:true}
    // click Customize; await; assert postCustomize called with payload.jsx containing 'data-arcade-customized'
  });
});
```

> Implementer: flesh the three bodies from the real `InspectorPanel.test.tsx` scaffold (provider seeding of a focused selection — set `selection.file` to a NON-frame path like `/p/studio/prototype-kit/x.tsx` for component mode, and a `/…/frames/<slug>/index.tsx` path for in-frame mode; the panel reads `frameSlug` from edit-session). Keep assertions real: the Customize button's presence is driven by `!isInFrame`; the payload's jsx must contain the marker. To assert grayed, check the sections wrapper has `pointerEvents: "none"` when component mode.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/panel-customize.test.tsx`
Expected: FAIL — no panel Customize button; gray gate still keys on kitProps.

- [ ] **Step 3: InspectorPanel — component mode = `!isInFrame`, gray all, Customize button**

In `InspectorPanel.tsx`:

a. Compute component mode once where `focused`/`styles` are in scope:
```tsx
const isComponentSel = !!focused && !isInFrame(focused.selection.file, frameSlug ?? "");
```

b. Replace the grayed-sections gate. Change:
```tsx
<div style={kitProps.length > 0 ? { opacity: 0.5, pointerEvents: "none" } : {}}>
```
to:
```tsx
<div style={isComponentSel ? { opacity: 0.5, pointerEvents: "none" } : {}}>
```

c. In the component section, REPLACE the "Ask AI to customize" tertiary button (and the `Inner styles are part of this component…` line) with a real Customize button + the locked note. Render this section whenever `isComponentSel` (not only `kitProps.length > 0`), so a propless composite still gets it:
```tsx
{isComponentSel && (
  <Section title="Prebuilt component">
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {kitProps.map((p) => (
        <Field key={p.name} label={p.name}>
          <select aria-label={p.name} style={{ ...INPUT_COMPACT, opacity: 0.5, pointerEvents: "none" }}
            value={(pending[`prop:${p.name}`] as string) ?? ""} disabled readOnly>
            <option value="">—</option>
            {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      ))}
      <span style={{ fontSize: 11, color: "var(--fg-neutral-subtle)", lineHeight: 1.45 }}>
        {CUSTOMIZE_LOCKED_NOTE}
      </span>
      <Button variant="primary" onClick={() => { void customizeRef.current(); }}>Customize</Button>
    </div>
  </Section>
)}
```
(Props are grayed/disabled pre-customize per the spec's "all fields grayed" decision — simplest + honest. The `kitProps.length > 0` block at 472–504 is replaced by this `isComponentSel` block.)

d. In `runCustomize` (the existing function), add the marker + auto-reselect arming. Where it currently does `const jsx = serializeTargetToJsx(iframe, target);` then `postCustomize(...)`, change to:
```tsx
      const token = newCustomizeToken();
      const jsx = markJsxRoot(serializeTargetToJsx(iframe, target), token);
      const r = await postCustomize(slug, buildCustomizePayload(target, jsx, targetFrame));
      if (r.ok) {
        clear();
        // Arm auto-reselect: FrameCard re-picks the marked node after the reload.
        window.dispatchEvent(new CustomEvent("arcade-studio:armReselect", { detail: { frameSlug: targetFrame, token } }));
        if (lastSuccessToastId.current) dismiss(lastSuccessToastId.current);
        lastSuccessToastId.current = toast({ title: CUSTOMIZE_SUCCESS, intent: "success",
          action: { label: "Undo", onClick: () => { void postCustomizeUndo(slug, targetFrame); } } });
      } else {
        toast({ title: CUSTOMIZE_FALLBACK, intent: "alert" });
      }
```
(Remove the now-obsolete `frameWindow?.postMessage({ type: "arcade-studio:hide-component-chip" }…)` line — the chip is gone.)

e. Add imports: `markJsxRoot, newCustomizeToken` from `../../lib/customizeClient`.

- [ ] **Step 4: FrameCard — arm + fire auto-reselect after reload; drop chip wiring**

In `FrameCard.tsx`:

a. Remove the chip posts in the `frame-picked` handler (the `show-component-chip`/`hide-component-chip` block) and the `customize-request` forward. (The chip is gone; component mode is panel-driven now.)

b. Listen for the arm event and, after the next frame reload for that frame, post `pick-marked`:
```tsx
useEffect(() => {
  function onArm(e: Event) {
    const detail = (e as CustomEvent).detail as { frameSlug: string; token: string };
    if (detail.frameSlug !== frame.slug) return;
    // The frame reloads from disk after the customize write; wait one tick past
    // the reload, then ask the picker to re-select the marked node.
    const post = () => iframeRef.current?.contentWindow?.postMessage(
      { type: "arcade-studio:pick-marked", token: detail.token }, "*");
    // Re-post a few times to cover the reload timing (cheap, bounded).
    let tries = 0;
    const iv = setInterval(() => { post(); if (++tries >= 6) clearInterval(iv); }, 250);
  }
  window.addEventListener("arcade-studio:armReselect", onArm);
  return () => window.removeEventListener("arcade-studio:armReselect", onArm);
}, [frame.slug]);
```

> Note: the retry-post (6× over 1.5s) is a pragmatic way to land after the Vite reload without coupling to the exact reload event. The picker's `pick-marked` is idempotent (re-selecting the same node is harmless). If a cleaner reload signal exists in FrameCard (e.g. an onLoad on the iframe), prefer posting once on the first onLoad after arming; the retry is the fallback. Implementer: use the iframe `onLoad` if readily available, else the bounded retry.

- [ ] **Step 5: Run the test + component suite**

Run: `pnpm run studio:test __tests__/components/panel-customize.test.tsx && pnpm run studio:test __tests__/components`
Expected: PASS. Existing InspectorPanel tests that referenced the old kitProps-gated section or the "Ask AI to customize" button must be updated to the new component-mode UI (legit — the UI changed); keep assertions real.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/inspector/InspectorPanel.tsx studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/panel-customize.test.tsx
git commit -m "feat(studio/canvas): panel Customize button + grayed component mode + marker auto-reselect"
```

---

## Task 4: Remove the dead in-iframe chip

**Files:**
- Modify: `studio/src/frame/overlay/overlays.ts` (remove `showComponentChip`/`hideComponentChip` + `componentChip` var + its `isOverlayElement` entry)
- Modify: `studio/src/frame/overlay/index.ts` (drop the re-exports)
- Modify: `studio/src/frame/picker.ts` (remove the chip-ignore guard in `onClick` added by the prior fix — the chip is gone, so the guard is dead; the `pick-marked` handler from Task 2 stays)
- Delete/replace: chip tests (`studio/__tests__/frame/overlay-chip.test.ts`, `overlay-chip-reach.test.ts`, `picker-ignores-chip.test.ts`) — these test a removed feature
- Test: existing frame suite must stay green

**Interfaces:**
- Consumes: nothing new.
- Produces: a smaller overlay surface (selection box only, no Customize chip).

- [ ] **Step 1: Remove chip code**

In `overlays.ts`: delete `showComponentChip`, `hideComponentChip`, the `componentChip` module variable, and the `el === componentChip` line in `isOverlayElement`. In `index.ts`: remove the `showComponentChip`/`hideComponentChip` re-exports. In `picker.ts`: remove the chip-ignore guard block in `onClick` (the `isOverlayElement(target) || closest("[data-arcade-component-chip]")` early-return) — leave the rest of `onClick` intact.

> Verify with grep that nothing else imports `showComponentChip`/`hideComponentChip` after Task 3 removed the FrameCard usage: `grep -rn "ComponentChip\|component-chip\|customize-request" studio/src`. Any remaining reference must be removed.

- [ ] **Step 2: Delete the chip tests**

Remove the three chip test files (they test a deleted feature). Do NOT delete `picker-pick-marked.test.ts` (Task 2) or other frame tests.

```bash
git rm studio/__tests__/frame/overlay-chip.test.ts studio/__tests__/frame/overlay-chip-reach.test.ts studio/__tests__/frame/picker-ignores-chip.test.ts
```

- [ ] **Step 3: Run the frame suite + grep clean**

Run: `pnpm run studio:test __tests__/frame`
Expected: PASS (no chip tests; pick-marked + picker/overlay tests green).
Run: `grep -rn "ComponentChip\|component-chip\|customize-request\|show-component-chip\|hide-component-chip" studio/src`
Expected: NO matches (all chip wiring gone).

- [ ] **Step 4: Commit**

```bash
git add studio/src/frame/overlay/overlays.ts studio/src/frame/overlay/index.ts studio/src/frame/picker.ts studio/__tests__/frame/
git commit -m "refactor(studio/canvas): remove the dead in-iframe Customize chip (now panel-driven)"
```

---

## Task 5: Full suite + manual gate

- [ ] **Step 1: Full suite**

Run: `pnpm run studio:test`
Expected: all green except the known pre-existing `figmaBridge/wsServer` failure (fails at the branch base, touches no feature code — verify in isolation: `pnpm run studio:test __tests__/server/figmaBridge`). No NEW failures.

- [ ] **Step 2: Manual gate (HUMAN, app restart)**

`pnpm run studio` on a frame with a component (the computer frame, or generate one with a `<Button>`/`<Card>`):
1. Select a component → the panel shows a **Customize** button + grayed style fields + the locked note. NO floating chip in the frame.
2. Try to change a grayed field → it doesn't respond (can't silently revert).
3. Click **Customize** (in the panel — reachable) → confirm dialog → "✓ Now fully editable" toast.
4. The frame reloads and the element is **auto-reselected** → its style fields are now LIVE (not grayed).
5. Change padding/width → applies and PERSISTS (no revert on Done). ✓ block + Undo in the chat panel.
6. Undo (toast) restores the pre-customize frame.

Record results in the ledger. This path has failed every prior manual gate — it is the gate that matters.

---

## Final verification

- [ ] **Full suite green** (modulo the known figmaBridge pre-existing failure).
- [ ] **No chip references** remain (`grep` clean).
- [ ] **Manual gate scenarios 1–6 pass** — component editing works end to end: select → Customize (reachable) → auto-reselect → edit persists.
- [ ] **Frame never broken:** a failed customize leaves the frame untouched + shows the fallback toast.

## Notes on deferred scope

- On-canvas resize/move handles (separate phase).
- Stripping the `data-arcade-customized` marker from source (left in for v1; harmless).
- Reflecting committed-on-disk prop values in the panel after customize (picker snapshot limitation, unchanged).
