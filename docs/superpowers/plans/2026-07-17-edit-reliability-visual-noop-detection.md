# Edit Reliability — Visual No-Op Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the agent claimed a visual change but the at-rest rendered frame is pixel-identical (a real, valid prop the component silently ignored — e.g. `orientation="vertical"`), auto-retry the turn once with a corrective, then show an honest soft banner.

**Architecture:** A render fingerprint (geometry + paint, no text) is computed IN the frame after fonts settle and posted on its own `frame-fingerprint` message. The shell (FrameCard) captures a baseline from at-rest renders and, on an in-flight edit's probe, compares against the PRE-EXISTING baseline; an identical hash is a no-op *candidate*. The chat controller buffers the candidate and, only after the turn ends cleanly AND the agent's summary claimed a visual change, POSTs a server-owned corrective retry (session-resumed, no user bubble) and reconnects the stream. Still-no-op after the one retry → a soft banner. This is the visual twin of the shipped file-level phantom-edit check.

**Tech Stack:** TypeScript, React (frame iframe + shell), Vite middleware (Node ESM server), Vitest + jsdom. No new deps.

## Global Constraints

- Package manager **pnpm**. Focused tests: `pnpm run studio:test <path>` from repo root `/Users/andrey.sundiev/arcade-prototyper`. Full suite `pnpm run studio:test` (~90s; `chat-figma-context.test.ts` is a KNOWN contention flake — passes in isolation; `[ERROR]` lines in output are intentional esbuild fixtures; clear ports 9223-9232 if bridge tests flake).
- **`command git` for ALL git** (bare git intercepted by an rtk hook). Prefix any intercepted `grep`/`node` with `command`.
- **Never falsely claim "nothing changed" over a real visible change** is the cardinal sin — the fingerprint errs toward "changed"; any non-determinism fails safe (no warning). A MISSED no-op is acceptable; a FALSE no-op is not.
- **The fingerprint hashes geometry + a fixed paint set ONLY — never `textContent`** (a ticking clock / `Date.now()` would otherwise make it never match). Facts locked in the spec.
- **Fingerprint walks `document.body`**, not `#root` (Radix overlays portal to body). EXCLUDE only `[data-arcade-status-overlay]` (the sole in-body studio node; picker/inspector inject to `<html>`/`<head>`).
- **Fingerprint rides its OWN `arcade-studio:frame-fingerprint` message** — never folded into `frame-ready` (which must fire instantly to drive the swap).
- **Baseline (`lastCommittedFp`) is captured ONLY at-rest** (`editCycleActive.current === false`), never from the in-flight probe on arrival — updated from the probe only inside the swap. This is the fix for the self-poison the spec's rev-2 review caught (capturing from the probe → compare is always equal → fires on 100% of edits).
- **Narration-gate keys on the SUMMARY line only**, biased toward FIRING (a missed target bug is worse than one wasted turn); the self-classifying corrective prompt is the cheap catch for a false pass.
- **One-shot keyed on the originating USER-TURN lineage**, never `sessionId` (which rotates). Client treats the corrective's `end` as banner-only; resets its guard only on a new `send()`.
- **Fire the corrective only on a clean terminal end** (`phase === "done"`), never on error/cancelled.
- Spec: `docs/superpowers/specs/2026-07-17-edit-reliability-visual-noop-detection-design.md` (rev-3).

## File structure

| File | Responsibility |
|---|---|
| `studio/src/frame/renderFingerprint.ts` (NEW) | Pure `computeFingerprint(root, measure)` + production `measure`. The hash algorithm. |
| `studio/server/plugins/frameMountPlugin.ts` (MODIFY `frameBootstrap`) | Emit `frame-fingerprint` after `document.fonts.ready` + double-rAF. |
| `studio/src/components/viewport/visualNoOp.ts` (NEW) | Pure `isVisualNoOp(probeFp, baselineFp)` decision. |
| `studio/src/components/viewport/FrameCard.tsx` (MODIFY `onMsg` + props) | Capture baseline at-rest; compare edit-cycle probe; fire `onVisualNoOp`. |
| `studio/server/visualNoOpRetry.ts` (NEW) | Pure policy + `narrationClaimsVisualChange` + `VISUAL_NOOP_RETRY_PROMPT`. |
| `studio/server/middleware/chat.ts` (MODIFY dispatch + new handler) | `POST /api/chat/visual-noop-retry` — one-shot, session-resumed corrective turn. |
| `studio/src/hooks/useChatStream.ts` (MODIFY return) | Export `reconnect`. |
| `studio/src/components/viewport/Viewport.tsx` + chat controller (MODIFY) | Buffer candidate; gate on summary claim; POST + reconnect; one-shot; drive banner. |
| `studio/src/components/chat/VisualNoOpBanner.tsx` (NEW) | Soft banner + its own sentinel. |

---

## Task 1: renderFingerprint — the pure hash

**Files:**
- Create: `studio/src/frame/renderFingerprint.ts`
- Test: `studio/__tests__/frame/renderFingerprint.test.ts`

**Interfaces:**
- Produces:
  - `type Measured = { tag: string; rect: { x: number; y: number; w: number; h: number }; style: Record<string, string> }`
  - `type MeasureFn = (el: Element) => Measured | null` — return `null` to skip an element (e.g. excluded chrome).
  - `PAINT_PROPS: readonly string[]` — the fixed computed-style keys hashed.
  - `computeFingerprint(root: Element, measure: MeasureFn): string` — FNV-1a hex string over a DOM-order walk.
  - `productionMeasure(el: Element): Measured | null` — real `getBoundingClientRect` + `getComputedStyle`; returns `null` for `[data-arcade-status-overlay]` and its subtree.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/renderFingerprint.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeFingerprint, PAINT_PROPS } from "../../src/frame/renderFingerprint";
import type { MeasureFn, Measured } from "../../src/frame/renderFingerprint";

// Build a synthetic measure: geometry + paint come from a data-* JSON blob on
// each element, NOT from jsdom layout (which returns all-zero rects). This lets
// us test hash DISCRIMINATION deterministically without a real browser.
function fakeMeasure(overrides: Record<string, Partial<Measured>> = {}): MeasureFn {
  return (el: Element): Measured | null => {
    const id = el.getAttribute("data-id") ?? el.tagName.toLowerCase();
    const o = overrides[id] ?? {};
    const style: Record<string, string> = {};
    for (const p of PAINT_PROPS) style[p] = (o.style?.[p]) ?? "x";
    return {
      tag: el.tagName.toLowerCase(),
      rect: o.rect ?? { x: 0, y: 0, w: 10, h: 10 },
      style,
    };
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("computeFingerprint", () => {
  it("is stable: identical DOM + identical measure → identical hash", () => {
    const a = mount(`<div data-id="a"><span data-id="b">hi</span></div>`);
    const b = mount(`<div data-id="a"><span data-id="b">hi</span></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).toBe(computeFingerprint(b, m));
  });

  it("ignores textContent: same layout, DIFFERENT text → SAME hash (a ticking clock must not flip it)", () => {
    const a = mount(`<div data-id="a"><span data-id="b">12:00:00</span></div>`);
    const b = mount(`<div data-id="a"><span data-id="b">12:00:01</span></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).toBe(computeFingerprint(b, m));
  });

  it("flips on a geometry change (the orientation-swallow case inverse)", () => {
    const a = mount(`<div data-id="a"></div>`);
    const b = mount(`<div data-id="a"></div>`);
    const same = fakeMeasure();
    const moved = fakeMeasure({ a: { rect: { x: 0, y: 40, w: 10, h: 10 } } });
    expect(computeFingerprint(a, same)).not.toBe(computeFingerprint(b, moved));
  });

  it("flips on a paint change (color edit moves no boxes)", () => {
    const a = mount(`<div data-id="a"></div>`);
    const same = fakeMeasure();
    const recolored = fakeMeasure({ a: { style: { color: "red" } } });
    expect(computeFingerprint(a, same)).not.toBe(computeFingerprint(a, recolored));
  });

  it("is DOM-order sensitive (two siblings swapped → different hash)", () => {
    const a = mount(`<div data-id="p"><i data-id="x"></i><b data-id="y"></b></div>`);
    const b = mount(`<div data-id="p"><b data-id="y"></b><i data-id="x"></i></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).not.toBe(computeFingerprint(b, m));
  });

  it("skips elements whose measure returns null (excluded chrome)", () => {
    const withChrome = mount(`<div data-id="a"></div><div data-id="overlay"></div>`);
    const without = mount(`<div data-id="a"></div>`);
    const m: MeasureFn = (el) =>
      el.getAttribute("data-id") === "overlay" ? null : fakeMeasure()(el);
    expect(computeFingerprint(withChrome, m)).toBe(computeFingerprint(without, m));
  });

  it("returns a non-empty string for an empty root", () => {
    const empty = mount(``);
    expect(typeof computeFingerprint(empty, fakeMeasure())).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/frame/renderFingerprint.test.ts`
Expected: FAIL — module `renderFingerprint` not found.

- [ ] **Step 3: Implement**

Create `studio/src/frame/renderFingerprint.ts`:

```typescript
/**
 * Render fingerprint — a hash of a frame's AT-REST visible layout + paint.
 *
 * Used by visual-no-op detection: if an edit changes the code but the
 * fingerprint is identical across renders, the change was swallowed (a valid
 * prop the component ignores, e.g. `orientation`). See the spec:
 * docs/superpowers/specs/2026-07-17-edit-reliability-visual-noop-detection-design.md
 *
 * Deliberately does NOT hash textContent: a live clock / Date.now() / any
 * updating text would flip the hash between two renders of identical source
 * and make the check never fire. Geometry + a fixed paint set catch the target
 * class (swallowed layout/color/type props) without reading text.
 *
 * `measure` is injected so the hashing logic is unit-testable without a real
 * browser (jsdom returns all-zero rects + stub styles). Production passes
 * `productionMeasure`.
 */

export type Measured = {
  tag: string;
  rect: { x: number; y: number; w: number; h: number };
  style: Record<string, string>;
};

export type MeasureFn = (el: Element) => Measured | null;

/** Fixed set of computed paint properties hashed per element. Small + stable:
 *  enough to flip on any color/type/spacing/layout edit, cheap to resolve. */
export const PAINT_PROPS: readonly string[] = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "textAlign",
  "display",
  "flexDirection",
];

/** FNV-1a 32-bit, synchronous. Returns an 8-char hex string. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned via Math.imul + >>> 0
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Walk `root`'s subtree in DOM order, serialize each measured element, hash. */
export function computeFingerprint(root: Element, measure: MeasureFn): string {
  const parts: string[] = [];
  const walk = (el: Element): void => {
    const m = measure(el);
    if (m === null) return; // excluded (e.g. status overlay) — skip it + subtree
    parts.push(
      m.tag +
        "|" +
        Math.round(m.rect.x) +
        "," +
        Math.round(m.rect.y) +
        "," +
        Math.round(m.rect.w) +
        "," +
        Math.round(m.rect.h) +
        "|" +
        PAINT_PROPS.map((p) => m.style[p] ?? "").join(","),
    );
    for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
  };
  walk(root);
  return fnv1a(parts.join(";"));
}

/**
 * Production measure: real geometry + paint. Returns `null` for the studio
 * status overlay (and its subtree) so shell chrome never enters the hash.
 * Only lands in the FRAME's <body>; picker/inspector inject to <html>/<head>.
 */
export function productionMeasure(el: Element): Measured | null {
  if (el instanceof HTMLElement && el.closest("[data-arcade-status-overlay]")) return null;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const style: Record<string, string> = {};
  for (const p of PAINT_PROPS) style[p] = cs.getPropertyValue(cssToKebab(p)) || (cs as any)[p] || "";
  return {
    tag: el.tagName.toLowerCase(),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    style,
  };
}

/** camelCase CSS prop → kebab-case for getPropertyValue. */
function cssToKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/frame/renderFingerprint.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
command git add studio/src/frame/renderFingerprint.ts studio/__tests__/frame/renderFingerprint.test.ts
command git commit -m "feat(studio/frame): renderFingerprint — geometry+paint hash for visual no-op detection"
```

---

## Task 2: frame emits the `frame-fingerprint` message

**Files:**
- Modify: `studio/server/plugins/frameMountPlugin.ts` (`buildFrameBootstrapSource`, the exported template builder at `:296`; its returned ES-module string)
- Test: `studio/__tests__/server/frame-fingerprint-bootstrap.test.ts` (NEW — substring assertions on the generated bootstrap source, mirroring the existing `frameMountPlugin.test.ts` which already imports `buildFrameBootstrapSource`)

**Interfaces:**
- Consumes: `computeFingerprint`, `productionMeasure` from Task 1.
- Produces: every frame render posts, in addition to the existing `arcade-studio:frame-ready`, a NEW message `{ type: "arcade-studio:frame-fingerprint", slug, frame, n, fp }` after fonts + layout settle.

**Context:** `buildFrameBootstrapSource(opts)` (`frameMountPlugin.ts:296`, ALREADY EXPORTED — the existing test imports it at `frameMountPlugin.test.ts:6`) returns a template-string ES module that Vite serves as the iframe's entry. It already imports `arcade-studio/frame/picker` etc. and defines `ArcadeFrameReady` which posts `frame-ready` in a `useEffect`. The fingerprint must NOT be folded into `frame-ready` (that message drives the double-buffer swap and must fire instantly). Add a SEPARATE effect that awaits `document.fonts.ready`, double-rAFs, computes the fp over `document.body`, and posts it. **No rename needed — use `buildFrameBootstrapSource` as-is.**

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/frame-fingerprint-bootstrap.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildFrameBootstrapSource } from "../../server/plugins/frameMountPlugin";

const src = buildFrameBootstrapSource({
  absFrame: "/x/index.tsx",
  absOverrides: "/x/theme.css",
  mode: "light",
  slug: "proj",
  frame: "01-frame",
});

describe("frame bootstrap fingerprint emit", () => {
  it("imports the fingerprint helpers", () => {
    expect(src).toMatch(/renderFingerprint/);
  });
  it("posts a frame-fingerprint message", () => {
    expect(src).toContain("arcade-studio:frame-fingerprint");
  });
  it("awaits document.fonts.ready before measuring", () => {
    expect(src).toMatch(/document\.fonts[\s\S]*ready/);
  });
  it("still posts frame-ready (unchanged)", () => {
    expect(src).toContain("arcade-studio:frame-ready");
  });
  it("computes the fingerprint over document.body", () => {
    expect(src).toMatch(/computeFingerprint\(\s*document\.body/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/frame-fingerprint-bootstrap.test.ts`
Expected: FAIL — fingerprint strings absent from the bootstrap source.

- [ ] **Step 3: Implement**

In `frameMountPlugin.ts` `buildFrameBootstrapSource`, add the fingerprint import + emit effect to the returned template string (after the existing `import "arcade-studio/frame/gestureForwarder";` line and alongside `ArcadeFrameReady`):

Add to the imports block of the template:
```javascript
    import { computeFingerprint, productionMeasure } from "arcade-studio/frame/renderFingerprint";
```

Add a fingerprint emitter component and render it next to `ArcadeFrameReady`:
```javascript
    function ArcadeFrameFingerprint() {
      React.useEffect(() => {
        let cancelled = false;
        const post = () => {
          if (cancelled) return;
          try {
            const fp = computeFingerprint(document.body, productionMeasure);
            window.parent && window.parent.postMessage(
              { type: "arcade-studio:frame-fingerprint", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N, fp: fp }, "*");
          } catch (_) { /* fingerprint is best-effort; never break the frame */ }
        };
        const afterLayout = () => requestAnimationFrame(() => requestAnimationFrame(post));
        const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        fonts.then(afterLayout, afterLayout);
        return () => { cancelled = true; };
      }, []);
      return null;
    }
```

Render it in the tree next to `<ArcadeFrameReady />` (both are render-null effect components):
```javascript
          <ArcadeFrameReady />
          <ArcadeFrameFingerprint />
```

(`__N`, `slug`, `frame` are already in scope in the bootstrap — reuse them exactly as `ArcadeFrameReady` does.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/frame-fingerprint-bootstrap.test.ts`
Expected: PASS (5 tests). Also run the existing frameMountPlugin test to confirm no regression: `pnpm run studio:test studio/__tests__/server/` (frameMount-related files).

- [ ] **Step 5: Commit**

```bash
command git add studio/server/plugins/frameMountPlugin.ts studio/__tests__/server/frame-fingerprint-bootstrap.test.ts
command git commit -m "feat(studio/frame): emit frame-fingerprint message after fonts+layout settle"
```

---

## Task 3: visualNoOp fingerprint tracker + FrameCard wiring

> **REV-4 — this task was rewritten after the plan review found the rev-3 design (keying capture-vs-compare on `editCycleActive`) is DEAD in the app.** The frame's `frame-ready` posts immediately on mount (`frameMountPlugin.ts:330`, bare effect) and the swap sets `editCycleActive.current = false` at `FrameCard.tsx:182`. Our fingerprint deliberately lands LATER (awaits `document.fonts.ready` + double-rAF). So by the time the probe's fingerprint arrives, `editCycleActive` is already `false` → the rev-3 handler would misclassify every probe as an at-rest baseline capture and NEVER compare. The fix (the spec's original "pair by `n`" instruction, which rev-3 dropped): key entirely on the **nonce**, never on `editCycleActive`. The tracker holds a `{ fp, nonce }` baseline and compares any fingerprint whose nonce differs from the baseline's; equal fp → candidate; then promotes. This is ordering-immune AND self-poison-proof by construction (a render is never compared against its own baseline — different nonce is required to compare, same nonce just refreshes).

**Files:**
- Create: `studio/src/components/viewport/visualNoOp.ts`
- Modify: `studio/src/components/viewport/FrameCard.tsx` (add `onVisualNoOp?` prop; add a `FpTracker` ref; handle the `frame-fingerprint` message in the existing `onMsg` effect, and capture the current `reloadNonce` on `frame-changed`)
- Test: `studio/__tests__/components/visualNoOp.test.ts`

**Interfaces:**
- Produces:
  - `isVisualNoOp(probeFp: string | null | undefined, baselineFp: string | null | undefined): boolean` — true only when both present and equal.
  - `type FpTracker = { baseline: { fp: string; nonce: string } | null }`.
  - `observeFingerprint(tracker: FpTracker, fp: string, nonce: string): "captured" | "no-op" | "changed"` — the whole capture/compare/promote decision, nonce-keyed. Pure except it mutates `tracker.baseline`.
  - `FrameCard` new optional prop `onVisualNoOp?: (frameSlug: string) => void`.

- [ ] **Step 1: Write the failing decision test**

Create `studio/__tests__/components/visualNoOp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isVisualNoOp, observeFingerprint, type FpTracker } from "../../src/components/viewport/visualNoOp";

describe("isVisualNoOp", () => {
  it("true when probe equals baseline", () => {
    expect(isVisualNoOp("abc123", "abc123")).toBe(true);
  });
  it("false when they differ", () => {
    expect(isVisualNoOp("abc123", "def456")).toBe(false);
  });
  it("false when baseline is null (first generation)", () => {
    expect(isVisualNoOp("abc123", null)).toBe(false);
    expect(isVisualNoOp("abc123", undefined)).toBe(false);
  });
  it("false when probe is missing", () => {
    expect(isVisualNoOp(null, "abc123")).toBe(false);
  });
});

describe("observeFingerprint (nonce-keyed — ordering-immune, self-poison-proof)", () => {
  it("first fingerprint (no baseline) is captured, not compared", () => {
    const t: FpTracker = { baseline: null };
    expect(observeFingerprint(t, "base1", "")).toBe("captured");
    expect(t.baseline).toEqual({ fp: "base1", nonce: "" });
  });

  it("same-nonce fingerprint just refreshes the baseline (never a self-compare)", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "" } };
    // A second fingerprint for the SAME render (e.g. re-measure) — refresh, no compare.
    expect(observeFingerprint(t, "base1b", "")).toBe("captured");
    expect(t.baseline).toEqual({ fp: "base1b", nonce: "" });
  });

  it("a NEW-nonce fingerprint equal to baseline → no-op, then promotes (nonce advances)", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "0" } };
    expect(observeFingerprint(t, "base1", "1")).toBe("no-op");
    // promoted so the NEXT edit compares against this render
    expect(t.baseline).toEqual({ fp: "base1", nonce: "1" });
  });

  it("a NEW-nonce fingerprint that DIFFERS → changed, then promotes", () => {
    const t: FpTracker = { baseline: { fp: "base1", nonce: "0" } };
    expect(observeFingerprint(t, "moved2", "1")).toBe("changed");
    expect(t.baseline).toEqual({ fp: "moved2", nonce: "1" });
  });

  it("does NOT self-poison: an edit that truly changed pixels never reports no-op even if its fingerprint arrives after editCycle bookkeeping cleared", () => {
    // The whole point: no editCycleActive read. Ordering can't break it.
    const t: FpTracker = { baseline: { fp: "A", nonce: "0" } };
    expect(observeFingerprint(t, "B", "1")).toBe("changed");
    // subsequent identical render on nonce 2 vs the now-B baseline
    expect(observeFingerprint(t, "B", "2")).toBe("no-op");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `studio/src/components/viewport/visualNoOp.ts`:

```typescript
/**
 * Visual-no-op detection: an edit changed the code but the rendered frame is
 * pixel-identical to the prior render. See the spec.
 *
 * NONCE-KEYED, not editCycleActive-keyed. Rationale (plan review, rev-4): the
 * fingerprint message arrives AFTER `frame-ready` (it awaits fonts+rAF), by
 * which point the double-buffer swap has already cleared `editCycleActive`. So
 * we cannot read that flag to decide "is this the in-flight probe?" — we key on
 * the nonce instead: a fingerprint whose nonce differs from the baseline's is a
 * NEW render (compare it); a same-nonce fingerprint just refreshes the baseline
 * (a render is never compared against itself → no self-poison).
 */

export function isVisualNoOp(
  probeFp: string | null | undefined,
  baselineFp: string | null | undefined,
): boolean {
  if (!probeFp || !baselineFp) return false;
  return probeFp === baselineFp;
}

export type FpTracker = { baseline: { fp: string; nonce: string } | null };

/**
 * Fold one `frame-fingerprint` into the tracker. Returns what it meant:
 *   "captured" — no baseline yet, or same-nonce refresh (no comparison made)
 *   "no-op"    — a new-nonce render whose fp equals the baseline (candidate!)
 *   "changed"  — a new-nonce render whose fp differs (a real visible change)
 * In all NEW-nonce cases the baseline is promoted to this render, so the next
 * edit compares against the latest committed pixels. Mutates `tracker.baseline`.
 */
export function observeFingerprint(
  tracker: FpTracker,
  fp: string,
  nonce: string,
): "captured" | "no-op" | "changed" {
  const prev = tracker.baseline;
  if (!prev || prev.nonce === nonce) {
    // First render, or a re-measure of the SAME render → refresh, never compare.
    tracker.baseline = { fp, nonce };
    return "captured";
  }
  const result = isVisualNoOp(fp, prev.fp) ? "no-op" : "changed";
  tracker.baseline = { fp, nonce }; // promote so the next edit compares vs this
  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire FrameCard**

In `FrameCard.tsx`:
1. Import: `import { observeFingerprint, type FpTracker } from "./visualNoOp";`
2. Add the prop to the component's props type: `onVisualNoOp?: (frameSlug: string) => void;` and destructure it.
3. Add a ref near the other refs (`:74-88`): `const fpTracker = useRef<FpTracker>({ baseline: null });`
4. In the `onMsg` handler (`:158-202`), AFTER the `d.slug !== projectSlug || d.frame !== frame.slug` guard (`:164`) but BEFORE the `:165` nonce gate (the fingerprint has its own nonce semantics and must not be dropped by the frame-ready gate), add:

```typescript
      if (d.type === "arcade-studio:frame-fingerprint") {
        const fp = (d as { fp?: unknown }).fp;
        if (typeof fp === "string") {
          const outcome = observeFingerprint(fpTracker.current, fp, String(d.n ?? ""));
          if (outcome === "no-op") onVisualNoOp?.(frame.slug);
        }
        return;
      }
```

That is the ENTIRE FrameCard change for detection — no `editCycleActive` read, no swap-time promotion (the tracker promotes itself on every new-nonce fingerprint). The nonce on the fingerprint message is the same `n` the iframe was loaded with (`__N`), so the initial render (`n=""`) captures the baseline, and each edit's probe (`n=reloadNonce`) is a new nonce → compared. No dependency on message ordering.

**Note (verified):** `onMsg`'s existing `frame-ready`/`frame-error` branches keep their nonce+editCycle gates unchanged — this new branch `return`s before them, and it's the only place `frame-fingerprint` is handled.

- [ ] **Step 6: Run the focused test + a FrameCard-imports smoke**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts`
Expected: PASS. (The FrameCard render behavior is covered by the integration test in Task 5a and the manual gate — jsdom can't post real cross-iframe messages.)

- [ ] **Step 7: Commit**

```bash
command git add studio/src/components/viewport/visualNoOp.ts studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/visualNoOp.test.ts
command git commit -m "feat(studio/viewport): nonce-keyed render-fingerprint tracker flags visual no-op candidates"
```

---

## Task 4: server corrective-retry route + policy + narration gate + export reconnect

**Files:**
- Create: `studio/server/visualNoOpRetry.ts`
- Modify: `studio/server/middleware/chat.ts` (dispatch `:132-136` + new `handleVisualNoOpRetry`)
- Modify: `studio/src/hooks/useChatStream.ts` (export `reconnect` in the return at `:361`)
- Test: `studio/__tests__/server/visualNoOpRetry.test.ts`, `studio/__tests__/server/chat-visual-noop-route.test.ts`

**Interfaces:**
- Consumes: `runClaudeTurnWithRetry(opts, cfg)` (`claudeCode.ts:566`), `getProject`, `getTurn` (`turnRegistry.ts:175`, returns `{ id, prompt, status }`), `startTurn`.
- Produces:
  - `narrationClaimsVisualChange(summaryLine: string): boolean`
  - `shouldRunVisualNoOpRetry(input: { alreadyRanForTurn: boolean; claimsVisual: boolean }): boolean`
  - `VISUAL_NOOP_RETRY_PROMPT: string`
  - `POST /api/chat/visual-noop-retry { slug, frame, userTurnId }` (server route).
  - `useChatStream(...)` return now includes `reconnect: () => void`.

- [ ] **Step 1: Write the failing policy + classifier test**

Create `studio/__tests__/server/visualNoOpRetry.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  narrationClaimsVisualChange,
  shouldRunVisualNoOpRetry,
  VISUAL_NOOP_RETRY_PROMPT,
} from "../../server/visualNoOpRetry";

describe("narrationClaimsVisualChange (biased toward firing)", () => {
  it("fires on an explicit visual claim", () => {
    expect(narrationClaimsVisualChange("ToggleGroups now stack vertically — stops squeezing horizontal space")).toBe(true);
  });
  it("fires on ambiguous change language (misses safe-side toward the target bug)", () => {
    expect(narrationClaimsVisualChange("Updated the toggles")).toBe(true);
  });
  it("does NOT fire on a clearly non-visual behavior claim", () => {
    expect(narrationClaimsVisualChange("Wired the button to open the modal")).toBe(false);
  });
  it("does NOT fire on an accessibility/data claim", () => {
    expect(narrationClaimsVisualChange("Added an aria-label to the icon button")).toBe(false);
  });
  it("does NOT fire on a question or refusal", () => {
    expect(narrationClaimsVisualChange("Which timezone should be the default?")).toBe(false);
  });
});

describe("shouldRunVisualNoOpRetry", () => {
  it("runs when a visual claim is present and it hasn't run for this turn", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: false, claimsVisual: true })).toBe(true);
  });
  it("does not run twice for the same turn", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: true, claimsVisual: true })).toBe(false);
  });
  it("does not run without a visual claim", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: false, claimsVisual: false })).toBe(false);
  });
});

describe("VISUAL_NOOP_RETRY_PROMPT", () => {
  it("is self-classifying: tells the agent to opt out if the change was intentionally non-visual", () => {
    expect(VISUAL_NOOP_RETRY_PROMPT).toMatch(/non-visual|behavior|accessib/i);
    expect(VISUAL_NOOP_RETRY_PROMPT).toMatch(/identical|nothing visible|did not (change|alter)/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/visualNoOpRetry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the policy module**

Create `studio/server/visualNoOpRetry.ts`:

```typescript
/**
 * Visual-no-op retry policy + the corrective prompt. The visual twin of
 * phantomEditRetry.ts: pure policy here; the actual re-spawn lives in
 * server/middleware/chat.ts (handleVisualNoOpRetry). See the spec.
 */

/** Verbs/nouns that mark a summary as a NON-visual claim (behavior, data,
 *  accessibility). If any appears and no visual word does, don't fire. */
const NON_VISUAL = /\b(wired?|hook(ed)?|connect(ed)?|link(ed)?|handler|clickable|on-?click|navigat|route|accessib|aria|screen-?reader|data field|state|logic|functional)\b/i;

/** Marks a summary as clearly NOT a change claim (a question / refusal). */
const NOT_A_CHANGE = /(\?\s*$)|\b(can't|cannot|unable|which|should i|do you want)\b/i;

/**
 * True if the agent's SUMMARY line plausibly claimed a visual/layout/appearance
 * change. Biased toward firing: a missed target bug is worse than one wasted
 * corrective turn (the self-classifying prompt lets the agent opt out cheaply).
 * So: fire UNLESS the summary is clearly non-visual or clearly not-a-change.
 */
export function narrationClaimsVisualChange(summaryLine: string): boolean {
  const s = (summaryLine ?? "").trim();
  if (!s) return false;
  if (NOT_A_CHANGE.test(s)) return false;
  if (NON_VISUAL.test(s)) return false;
  return true;
}

export function shouldRunVisualNoOpRetry(input: {
  alreadyRanForTurn: boolean;
  claimsVisual: boolean;
}): boolean {
  if (input.alreadyRanForTurn) return false;
  return input.claimsVisual;
}

export const VISUAL_NOOP_RETRY_PROMPT =
  "The change you just made did not alter anything visible in the frame — the rendered result is identical to before. " +
  "If it was meant to change layout or appearance and a component ignored the property (e.g. an `orientation`/variant prop " +
  "the kit doesn't implement visually), achieve the intent a different way — real layout/utility classes on a wrapper, a " +
  "different component — so it actually renders. If the change was intentionally non-visual (wiring behavior, an " +
  "accessibility attribute, a data field), that's fine: reply saying so in one line and make no further edit. " +
  "Keep the response shape: a one-sentence summary plus a ### Deviations section.";
```

- [ ] **Step 4: Run to verify policy passes**

Run: `pnpm run studio:test studio/__tests__/server/visualNoOpRetry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Create `studio/__tests__/server/chat-visual-noop-route.test.ts`. Test the route handler's guard behavior with a stubbed turn runner. Since `handleStart` and friends run a real subprocess, the route test asserts: (a) 400 on missing slug/frame; (b) 404 on unknown project; (c) one-shot — a second POST for the same `userTurnId` returns a 200/ignored without spawning; (d) the corrective uses the server prompt (no user prompt from the body). Model it on the existing chat middleware tests (find with `command grep -rln "chatMiddleware\|handleStart\|/api/chat" studio/__tests__`). Concretely, assert the pure guard via an exported helper `visualNoOpRetryAlreadyRan(userTurnId)` + `markVisualNoOpRetryRan(userTurnId)` (a module-level `Set<string>` in chat.ts or visualNoOpRetry.ts):

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { markVisualNoOpRetryRan, visualNoOpRetryAlreadyRan } from "../../server/visualNoOpRetry";

describe("visual-noop one-shot guard (keyed on user-turn lineage)", () => {
  it("reports not-run for a fresh turn id, run after marking", () => {
    expect(visualNoOpRetryAlreadyRan("turn-abc")).toBe(false);
    markVisualNoOpRetryRan("turn-abc");
    expect(visualNoOpRetryAlreadyRan("turn-abc")).toBe(true);
  });
  it("is per-turn: a different turn id is independent", () => {
    markVisualNoOpRetryRan("turn-1");
    expect(visualNoOpRetryAlreadyRan("turn-2")).toBe(false);
  });
});
```

Add `markVisualNoOpRetryRan`/`visualNoOpRetryAlreadyRan` (a module-level `Set<string>`) to `visualNoOpRetry.ts`:

```typescript
const ranForTurn = new Set<string>();
export function visualNoOpRetryAlreadyRan(userTurnId: string): boolean {
  return ranForTurn.has(userTurnId);
}
export function markVisualNoOpRetryRan(userTurnId: string): void {
  ranForTurn.add(userTurnId);
}
```

- [ ] **Step 6: Run to verify fail, then implement the guard + route**

Run: `pnpm run studio:test studio/__tests__/server/chat-visual-noop-route.test.ts`
Expected: FAIL — guards not exported.

Add the guard functions (above) to `visualNoOpRetry.ts`. Then wire the route in `chat.ts`:

Add a URL const near the other route regexes:
```typescript
const VISUAL_NOOP_RETRY_URL = /^\/api\/chat\/visual-noop-retry$/;
```

In `chatMiddleware`'s POST branch (`:132-136`), match it BEFORE `handleStart` (so `/api/chat/visual-noop-retry` isn't swallowed by the generic `/api/chat` prefix):
```typescript
    if (req.url.startsWith("/api/chat") && req.method === "POST") {
      const cancelMatch = req.url.match(CANCEL_URL);
      if (cancelMatch) return handleCancel(res, cancelMatch[1].toLowerCase());
      if (VISUAL_NOOP_RETRY_URL.test(req.url)) return handleVisualNoOpRetry(req, res);
      return handleStart(req, res);
    }
```

Add `handleVisualNoOpRetry`. **REV-4 — this MUST register a real turn via `startTurn`, exactly like `handleStart` (`chat.ts:275-307`), reusing `runClaudeBranch` as the corrective's `run`.** The rev-3 snippet's "fire-and-forget `runClaudeTurnWithRetry` after the 202" was broken: no turn is registered, so the client's `reconnect()` finds the previous (ended) turn and streams nothing; and `runClaudeBranch` already handles session-resume + narration `emit` + `appendHistory` + the frame-change contract, so calling the lower-level `runClaudeTurnWithRetry` directly would duplicate all of that (and reference `DEFAULT_MODEL`, which does not exist — the real const is the private `DEFAULT_GENERATION_MODEL` at `claudeCode.ts:199`; `runClaudeTurn` resolves the model internally at `:266`, so we pass no model at all here).

`runClaudeBranch(ctx: { emit, slug, prompt, images?, project, signal })` (`chat.ts:662`) is the SAME function `handleStart` uses for a normal Claude turn — it resumes `project.sessionId`, streams narration via `emit`, runs the hooks, and `appendHistory`s the assistant reply. We reuse it verbatim, passing `VISUAL_NOOP_RETRY_PROMPT` as the prompt. Because it's wrapped in `startTurn`, the corrective is registered under the slug and the reconnected client stream replays it. No user bubble is written (only `handleStart`'s pre-`startTurn` `appendHistory` at `:267` writes the user message; we don't call that).

Full handler:

```typescript
async function handleVisualNoOpRetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  let body: { slug?: string; frame?: string; userTurnId?: string };
  try { body = JSON.parse(buf); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "Invalid JSON" } }));
    return;
  }
  const { slug, frame, userTurnId } = body;
  if (typeof slug !== "string" || !slug || typeof frame !== "string" || !frame || typeof userTurnId !== "string" || !userTurnId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "slug, frame, userTurnId required" } }));
    return;
  }
  const project = await getProject(slug);
  if (!project) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
    return;
  }
  // One-shot per originating user-turn (stable across session rotation).
  if (visualNoOpRetryAlreadyRan(userTurnId)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, skipped: "already_ran" }));
    return;
  }
  const running = getTurn(slug);
  if (running && running.status === "running") {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "turn_in_progress", message: "A turn is already running." } }));
    return;
  }
  markVisualNoOpRetryRan(userTurnId);

  // Register the corrective as a REAL turn — SAME shape as handleStart (:275),
  // reusing runClaudeBranch so session-resume + narration + appendHistory +
  // the frame-change contract all work. NO user-message appendHistory (no
  // fake user bubble). Respond 202 AFTER startTurn so the reconnecting client
  // finds the registered turn to replay (proven ordering: startTurn is sync).
  const turn = startTurn(slug, {
    prompt: VISUAL_NOOP_RETRY_PROMPT,
    run: ({ emit, end, signal }) => {
      runClaudeBranch({ emit, slug, prompt: VISUAL_NOOP_RETRY_PROMPT, project, signal }).then(
        (result) => end(result),
        (err) => end({ ok: false, error: err?.message ?? String(err) }),
      );
    },
  });
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ turnId: turn.id, slug }));
}
```

`startTurn`, `getTurn`, `getProject`, `runClaudeBranch` are all already defined/imported in `chat.ts` (verified: `runClaudeBranch` at `:662`; `startTurn` used at `:275`). No new imports beyond `VISUAL_NOOP_RETRY_PROMPT`, `visualNoOpRetryAlreadyRan`, `markVisualNoOpRetryRan` from `../visualNoOpRetry`.

**On the banner trailer (resolves a rev-3 inconsistency):** the still-no-op banner is driven ENTIRELY client-side (a fresh `onVisualNoOp` for the frame during the corrective turn's render — Task 5). The server route does NOT append any sentinel to history — it can't see pixels, and a narration-based append could falsely fire the banner over a corrective that DID fix the render (violating the cardinal "never falsely claim nothing changed"). So `handleVisualNoOpRetry` writes no trailer; the banner is a client-only, pixel-observed signal.

- [ ] **Step 7: Export `reconnect` from useChatStream**

In `studio/src/hooks/useChatStream.ts:361`, change the return to include `reconnect`:
```typescript
  return { state, send, retry, cancel, reconnect };
```
(No test change needed — Task 5's wiring test consumes it. Confirm no existing consumer destructures the return in a way that breaks — it's an additive field, so it can't.)

- [ ] **Step 8: Run the server tests**

Run: `pnpm run studio:test studio/__tests__/server/visualNoOpRetry.test.ts studio/__tests__/server/chat-visual-noop-route.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
command git add studio/server/visualNoOpRetry.ts studio/server/middleware/chat.ts studio/src/hooks/useChatStream.ts studio/__tests__/server/visualNoOpRetry.test.ts studio/__tests__/server/chat-visual-noop-route.test.ts
command git commit -m "feat(studio/server): visual-noop corrective-retry route + narration gate + policy; export reconnect"
```

---

## Task 5: client trigger wiring + soft banner

**Files:**
- Create: `studio/src/components/chat/VisualNoOpBanner.tsx`
- Modify: `studio/src/hooks/useChatStream.ts` (export `reconnect` — done in Task 4 Step 7 — AND add `turnId` to the state it sets from the turn header), `studio/src/hooks/chatStreamReducer.ts` (add `turnId` to `StreamState` + `INITIAL_STATE`), `studio/src/hooks/useProjectFromHost.ts` (buffer + trigger effect + one-shot), `studio/src/routes/ProjectDetail.tsx` + `studio/src/components/viewport/Viewport.tsx` (thread `onVisualNoOp` prop down to `FrameCard`), the chat pane that renders `NoFrameChangesBanner` (render `VisualNoOpBanner` from transient state)
- Test: `studio/__tests__/components/visual-noop-banner.test.tsx`, `studio/__tests__/components/visual-noop-trigger.test.ts`

**Interfaces:**
- Consumes: `onVisualNoOp` from FrameCard (Task 3); `narrationClaimsVisualChange` (Task 4); `reconnect` + the POST's returned `turnId` (Task 4); the SSE `state.phase`/`state.turnId`/`state.narrations`.
- Produces: `VisualNoOpBanner` component + `VISUAL_NOOP_SENTINEL` + `splitVisualNoOpTrailer(content)`; pure `shouldTriggerVisualNoOpRetry(...)` + `firstSummaryLine(...)` in `visualNoOp.ts`; `StreamState.turnId`.

- [ ] **Step 1: Write the failing banner test**

Create `studio/__tests__/components/visual-noop-banner.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisualNoOpBanner, splitVisualNoOpTrailer, VISUAL_NOOP_SENTINEL } from "../../src/components/chat/VisualNoOpBanner";

describe("VisualNoOpBanner", () => {
  it("has a distinct sentinel (not the no-frame-changes one)", () => {
    expect(VISUAL_NOOP_SENTINEL).not.toContain("no frame changes");
    expect(VISUAL_NOOP_SENTINEL.length).toBeGreaterThan(0);
  });
  it("splits the trailer off the body", () => {
    const { body, hasWarning } = splitVisualNoOpTrailer("Done.\n\n" + VISUAL_NOOP_SENTINEL + " rest");
    expect(hasWarning).toBe(true);
    expect(body).toBe("Done.");
  });
  it("no sentinel → no warning, body intact", () => {
    const { body, hasWarning } = splitVisualNoOpTrailer("All good.");
    expect(hasWarning).toBe(false);
    expect(body).toBe("All good.");
  });
  it("renders the soft message", () => {
    render(<VisualNoOpBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/visual-noop-banner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner** (model on `NoFrameChangesBanner.tsx`)

Create `studio/src/components/chat/VisualNoOpBanner.tsx`:

```typescript
/**
 * Soft, non-accusatory banner for "the code changed but nothing on screen
 * moved" — shown when a visual-no-op survived one corrective retry. Distinct
 * sentinel from NoFrameChangesBanner so the two never collide in the
 * persisted-message split. See the spec.
 */

export const VISUAL_NOOP_SENTINEL = "⚠ Studio: this change didn't move anything on screen";

export function splitVisualNoOpTrailer(content: string): { body: string; hasWarning: boolean } {
  const idx = content.indexOf(VISUAL_NOOP_SENTINEL);
  if (idx === -1) return { body: content, hasWarning: false };
  return { body: content.slice(0, idx).trimEnd(), hasWarning: true };
}

export function VisualNoOpBanner() {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--bg-warning-subtle, #fff3e0)",
        color: "var(--fg-warning-prominent, #8b4500)",
        border: "1px solid var(--stroke-warning-subtle, rgba(139, 69, 0, 0.15))",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 14, lineHeight: "1.4" }}>⚠</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>Nothing changed on screen</div>
        <div style={{ opacity: 0.9 }}>
          This change updated the code but nothing on screen moved — the setting may be one this
          component ignores. If you expected a visual change, try describing the look you want.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the failing trigger-decision test**

Create `studio/__tests__/components/visual-noop-trigger.test.ts`. Extract the trigger decision to a pure function so it's testable without the component:

```typescript
import { describe, it, expect } from "vitest";
import { shouldTriggerVisualNoOpRetry } from "../../src/components/viewport/visualNoOp";

describe("shouldTriggerVisualNoOpRetry", () => {
  const base = { candidateBuffered: true, phase: "done" as const, summaryClaimsVisual: true, alreadyTriggeredThisTurn: false };
  it("triggers on: candidate + clean end + visual claim + not-yet-triggered", () => {
    expect(shouldTriggerVisualNoOpRetry(base)).toBe(true);
  });
  it("does NOT trigger without a buffered candidate", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, candidateBuffered: false })).toBe(false);
  });
  it("does NOT trigger on a non-done phase (error/cancelled)", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, phase: "error" })).toBe(false);
    expect(shouldTriggerVisualNoOpRetry({ ...base, phase: "cancelled" })).toBe(false);
  });
  it("does NOT trigger without a visual claim", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, summaryClaimsVisual: false })).toBe(false);
  });
  it("does NOT trigger twice for the same turn", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, alreadyTriggeredThisTurn: true })).toBe(false);
  });
});

import { firstSummaryLine } from "../../src/components/viewport/visualNoOp";

describe("firstSummaryLine", () => {
  it("strips journey (→) lines and returns the first summary line", () => {
    expect(firstSummaryLine(["→ Scanning", "→ Composing", "Made the toggles vertical.", "### Deviations", "None."])).toBe(
      "Made the toggles vertical.",
    );
  });
  it("stops at ### Deviations (never reads the deviations body)", () => {
    expect(firstSummaryLine(["Done.", "### Deviations", "- used a wrapper for layout"])).toBe("Done.");
  });
  it("returns '' when there is no summary", () => {
    expect(firstSummaryLine(["→ only journey lines"])).toBe("");
    expect(firstSummaryLine([])).toBe("");
  });
});
```

- [ ] **Step 5: Implement the trigger decision + wire the controller**

Add to `studio/src/components/viewport/visualNoOp.ts`:
```typescript
export function shouldTriggerVisualNoOpRetry(input: {
  candidateBuffered: boolean;
  phase: "done" | "error" | "cancelled" | string;
  summaryClaimsVisual: boolean;
  alreadyTriggeredThisTurn: boolean;
}): boolean {
  if (!input.candidateBuffered) return false;
  if (input.phase !== "done") return false;
  if (!input.summaryClaimsVisual) return false;
  if (input.alreadyTriggeredThisTurn) return false;
  return true;
}

/**
 * The agent's one-sentence summary line from a turn's narrations. Drops journey
 * lines (prefixed `→ `) and stops at `### Deviations` so the visual-claim gate
 * reads the summary only, never the deviations body or server-side lines.
 */
export function firstSummaryLine(narrations: string[]): string {
  for (const raw of narrations) {
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("→")) continue;      // journey line
      if (t.startsWith("### Deviations")) return ""; // reached deviations w/o a summary
      return t;                              // first real summary line
    }
  }
  return "";
}
```

**REV-4 — wire the STREAM OWNER, not `Viewport`.** Verified: `Viewport.tsx` only receives `phase` as a prop (`:14-30`) — it does NOT own `useChatStream`. The stream is owned by `useProjectFromHost` (`src/hooks/useProjectFromHost.ts:38` `const chatStream = useChatStream(...)`, returns `{ chatStream, send, ... }`), provided via `ChatStreamProvider` in `src/routes/ProjectDetail.tsx:344`, which renders `<Viewport phase={chatStream.state.phase} … />` at `:452`. So `reconnect`, `state.narrations`, `send`, and the turn id all live in `useProjectFromHost`/`ProjectDetail`. Put the buffer + trigger there; thread `onVisualNoOp` down `ProjectDetail → Viewport → FrameCard` (two new prop hops).

**REV-4 — turnId plumbing (Critical C3): `StreamState` does NOT currently keep the turn id.** Verified: the SSE `turn` header carries `turnId` (`useChatStream.ts:35`) but the reducer's turn-header branch (`:196-213`) sets `busy/phase/lastPrompt/turnStartedAt` and DROPS `turnId`; `StreamState` (`chatStreamReducer.ts:37-75`) has no `turnId`. Without it the one-shot guards are unkeyable. Fix (part of this task):
- Add `turnId: string | null` to `StreamState` + `INITIAL_STATE` (`chatStreamReducer.ts`).
- In `useChatStream.ts`'s turn-header handler (`:199-211`), add `turnId: header.turnId` to the state it sets.

Then, in `useProjectFromHost` (where `chatStream` + `send` live):
1. Candidate buffer: `const noOpCandidate = useRef<string | null>(null)` (frame slug). Pass `onVisualNoOp={(s) => { noOpCandidate.current = s; }}` down to each `FrameCard` (via Viewport prop-thread).
2. One-shot: `const triggeredForTurn = useRef<string | null>(null)` (holds the userTurnId already triggered). This survives the corrective turn's `end` because it's keyed on the ORIGINATING user turn id, not reset on every `end`.
3. An effect keyed on `[chatStream.state.phase, chatStream.state.turnId]`: when `phase === "done"` AND `turnId` is a NEW user turn (see 4), evaluate the trigger.
4. **Distinguish a user turn from the corrective turn.** The corrective is registered under a fresh turn id too, so its `done` would otherwise re-evaluate. Guard: only trigger when `state.turnId !== triggeredForTurn.current` AND `noOpCandidate.current != null` AND `narrationClaimsVisualChange(firstSummaryLine(state.narrations))` AND `shouldTriggerVisualNoOpRetry(...)`. On trigger: set `triggeredForTurn.current = state.turnId` (the ORIGINATING turn), `POST /api/chat/visual-noop-retry { slug, frame: noOpCandidate.current, userTurnId: state.turnId }`, then `chatStream.reconnect()`, then clear `noOpCandidate.current = null`. When the CORRECTIVE turn later ends `done`, its `turnId` is different, but `noOpCandidate.current` was cleared AND (if it re-nooped) the banner path (6) handles it — and crucially we do NOT POST again because a fresh candidate for the corrective turn is what drives the banner, not another retry. To be certain: also track `correctiveTurnId` — set it to the POST's returned `turnId` (from the 202 body) and never trigger a retry for that id.
5. `firstSummaryLine(narrations: string[]): string` — exported helper in `visualNoOp.ts`: join with `\n`, drop lines starting with `→ ` (journey lines), stop at the first `### Deviations`, return the first remaining non-empty line. Unit-test it (strips `→ ` lines; stops at `### Deviations`; returns "" on empty).
6. **The banner (client-observed, NOT server-appended — resolves the rev-3 inconsistency + the cardinal-sin risk).** When the CORRECTIVE turn (id === `correctiveTurnId`) reaches `phase === "done"`, check whether `noOpCandidate.current` was set AGAIN during it (a fresh `onVisualNoOp` fired for the frame → the corrective ALSO produced identical pixels). If so → set a piece of state `visualNoOpBannerForFrame = frame` that the chat pane renders as `<VisualNoOpBanner/>` below the corrective turn's assistant message. If the corrective MOVED pixels (no fresh candidate) → no banner (silent success). The banner is thus gated on a pixel-observed still-no-op, never on narration — the server appends nothing (see Task 4). Do NOT re-POST for the corrective turn (guard 4).

   **Simplify:** the banner can be a transient piece of shell state (not a persisted history trailer) — render `<VisualNoOpBanner/>` in the chat pane when `visualNoOpBannerForFrame` is set for the current view, cleared on the next user `send()`. This avoids touching history persistence entirely. `splitVisualNoOpTrailer`/`VISUAL_NOOP_SENTINEL` remain exported (they're tested + available if a persisted variant is wanted later) but v1 uses transient state. Render it beside where `NoFrameChangesBanner` renders (`command grep -rn "NoFrameChangesBanner" studio/src` → the chat message list / pane).

- [ ] **Step 6: Run the client tests**

Run: `pnpm run studio:test studio/__tests__/components/visual-noop-banner.test.tsx studio/__tests__/components/visual-noop-trigger.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
command git add studio/src/components/chat/VisualNoOpBanner.tsx studio/src/components/viewport/visualNoOp.ts \
  studio/src/hooks/chatStreamReducer.ts studio/src/hooks/useChatStream.ts studio/src/hooks/useProjectFromHost.ts \
  studio/src/routes/ProjectDetail.tsx studio/src/components/viewport/Viewport.tsx \
  studio/__tests__/components/visual-noop-banner.test.tsx studio/__tests__/components/visual-noop-trigger.test.ts
# plus the chat-pane file where VisualNoOpBanner is rendered beside NoFrameChangesBanner
command git commit -m "feat(studio/chat): buffer visual-noop candidate, gate on visual claim, POST retry + soft banner"
```

---

## Task 6: Full suite + wiring smoke

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test` (clear ports 9223-9232 first).
Expected: PASS. The `chat-figma-context.test.ts` contention flake is known/unrelated — re-run it in isolation if it fails; anything else is a real regression to fix.

- [ ] **Step 2: Type-check / build sanity**

Run: `pnpm run studio:test` already runs through Vite's transform; additionally confirm no TS error introduced in the touched files by running the focused tests from Tasks 1-5 together:
`pnpm run studio:test studio/__tests__/frame/renderFingerprint.test.ts studio/__tests__/components/visualNoOp.test.ts studio/__tests__/components/frame-card-visual-noop.test.tsx studio/__tests__/server/visualNoOpRetry.test.ts studio/__tests__/server/chat-visual-noop-route.test.ts studio/__tests__/components/visual-noop-banner.test.tsx studio/__tests__/components/visual-noop-trigger.test.ts`
Expected: PASS.

- [ ] **Step 3: No commit** (nothing new; prior tasks committed).

---

## Task 7: Manual acceptance (running app — user)

- [ ] **Step 1: The repro.** `pnpm run studio` (fully quit + restart — server + frame bootstrap + client changed). In `computer-skills-filtering-proto` (or any project with a ToggleGroup/Select): ask "make these toggle groups vertical." **Expect:** the agent's "now stack vertically" is NOT accepted silently — either the corrective retry makes a real visible change, or (still no-op after one retry) the soft "nothing changed on screen" banner appears. NOT a green "done" over an unchanged screen.
- [ ] **Step 2: No false-fire on a real edit.** Ask for a genuine visual change (e.g. "make the card background light gray"). **Expect:** pixels move → NO banner, NO wasted retry.
- [ ] **Step 3: No false-fire on a behavior edit.** Ask to wire an interaction ("make this button open a modal"). **Expect:** narration claims behavior → no visual-no-op trigger, no wasted turn (even though at-rest pixels may be identical).
- [ ] **Step 4: Report.** Note any false-fire (a real change flagged as no-op) or missed no-op. False-fire is the cardinal issue; a miss is acceptable per the safe-direction bound.
- [ ] **Step 5: No version bump here.** All edit-reliability features ship under ONE release once gates pass — separate explicit step.

---

## Self-review notes (author, rev-4)

- **Spec coverage:** Piece 1 (fingerprint) = Task 1; Piece 1 emit = Task 2; Piece 2 (compare) = Task 3; Piece 3 (corrective route + policy + gate + reconnect) = Task 4; Piece 3 client trigger + Piece 4 banner = Task 5; suite = Task 6; manual gate = Task 7.
- **The plan-review Criticals are all fixed in rev-4:**
  - **C1 (compare dead in the app — `editCycleActive` cleared before the fingerprint arrives):** Task 3 rewritten to be NONCE-keyed via `observeFingerprint({fp,nonce})` — no `editCycleActive` read at all, so message ordering can't break it, and a render is never compared against its own baseline (self-poison-proof by construction). Test asserts a new-nonce equal fp → "no-op", new-nonce different fp → "changed", same-nonce → "captured" (no compare).
  - **C2 (server route was a non-streaming placeholder + `DEFAULT_MODEL` doesn't exist):** Task 4 rewritten to register a real turn via `startTurn` reusing `runClaudeBranch` (the same path `handleStart` uses — free session-resume + narration emit + `appendHistory`), respond 202 after `startTurn` so the reconnecting client replays it, and pass NO model (resolved internally at `claudeCode.ts:266`).
  - **C3 (`userTurnId` not obtainable — `StreamState` drops `turnId`):** Task 5 adds `turnId` to `StreamState` + `INITIAL_STATE` and sets it in the reducer's turn-header branch; the one-shot keys on it.
  - **Important (wrong wiring file):** Task 5 now wires `useProjectFromHost`/`ProjectDetail` (the real stream owner) and threads `onVisualNoOp` down through `Viewport` to `FrameCard`, not `Viewport` alone.
  - **Important (false-"nothing changed" banner):** the banner is client-observed only (a fresh `onVisualNoOp` during the corrective turn), never server-appended on narration — so a corrective that DID fix the render never shows the banner.
  - **Task 2 name:** uses the real `buildFrameBootstrapSource` (`frameMountPlugin.ts:296`, already exported), not the invented `renderFrameBootstrap`. (Fix the Task 2 test import + Step 3 accordingly — see the correction note in Task 2.)
- **Rev-2/rev-3 fixes retained:** `document.body` + status-overlay exclusion (Task 1 `productionMeasure` + null-skip test); no textContent (Task 1 "different text → same hash" test); separate `frame-fingerprint` message + `document.fonts.ready` (Task 2); narration-gate on the summary line, biased to fire (Task 4 `narrationClaimsVisualChange` + both-direction tests); fire only on `phase==="done"` (Task 5 `shouldTriggerVisualNoOpRetry`).
- **Type consistency:** `computeFingerprint`/`MeasureFn`/`Measured`/`PAINT_PROPS`/`productionMeasure` (Task 1) → Task 2 emit. `isVisualNoOp`/`FpTracker`/`observeFingerprint`/`shouldTriggerVisualNoOpRetry`/`firstSummaryLine` (Task 3/5) in `visualNoOp.ts`. `narrationClaimsVisualChange`/`shouldRunVisualNoOpRetry`/`VISUAL_NOOP_RETRY_PROMPT`/`markVisualNoOpRetryRan`/`visualNoOpRetryAlreadyRan` (Task 4) in `visualNoOpRetry.ts`. `VISUAL_NOOP_SENTINEL`/`splitVisualNoOpTrailer`/`VisualNoOpBanner` (Task 5) in `VisualNoOpBanner.tsx`. `StreamState.turnId` (Task 5). Message string `arcade-studio:frame-fingerprint` consistent Task 2 emit ↔ Task 3 handle.
- **Integration coverage (plan-review point #5):** the pure seams are unit-tested; the real cross-iframe message flow (frame-changed → frame-ready → frame-fingerprint → candidate) can't run in jsdom, so it is a NAMED manual-gate item (Task 7 Step 1), consistent with the NWS-HMR lesson that jsdom is blind to real message/HMR flow. `observeFingerprint`'s ordering-immunity is what removes the need for a live test to catch C1 (the bug is now structurally impossible, not just untested).
