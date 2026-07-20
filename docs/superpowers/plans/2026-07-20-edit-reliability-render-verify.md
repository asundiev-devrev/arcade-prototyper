# Edit Reliability — Render-Verify (Rendered-Fact Feedback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user asked for a visual property (e.g. "make the toggle groups vertical") but the frame renders otherwise — even on a turn where the agent made no edit and claimed success — detect it by comparing the USER'S ask against the frame's ACTUAL computed styles, fire one corrective turn, then a soft banner.

**Architecture:** The frame pushes a render digest (candidate elements + their computed styles, incl. the `data-orientation` carrier's real `flexDirection`) once per mount, on the same effect that already pushes `frame-fingerprint`. FrameCard buffers the latest digest in a TURN-PERSISTENT ref and forwards it up (like `onVisualNoOp`). On turn-end, the shell extracts the requested property from the ORIGINATING user prompt (captured at turn start, never the corrective-overwritten `lastPrompt`), reconciles it against the buffered digest (mismatch only when ALL candidates unanimously contradict), and on a mismatch POSTs a dedicated corrective route (own state, own one-shot — NOT a rewrite of VN) + reconnects; a shared single-fire guard keeps VN and render-verify to one corrective per turn. Still-mismatched after the corrective → a soft client-observed banner.

**Tech Stack:** TypeScript, React (frame iframe + shell), Vite middleware (Node ESM server), Vitest + jsdom. No new deps. Builds on the shipped VN feature (renderFingerprint.ts `productionMeasure`/`PAINT_PROPS`, FrameCard fingerprint fold, visualNoOpRetry.ts, useProjectFromHost turn-end effect).

## Global Constraints

- Package manager **pnpm**. Focused tests: `pnpm run studio:test <path>` from repo root `/Users/andrey.sundiev/arcade-prototyper`. Full suite `pnpm run studio:test` (~90s; `chat-figma-context.test.ts` is a KNOWN contention flake; `[ERROR]` lines are intentional esbuild fixtures; clear ports 9223-9232 if bridge tests flake).
- **`command git` for ALL git** (bare git intercepted by an rtk hook). Prefix any intercepted `grep`/`node` with `command`.
- **NO `@xorkavi/arcade-gen` changes.** The swallowed `orientation` prop is a real kit gap tracked separately; this feature closes the CLASS studio-side regardless.
- **The cardinal sin is a FALSE mismatch** (claiming "the render is wrong" over a correct render). Reconcile fires ONLY on a unanimous, clear contradiction; any ambiguity → silence. A MISSED verify is acceptable; a false one is not.
- **Verify against the USER'S ORIGINATING prompt**, never the agent's summary and never the live `state.lastPrompt` (the corrective turn's header overwrites it — `useChatStream.ts:204`).
- **The digest buffer MUST be turn-persistent** (never cleared on a turn/frame-changed transition) — model on `fpTracker` (`FrameCard.tsx:96`, survives turns), NOT `noOpCandidate` (wiped per turn). Else the no-edit turn has nothing to compare and the feature self-defeats. This is the crux.
- **Do NOT modify VN's `handleVisualNoOpRetry` / `visualNoOpRetry.ts` one-shot / VN banner state.** Render-verify is parallel (own route, own state, own one-shot, own turn-end effect, own corrective flag); the ONLY shared thing is VN's existing `handledTurn` ref as a one-corrective-per-turn guard (VN's effect declared first → priority). VN is shipped-but-ungated — keep its tests green.
- **Reconcile compares COMPUTED `flexDirection`** (e.g. `row`), NOT the `data-orientation` attribute (which lies — says "vertical" on a swallowed prop). Candidates are IDENTIFIED by the attribute, JUDGED by the computed style.
- Spec: `docs/superpowers/specs/2026-07-20-edit-reliability-render-verify-rendered-fact-design.md` (rev-3).

## File structure

| File | Responsibility |
|---|---|
| `studio/src/frame/frameDigest.ts` (NEW) | Pure `digestElements(root, measure, cap)` → candidate elements + computed styles + identity attrs. The digest algorithm. |
| `studio/server/plugins/frameMountPlugin.ts` (MODIFY the fingerprint effect) | Also push `frame-digest` from the same fonts+rAF effect. |
| `studio/src/components/viewport/FrameCard.tsx` (MODIFY `onMsg` + props) | Fold `frame-digest` into a turn-persistent ref; forward via `onRenderDigest`. |
| `studio/server/renderVerify.ts` (NEW) | Pure `extractRequestedProperties`, `reconcile`, `RENDER_VERIFY_RETRY_PROMPT`, own one-shot Set. |
| `studio/server/middleware/chat.ts` (NEW route) | `POST /api/chat/render-verify-retry` — own route, own one-shot, `runClaudeBranch`. |
| `studio/src/hooks/useProjectFromHost.ts` (MODIFY) | Buffer digests; capture originating prompt; turn-end reconcile; shared one-fire guard; render-verify banner state. |
| `studio/src/components/viewport/Viewport.tsx` + `studio/src/routes/ProjectDetail.tsx` (MODIFY) | Thread `onRenderDigest` down; render `RenderMismatchBanner`. |
| `studio/src/components/chat/RenderMismatchBanner.tsx` (NEW) | Soft banner, own sentinel/state. |

---

## Task 1: frameDigest — the pure digest

**Files:**
- Create: `studio/src/frame/frameDigest.ts`
- Test: `studio/__tests__/frame/frameDigest.test.ts`

**Interfaces:**
- Consumes: `Measured`, `MeasureFn`, `productionMeasure`, `PAINT_PROPS` from `studio/src/frame/renderFingerprint.ts` (shipped).
- Produces:
  - `type DigestElement = { tag: string; dataOrientation: string | null; role: string | null; styles: Record<string, string> }`
  - `type RenderDigest = { elements: DigestElement[]; truncated: boolean }`
  - `digestElements(root: Element, measure: MeasureFn, cap?: number): RenderDigest` — walks candidates in DOM order, capped, capturing identity attrs + the `PAINT_PROPS` styles from `measure`.
  - `DIGEST_ELEMENT_CAP = 200` (default cap).
  - `isDigestCandidate(el: Element): boolean` — an element worth measuring: carries `data-orientation`, OR its tag is in a small allowlist (`button`, `input`, `select`, `a`, `h1`-`h6`, `p`, `span`, `div` with a `role`), so color/size claims have subjects. Keep it broad-but-capped; the reconcile step, not the digest, decides relevance.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/frameDigest.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { digestElements, isDigestCandidate, DIGEST_ELEMENT_CAP } from "../../src/frame/frameDigest";
import type { MeasureFn, Measured } from "../../src/frame/renderFingerprint";
import { PAINT_PROPS } from "../../src/frame/renderFingerprint";

// Synthetic measure: styles come from a data-styles JSON attr, else defaults.
// (jsdom returns zero rects + stub styles, so injected measure is the only way
// to test discrimination — same pattern as renderFingerprint.test.ts.)
function fakeMeasure(styleById: Record<string, Record<string, string>> = {}): MeasureFn {
  return (el: Element): Measured | null => {
    const id = el.getAttribute("data-id") ?? el.tagName.toLowerCase();
    const style: Record<string, string> = {};
    for (const p of PAINT_PROPS) style[p] = styleById[id]?.[p] ?? "x";
    return { tag: el.tagName.toLowerCase(), rect: { x: 0, y: 0, w: 10, h: 10 }, style };
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("isDigestCandidate", () => {
  it("includes a data-orientation carrier", () => {
    const el = mount(`<div data-orientation="vertical"></div>`).firstElementChild!;
    expect(isDigestCandidate(el)).toBe(true);
  });
  it("includes a button", () => {
    expect(isDigestCandidate(mount(`<button></button>`).firstElementChild!)).toBe(true);
  });
  it("excludes a bare wrapper div with no role", () => {
    expect(isDigestCandidate(mount(`<div></div>`).firstElementChild!)).toBe(false);
  });
});

describe("digestElements", () => {
  it("captures the data-orientation attr AND the computed flexDirection (they can disagree — the swallow)", () => {
    const root = mount(`<div data-orientation="vertical" data-id="tg"></div>`);
    const d = digestElements(root, fakeMeasure({ tg: { flexDirection: "row" } }));
    const carrier = d.elements.find((e) => e.dataOrientation === "vertical");
    expect(carrier).toBeTruthy();
    expect(carrier!.styles.flexDirection).toBe("row"); // says vertical, IS row
  });

  it("captures role", () => {
    const root = mount(`<div role="tablist" data-id="t"></div>`);
    const d = digestElements(root, fakeMeasure());
    // a div with a role is a candidate
    expect(d.elements.some((e) => e.role === "tablist")).toBe(true);
  });

  it("skips non-candidate wrappers but recurses into them", () => {
    const root = mount(`<div><div data-orientation="horizontal" data-id="tg"></div></div>`);
    const d = digestElements(root, fakeMeasure());
    expect(d.elements.some((e) => e.dataOrientation === "horizontal")).toBe(true);
    // the bare outer wrapper is not itself a measured element
    expect(d.elements.every((e) => e.dataOrientation !== null || e.role !== null || e.tag !== "div")).toBe(true);
  });

  it("caps the element count and flags truncated", () => {
    const many = Array.from({ length: DIGEST_ELEMENT_CAP + 10 }, () => `<button></button>`).join("");
    const d = digestElements(mount(many), fakeMeasure(), DIGEST_ELEMENT_CAP);
    expect(d.elements.length).toBe(DIGEST_ELEMENT_CAP);
    expect(d.truncated).toBe(true);
  });

  it("returns [] on an empty root", () => {
    expect(digestElements(mount(``), fakeMeasure()).elements).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/frame/frameDigest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `studio/src/frame/frameDigest.ts`:

```typescript
/**
 * Render digest — the candidate elements of a frame + their COMPUTED styles and
 * identity attributes. Consumed by render-verify: the shell reconciles the
 * user's requested property (e.g. orientation:vertical) against these real
 * computed values. See the spec:
 * docs/superpowers/specs/2026-07-20-edit-reliability-render-verify-rendered-fact-design.md
 *
 * KEY: it captures BOTH the `data-orientation` attribute (identity — how the
 * element ADVERTISES itself) and the computed `flexDirection` (the truth — how
 * it actually lays out). On a swallowed prop these DISAGREE (`data-orientation
 * ="vertical"` but `flex-direction: row`); reconcile compares the COMPUTED
 * value, so the swallow is caught.
 *
 * `measure` is injected (same as renderFingerprint) so discrimination is
 * unit-testable without a real browser. Production passes `productionMeasure`,
 * which reads the same PAINT_PROPS incl. flexDirection.
 */
import type { MeasureFn } from "./renderFingerprint";

export type DigestElement = {
  tag: string;
  dataOrientation: string | null;
  role: string | null;
  styles: Record<string, string>;
};

export type RenderDigest = { elements: DigestElement[]; truncated: boolean };

export const DIGEST_ELEMENT_CAP = 200;

const TAG_ALLOWLIST = new Set([
  "button", "input", "select", "textarea", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span",
]);

/** An element worth measuring. Broad but bounded — reconcile decides relevance.
 *  A carrier of data-orientation is always in (the orientation claim's subject);
 *  an allowlisted tag or any element with an explicit role is in (color/size). */
export function isDigestCandidate(el: Element): boolean {
  if (el.hasAttribute("data-orientation")) return true;
  if (el.getAttribute("role")) return true;
  return TAG_ALLOWLIST.has(el.tagName.toLowerCase());
}

/** Walk `root` in DOM order; measure each candidate; cap the count. Recurses
 *  into non-candidates (a bare wrapper isn't measured but its children are). */
export function digestElements(
  root: Element,
  measure: MeasureFn,
  cap: number = DIGEST_ELEMENT_CAP,
): RenderDigest {
  const elements: DigestElement[] = [];
  let truncated = false;
  const walk = (el: Element): void => {
    if (elements.length >= cap) { truncated = true; return; }
    if (isDigestCandidate(el)) {
      const m = measure(el);
      if (m) {
        elements.push({
          tag: m.tag,
          dataOrientation: el.getAttribute("data-orientation"),
          role: el.getAttribute("role"),
          styles: m.style,
        });
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      if (elements.length >= cap) { truncated = true; break; }
      walk(el.children[i]);
    }
  };
  walk(root);
  return { elements, truncated };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/frame/frameDigest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/src/frame/frameDigest.ts studio/__tests__/frame/frameDigest.test.ts
command git commit -m "feat(studio/frame): frameDigest — candidate elements + computed styles for render-verify"
```

---

## Task 2: frame pushes `frame-digest`

**Files:**
- Modify: `studio/server/plugins/frameMountPlugin.ts` (the `ArcadeFrameFingerprint` effect, ~`:345-362`)
- Test: `studio/__tests__/server/frame-digest-bootstrap.test.ts` (NEW — substring assertions on the bootstrap, mirroring `frame-fingerprint-bootstrap.test.ts`)

**Interfaces:**
- Consumes: `digestElements`, `productionMeasure`.
- Produces: each mount posts, alongside `frame-fingerprint`, a `{ type: "arcade-studio:frame-digest", slug, frame, n, digest }` message where `digest` is the `RenderDigest`.

**Context:** The fingerprint effect (`buildFrameBootstrapSource`, `frameMountPlugin.ts:345`) is a `useEffect(…, [])` that awaits `document.fonts.ready` + double-rAF then posts `frame-fingerprint`. Fold the digest post into the SAME `post()` (one wait, one traversal — the digest walks `document.body` just like the fingerprint). Import `digestElements` beside the existing `computeFingerprint` import.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/frame-digest-bootstrap.test.ts`:

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

describe("frame bootstrap digest emit", () => {
  it("imports digestElements", () => {
    expect(src).toMatch(/digestElements/);
  });
  it("posts a frame-digest message", () => {
    expect(src).toContain("arcade-studio:frame-digest");
  });
  it("computes the digest over document.body", () => {
    expect(src).toMatch(/digestElements\(\s*document\.body/);
  });
  it("still posts frame-fingerprint (unchanged)", () => {
    expect(src).toContain("arcade-studio:frame-fingerprint");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/frame-digest-bootstrap.test.ts`
Expected: FAIL — digest strings absent.

- [ ] **Step 3: Implement**

In `frameMountPlugin.ts`: add to the fingerprint imports line (near `computeFingerprint, productionMeasure`):
```javascript
    import { digestElements } from "arcade-studio/frame/frameDigest";
```
Then in the `ArcadeFrameFingerprint` effect's `post()` (after the existing `frame-fingerprint` post, inside the same `try`):
```javascript
            const digest = digestElements(document.body, productionMeasure);
            window.parent && window.parent.postMessage(
              { type: "arcade-studio:frame-digest", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N, digest: digest }, "*");
```
(Keep it inside the existing `try { … } catch(_) {}` so a digest failure never breaks the frame, exactly like the fingerprint.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/frame-digest-bootstrap.test.ts`
Expected: PASS. Also run the existing frameMount tests: `pnpm run studio:test studio/__tests__/server/frame-fingerprint-bootstrap.test.ts` — still green.

- [ ] **Step 5: Commit**

```bash
command git add studio/server/plugins/frameMountPlugin.ts studio/__tests__/server/frame-digest-bootstrap.test.ts
command git commit -m "feat(studio/frame): push frame-digest alongside frame-fingerprint (once per mount)"
```

---

## Task 3: FrameCard buffers the digest (TURN-PERSISTENT) + forwards up

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx` (add `onRenderDigest?` prop + a turn-persistent ref + a `frame-digest` branch in `onMsg`)
- Test: `studio/__tests__/components/frame-card-digest.test.ts` (NEW — pure handler test, mirroring the VN approach)

**Interfaces:**
- Consumes: `RenderDigest` from `frameDigest.ts`.
- Produces: `FrameCard` new optional prop `onRenderDigest?: (frameSlug: string, digest: RenderDigest) => void`, called whenever a `frame-digest` for THIS frame arrives.

**Context:** FrameCard's `onMsg` (`:174-199`) already folds `frame-fingerprint` with a `liveNonce` guard and calls `onVisualNoOpRef.current?.(...)`. Mirror it EXACTLY for `frame-digest`: same slug/frame guard, same `liveNonce` gate (drop stale outgoing-iframe posts), forward via a ref-read callback (so it isn't in the effect dep array → no listener churn — the pattern the VN review established). The buffering itself lives in the SHELL (Task 5), so FrameCard just forwards; but the forward must fire for the mount-time digest, which is the only one on a no-edit turn.

- [ ] **Step 1: Write the failing test**

The forward logic is a one-liner inside `onMsg`; test it via a small extracted pure helper `handleDigestMessage` in `frameDigest.ts` (keeps FrameCard thin + testable without rendering the component):

Add to `studio/__tests__/frame/frameDigest.test.ts` (same file as Task 1, or a new `frame-card-digest.test.ts` — use the new file):

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { handleDigestMessage } from "../../src/frame/frameDigest";

describe("handleDigestMessage", () => {
  const digest = { elements: [], truncated: false };
  it("forwards a live-nonce digest for this frame", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "0", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).toHaveBeenCalledWith("f", digest);
  });
  it("ignores a different frame", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "other", n: "0", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).not.toHaveBeenCalled();
  });
  it("ignores a stale (non-live) nonce", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "9", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 1, onRenderDigest: cb },
    );
    expect(cb).not.toHaveBeenCalled();
  });
  it("accepts the initial n='' render (0↔'' normalization)", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).toHaveBeenCalledWith("f", digest);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/frame/frame-card-digest.test.ts`
Expected: FAIL — `handleDigestMessage` not exported.

- [ ] **Step 3: Implement the helper + wire FrameCard**

Add to `studio/src/frame/frameDigest.ts`:
```typescript
export interface DigestMessageCtx {
  projectSlug: string;
  frameSlug: string;
  committedNonce: number;
  reloadNonce: number;
  onRenderDigest?: (frameSlug: string, digest: RenderDigest) => void;
}

/** Fold a `frame-digest` message: forward it for THIS frame only, and only from
 *  a LIVE iframe (committed or in-flight nonce, 0↔"" normalized) — a stale
 *  outgoing-iframe post is dropped, same guard as the fingerprint fold. */
export function handleDigestMessage(
  msg: { type?: string; slug?: string; frame?: string; n?: unknown; digest?: unknown },
  ctx: DigestMessageCtx,
): void {
  if (msg.type !== "arcade-studio:frame-digest") return;
  if (msg.slug !== ctx.projectSlug || msg.frame !== ctx.frameSlug) return;
  const n = String(msg.n ?? "");
  const liveNonce =
    n === String(ctx.committedNonce) ||
    n === String(ctx.reloadNonce) ||
    (n === "" && (ctx.committedNonce === 0 || ctx.reloadNonce === 0));
  if (!liveNonce) return;
  const digest = msg.digest as RenderDigest | undefined;
  if (digest && Array.isArray(digest.elements)) ctx.onRenderDigest?.(ctx.frameSlug, digest);
}
```

In `FrameCard.tsx`:
1. Import: `import { handleDigestMessage, type RenderDigest } from "../../frame/frameDigest";`
2. Add the prop to the component's props type: `onRenderDigest?: (frameSlug: string, digest: RenderDigest) => void;`, destructure it.
3. Add a ref (so it's not in the effect deps — mirror `onVisualNoOpRef`, `:97-99`): `const onRenderDigestRef = useRef(onRenderDigest); onRenderDigestRef.current = onRenderDigest;`
4. In `onMsg`, right after the `frame-fingerprint` branch's closing `}` (after `:199`, still before the `:200` nonce gate), add:
```typescript
      if (d.type === "arcade-studio:frame-digest") {
        handleDigestMessage(d as Parameters<typeof handleDigestMessage>[0], {
          projectSlug,
          frameSlug: frame.slug,
          committedNonce,
          reloadNonce,
          onRenderDigest: onRenderDigestRef.current,
        });
        return;
      }
```
(No effect-dep change — `onRenderDigest` is read via the ref, like `onVisualNoOp`. `committedNonce`/`reloadNonce`/`projectSlug`/`frame.slug` are already in the effect deps.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/frame/frame-card-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/src/frame/frameDigest.ts studio/src/components/viewport/FrameCard.tsx studio/__tests__/frame/frame-card-digest.test.ts
command git commit -m "feat(studio/viewport): FrameCard forwards frame-digest (live-nonce gated) via onRenderDigest"
```

---

## Task 4: renderVerify — extract, reconcile, prompt, one-shot

**Files:**
- Create: `studio/server/renderVerify.ts`
- Test: `studio/__tests__/server/renderVerify.test.ts`

**Interfaces:**
- Consumes: `RenderDigest`/`DigestElement` (import the TYPE from `../src/frame/frameDigest` — a type-only import is fine server-side).
- Produces:
  - `type RequestedProperty = { property: "orientation"; expected: "vertical" | "horizontal" }` (v1: orientation only — the repro + the highest-value swallow; color/size are extension rows, out of v1 to keep the false-mismatch surface tiny).
  - `extractRequestedProperties(prompt: string): RequestedProperty[]`
  - `reconcile(requested: RequestedProperty[], digest: RenderDigest): Mismatch[]` where `Mismatch = { property: string; expected: string; rendered: string }`.
  - `RENDER_VERIFY_RETRY_PROMPT(mismatch: Mismatch): string`
  - `renderVerifyAlreadyRan(userTurnId: string): boolean`, `markRenderVerifyRan(userTurnId: string): void` (module-level Set — own, NOT VN's).

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/renderVerify.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extractRequestedProperties,
  reconcile,
  RENDER_VERIFY_RETRY_PROMPT,
  renderVerifyAlreadyRan,
  markRenderVerifyRan,
} from "../../server/renderVerify";

const carrier = (flexDirection: string, dataOrientation = "vertical") => ({
  tag: "div", dataOrientation, role: null,
  styles: { flexDirection, color: "x", backgroundColor: "x" },
});

describe("extractRequestedProperties (from the USER prompt)", () => {
  it("maps 'make the toggle groups vertical' → orientation vertical", () => {
    expect(extractRequestedProperties("make the toggle groups vertical")).toEqual([
      { property: "orientation", expected: "vertical" },
    ]);
  });
  it("maps 'stack them' / 'in a column' → vertical", () => {
    expect(extractRequestedProperties("can you stack them")[0]?.expected).toBe("vertical");
    expect(extractRequestedProperties("put them in a column")[0]?.expected).toBe("vertical");
  });
  it("maps 'side by side' / 'horizontal' → horizontal", () => {
    expect(extractRequestedProperties("lay them out horizontally")[0]?.expected).toBe("horizontal");
    expect(extractRequestedProperties("put them side by side")[0]?.expected).toBe("horizontal");
  });
  it("extracts NOTHING from a non-visual / ambiguous prompt (bias to silence)", () => {
    expect(extractRequestedProperties("clean this up")).toEqual([]);
    expect(extractRequestedProperties("make it nicer")).toEqual([]);
    expect(extractRequestedProperties("wire the button to open the modal")).toEqual([]);
  });
  // FALSE-FIRE guards (the cardinal sin) — the orientation word is present but
  // NOT a layout directive. Must extract NOTHING.
  it("does NOT extract when the orientation word is an adjective on a noun ('the vertical scrollbar')", () => {
    expect(extractRequestedProperties("make the vertical scrollbar bigger")).toEqual([]);
    expect(extractRequestedProperties("hide the horizontal divider")).toEqual([]);
  });
  it("does NOT extract under negation ('don't make it vertical')", () => {
    expect(extractRequestedProperties("don't make it vertical")).toEqual([]);
    expect(extractRequestedProperties("do not stack them")).toEqual([]);
    expect(extractRequestedProperties("keep it from being vertical")).toEqual([]);
  });
});

describe("reconcile (UNANIMOUS contradiction only — compares COMPUTED flexDirection)", () => {
  const wantVertical: any = [{ property: "orientation", expected: "vertical" }];
  it("ALL carriers render row vs vertical → mismatch (the repro)", () => {
    const digest = { elements: [carrier("row"), carrier("row")], truncated: false };
    expect(reconcile(wantVertical, digest).length).toBe(1);
  });
  it("ALL carriers render column vs vertical → no mismatch", () => {
    const digest = { elements: [carrier("column"), carrier("column")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("MIXED (one row, one column) → NO mismatch (never false-fire on a mixed page)", () => {
    const digest = { elements: [carrier("row"), carrier("column")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("ZERO carriers → no mismatch (nothing to judge)", () => {
    const digest = { elements: [{ tag: "button", dataOrientation: null, role: null, styles: { flexDirection: "row" } }], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
  it("compares COMPUTED, not the attribute: data-orientation='vertical' but flex row → mismatch", () => {
    const digest = { elements: [carrier("row", "vertical")], truncated: false };
    expect(reconcile(wantVertical, digest).length).toBe(1);
  });
  it("ambiguous computed direction (neither row nor column) → no mismatch", () => {
    const digest = { elements: [carrier("")], truncated: false };
    expect(reconcile(wantVertical, digest)).toEqual([]);
  });
});

describe("one-shot (own Set, per user-turn)", () => {
  it("reports run after marking", () => {
    expect(renderVerifyAlreadyRan("rv-1")).toBe(false);
    markRenderVerifyRan("rv-1");
    expect(renderVerifyAlreadyRan("rv-1")).toBe(true);
    expect(renderVerifyAlreadyRan("rv-2")).toBe(false);
  });
});

describe("RENDER_VERIFY_RETRY_PROMPT", () => {
  it("names the mismatch + tells the agent it can be satisfied or reported", () => {
    const p = RENDER_VERIFY_RETRY_PROMPT({ property: "orientation", expected: "vertical", rendered: "horizontal" });
    expect(p).toMatch(/vertical/i);
    expect(p).toMatch(/horizontal|renders/i);
    expect(p).toMatch(/flex-col|stacked|tell the user|couldn't/i);
    expect(p).toMatch(/never (report|claim)/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/renderVerify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `studio/server/renderVerify.ts`:

```typescript
/**
 * Render-verify policy: extract the visual property the USER asked for (from
 * their prompt), reconcile it against the frame's real computed styles (a
 * digest), and — on a UNANIMOUS clear contradiction — produce a corrective
 * prompt. Pure; mirrors visualNoOpRetry.ts. See the spec.
 *
 * v1 covers ORIENTATION only (the repro + the highest-value swallow). Colour /
 * size are extension rows, deliberately deferred to keep the false-mismatch
 * surface tiny — a false "this is wrong" over a correct render is the cardinal
 * sin, so reconcile fires only when EVERY candidate contradicts the ask.
 */
import type { RenderDigest } from "../src/frame/frameDigest";

export type RequestedProperty = { property: "orientation"; expected: "vertical" | "horizontal" };
export type Mismatch = { property: string; expected: string; rendered: string };

// The orientation words. `directive` forms (a verb phrase — "stack them", "in a
// column") are unambiguous layout asks. `bare` forms (the adjective "vertical"/
// "horizontal") need false-fire guards below because they also appear as
// adjectives on a noun ("the vertical scrollbar") or under negation.
const VERTICAL_DIRECTIVE = /\b(stacked?|stack them|in a column|as a column|column layout)\b/i;
const HORIZONTAL_DIRECTIVE = /\b(side by side|side-by-side|in a row|as a row|row layout)\b/i;
const VERTICAL_BARE = /\b(vertical|vertically)\b/i;
const HORIZONTAL_BARE = /\b(horizontal|horizontally)\b/i;
// A bare orientation word is NOT a directive when negated before it, or when it
// adjectivally qualifies a following concrete noun ("vertical scrollbar/divider
// /line/rule/scroll"). Either → drop the extraction (cardinal-sin bias).
const NEGATION = /\b(don'?t|do not|not|never|avoid|without|keep (it|them) from|stop)\b/i;
const ADJECTIVE_NOUN = /\b(vertical|horizontal)\s+(scroll\w*|divider|separator|line|rule|bar|axis|gridlines?)\b/i;

/** Extract requested visual properties from the USER'S prompt. v1: orientation.
 *  Conservative — no match / both match / negated / adjectival → nothing (bias
 *  to silence: a false "this is wrong" over a correct render is the cardinal sin). */
export function extractRequestedProperties(prompt: string): RequestedProperty[] {
  const p = prompt ?? "";
  // A directive form is trusted (unambiguous layout ask). A bare adjective is
  // trusted ONLY if it's not negated and not qualifying a concrete noun.
  const bareSafe = !NEGATION.test(p) && !ADJECTIVE_NOUN.test(p);
  const v = VERTICAL_DIRECTIVE.test(p) || (bareSafe && VERTICAL_BARE.test(p));
  const h = HORIZONTAL_DIRECTIVE.test(p) || (bareSafe && HORIZONTAL_BARE.test(p));
  if (v === h) return []; // neither, or both (ambiguous) → no claim
  return [{ property: "orientation", expected: v ? "vertical" : "horizontal" }];
}

/** Normalize a computed flex-direction to "vertical" | "horizontal" | null. */
function directionOf(styles: Record<string, string>): "vertical" | "horizontal" | null {
  const fd = (styles.flexDirection ?? "").trim().toLowerCase();
  if (fd === "column" || fd === "column-reverse") return "vertical";
  if (fd === "row" || fd === "row-reverse") return "horizontal";
  return null; // ambiguous / unmeasured → judged as no-contradiction
}

/**
 * Reconcile requested properties against the digest. Returns a mismatch ONLY
 * when there is ≥1 relevant candidate AND every relevant candidate CLEARLY
 * contradicts the ask. Any ambiguity → no mismatch (cardinal-sin bias).
 */
export function reconcile(requested: RequestedProperty[], digest: RenderDigest): Mismatch[] {
  const out: Mismatch[] = [];
  for (const req of requested) {
    if (req.property !== "orientation") continue;
    // Candidates for an orientation claim: the data-orientation carriers.
    const carriers = digest.elements.filter((e) => e.dataOrientation !== null);
    if (carriers.length === 0) continue; // nothing to judge
    const directions = carriers.map((c) => directionOf(c.styles));
    // Unanimous clear contradiction: every carrier resolves to a direction AND
    // it's the opposite of what was asked. A single ambiguous/agreeing carrier
    // aborts the mismatch (err toward silence).
    const allContradict =
      directions.every((d) => d !== null) &&
      directions.every((d) => d !== req.expected);
    if (allContradict) {
      out.push({
        property: "orientation",
        expected: req.expected,
        rendered: req.expected === "vertical" ? "horizontal" : "vertical",
      });
    }
  }
  return out;
}

export function RENDER_VERIFY_RETRY_PROMPT(m: Mismatch): string {
  if (m.property === "orientation") {
    return (
      `The user asked for the toggle groups to be ${m.expected}, but they render ${m.rendered} — ` +
      `the control's direction computes to the opposite and the \`orientation\` prop isn't changing the layout. ` +
      `Make it actually render ${m.expected} (e.g. pass \`className="flex-col"\` to the control itself for vertical, ` +
      `or rebuild it as stacked rows), or tell the user plainly that this control renders ${m.rendered} and you ` +
      `couldn't change it. Never report a visual result the render doesn't show. ` +
      `Keep the response shape: a one-sentence summary plus a ### Deviations section.`
    );
  }
  return (
    `The user's requested change (${m.property}: ${m.expected}) is not reflected in the render (${m.rendered}). ` +
    `Achieve it a different way so it actually renders, or say plainly you couldn't. Never report a visual result the render doesn't show.`
  );
}

const ranForTurn = new Set<string>();
export function renderVerifyAlreadyRan(userTurnId: string): boolean {
  return ranForTurn.has(userTurnId);
}
export function markRenderVerifyRan(userTurnId: string): void {
  ranForTurn.add(userTurnId);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/renderVerify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/server/renderVerify.ts studio/__tests__/server/renderVerify.test.ts
command git commit -m "feat(studio/server): renderVerify — extract requested orientation, reconcile vs computed flexDirection (unanimous)"
```

---

## Task 5: server route `POST /api/chat/render-verify-retry`

**Files:**
- Modify: `studio/server/middleware/chat.ts` (dispatch + new `handleRenderVerifyRetry`)
- Test: `studio/__tests__/server/chat-render-verify-route.test.ts` (NEW)

**Interfaces:**
- Consumes: `renderVerifyAlreadyRan`, `markRenderVerifyRan` from `renderVerify.ts`; `startTurn`, `getTurn`, `getProject`, `runClaudeBranch` (all in chat.ts).
- Produces: `POST /api/chat/render-verify-retry { slug, frame, userTurnId, prompt }` — registers a corrective turn (session-resumed) with the server-provided `prompt` (the `RENDER_VERIFY_RETRY_PROMPT` output), one-shot per userTurnId. Mirrors `handleVisualNoOpRetry` EXACTLY but with its own one-shot + a `prompt` from the body (the client computed the mismatch, so it passes the corrective text — the server does not re-derive it).

**Context:** `handleVisualNoOpRetry` (`chat.ts:317`) is the template: read+validate body, `getProject`, own one-shot guard, `startTurn({prompt, run: ({emit,end,signal}) => runClaudeBranch({emit,slug,prompt,project,signal}).then(end, ...)})`, 202 after startTurn. Copy it. The ONE difference: the prompt comes from the request body (the client built it via `RENDER_VERIFY_RETRY_PROMPT`) rather than a hardcoded const — so validate `prompt` is a non-empty string. Do NOT touch `handleVisualNoOpRetry`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/chat-render-verify-route.test.ts` (mirror `chat-visual-noop-route.test.ts`'s guard-level test — assert the one-shot via the exported helpers, since the real route spawns a subprocess):

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderVerifyAlreadyRan, markRenderVerifyRan } from "../../server/renderVerify";

describe("render-verify one-shot guard (own Set, per user-turn)", () => {
  it("not-run for a fresh turn, run after marking, independent per turn", () => {
    expect(renderVerifyAlreadyRan("route-turn-a")).toBe(false);
    markRenderVerifyRan("route-turn-a");
    expect(renderVerifyAlreadyRan("route-turn-a")).toBe(true);
    expect(renderVerifyAlreadyRan("route-turn-b")).toBe(false);
  });
});
```

(The route's request-validation + turn-registration behavior is exercised end-to-end at the manual gate; the unit layer proves the guard, matching how VN's route test is scoped.)

- [ ] **Step 2: Run to verify fail/pass**

Run: `pnpm run studio:test studio/__tests__/server/chat-render-verify-route.test.ts`
Expected: PASS once Task 4 shipped the helpers (this test depends only on renderVerify.ts). Run it to confirm green before wiring the route.

- [ ] **Step 3: Implement the route**

In `chat.ts`: add a URL const near `VISUAL_NOOP_RETRY_URL`:
```typescript
const RENDER_VERIFY_RETRY_URL = /^\/api\/chat\/render-verify-retry$/;
```
Dispatch it in the POST branch, beside the VN one (before `handleStart`):
```typescript
      if (RENDER_VERIFY_RETRY_URL.test(req.url)) return handleRenderVerifyRetry(req, res);
```
Add the import:
```typescript
import { renderVerifyAlreadyRan, markRenderVerifyRan } from "../renderVerify";
```
Add `handleRenderVerifyRetry`, copied from `handleVisualNoOpRetry` with the prompt from the body + the own one-shot:
```typescript
async function handleRenderVerifyRetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  let body: { slug?: string; frame?: string; userTurnId?: string; prompt?: string };
  try { body = JSON.parse(buf); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "Invalid JSON" } }));
    return;
  }
  const { slug, frame, userTurnId, prompt } = body;
  if (typeof slug !== "string" || !slug || typeof frame !== "string" || !frame ||
      typeof userTurnId !== "string" || !userTurnId || typeof prompt !== "string" || !prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request", message: "slug, frame, userTurnId, prompt required" } }));
    return;
  }
  const project = await getProject(slug);
  if (!project) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Project not found" } }));
    return;
  }
  if (renderVerifyAlreadyRan(userTurnId)) {
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
  markRenderVerifyRan(userTurnId);
  const turn = startTurn(slug, {
    prompt,
    run: ({ emit, end, signal }) => {
      runClaudeBranch({ emit, slug, prompt, project, signal }).then(
        (result) => end(result),
        (err) => end({ ok: false, error: err?.message ?? String(err) }),
      );
    },
  });
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ turnId: turn.id, slug }));
}
```

- [ ] **Step 4: Run the route + renderVerify tests**

Run: `pnpm run studio:test studio/__tests__/server/chat-render-verify-route.test.ts studio/__tests__/server/renderVerify.test.ts studio/__tests__/server/chat-visual-noop-route.test.ts`
Expected: PASS (incl. VN's route test — confirm no regression from the dispatch/import edits).

- [ ] **Step 5: Commit**

```bash
command git add studio/server/middleware/chat.ts studio/__tests__/server/chat-render-verify-route.test.ts
command git commit -m "feat(studio/server): render-verify-retry route (own one-shot, prompt from body, runClaudeBranch)"
```

---

## Task 6: client wiring — buffer digest, capture originating prompt, reconcile, one-fire, banner

**Files:**
- Create: `studio/src/components/chat/RenderMismatchBanner.tsx`
- Modify: `studio/src/hooks/useProjectFromHost.ts` (turn-persistent digest store; capture originating prompt; OWN turn-end reconcile effect + OWN `awaitingRvCorrective` flag; shared `handledTurn` one-fire guard; banner state; `resetPerTurn` extract)
- Modify: `studio/src/components/viewport/Viewport.tsx` + `studio/src/routes/ProjectDetail.tsx` (thread `onRenderDigest`; render the banner)
- Test: `studio/__tests__/components/render-mismatch-banner.test.tsx`, and a client-decision test folded into an existing/new pure helper

**Interfaces:**
- Consumes: `extractRequestedProperties`, `reconcile`, `RENDER_VERIFY_RETRY_PROMPT` (from `renderVerify.ts` — pure, client-importable, zero node deps — same as VN imports `narrationClaimsVisualChange`); `RenderDigest` (type); `onRenderDigest` (from FrameCard, Task 3).
- Produces: `RenderMismatchBanner` + `RENDER_MISMATCH_SENTINEL` + `splitRenderMismatchTrailer`; `useProjectFromHost` now exposes `onRenderDigest` + `renderMismatchBannerForFrame`.

**Context:** `useProjectFromHost` already has the VN turn-end machinery: a turn-transition reset effect, an `awaitingCorrective` flag, `handledTurn`, a `noOpCandidate` ref, the `send`-path-independent reset, and the `visualNoOpBannerForFrame` state. Render-verify adds a PARALLEL path: its own digest store, its own `awaitingRvCorrective` flag, its own banner state, and its OWN turn-end effect (declared AFTER VN's). They share only VN's existing `handledTurn` ref as the one-corrective-per-turn guard — VN's effect runs first, so if VN fires it sets `handledTurn` and render-verify skips the turn (edit-noop priority).

- [ ] **Step 1: Write the failing banner test**

Create `studio/__tests__/components/render-mismatch-banner.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RenderMismatchBanner, RENDER_MISMATCH_SENTINEL, splitRenderMismatchTrailer } from "../../src/components/chat/RenderMismatchBanner";

describe("RenderMismatchBanner", () => {
  it("has its own distinct sentinel (not VN's / not the no-frame-changes one)", () => {
    expect(RENDER_MISMATCH_SENTINEL).not.toContain("no frame changes");
    expect(RENDER_MISMATCH_SENTINEL).not.toContain("didn't move anything on screen");
    expect(RENDER_MISMATCH_SENTINEL.length).toBeGreaterThan(0);
  });
  it("splits the trailer off the body", () => {
    const { body, hasWarning } = splitRenderMismatchTrailer("Done.\n\n" + RENDER_MISMATCH_SENTINEL + " x");
    expect(hasWarning).toBe(true);
    expect(body).toBe("Done.");
  });
  it("renders the soft message", () => {
    render(<RenderMismatchBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/render-mismatch-banner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner** (model on `VisualNoOpBanner.tsx`)

Create `studio/src/components/chat/RenderMismatchBanner.tsx`:

```typescript
/**
 * Soft, non-accusatory banner for "the render doesn't match what you asked" —
 * shown when the user's requested visual property (e.g. vertical) still
 * contradicts the render after one corrective retry. Distinct sentinel from
 * VisualNoOpBanner / NoFrameChangesBanner so none collide. See the spec.
 */

export const RENDER_MISMATCH_SENTINEL = "⚠ Studio: the result doesn't match what you asked for";

export function splitRenderMismatchTrailer(content: string): { body: string; hasWarning: boolean } {
  const idx = content.indexOf(RENDER_MISMATCH_SENTINEL);
  if (idx === -1) return { body: content, hasWarning: false };
  return { body: content.slice(0, idx).trimEnd(), hasWarning: true };
}

export function RenderMismatchBanner() {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
        borderRadius: 8, background: "var(--bg-warning-subtle, #fff3e0)",
        color: "var(--fg-warning-prominent, #8b4500)",
        border: "1px solid var(--stroke-warning-subtle, rgba(139, 69, 0, 0.15))",
        fontSize: 13, lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 14, lineHeight: "1.4" }}>⚠</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>Doesn't match your request</div>
        <div style={{ opacity: 0.9 }}>
          You asked for a change the render doesn't show — the component may not support it.
          Try describing the layout you want a different way.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire `useProjectFromHost`**

Read the current turn-end effect + refs first (`command grep -n "noOpCandidate\|awaitingCorrective\|handledTurn\|correctiveFiredForTurn\|visualNoOpBannerForFrame\|onVisualNoOp\|lastSeenTurn" studio/src/hooks/useProjectFromHost.ts`). Add, mirroring the VN machinery:

**REV-FIX (plan review, 2 Criticals) — render-verify gets its OWN turn-end effect + its OWN corrective flag (`awaitingRvCorrective`); it does NOT append to VN's effect (which `return`s early on a no-candidate turn → dead code on the no-edit repro) and does NOT reuse VN's `awaitingCorrective` (whose corrective-end branch only sets the VN banner → the RV banner would be swallowed).** The two effects coexist and are serialized by the SHARED `handledTurn` ref (VN's existing one-shot; whichever effect runs first for a turn and sets `handledTurn.current = turnId` blocks the other). React runs effects in declaration order, so VN's effect (declared first) wins when both would fire (edit-noop priority). No `correctiveFiredForTurn` — `handledTurn` IS the shared guard.

1. Imports: `import { extractRequestedProperties, reconcile, RENDER_VERIFY_RETRY_PROMPT } from "../../server/renderVerify"; import type { RenderDigest } from "../frame/frameDigest";`
2. `onRenderDigest` callback (buffer — NOT cleared on any turn transition; this is the turn-persistence crux):
```typescript
   const onRenderDigest = useCallback((frameSlug: string, digest: RenderDigest) => {
     digestByFrame.current.set(frameSlug, digest);
   }, []);
```
   Refs/state:
```typescript
   const digestByFrame = useRef<Map<string, RenderDigest>>(new Map()); // TURN-PERSISTENT — never cleared per turn
   const originating = useRef<{ prompt: string; turnId: string } | null>(null);
   const awaitingRvCorrective = useRef(false);        // RV's OWN — NOT VN's awaitingCorrective
   const rvPendingFrame = useRef<string | null>(null);
   const [renderMismatchBannerForFrame, setRenderMismatchBannerForFrame] = useState<string | null>(null);
```

4. Capture the originating prompt in the EXISTING turn-transition reset effect (`useProjectFromHost.ts:79-88`). Add these lines to that effect's body, and guard on BOTH corrective flags so a corrective turn (VN's or RV's) doesn't overwrite the originating prompt or clear state:
```typescript
     // (existing) if (awaitingCorrective.current) return;  ← VN corrective
     if (awaitingRvCorrective.current) return;            // ADD: RV corrective — keep state
     // (existing resets: noOpCandidate, handledTurn, setVisualNoOpBannerForFrame)
     originating.current = { prompt: chat.lastPrompt ?? "", turnId };   // ADD (turnId is in scope here)
     setRenderMismatchBannerForFrame(null);                              // ADD: a new user turn dismisses the RV banner
     // NOTE: do NOT touch digestByFrame here — it must survive the turn (the crux).
```
   (`chat.turnId`+`chat.lastPrompt` are set atomically by the SSE turn header — verified `useChatStream.ts:199-212` — so `originating` captures the user's prompt before any corrective can overwrite `lastPrompt`.)

5. Add a SEPARATE render-verify turn-end effect, declared AFTER VN's turn-end effect (so VN's runs first → priority via `handledTurn`):
```typescript
   useEffect(() => {
     if (chat.phase !== "done") return;
     const turnId = chat.turnId;
     if (!turnId) return;

     // The RV corrective turn ended → banner-only, never re-POST.
     if (awaitingRvCorrective.current) {
       awaitingRvCorrective.current = false;
       const target = rvPendingFrame.current;
       rvPendingFrame.current = null;
       if (target && originating.current) {
         const requested = extractRequestedProperties(originating.current.prompt);
         const digest = digestByFrame.current.get(target);
         if (requested.length > 0 && digest && reconcile(requested, digest).length > 0) {
           setRenderMismatchBannerForFrame(target); // corrective didn't fix it
         }
       }
       return;
     }

     // Shared one-fire guard: VN's effect (declared first) sets handledTurn when
     // it fires → RV skips this turn. If VN didn't claim the turn, RV may.
     if (handledTurn.current === turnId) return;
     if (!originating.current || originating.current.turnId !== turnId) return;

     const requested = extractRequestedProperties(originating.current.prompt);
     if (requested.length === 0) return;

     // v1 target-frame resolution: first frame whose digest unanimously contradicts.
     let target: string | null = null;
     let mismatchPrompt = "";
     for (const [frameSlug, digest] of digestByFrame.current) {
       const mismatches = reconcile(requested, digest);
       if (mismatches.length > 0) { target = frameSlug; mismatchPrompt = RENDER_VERIFY_RETRY_PROMPT(mismatches[0]); break; }
     }
     if (!target) return;

     handledTurn.current = turnId;          // claim the turn (blocks a late VN fire too)
     awaitingRvCorrective.current = true;
     rvPendingFrame.current = target;
     const userTurnId = originating.current.turnId;
     let cancelled = false;
     void (async () => {
       try {
         await fetch("/api/chat/render-verify-retry", {
           method: "POST", headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ slug, frame: target, userTurnId, prompt: mismatchPrompt }),
         });
         if (cancelled) return;
         chatStream.reconnect();
       } catch { awaitingRvCorrective.current = false; }
     })();
     return () => { cancelled = true; };
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [chat.phase, chat.turnId, slug]);
```
   **Why this composes (no dead code, no banner-swallow):** RV has its own effect (VN's early `return` can't shadow it) and its own `awaitingRvCorrective` + banner setter (VN's corrective-end branch only touches VN's banner; RV's touches RV's). `handledTurn` is the single shared guard — VN declared first wins ties. On the no-edit repro: VN's effect returns (no candidate, doesn't set `handledTurn`), then RV's effect runs, `handledTurn` is still null, extracts `{orientation,vertical}` from the captured user prompt, reconciles the buffered mount-time digest (all `row`) → mismatch → fires. Exactly the case that was dead before.

6. Return `onRenderDigest` + `renderMismatchBannerForFrame` from the hook (add to the return object + the `ProjectShellSource` interface).

- [ ] **Step 5: Thread the prop + render the banner**

- `Viewport.tsx`: add `onRenderDigest?: (frameSlug: string, digest: RenderDigest) => void` to props (import the type), pass `onRenderDigest={onRenderDigest}` to each `<FrameCard>` (beside `onVisualNoOp`).
- `ProjectDetail.tsx`: pass `onRenderDigest={source.onRenderDigest}` to `<Viewport>`; render the banner beside the VN one:
```tsx
   {source.renderMismatchBannerForFrame && (
     <div style={{ position: "absolute", left: 16, bottom: 16, maxWidth: 420, zIndex: 20 }}>
       <RenderMismatchBanner />
     </div>
   )}
```
   (import `RenderMismatchBanner`. If both banners could show, stack them — but the one-fire guard makes at most one corrective/turn, so at most one banner.)

- [ ] **Step 6: Run the tests**

Run: `pnpm run studio:test studio/__tests__/components/render-mismatch-banner.test.tsx studio/__tests__/frame/frame-card-digest.test.ts studio/__tests__/server/renderVerify.test.ts`
Expected: PASS. Then type-check the touched files: `node_modules/.bin/tsc --noEmit -p studio/tsconfig.json` — confirm no NEW errors in `useProjectFromHost.ts`, `Viewport.tsx`, `ProjectDetail.tsx`, `RenderMismatchBanner.tsx`, `renderVerify.ts`, `frameDigest.ts` (pre-existing errors in electron/test-fixtures are unrelated).

- [ ] **Step 7: Commit**

```bash
command git add studio/src/components/chat/RenderMismatchBanner.tsx studio/src/hooks/useProjectFromHost.ts \
  studio/src/components/viewport/Viewport.tsx studio/src/routes/ProjectDetail.tsx \
  studio/__tests__/components/render-mismatch-banner.test.tsx
command git commit -m "feat(studio/chat): render-verify client — buffer digest, reconcile user ask vs render, corrective + banner"
```

---

## Task 7: Full suite + turn-persistence guard

- [ ] **Step 1: Turn-persistence assertion (the crux — a dedicated test)**

The make-or-break is that the buffered digest SURVIVES a turn transition (else the no-edit turn has nothing to compare). **MANDATORY (review — no code-review-comment escape hatch): extract the per-turn reset as a pure function and test it.** The reset currently lives inline in the turn-transition effect (`useProjectFromHost.ts:79-88`); pull the mutations into a pure `resetPerTurn` and call it from the effect. Then unit-test that it clears the per-turn refs but leaves `digestByFrame` untouched.

Signature (a pure helper in `useProjectFromHost.ts`, exported for the test):
```typescript
export interface PerTurnRefs {
  noOpCandidate: { current: string | null };
  handledTurn: { current: string | null };
  digestByFrame: { current: Map<string, unknown> };
}
/** Clear per-turn state at a new USER turn. Deliberately does NOT touch
 *  digestByFrame — render-verify needs the mount-time digest on a no-edit turn,
 *  which never re-pushes. This omission is the feature's crux. */
export function resetPerTurn(refs: PerTurnRefs, clearBanners: () => void): void {
  refs.noOpCandidate.current = null;
  refs.handledTurn.current = null;
  clearBanners();
  // digestByFrame intentionally NOT reset.
}
```
Call it from the reset effect (replacing the inline `noOpCandidate.current = null; handledTurn.current = null; setVisualNoOpBannerForFrame(null)`), passing `clearBanners = () => { setVisualNoOpBannerForFrame(null); setRenderMismatchBannerForFrame(null); }`.

Create `studio/__tests__/hooks/render-verify-persistence.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { resetPerTurn } from "../../src/hooks/useProjectFromHost";

describe("resetPerTurn — the turn-persistence crux", () => {
  it("clears per-turn refs but LEAVES digestByFrame (mount-time digest survives)", () => {
    const digest = new Map<string, unknown>([["01-frame", { elements: [], truncated: false }]]);
    const refs = {
      noOpCandidate: { current: "01-frame" as string | null },
      handledTurn: { current: "turn-1" as string | null },
      digestByFrame: { current: digest },
    };
    const clearBanners = vi.fn();
    resetPerTurn(refs, clearBanners);
    expect(refs.noOpCandidate.current).toBeNull();
    expect(refs.handledTurn.current).toBeNull();
    expect(clearBanners).toHaveBeenCalledOnce();
    // THE ASSERTION THAT MATTERS: the digest is still there for the no-edit turn.
    expect(refs.digestByFrame.current.get("01-frame")).toBeTruthy();
  });
});
```
(Exporting `resetPerTurn` from the hook module is fine — it's a pure helper; the hook imports nothing extra.)

- [ ] **Step 2: Full suite green**

Run: `pnpm run studio:test` (clear ports 9223-9232 first).
Expected: PASS. `chat-figma-context.test.ts` contention flake is known/unrelated — re-run in isolation if it fails; anything else (esp. VN's 5 test files) is a real regression to fix.

- [ ] **Step 3: Commit**

```bash
command git add studio/src/hooks/useProjectFromHost.ts studio/__tests__/hooks/render-verify-persistence.test.ts
command git commit -m "test(studio): resetPerTurn extract + assert render-verify digest survives a turn transition (no-edit crux)"
```
(The `resetPerTurn` extract is a small edit to `useProjectFromHost.ts` on top of Task 6 — include it here with its test.)

---

## Task 8: Manual acceptance (running app — user)

- [ ] **Step 1: The repro (no-edit turn).** `pnpm run studio` (fully quit + restart — server + frame bootstrap + client changed). In `computer-skills-filtering-proto` (the frame already has `orientation="vertical"` that renders horizontal): ask "make the toggle groups vertical." **Expect:** the agent does NOT get to silently declare it already-done — render-verify sees the user asked vertical + the carriers render `row` → fires a corrective (agent adds `flex-col` and it actually stacks, OR reports honestly), and if still horizontal → the soft "doesn't match your request" banner. NOT a green "done" over horizontal toggles.
- [ ] **Step 2: No false-fire on a correct render.** In a frame where the toggles ARE vertical (or ask for horizontal on horizontal toggles): **expect** NO corrective, NO banner.
- [ ] **Step 3: No false-fire on a non-orientation / unmappable ask.** Ask "clean up the spacing" or "wire the button": **expect** no render-verify trigger (no mappable property).
- [ ] **Step 4: Mixed page (if constructable).** A page with one horizontal + one vertical toggle, ask "make them vertical": **expect** NO banner (unanimous rule — one already-vertical carrier aborts the mismatch). Acceptable miss per the bound.
- [ ] **Step 5: Report.** Any false-fire (banner/corrective over a correct render) is the cardinal issue. A miss is acceptable. Confirm the mount-time digest was present (the no-edit turn actually fired) — if it silently did nothing, the turn-persistent buffer failed → that's the crux bug to fix.
- [ ] **Step 6: No version bump.** All edit-reliability features ship under ONE release once gates pass.

---

## Self-review notes (author)

- **Spec coverage:** Piece 1 (digest) = Task 1 + Task 2 (emit) + Task 3 (buffer/forward); Piece 2 (extract from USER prompt) = Task 4; Piece 3 (reconcile, unanimous, computed-not-attr) = Task 4; Piece 4 (corrective route + trigger + banner, shared one-fire guard, own state) = Task 5 + Task 6; crux turn-persistence = Task 7; manual gate = Task 8.
- **The rev-3 spec fixes are all in tasks:** turn-persistent buffer → Task 6 `digestByFrame` never reset + Task 7 mandatory `resetPerTurn` test; digest once-per-mount → Task 2 folds into the `useEffect([])` fingerprint effect; verify against ORIGINATING prompt not `lastPrompt` → Task 6 `originating` ref captured in the reset effect; minimal VN touch → Task 5 (own route/Set, no VN edit) + Task 6 (own banner state); compare COMPUTED flexDirection → Task 4 `directionOf(styles.flexDirection)`; unanimous-only → Task 4; satisfiable corrective (`flex-col`) → Task 4 prompt; no-edit target-frame → Task 6 per-frame loop.
- **The PLAN-review fixes are in tasks:** (Critical) render-verify was "dead code after VN's early return" → Task 6 gives it its OWN `useEffect` declared AFTER VN's, serialized by the shared `handledTurn` ref (VN priority), no append to VN's guard chain; (Important) RV banner swallowed by VN's corrective-end branch → Task 6 gives RV its OWN `awaitingRvCorrective` flag + own corrective-end branch that sets the RV banner; (Important) `extractRequestedProperties` false-fire on "the vertical scrollbar"/"don't make it vertical" → Task 4 `NEGATION` + `ADJECTIVE_NOUN` guards + tests both directions; (Important) persistence test was optional → Task 7 mandates the `resetPerTurn` extract + test. Dropped `correctiveFiredForTurn` (redundant — `handledTurn` is the shared guard).
- **Type consistency:** `DigestElement`/`RenderDigest`/`digestElements`/`isDigestCandidate`/`handleDigestMessage`/`DIGEST_ELEMENT_CAP` (Task 1/3) in `frameDigest.ts`. `RequestedProperty`/`Mismatch`/`extractRequestedProperties`/`reconcile`/`RENDER_VERIFY_RETRY_PROMPT`/`renderVerifyAlreadyRan`/`markRenderVerifyRan` (Task 4) in `renderVerify.ts`. `RENDER_MISMATCH_SENTINEL`/`splitRenderMismatchTrailer`/`RenderMismatchBanner` (Task 6) in `RenderMismatchBanner.tsx`. `resetPerTurn`/`PerTurnRefs` + `onRenderDigest`/`renderMismatchBannerForFrame` (Task 6/7) in `useProjectFromHost.ts` / `ProjectShellSource`. Message string `arcade-studio:frame-digest` consistent Task 2 emit ↔ Task 3 handle.
- **Shared guard is `handledTurn` (VN's existing one-shot ref), NOT a new `correctiveFiredForTurn`:** whichever turn-end effect runs first and sets `handledTurn.current = turnId` blocks the other; VN's effect is declared first → edit-noop priority. One corrective per turn, structurally.
