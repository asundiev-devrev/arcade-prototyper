# Edit Reliability — Resilient Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A designer can never break their prototype — or see it break — by asking for a change. Broken edits are held off-screen; the last-good render stays up with a calm "Refining…" chip while auto-repair fixes it in the background.

**Architecture:** Replace the shell-wide Vite `full-reload` (which destroys the viewport) with a **targeted per-frame reload** via a custom Vite HMR event, so `FrameCard` survives and can **double-buffer** its iframe: load the incoming frame hidden, swap only on a positive `frame-ready` mount signal, else keep the last-good render visible. A reload **nonce** correlates mount/error messages to the incoming iframe. The validation hook is demoted to an import-only background corrector.

**Tech Stack:** TypeScript, React, Vite 8 (rolldown-vite, dev-server in prod), Node, Vitest. Frames render in iframes served by a Vite middleware plugin.

## Global Constraints

- Package manager **pnpm**. Full suite: `pnpm run studio:test` (~90s, run before finishing). Single file: `pnpm run studio:test <path>`. **The suite flakes under machine load — a "failure" that passes in isolation is contention, not a regression; clear orphaned ports on 9223-9232 if `wsServer`/bridge tests fail.**
- **`command git` for ALL git** — an `rtk` hook fails integrity check and blocks bare `git`. Same for a `git`/`grep`/`node` call that gets intercepted.
- **Invariant:** the packaged app runs the **Vite dev server** (`electron/viteRunner.ts` spawns `vite`), which is why `import.meta.hot` exists in production. Do not switch to a prod build — Layer 0 dies if you do.
- **Two invariants Layer 0 must never optimize away** (or the edit silently doesn't apply — "it wasn't listening"): (a) keep `invalidateFileInModuleGraph` on the written file + its `index.tsx` before signalling; (b) the targeted reload must **refetch the frame HTML endpoint** (full iframe document load), not a soft HMR poke.
- **Custom HMR event name:** `arcade-studio:frame-changed`, payload `{ slug, frameId }`. Sent server→client via `server.ws.send({ type: "custom", event, data })`, received via `import.meta.hot.on(event, cb)`.
- **Layer 0 ships and is testable standalone** (it's a win on its own: ends the jarring full-app reload per edit). A/A.1/C build on it. Do not entangle.

---

## Task 1: Targeted per-frame reload — server side (Layer 0, server half)

**Files:**
- Modify: `studio/server/plugins/projectWatchPlugin.ts:111` (the `full-reload` send)
- Test: `studio/__tests__/server/plugins/projectWatchPlugin.test.ts`

**Interfaces:**
- Produces: on a frame-source write, the server emits `server.ws.send({ type: "custom", event: "arcade-studio:frame-changed", data: { slug, frameId } })` **instead of** `{ type: "full-reload", path: "*" }`. Module-graph invalidation is unchanged (runs before the send).

- [ ] **Step 1: Write the failing test**

Add to `studio/__tests__/server/plugins/projectWatchPlugin.test.ts` (follow the file's existing harness — it constructs a fake `server` with a spy `ws.send` and drives the chokidar `all` handler; mirror an existing frame-write test):

```typescript
it("sends a targeted frame-changed custom event (not full-reload) on a frame-source write", async () => {
  const sent: any[] = [];
  const server = makeFakeServer({ wsSend: (m: any) => sent.push(m) }); // reuse existing helper
  await triggerWatch(server, "add", frameFile("proj", "01-frame", "index.tsx")); // existing helper
  const reloads = sent.filter((m) => m.type === "full-reload");
  const targeted = sent.filter((m) => m.type === "custom" && m.event === "arcade-studio:frame-changed");
  expect(reloads).toEqual([]); // no shell-wide reload
  expect(targeted).toHaveLength(1);
  expect(targeted[0].data).toEqual({ slug: "proj", frameId: "01-frame" });
});
```

If the file's helpers differ, adapt to its real shape (read the top of the test file first); do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/plugins/projectWatchPlugin.test.ts`
Expected: FAIL — server still sends `full-reload`.

- [ ] **Step 3: Replace the send (keep invalidation)**

In `projectWatchPlugin.ts`, the `if (isFrameSource) { … }` block — keep both `invalidateFileInModuleGraph` calls exactly as-is, replace only the final send:

```typescript
            invalidateFileInModuleGraph(server, filePath);
            invalidateFileInModuleGraph(
              server,
              path.join(projectsRoot(), slug, "frames", frameId, "index.tsx"),
            );
            // Targeted per-frame reload: the shell + other frames + chat + scroll
            // stay alive; only the changed frame's iframe refetches. Replaces the
            // shell-wide `full-reload` that destroyed the viewport on every edit.
            server.ws.send({
              type: "custom",
              event: "arcade-studio:frame-changed",
              data: { slug, frameId },
            });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/plugins/projectWatchPlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/server/plugins/projectWatchPlugin.ts studio/__tests__/server/plugins/projectWatchPlugin.test.ts
command git commit -m "feat(studio/viewport): targeted frame-changed event replaces shell full-reload (server)"
```

---

## Task 2: Targeted per-frame reload — shell + FrameCard (Layer 0, client half)

**Files:**
- Modify: `studio/src/main.tsx` (register the hot listener → dispatch a window event)
- Modify: `studio/src/components/viewport/FrameCard.tsx` (nonce state in `frameUrl`; reload on matching event)
- Test: `studio/__tests__/components/viewport/frame-card-reload.test.tsx` (new)

**Interfaces:**
- Consumes: `arcade-studio:frame-changed` custom HMR event (Task 1).
- Produces: a browser `CustomEvent("arcade-studio:frame-changed", { detail: { slug, frameId } })` dispatched on `window`; `FrameCard` listens, and when `slug`+`frameId` match its own frame, bumps a reactive `reloadNonce` that is appended to `frameUrl` as `&n=<nonce>` → the iframe refetches.

- [ ] **Step 1: Write the failing test**

```typescript
// studio/__tests__/components/viewport/frame-card-reload.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FrameCard } from "../../../src/components/viewport/FrameCard";
// mock @xorkavi/arcade-gen + edit-session context per the repo's existing
// FrameCard/ProjectDetail test mocks (copy the mock block from an existing
// viewport/inspector test — keep it in sync).

describe("FrameCard targeted reload", () => {
  it("bumps the iframe src nonce when a matching frame-changed event fires", () => {
    const { container } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01-frame", name: "F" } })} />);
    const iframe = container.querySelector("iframe")!;
    const before = iframe.getAttribute("src")!;
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01-frame" } }));
    const after = iframe.getAttribute("src")!;
    expect(after).not.toBe(before);
    expect(after).toMatch(/[?&]n=/);
  });

  it("ignores frame-changed for a different frame", () => {
    const { container } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01-frame", name: "F" } })} />);
    const iframe = container.querySelector("iframe")!;
    const before = iframe.getAttribute("src")!;
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "02-other" } }));
    expect(iframe.getAttribute("src")).toBe(before);
  });
});
```

`baseProps` is a local helper supplying FrameCard's required props with test doubles — build it from FrameCard's actual prop signature (read the component's props type); do not guess prop names.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: FAIL (no nonce in src; event ignored).

- [ ] **Step 3: Shell listener in `main.tsx`**

Add before `void boot();`:

```typescript
// Targeted per-frame reload: the server sends `arcade-studio:frame-changed`
// over Vite's custom-HMR channel instead of a shell-wide full-reload. Re-emit
// it as a window CustomEvent so the matching FrameCard can reload just its own
// iframe. import.meta.hot exists because the packaged app runs the dev server.
if (import.meta.hot) {
  import.meta.hot.on("arcade-studio:frame-changed", (data: { slug: string; frameId: string }) => {
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: data }));
  });
}
```

- [ ] **Step 4: FrameCard — nonce state + listener + src**

In `FrameCard.tsx`, add near the other `useState`s:

```typescript
  const [reloadNonce, setReloadNonce] = useState(0);
```

Add an effect (near the other effects; deps exactly as shown):

```typescript
  // Targeted reload: when the server signals THIS frame changed, bump the nonce
  // so the iframe refetches — the shell and other frames stay alive.
  useEffect(() => {
    function onFrameChanged(e: Event) {
      const detail = (e as CustomEvent).detail as { slug?: string; frameId?: string };
      if (detail?.slug === projectSlug && detail?.frameId === frame.slug) {
        setReloadNonce((n) => n + 1);
      }
    }
    window.addEventListener("arcade-studio:frame-changed", onFrameChanged);
    return () => window.removeEventListener("arcade-studio:frame-changed", onFrameChanged);
  }, [projectSlug, frame.slug]);
```

Change `frameUrl` to carry the nonce (nonce `0` still bumps the src vs a nonce-less URL, but only emit `&n=` when >0 to keep first render clean):

```typescript
  const frameUrl = `/api/frames/${projectSlug}/${frame.slug}?mode=${projectMode}${reloadNonce ? `&n=${reloadNonce}` : ""}`;
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Manual smoke (Layer 0 win on its own)**

`pnpm run studio`, open a project with 2+ frames, edit one via chat. Confirm: only that frame's iframe reloads; the shell chrome, chat pane, scroll position, and the OTHER frames do NOT flicker/reload. (Before this change, the whole app hard-reloaded.)

- [ ] **Step 7: Commit**

```bash
command git add studio/src/main.tsx studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/viewport/frame-card-reload.test.tsx
command git commit -m "feat(studio/viewport): FrameCard reloads its own iframe on frame-changed (client)"
```

---

## Task 3: Stale-state teardown on targeted reload (Layer 0.1 — the regression the fix introduces)

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx` (teardown + picker re-arm on reload of the active frame)
- Test: `studio/__tests__/components/viewport/frame-card-reload.test.tsx`

**Interfaces:**
- Consumes: `clear` and `frameSlug`/`batch` from `useEditSession()` (already destructured in FrameCard); `picking` state (already present).
- Produces: on a `frame-changed` reload where this frame is the active edit-session frame, `clear()` is called (nulls the stale `frameWindow` + drops the batch whose element-ids/line-cols are now stale — prevents silent no-op previews AND wrong-node writes); if `picking` was true, `frame-pick-start` is re-posted to the new iframe.

**Context:** `FrameCard` now survives the reload, so a surviving edit batch holds ids/line-cols bound to the pre-reload DOM → preview posts no-op and field edits can write the wrong JSX node (silent corruption). `clear()` (`editSessionContext.tsx:124`) resets batch + `frameWindow`. The picker effect only arms on mount, so the reloaded iframe's picker stays inactive unless re-posted.

- [ ] **Step 1: Write the failing test**

```typescript
  it("clears the edit session when the ACTIVE frame reloads (stale ids/window)", () => {
    const clear = vi.fn();
    render(<FrameCard {...baseProps({
      projectSlug: "proj", frame: { slug: "01-frame", name: "F" },
      editSession: { frameSlug: "01-frame", batch: [{ selection: { editId: 1 } }], clear },
    })} />);
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01-frame" } }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does NOT clear when a different frame reloads", () => {
    const clear = vi.fn();
    render(<FrameCard {...baseProps({
      projectSlug: "proj", frame: { slug: "02-other", name: "O" },
      editSession: { frameSlug: "01-frame", batch: [{ selection: { editId: 1 } }], clear },
    })} />);
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01-frame" } }));
    expect(clear).not.toHaveBeenCalled();
  });
```

Extend `baseProps` to let a test inject an `editSession` mock (wire it into the `useEditSession` mock the test file already sets up).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: FAIL — `clear` not called.

- [ ] **Step 3: Add teardown to the reload effect**

Extend the Task-2 `onFrameChanged` handler:

```typescript
    function onFrameChanged(e: Event) {
      const detail = (e as CustomEvent).detail as { slug?: string; frameId?: string };
      if (detail?.slug !== projectSlug || detail?.frameId !== frame.slug) return;
      // This frame's DOM is about to be rebuilt. Any active edit batch on THIS
      // frame holds element-ids + line/cols bound to the old DOM — stale after
      // the agent edit that triggered the reload. Keeping them risks silent
      // no-op previews and, worse, field edits writing the WRONG JSX node. Tear
      // the session down (also nulls the detached frameWindow).
      if (sessionFrameSlug === frame.slug) clear();
      setReloadNonce((n) => n + 1);
    }
```

Re-arm the picker: in the picker effect's dependency array (the `useEffect` gated on `picking`), add `reloadNonce` so it re-posts `frame-pick-start` to the fresh iframe after a reload while picking is active. (Locate the effect — it posts `{ type: "arcade-studio:frame-pick-start" }` — and append `reloadNonce` to its deps.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
command git add studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/viewport/frame-card-reload.test.tsx
command git commit -m "fix(studio/viewport): tear down stale edit-session + re-arm picker on targeted reload"
```

---

## Task 4: Positive clean-mount signal with nonce (Layer A.1)

**Files:**
- Modify: `studio/server/plugins/frameMountPlugin.ts` (bootstrap tree: emit `frame-ready`; nonce read from `location.search`; errorShim nonce)
- Modify: `studio/src/frame/FrameErrorBoundary.tsx` (nonce on `frame-error`)
- Test: `studio/__tests__/server/plugins/frameMountPlugin.test.ts` (assert the emitted source contains the ready-signal + nonce read)

**Interfaces:**
- Produces: the iframe posts `{ type: "arcade-studio:frame-ready", slug, frame, n }` from the happy-path mount only (a sibling mount-effect of `<Frame/>` inside the error boundary); `n` is read from `window.location.search`. All THREE `frame-error` emitters (React boundary, and the `errorShim` `onerror`/`unhandledrejection`) also carry `n`.

**Context:** `buildFrameBootstrapSource` builds the tree (`<FrameErrorBoundary><Frame/></FrameErrorBoundary>` at ~`:281`); the inline `errorShim` (`:54-131`) posts `frame-error` on `window.onerror` — that's the handler for undefined-ref/module-load crashes (Gil's case), so it MUST carry the nonce. StrictMode is on → guard the ready post with a module-scope flag.

- [ ] **Step 1: Write the failing test**

Add to `frameMountPlugin.test.ts` (it already unit-tests `buildFrameBootstrapSource` output — mirror that):

```typescript
it("bootstrap emits a happy-path frame-ready with the location nonce", () => {
  const src = buildFrameBootstrapSource({ absFrame: "/x/index.tsx", absOverrides: "/x/o.css", mode: "light", slug: "proj", frame: "01" });
  expect(src).toContain("arcade-studio:frame-ready");
  expect(src).toMatch(/location\.search|URLSearchParams/); // reads its own nonce
  expect(src).toMatch(/__arcadeFrameReadyPosted|readyPosted/); // idempotency guard
});

it("errorShim frame-error carries the nonce", () => {
  // renderFrameShellHtml embeds the errorShim; assert it reads the nonce + includes it
  const html = renderFrameShellHtml({ title: "t", mode: "light", overridesUrl: "", bootstrapUrl: "/b", errorScopeJson: { slug: "proj", frame: "01" } });
  expect(html).toContain("arcade-studio:frame-error");
  expect(html).toMatch(/location\.search|URLSearchParams/);
});
```

(If `renderFrameShellHtml` isn't exported, export it — it's already indirectly tested; a direct export is a benign test-seam addition.)

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/plugins/frameMountPlugin.test.ts`
Expected: FAIL — no ready signal / no nonce.

- [ ] **Step 3: errorShim — read + attach nonce**

In `renderFrameShellHtml`'s `errorShimScript`, near the top of the IIFE add a nonce read, and include it in the `postMessage`:

```javascript
      var NONCE = new URLSearchParams(location.search).get("n") || "";
```
In `showFatal`'s `postMessage`, add `n: NONCE` alongside `slug`/`frame`/`message`/`stack`.

- [ ] **Step 4: Bootstrap — happy-path ready signal**

In `buildFrameBootstrapSource`, render a mount-effect sibling of `<Frame/>` inside the boundary, and post once. Add to the generated module source (the returned template string), a small component + include it in the tree:

```javascript
    const __N = new URLSearchParams(location.search).get("n") || "";
    let __arcadeFrameReadyPosted = false;
    function ArcadeFrameReady() {
      React.useEffect(() => {
        if (__arcadeFrameReadyPosted) return;      // StrictMode double-invoke guard
        __arcadeFrameReadyPosted = true;
        window.parent && window.parent.postMessage(
          { type: "arcade-studio:frame-ready", slug: ${slugJson}, frame: ${frameJson}, n: __N }, "*");
      }, []);
      return null;
    }
```
And render it as a sibling AFTER `<Frame/>` inside `<FrameErrorBoundary>`:
```jsx
    <FrameErrorBoundary slug={…} frame={…}>
      <Frame />
      <ArcadeFrameReady />
    </FrameErrorBoundary>
```
(If `Frame` throws in render, React discards the whole subtree's effects → `ArcadeFrameReady`'s effect never runs → no false ready. The boundary's fallback is a separate tree.)

- [ ] **Step 5: FrameErrorBoundary — nonce on its post**

In `FrameErrorBoundary.tsx` `componentDidCatch`, add `n: new URLSearchParams(window.location.search).get("n") || ""` to the posted object.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/plugins/frameMountPlugin.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
command git add studio/server/plugins/frameMountPlugin.ts studio/src/frame/FrameErrorBoundary.tsx studio/__tests__/server/plugins/frameMountPlugin.test.ts
command git commit -m "feat(studio/frame): happy-path frame-ready signal + reload nonce on all mount/error posts"
```

---

## Task 5: Double-buffer + hold-last-good + "Refining…" chip + terminal timer (Layer A + C)

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx` (two-iframe double-buffer; nonce-correlated swap/keep; chip; client timer)
- Test: `studio/__tests__/components/viewport/frame-card-reload.test.tsx`

**Interfaces:**
- Consumes: `frame-ready`/`frame-error` messages (Task 4) carrying `n`; `reloadNonce` (Task 2).
- Produces: an incoming hidden iframe at the bumped src; on a nonce-matched `frame-ready` → swap (incoming becomes visible, old discarded); on a nonce-matched `frame-error` → discard incoming, keep last-good, show "Refining your change…" chip; a bounded client timer flips the chip to a terminal "couldn't fix it" state; a later nonce-matched `frame-ready` un-terminals and swaps.

**Context (decisions locked by the spec):** two-iframe path (not snapshot). The hidden incoming iframe must be `pointer-events:none` so its gestureForwarder/picker don't double-fire. Double `/api/runtime-error` from both iframes is de-duped by the per-frame rate-limit in `buildErrorReporter.ts` — do not remove that. Timer floor must exceed real repair latency (a repair is a full claude turn + 60s rate-limit); start with **90s**, tunable (see Manual acceptance). Terminal is driven by wall-clock since the failed edit, not attempt count.

- [ ] **Step 1: Write the failing tests**

```typescript
  it("keeps the last-good iframe visible and shows the chip on a nonce-matched frame-error", () => {
    const { container, getByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01", name: "F" } })} />);
    // trigger a reload → nonce becomes 1
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    // incoming iframe errors with the CURRENT nonce
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "Select is not defined" } }));
    expect(getByText(/refining your change/i)).toBeInTheDocument();
    // the visible (last-good) iframe is still the pre-reload one (not swapped)
    // assert via a data attribute the component sets on the active iframe
    expect(container.querySelector("iframe[data-frame-active='true']")).toBeTruthy();
  });

  it("ignores a stale-nonce message from the outgoing iframe", () => {
    const { queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01", name: "F" } })} />);
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } })); // nonce=1
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "0", message: "old" } }));
    expect(queryByText(/refining your change/i)).toBeNull(); // nonce 0 != current 1
  });

  it("swaps and clears the chip on a nonce-matched frame-ready", () => {
    const { queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01", name: "F" } })} />);
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "x" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-ready", slug: "proj", frame: "01", n: "1" } }));
    expect(queryByText(/refining your change/i)).toBeNull();
  });

  it("goes terminal after the timer, and recovers if a late frame-ready arrives", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: { slug: "01", name: "F" }, refineTimeoutMs: 90_000 })} />);
    window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "x" } }));
    vi.advanceTimersByTime(90_001);
    expect(getByText(/couldn't get that change right/i)).toBeInTheDocument();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-ready", slug: "proj", frame: "01", n: "1" } }));
    expect(queryByText(/couldn't get that change right/i)).toBeNull(); // late win un-terminals
    vi.useRealTimers();
  });
```

Add an optional `refineTimeoutMs` prop (default 90_000) so the test controls the timer.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement double-buffer + chip + timer**

In `FrameCard.tsx`, restructure the single iframe into a two-iframe buffer. State:

```typescript
  const [refineTimeoutMs] = useState(props.refineTimeoutMs ?? 90_000);
  // "committed" src is what's visible (last-good). "incoming" is the reload
  // being validated. nonce ties messages to the incoming load.
  const [committedSrc, setCommittedSrc] = useState(frameUrl);        // seed with initial
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null);
  const [chip, setChip] = useState<"none" | "refining" | "terminal">("none");
  const refineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

On `frame-changed` (extend the Task-3 handler): set a new nonce, set `incomingSrc` to the bumped URL (do NOT touch `committedSrc` yet), set `chip` to `"none"` (a fresh attempt starts hopeful — the chip only appears on error), and clear any existing terminal.

Message handler (new `useEffect` on `window` "message"), gated on nonce:

```typescript
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || d.slug !== projectSlug || d.frame !== frame.slug) return;
      if (String(d.n ?? "") !== String(reloadNonce)) return; // stale iframe — ignore
      if (d.type === "arcade-studio:frame-ready") {
        setCommittedSrc(incomingSrc ?? committedSrc); // swap incoming → visible
        setIncomingSrc(null);
        setChip("none");
        if (refineTimer.current) { clearTimeout(refineTimer.current); refineTimer.current = null; }
      } else if (d.type === "arcade-studio:frame-error") {
        setIncomingSrc(null);                          // discard broken incoming; keep last-good
        setChip("refining");
        if (refineTimer.current) clearTimeout(refineTimer.current);
        refineTimer.current = setTimeout(() => setChip("terminal"), refineTimeoutMs);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [projectSlug, frame.slug, reloadNonce, incomingSrc, committedSrc, refineTimeoutMs]);
```

Render both iframes; the committed one is visible (`data-frame-active="true"`), the incoming one hidden + non-interactive:

```jsx
  <iframe ref={iframeRef} data-frame-active="true" title={frame.name} src={committedSrc} onLoad={onIframeLoad} style={{ ... }} />
  {incomingSrc && (
    <iframe title={frame.name + " (loading)"} src={incomingSrc}
      style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }} aria-hidden />
  )}
  {chip !== "none" && (
    <div className="…chip styles…">
      {chip === "refining" ? "Refining your change…" : "I couldn't get that change right — tell me what you'd like instead"}
      {/* detail-on-tap disclosure; hidden by default */}
    </div>
  )}
```

Keep `iframeRef` bound to the committed (visible) iframe so the picker/inspector target the live frame. Clean up `refineTimer` on unmount.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/components/viewport/frame-card-reload.test.tsx`
Expected: PASS (all cases incl. terminal + recovery).

- [ ] **Step 5: Full suite**

Run: `pnpm run studio:test`
Expected: PASS (clear ports 9223-9232 first if bridge tests flake; re-run singly to confirm any "failure" is contention).

- [ ] **Step 6: Commit**

```bash
command git add studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/viewport/frame-card-reload.test.tsx
command git commit -m "feat(studio/viewport): double-buffer render — hold last-good + Refining chip + terminal timer"
```

---

## Task 6: Demote the validation hook to import-only + suppress the error overlay (Layer B)

**Files:**
- Modify: `studio/server/hooks/validateArcadeImports.mjs` (Edit → validate whole post-edit file for the IMPORT check; drop the JSX-reference check)
- Modify: `studio/vite.config.ts` (disable the global error overlay)
- Test: `studio/__tests__/server/hooks/validateArcadeImports.test.ts`

**Interfaces:**
- Produces: on an `Edit`, the hook reads the post-edit file from disk and runs `validateImports` on the whole file (falls back to `new_string` on read error); the whole-file `validateJsxReferences` block is removed (it false-blocks valid React — `as`-props, render-props, multi-binding const). Vite `server.hmr.overlay: false` so a frame parse error can't red-wall the shell.

**Context:** `extractContent` (`:536`) returns `new_string` for Edit. The hook fires POST-write so the file at `toolInput.file_path` is already the post-edit file — read it, don't reconstruct. Keep `Write` as-is (`content` is whole-file). The JSX-reference check (`validateJsxReferences`, `formatJsxErrorMessage`) is the false-positive source per review — remove its invocation in `main()` (keep the import check).

- [ ] **Step 1: Write the failing test**

```typescript
it("validates the whole post-edit FILE for imports on an Edit (not just new_string)", async () => {
  // write a file whose FULL content has a bad arcade import, but whose
  // new_string snippet alone looks clean
  const file = tmpFrame(`import { NotAThing } from "arcade/components";\nexport default () => <div/>;`);
  const res = await runHook({ tool_name: "Edit", tool_input: { file_path: file, old_string: "<div/>", new_string: "<div />" } });
  expect(res.exitCode).toBe(2);
  expect(res.stderr).toMatch(/NotAThing/);
});

it("does NOT block a valid render-prop / multi-binding component on edit (JSX-ref check removed)", async () => {
  const file = tmpFrame(`import { Button } from "arcade/components";\nconst A = 1, B = 2;\nexport default ({ as: C }) => <C><Button/></C>;`);
  const res = await runHook({ tool_name: "Edit", tool_input: { file_path: file, old_string: "<Button/>", new_string: "<Button />" } });
  expect(res.exitCode).toBe(0);
});
```

`tmpFrame` writes a temp `.tsx` and returns its path; `runHook` execs the hook with a JSON stdin payload and captures exit/stderr — build these from the existing test's harness (the file already spawns/invokes the hook; reuse it, and note the prior test at `:358` asserted the snippet path — update it to write a real file).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: FAIL — Edit path still reads `new_string`; JSX check still blocks the render-prop.

- [ ] **Step 3: Read post-edit file for imports; drop JSX check**

In `validateArcadeImports.mjs` `main()`, after resolving `filePath`, get the content to validate for imports from the FILE for edits:

```javascript
  const { readFileSync } = await import("node:fs");
  let content = extractContent(toolName, toolInput);   // Write: whole file already
  if (toolName === "Edit" && filePath) {
    try { content = readFileSync(filePath, "utf-8"); }  // hook is POST-write: file is post-edit
    catch { /* new-file/race: fall back to new_string (already in `content`) */ }
  }
  if (!content) process.exit(0);
  const { barrels, barrelPaths } = loadAllBarrels();
  const imports = parseImports(content);
  const importViolations = imports.length ? validateImports(imports, barrels) : [];
  // JSX-reference check REMOVED: whole-file scope false-blocks valid React
  // (as-props, render-props, multi-binding const). The import check is robust;
  // undefined-JSX crashes are now handled by resilient render, not this gate.
  if (importViolations.length === 0) process.exit(0);
  process.stderr.write(formatErrorMessage(importViolations, barrels, barrelPaths));
  process.exit(2);
```

Remove the `jsxViolations` block + its `formatJsxErrorMessage` chunk from `main()`. (Leave the exported functions in place — other tests import them — just stop invoking the JSX check in `main`.)

- [ ] **Step 4: Overlay off in `vite.config.ts`**

Add to the Vite `server` config: `hmr: { overlay: false }` (with a comment: a frame parse error broadcasts `vite:error` to all clients and would red-wall the shell; the overlay is global-only, and the packaged app has no dev overlay anyway; parse-error auto-repair via `buildErrorReporter` is server-side and unaffected).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/hooks/validateArcadeImports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
command git add studio/server/hooks/validateArcadeImports.mjs studio/vite.config.ts studio/__tests__/server/hooks/validateArcadeImports.test.ts
command git commit -m "feat(studio): whole-file import check on edits; drop false-blocking JSX check; disable global overlay"
```

---

## Task 7: Full suite + manual acceptance (Gil's scenario)

**Files:** none (verification)

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS. Re-run any failing file in isolation to confirm it's contention, not a regression.

- [ ] **Step 2: Manual acceptance — reproduce Gil's edit churn**

`pnpm run studio`, open a project with a working frame. Then, editing via chat:
- Ask for an edit that historically broke it (e.g. "change the filter to a dropdown", then "make the search the same height" — the Select↔Dropdown churn). Confirm: **the working prototype stays on screen** the whole time; on a broken intermediate edit you see the **"Refining your change…"** chip (not a white screen / red overlay); the fix lands and swaps in.
- Force an unfixable state (ask for something nonsensical) → confirm the chip goes **terminal** ("couldn't get that change right") within ~90s and the chat is usable.
- Confirm the **shell/chat/scroll never reload** during any edit.
- Tune `refineTimeoutMs` if 90s feels too long/short against observed repair latency.

- [ ] **Step 3: No version bump here** (per project convention, releases are a separate explicit step). If the whole feature is ready to ship, that's a `chore/studio-0.x.0` release cut, not part of this plan.

---

## Self-review notes (author)

- **Spec coverage:** Layer 0 = Tasks 1–2; Layer 0.1 = Task 3; Layer A.1 = Task 4; Layer A + C = Task 5; Layer B = Task 6; manual gate = Task 7. All spec layers mapped.
- **Review findings honored:** targeted reload keeps invalidation + HTML refetch (Global Constraints); errorShim carries the nonce (Task 4 Step 3 — the must-fix); batch teardown is REQUIRED not optional (Task 3); client-side timer with post-terminal recovery + 90s floor (Task 5); overlay suppression is global + acknowledged (Task 6); import-only hook, JSX check dropped (Task 6).
- **Type consistency:** the message contract `{ type, slug, frame, n }` is identical across Task 4 (emit) and Task 5 (consume); `reloadNonce` (number) is stringified for comparison against the message `n`.
- **Layer 0 ships alone:** Tasks 1–3 are a coherent, shippable, independently-valuable slice (kills the full-app-reload-per-edit) even before A/C land.
- **Known plan-time decision deferred to execution:** two-iframe vs snapshot is locked to two-iframe (spec); the exact chip styling + detail-disclosure markup follows the existing calm-panel visual language in `FrameErrorBoundary.tsx` (reuse its tokens).
