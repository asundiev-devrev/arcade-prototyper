# Rich Editor Phase 1 (Overlay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `picker.ts`'s hand-drawn blue outline with design-mode's richer passive overlay (hover outline, selection box, W×H badge, margin/padding bands, dashed measure guides + distance pills, layout guides) lifted into Studio's frame iframes.

**Architecture:** A new `studio/src/frame/overlay/` module holds the lifted design-mode overlay code (vanilla TS, MIT-attributed), de-coupled from Chrome (colors come from an `overlayConfig` constant, not `chrome.storage`). It exposes a thin facade (`showHover`/`showSelection`/`clear`/`setEnabled`). `picker.ts` keeps its brains (React-fiber→source resolution, `capture()`, postMessage) and is rewired to call the overlay facade instead of drawing its own outline. Passive only — no resize handles, no commit-path change. Studio's coordinate model (`position:fixed` + viewport `getBoundingClientRect`, parent CSS-zoom scales it) is kept; design-mode's document-coord drawing is adapted to it.

**Tech Stack:** Vanilla TypeScript (the overlay runs inside frame iframes, no React there), Vite, Vitest + jsdom. pnpm.

## Global Constraints

- **pnpm only.** Before running tests in this environment, the shell needs:
  `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` and
  `export GITHUB_TOKEN_PACKAGES="$GITHUB_TOKEN"`. If `pnpm`/`vitest` are still
  "not found" after those exports, STOP and report — do NOT assume npm-auth.
- **Run tests from repo root** (`/Users/andrey.sundiev/arcade-prototyper`):
  `pnpm run studio:test <path>` (path relative to `studio/`); full suite
  `pnpm run studio:test`.
- **Commits:** Conventional Commits, scope `studio/overlay`. End each commit body
  with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Never `git add -A`/`git add .`** — stage explicit paths only.
- **Vite plugins don't hot-reload** — adding an import to `frameMountPlugin.ts`
  needs a full app restart (does not affect tests).
- **Dev-only feature** — runs inside frame iframes using `getBoundingClientRect`
  + DOM; same dev-only posture as today's `picker.ts`. Don't make it
  production-safe.
- **Lifted code is MIT** (design-mode, © 2026 Sandeep Baskaran). Every lifted
  file carries a header crediting design-mode + MIT; a repo-root `THIRD-PARTY.md`
  records the borrow.
- **Coordinate model: viewport coords.** `getElementRect` returns
  `el.getBoundingClientRect()` with **no** `window.scrollX/scrollY` offset.
  Overlay elements use `position:fixed`. No zoom/pan math in the overlay.
- **Passive only.** Do NOT lift resize handles, drag-to-move, or any
  `*CommitHandler`/`*PreviewHandler` from design-mode's `measure-guides.ts`.

## Source reference (read-only, for lifting)

design-mode is cloned at `/tmp/design-mode-src`. The files to lift from:
- `packages/extension/src/content/overlays.ts` (368 lines)
- `packages/extension/src/content/measure-guides.ts` (524 lines — lift only the passive half)
- `packages/extension/src/content/layout-guides.ts` (225 lines)
- `packages/shared/src/constants.ts` — `Z_INDEX` block (lines 18–27)

If `/tmp/design-mode-src` is gone, re-clone: `git clone --depth 1 https://github.com/SandeepBaskaran/design-mode.git /tmp/design-mode-src`.

---

## File Structure

- **Create** `studio/src/frame/overlay/geometry.ts` — `Rect` type, `getElementRect` (viewport coords), `hexToRgba`, `Z_INDEX` constant. (Task 1)
- **Create** `studio/src/frame/overlay/overlayConfig.ts` — arcade-token-derived color constants. (Task 1)
- **Create** `studio/src/frame/overlay/overlays.ts` — lifted hover/selection/W×H/bands, de-Chrome'd. (Task 2)
- **Create** `studio/src/frame/overlay/measureGuides.ts` — lifted passive guides + distance pills. (Task 3)
- **Create** `studio/src/frame/overlay/layoutGuides.ts` — lifted grid/column guides. (Task 4)
- **Create** `studio/src/frame/overlay/index.ts` — facade: `showHover`/`showSelection`/`clear`/`setEnabled`/`reposition`/`isOverlayElement`. (Task 5)
- **Modify** `studio/src/frame/picker.ts` — delete hand-drawn outline, call the facade. (Task 6)
- **Create** `THIRD-PARTY.md` (repo root) — MIT attribution. (Task 1)
- Tests under `studio/__tests__/frame/overlay/`.

### Shared types (Task 1, consumed by all overlay files)

```ts
// studio/src/frame/overlay/geometry.ts
export interface Rect { top: number; left: number; width: number; height: number; bottom: number; right: number; }
export function getElementRect(el: HTMLElement): Rect;
export function hexToRgba(hex: string, alpha: number): string;
export const Z_INDEX: { HOVER_OVERLAY: number; SELECT_OVERLAY: number; HOVER_BANDS: number; SELECT_BANDS: number; GUIDES: number; };
```

---

### Task 1: Geometry + config foundation + attribution

**Files:**
- Create: `studio/src/frame/overlay/geometry.ts`
- Create: `studio/src/frame/overlay/overlayConfig.ts`
- Create: `THIRD-PARTY.md`
- Test: `studio/__tests__/frame/overlay/geometry.test.ts`

**Interfaces:**
- Produces: `Rect`, `getElementRect`, `hexToRgba`, `Z_INDEX` (geometry.ts);
  `OVERLAY_COLORS` (overlayConfig.ts: `{ hover, select, marginBand, paddingBand, guide, pill }` — all hex strings, plus alpha constants).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/overlay/geometry.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getElementRect, hexToRgba, Z_INDEX } from "../../../src/frame/overlay/geometry";

describe("getElementRect", () => {
  it("returns viewport coords (no scroll offset added)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom getBoundingClientRect is all-zero by default; stub it.
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120, x: 20, y: 10, toJSON() {} }) as DOMRect;
    // even with a scrolled window, the rect must NOT add scrollX/Y
    Object.defineProperty(window, "scrollX", { value: 999, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 999, configurable: true });
    const r = getElementRect(el);
    expect(r).toEqual({ top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120 });
  });
});

describe("hexToRgba", () => {
  it("converts 6-digit hex to rgba", () => {
    expect(hexToRgba("#4F9EFF", 0.06)).toBe("rgba(79, 158, 255, 0.06)");
    expect(hexToRgba("FF6363", 0.28)).toBe("rgba(255, 99, 99, 0.28)");
  });
  it("falls back to a safe rgba on bad input", () => {
    expect(hexToRgba("nope", 0.3)).toBe("rgba(255, 99, 99, 0.3)");
  });
});

describe("Z_INDEX", () => {
  it("orders bands below their outlines and all above page content", () => {
    expect(Z_INDEX.HOVER_BANDS).toBeLessThan(Z_INDEX.HOVER_OVERLAY);
    expect(Z_INDEX.SELECT_BANDS).toBeLessThan(Z_INDEX.SELECT_OVERLAY);
    expect(Z_INDEX.HOVER_OVERLAY).toBeGreaterThan(1_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/frame/overlay/geometry.test.ts`
Expected: FAIL — module `geometry` not found.

- [ ] **Step 3: Implement geometry.ts**

Create `studio/src/frame/overlay/geometry.ts`:

```ts
/**
 * Geometry + color helpers for the frame overlay.
 *
 * Adapted from design-mode (https://github.com/SandeepBaskaran/design-mode),
 * MIT © 2026 Sandeep Baskaran. See THIRD-PARTY.md.
 *
 * KEY DIFFERENCE from design-mode's helpers: getElementRect returns VIEWPORT
 * coordinates (no window.scrollX/scrollY offset). Studio frames are fixed-size
 * iframes rendered at a zoom factor inside a CSS-transformed parent; overlay
 * elements use position:fixed and the parent transform scales them. Adding a
 * scroll offset (as design-mode does for full scrolling pages) would mis-place
 * every overlay here.
 */

export interface Rect {
  top: number; left: number; width: number; height: number; bottom: number; right: number;
}

export function getElementRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return `rgba(255, 99, 99, ${alpha})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Single high band so the overlay always sits above frame content. Bands sit
// just below their outline so the outline border reads on top.
export const Z_INDEX = {
  HOVER_BANDS: 2147483640,
  HOVER_OVERLAY: 2147483641,
  GUIDES: 2147483642,
  SELECT_BANDS: 2147483643,
  SELECT_OVERLAY: 2147483644,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/frame/overlay/geometry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create overlayConfig.ts**

Create `studio/src/frame/overlay/overlayConfig.ts`:

```ts
/**
 * Overlay colors. design-mode reads these from chrome.storage; Studio has no
 * such store, so they're constants here, chosen to read well on arcade frames.
 * Hex strings (hexToRgba applies alpha at paint time).
 */
export const OVERLAY_COLORS = {
  hover: "#4F9EFF",        // hover outline
  select: "#FF6B35",       // selection box + W×H badge + guides + pills
  marginBand: "#FF6363",   // margin visualizer (red)
  paddingBand: "#7CC886",  // padding visualizer (green)
} as const;

export const ALPHA = {
  hoverFill: 0.06,
  marginBand: 0.28,
  paddingBand: 0.3,
} as const;
```

- [ ] **Step 6: Create THIRD-PARTY.md**

Create `THIRD-PARTY.md` at the repo root:

```markdown
# Third-Party Code

## design-mode (overlay)

`studio/src/frame/overlay/` adapts the DOM-highlighting overlay from
[design-mode](https://github.com/SandeepBaskaran/design-mode) by Sandeep
Baskaran, used under the MIT License (© 2026 Sandeep Baskaran).

Adapted: `overlays.ts`, `measure-guides.ts` (passive parts only),
`layout-guides.ts`, and geometry helpers. Changes: removed the Chrome-extension
runtime coupling (chrome.storage / chrome.runtime), removed interactive
resize/move handles, and switched to viewport (non-scroll-offset) coordinates
for Studio's zoomed-iframe rendering.

MIT License text: https://github.com/SandeepBaskaran/design-mode/blob/main/LICENSE
```

- [ ] **Step 7: Commit**

```bash
git add studio/src/frame/overlay/geometry.ts studio/src/frame/overlay/overlayConfig.ts THIRD-PARTY.md studio/__tests__/frame/overlay/geometry.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): geometry + color config foundation (design-mode lift)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Lift overlays.ts (hover/selection/W×H/bands)

**Files:**
- Create: `studio/src/frame/overlay/overlays.ts`
- Test: `studio/__tests__/frame/overlay/overlays.test.ts`

**Interfaces:**
- Consumes: `Rect`, `getElementRect`, `hexToRgba`, `Z_INDEX` (Task 1); `OVERLAY_COLORS`, `ALPHA` (Task 1).
- Produces: `ensureOverlays()`, `showHover(el)`, `hideHover()`, `showSelect(el)`, `hideSelect()`, `updateSelectPosition(el)`, `destroyOverlays()`, `resetOverlayTeardown()`, `isOverlayElement(el): boolean`.

**Lift source:** `/tmp/design-mode-src/packages/extension/src/content/overlays.ts`. Transcribe it with these exact changes:
1. Replace the import block (`import { Z_INDEX } from '../shared'; import { getElementRect, type Rect } from './helpers';`) with `import { Z_INDEX, getElementRect, hexToRgba, type Rect } from "./geometry"; import { OVERLAY_COLORS, ALPHA } from "./overlayConfig";`.
2. **Delete the local `hexToRgba`** (source lines 47–54) — use geometry's.
3. **Delete the entire `chrome.storage` block** (source lines 69–119, the `try { chrome.storage?... } catch {}`).
4. Replace the color `let` seeds (source lines 39–45) with values from config:
   ```ts
   let hoverHex = OVERLAY_COLORS.hover;
   let selectHex = OVERLAY_COLORS.select;
   let marginBandHex = OVERLAY_COLORS.marginBand;
   let paddingBandHex = OVERLAY_COLORS.paddingBand;
   let hoverFillCss = hexToRgba(OVERLAY_COLORS.hover, ALPHA.hoverFill);
   let marginBandCss = hexToRgba(OVERLAY_COLORS.marginBand, ALPHA.marginBand);
   let paddingBandCss = hexToRgba(OVERLAY_COLORS.paddingBand, ALPHA.paddingBand);
   ```
   (Keep the `*_DEFAULT_HEX`/`*_ALPHA` consts the rest of the file references, OR replace their usages with `OVERLAY_COLORS`/`ALPHA`. Simplest: keep the `const MARGIN_BAND_ALPHA = ALPHA.marginBand` etc. aliases so the body is unchanged.)
5. Keep `applyOverlayColors`, `makeBand`, `ensureOverlays`, `positionOverlayFromRect`, `positionBands`, `hideBands`, `showHover`, `hideHover`, `showSelect`, `hideSelect`, `updateSelectPosition`, `setOverlayTransitions`, `destroyOverlays`, `resetOverlayTeardown`, `isOverlayElement` **verbatim**.
6. **Change `position: 'absolute'` → `position: 'fixed'`** in `OVERLAY_BASE` (source line 24), in `makeBand` (`position: 'absolute'` ~line 125), and in the `dimensionLabel` style block (~line 189). Everything that positions an overlay element must be `fixed` (viewport coords). This is the coordinate-model adaptation.
7. **Drop** `setOverlaysHiddenForCapture` (source lines 310–322) — screenshot capture isn't in scope; remove it to avoid dead code.
8. Append `appendChild` target stays `document.documentElement` (correct inside the iframe).

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/overlay/overlays.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { showHover, showSelect, hideHover, hideSelect, destroyOverlays, resetOverlayTeardown, isOverlayElement } from "../../../src/frame/overlay/overlays";

function stubRect(el: HTMLElement, r: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON() {}, ...r }) as DOMRect;
}

beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  resetOverlayTeardown();
});

describe("overlays", () => {
  it("showHover paints a positioned, visible hover outline (position:fixed)", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120 });
    document.body.appendChild(el);
    showHover(el);
    const hover = document.getElementById("dm-hover")!;
    expect(hover).toBeTruthy();
    expect(hover.style.position).toBe("fixed");
    expect(hover.style.display).toBe("block");
    expect(hover.style.top).toBe("10px");
    expect(hover.style.width).toBe("100px");
  });

  it("showSelect sets the W×H dimension label text", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 0, left: 0, width: 128, height: 64, bottom: 64, right: 128 });
    document.body.appendChild(el);
    showSelect(el);
    expect(document.getElementById("dm-dim-label")!.textContent).toBe("128 × 64");
  });

  it("paints margin + padding bands when the element has spacing", () => {
    const el = document.createElement("div");
    el.style.marginTop = "8px"; el.style.paddingLeft = "12px";
    stubRect(el, { top: 0, left: 0, width: 100, height: 50, bottom: 50, right: 100 });
    document.body.appendChild(el);
    showHover(el);
    // bands exist and at least the margin band is shown (jsdom returns computed px)
    expect(document.getElementById("dm-hover-margin")).toBeTruthy();
    expect(document.getElementById("dm-hover-padding")).toBeTruthy();
  });

  it("hide + isOverlayElement work; destroy removes nodes", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 0, left: 0, width: 10, height: 10, bottom: 10, right: 10 });
    document.body.appendChild(el);
    showHover(el); showSelect(el);
    expect(isOverlayElement(document.getElementById("dm-hover") as HTMLElement)).toBe(true);
    expect(isOverlayElement(el)).toBe(false);
    hideHover(); hideSelect();
    expect(document.getElementById("dm-hover")!.style.display).toBe("none");
    destroyOverlays();
    expect(document.getElementById("dm-hover")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/frame/overlay/overlays.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement overlays.ts**

Transcribe `/tmp/design-mode-src/packages/extension/src/content/overlays.ts` into `studio/src/frame/overlay/overlays.ts`, applying changes 1–8 listed above. Add the MIT-attribution header comment (as in geometry.ts). Read the source file first; the changes are surgical (import swap, delete chrome block + local hexToRgba + capture fn, absolute→fixed, seed colors from config).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm run studio:test __tests__/frame/overlay/overlays.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/overlays.ts studio/__tests__/frame/overlay/overlays.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): hover/selection/W×H/bands (design-mode lift, de-Chrome'd)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Lift measure-guides.ts (PASSIVE parts only)

**Files:**
- Create: `studio/src/frame/overlay/measureGuides.ts`
- Test: `studio/__tests__/frame/overlay/measureGuides.test.ts`

**Interfaces:**
- Consumes: `Rect`, `getElementRect`, `Z_INDEX` (Task 1); `OVERLAY_COLORS` (Task 1).
- Produces: `showAxisGuides(rect: Rect, variant: "hover" | "select")`, `hideAxisGuides()`, `computeDistanceSegments(a: Rect, b: Rect): DistanceSegments`, `showDistance(base: Rect, target: Rect)`, `hideDistance()`, `teardownMeasureGuides()`, `resetMeasureTeardown()`, and the types `DistanceLine`/`DistancePill`/`DistanceSegments`.

**Lift source:** `/tmp/design-mode-src/packages/extension/src/content/measure-guides.ts`. Transcribe ONLY the passive guide/distance code. **STRIP entirely** (do not transcribe):
- `ResizeCommit`/`ResizePreview`/`MoveCommit`/`MovePreview` types + `resizeCommit`/`resizePreview`/`moveCommit`/`movePreview` module vars + their `set*Handler` exports (source ~lines 20–61).
- `showResizeDots`, `repositionResizeDots`, `hideResizeDots` (~260–296), the `HANDLES` array (~249–258), `midX`/`midY` if only used by handles (keep if used by guides — check).
- `armMoveDrag` (~369+) and all drag/mousedown/pointer logic.
- `showPairwiseDistances` (~231) (multi-select — out of scope).
- `setGuidesHiddenForCapture` (~120) (capture — out of scope).

**KEEP:** `showAxisGuides`/`hideAxisGuides` (dashed crosshair guides through the element), `computeDistanceSegments` + the `DistanceLine`/`Pill`/`Segments` types, `showDistance`/`hideDistance` (the distance pills), `addLine`/`addPill` internal helpers, the guides-layer container creation, `teardownMeasureGuides`/`resetMeasureTeardown`.

**Changes:** import from `./geometry` + `./overlayConfig`; use `OVERLAY_COLORS.select` (or `.guide` if you add one) for guide/pill color instead of the hardcoded `#FF6B35`; **`position: 'absolute'` → `position: 'fixed'`** for the guides-layer + every line/pill element; use `Z_INDEX.GUIDES`. Drop any `window.scrollX/Y` use (viewport coords). MIT-attribution header.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/overlay/measureGuides.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { computeDistanceSegments, showAxisGuides, hideAxisGuides, teardownMeasureGuides, resetMeasureTeardown } from "../../../src/frame/overlay/measureGuides";
import type { Rect } from "../../../src/frame/overlay/geometry";

const rect = (top: number, left: number, width: number, height: number): Rect =>
  ({ top, left, width, height, bottom: top + height, right: left + width });

beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  resetMeasureTeardown();
});

describe("computeDistanceSegments", () => {
  it("returns lines + pills describing the gap between two rects", () => {
    const a = rect(0, 0, 100, 50);     // base
    const b = rect(0, 200, 100, 50);   // 100px to the right
    const seg = computeDistanceSegments(a, b);
    expect(Array.isArray(seg.lines)).toBe(true);
    expect(Array.isArray(seg.pills)).toBe(true);
    // at least one pill carries a numeric distance label
    expect(seg.pills.some((p) => /\d/.test(p.label))).toBe(true);
  });
});

describe("axis guides", () => {
  it("showAxisGuides paints fixed-position guide lines; hide clears them", () => {
    showAxisGuides(rect(10, 10, 100, 40), "hover");
    const anyGuide = document.querySelector("[id^='dm-'][style*='position: fixed'], [id^='dm-axis']");
    expect(anyGuide).toBeTruthy();
    hideAxisGuides();
    // after hide, guide lines are removed or display:none — assert none visible
    const visible = Array.from(document.querySelectorAll<HTMLElement>("[id^='dm-axis'] *"))
      .filter((n) => n.style.display !== "none");
    expect(visible.length).toBe(0);
  });
});
```

> Note: the exact guide DOM id/structure comes from the source — after transcribing, adjust the test's selectors to match the real container id design-mode uses (e.g. `dm-axis-guides`). Keep the assertions (fixed positioning, pills carry numbers, hide clears) — only the selector strings may need to match the lifted markup. This is allowed: the test asserts behavior, the selector is an implementation detail you align to the lifted code.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run studio:test __tests__/frame/overlay/measureGuides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement measureGuides.ts** (transcribe passive half + apply changes). Read the source first; strip the interactive exports listed above.

- [ ] **Step 4: Align test selectors to the lifted container id, run green**

Run: `pnpm run studio:test __tests__/frame/overlay/measureGuides.test.ts`
Expected: PASS (2 tests). If a selector misses, fix the selector to match the real lifted markup (not the assertion).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/measureGuides.ts studio/__tests__/frame/overlay/measureGuides.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): passive measure guides + distance pills (design-mode lift)

Lifted the passive guide/distance rendering only — resize handles, drag-to-move,
and the commit/preview handlers are intentionally NOT ported (Phase 1 is passive).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Lift layout-guides.ts (grid/column guides)

**Files:**
- Create: `studio/src/frame/overlay/layoutGuides.ts`
- Test: `studio/__tests__/frame/overlay/layoutGuides.test.ts`

**Interfaces:**
- Consumes: `Z_INDEX` (Task 1).
- Produces: `setLayoutGuides(elementId: string, layers: unknown, sectionVisible?: boolean): void`, `getLayoutGuidesFor(elementId): { layers: LayoutGuideLayer[]; sectionVisible: boolean } | null`, `clearAllLayoutGuides(): void`, and the `LayoutGuideLayer` type.

**Lift source:** `/tmp/design-mode-src/packages/extension/src/content/layout-guides.ts` (no chrome deps). Transcribe; swap any `../shared` import to `./geometry` for `Z_INDEX`; **`position: 'absolute'` → `position: 'fixed'`** where it positions the guide overlay; MIT header. layout-guides draws via an injected stylesheet / pseudo-elements per the source — keep that mechanism.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/overlay/layoutGuides.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setLayoutGuides, getLayoutGuidesFor, clearAllLayoutGuides } from "../../../src/frame/overlay/layoutGuides";

beforeEach(() => clearAllLayoutGuides());

describe("layoutGuides", () => {
  it("stores and retrieves layout guide config for an element id", () => {
    setLayoutGuides("el-1", [{ type: "columns", count: 12 }], true);
    const got = getLayoutGuidesFor("el-1");
    expect(got).not.toBeNull();
    expect(got!.sectionVisible).toBe(true);
    expect(Array.isArray(got!.layers)).toBe(true);
  });
  it("clearAll wipes stored guides", () => {
    setLayoutGuides("el-1", [{ type: "columns", count: 12 }], true);
    clearAllLayoutGuides();
    expect(getLayoutGuidesFor("el-1")).toBeNull();
  });
});
```

> Adjust the `layers` shape in the test to match the real `LayoutGuideLayer` type from the source after transcribing. Keep the store/retrieve/clear assertions.

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm run studio:test __tests__/frame/overlay/layoutGuides.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement layoutGuides.ts** (transcribe, swap import, absolute→fixed, header).

- [ ] **Step 4: Align test to real `LayoutGuideLayer`, run green** — Run the test → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/layoutGuides.ts studio/__tests__/frame/overlay/layoutGuides.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): grid/column layout guides (design-mode lift)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Overlay facade (index.ts)

**Files:**
- Create: `studio/src/frame/overlay/index.ts`
- Test: `studio/__tests__/frame/overlay/index.test.ts`

**Interfaces:**
- Consumes: everything from overlays.ts (Task 2) + measureGuides.ts (Task 3) + layoutGuides.ts (Task 4).
- Produces the single API the picker uses:
  ```ts
  export function setEnabled(on: boolean): void;     // on=false → clear() + teardown; on=true → reset teardown flags
  export function showHover(el: HTMLElement): void;  // outline + bands + axis guides for the hovered element
  export function showSelection(el: HTMLElement): void; // selection box + W×H + bands
  export function reposition(el: HTMLElement | null): void; // re-measure current target on scroll/resize
  export function clear(): void;                     // hide hover + selection + guides
  export function isOverlayElement(el: HTMLElement): boolean; // picker hit-test guard
  ```

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/frame/overlay/index.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import * as overlay from "../../../src/frame/overlay/index";

function stubRect(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ top: 5, left: 5, width: 50, height: 20, bottom: 25, right: 55, x: 5, y: 5, toJSON() {} }) as DOMRect;
}
beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  overlay.setEnabled(true);
});

describe("overlay facade", () => {
  it("showHover then showSelection paint the respective nodes", () => {
    const el = document.createElement("button"); el.textContent = "X"; stubRect(el); document.body.appendChild(el);
    overlay.showHover(el);
    expect(document.getElementById("dm-hover")!.style.display).toBe("block");
    overlay.showSelection(el);
    expect(document.getElementById("dm-select")!.style.display).toBe("block");
  });

  it("isOverlayElement guards the overlay's own nodes", () => {
    const el = document.createElement("div"); stubRect(el); document.body.appendChild(el);
    overlay.showHover(el);
    expect(overlay.isOverlayElement(document.getElementById("dm-hover") as HTMLElement)).toBe(true);
    expect(overlay.isOverlayElement(el)).toBe(false);
  });

  it("clear hides hover + selection; setEnabled(false) tears down nodes", () => {
    const el = document.createElement("div"); stubRect(el); document.body.appendChild(el);
    overlay.showHover(el); overlay.showSelection(el);
    overlay.clear();
    expect(document.getElementById("dm-hover")!.style.display).toBe("none");
    overlay.setEnabled(false);
    expect(document.getElementById("dm-hover")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement index.ts**

Create `studio/src/frame/overlay/index.ts`:

```ts
/**
 * Public facade for the frame overlay. picker.ts calls only this module.
 * Composes the lifted design-mode overlay pieces (overlays / measureGuides /
 * layoutGuides) into the hover/selection/clear API Studio's picker needs.
 *
 * Adapted from design-mode (MIT © 2026 Sandeep Baskaran). See THIRD-PARTY.md.
 */
import {
  showHover as paintHover, hideHover, showSelect, hideSelect,
  updateSelectPosition, destroyOverlays, resetOverlayTeardown, isOverlayElement as isOverlayNode,
} from "./overlays";
import {
  showAxisGuides, hideAxisGuides, teardownMeasureGuides, resetMeasureTeardown,
} from "./measureGuides";
import { getElementRect } from "./geometry";

let selectedEl: HTMLElement | null = null;

export function setEnabled(on: boolean): void {
  if (on) {
    resetOverlayTeardown();
    resetMeasureTeardown();
  } else {
    clear();
    destroyOverlays();
    teardownMeasureGuides();
    selectedEl = null;
  }
}

export function showHover(el: HTMLElement): void {
  paintHover(el);
  showAxisGuides(getElementRect(el), "hover");
}

export function showSelection(el: HTMLElement): void {
  selectedEl = el;
  showSelect(el);
  showAxisGuides(getElementRect(el), "select");
}

export function reposition(el: HTMLElement | null): void {
  const target = el ?? selectedEl;
  if (!target) return;
  updateSelectPosition(target);
}

export function clear(): void {
  hideHover();
  hideSelect();
  hideAxisGuides();
  selectedEl = null;
}

export function isOverlayElement(el: HTMLElement): boolean {
  return isOverlayNode(el);
}
```

> If a name imported here doesn't match what Tasks 2/3 exported, fix the import to the real exported name — do not invent new ones.

- [ ] **Step 4: Run to verify it passes** — Run the test → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/frame/overlay/index.ts studio/__tests__/frame/overlay/index.test.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): facade composing hover/selection/guides for the picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rewire picker.ts to the overlay facade

**Files:**
- Modify: `studio/src/frame/picker.ts`
- Modify: `studio/server/plugins/frameMountPlugin.ts` (verify the overlay loads with the frame; picker imports it, so likely no new line — confirm)
- Test: existing `studio/__tests__/frame/*` stay green; add `studio/__tests__/frame/picker-overlay-wiring.test.ts` if feasible (see Step 5).

**Interfaces:**
- Consumes: the overlay facade (Task 5) — `setEnabled`, `showHover`, `showSelection`, `reposition`, `clear`, `isOverlayElement`.
- Produces: picker draws nothing itself; all visuals go through the facade. `resolveSelection`/`capture`/postMessage unchanged.

- [ ] **Step 1: Read picker.ts fully** so the deletions/rewires match verbatim. Confirm current draw code: `OUTLINE_ID`/`STYLE_ID` consts (~32-33), `ensureOverlay` (~35-60), `removeOverlay` (~62-65), `positionOutline` (~170-186), `flashOutlineAndFinish` (~213-225), and the calls to them in `onMouseOver`/`onScroll`/`onClick`/`activate`/`deactivate`.

- [ ] **Step 2: Add the overlay import** at the top (after the file header comment):
```ts
import * as overlay from "./overlay";
```

- [ ] **Step 3: Delete the hand-drawn outline code.** Remove: `OUTLINE_ID`, `STYLE_ID` consts; `ensureOverlay()`; `removeOverlay()`; `positionOutline()`; `flashOutlineAndFinish()`.
**KEEP** the crosshair-cursor `<style>` injection — but it lived inside `ensureOverlay`. Extract it into a tiny standalone pair so deactivating still removes it:
```ts
const CURSOR_STYLE_ID = "__arcade-studio-picker-cursor";
function addCursorStyle() {
  if (document.getElementById(CURSOR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CURSOR_STYLE_ID;
  style.textContent = `html[data-arcade-picker="on"] * { cursor: crosshair !important; }`;
  document.head.appendChild(style);
}
function removeCursorStyle() {
  document.getElementById(CURSOR_STYLE_ID)?.remove();
}
```

- [ ] **Step 4: Rewire the handlers.**

`onMouseOver` (was calling `positionOutline`):
```ts
function onMouseOver(e: MouseEvent) {
  if (!active) return;
  const t = e.target as Element | null;
  if (!t || t === hoverTarget) return;
  if (overlay.isOverlayElement(t as HTMLElement)) return; // never hover our own overlay
  hoverTarget = t;
  overlay.showHover(t as HTMLElement);
}
```

`onScroll` (was `positionOutline(hoverTarget)`):
```ts
function onScroll() {
  if (!active) return;
  overlay.reposition(hoverTarget as HTMLElement | null);
}
```

`onClick` success branch (was `flashOutlineAndFinish(true, () => { postPicked(sel); })`): replace the flash with painting the selection box, then post immediately:
```ts
  overlay.showSelection(target as HTMLElement);
  postPicked(sel);
```
For the failure branches (no-target / no-fiber / no-source) that previously called `flashOutlineAndFinish(false, ...)`: just call `postCancel(reason)` directly (drop the red flash — the picker stays active per v2, and the cancel reasons already drive a toast in FrameCard for the meaningful cases):
```ts
  postCancel("no-fiber"); // etc., per branch — no flash
```

`activate`: add `overlay.setEnabled(true); addCursorStyle();` (replacing the old `ensureOverlay()` + the cursor style it set). Keep `document.documentElement.setAttribute("data-arcade-picker", "on")` and the event-listener registration.

`deactivate`: replace `removeOverlay()` with `overlay.clear(); overlay.setEnabled(false); removeCursorStyle();`. Keep the attribute removal + listener teardown.

- [ ] **Step 5: Verify + add a wiring test if feasible**

The picker uses React-fiber internals that jsdom can't fully populate, so a full pick test isn't reliable. But a focused test CAN assert the overlay facade is invoked. If `onMouseOver`/`activate` are not exported, do NOT export them just for testing — instead rely on the existing frame tests + manual e2e, and add this lighter assertion only if picker already exports an entry point. Otherwise skip the new test and note it. (Do not weaken or fake a test.)

- [ ] **Step 6: Run the frame test suite + full suite**

Run: `pnpm run studio:test __tests__/frame/`
Expected: PASS — `resolveSelection`/`capture`/postMessage untouched; no test referenced the deleted `OUTLINE_ID` node (if one did, update it to assert via the overlay's `dm-*` nodes or remove the now-invalid assertion).
Run: `pnpm run studio:test`
Expected: full suite green.

- [ ] **Step 7: Confirm the overlay ships with the frame bundle**

`picker.ts` now imports `./overlay`, and `frameMountPlugin.ts` already imports `arcade-studio/frame/picker` into the frame bootstrap — so the overlay is pulled in transitively. Confirm by reading `frameMountPlugin.ts` around the picker import; no new line needed unless tree-shaking drops it (it won't — picker calls the facade at runtime). Note the finding.

- [ ] **Step 8: Commit**

```bash
git add studio/src/frame/picker.ts
git commit -m "$(cat <<'EOF'
feat(studio/overlay): picker draws via the lifted overlay, drops hand-rolled outline

picker.ts keeps its brains (fiber→source resolution, capture, postMessage) and
hands all hover/selection drawing to the overlay facade. The 2px blue outline
and green/red pick flash are replaced by design-mode's richer overlay.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual end-to-end visual verification

**Files:** none (the overlay is a visual deliverable; unit tests can't judge how it looks).

- [ ] **Step 1: Restart the app** (Task 6 changed code imported into the frame bootstrap). `pnpm run studio` → `localhost:5556`.

- [ ] **Step 2: Open a project with frames.** Click the crosshair on a frame to start picking.

- [ ] **Step 3: Hover.** Move over elements. Expected: design-mode's hover outline (blue) tracks the element; the W×H badge and margin (red) / padding (green) bands show; dashed measure guides render. NOT the old thin 2px blue box.

- [ ] **Step 4: Select.** Click an element. Expected: the orange selection box paints with its W×H badge; the inspector panel opens (v2 behavior unchanged); picking stays active (bulk).

- [ ] **Step 5: Zoom check (the coordinate-model risk).** Zoom the canvas in and out (the viewport zoom control). Expected: the overlay stays aligned to elements at every zoom level — no drift, no offset. This is the single thing the coordinate-model decision had to get right.

- [ ] **Step 6: Scroll check.** If a frame scrolls internally, scroll it while hovering. Expected: overlay re-measures and stays on the element.

- [ ] **Step 7: Teardown.** Press Esc / close the inspector. Expected: all overlay nodes (`dm-*`) gone, crosshair cursor cleared, no leftover guides.

- [ ] **Step 8: Record** before/after screenshots in the PR description (old thin outline vs. the rich overlay, plus a zoomed shot proving alignment). No commit for this task.

---

## Self-Review

**Spec coverage:**
- Lift overlays.ts (hover/selection/W×H/bands) → Task 2. ✓
- Lift measure-guides passive (dashed guides + distance pills) → Task 3. ✓
- Lift layout-guides (grid/column) → Task 4. ✓
- Geometry helpers + viewport-coord adaptation → Task 1 + the absolute→fixed edits in Tasks 2/3/4. ✓
- Colors from overlayConfig not chrome.storage → Task 1 (config) + Task 2 (consumed). ✓
- picker keeps brains, drops drawing, calls facade → Tasks 5 (facade) + 6 (rewire). ✓
- Passive only (no resize handles/drag) → Task 3 strips them explicitly; Global Constraints. ✓
- MIT attribution + THIRD-PARTY.md → Task 1 + per-file headers in 2/3/4/5. ✓
- Coordinate model (fixed + viewport rect + parent zoom) → Task 1 getElementRect + Task 7 step 5 verifies. ✓
- No commit-path change / batch-model untouched → no task touches inspector/context/preamble; full suite green gates it. ✓
- Error handling (zero-size hide, overlay-not-pickable) → zero-size guard inherited from lifted overlays.ts; isOverlayElement guard wired in Task 6 onMouseOver. ✓

**Placeholder scan:** No TBD/TODO. Tasks 3 & 4 note that test *selectors* may need aligning to the real lifted markup — that's explicit guidance (assert behavior, align the selector to transcribed code), not a placeholder; the assertions are concrete. Task 6 step 5 explicitly says skip-or-note rather than fake a test.

**Type consistency:** `Rect`/`getElementRect`/`hexToRgba`/`Z_INDEX` defined in Task 1, consumed in 2/3/4/5. Facade API (`setEnabled`/`showHover`/`showSelection`/`reposition`/`clear`/`isOverlayElement`) defined in Task 5, consumed in Task 6. overlays.ts exports (`showHover`→aliased `paintHover`, `showSelect`, `hideHover`, `hideSelect`, `updateSelectPosition`, `destroyOverlays`, `resetOverlayTeardown`, `isOverlayElement`) consumed by the facade with matching names. measureGuides exports (`showAxisGuides`/`hideAxisGuides`/`teardownMeasureGuides`/`resetMeasureTeardown`) consumed by the facade.

**Known risk flagged for implementer:** Tasks 2–4 are transcription-from-source — the implementer MUST read each `/tmp/design-mode-src` file before writing, because the line numbers in this plan are approximate and the strip-list for measure-guides must be applied carefully (keep passive, drop interactive). The coordinate-model `absolute→fixed` swap is the one semantic change and must be applied to every positioned overlay element in all three lifted files. If `/tmp/design-mode-src` is missing, re-clone (command in Source reference).
