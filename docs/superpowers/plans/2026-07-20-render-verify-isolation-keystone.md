# Render-Verify Keystone v3 (Isolation Before/After) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch "agent claimed a visual change but the edit rendered nothing" (a prop the component silently ignores) by rendering the EDITED PAGE in isolation — before vs after the edit — and comparing fingerprints; on a confirmed no-op, fire one safe render-gated corrective.

**Architecture:** Server-orchestrated, client-rendered. On an EDIT turn that changed a `pages/*.tsx` file, the server (which already snapshots pre-edit sources + computes the changed-file diff at turn-end) bundles the edited page in ISOLATION twice — a synthetic `<Page/>` entry via the shipped `packFromDir` multi-file bundler, from the BEFORE source and the AFTER source. The client mounts each isolation bundle in a hidden same-origin iframe (the shipped `captureComponentThumb` pattern), lets it settle, and fingerprints it with the shipped `computeFingerprint`. Equal fingerprints ⇒ the edit rendered nothing ⇒ one-shot corrective turn ("your change didn't render — achieve it another way"), then an honest banner if it still no-ops. No live-app router in the loop → the multi-page trap that killed v1/v2 cannot recur (spike-proven on the real repro).

**Tech Stack:** TypeScript, Node ESM (server middleware + esbuild bundler), React (shell iframe render), Vitest + jsdom. No new deps (isolation render uses the shell's own browser — no Chromium/Playwright ship). Builds on shipped: `packFromDir` (`server/sidecar/packFromSource.ts`), `buildFrameBundle` (`server/cloudflare/bundler.ts`), `computeFingerprint`/`productionMeasure` (`src/frame/renderFingerprint.ts`), `captureComponentThumb` pattern (`src/components/assets/captureComponentThumb.ts`), the frame-change diff + `turnType` at `chat.ts:990-1009`, the corrective-turn shape (`handleVisualNoOpRetry`/`runClaudeBranch`).

## Global Constraints

- Package manager **pnpm**. Focused tests: `pnpm run studio:test <path>` from repo root `/Users/andrey.sundiev/arcade-prototyper`. Full suite `pnpm run studio:test` (~90s; `chat-figma-context.test.ts` + `wsServer.test.ts` are KNOWN pre-existing flakes — pass in isolation; `[ERROR]` lines are intentional esbuild fixtures; clear ports 9223-9232 if bridge tests flake).
- **`command git` for ALL git** (bare git intercepted by an rtk hook). Prefix intercepted `grep`/`node` with `command`.
- **NO `@xorkavi/arcade-gen` changes.** Component-agnostic by construction (reads the rendered result, not per-component prop knowledge).
- **NO new shipped dependency.** Isolation render uses the shell's own Chromium (same as `captureComponentThumb`, which ships in the DMG). Playwright/headless-Chromium must NOT enter the shipped path.
- **Cardinal rule: the corrective fires ONLY on a confirmed no-op** (before/after fingerprints equal). A false corrective on a real change is the sin that churned v1/v2 (ToggleGroup→ButtonGroup). Any ambiguity — page fails to render standalone, bundle error, missing before-source — **fails OPEN** (no corrective).
- **One-shot per originating user turn.** The corrective's own turn is NOT re-verified for a further corrective (hard stop at one) → no loop. Still-no-op after the corrective ⇒ honest soft banner.
- **Post-turn, not in-turn** (accepted bound): a false "done" may flash before the corrective. In-turn prevention needs a shipped browser — out of scope.
- **Trigger only on:** `turnType === "edit"` (a `pages/*.tsx` or frame file changed — from the server's existing `afterDiff`) AND the agent's summary claimed a change (`narrationClaimsVisualChange`). First-generation / no-claim / no-file-change → skip.
- Spec: `docs/superpowers/specs/2026-07-20-render-verify-isolation-keystone-design.md`. Spike-proven: className-swallow → identical fp; real change → different fp.
- **The two prior attempts (visual-noop, render-verify v1/v2) stay DISABLED** behind `RENDER_MEASUREMENT_FEATURES_ENABLED=false`. This is a new, separate path — do NOT re-enable them.

## File structure

| File | Responsibility |
|---|---|
| `server/editHistory.ts` (MODIFY) | Add a keyed source-cache for pre-edit page sources (the "before"). |
| `server/middleware/chat.ts` (MODIFY turn start + turn end) | Capture before-sources at turn start; at turn-end, if edit+claim+no-op, orchestrate the verification (delegates rendering to the client via a signal). |
| `server/renderVerifyIsolation.ts` (NEW) | Pure: build the synthetic-entry temp dir for (frameDir, targetPage, sourceVariant) → `packFromDir`; the corrective prompt; the one-shot key/guard; target-page resolution from the diff. |
| `server/middleware/chat.ts` — new route `POST /api/verify-render` | Given {slug, frame, targetPage, which} → return isolation HTML (before or after source). |
| `src/lib/renderVerifyClient.ts` (NEW) | Client: fetch before+after HTML, mount each in a hidden iframe, `computeFingerprint`, return {equal}. Mirrors `captureComponentThumb`. |
| `src/hooks/useProjectFromHost.ts` (MODIFY) | On turn-end (edit+claim), call the client verifier; on no-op → POST the corrective + reconnect (one-shot); drive the banner. |
| `src/components/chat/RenderMismatchBanner.tsx` (REUSE) | Honest-surrender banner when the corrective also renders nothing. |

**Architecture note (verified, drove this structure):** `chat.ts:990-1009` ALREADY computes `afterDiff` (changed files) + `turnType` ("edit"/"build"/"none") at turn-end. Target-page resolution + the edit-turn gate reuse that — no new diffing. The pre-edit *source* is the only thing not already captured (the existing `beforeSnapshot` is hash-only), so Piece 1 adds a source cache.

---

## Task 1: pre-edit source cache (`editHistory` extension)

**Files:**
- Modify: `studio/server/editHistory.ts`
- Test: `studio/__tests__/server/editHistory.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `cachePreTurnSources(slug: string, frameSlug: string, sources: Record<string, string>): void` — store the {relPath → source} map for a frame at turn start (overwrites any prior; one slot per slug+frame).
  - `getPreTurnSource(slug: string, frameSlug: string, relPath: string): string | null` — the cached before-source for one page file, or null.
  - `clearPreTurnSources(slug: string, frameSlug: string): void`.

**Context:** `editHistory.ts` today is `const stacks = new Map<string, string[]>()` with `pushSnapshot`/`popSnapshot` (undo, index.tsx-only). Add a SEPARATE map for the render-verify before-sources — do NOT overload the undo stack (different lifecycle: overwrite-per-turn, not a stack).

- [ ] **Step 1: Write the failing test**

Create/extend `studio/__tests__/server/editHistory.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  cachePreTurnSources,
  getPreTurnSource,
  clearPreTurnSources,
} from "../../server/editHistory";

describe("pre-turn source cache (render-verify before-sources)", () => {
  it("stores + retrieves a page source by rel path", () => {
    cachePreTurnSources("proj", "01-frame", {
      "pages/Preferences.tsx": "BEFORE_A",
      "pages/Skills.tsx": "BEFORE_B",
    });
    expect(getPreTurnSource("proj", "01-frame", "pages/Preferences.tsx")).toBe("BEFORE_A");
    expect(getPreTurnSource("proj", "01-frame", "pages/Skills.tsx")).toBe("BEFORE_B");
  });
  it("returns null for an uncached path/frame", () => {
    expect(getPreTurnSource("proj", "01-frame", "pages/Nope.tsx")).toBeNull();
    expect(getPreTurnSource("proj", "other", "pages/Preferences.tsx")).toBeNull();
  });
  it("overwrites on a new turn (one slot per slug+frame, not a stack)", () => {
    cachePreTurnSources("p2", "f", { "index.tsx": "v1" });
    cachePreTurnSources("p2", "f", { "index.tsx": "v2" });
    expect(getPreTurnSource("p2", "f", "index.tsx")).toBe("v2");
  });
  it("clears", () => {
    cachePreTurnSources("p3", "f", { "index.tsx": "x" });
    clearPreTurnSources("p3", "f");
    expect(getPreTurnSource("p3", "f", "index.tsx")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/editHistory.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Add to `studio/server/editHistory.ts`:

```typescript
/**
 * Pre-turn source cache for render-verify (the "before" render). Distinct from
 * the undo `stacks` above: one slot per slug+frame (overwritten each turn), and
 * it holds MULTIPLE files (every pages/*.tsx of the frame) so whichever page the
 * agent edits has a before-source. NOT a stack — render-verify only needs the
 * immediately-prior source, and only for the current turn.
 */
const preTurnSources = new Map<string, Record<string, string>>();

function preTurnKey(slug: string, frameSlug: string): string {
  return `${slug} ${frameSlug}`;
}

export function cachePreTurnSources(slug: string, frameSlug: string, sources: Record<string, string>): void {
  preTurnSources.set(preTurnKey(slug, frameSlug), { ...sources });
}

export function getPreTurnSource(slug: string, frameSlug: string, relPath: string): string | null {
  const m = preTurnSources.get(preTurnKey(slug, frameSlug));
  return m && Object.prototype.hasOwnProperty.call(m, relPath) ? m[relPath] : null;
}

export function clearPreTurnSources(slug: string, frameSlug: string): void {
  preTurnSources.delete(preTurnKey(slug, frameSlug));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/editHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/server/editHistory.ts studio/__tests__/server/editHistory.test.ts
command git commit -m "feat(studio/server): pre-turn source cache for render-verify before-sources"
```

---

## Task 2: renderVerifyIsolation — synthetic entry, target resolution, policy

**Files:**
- Create: `studio/server/renderVerifyIsolation.ts`
- Test: `studio/__tests__/server/renderVerifyIsolation.test.ts`

**Interfaces:**
- Consumes: `packFromDir` (`server/sidecar/packFromSource.ts`).
- Produces:
  - `SYNTHETIC_ENTRY(targetRelPath: string): string` — the isolation `index.tsx` source that renders the target page directly. For `"pages/Preferences.tsx"` → `import Page from "./pages/Preferences"; export default () => <Page/>;` (strip the `.tsx` ext; keep the `./` + subdir).
  - `resolveTargetPage(changedRelPaths: string[]): string | null` — pick the edited page from the frame-diff's changed files. v1: first path matching `pages/*.tsx`; if none but `index.tsx` changed → `"index.tsx"`; else null.
  - `buildIsolationHtml(frameDir: string, targetRelPath: string, targetSource: string): Promise<string>` — copy frameDir to a temp dir, overwrite the target page file with `targetSource`, overwrite `index.tsx` with `SYNTHETIC_ENTRY(target)`, `packFromDir` → HTML. (Mirrors the spike.)
  - `RENDER_VERIFY_CORRECTIVE_PROMPT: string` — the component-agnostic corrective (client sends it as the POST body prompt to the EXISTING route).
  - (NO one-shot here — the existing `server/renderVerify.ts` one-shot is reused by the live route; do not redefine.)

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/renderVerifyIsolation.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  SYNTHETIC_ENTRY,
  resolveTargetPage,
  RENDER_VERIFY_CORRECTIVE_PROMPT,
} from "../../server/renderVerifyIsolation";

describe("SYNTHETIC_ENTRY", () => {
  it("renders the target page directly, ext stripped, subdir kept", () => {
    const e = SYNTHETIC_ENTRY("pages/Preferences.tsx");
    expect(e).toContain('from "./pages/Preferences"');
    expect(e).not.toContain(".tsx");
    expect(e).toMatch(/export default \(\) => </);
  });
  it("handles a top-level index.tsx target", () => {
    expect(SYNTHETIC_ENTRY("index.tsx")).toContain('from "./index"');
  });
});

describe("resolveTargetPage", () => {
  it("picks the first pages/*.tsx", () => {
    expect(resolveTargetPage(["frames/01/pages/Preferences.tsx", "frames/01/index.tsx"]))
      .toBe("pages/Preferences.tsx");
  });
  it("falls back to index.tsx when no page changed", () => {
    expect(resolveTargetPage(["frames/01/index.tsx"])).toBe("index.tsx");
  });
  it("null when nothing frame-relevant changed", () => {
    expect(resolveTargetPage(["shared/devrev.ts"])).toBeNull();
    expect(resolveTargetPage([])).toBeNull();
  });
});

describe("corrective prompt", () => {
  it("is component-agnostic + says never-report-false", () => {
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/did ?n['’]?t (render|alter)|identical/i);
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/ignored|another way|different/i);
    expect(RENDER_VERIFY_CORRECTIVE_PROMPT).toMatch(/never (report|claim)/i);
  });
});
```

**REV-2 (plan review, Critical): do NOT define `renderVerifyAlreadyRan`/`markRenderVerifyRan` here.** They already exist in `server/renderVerify.ts:104-108` and are used by the LIVE `handleRenderVerifyRetry` route this feature reuses. Redefining them (here + the existing import in `chat.ts:42`) would be a duplicate binding. `renderVerifyIsolation.ts` exports ONLY `SYNTHETIC_ENTRY`, `resolveTargetPage`, `buildIsolationHtml`, `RENDER_VERIFY_CORRECTIVE_PROMPT`. The one-shot is the existing route's; the client-side per-turn guard is `rvV3Handled` (Task 5).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/renderVerifyIsolation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `studio/server/renderVerifyIsolation.ts`:

```typescript
/**
 * Render-verify keystone v3 — isolation before/after. Pure helpers + the temp-dir
 * bundling for isolation-rendering a single edited PAGE. See the spec.
 *
 * Why isolation: v1/v2 measured the LIVE iframe, which renders a multi-page
 * frame's DEFAULT page (renderPage(active)) — never the edited page. Rendering
 * the target page directly via a synthetic entry removes the router from the
 * loop. Spike-proven: className-swallow → identical fp, real change → different.
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { packFromDir } from "./sidecar/packFromSource";

/** The isolation index.tsx: render ONLY the target page, no sidebar/router. */
export function SYNTHETIC_ENTRY(targetRelPath: string): string {
  const noExt = targetRelPath.replace(/\.(tsx|ts)$/, "");
  return (
    `import * as React from "react";\n` +
    `import Page from "./${noExt}";\n` +
    `export default () => <Page />;\n`
  );
}

/** Pick the edited page from the frame diff's changed rel paths (project-root
 *  relative, e.g. "frames/01/pages/Preferences.tsx"). Returns a FRAME-relative
 *  path ("pages/Preferences.tsx" | "index.tsx") or null. */
export function resolveTargetPage(changedRelPaths: string[]): string | null {
  const pageRe = /(?:^|\/)frames\/[^/]+\/(pages\/[^/]+\.tsx)$/;
  for (const p of changedRelPaths) {
    const m = p.match(pageRe);
    if (m) return m[1];
  }
  const idxRe = /(?:^|\/)frames\/[^/]+\/(index\.tsx)$/;
  for (const p of changedRelPaths) {
    if (idxRe.test(p)) return "index.tsx";
  }
  return null;
}

/**
 * Build isolation HTML for one page variant: copy the real frame dir, overwrite
 * the target page with `targetSource`, overwrite index.tsx with the synthetic
 * entry, bundle via packFromDir. Returns the HTML string. Throws on bundle
 * failure (caller fails open).
 */
export async function buildIsolationHtml(
  frameDir: string,
  targetRelPath: string,
  targetSource: string,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rv-iso-"));
  try {
    await fs.cp(frameDir, tmp, { recursive: true });
    const target = path.join(tmp, targetRelPath);
    if (!path.resolve(target).startsWith(path.resolve(tmp))) throw new Error("path escape");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, targetSource, "utf-8");
    await fs.writeFile(path.join(tmp, "index.tsx"), SYNTHETIC_ENTRY(targetRelPath), "utf-8");
    return await packFromDir(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export const RENDER_VERIFY_CORRECTIVE_PROMPT =
  "Your last change did not alter the rendered result at all — the page renders " +
  "identically to before your edit. The property you set is being ignored by the " +
  "component. Achieve the intent a different way — a wrapper with real layout/utility " +
  "classes, or a different component — so it ACTUALLY renders. If the kit genuinely " +
  "can't do it, tell the user plainly what you couldn't do and why. Never report a " +
  "visual result the render doesn't show. Keep the response shape: a one-sentence " +
  "summary plus a ### Deviations section.";

// NOTE: no one-shot Set here. The corrective reuses the EXISTING route
// (chat.ts handleRenderVerifyRetry), whose one-shot lives in server/renderVerify.ts.
// Redefining renderVerifyAlreadyRan/markRenderVerifyRan here would duplicate that binding.
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/renderVerifyIsolation.test.ts`
Expected: PASS (the pure fns; `buildIsolationHtml` is exercised by the integration/manual gate — it needs the real bundler + a real frame, like the spike).

- [ ] **Step 5: Commit**

```bash
command git add studio/server/renderVerifyIsolation.ts studio/__tests__/server/renderVerifyIsolation.test.ts
command git commit -m "feat(studio/server): renderVerifyIsolation — synthetic entry, target resolution, corrective policy"
```

---

## Task 3: capture before-sources at turn start + the verify-render route

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Test: `studio/__tests__/server/verify-render-isolation-route.test.ts` (NEW)

**Interfaces:**
- Consumes: `cachePreTurnSources` (Task 1), `buildIsolationHtml`/`getPreTurnSource` (Tasks 1+2), the existing `beforeSnapshot` point (`chat.ts:866`).
- Produces:
  - At turn start (edit path, before `startTurn`): read every `frames/<frame>/pages/*.tsx` + `index.tsx` of the touched frame and `cachePreTurnSources`. (v1: cache for the frame the turn targets; if unknown at start, cache all frames' pages — cheap.)
  - `POST /api/verify-render { slug, frame, targetPage, which: "before" | "after" }` → `{ html }`. `which:"after"` reads the current on-disk page source; `which:"before"` reads `getPreTurnSource`. Both go through `buildIsolationHtml`. 404 if no before-source (fail open — client treats as "skip").

- [ ] **Step 1: Write the failing route test**

Create `studio/__tests__/server/verify-render-isolation-route.test.ts` (guard-level, mirroring `chat-visual-noop-route.test.ts` — the full render needs the bundler + a real frame, covered by the manual gate):

```typescript
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveTargetPage } from "../../server/renderVerifyIsolation";

// The route's happy path spawns the esbuild bundler + reads a real frame dir,
// so the unit layer asserts the pure pieces the route composes (target
// resolution + the before-source cache from Task 1). Real bundling → manual gate.
describe("verify-render route composition", () => {
  it("resolves the target page the route will render", () => {
    expect(resolveTargetPage(["frames/01-x/pages/Preferences.tsx"])).toBe("pages/Preferences.tsx");
  });
});
```

- [ ] **Step 2: Run to verify pass** (depends only on Task 2)

Run: `pnpm run studio:test studio/__tests__/server/verify-render-isolation-route.test.ts`
Expected: PASS.

- [ ] **Step 3: Capture before-sources at turn start**

In `chat.ts`, right after `beforeSnapshot` (`:866`), add a best-effort page-source cache. Read the touched frame's page files (or all frames if the target isn't yet known — cheap text reads) and cache them:

```typescript
// Render-verify (keystone v3): cache pre-edit page sources so turn-end can
// isolation-render the BEFORE state of whatever page the agent edits. Best-effort.
try {
  const framesRoot = path.join(projectDir(slug), "frames");
  const frameDirs = await fs.readdir(framesRoot, { withFileTypes: true }).catch(() => []);
  for (const fd of frameDirs) {
    if (!fd.isDirectory()) continue;
    const sources: Record<string, string> = {};
    for (const rel of ["index.tsx"]) {
      try { sources[rel] = await fs.readFile(path.join(framesRoot, fd.name, rel), "utf-8"); } catch {}
    }
    const pagesDir = path.join(framesRoot, fd.name, "pages");
    const pages = await fs.readdir(pagesDir).catch(() => []);
    for (const pf of pages) {
      if (!pf.endsWith(".tsx")) continue;
      try { sources[`pages/${pf}`] = await fs.readFile(path.join(pagesDir, pf), "utf-8"); } catch {}
    }
    if (Object.keys(sources).length) cachePreTurnSources(slug, fd.name, sources);
  }
} catch { /* best-effort — render-verify just skips if before-source missing */ }
```

(Imports: `cachePreTurnSources` from `../editHistory`; `fs`/`path` already imported — confirm.)

- [ ] **Step 4: Add the `/api/verify-render` route**

Add a URL const + dispatch (beside the other `/api/chat/*` POST routes) and a handler:

```typescript
const VERIFY_RENDER_URL = /^\/api\/verify-render$/;
// in the POST dispatch, before handleStart:
if (VERIFY_RENDER_URL.test(req.url)) return handleVerifyRender(req, res);
```

```typescript
async function handleVerifyRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let buf = ""; for await (const c of req) buf += c;
  let body: { slug?: string; frame?: string; targetPage?: string; which?: string };
  try { body = JSON.parse(buf); } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request" } })); return;
  }
  const { slug, frame, targetPage, which } = body;
  if (typeof slug !== "string" || typeof frame !== "string" || typeof targetPage !== "string" ||
      (which !== "before" && which !== "after")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_request" } })); return;
  }
  const frameDir = path.join(projectDir(slug), "frames", frame);
  let source: string | null;
  if (which === "before") {
    source = getPreTurnSource(slug, frame, targetPage);
  } else {
    source = await fs.readFile(path.join(frameDir, targetPage), "utf-8").catch(() => null);
  }
  if (source == null) { // no before-source (first gen) / file gone → fail open
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "no_source" } })); return;
  }
  try {
    const html = await buildIsolationHtml(frameDir, targetPage, source);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ html }));
  } catch {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bundle_failed" } })); // fail open
  }
}
```

(Imports: `getPreTurnSource` from `../editHistory`, `buildIsolationHtml` from `../renderVerifyIsolation`.)

- [ ] **Step 5: Run the route test + a chat-middleware smoke**

Run: `pnpm run studio:test studio/__tests__/server/verify-render-isolation-route.test.ts studio/__tests__/server/middleware/chat.test.ts`
Expected: PASS (no regression from the new dispatch/import).

- [ ] **Step 6: Commit**

```bash
command git add studio/server/middleware/chat.ts studio/__tests__/server/verify-render-isolation-route.test.ts
command git commit -m "feat(studio/server): cache pre-edit page sources + /api/verify-render isolation route"
```

---

## Task 4: client isolation-render + fingerprint compare

**Files:**
- Create: `studio/src/lib/renderVerifyClient.ts`
- Test: `studio/__tests__/lib/renderVerifyClient.test.ts` (pure decision only — real iframe render is manual-gate/spike-proven)

**Interfaces:**
- Consumes: `computeFingerprint`, `productionMeasure` (`src/frame/renderFingerprint.ts`); the `/api/verify-render` route (Task 3).
- Produces:
  - `renderIsolatedFingerprint(html: string): Promise<string | null>` — mount `html` in a hidden same-origin iframe via **`srcdoc`** (NOT `doc.write` — the bundle is an inline module script that doc.write executes unreliably → blank → false no-op), await load + settle, then `computeFingerprint(doc.body, productionMeasure)`. Null on any failure OR a **blank render below `NONBLANK_TEXT_FLOOR`** (fail open — a page that didn't mount in isolation must NOT read as a no-op).
  - `verifyRenderNoOp(slug, frame, targetPage): Promise<"no-op" | "changed" | "skip">` — fetch before+after HTML, fingerprint each; equal → "no-op", differ → "changed", any fetch/render failure → "skip" (fail open).

- [ ] **Step 1: Write the failing test**

`renderIsolatedFingerprint` needs a real browser (jsdom gives zero rects) — so extract the pure DECISION and test that; the render fn is manual-gate/spike territory:

Create `studio/__tests__/lib/renderVerifyClient.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decideNoOp } from "../../src/lib/renderVerifyClient";

describe("decideNoOp (pure)", () => {
  it("equal fingerprints → no-op", () => {
    expect(decideNoOp("abc", "abc")).toBe("no-op");
  });
  it("different → changed", () => {
    expect(decideNoOp("abc", "def")).toBe("changed");
  });
  it("null either side → skip (fail open — a blank/failed render is null, NOT a no-op)", () => {
    expect(decideNoOp(null, "abc")).toBe("skip");
    expect(decideNoOp("abc", null)).toBe("skip");
    expect(decideNoOp(null, null)).toBe("skip"); // two blank renders must NOT read as no-op → false corrective (cardinal sin)
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/lib/renderVerifyClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `studio/src/lib/renderVerifyClient.ts`:

```typescript
/**
 * Client half of render-verify v3: isolation-render the BEFORE and AFTER of an
 * edited page (HTML built server-side via /api/verify-render), fingerprint each
 * in a hidden same-origin iframe, and decide no-op vs changed. Uses the shell's
 * own browser — no shipped Chromium. Mirrors captureComponentThumb. See spec.
 */
import { computeFingerprint, productionMeasure } from "../frame/renderFingerprint";

/** Pure decision — extracted so it's unit-testable without a browser. */
export function decideNoOp(beforeFp: string | null, afterFp: string | null): "no-op" | "changed" | "skip" {
  if (!beforeFp || !afterFp) return "skip"; // fail open
  return beforeFp === afterFp ? "no-op" : "changed";
}

/** Minimum rendered text length for a render to count as non-blank. The spike
 *  saw textLen≈395 for a real page; a page that fails to mount in isolation
 *  renders near-empty. Two BLANK renders would fingerprint-EQUAL → a false
 *  "no-op" → a false corrective (the cardinal sin). So a render below this floor
 *  is treated as "couldn't render" → null → skip (fail open), NOT a no-op. */
export const NONBLANK_TEXT_FLOOR = 20;

/** Mount HTML in a hidden same-origin iframe, fingerprint its body, tear down.
 *  Null on any failure OR a blank render (fail open). Uses `srcdoc` (NOT
 *  doc.write): the bundle is an inline `<script type="module">`, and module
 *  scripts execute reliably via srcdoc but are engine-fragile via doc.write on
 *  an already-loaded iframe — a no-op write → blank render → false no-op. */
export async function renderIsolatedFingerprint(html: string): Promise<string | null> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1295px;height:900px;border:0;visibility:hidden;";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("iso load timeout")), 8000);
      iframe.addEventListener("load", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      iframe.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("iso load error")); }, { once: true });
      iframe.srcdoc = html;             // set AFTER listeners; triggers load
      document.body.appendChild(iframe);
    });
    // settle: fonts + a couple frames (large bundle mounts async)
    await new Promise((r) => setTimeout(r, 600));
    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!body) return null;
    // Blank-render floor: a page that didn't actually mount → skip, never no-op.
    if ((body.textContent ?? "").trim().length < NONBLANK_TEXT_FLOOR) return null;
    return computeFingerprint(body, productionMeasure);
  } catch {
    return null;
  } finally {
    iframe.remove();
  }
}

async function fetchHtml(slug: string, frame: string, targetPage: string, which: "before" | "after"): Promise<string | null> {
  try {
    const res = await fetch("/api/verify-render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, frame, targetPage, which }),
    });
    if (!res.ok) return null; // 404 no-source / 422 bundle-failed → skip
    const data = (await res.json()) as { html?: string };
    return typeof data.html === "string" ? data.html : null;
  } catch { return null; }
}

export async function verifyRenderNoOp(slug: string, frame: string, targetPage: string): Promise<"no-op" | "changed" | "skip"> {
  const [beforeHtml, afterHtml] = await Promise.all([
    fetchHtml(slug, frame, targetPage, "before"),
    fetchHtml(slug, frame, targetPage, "after"),
  ]);
  if (!beforeHtml || !afterHtml) return "skip";
  const [beforeFp, afterFp] = await Promise.all([
    renderIsolatedFingerprint(beforeHtml),
    renderIsolatedFingerprint(afterHtml),
  ]);
  return decideNoOp(beforeFp, afterFp);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/lib/renderVerifyClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/src/lib/renderVerifyClient.ts studio/__tests__/lib/renderVerifyClient.test.ts
command git commit -m "feat(studio/client): renderVerifyClient — isolation before/after fingerprint compare"
```

---

## Task 5: turn-end trigger + one-shot corrective + banner

**Files:**
- Modify: `studio/src/hooks/useProjectFromHost.ts` (turn-end trigger — a NEW effect, independent of the disabled v1/v2 effects)
- Modify: `studio/server/middleware/chat.ts` (populate a last-turn-meta store at turn-end + a GET route; the corrective route ALREADY EXISTS — reuse it)
- Reuse: `studio/src/components/chat/RenderMismatchBanner.tsx`
- Test: `studio/__tests__/components/render-verify-v3-trigger.test.ts`

**REV-2 (plan review, 1 Critical) — the v2 corrective route + one-shot ALREADY EXIST and are LIVE.** `RENDER_MEASUREMENT_FEATURES_ENABLED=false` gates only the CLIENT effects; the server still has `RENDER_VERIFY_RETRY_URL` + `handleRenderVerifyRetry` (`chat.ts:127,144,379-424`) + `renderVerifyAlreadyRan`/`markRenderVerifyRan` (`server/renderVerify.ts:104-108`). The existing handler reads `prompt` FROM THE BODY and runs it via `startTurn`+`runClaudeBranch` with its own per-userTurnId one-shot — which is EXACTLY what v3 needs. So: **reuse `/api/chat/render-verify-retry` verbatim, client passes the v3 corrective as `body.prompt`.** Do NOT add a route, do NOT redefine `renderVerifyAlreadyRan`/`markRenderVerifyRan`, and Task 2's `RENDER_VERIFY_CORRECTIVE_PROMPT` is a CLIENT-SENT string const (the client imports it from `renderVerifyIsolation.ts` and puts it in the POST body) — the server stays untouched for the corrective. This deletes the old Step 4 entirely.

**Interfaces:**
- Consumes: `verifyRenderNoOp` (Task 4); `narrationClaimsVisualChange`+`firstSummaryLine`; `RENDER_VERIFY_CORRECTIVE_PROMPT` (Task 2, client-imported as the POST body prompt); the SSE state (`phase`, `turnId`, `narrations`); the edit turn's `{turnType, frame, targetPage}` (from the new last-turn-meta route, Step 1). Reuses the EXISTING `POST /api/chat/render-verify-retry {slug, frame, userTurnId, prompt}`.
- Produces:
  - Server: a per-slug last-turn-meta store, populated in `runClaudeBranch` at turn-end (from `turnType` + `resolveTargetPage(afterDiff.changed)` + the touched frame) BEFORE `end()` fires, + `GET /api/chat/last-turn-meta/:slug` → `{ turnType, frame, targetPage }`.
  - Client: `shouldRunRenderVerify({ phase, isEditTurn, summaryClaimsChange, alreadyRan })` — pure gate.

- [ ] **Step 1: Server — last-turn-meta store + GET route (the review's under-specified channel — now fully specified)**

**REV-2 (plan review, Important): there is NO existing post-turn channel to the client.** Verified: the terminal `end` SSE event is a closed type `{kind:"end", ok}` (`streamJson.ts:66-67`) with no metadata slot; `/api/metrics` is an aggregate the client never fetches; the project record has no last-turn field. So build one, minimally:

- In `chat.ts`, add a module-level `const lastTurnMeta = new Map<string, { turnType: string; frame: string | null; targetPage: string | null }>()`.
- Populate it in `runClaudeBranch` right where `turnType`/`afterDiff` are computed (`chat.ts:1001-1017`), BEFORE the function returns / `end()` fires — so the client's `phase==="done"` fetch never races an empty store:
  ```typescript
  const changedFrame = afterDiff?.changed.find((p) => /^frames\//.test(p)) ?? afterDiff?.added.find((p) => /^frames\//.test(p)) ?? null;
  const frame = changedFrame ? changedFrame.split("/")[1] : null; // frames/<frame>/...
  const targetPage = afterDiff ? resolveTargetPage(afterDiff.changed) : null;
  lastTurnMeta.set(slug, { turnType, frame, targetPage });
  ```
  (`resolveTargetPage` imported from `../renderVerifyIsolation`.)
- Add `GET /api/chat/last-turn-meta/:slug` returning `lastTurnMeta.get(slug) ?? { turnType: "none", frame: null, targetPage: null }`.

**Implementer note:** confirm `runClaudeBranch` is the function holding `turnType`/`afterDiff` (`chat.ts:1001`) and that it runs for a normal edit turn (it does — it's the Claude branch). The store is best-effort; a miss → client reads `turnType:"none"` → skips (fail open).

- [ ] **Step 2: Write the failing gate test**

Create `studio/__tests__/components/render-verify-v3-trigger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldRunRenderVerify } from "../../src/hooks/renderVerifyGate";

describe("shouldRunRenderVerify", () => {
  const base = { phase: "done" as const, isEditTurn: true, summaryClaimsChange: true, alreadyRan: false };
  it("runs on edit-turn + done + claim + not-yet-run", () => {
    expect(shouldRunRenderVerify(base)).toBe(true);
  });
  it("skips non-done", () => {
    expect(shouldRunRenderVerify({ ...base, phase: "error" })).toBe(false);
  });
  it("skips non-edit (first-gen/build)", () => {
    expect(shouldRunRenderVerify({ ...base, isEditTurn: false })).toBe(false);
  });
  it("skips when the summary claimed no change", () => {
    expect(shouldRunRenderVerify({ ...base, summaryClaimsChange: false })).toBe(false);
  });
  it("skips when already run this turn", () => {
    expect(shouldRunRenderVerify({ ...base, alreadyRan: true })).toBe(false);
  });
});
```

- [ ] **Step 3: Implement the gate + wire the effect**

Create `studio/src/hooks/renderVerifyGate.ts`:

```typescript
/** Pure gate for render-verify v3. Fires only on an EDIT turn that claimed a
 *  change, once per turn. Bias to NOT firing (a missed verify is fine; a wasted
 *  corrective is the cost we avoid). */
export function shouldRunRenderVerify(input: {
  phase: "done" | "error" | "cancelled" | string;
  isEditTurn: boolean;
  summaryClaimsChange: boolean;
  alreadyRan: boolean;
}): boolean {
  return input.phase === "done" && input.isEditTurn && input.summaryClaimsChange && !input.alreadyRan;
}
```

In `useProjectFromHost.ts`, add a NEW turn-end effect (independent of the disabled v1/v2 effects — do NOT touch `RENDER_MEASUREMENT_FEATURES_ENABLED`). Fire-and-forget async with a cancelled guard, mirroring the shipped VN/RV effect structure (`useProjectFromHost.ts:224-240,304-319`):
- On `phase === "done"`: fetch `{turnType, frame, targetPage}` from `GET /api/chat/last-turn-meta/:slug` (Step 1). `isEditTurn = turnType === "edit" && !!frame && !!targetPage`. `summaryClaimsChange = narrationClaimsVisualChange(firstSummaryLine(chat.narrations))`.
- If `shouldRunRenderVerify({phase, isEditTurn, summaryClaimsChange, alreadyRan: rvV3Handled.current === turnId})` and NOT the corrective turn (`awaitingRvV3` false):
  - `const outcome = await verifyRenderNoOp(slug, frame, targetPage)`.
  - **After the await, bail if `cancelled` OR `chat.turnId` changed** (a new user turn landed during the ~1.2s verify — do NOT POST a corrective for a superseded turn). This is the async-in-effect guard — write it explicitly, don't just "mirror".
  - `"no-op"` → `rvV3Handled.current = turnId`, `awaitingRvV3.current = true`, `POST /api/chat/render-verify-retry { slug, frame, userTurnId: turnId, prompt: RENDER_VERIFY_CORRECTIVE_PROMPT }` (the EXISTING v2 route — prompt in body), then `chatStream.reconnect()`.
  - `"changed"`/`"skip"` → nothing (silent).
- When the corrective turn ends (`awaitingRvV3.current`): clear `awaitingRvV3`; re-run `verifyRenderNoOp` once (same cancelled/turn-changed guard); still `"no-op"` → `setRenderMismatchBannerForFrame(frame)`. Never POST again (hard stop — one corrective per user turn).
- Reset `rvV3Handled`/`awaitingRvV3`/`renderMismatchBannerForFrame` per new USER turn (add to the existing turn-transition reset effect / `resetPerTurn`, guarded so the corrective turn doesn't reset them).

**Implementer:** `RENDER_VERIFY_CORRECTIVE_PROMPT` is imported by the CLIENT from `renderVerifyIsolation.ts` and sent as `body.prompt` — the server route is UNCHANGED (it already accepts a body prompt). Keep the effect's state (`rvV3Handled`, `awaitingRvV3`) separate from VN's disabled state. Reuse `RenderMismatchBanner` + its render site.

- [ ] **Step 4: (server corrective route — NONE NEEDED)** The existing `POST /api/chat/render-verify-retry` (`chat.ts:379`) already accepts `{slug, frame, userTurnId, prompt}`, runs the prompt via `startTurn`+`runClaudeBranch`, and one-shots per userTurnId. The client just sends `RENDER_VERIFY_CORRECTIVE_PROMPT` as `prompt`. No server change for the corrective. (Server changes this task = ONLY the last-turn-meta store + GET route from Step 1.)

- [ ] **Step 5: Run the gate test + route smoke**

Run: `pnpm run studio:test studio/__tests__/components/render-verify-v3-trigger.test.ts studio/__tests__/server/renderVerifyIsolation.test.ts`
Expected: PASS. Type-check touched files: `node_modules/.bin/tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -iE "useProjectFromHost|renderVerify|chat.ts"` — no NEW errors.

- [ ] **Step 6: Commit**

```bash
command git add studio/src/hooks/renderVerifyGate.ts studio/src/hooks/useProjectFromHost.ts studio/server/middleware/chat.ts studio/__tests__/components/render-verify-v3-trigger.test.ts
command git commit -m "feat(studio): render-verify v3 turn-end trigger + one-shot corrective + banner"
```

---

## Task 6: full suite + wiring smoke

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test` (clear ports 9223-9232 first). Expected: PASS. Known pre-existing flakes: `chat-figma-context.test.ts`, `wsServer.test.ts` (both pass in isolation — verified pre-existing this session). Anything else is a real regression.

- [ ] **Step 2: Type-check**

Run: `node_modules/.bin/tsc --noEmit -p studio/tsconfig.json 2>&1 | grep -iE "renderVerify|useProjectFromHost|editHistory|packFromSource|chat.ts"` — confirm no NEW errors in touched files (pre-existing chat.ts `lastMetrics` errors are unrelated — verified this session).

- [ ] **Step 3: No commit** (nothing new).

---

## Task 7: Manual acceptance (running app — user) — THE REAL GATE

- [ ] **Step 1: The live no-op repro.** `pnpm run studio` (fully quit + restart — server + client changed). In `computer-settings`, navigate to Preferences. Ask: **"change the background of the General cards to purple"** (the className-swallow — `SettingsCard` drops `className`). **Expect:** the isolation before/after detects identical render → ONE corrective fires → the agent achieves it a different way (wrapper) so it ACTUALLY renders purple, OR (if it can't) the honest "doesn't match your request" banner. NOT a silent "done. Deviations: None" over an unchanged card.
- [ ] **Step 2: The orientation repro.** Ask "make the toggle groups vertical." **Expect:** same — corrective forces a real vertical render, or honest banner. NOT the constant-fingerprint false-pass v1/v2 had (this renders the isolated Preferences page directly, so it sees the real toggles).
- [ ] **Step 3: No false-fire on a REAL change.** Ask for a genuine visible change that the kit DOES honor (e.g. "add a heading above the timezone row"). **Expect:** before/after differ → NO corrective, NO banner. A false corrective here is the cardinal sin — report it.
- [ ] **Step 4: No fire on non-edit / no-claim.** A first-generation frame, or a turn where the agent honestly says "couldn't do X." **Expect:** no render-verify trigger.
- [ ] **Step 5: Report.** Capture: did the isolated page render non-blank (the spike says yes — confirm live)? Did the corrective fire only on genuine no-ops? Any false-fire on a real change (cardinal sin) or any churn?
- [ ] **Step 6: No version bump.** All edit-reliability features ship under ONE release once gates pass.

---

## Self-review notes (author)

- **Spec coverage:** Piece 1 (before-snapshot) = Task 1 + Task 3 Step 3; Piece 2 (isolation render + fingerprint) = Task 2 (server bundle) + Task 4 (client render+compare) + Task 3 (route); Piece 3 (one-shot corrective) = Task 5 + its route; banner = Task 5 (reuse). Scope gate (edit+claim) = Task 5 `shouldRunRenderVerify`. Bounds (fail-open, one-shot, post-turn) enforced in Tasks 3/4/5.
- **Spike-proven core:** the `SYNTHETIC_ENTRY` + `packFromDir` isolation render + `computeFingerprint` discrimination is exactly what the spike ran (className-swallow → equal, real change → differ). Task 2/4 encode that; the real render is the manual gate (jsdom can't bundle+render — same honest limit as every render feature, but this time the SPIKE already proved it live).
- **Type/name consistency:** `cachePreTurnSources`/`getPreTurnSource`/`clearPreTurnSources` (editHistory). `SYNTHETIC_ENTRY`/`resolveTargetPage`/`buildIsolationHtml`/`RENDER_VERIFY_CORRECTIVE_PROMPT`/`renderVerifyAlreadyRan`/`markRenderVerifyRan` (renderVerifyIsolation). `decideNoOp`/`renderIsolatedFingerprint`/`verifyRenderNoOp` (renderVerifyClient). `shouldRunRenderVerify` (renderVerifyGate). Routes: `/api/verify-render`, `/api/chat/render-verify-retry`.
- **Does NOT touch the disabled v1/v2** (`RENDER_MEASUREMENT_FEATURES_ENABLED` stays false) — this is a parallel, separately-gated path.
- **Known implementer judgment call (flagged, not a placeholder):** Task 5 Step 1 — the channel that carries `{turnType, frame, targetPage}` to the client post-turn. Named two concrete options (attach to turn metadata the client already reads, or a small `last-turn-meta` route); implementer picks by what the codebase already exposes. Everything else is copy-faithful to shipped patterns.

## Open questions (resolve during implementation)
1. **Turn-meta channel (Task 5 Step 1)** — reuse the existing turn-metrics surface vs a new `last-turn-meta` route. Pick the one that already reaches the client post-turn.
2. **Before-render caching** — the "before" HTML only changes when a new user turn starts; the plan rebuilds it each verify. If the double-bundle latency is felt (Task 6/7), cache the before-HTML per turn. Measure first (it's off the critical path — turn already ended).
3. **`doc.write` vs `srcdoc`** (Task 4) — `captureComponentThumb` uses `iframe.src` to a served URL; we have the HTML in hand, so `doc.write`/`srcdoc` avoids a round-trip. Confirm same-origin body access works with `srcdoc` (it does — same origin); if any quirk, fall back to a served blob URL.
