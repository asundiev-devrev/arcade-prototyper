# Edit reliability — "the prototype never goes white; at worst it freezes with a clear message"

**Date:** 2026-07-16
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). Fourth sibling of resilient-render / dead-token / invalid-import-path. This closes the remaining white-screen path those didn't: a frame that throws while it is **already on screen** (a click/interaction error, or a mid-multi-file-edit reload catching an inconsistent frame).

## The experience goal (the user's words)

> **"I don't want to see a white screen. I don't want to think about the React app underneath — I just want to use my prototype. If something breaks and the prototype freezes (goes non-interactive) for a bit, that's fine — as long as you clearly tell me what's happening and what to do."**

So the bar is: **never blank the frame.** Keep the last rendered prototype on screen (frozen is acceptable), overlay a calm, plain-language status ("Refining your change…" / "couldn't get that right — tell me what you'd like"), auto-recover when repair lands. Never a white/blank panel as the primary surface.

## What breaks today (root-caused, confirmed against code)

The shipped resilient-render double-buffer only protects against a **broken incoming edit** (validated in a hidden iframe, swapped in only when clean). It cannot protect a frame that throws **after** it's already the visible, committed render — because the error handlers inside the frame **destroy the frame's own DOM** and paint a blank panel in place. Two triggers the user hit:

1. **Interaction error (the common case).** The user clicks something in a rendered frame and a click/event handler throws. React error boundaries do NOT catch event-handler errors — the throw reaches `window.onerror` → the inline **errorShim** (`frameMountPlugin.ts` `showFatal`), which does `root.innerHTML = ""` (blanks the whole frame) then draws a panel. The frame's DOM was fully intact at throw time; the shim needlessly destroys it. **This is the dominant white-screen and the cleanly fixable one.**
2. **Render-phase crash mid-multi-file edit (the harder case).** A "change all Tabs to ToggleGroup across 6 pages" turn rewrites files one at a time; a reload fires while the frame is momentarily inconsistent (`Tabs is not defined`), React can't produce that tree, and `FrameErrorBoundary`'s fallback replaces the unmounted tree with the panel. Here there may be **no intact DOM to keep** — React genuinely couldn't render it.

Both self-heal (auto-repair runs, the frame recovers), but the user SEES the blank panel during recovery — the "never see it break" promise fails.

## Scope decision (locked; controller's call per the user's "don't make me think about React")

- **Phase 1 (this spec): the interaction/async case — the common one — via "keep the DOM, don't blank it."** The errorShim's job becomes: signal the parent (as it already does) and then **leave the frame's DOM exactly as-is** (do NOT `innerHTML=""`), so the last-good render stays on screen, frozen. The parent's existing calm chip communicates status. No snapshot machinery, no dimming, no fidelity loss — the frozen frame IS the real render.
- **Phase 2 (separate spec, follow-up): the render-phase mid-multi-file case.** Needs either a last-good visual snapshot (captured while healthy) restored when React destroys the tree, OR holding the targeted reload until a multi-file turn finishes so the frame never reloads mid-migration. Explicitly OUT here — it's a distinct mechanism with its own risk (snapshot fidelity / reload-batching), and Phase 1 removes the more frequent white-screen now.

This split is honest: Phase 1 makes the frame never blank on interaction errors (what the user mostly hit); Phase 2 remains a known residual (a mid-edit render crash can still briefly show the panel, and still recovers).

## Design — Phase 1: the errorShim OVERLAYS (never blanks), and it must self-communicate

Two corrections from adversarial review that reshape the naive "just don't wipe" idea (both verified against code):

- **The errorShim is SHARED by two error classes with opposite DOM states.** `window.onerror → showFatal` fires for BOTH an interaction/async error (React tree mounted → DOM intact) AND a **module-load error before React mounts** (`root` is an empty `<div>` — the injected panel is the ONLY visible content). So "remove the wipe unconditionally" would turn the module-load case into a **fully white frame** — worse than today. The shim must branch on whether the frame actually rendered.
- **The parent chip is deliberately OFF for at-rest errors.** `FrameCard`'s chip handler early-returns on `!editCycleActive.current` (a shipped fix so an ordinary at-rest runtime error doesn't falsely show "Refining" over a fine frame — pinned by a test). So an interaction error on a committed frame does NOT reach the chip, and relaxing that gate reintroduces the exact bug it fixed. **Phase 1 must NOT rely on the parent chip** — the frozen frame carries its own minimal status.

### The change (in `frameMountPlugin.ts` `showFatal`)
Keep the `arcade-studio:frame-error` postMessage (unchanged — still drives Viewport's auto-repair dispatch + the chat system-message breadcrumb). Then, instead of `root.innerHTML = ""` + full-screen panel:

1. **If the frame rendered something** (`root.childElementCount > 0` / a mounted tree exists): **do NOT touch the existing DOM.** APPEND a small, non-destructive calm status **overlay** on top of it (a positioned banner reusing the existing calm styling — pulsing dot + "Refining your change…" / "We hit a snag, fixing it — watch the chat", detail-on-tap). The user's prototype stays fully visible underneath, frozen, with a clear on-frame message. No blanking.
2. **If the frame is empty** (module-load crash before React mounted — nothing to preserve): keep TODAY's behavior — show the calm "Auto-repairing this frame" panel (it IS the only content; there's no render to protect, and a message beats a blank).
3. **Idempotent:** if the overlay/panel is already present (a second error fires), don't stack duplicates.

The overlay is a sibling appended to `root` (or `document.body`), `position:fixed`/`absolute`, non-interactive where it covers nothing important — it never removes or rewrites the frame's nodes. That is the whole "keep the DOM" guarantee, made safe for both classes.

### Why this delivers the goal for both classes
| Case | root state | Phase-1 behavior | Result |
|---|---|---|---|
| Click / event-handler / async throw on a visible frame | mounted (DOM intact) | keep DOM + append overlay | **prototype stays visible, frozen, clear message. Never white.** ✅ |
| Module-load crash (bad import, before React mounts) | empty | keep today's panel | message on an unavoidably-empty frame (no render existed) — not a regression ✅ |

### What Phase 1 does NOT touch
- **`FrameErrorBoundary`** (React render/lifecycle path) — unchanged. A render-phase crash mid-multi-file edit still routes there (Phase 2).
- **The parent chip / `editCycleActive` / nonce gate** — unchanged (avoids reintroducing the false-"Refining" bug). The frozen-frame status is the shim's own overlay, independent of the parent chip.
- **Auto-repair dispatch** — unchanged; the `frame-error` post still triggers it via Viewport + the chat breadcrumb still appears.

## The cases after Phase 1
| Trigger | Handler | root state | After Phase 1 |
|---|---|---|---|
| Click / event-handler / async throw on a visible frame | errorShim (`window.onerror`) | mounted | **Prototype stays visible (frozen) + calm overlay. Never white.** ✅ |
| Module-load crash (bad import, pre-React-mount) | errorShim | empty | Calm panel on an unavoidably-empty frame (no render to keep). Not a regression. ✅ |
| Broken NEW edit (incoming) | double-buffer (shipped) | — | Held in hidden iframe, never swapped in. ✅ |
| Render-phase crash mid-multi-file edit | FrameErrorBoundary | tree destroyed | **Residual — may still briefly show the panel; recovers.** (Phase 2) ⚠️ |

## Files (indicative — confirm at plan time)
| File | Change |
|---|---|
| `studio/server/plugins/frameMountPlugin.ts` | errorShim `showFatal`: keep the `frame-error` postMessage. Branch on `root.childElementCount > 0`: **mounted →** do NOT wipe; APPEND a non-destructive calm status overlay (reuse the existing `wrap`/dot/`sub` styling, positioned as an overlay, idempotent). **empty →** keep today's `innerHTML=""` + panel (nothing to preserve). Never blank a rendered frame. |
| `studio/__tests__/server/plugins/frameMountPlugin.test.ts` | Assert the generated shim: still posts `frame-error`; branches on `childElementCount`/root-empty; the mounted branch does NOT `innerHTML=""` and APPENDS an overlay; the empty branch keeps the panel; idempotent (no duplicate overlay on a second error). |
| (no FrameCard/parent-chip change in Phase 1) | The frozen-frame message is the shim's own overlay; the parent chip + `editCycleActive` gate stay as-is (relaxing them would reintroduce the shipped false-"Refining" bug). |

## Non-goals (explicit)
- **Render-phase mid-multi-file crash** (`Tabs is not defined` during a 6-file migration) — Phase 2, separate spec.
- **Snapshotting / image capture** of the frame — not needed for Phase 1 (the real DOM is intact); it's a Phase-2 option for the render-crash case.
- **Making a frozen frame interactive again without a reload** — impossible (its JS threw); the freeze until repair-swap is the accepted trade.
- **The FrameErrorBoundary panel** — unchanged in Phase 1.
- **Changing auto-repair dispatch** — unchanged; the `frame-error` post still triggers it.

## Resolved constraints (from adversarial review — bind the plan)
1. **Overlay z-index is LOAD-BEARING, not "confirm later" (Important).** Generated frames render `position:fixed` headers/sidebars and kit modals/toasts at high z-index; a modest overlay z-index lets the frame's own chrome hide the message → frozen frame + hidden message = the exact silent failure the goal forbids. REQUIRED: append the overlay as a direct child of `#root` (or `document.body`) so it shares the root stacking context, and give it `z-index: 2147483647` — that reliably wins over any descendant z-index. Keep the "detail-on-tap" affordance genuinely tappable (don't blanket `pointer-events:none` over the whole overlay). Pin this in the plan; do not ship on "renders correctly over an arbitrary layout."
2. **"Did the frame render" = root OR body has app-owned children, not just `#root.childElementCount`.** A frame that renders solely via a `document.body` portal (kit modals/dialogs/toasts) leaves `#root` empty while visibly rendered → a plain `childElementCount===0` test would wrongly take the wipe/panel branch and paint over portal'd content. Widen the "mounted" test accordingly (e.g. `#root` has children OR a known app-portal container exists in body), OR accept + document the narrow portal-only edge. Decide in the plan.
3. **Overlay-over-torn-DOM race (out-of-boundary throw).** A throw in a component mounted OUTSIDE the error boundary (`DevRevThemeProvider`/`FrameFontProxy`) makes React unmount the root, then rethrow to `window.onerror`. If the rethrow reaches `showFatal` before React finishes removing `#root`'s nodes, the read sees children → overlay appended → React then clears its own nodes → blank + floating banner. The `childElementCount` read is a snapshot; ensure the overlay is appended somewhere that survives React's unmount (body, not inside the tree React owns), so at worst it's an overlay on an empty frame (message present) not a leak. Address in the plan.
4. **Idempotency sentinel (required, not free).** The old wipe branch was idempotent for free (`innerHTML=""`); the new APPEND branch is not — a second error must not stack overlays. Pin a sentinel id/flag the shim checks before appending.
5. **Bounded resting-state copy (self-contained in the shim).** Auto-repair DOES dispatch for a pure interaction error (Viewport → `/api/runtime-error`, ungated), but the agent may have nothing to fix → no swap → frame stays frozen under the overlay. Acceptable (frozen + message beats blank), but the overlay must NOT promise "Refining…" forever: after a bounded wait with no swap, soften to "we couldn't auto-fix this — tell me what you'd like, or reload." Drive this from a `setTimeout` INSIDE the shim (self-contained — do NOT reach into the parent's terminal-timer / editCycleActive; if a swap lands first the document reloads and the overlay vanishes anyway).

## Cleanup (verified sound by review)
When repair swaps a clean incoming render, the committed iframe's `src` changes and the whole document reloads → the overlay (which lived in the old document) is gone by construction. No stale-overlay leak. (One cosmetic edge: an interaction-error overlay on a held committed frame can briefly coexist with the parent "Refining" chip if a LATER edit then fails — two calm messages, never a blank; accept.)
