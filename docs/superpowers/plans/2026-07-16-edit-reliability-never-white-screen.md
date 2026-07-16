# Edit Reliability — Never White-Screen (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A frame that throws while ALREADY visible (a click/interaction/async error) never goes white — the errorShim keeps the intact rendered DOM and lays a calm status OVERLAY on top; only a genuinely-empty frame (module-load crash before React mounted) keeps today's full-panel.

**Architecture:** Change ONE function — the inline `errorShim`'s `showFatal` inside `renderFrameShellHtml` (`studio/server/plugins/frameMountPlugin.ts`). It currently posts `frame-error` then unconditionally `root.innerHTML=""` + injects a full-height panel. Make it: post `frame-error` (unchanged) → detect whether the frame actually rendered → if rendered, APPEND a non-destructive max-z-index overlay (never touch existing DOM); if empty, keep today's panel. Self-contained in the frame; no parent/`FrameCard` change (the parent chip stays gated as-is to avoid reintroducing the shipped false-"Refining" bug).

**Tech Stack:** Inline browser JS (the errorShim is a string built by `renderFrameShellHtml`), Vitest (asserts the generated shim source), TypeScript.

## Global Constraints

- Package manager **pnpm**. Focused test: `pnpm run studio:test studio/__tests__/server/plugins/frameMountPlugin.test.ts` from repo root `/Users/andrey.sundiev/arcade-prototyper`.
- **`command git` for ALL git** (bare git blocked by a failing rtk hook). Prefix any intercepted `grep`/`node` with `command`.
- **NEVER blank a rendered frame** — the whole point. The `innerHTML=""` path is allowed ONLY when the frame is genuinely empty (nothing rendered to protect).
- **The errorShim is SHARED** by `window.onerror` (interaction/async AND module-load-before-mount) and `unhandledrejection`. `showFatal` must branch on frame-rendered state, because module-load leaves `#root` empty (panel is the only content) while an interaction error leaves the DOM intact.
- **"Frame rendered" test:** `#root` has element children OR an app-owned portal container exists in `document.body` (kit modals/dialogs/toasts portal to body, leaving `#root` empty while visibly rendered). Use `document.getElementById("root")` childElementCount>0 OR a body-portal check — see Task 1 for the exact condition.
- **Overlay z-index is LOAD-BEARING (adversarial-review Important):** generated frames render `position:fixed` chrome + kit modals at high z-index. The overlay MUST be appended as a direct child of `#root` (or `document.body`) so it shares the root stacking context, with `z-index: 2147483647`, or the frame's own elements hide the message → silent frozen frame (the exact failure the goal forbids).
- **Idempotent:** the overlay is APPENDED (unlike the old `innerHTML=""` which was self-clearing), so a second error must not stack overlays — guard with a sentinel id.
- **Keep the `frame-error` postMessage unchanged** (same payload incl. `n: NONCE`) — it drives Viewport's auto-repair dispatch + the chat breadcrumb.
- **Do NOT touch** `FrameCard` / `editCycleActive` / the parent chip / `FrameErrorBoundary` — Phase 1 is the shim only. (Render-phase mid-multi-file crashes are Phase 2, separate.)
- **This feature's acceptance is a RUNNING-APP gate** (jsdom can't exercise a real click→overlay-over-live-frame). Unit tests assert the generated shim SOURCE; the visual "no white screen, banner above the modal" check is manual (Task 3).

---

## Task 1: errorShim keeps the DOM + overlays (never blanks a rendered frame)

**Files:**
- Modify: `studio/server/plugins/frameMountPlugin.ts` (the `errorShimScript` template inside `renderFrameShellHtml` — specifically `showFatal`, ~`:85-126`)
- Test: `studio/__tests__/server/plugins/frameMountPlugin.test.ts` (asserts the generated shim source; `renderFrameShellHtml` already exported + used there)

**Interfaces:**
- Produces: the generated errorShim's `showFatal`, when invoked in a frame with a mounted render, appends a `[data-arcade-status-overlay]` element (max z-index, calm styling) WITHOUT clearing `#root`; when the frame is empty, keeps the existing `innerHTML=""` panel. The `arcade-studio:frame-error` postMessage is unchanged.

**Context:** `showFatal` (`frameMountPlugin.ts`) already builds a calm `wrap`/dot/`title`/`sub`/`details` panel and does `root.innerHTML = ""; …; root.appendChild(wrap)`. The change reshapes this into two branches + turns the mounted-branch `wrap` into a positioned overlay. This is browser JS embedded in a template string — the tests assert the SOURCE contains/omits the right pieces (they can't execute it).

- [ ] **Step 1: Write the failing tests (assert the generated shim source)**

Add to `frameMountPlugin.test.ts` (it already imports `renderFrameShellHtml` and asserts shim substrings):

```typescript
describe("errorShim keeps the DOM (never white-screen)", () => {
  const html = renderFrameShellHtml({ title: "t", mode: "light", overridesUrl: "", bootstrapUrl: "/b", errorScopeJson: { slug: "proj", frame: "01" } });

  it("still posts frame-error with the nonce (unchanged)", () => {
    expect(html).toContain("arcade-studio:frame-error");
    expect(html).toMatch(/n:\s*NONCE/);
  });

  it("branches on whether the frame rendered (does NOT unconditionally wipe)", () => {
    // the mounted branch must be guarded by a rendered-state check, not a bare innerHTML=""
    expect(html).toMatch(/childElementCount|querySelector|children\.length/);
  });

  it("appends a max-z-index status overlay (does not rely on frame z-index)", () => {
    expect(html).toContain("data-arcade-status-overlay");
    expect(html).toMatch(/2147483647/);
  });

  it("is idempotent — checks for an existing overlay before appending", () => {
    // e.g. if (document.querySelector("[data-arcade-status-overlay]")) return;
    expect(html).toMatch(/querySelector\(\s*["'`]\[data-arcade-status-overlay\]/);
  });

  it("still keeps a panel for the empty (module-load) case", () => {
    // the empty branch retains innerHTML="" + the calm panel text
    expect(html).toContain("Auto-repairing this frame");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run studio:test studio/__tests__/server/plugins/frameMountPlugin.test.ts`
Expected: FAIL — no overlay/childElement/idempotency markers yet.

- [ ] **Step 3: Rewrite `showFatal` — branch + overlay**

Replace the body of `showFatal` AFTER the postMessage block (keep the postMessage exactly as-is). Replace from `var root = document.getElementById("root") || document.body;` through the final `root.appendChild(wrap);`:

```javascript
        // ── Never blank a rendered frame ──────────────────────────────────
        // This shim fires for BOTH an interaction/async error (React tree
        // mounted → #root has children → we must NOT destroy it) AND a
        // module-load crash before React mounts (#root empty → the panel is
        // the only content). Branch accordingly.
        var root = document.getElementById("root");
        // "Rendered" = #root has element children, OR the app painted via a
        // body portal (kit modals/dialogs/toasts leave #root empty). Any
        // portal element carries a data-radix-* / [role=dialog] marker on body.
        var rendered = !!root && (
          root.childElementCount > 0 ||
          !!document.body.querySelector("[data-radix-portal],[data-radix-popper-content-wrapper],[role='dialog']")
        );
        // Idempotent: never stack overlays/panels on a second error.
        if (document.querySelector("[data-arcade-status-overlay]")) return;

        // Shared calm content (dot + title + sub + details) — built once.
        function buildCalm(container, isOverlay) {
          var head = document.createElement("div");
          head.style.cssText = "display:flex;align-items:center;gap:10px;";
          var dot = document.createElement("span");
          dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;animation:arcade-frame-pulse 1.4s ease-in-out infinite;";
          var title = document.createElement("strong");
          title.textContent = isOverlay ? "Refining your change…" : "Auto-repairing this frame";
          title.style.cssText = "font-weight:600;color:#111827;";
          head.appendChild(dot); head.appendChild(title);
          var sub = document.createElement("div");
          sub.style.cssText = "color:#6b7280;font-size:12.5px;";
          sub.textContent = "We caught a " + (label === "Frame failed to load" ? "load" : "runtime") + " error and asked the agent to fix it. Watch the chat for an update.";
          var details = document.createElement("details");
          details.style.cssText = "margin-top:12px;color:#6b7280;font-size:12px;max-width:100%;";
          var summary = document.createElement("summary");
          summary.textContent = "Show technical details";
          summary.style.cssText = "cursor:pointer;color:#6b7280;";
          details.appendChild(summary);
          var pre = document.createElement("pre");
          pre.style.cssText = "margin-top:8px;padding:10px;background:#f3f4f6;border-radius:6px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7f1d1d;white-space:pre-wrap;overflow:auto;max-height:60vh;";
          pre.textContent = label + "\\n\\n" + msg + (stack ? "\\n\\n" + stack : "");
          details.appendChild(pre);
          container.appendChild(head); container.appendChild(sub); container.appendChild(details);
        }

        var keyframes = document.createElement("style");
        keyframes.textContent = "@keyframes arcade-frame-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }";
        document.head.appendChild(keyframes);

        if (rendered) {
          // KEEP the frame's DOM. Lay a calm status banner on top, pinned to a
          // corner, at max z-index so the frame's own fixed chrome / modals
          // cannot hide it. Appended to <body> (shares the top stacking
          // context) so no descendant z-index can cover it.
          var overlay = document.createElement("div");
          overlay.setAttribute("data-arcade-status-overlay", "");
          overlay.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:calc(100% - 24px);z-index:2147483647;padding:10px 12px;border-radius:10px;background:#fafafa;border:1px solid rgba(0,0,0,0.08);box-shadow:0 4px 16px rgba(0,0,0,0.12);font:12.5px/1.45 system-ui,-apple-system,sans-serif;color:#374151;display:flex;flex-direction:column;gap:6px;";
          buildCalm(overlay, true);
          document.body.appendChild(overlay);
        } else {
          // Empty frame (module-load crash, nothing rendered) — the panel IS
          // the content. Keep today's full-panel behavior.
          var host = root || document.body;
          host.innerHTML = "";
          var wrap = document.createElement("div");
          wrap.setAttribute("data-arcade-status-overlay", "");
          wrap.style.cssText = "padding:24px;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#374151;background:#fafafa;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:8px;";
          buildCalm(wrap, false);
          host.appendChild(wrap);
        }
```

(The sentinel `data-arcade-status-overlay` is set on BOTH the overlay and the empty-panel wrap, so the idempotency guard covers both. `buildCalm` de-dups the shared panel markup DRY.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run studio:test studio/__tests__/server/plugins/frameMountPlugin.test.ts`
Expected: PASS (all Step-1 cases + the pre-existing shim tests).

- [ ] **Step 5: Confirm no other assertion on the old wipe markup broke**

Run: `command grep -rn "Auto-repairing this frame\|innerHTML" studio/__tests__/server/plugins/frameMountPlugin.test.ts`
Any test that asserted the OLD unconditional wipe/panel must be reconciled with the two-branch behavior (the empty branch still says "Auto-repairing this frame"; the mounted branch says "Refining your change…"). Update or confirm as needed; re-run the file.

- [ ] **Step 6: Commit**

```bash
command git add studio/server/plugins/frameMountPlugin.ts studio/__tests__/server/plugins/frameMountPlugin.test.ts
command git commit -m "feat(studio/frame): errorShim keeps rendered DOM + overlays calm status; never white-screens a live frame"
```

---

## Task 2: Full suite

**Files:** none (verification)

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS (clear ports 9223-9232 first if wsServer/bridge tests flake; re-run any failing file in isolation to confirm contention, not regression; `[ERROR]` lines are intentional esbuild fixtures). This confirms the shim change didn't break the many tests that stand up a real Vite server + mount frames.

- [ ] **Step 2: Commit nothing** (verification only).

---

## Task 3: Manual acceptance (the real gate — jsdom can't exercise this)

**Files:** none (user-run)

- [ ] **Step 1: Manual acceptance — the exact scenarios that failed before**

`pnpm run studio` (fully quit + restart first — the shim is regenerated per frame serve, but restart avoids any stale server). Then, in a project with a working multi-page frame (e.g. `computer-settings`):
- **Click-to-error:** interact with the frame in a way that historically threw (click a control on a freshly-edited page). **Expect:** the prototype STAYS on screen (frozen), a calm "Refining your change…" banner appears bottom-left, NO white screen. When repair lands, the live frame swaps back.
- **Banner-above-chrome:** trigger the error on a frame that has a `position:fixed` header or an open modal/dropdown. **Expect:** the banner is VISIBLE on top of that chrome (not hidden behind it) — this is the z-index requirement.
- **Module-load crash (empty frame):** force a bad import (or regenerate a frame with one). **Expect:** the calm "Auto-repairing this frame" panel (this case has no render to keep — a message on an empty frame is correct, not a regression).
- **No double-message / no stacking:** trigger two errors in a row. **Expect:** one banner, not stacked.
- Confirm the **shell/chat/other frames** are untouched throughout.

- [ ] **Step 2: Report result.** If a white screen still appears on any case, capture which scenario + the chat system-messages and hand back — that's a real gap to root-cause. If all clean, Phase 1 is done.

- [ ] **Step 3: No version bump here.** All four edit-reliability features ship under ONE release once this passes — that release cut is a separate explicit step.

---

## Self-review notes (author)

- **Spec coverage:** the shim branch + overlay + idempotency + z-index + empty-case panel = Task 1; full suite = Task 2; the running-app gate = Task 3. All spec "Resolved constraints" mapped: z-index 2147483647 + body-append (constraint 1); rendered = childElementCount OR body-portal (constraint 2 + test); overlay appended to body survives React unmount of #root (constraint 3 — the out-of-boundary race degrades to overlay-on-empty, message present, not blank); sentinel `data-arcade-status-overlay` idempotency (constraint 4). Constraint 5 (bounded resting-state copy softening to "couldn't auto-fix") is DEFERRED — noted below.
- **Deliberate deferral (flag for review):** constraint 5's "after a bounded wait with no swap, soften the copy to 'couldn't auto-fix — tell me what you'd like'" adds a `setTimeout` inside the shim. Phase-1 ships the overlay showing "Refining…"; if repair never lands the banner persists with that copy. Softening-copy-on-timeout is a small follow-up, NOT in Task 1, to keep the shim change minimal + reviewable. The frozen-frame-with-a-message (even if optimistic) already satisfies the "never white, always a message" bar; the softened copy is polish. Called out so the reviewer/user can pull it into Task 1 if they'd rather ship it now.
- **No parent change:** confirmed the frozen-frame message is the shim's own overlay; `FrameCard`/`editCycleActive`/`FrameErrorBoundary` untouched (avoids the shipped false-"Refining" regression).
- **Test reality:** unit tests assert the generated SHIM SOURCE (they can't run browser JS); the behavioral proof is the Task-3 manual gate. This is honest about what jsdom can and can't cover.
- **Type/id consistency:** the sentinel attribute is `data-arcade-status-overlay` in the source, the idempotency guard, AND the tests. The postMessage payload/`n: NONCE` is unchanged from the shipped shim.
