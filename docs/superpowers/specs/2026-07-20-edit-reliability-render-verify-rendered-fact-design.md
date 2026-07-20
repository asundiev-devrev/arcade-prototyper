# Edit reliability — "verify the claim against the render, not the code"

**Date:** 2026-07-20 (rev. 2 — cold adversarial review found 2 Criticals + 4 Importants against the real code; all folded in. The load-bearing change: **verify the claim against the USER'S ASK, not the agent's self-report summary** — this kills the "already correct" phrasing miss AND is more principled (the user asked vertical; check vertical regardless of what the agent says). Plus: the digest lives in FrameCard (the only holder of the iframe ref — the shell can't reach `contentWindow`); render-verify gets its OWN turn-end trigger (VN's is edit-gated → dead on a no-edit turn); subject resolution uses UNANIMOUS contradiction (all candidates of the claimed kind contradict → mismatch; mixed → silence — fixes the horizontal-toolbar-beside-vertical-settings false-fire); the digest measures the `data-orientation` carrier itself (harder to game with a wrapper); and VN + render-verify are UNIFIED into one corrective service with per-check state (they collided on VN's single `awaitingCorrective`/banner/one-shot key).)
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). **Seventh sibling.** The prior six keep a broken result off-screen, self-correct bad refs, stop invented props, and (VN, the sixth) catch an *edit* that changed the code but not the pixels. This one closes the gap VN structurally cannot: **the agent claims a visual change is done by reading the SOURCE CODE, without ever seeing the rendered result — and on a turn where it makes NO edit, so nothing re-renders for VN to compare.**

## Live repro (root-caused, confirmed on disk)

Project `computer-skills-filtering-proto`, frame `01-computer-settings`, `pages/Preferences.tsx`. All three `ToggleGroup.Root` already carry `orientation="vertical"` (written in an earlier session). User asked (again) to make the toggle groups vertical. The agent **read the code, saw `orientation="vertical"` already present, and declared the ask satisfied** — made no edit. In reality both toggle groups render **horizontal**.

**Root cause (confirmed against the shipped `@xorkavi/arcade-gen` dist + `~/arcade-gen` src — NOT to be changed):** the kit's `ToggleGroup.Root` is hardcoded `inline-flex items-center` and applies **no `flex-direction` rule for the vertical orientation**. Radix forwards the prop (the DOM gets `data-orientation="vertical"` / `aria-orientation="vertical"`), but nothing in the kit's class list acts on it, so the computed `flex-direction` stays `row`. `orientation` is a **swallowed prop**: valid, present, visually inert.

**Why the six existing guards all miss it:**
- Write-hooks (`validateComponentProps`, imports, tokens): no invented prop, no bad path — silent, correctly.
- VN (visual no-op): fires only when an *edit* produces an identical render. Here the agent made **no edit** → no `frame-changed` → no probe → nothing to compare. Structurally uncatchable by VN.
- The agent's own honesty contract (`CLAUDE.md.tpl`): it believes the claim is true — its only evidence is the source, and the source *does* say `orientation="vertical"`.

**The missing capability:** the generation agent has **no eyes on the rendered output**. Its entire evidence base is code it wrote or read. The truth of a visual claim lives in the rendered frame's computed styles — which the agent has never been able to observe. This spec gives it that one missing sense, cheaply.

## Scope decision (locked with the user)

Approach **A — rendered-fact feedback** (chosen over B = screenshot+vision keystone, and C = optional verify-tool). Studio-side ONLY; **no `@xorkavi/arcade-gen` changes** (the swallowed-prop is a real kit gap tracked separately — this feature must work regardless, because the CLASS is "any claimed visual property the render contradicts", not this one component). Reuses infrastructure the VN feature (sixth sibling) just shipped: the in-frame `productionMeasure` (computed-style reader), the picker's request→response postMessage pattern, and the server corrective-turn channel (`/api/chat/visual-noop-retry` shape).

**The three moves:**
1. **Extract the requested property — from the USER'S PROMPT, not the agent's summary.** The user typed "make the toggle groups vertical" → `{property: orientation, expected: vertical}`. **Rev-2 correction (review Minor→load-bearing):** rev-1 keyed on the agent's reply summary, which on a no-edit turn is naturally "already configured correctly" — NO visual keyword → no claim → the motivating bug ships silently. The USER'S ask always carries the property (that's what they asked for), and it's the right oracle anyway (we verify what the user wanted, not what the agent said it did). The agent's summary is used only as a secondary trigger signal, never as the source of truth.
2. **Measure the truth** — on turn-end, the frame reports the *actual computed styles* of the relevant elements from the CURRENT render (works on a no-edit turn — no re-render needed).
3. **Reconcile** — if the requested property contradicts the rendered fact, feed that back as a corrective turn ("the user asked for vertical; the toggle groups render horizontal — the `orientation` prop isn't changing the layout; achieve it a different way or tell them plainly the kit renders them horizontally"); if they agree, silent success.

## Honest coverage bound (state plainly, like every sibling)

This verifies **enumerated properties the USER requested**: a bounded prompt→property map (v1: orientation/direction, background color, text color, size/dimension, visibility) measured against the rendered computed styles. It does NOT:
- **Catch a purely-visual mismatch outside the measured set** (wrong icon, wrong spacing nobody asked about, subjective "looks off") — that's the full vision keystone (B), explicitly out of scope and separately specced later.
- **Judge intent/aesthetics** — it only checks "does the rendered property match the property the USER ASKED FOR." A request-vs-render consistency check, not a design critic.
- **Fire when the user's prompt maps to no property** — "clean this up", "make it nicer" → no mappable property → no check (safe direction: a missed verify is acceptable; a FALSE "this is wrong" over a correct render is the cardinal sin — reconcile errs toward silence on any uncertainty, and only fires on a UNANIMOUS clear contradiction).
- **Catch a partial miss on a mixed page** — if the user asked "vertical" and one toggle is now vertical while another is still horizontal, the unanimous-contradiction rule stays silent (traded away to guarantee no false-fire on a legitimately-mixed page).

The realistic claim: "**a visual property the USER explicitly asked for is now checked against the real render**, for the enumerated set, firing only on a unanimous clear contradiction — the swallowed-prop / asked-but-not-rendered class is caught; the un-enumerated visual tail and partial-miss cases are not." The cheap 80% of the render-verify keystone, unified onto VN's rails.

## Design — components at verified layers (all studio-side, all reuse shipped infra)

### Piece 1 — an on-demand render digest from the frame
**Where:** extend the frame bootstrap (`frameMountPlugin.ts` `buildFrameBootstrapSource`) + a new digest helper reusing `productionMeasure` (`studio/src/frame/renderFingerprint.ts`).

- The shell posts the frame a request `{ type: "arcade-studio:frame-digest-request", n, selector? }`. The frame responds `{ type: "arcade-studio:frame-digest", n, elements: [{ tag, role?, textSnippet?, styles: {flexDirection, backgroundColor, color, width, height, display, ...the PAINT_PROPS set} }] }`.
- **Rev-2 reachability fix (Critical):** rev-1 said "the shell posts the frame's `contentWindow` from `useProjectFromHost`." That's infeasible — `useProjectFromHost` holds NO iframe ref; the iframe handle is a private ref inside `FrameCard` (`iframeRef`, `FrameCard.tsx:103`), and the picker request→response the spec cites runs INSIDE FrameCard (`iframeRef.current.contentWindow.postMessage`). A broadcast `window.postMessage` from the shell does NOT reach a child iframe. So the digest request+capture lives in **FrameCard** (which owns `iframeRef` + already owns the fingerprint compare + the picker request); the result flows UP to the shell via a callback, exactly like the existing `onVisualNoOp(frameSlug)` — a new `onRenderDigest(frameSlug, digest)`. Simplest correct shape: the frame **pushes** a digest proactively (the way it already pushes `frame-fingerprint` on every render — `frameMountPlugin.ts:345`), FrameCard buffers the latest per its own frame, and the shell reads the buffered digest for the target frame on turn-end. No shell→contentWindow addressing needed.
- **Rev-2 — measure the CARRIER + capture identity attrs (review Minor + anti-game):** `productionMeasure` returns only `{tag, rect, style(PAINT_PROPS)}` — it does NOT capture `data-orientation`/`role`/a text snippet, which the digest needs to IDENTIFY candidates. The digest helper is therefore NEW work on top of `productionMeasure` (reuse is only the computed-style read): for each candidate it records `{ tag, dataOrientation, role, styles }`. Crucially, measure the element that CARRIES `data-orientation` (the Radix `ToggleGroup.Root`) — its own computed `flexDirection` is the truth the kit swallowed. This also hardens against the wrapper-game (below): we read the control's own direction, not a parent wrapper's.
- v1 candidate scope: elements carrying `data-orientation` (the direct target for the orientation claim) plus a small tag/role allowlist for color/size claims, DOM-order capped (the computer-agent 50KB lesson — a summary, not the DOM). Cap is `log()`-noted, never silently truncated.
- Works on a **no-edit turn**: it measures the current committed render — no `frame-changed`, no probe needed. Review confirmed the committed iframe is same-origin + settled for the whole turn, so `getComputedStyle` is stable at turn-end. This is the crux VN couldn't reach.

### Piece 2 — extract the requested property from the USER'S PROMPT
**Where:** a new pure module `studio/server/renderVerify.ts` (mirrors `visualNoOpRetry.ts`: pure functions + a corrective prompt).

- `extractRequestedProperties(userPrompt) → Requested[]` where `Requested = { property: "orientation"|"backgroundColor"|"color"|"size"|"visibility"|…, expected: string }`. **Rev-2 (load-bearing correction): the source is the USER'S turn PROMPT, not the agent's summary.** The user typed "make the toggle groups vertical" → `{orientation, "vertical"}`. This is why it catches the no-edit repro: the agent's reply was "already correct" (no keyword), but the user's ask carries the property unconditionally. It's also the correct oracle — we verify what the user wanted. "vertical"/"stacked"/"column" → `{orientation, vertical}`; "horizontal"/"side by side" → `{orientation, horizontal}`; a color word → `{backgroundColor|color, <named>}`; etc. Bounded, extendable by rows (like `kitMappings` / the token seed).
- Deliberately conservative: a prompt with no mappable visual property → no check (safe direction — a missed verify is fine; a false mismatch is the cardinal sin).

### Piece 3 — reconcile requested vs digest (UNANIMOUS contradiction only)
**Where:** `renderVerify.ts` — `reconcile(requested, digest) → Mismatch[]`.

- **Rev-2 subject-resolution fix (Important — was the coarse "if ANY element renders row → mismatch", which false-flags a page holding both a horizontal toolbar toggle AND a vertical settings toggle):** flag a mismatch ONLY when **every** candidate of the claimed kind unanimously contradicts the requested property AND there is at least one candidate. Orientation "vertical": mismatch only if ALL `data-orientation` carriers render `flexDirection: row`. A mixed page (one row, one column) → NOT a mismatch (silence — the request may target the one that's already right, or the agent split them intentionally). This trades away catching a partial miss (some fixed, some not) for never false-firing on a legitimately-mixed page — the correct trade given the cardinal sin. Zero candidates → no check.
- Comparison is normalized + tolerant (color → family; size → range). Any ambiguity (no candidate, property unmeasurable, family unclear, a candidate whose direction is neither clearly row nor column) → NOT a mismatch. Reconcile returns a mismatch only when the render UNANIMOUSLY + CLEARLY contradicts the user's ask.
- **Anti-game note (review Important):** because Piece 1 measures the `data-orientation` carrier's OWN computed direction (not a parent wrapper), an agent can't satisfy the check by wrapping the control in a `flex-direction:column` div while the control itself still lays its items out `row`. The carrier still reads `row` → still a mismatch. (A genuine fix — the agent rebuilds the control as real stacked rows without the swallowed prop — legitimately flips the carrier or removes it from the candidate set; that's a real fix, correctly passing.)

### Piece 4 — corrective turn + honest banner via a UNIFIED render-verification service
**Where:** `studio/server/middleware/chat.ts` + the client trigger in `useProjectFromHost.ts`, refactoring VN's rails into a shared service with **per-check state**.

- **Rev-2 unification (review Important — VN + render-verify collide on VN's SINGLE `awaitingCorrective` bool, single `visualNoOpBannerForFrame`, and shared `ranForTurn` key):** rather than a 7th parallel feature, fold both into one corrective-turn service with a `checkKind` discriminator (`"visual-noop"` | `"render-mismatch"`). The client one-shot, `awaitingCorrective`, and banner state become keyed by `{userTurnId, checkKind}` (or simply: at most ONE corrective per user-turn across BOTH checks — a turn that trips both fires a single corrective, VN's edit-noop taking priority since it's the stronger signal). The server one-shot `ranForTurn` key includes the kind. Distinct banner copy per kind (VN: "code changed but screen didn't"; render-mismatch: "you asked for vertical; it's still horizontal").
- **Rev-2 own-trigger (Critical — VN's `shouldTriggerVisualNoOpRetry` hard-requires `candidateBuffered`, which only a frame-change edit-cycle produces → dead on a no-edit turn):** render-verify gets its OWN trigger `shouldTriggerRenderVerify({ requestedNonEmpty, phase, digestPresent, alreadyHandledThisTurn })` that does NOT require an edit/candidate. Both triggers live in the turn-end effect in `useProjectFromHost`; they share the single "at most one corrective per turn" guard but each has its own precondition. Render-verify's precondition: `phase==="done"` + the user's prompt yielded a requested property + a digest is buffered for the target frame + reconcile found a unanimous mismatch.
- Corrective prompt (property-specific, from the USER'S ask): *"The user asked for the toggle groups to be vertical, but they render horizontal — the control's direction computes to row and the `orientation` prop isn't changing the layout. Rebuild it so it actually renders vertical (real stacked rows), or tell the user plainly that this control renders horizontally and you couldn't change it. Never report a visual result the render doesn't show."*
- Still-mismatched after the one corrective → soft banner (client-observed transient state, never server-appended — VN's cardinal-sin fix). One corrective max, then stop → no loop.

## Data flow (end to end, rev-2)
1. Each render, the frame PUSHES a digest (like `frame-fingerprint`); FrameCard buffers the latest for its frame and forwards it up via `onRenderDigest(frameSlug, digest)`.
2. Turn ends (`phase==="done"`). The shell has the user's PROMPT (`state.lastPrompt`) + the buffered digest for the edited/target frame.
3. `extractRequestedProperties(userPrompt) → Requested[]`. Empty → stop (no check).
4. `reconcile(requested, digest)` → unanimous mismatches. None → silent success.
5. Mismatch (and no corrective already fired this turn) → POST the corrective retry (unified service, `checkKind:"render-mismatch"`, session-resumed) + `reconnect()`.
6. Corrective turn ends → re-reconcile against the fresh digest. Still mismatched → soft banner. Resolved → silent.

## Relationship to VN (the sixth sibling) — UNIFIED, not parallel
- **VN check**: an EDIT produced an identical render (fingerprint match). Precondition: `frame-changed` → probe → buffered no-op candidate. Catches "edited, pixels didn't move," even when the narration is too vague to map a property.
- **Render-verify check**: the USER'S requested property contradicts the render, regardless of whether an edit happened. Precondition: turn-end + a mappable property in the prompt + unanimous mismatch. Catches "the render doesn't match what the user asked" — including the no-edit case VN structurally can't see.
- They are **complementary at the edges, redundant in the middle** — so rev-2 folds them into ONE corrective-turn service with two pluggable checks and per-turn single-fire state, avoiding the state collisions rev-1 would have hit.

## Why this matches the user's priority
- Directly on the exact failure just hit at the manual gate (agent satisfied itself from code; render disagrees) — and catches it even though the agent made no edit and claimed "already correct", because we check the USER'S ask against the render.
- Gives the agent the one sense it never had — the rendered truth — at the cheapest point (structured computed styles, not pixels/vision).
- Studio-side only; no arcade-gen change; unifies with VN's measurement + corrective rails, so it's a consolidation, not new infra.

## Why this matches the user's priority
- Directly on the exact failure just hit at the manual gate (agent satisfied itself from code; render disagrees).
- Gives the agent the one sense it never had — the rendered truth — at the cheapest point (structured computed styles, not pixels/vision).
- Studio-side only; no arcade-gen change; reuses VN's measurement + corrective rails, so it's an extension, not new infra.

## Non-goals (explicit)
- **Screenshot + vision verification (Approach B, the full keystone)** — catches any visible mismatch; heavy (headless browser dep + vision round-trip). Separate, later. This is the cheap enumerated-property 80%.
- **Fixing the kit's ToggleGroup `orientation` gap** — a real kit gap, tracked separately; NO arcade-gen changes here. The feature closes the CLASS regardless.
- **Design/aesthetic judgment** — not "is it good", only "does the render match what you CLAIMED".
- **Verifying unclaimed properties** — only what the agent explicitly asserted.

## Files (indicative — confirm at plan time; all verified against the real repo)
| File | Change |
|---|---|
| `studio/src/frame/renderFingerprint.ts` (or a sibling `frameDigest.ts`) | Add `digestElements(root, measure, cap)` → compact digest `[{tag, dataOrientation, role, styles}]`. Reuses `productionMeasure`'s computed-style read; ADDS identity-attr capture (`data-orientation`/`role`) — the part productionMeasure doesn't give. Measures the `data-orientation` CARRIER's own direction (anti-game). Pure + injectable-measure testable. |
| `studio/server/plugins/frameMountPlugin.ts` (`buildFrameBootstrapSource`) | PUSH a `frame-digest` message on each render (mirror the existing `frame-fingerprint` push — same effect, after fonts+rAF), carrying the digest. No request/response needed. |
| `studio/src/components/viewport/FrameCard.tsx` | Buffer the latest `frame-digest` for THIS frame (it owns the iframe + already handles `frame-fingerprint`); forward up via a new `onRenderDigest(frameSlug, digest)` prop (mirrors `onVisualNoOp`). This is the reachability fix — the shell can't address `contentWindow`. |
| `studio/server/renderVerify.ts` (NEW) | `extractRequestedProperties(userPrompt)`, `reconcile(requested, digest)` (UNANIMOUS contradiction only), the property-specific corrective prompt(s). Pure; mirrors `visualNoOpRetry.ts`. Bounded prompt→property map. |
| `studio/server/middleware/chat.ts` | UNIFY: the corrective route takes a `checkKind` (`visual-noop`|`render-mismatch`) + prompt; one-shot `ranForTurn` keyed by `{userTurnId, checkKind}`. Same `startTurn`+`runClaudeBranch` machinery. |
| `studio/src/hooks/useProjectFromHost.ts` | Buffer per-frame digests (from `onRenderDigest`); on turn-end run BOTH checks (VN's edit-noop + render-verify's request-vs-digest), single-fire per turn (edit-noop priority), shared `awaitingCorrective`/turn-lineage one-shot + turn-transition reset. Verify against `state.lastPrompt` (the USER'S ask), not the summary. |
| `studio/src/components/chat/RenderMismatchBanner.tsx` (NEW, sibling to VisualNoOpBanner) | Own copy ("you asked for vertical; it's still horizontal…") + own sentinel. Client-observed transient state, per-kind so it doesn't collide with VN's banner. |
| Tests | `renderVerify.test.ts` (extractRequestedProperties from prompts incl. the no-keyword agent-reply case; reconcile: all-row vs vertical → mismatch, all-column → none, MIXED row+column → none (no false-fire), zero candidates → none, color family tolerance); digest helper test (injected measure, identity-attr capture, carrier measurement); trigger-decision test (no-edit turn with a mappable prompt STILL triggers; no-mappable-prompt doesn't; both-checks-trip → single corrective); unified route one-shot test (per-kind key). jsdom can't do real computed-style layout → the real digest + carrier direction is a manual-gate item. |

## Open questions (resolve in the plan)
1. **Digest scope + size** — candidate set = `data-orientation` carriers + a tag/role allowlist for color/size, DOM-order capped. Confirm the cap value + `log` the drop. Keep the payload a summary (50KB lesson).
2. **Prompt property extraction robustness** — `extractRequestedProperties` reads `state.lastPrompt`. Confirm `lastPrompt` holds the CURRENT user turn's prompt at the corrective turn's boundary too (it may be overwritten by the corrective — capture the originating prompt alongside the originating turn id). Enumerate the v1 keyword map + bias to no-extraction on ambiguity.
3. **Unification shape** — confirm the single "at most one corrective per user-turn across both checks" rule + edit-noop priority, and the per-`checkKind` server one-shot key, cleanly avoid the VN state collisions. Confirm the two triggers coexist in one turn-end effect.
4. **Color/size tolerance** — exact normalization + family/range matching so a correct render never false-mismatches. Bias hard toward silence.
5. **Digest push timing on a no-edit turn** — the frame pushes a digest on every render (incl. the initial + at-rest). Confirm a digest is buffered for the target frame at turn-end even when the turn made no edit (the committed frame rendered once at project-open and hasn't re-rendered — so its ONE digest from mount must still be buffered, not discarded). If the mount-time digest is the only one, confirm FrameCard retains it. This is the crux — verify the buffered digest exists on a no-edit turn.
