# Edit reliability — "when the agent says it changed the screen, the screen changed"

**Date:** 2026-07-17
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). **Sixth sibling.** The fifth (agent honesty) closed the *invented-prop* class — the agent writing a prop the kit doesn't have. This one closes the *next* class the manual gate surfaced: **the agent writes a REAL, valid prop the component silently ignores, so the code changes but the rendered screen does not — and the agent reports success.**

## The experience goal

> **A designer should be able to trust "done." When the agent says it changed how something looks or lays out, the pixels should actually move. When an edit changes the code but nothing on screen changes, Studio notices — tries once to make it real, and if it still can't, says so plainly instead of a false "done."**

## Live repro (root-caused, confirmed against code + the on-disk frame)

Project `computer-skills-filtering-proto`, frame `01-computer-settings`, `pages/Preferences.tsx`. Two-step:
1. User: "Change all selects on the Preferences page to multi-select." Agent correctly switched three `Select.Root` → `ToggleGroup type="multiple"` (the *right* multi-select — feature 5 working: no invented prop, no false block). But a horizontal segmented control holding long timezone strings is very wide → it squeezed the cards. A layout-quality miss, not a lie.
2. User: "Can you make these togglegroups vertical? They're currently squeezing the rest of the content in cards." Agent wrote `orientation="vertical"` on all three `ToggleGroup.Root` (**verified on disk** — the file genuinely changed, not a phantom edit) and reported: *"ToggleGroups now stack vertically — stops squeezing horizontal space."* **The page looked exactly as before.**

**Root cause (confirmed against `~/arcade-gen/src/components/ui/ToggleGroup/ToggleGroup.tsx`):** the kit's ToggleGroup Root is hardcoded `inline-flex items-center` and has **no styling that responds to `orientation`**. `orientation` is a *real* Radix prop (Radix accepts it — it governs arrow-key nav direction), so it is honest for the agent to try it and it passes every existing guard: it is not an invented prop (feature 5's hook is silent — correctly), and `Preferences.tsx`'s content-hash *did* change (the phantom-edit contract is silent — correctly). The prop was **swallowed**: accepted, stored, zero pixels moved.

**Why the existing checks can't catch it.** Studio already has the *file-level* twin of this feature: `frameChangeContract.ts` snapshots `frames/`+`shared/` by content hash before/after a turn, and `phantomEditRetry.ts` re-runs the turn once with a corrective when the agent claimed an edit but **no file moved**, then shows the `NO_CHANGES_TRAILER` banner. That fires on "no file changed." Here the file **did** change — so it passes. The missing check is the *visual* one: **the file moved but the rendered frame did not.**

## Scope decision

Build the visual sibling of the phantom-edit check. Behavior chosen with the user: **auto-retry once, then warn** (mirror the phantom-edit precedent). Detection lives where pixels exist (the browser); the corrective turn is server-owned and invisible (like phantom retry); the final "still nothing changed" nudge is client-side (only the browser can see it).

**Explicitly OUT:**
- **Fidelity / "does it match the Figma"** — the render-verify keystone that *scores* similarity to a target. This feature is the strictly-cheaper binary "**did anything visible change at all**," not "is it right." (See auto-memory `studio-fidelity-metric-keystone` — that keystone stays unbuilt; this is not it.)
- **Fixing the kit's ToggleGroup to honor `orientation`** — a real kit gap, tracked separately; the user may take the 2-minute kit fix independently. This feature must work regardless of whether that specific gap is closed, because the *class* (any real-but-swallowed prop on any component) is what we're closing.
- **Adding a general prop typechecker** — out; this is a runtime-render check, not a static one.

## Honest coverage bound (state plainly, like the feature-5 bound)

This catches **"an edit changed the code but the at-rest rendered frame is pixel-identical."** It does NOT:
- **Catch a wrong-but-visible change** (agent made the box blue when you wanted red — pixels *did* move; this feature is silent, correctly — that's the fidelity keystone's job).
- **Distinguish an intentional non-visual edit from a swallowed one.** Wiring an `onClick`, adding an `aria-label`, or changing a data attribute legitimately leaves the at-rest screen unchanged. This feature will flag those too. **This is the central design risk** — handled below by (a) a *self-classifying* corrective the agent can decline, and (b) a *soft, non-accusatory* final banner, never a hard block. The safe direction here is the **opposite** of the write-time hooks: a **missed** no-op (we fail to warn) is fine; a **false** "nothing changed" claim over a real visible change is the cardinal sin, so the fingerprint errs toward "changed" and any non-determinism fails safe (no warning).

## Design — four pieces at verified layers

### Piece 1 — a render fingerprint computed IN the frame
**Where:** a new testable module `studio/src/frame/renderFingerprint.ts`, imported by the frame bootstrap (`frameMountPlugin.ts` `frameBootstrap`, alongside the existing `picker`/`inspector`/`gestureForwarder` imports).

**What it computes:** a hash of the *at-rest visible layout+paint* of the rendered frame — for every element under `#root`, in DOM order: tag name, rounded bounding box `(x,y,w,h)`, a small fixed set of computed paint properties (`color`, `backgroundColor`, `borderTopColor`+`borderTopWidth` … 4 sides, `fontFamily`, `fontSize`, `fontWeight`, `textAlign`, `display`, `flexDirection`), and the normalized `textContent` of text-bearing leaf nodes. Concatenate → FNV-1a 32-bit (synchronous; no async SubtleCrypto). Box coords rounded to integer px so sub-pixel jitter never flips an identical layout.

**Why geometry AND paint (not geometry alone):** geometry alone catches the `orientation` swallow (boxes stay put) but would **false-warn on every color/typography edit** (a color change moves no boxes). Including paint props makes the fingerprint flip on any at-rest visual delta — color, type, spacing, layout — so a real visible edit always changes it. This directly serves the "never falsely claim nothing changed" bound.

**Testability (load-bearing — jsdom returns all-zero rects and stub styles, so discrimination is NOT testable against the real DOM — same class of blindness that shipped the NWS HMR bug):** the core is `computeFingerprint(root, measure)` where `measure(el) → { rect, style }` is **injected**. Production passes a `measure` built on `getBoundingClientRect()` + `getComputedStyle()`. Tests pass a synthetic `measure` returning fabricated geometry/paint, so fingerprint *discrimination* (identical layout → identical hash; any delta → different hash; DOM order sensitivity; rounding) is fully unit-tested without a real browser. The production `measure` wiring + real cross-render behavior are gated on the running-app manual gate, not claimed from unit tests.

**When it runs:** in the existing `ArcadeFrameReady` effect (post-commit), after a double-`requestAnimationFrame` so layout has settled, immediately before the `frame-ready` post. The fingerprint string is added to the existing `frame-ready` postMessage payload as `fp`.

### Piece 2 — compare in the shell (FrameCard), reusing the double-buffer
**Where:** `studio/src/components/viewport/FrameCard.tsx`, in the existing nonce-gated `onMsg` handler that already drives the F1 double-buffer.

**Logic (pure decision extracted to a testable helper `isVisualNoOp` in a new `studio/src/components/viewport/visualNoOp.ts`):**
- Keep a `lastCommittedFp` ref, set on every committed (last-good) `frame-ready`.
- On an **edit-cycle** `frame-ready` (i.e. `editCycleActive.current === true` — the probe of an in-flight edit): if `lastCommittedFp != null` and the probe's `fp === lastCommittedFp` → **visual no-op** → call an `onVisualNoOp(frame.slug)` callback (new prop, supplied by the parent). Whether no-op or not, when the probe swaps to committed, update `lastCommittedFp = probeFp`.
- First generation (no prior committed fp) → skip (nothing to compare). Errored edit (`frame-error`, no `fp`) → skip (that's resilient-render's job, not a no-op).
- Non-determinism (animation, `Date.now()`, async fonts/images) makes two renders of identical source differ → the check simply doesn't fire → **fails safe** (never a false warning).

### Piece 3 — server-owned corrective retry (invisible, one-shot, session-resumed)
**Where:** a new middleware route `POST /api/chat/visual-noop-retry` in `studio/server/middleware/chat.ts` (mirroring the existing chat turn machinery), plus a pure-policy module `studio/server/visualNoOpRetry.ts` (mirroring `phantomEditRetry.ts`: pure policy + a server-owned corrective prompt).

**Why server-owned, not a client `POST /api/chat`:** a client-initiated normal chat turn would render as a fake **user** bubble ("your change didn't visibly render…") in history — ugly and confusing. The phantom precedent keeps the corrective **invisible** (server-internal, narration only, prompt server-side). We match that: the client provides the *signal it can only get in the browser*; the server runs the corrective turn resuming `project.sessionId` (verified: a turn resumes the persisted session) and emits narration into the SSE stream the client is already reading — no user bubble.

**The corrective prompt is SELF-CLASSIFYING (defuses the behavior-edit false positive):**
> "The change you just made did not alter anything visible in the frame — the rendered result is identical to before. If it was meant to change layout or appearance and a component ignored the property (e.g. a `orientation`/variant prop the kit doesn't implement visually), achieve the intent a different way — real layout/utility classes on a wrapper, a different component — so it actually renders. If the change was intentionally non-visual (wiring behavior, an accessibility attribute, a data field), that's fine: reply saying so in one line and make no further edit. Keep the response shape (one-sentence summary + `### Deviations`)."

This lets a legit behavior edit opt out instead of being force-changed, while the swallowed-prop case gets a real second attempt.

**One-shot, two layers:** the server guards (a per-turn/session flag) so the corrective runs at most once; the client also guards (a per-nonce ref) so it fires the trigger at most once per edit cycle. Turn-lock: the trigger fires only after the original turn ended (the client can't detect a no-op until the post-turn render lands), so it won't collide with the running-turn 409; guard anyway.

### Piece 4 — the honest final banner (client-side)
**Where:** reuse the existing no-frame-changes banner pattern (`studio/src/components/chat/NoFrameChangesBanner.tsx` + a sentinel) — either extend it or add a sibling `VisualNoOpBanner` with its own sentinel.

**When:** after the corrective turn re-renders, if the frame is **still** a visual no-op → surface a soft, non-accusatory line: *"This change updated the code but nothing on screen moved — the setting may be one this component ignores. If you expected a visual change, try describing the look you want."* Non-blocking, informational — matches the user's F4 bar ("clearly communicate what's going on, and I know what to do"). If the retry DID move pixels → silent success (no banner).

## Data flow (end to end)
1. Frame renders → `renderFingerprint` computes `fp` → included in `frame-ready` postMessage (`{type, slug, frame, n, fp}`).
2. FrameCard `onMsg`: stores fp; on an edit-cycle probe-ready, `isVisualNoOp(probeFp, lastCommittedFp)` → if true, `onVisualNoOp(frame.slug)`; updates `lastCommittedFp` on commit.
3. Parent (Viewport/chat controller) dedupes to **one** trigger per turn → `POST /api/chat/visual-noop-retry {slug, frame}`.
4. Server: one-shot guard → resume session → run corrective turn with the self-classifying prompt → narration into the existing SSE stream (no user bubble).
5. Corrective turn writes (or declines) → frame re-renders → FrameCard re-checks. Still no-op → client shows the soft banner. Changed → nothing.

## Why this matches the user's priority
- Directly on "said it did, didn't" — the exact failure the manual gate hit, one class deeper than feature 5.
- Reuses shipped systems (double-buffer, frame-ready, session resume, the phantom-retry *shape*) rather than new infra.
- Strictly cheaper than the fidelity keystone: binary "anything moved," no vision model, no target comparison, no scoring.

## Non-goals (explicit)
- Fidelity/pixel-scoring against a design (the keystone). — separate, heavy, still unbuilt.
- Fixing the kit ToggleGroup `orientation` gap. — real but independent; this feature closes the *class*, not that one component.
- Catching wrong-but-visible changes (blue vs red). — pixels moved; out of scope by construction.
- Static prop typechecking. — feature 5's territory; this is runtime-render.

## Files (indicative — confirm at plan time; all verified against the real repo)
| File | Change |
|---|---|
| `studio/src/frame/renderFingerprint.ts` (NEW) | `computeFingerprint(root, measure)` + a production `measure` (getBoundingClientRect + getComputedStyle). FNV-1a, rounded boxes, fixed paint set, DOM-order walk, injectable measure for tests. |
| `studio/server/plugins/frameMountPlugin.ts` (`frameBootstrap`, ~`:326-336`) | Import `renderFingerprint`; in `ArcadeFrameReady`, double-rAF then compute `fp` and add it to the `frame-ready` postMessage payload. |
| `studio/src/components/viewport/visualNoOp.ts` (NEW) | Pure `isVisualNoOp(probeFp, lastCommittedFp)` decision (+ any small policy helpers), unit-tested. |
| `studio/src/components/viewport/FrameCard.tsx` (`onMsg`, ~`:158-202`) | `lastCommittedFp` ref; read `fp` off `frame-ready`; on edit-cycle probe-ready call `isVisualNoOp` → `onVisualNoOp(frame.slug)` (new prop); update `lastCommittedFp` on commit. |
| `studio/server/visualNoOpRetry.ts` (NEW) | Pure policy (`shouldRunVisualNoOpRetry`) + `VISUAL_NOOP_RETRY_PROMPT` (self-classifying), mirroring `phantomEditRetry.ts`. |
| `studio/server/middleware/chat.ts` | New `POST /api/chat/visual-noop-retry {slug, frame}`: one-shot guard, resume `project.sessionId`, run corrective turn (server-owned prompt), narration into SSE. No user bubble. |
| Viewport / chat controller (`studio/src/components/viewport/Viewport.tsx` or the chat-stream owner) | Wire `onVisualNoOp` → dedupe one-per-turn → POST the retry; after retry, drive the soft banner. |
| `studio/src/components/chat/NoFrameChangesBanner.tsx` (or a new `VisualNoOpBanner.tsx`) | The soft "code changed but screen didn't" banner + sentinel, rendered when still-no-op after retry. |
| Tests | `renderFingerprint.test.ts` (discrimination via injected measure), `visualNoOp.test.ts` (decision), `visualNoOpRetry.test.ts` (policy), a chat-route test for the new endpoint (one-shot + resume), FrameCard message-handler test (fp compare → callback). jsdom limits: discrimination tested via injected measure; real cross-render behavior on the manual gate. |

## Open questions (resolve in the plan)
1. **Paint-prop set + perf:** `getComputedStyle` per element × N forces style resolution. Confirm the fixed prop set catches the real deltas (color/type/spacing/layout) and measure cost on a realistic frame (few hundred elements). If too slow, cap element count (and `log`/note the cap — no silent truncation) or sample; decide in the plan.
2. **Extend `NoFrameChangesBanner` vs. new `VisualNoOpBanner`:** the messages differ ("no file changed" vs "file changed, screen didn't"). Decide reuse vs sibling; keep sentinels distinct so the two never collide.
3. **Trigger dedupe location:** confirm the one-per-turn dedupe owner (Viewport vs the chat-stream hook) and how it resets per turn (tie to the turn/SSE lifecycle, not a frame nonce, since multiple frames could each no-op in one turn).
4. **Multi-frame turns:** an edit touching frame A but not B — B legitimately unchanged. Confirm the trigger only fires for a frame whose *own* source changed this turn (gate on `editCycleActive`/frame-changed for that frame), so an untouched frame never triggers a retry.
5. **Interaction with the existing phantom-edit (file) retry:** they're complementary (file-no-move vs file-moved-pixel-no-move) and fire at different times (phantom at server turn-end; visual after client render). Confirm no double-retry on a turn that is both (it can't be — if no file moved, the frame doesn't re-render, so there's no new fp to compare).
