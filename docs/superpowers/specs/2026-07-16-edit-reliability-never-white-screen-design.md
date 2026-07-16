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

## Design — Phase 1: errorShim keeps the DOM, parent chip communicates

### The one behavioral change (in the frame's errorShim, `frameMountPlugin.ts` `showFatal`)
Today `showFatal`:
1. posts `arcade-studio:frame-error` to the parent (KEEP — the parent already listens; this drives auto-repair dispatch AND the calm chip), then
2. `root.innerHTML = ""` + builds a full-screen "Auto-repairing this frame" panel INSIDE the frame (REMOVE — this is the blanking).

New `showFatal`:
1. post `arcade-studio:frame-error` (unchanged — same payload incl. the reload nonce).
2. **Do NOT touch the DOM.** Leave the last rendered frame exactly as it was. No `innerHTML`, no injected panel.
3. (Optional, minimal) set a non-destructive marker the parent can read if needed — but the parent already knows from the postMessage, so nothing else is required inside the frame.

The frame is now frozen-but-visible (its JS threw, so it won't respond to further interaction until repair swaps in a fresh iframe — that's the acceptable "freeze"). The user keeps seeing their prototype, not a blank.

### The parent already does the rest (reuse, no new surface)
`FrameCard` already listens for `arcade-studio:frame-error` and shows the calm chip ("Refining your change…", then terminal "I couldn't get that change right — tell me what you'd like instead" after the timer). That chip is the "clear message" the user asked for. On a clean repair, the double-buffer swaps a fresh iframe in and the frozen frame is replaced with a live one. **No parent change needed for Phase 1** beyond confirming the chip fires for a committed-frame interaction error (it keys on the nonce; verify the committed frame's error carries a nonce the parent accepts, or relax that gate for the "frame already visible" case — resolve in the plan).

### Why the panel-removal is safe
- The panel was the *only* thing the shim added; removing the wipe + panel leaves the real render. Nothing depended on the in-frame panel (the durable record is the chat system-messages + the parent chip).
- The `FrameErrorBoundary` (React render/lifecycle path) is a DIFFERENT handler — Phase 1 does NOT change it (that's the Phase-2 render-crash path). Interaction errors never reach the boundary (React doesn't catch event-handler throws), so Phase 1's errorShim change fully owns the interaction case.

## The two cases after Phase 1
| Trigger | Handler | After Phase 1 |
|---|---|---|
| Click / event handler throws on a visible frame | errorShim (`window.onerror`) | **Frame stays on screen (frozen) + calm chip. No white screen.** ✅ |
| async / unhandledrejection on a visible frame | errorShim | Same — frame kept, chip. ✅ |
| Broken NEW edit (incoming) | double-buffer (shipped) | Held in hidden iframe, never swapped in — already fine. ✅ |
| Render-phase crash mid-multi-file edit | FrameErrorBoundary | **Residual — may still briefly show the panel; recovers.** (Phase 2) ⚠️ |

## Files (indicative — confirm at plan time)
| File | Change |
|---|---|
| `studio/server/plugins/frameMountPlugin.ts` | errorShim `showFatal`: keep the `frame-error` postMessage; REMOVE `root.innerHTML=""` + the injected panel DOM. Leave the frame's DOM untouched on an interaction/async error. |
| `studio/src/components/viewport/FrameCard.tsx` | Confirm the calm chip fires for a committed-frame `frame-error` (interaction error on the visible frame). If the nonce gate blocks it (the committed frame's error may not match the in-flight reloadNonce), allow the chip for a committed-frame error too. Small, verify in the plan. |
| `studio/__tests__/server/plugins/frameMountPlugin.test.ts` | errorShim no longer emits the wipe/panel markup; still posts `frame-error` with the nonce. Assert the generated shim source does NOT contain `innerHTML = ""` / the panel, and DOES still postMessage. |
| `studio/__tests__/components/viewport/frame-card-reload.test.tsx` | a committed-frame `frame-error` (interaction) shows the calm chip (not silent, not a swap). |

## Non-goals (explicit)
- **Render-phase mid-multi-file crash** (`Tabs is not defined` during a 6-file migration) — Phase 2, separate spec.
- **Snapshotting / image capture** of the frame — not needed for Phase 1 (the real DOM is intact); it's a Phase-2 option for the render-crash case.
- **Making a frozen frame interactive again without a reload** — impossible (its JS threw); the freeze until repair-swap is the accepted trade.
- **The FrameErrorBoundary panel** — unchanged in Phase 1.
- **Changing auto-repair dispatch** — unchanged; the `frame-error` post still triggers it.

## Open questions (resolve in the plan)
1. **Committed-frame error + the chip's nonce gate.** The parent's chip logic keys on `reloadNonce` (an in-flight edit). An interaction error on an at-rest committed frame may not match. Decide: relax the gate to also show the chip for a committed-frame error, and ensure it doesn't collide with the `editCycleActive` logic that (correctly) ignores at-rest errors for the *edit* flow. The chip should say "something went wrong, repairing" for a genuine at-rest crash, but NOT mis-fire on the benign at-rest cases the editCycleActive gate was added to suppress. This interaction needs care — it's the one subtle part.
2. **Does auto-repair even fire for a pure interaction error** (no file write followed)? If the user clicks and it throws but no edit is in flight, repair may have nothing to fix. The frame stays frozen + chip; confirm the terminal-timer message ("tell me what you'd like") is the right resting state, and the user can just re-prompt. The frozen-but-not-blank frame is still the win.
3. **errorShim: keep a tiny non-destructive hook?** Confirm removing the panel entirely doesn't lose the only signal in some edge (e.g. a module-load error before React mounts — there the frame is empty anyway, so a blank is unavoidable; decide whether that pre-mount case keeps a minimal message vs. relies on the parent chip over an empty frame).
