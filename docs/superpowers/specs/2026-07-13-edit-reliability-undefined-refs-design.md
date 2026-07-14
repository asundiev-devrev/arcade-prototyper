# Edit reliability — "you can't break your prototype by asking for a change"

**Date:** 2026-07-13 (rev. 4 — grounded on a verified reload-architecture spike)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Covers the crash/white-screen class on edits. (b) phantom edits + (c) inspect over-reach remain separate specs.

## The experience goal (what the user cares about)

> **Editing must feel as safe as generating. A designer can never break their prototype — or see it break — by asking for a change.**

Target experience:
- Ask for an edit → the working prototype **stays on screen** with a calm **"Refining your change…"** chip (tappable for detail).
- The change appears when it's ready. If the edit was broken under the hood, the designer **never sees the broken state** — it's fixed in the background while the last-good version stays up.
- If the tool genuinely can't fix it: **"I couldn't get that change right — tell me what you'd like instead,"** chat unblocked. Never a white screen, never a red wall, never a spinner forever.

## What three prior attempts + a spike proved (so we don't repeat them)

1. **Guard the writer** (catch the bad edit before it renders) — **impossible.** The validation hook is *PostToolUse*; a live spike (real `claude` CLI 2.1.207) confirmed the blocked write still lands on disk and only *then* informs the agent. Vite reloads the broken file before the guard runs.
2. **Server-side auto-import** — **no seam.** The spawned CLI writes files directly; the server only observes via diff.
3. **Naive double-buffer in the parent** — **the parent doesn't survive.** A second spike (verified in code) found the real reload path: on any frame write, `projectWatchPlugin.ts:111` sends `server.ws.send({type:"full-reload", path:"*"})` → Vite does a **hard `location.reload()` of the entire studio shell.** `FrameCard` is destroyed and rebuilt every edit — nothing persists to "hold the last-good render." (The codebase already documents this: `pendingPrompt.ts` moved to `sessionStorage` *because* full-reload wipes memory.)

**The root enabler nobody had touched:** the shell-wide `full-reload`. It's a blunt instrument (its own plugin comments show it's been repeatedly scoped-down to stop racing other things). Replacing it with a **targeted, parent-controlled per-frame reload** is the foundation that makes the whole experience buildable — *and* it removes a reliability smell: today **every single edit hard-reloads the entire app** (chat, scroll, everything flickers).

**Verified this is tractable (spike, 2026-07-13, confirmed against Vite 8/rolldown-vite):**
- The shell entry (`index.html` → `/src/main.tsx`) runs through Vite, so `import.meta.hot.on("<custom-event>")` is available. Traced end-to-end: `server.ws.send({type:"custom", event, data})` → Vite client `case "custom" → notifyListeners` → `import.meta.hot.on(event)`. Works in this version.
- **Invariant to pin:** `import.meta.hot` exists in production **because the packaged app runs the Vite dev server, not a build** (`electron/viteRunner.ts` spawns `vite`). If the app is ever switched to a prod build, `import.meta.hot` is `undefined` and Layer 0 silently dies. This must stay a dev-server deployment.
- A rich parent↔iframe postMessage channel already exists (`arcade-studio:frame-pick/-error/-reset`).
- The frame iframe `src` is parent-controlled (`FrameCard.tsx:328-331`, `ref` + `src={frameUrl}`). **Correction:** `frameUrl` has NO cache-bust param today (the `t=Date.now()` lives server-side in the bootstrap URL) — the plan must ADD a reactive nonce to `frameUrl`, not "bump" an existing one. Re-setting the query navigates the iframe and re-hits the HTML middleware (no cache headers → fresh).

## Design — reload-first, then resilience on top

### Layer 0 — Targeted per-frame reload (the foundation; replaces shell-wide full-reload)

- `projectWatchPlugin`: on a frame-source write, **stop** `full-reload path:"*"`. Instead `server.ws.send({type:"custom", event:"arcade-studio:frame-changed", data:{slug, frameId}})`. Keep the existing module-graph invalidation (`invalidateFileInModuleGraph`) — it must still run before the client refetches.
- Shell (`main.tsx` or a small hot-listener module): `import.meta.hot?.on("arcade-studio:frame-changed", …)` → dispatch to the matching `FrameCard` (via a store/event) to reload **just that frame**.
- `FrameCard` reloads by setting a new reactive nonce in its iframe `frameUrl` query — the shell (and every other frame, chat, scroll) is untouched.
- **Two invariants the plan must not optimize away** (or the edit silently doesn't apply — the "it wasn't listening" failure): (a) keep `invalidateFileInModuleGraph` on the written file + importers before signalling; (b) the targeted reload must **refetch the HTML endpoint** (full iframe document load, which the double-buffer's new iframe does naturally), NOT a soft HMR poke.
- **Baseline correction:** today ONLY frame-source writes trigger `full-reload`; scaffold/theme writes already do NOT (the 0.23.6 fix). So Layer 0 removes the *sole* reload trigger — there is no "keep full-reload for non-frame changes exactly as today" because non-frame changes already don't reload. Non-frame HMR (CSS hot-replace, shared/*.ts module HMR) is unchanged.
- **Win on its own:** even before resilience, this ends the jarring full-app reload on every edit.

### Layer 0.1 — Re-acquire stale iframe references after a targeted reload (regression the fix INTRODUCES — must fix)

Because `FrameCard` now **survives** the reload (that's the whole point), the surviving parent holds state bound to the *old*, now-detached iframe. Today's shell full-reload masked this by nuking everything. There are THREE distinct stale-state risks — all must be handled, not just `frameWindow`:

1. **Stale edit-batch → silent no-op AND a wrong-node-write corruption path (Critical).** The picker stamps `data-arcade-edit-id` into the *runtime* DOM and keys a module-scope `edits` Map by it (`inspector.ts`). A targeted reload re-runs the frame's `inspector.ts` fresh (Map empty, ids reset) and rebuilds the DOM with no edit-id attributes — but the parent's `batch` (lives in `EditSessionProvider` above FrameCard) still holds selections with the *old* ids and *old* line/col. Preview posts silently no-op; worse, a field edit writes by the stored line/col which is now stale after the agent edit that triggered the reload → can write the **wrong JSX node = silent prototype corruption**. **REQUIRED:** on `frame-changed` where the reloaded frame is the active edit-session frame, call `clear()` on the edit session (this also nulls `frameWindow`, subsuming risk 2). Not optional.
2. **Stale `frameWindow`.** `editSessionContext.frameWindow` (consumed across `InspectorPanel.tsx`; `FrameCard.tsx:115` posts `preview-reset` to it) points at the detached window. Subsumed by the `clear()` above; if a reload happens with no active batch, simply drop the ref.
3. **Picker not re-armed.** FrameCard's `picking` state survives, but the picking effect only posts `frame-pick-start` on mount and its deps don't include the reload nonce → the new iframe's picker stays inactive (crosshair looks on, clicks do nothing). **REQUIRED:** re-post `frame-pick-start` to the new iframe on `frame-changed` when `picking` is true (add the nonce to the effect deps).

This coupling is the real dependency on full-reload — full teardown/re-arm on the active frame, not just a window re-acquire.

### Layer A — Last-good double-buffer (now possible, because the parent survives)

With Layer 0, `FrameCard` persists across an edit, so it can hold the last render:
- On `frame-changed`, load the new frame **without discarding the visible one** — two iframes (incoming hidden) OR a snapshot of the current render held while the single iframe refetches. (Which is simpler + flicker-free: decide in the plan; both are now *possible*, which they were not before.)
- Swap to the new render **only on a positive clean-mount signal** (Layer A.1). If the new frame errors instead — runtime crash OR its module 500s on a parse error — **keep the last-good render visible** + show the "Refining your change…" chip.
- First-generation of a brand-new frame has no last-good → shows the existing calm "Auto-repairing" panel (unchanged). This layer protects *edits* — Gil's exact case.

### Layer A.1 — A trustworthy "mounted cleanly" signal (the one real gap)

Today the bootstrap only posts on *error*. Add a positive beat, defined precisely to avoid false positives the review flagged:
- Post `arcade-studio:frame-ready` **only from the happy path** — via a tiny mount-effect component rendered as a **sibling of `<Frame/>` inside the error boundary** (a child can't be injected into the user's component; it goes after `<Frame/>` at the bootstrap tree, `frameMountPlugin.ts:281-283`). If `Frame` throws in render, React discards that subtree's effects → `frame-ready` never fires; the boundary's fallback is a separate tree that never mounts the signal.
- Make it **idempotent** — `React.StrictMode` is on (`main.tsx:26` + bootstrap `:278`) and double-invokes mount in dev; guard with a module-scope flag (resets per fresh iframe document).
- **Carry a reload nonce** on `frame-ready` AND on **all `frame-error` emitters — there are THREE, and the one that matters most was nearly missed:**
  - `FrameErrorBoundary.tsx:21` (React render/effect throw).
  - **`frameMountPlugin.ts:76` — the inline `errorShim`'s `window.onerror`/`unhandledrejection`.** This is the handler for *module-load failures (bad/missing imports) that happen before React mounts* — i.e. the **undefined-ref crash that is this spec's literal title and Gil's exact case.** If it doesn't carry the nonce, keep-last-good fails for the primary failure class (parent can't correlate it → never shows "Refining…", hangs to the Layer C timer). **Must be nonced.**
  - The nonce reaches the iframe via `frameUrl`'s `&n=<nonce>` query → readable in-iframe from `window.location.search` (NOT the server-built bootstrap URL). Both the errorShim and the error boundary read it there.
  - Parent stamps each reload with the nonce it set and acts only on messages matching the current nonce — so a late message from the outgoing iframe can't race the swap.
- Known limit (accept, don't over-engineer): a frame that mounts then throws in a later `useEffect` is treated as "mounted"; the error boundary catches it and the existing runtime-error path handles it. `frame-ready` covers the dominant case (undefined-ref / parse crash on initial render — exactly Gil's).

### Layer B — Background auto-repair + hook demoted to corrector

The calm render buys time for repair to land invisibly. Reuse what exists; demote the guard:
- Runtime errors → `errorShim`/`FrameErrorBoundary` → `/api/runtime-error` → auto-fix dispatch (exists).
- Parse errors → `buildErrorReporter` on `vite:error` → auto-fix dispatch (shipped 0.43.3).
- **Validation hook** (`validateArcadeImports.mjs`): keep the whole-file **import** check (robust) as a *repair trigger* — the spike proved exit-2 reaches the agent and makes it self-correct. **Drop the whole-file JSX-reference check** (review C1: false-blocks valid React — `as`-props, render-props, multi-binding const). Hook = corrector, never shield.
- **Suppress Vite's error overlay** — a frame parse error broadcasts `vite:error` to ALL ws clients, so the **shell red-walls** even though the frame reload is now targeted (independent of Layer 0). **Honest constraint:** `enableOverlay` is a single global; `server.hmr.overlay:false` kills the overlay **everywhere** (shell + frames) — there is no config-level scoping. Options: (a) accept global suppression — fine for the packaged app (testers don't edit shell source; and the packaged dev-server has the overlay anyway), at the cost of local Studio dev losing shell error overlays; or (b) client-side interception — remove the `vite-error-overlay` custom element only for frame-scoped errors. Recommend (a) for simplicity unless local-dev DX pain shows up; decide in the plan.

### Layer C — Terminal escape hatch (never trapped)

If repair doesn't produce a clean mount within a **bounded time**, the chip becomes **"I couldn't get that change right — tell me what you'd like instead,"** detail on tap, chat unblocked, last-good still visible.
- **Client-side timer, not server counter (resolved).** Layer 0's premise is that `FrameCard` now *survives* — so the timer lives **in FrameCard**: on entering "Refining…" (a nonce-matched `frame-error`), start a bounded timer; each repair attempt is a new `frame-changed` → new nonce reload; a nonce-matched `frame-ready` cancels the timer and swaps; timer elapses with no clean mount → terminal chip.
- **Timer floor (must exceed real repair latency).** A repair is a full `claude` turn AND the dispatcher is rate-limited at `AUTO_RETRY_WINDOW_MS = 60_000`/frame (`buildErrorReporter.ts`). A timer shorter than (rate-limit window + turn time) fires terminal **while a repair is legitimately in flight** → false "couldn't fix it." The timer and the per-frame rate-limit are two independent clocks that must be tuned **together**; pick the timer above their combined worst case (plan: measure against real repair latencies).
- **Post-terminal recovery (define, don't leave ambiguous).** If a nonce-matched `frame-ready` arrives *after* the chip went terminal (a slow repair finally landed), **un-terminal and swap to the good render** — the fix winning late is still a win. Never leave a stale terminal over a frame that actually got fixed.

## The one visible surface: the "Refining your change…" chip
- Shows when a reload's new render fails to mount cleanly; last-good stays behind it.
- Calm default; tappable to disclose detail (designers, not engineers — hidden by default).
- Terminal state per Layer C. Never a raw stack/red overlay as the primary surface.

## Scope
- **In:** Layer 0 (targeted reload) + 0.1 (stale-state teardown), A (double-buffer), A.1 (clean-mount signal + nonce), B (demote hook + suppress overlay + reuse auto-repair), C (client-side bounded-timer terminal chip).
- **Out (separate specs):** (b) phantom edits, (c) inspect over-reach, delta-vs-Figma expectation-setting.
- **Untouched:** generation path, recognition/kitEmit.

## Files (indicative)
| File | Layer | Change |
|---|---|---|
| `studio/server/plugins/projectWatchPlugin.ts` | 0 | frame-source write → targeted `custom` event (not shell `full-reload`); keep `invalidateFileInModuleGraph`; this is the sole reload trigger removed |
| `studio/src/main.tsx` (+ small hot-listener) | 0 | `import.meta.hot?.on("arcade-studio:frame-changed")` → route to FrameCard |
| `studio/src/components/viewport/FrameCard.tsx` | 0/0.1/A/C | reactive nonce in `frameUrl`; double-buffer + hold-last-good; re-acquire iframe window ref on reload; client-side terminal timer; render chip + states |
| `studio/src/hooks/editSessionContext.tsx` | 0.1 | re-acquire/clear stale `frameWindow` on `frame-changed` |
| `studio/server/plugins/frameMountPlugin.ts` (bootstrap) | A.1 | positive `frame-ready` post (happy-path mount-effect child), idempotent; carry reload nonce |
| `studio/src/frame/FrameErrorBoundary.tsx` | A.1 | `frame-error` carries reload nonce too |
| `studio/vite.config.ts` | B | suppress error overlay (global — see Layer B constraint) |
| `studio/server/hooks/validateArcadeImports.mjs` | B | whole-file import check; drop whole-file JSX-ref check |
| `__tests__/...` | all | targeted-reload routing; nonce-correlated swap; hold-last-good on error; clean-mount vs fallback-commit; stale-window re-acquire; client timer→terminal; import-check whole-file |

## Open questions (resolve in the plan)
1. Double-buffer mechanics: **two iframes (incoming hidden → swap) is the realistic path** — it naturally satisfies the "refetch HTML" invariant and nonce correlation. The "single-iframe + held snapshot" alternative is materially harder/lossier (snapshotting live iframe DOM loses fonts/canvas) — treat as fallback only. **Two-iframe decision criteria the plan must settle:** the hidden incoming iframe must be **non-interactive** (`pointer-events:none`) so its `gestureForwarder`/picker don't double-fire pan/zoom/picks to the parent; and double `/api/runtime-error` dispatch from both iframes is de-duped only by the per-frame rate-limit (`buildErrorReporter.ts`) — that rate-limit is therefore load-bearing here, note it.
2. Exact bounded-timer duration for the terminal chip (wall-clock since failed edit) — long enough for a normal repair to land, short enough to never feel stuck. Pick a value + confirm against real repair latencies.
3. Overlay suppression: global (recommended) vs. client-side element-removal scoping — decide based on whether local Studio dev losing shell overlays is acceptable.

## What the reviews + spikes established (don't relitigate)
- PostToolUse fires post-write → guard cannot prevent the render (spike). Resilient render is the shield.
- Shell-wide `full-reload` destroys the parent → targeted per-frame reload is the required foundation (Layer 0), and it's verified tractable (shell has `import.meta.hot`; iframe src is parent-controlled).
- Whole-file JSX validation false-blocks valid React → import-check only.
- Parse-error auto-repair already ships; overlay is global → suppress, don't rebuild dispatch.
