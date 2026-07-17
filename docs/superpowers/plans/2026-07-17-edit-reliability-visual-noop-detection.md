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
- Modify: `studio/server/plugins/frameMountPlugin.ts` (`frameBootstrap`, the template string around `:326-338`)
- Test: `studio/__tests__/server/frame-fingerprint-bootstrap.test.ts` (NEW — substring assertions on the generated bootstrap source, mirroring existing frameMountPlugin tests)

**Interfaces:**
- Consumes: `computeFingerprint`, `productionMeasure` from Task 1.
- Produces: every frame render posts, in addition to the existing `arcade-studio:frame-ready`, a NEW message `{ type: "arcade-studio:frame-fingerprint", slug, frame, n, fp }` after fonts + layout settle.

**Context:** `frameBootstrap` (`frameMountPlugin.ts:298+`) returns a template-string ES module that Vite serves as the iframe's entry. It already imports `arcade-studio/frame/picker` etc. and defines `ArcadeFrameReady` which posts `frame-ready` in a `useEffect`. The fingerprint must NOT be folded into `frame-ready` (that message drives the double-buffer swap and must fire instantly). Add a SEPARATE effect that awaits `document.fonts.ready`, double-rAFs, computes the fp over `document.body`, and posts it.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/frame-fingerprint-bootstrap.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderFrameBootstrap } from "../../server/plugins/frameMountPlugin";

// renderFrameBootstrap is the exported template builder (see Step 3 note: if it
// isn't exported yet, export it in this task — the existing frameBootstrap is a
// module-private const; expose a named export for testing).
const src = renderFrameBootstrap({
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
Expected: FAIL — `renderFrameBootstrap` not exported / fingerprint strings absent.

- [ ] **Step 3: Implement**

In `frameMountPlugin.ts`: (a) if the bootstrap builder is a private const, rename/export it as `renderFrameBootstrap` (keep the call site working); (b) add the fingerprint import + emit effect. The added module code (inside the returned template string, after the existing `import "arcade-studio/frame/gestureForwarder";` line and alongside `ArcadeFrameReady`):

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

## Task 3: visualNoOp decision + FrameCard capture/compare

**Files:**
- Create: `studio/src/components/viewport/visualNoOp.ts`
- Modify: `studio/src/components/viewport/FrameCard.tsx` (add `onVisualNoOp?` prop; add `lastCommittedFp` ref; handle the `frame-fingerprint` message in/near the existing `onMsg` effect `:158-202`)
- Test: `studio/__tests__/components/visualNoOp.test.ts` (decision), `studio/__tests__/components/frame-card-visual-noop.test.tsx` (message handling)

**Interfaces:**
- Produces:
  - `isVisualNoOp(probeFp: string | null | undefined, baselineFp: string | null | undefined): boolean` — true only when both present and equal.
  - `FrameCard` new optional prop `onVisualNoOp?: (frameSlug: string) => void`.

- [ ] **Step 1: Write the failing decision test**

Create `studio/__tests__/components/visualNoOp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isVisualNoOp } from "../../src/components/viewport/visualNoOp";

describe("isVisualNoOp", () => {
  it("true when probe equals baseline", () => {
    expect(isVisualNoOp("abc123", "abc123")).toBe(true);
  });
  it("false when they differ", () => {
    expect(isVisualNoOp("abc123", "def456")).toBe(false);
  });
  it("false when baseline is null (first generation — nothing to compare)", () => {
    expect(isVisualNoOp("abc123", null)).toBe(false);
    expect(isVisualNoOp("abc123", undefined)).toBe(false);
  });
  it("false when probe is missing", () => {
    expect(isVisualNoOp(null, "abc123")).toBe(false);
    expect(isVisualNoOp(undefined, "abc123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the decision**

Create `studio/src/components/viewport/visualNoOp.ts`:

```typescript
/**
 * Pure decision for visual-no-op detection. A "visual no-op" is when an
 * in-flight edit's render fingerprint is byte-identical to the last committed
 * (at-rest) render's fingerprint — the code changed but the pixels didn't.
 *
 * Only a candidate signal: the narration-gate + server one-shot decide whether
 * to actually retry. See the spec.
 */
export function isVisualNoOp(
  probeFp: string | null | undefined,
  baselineFp: string | null | undefined,
): boolean {
  if (!probeFp || !baselineFp) return false; // nothing to compare / first gen
  return probeFp === baselineFp;
}
```

- [ ] **Step 4: Run to verify decision passes**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing FrameCard message-handling test**

Create `studio/__tests__/components/frame-card-visual-noop.test.tsx`. Rather than render the full FrameCard (heavy, needs providers), test the extracted message-handler logic. **Extract the fingerprint-message handling into a pure helper** `handleFingerprintMessage` (Step 6) so it's testable without the component:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleFingerprintMessage } from "../../src/components/viewport/visualNoOp";

// State container mirrors the refs FrameCard holds.
function makeState() {
  return { lastCommittedFp: null as string | null };
}

describe("handleFingerprintMessage", () => {
  it("captures baseline from an at-rest fingerprint (editCycleActive=false), incl. initial n=''", () => {
    const s = makeState();
    const onNoOp = vi.fn();
    handleFingerprintMessage(
      { fp: "base1", n: "" },
      { editCycleActive: false, committedNonce: 0, reloadNonce: 0, state: s, onVisualNoOp: onNoOp, frameSlug: "f" },
    );
    expect(s.lastCommittedFp).toBe("base1");
    expect(onNoOp).not.toHaveBeenCalled();
  });

  it("on an edit-cycle probe fingerprint equal to the PRE-EXISTING baseline → fires onVisualNoOp", () => {
    const s = makeState();
    s.lastCommittedFp = "base1";
    const onNoOp = vi.fn();
    handleFingerprintMessage(
      { fp: "base1", n: "1" },
      { editCycleActive: true, committedNonce: 0, reloadNonce: 1, state: s, onVisualNoOp: onNoOp, frameSlug: "f" },
    );
    expect(onNoOp).toHaveBeenCalledWith("f");
    // MUST NOT overwrite the baseline from the probe (that's the self-poison).
    expect(s.lastCommittedFp).toBe("base1");
  });

  it("on an edit-cycle probe fingerprint that DIFFERS → no fire (a real visible edit)", () => {
    const s = makeState();
    s.lastCommittedFp = "base1";
    const onNoOp = vi.fn();
    handleFingerprintMessage(
      { fp: "changed2", n: "1" },
      { editCycleActive: true, committedNonce: 0, reloadNonce: 1, state: s, onVisualNoOp: onNoOp, frameSlug: "f" },
    );
    expect(onNoOp).not.toHaveBeenCalled();
    expect(s.lastCommittedFp).toBe("base1"); // baseline unchanged until swap
  });

  it("does NOT capture an at-rest fingerprint whose nonce doesn't match committedNonce (stale outgoing iframe)", () => {
    const s = makeState();
    s.lastCommittedFp = "base1";
    const onNoOp = vi.fn();
    handleFingerprintMessage(
      { fp: "stale9", n: "7" },
      { editCycleActive: false, committedNonce: 0, reloadNonce: 0, state: s, onVisualNoOp: onNoOp, frameSlug: "f" },
    );
    expect(s.lastCommittedFp).toBe("base1"); // unchanged — stale post ignored
  });
});
```

- [ ] **Step 6: Implement `handleFingerprintMessage` + wire FrameCard**

Add to `studio/src/components/viewport/visualNoOp.ts`:

```typescript
/** Minimal state FrameCard hands to the fingerprint handler (its refs). */
export interface FingerprintHandlerState {
  lastCommittedFp: string | null;
}

export interface FingerprintHandlerCtx {
  editCycleActive: boolean;
  committedNonce: number;
  reloadNonce: number;
  state: FingerprintHandlerState;
  onVisualNoOp?: (frameSlug: string) => void;
  frameSlug: string;
}

/**
 * Decide what a `frame-fingerprint` message means. Pure except for mutating
 * `ctx.state.lastCommittedFp` (a ref) — kept out of the component so it's
 * unit-testable.
 *
 * - At-rest (editCycleActive=false): this is a committed render (incl. the
 *   initial n="" render, whose nonce "" normalizes to committedNonce 0).
 *   Refresh the baseline — but only when the message's nonce matches the
 *   committed nonce, so a late post from a superseded iframe can't poison it.
 * - Edit-cycle (editCycleActive=true): this is the in-flight probe. Compare
 *   against the PRE-EXISTING baseline; equal → candidate. NEVER overwrite the
 *   baseline here (doing so makes the compare always equal — the self-poison).
 *   The baseline is updated from the probe elsewhere, only inside the swap.
 */
export function handleFingerprintMessage(
  msg: { fp?: unknown; n?: unknown },
  ctx: FingerprintHandlerCtx,
): void {
  const fp = typeof msg.fp === "string" ? msg.fp : null;
  if (!fp) return;
  const nonce = String(msg.n ?? "");
  if (ctx.editCycleActive) {
    if (isVisualNoOp(fp, ctx.state.lastCommittedFp)) ctx.onVisualNoOp?.(ctx.frameSlug);
    return;
  }
  // At-rest: nonce-match against committed ("" ↔ 0 normalized).
  const committed = String(ctx.committedNonce);
  const nonceMatches = nonce === committed || (nonce === "" && ctx.committedNonce === 0);
  if (nonceMatches) ctx.state.lastCommittedFp = fp;
}
```

In `FrameCard.tsx`:
1. Add the prop to the component's props type: `onVisualNoOp?: (frameSlug: string) => void;` and destructure it.
2. Add a ref near the other refs (`:74-88`): `const lastCommittedFp = useRef<string | null>(null);`
3. In the `onMsg` handler (`:158-202`), BEFORE the existing `d.type === "arcade-studio:frame-ready"` branch, handle the fingerprint. The fingerprint message is NOT subject to the existing `frame-ready` nonce/editCycle early-returns — route it first:

```typescript
      if (d.type === "arcade-studio:frame-fingerprint") {
        handleFingerprintMessage(
          { fp: (d as { fp?: unknown }).fp, n: d.n },
          {
            editCycleActive: editCycleActive.current,
            committedNonce,
            reloadNonce,
            state: { get lastCommittedFp() { return lastCommittedFp.current; }, set lastCommittedFp(v) { lastCommittedFp.current = v; } },
            onVisualNoOp,
            frameSlug: frame.slug,
          },
        );
        return;
      }
```

   (The `d.slug !== projectSlug || d.frame !== frame.slug` guard at `:164` still applies — keep the fingerprint handling AFTER that guard but BEFORE the `:165` nonce gate. The getter/setter adapter lets the pure helper mutate the ref.)
4. In the swap branch (`:180`, right after `setCommittedNonce(reloadNonce)`), promote the probe's fp to the baseline. The probe's fp arrived on the fingerprint message during the edit cycle; store the most recent edit-cycle fp in a second ref `pendingProbeFp` (set it in the `editCycleActive` branch of `handleFingerprintMessage` — add `state.pendingProbeFp = fp` there) and on swap do `lastCommittedFp.current = pendingProbeFp.current ?? lastCommittedFp.current`.

   Update `FingerprintHandlerState` to `{ lastCommittedFp: string | null; pendingProbeFp: string | null }` and set `ctx.state.pendingProbeFp = fp` at the top of the edit-cycle branch. Add the corresponding ref in FrameCard and thread it through the adapter. Update the Step-5 test's `makeState()` to include `pendingProbeFp: null` and add an assertion: after the edit-cycle call, `s.pendingProbeFp === <the probe fp>`.

- [ ] **Step 7: Run both tests**

Run: `pnpm run studio:test studio/__tests__/components/visualNoOp.test.ts studio/__tests__/components/frame-card-visual-noop.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
command git add studio/src/components/viewport/visualNoOp.ts studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/visualNoOp.test.ts studio/__tests__/components/frame-card-visual-noop.test.tsx
command git commit -m "feat(studio/viewport): FrameCard captures render fingerprint + flags visual no-op candidates"
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

Add `handleVisualNoOpRetry`, mirroring `handleStart`'s body-read + validation + the phantom-retry spawn shape (`chat.ts:984-1022`). It reads `{ slug, frame, userTurnId }`, validates, checks the one-shot guard, marks it, then runs `runClaudeTurnWithRetry` resuming `project.sessionId` with `VISUAL_NOOP_RETRY_PROMPT` — registering a turn via `startTurn` so the reconnected client stream replays it. Do NOT paint a user bubble (no prompt echoed to history as a user message). Persist a rotated session id at the end (mirror `:1072`). Full handler:

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
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  // Fire-and-forget corrective turn on the persisted session; the client
  // reconnects to the stream to read the narration. Mirror the phantom-retry
  // spawn (chat.ts phantom path) — register a turn so the stream replays it.
  let capturedSessionId = project.sessionId;
  try {
    await runClaudeTurnWithRetry({
      cwd: projectDir(slug),
      prompt: VISUAL_NOOP_RETRY_PROMPT,
      sessionId: project.sessionId,
      bin: resolveClaudeBin(),
      model: DEFAULT_MODEL, // mirror handleStart's model resolution
      onEvent: (ev) => {
        if (ev.kind === "session") capturedSessionId = ev.sessionId;
      },
    });
  } catch (err) {
    console.warn(`[studio] visual-noop retry failed for ${slug}:`, err);
  }
  if (capturedSessionId && capturedSessionId !== project.sessionId) {
    await updateProject(slug, { sessionId: capturedSessionId });
  }
}
```

**Note for the implementer:** `handleStart` runs the turn *inside* the stream response with a `startTurn`/subscriber wiring — inspect `chat.ts:260-345` and mirror its EXACT turn-registration + streaming so the corrective turn is registered under the slug (so the reconnected client stream replays it) rather than run detached. The snippet above shows intent; the real spawn must register the turn identically to `handleStart`, using the same `startTurn` + subscriber flush the existing code uses. Import `projectDir`, `resolveClaudeBin`, the model resolver, `startTurn`, `updateProject` — all already used in this file.

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
- Modify: the chat controller / `Viewport.tsx` (buffer the candidate; on clean `end` + visual claim, POST + reconnect; one-shot; drive the banner)
- Test: `studio/__tests__/components/visual-noop-banner.test.tsx`, `studio/__tests__/components/visual-noop-trigger.test.ts`

**Interfaces:**
- Consumes: `onVisualNoOp` from FrameCard (Task 3); `narrationClaimsVisualChange` (Task 4); `reconnect` (Task 4); the SSE `state.phase` + summary line.
- Produces: `VisualNoOpBanner` component + `VISUAL_NOOP_SENTINEL` + `splitVisualNoOpTrailer(content)`; a pure trigger decision `shouldTriggerVisualNoOpRetry(...)`.

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
```

Wire the controller (the component that owns `useChatStream` + renders `FrameCard`s — `Viewport.tsx` / the chat context). Add:
1. A per-turn candidate buffer: `const noOpCandidate = useRef<string | null>(null)` (holds the frame slug). `onVisualNoOp={(slug) => { noOpCandidate.current = slug; }}` passed to each `FrameCard`.
2. A per-turn one-shot ref: `const triggeredThisTurn = useRef(false)`. Reset it to `false` inside `send()` (a new USER turn) — do this where the user prompt is submitted, NOT on every `end`.
3. Track the originating user turn id: capture the turn id from the SSE `turn` header (`state` exposes it, or read from the turn event); pass it as `userTurnId` to the POST.
4. An effect keyed on `state.phase`: when it transitions to `"done"`, compute `summaryClaimsVisual = narrationClaimsVisualChange(firstSummaryLine(state.narrations))` and `shouldTriggerVisualNoOpRetry({ candidateBuffered: noOpCandidate.current != null, phase: state.phase, summaryClaimsVisual, alreadyTriggeredThisTurn: triggeredThisTurn.current })`. If true: `triggeredThisTurn.current = true`, `POST /api/chat/visual-noop-retry {slug, frame: noOpCandidate.current, userTurnId}`, then `reconnect()`. Clear `noOpCandidate.current = null`.
5. `firstSummaryLine(narrations: string[])`: join, take the first non-`→`-prefixed line before `### Deviations` (the response-shape summary). Add it as a small exported helper in `visualNoOp.ts` and unit-test it (summary extraction: strips journey `→ ` lines, stops at `### Deviations`).
6. The banner: after the CORRECTIVE turn ends, if the frame is STILL a no-op candidate (a second `onVisualNoOp` fired for it during the corrective turn's render) AND `triggeredThisTurn.current` is already true → the persisted assistant message for the corrective turn gets the `VISUAL_NOOP_SENTINEL` trailer (append server-side in `handleVisualNoOpRetry`'s narration, mirroring how `NO_CHANGES_TRAILER` is appended), and `MessageList`/the message renderer splits on `VISUAL_NOOP_SENTINEL` and renders `<VisualNoOpBanner/>` (mirror the existing `splitNoChangesTrailer` + `NoFrameChangesBanner` render site). Treat the corrective turn's `end` as banner-only — do NOT re-run the trigger for it (the `triggeredThisTurn` guard already blocks a second POST).

   **Implementer:** find the render site that uses `splitNoChangesTrailer`/`NoFrameChangesBanner` (`command grep -rn "NoFrameChangesBanner\|splitNoChangesTrailer" studio/src`) and add the sibling split+render for the visual-no-op sentinel right beside it. Append the trailer in `handleVisualNoOpRetry` only when the corrective produced no further edit (or unconditionally as the honest "still nothing moved" note — decide based on whether the corrective wrote a file; simplest correct v1: append it when the agent's corrective reply itself claims a visual change again, matching the same gate).

- [ ] **Step 6: Run the client tests**

Run: `pnpm run studio:test studio/__tests__/components/visual-noop-banner.test.tsx studio/__tests__/components/visual-noop-trigger.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
command git add studio/src/components/chat/VisualNoOpBanner.tsx studio/src/components/viewport/visualNoOp.ts studio/src/components/viewport/Viewport.tsx studio/__tests__/components/visual-noop-banner.test.tsx studio/__tests__/components/visual-noop-trigger.test.ts
# plus the message-render site file touched in Step 5.6
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

## Self-review notes (author)

- **Spec coverage:** Piece 1 (fingerprint) = Task 1; Piece 1 emit = Task 2; Piece 2 (compare) = Task 3; Piece 3 (corrective route + policy + gate + reconnect) = Task 4; Piece 3 client trigger + Piece 4 banner = Task 5; suite = Task 6; manual gate = Task 7.
- **The rev-2/rev-3 review fixes are all in tasks:** self-poison → Task 3 (baseline captured at-rest only, compare against pre-existing, `frame-card-visual-noop.test.tsx` asserts a real-change edit does NOT fire + baseline not overwritten by probe); `document.body` + status-overlay exclusion → Task 1 (`productionMeasure`) + Task 1 test (null-skip); no textContent → Task 1 test (different text → same hash); separate `frame-fingerprint` message + `document.fonts.ready` → Task 2 + its test; export `reconnect` → Task 4 Step 7; narration-gate on summary, biased to fire → Task 4 (`narrationClaimsVisualChange` + tests both directions); fire only on `phase==="done"` → Task 5 (`shouldTriggerVisualNoOpRetry` test); one-shot on user-turn lineage → Task 4 guard (`markVisualNoOpRetryRan`) + Task 5 client `triggeredThisTurn` reset only on `send()`.
- **Type consistency:** `computeFingerprint(root, measure)` / `MeasureFn`/`Measured`/`PAINT_PROPS` (Task 1) → consumed by `productionMeasure` (Task 1) + Task 2 emit. `isVisualNoOp(probeFp, baselineFp)` + `handleFingerprintMessage` + `FingerprintHandlerState{lastCommittedFp,pendingProbeFp}` + `shouldTriggerVisualNoOpRetry` (Task 3/5) all in `visualNoOp.ts`. `narrationClaimsVisualChange`/`shouldRunVisualNoOpRetry`/`VISUAL_NOOP_RETRY_PROMPT`/`markVisualNoOpRetryRan`/`visualNoOpRetryAlreadyRan` (Task 4) in `visualNoOpRetry.ts`. `VISUAL_NOOP_SENTINEL`/`splitVisualNoOpTrailer`/`VisualNoOpBanner` (Task 5) in `VisualNoOpBanner.tsx`. Message type string `arcade-studio:frame-fingerprint` consistent Task 2 emit ↔ Task 3 handle.
- **Known implementer judgment calls (flagged, not placeholders):** Task 4 Step 6 — the corrective turn must be registered/streamed EXACTLY like `handleStart` (mirror `chat.ts:260-345`); Task 5 Step 5.6 — the exact banner-trailer append condition + the message render-site edit. Both are "mirror the existing sibling" instructions with the sibling named, not open-ended TODOs.
