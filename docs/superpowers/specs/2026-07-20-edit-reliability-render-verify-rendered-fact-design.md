# Edit reliability — "verify the claim against the render, not the code"

**Date:** 2026-07-20
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
1. **Extract the claim** — the agent's turn summary asserts a visual/layout property ("now vertical", "background gray").
2. **Measure the truth** — on turn-end, the shell asks the frame for the *actual computed styles* of the relevant elements; the frame answers from the CURRENT render (works on a no-edit turn — no re-render needed).
3. **Reconcile** — if the claimed property contradicts the rendered fact, feed that back as a corrective turn ("you said vertical; the rendered result is horizontal — achieve it a different way or report honestly"); if they agree, silent success.

## Honest coverage bound (state plainly, like every sibling)

This verifies **enumerated properties**: a bounded claim→property map (v1: orientation/direction, background color, text color, size/dimension, visibility) measured against the rendered computed styles. It does NOT:
- **Catch a purely-visual mismatch outside the measured set** (wrong icon, wrong spacing nobody claimed, subjective "looks off") — that's the full vision keystone (B), explicitly out of scope and separately specced later.
- **Judge intent/aesthetics** — it only checks "does the rendered property match the property the agent CLAIMED." It's a claim-vs-render consistency check, not a design critic.
- **Fire when the agent makes no claim** — a vague summary ("updated the toggles") with no mappable property → no check (safe direction: a missed verify is acceptable; a FALSE "this is wrong" over a correct render is the cardinal sin — so the reconcile errs toward silence on any uncertainty).

The realistic claim: "**a visual property the agent explicitly claims is now checked against the real render**, for the enumerated property set — the swallowed-prop / claimed-but-not-rendered class is caught; the un-enumerated visual tail is not." This is the cheap 80% of the render-verify keystone, built on VN's rails.

## Design — components at verified layers (all studio-side, all reuse shipped infra)

### Piece 1 — an on-demand render digest from the frame
**Where:** extend the frame bootstrap (`frameMountPlugin.ts` `buildFrameBootstrapSource`) + a new digest helper reusing `productionMeasure` (`studio/src/frame/renderFingerprint.ts`).

- The shell posts the frame a request `{ type: "arcade-studio:frame-digest-request", n, selector? }`. The frame responds `{ type: "arcade-studio:frame-digest", n, elements: [{ tag, role?, textSnippet?, styles: {flexDirection, backgroundColor, color, width, height, display, ...the PAINT_PROPS set} }] }`.
- Reuses the picker's proven request→response postMessage pattern (`frame-pick-start` → `frame-picked`) and VN's `productionMeasure` (already reads exactly these computed styles). Frame is same-origin — `contentWindow.postMessage` works.
- v1 digest scope: the frame returns a compact digest of the **candidate elements** — kit-component roots (elements carrying `data-orientation`, or matching a small tag/role set) plus a bounded cap (e.g. first N by DOM order) so the payload stays small (the computer-agent 50KB tool-output lesson applies — keep it a summary, not the DOM). Element count cap is `log()`-noted, never silently truncated.
- Works on a **no-edit turn**: it measures the current committed render — no `frame-changed`, no probe needed. This is the crux VN couldn't reach.

### Piece 2 — claim extraction + claim→property mapping
**Where:** a new pure module `studio/server/renderVerify.ts` (mirrors `visualNoOpRetry.ts`: pure functions + a corrective prompt).

- `extractVisualClaims(summaryLine) → Claim[]` where `Claim = { property: "orientation"|"backgroundColor"|"color"|"size"|"visibility"|…, expected: string, subjectHint?: string }`. v1: keyword/pattern extraction over the SUMMARY line only (reuse VN's `firstSummaryLine`), gated by `narrationClaimsVisualChange` first. "vertical"/"stacked"/"column" → `{orientation, expected:"vertical"}`; "horizontal"/"side by side" → `{orientation, expected:"horizontal"}`; a color word → `{backgroundColor|color, expected:<named>}`; etc. Bounded, extendable by adding rows (like `kitMappings` / the token seed).
- Deliberately conservative: unmappable summary → no claims → no check (safe).

### Piece 3 — reconcile claim vs digest
**Where:** `renderVerify.ts` — `reconcile(claims, digest) → Mismatch[]`.

- For each claim, find the relevant digested element(s) and compare the claimed property to the rendered computed value. Orientation: claim "vertical" but every candidate's `flexDirection` is `row` → mismatch. Comparison is **normalized + tolerant** (a color claim matches if the rendered value is in the right family; a size claim matches a range) — because the cardinal sin is a FALSE mismatch. Any ambiguity (can't find the subject element, property not measurable, family unclear) → **NOT a mismatch** (err toward silence).
- Returns mismatches only when the render **clearly contradicts** an explicit claim.

### Piece 4 — the corrective turn + honest banner (reuse VN's rails)
**Where:** `studio/server/middleware/chat.ts` (extend or sibling the VN route) + the client trigger in `useProjectFromHost.ts`.

- On turn-end (any turn, edit or no-edit — this is the key difference from VN, which required a frame-change): the client requests a digest, runs `extractVisualClaims` + `reconcile`. On a mismatch → POST a corrective retry (server-owned, session-resumed, one-shot per user-turn — exactly VN's `handleVisualNoOpRetry` machinery) with a claim-specific corrective prompt: *"You said the toggle groups are vertical, but they render horizontal (the control's direction is row — the `orientation` prop isn't changing the layout). Achieve vertical a different way (a wrapper with column layout) so it actually renders, or say plainly that the kit renders them horizontally. Never claim a visual result the render doesn't show."*
- If the corrective turn STILL reconciles to a mismatch → the soft **VisualNoOpBanner** sibling (reuse the client-observed transient banner from VN, or a `RenderMismatchBanner` with its own copy: "You asked for vertical; it's still rendering horizontal — the kit may not support it. Want to try a different layout?"). Client-observed, never server-appended (VN's cardinal-sin fix).
- One-shot + loop-safety: reuse VN's `awaitingCorrective` flag + turn-lineage guard verbatim.

## Data flow (end to end)
1. Turn ends (`phase==="done"`), narration streamed. Client has the summary.
2. `narrationClaimsVisualChange(firstSummaryLine)` gate → if it claims something visual, `extractVisualClaims` → `Claim[]`. Empty → stop (no check).
3. Client posts `frame-digest-request` to the frame; frame replies `frame-digest` with computed styles of candidate elements.
4. `reconcile(claims, digest)` → mismatches. None → silent success.
5. Mismatch → POST the corrective retry (server turn, session-resumed) + `reconnect()`. One-shot per user-turn.
6. Corrective turn ends → re-digest + re-reconcile. Still mismatched → soft banner. Resolved → silent.

## Relationship to VN (the sixth sibling) — complementary, not overlapping
- **VN**: an EDIT produced an identical render (fingerprint match). Trigger: `frame-changed` → probe. Catches "edited, pixels didn't move."
- **This (render-verify)**: a CLAIM contradicts the render, regardless of whether an edit happened. Trigger: turn-end + a mappable visual claim. Catches "claimed a visual result the render doesn't show" — including the no-edit case VN can't see.
- They share the corrective-turn + banner rails and the in-frame measurement. A turn could in principle trip both; the one-shot guard (per user-turn) ensures at most one corrective fires.

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
| `studio/src/frame/renderFingerprint.ts` (or a sibling `frameDigest.ts`) | Add `digestElements(root, measure, cap)` returning the compact computed-style digest, reusing `productionMeasure` + `PAINT_PROPS`. Pure + injectable-measure testable. |
| `studio/server/plugins/frameMountPlugin.ts` (`buildFrameBootstrapSource`) | Handle `frame-digest-request` → post `frame-digest` (computed styles of candidate elements). Mirror the picker's message handler. |
| `studio/server/renderVerify.ts` (NEW) | `extractVisualClaims(summaryLine)`, `reconcile(claims, digest)`, the corrective prompt(s). Pure; mirrors `visualNoOpRetry.ts`. Bounded claim→property map. |
| `studio/server/middleware/chat.ts` | Corrective-retry route: extend `/api/chat/visual-noop-retry` (or sibling `/render-verify-retry`) — same `startTurn`+`runClaudeBranch` + one-shot machinery, claim-specific prompt. |
| `studio/src/hooks/useProjectFromHost.ts` | On turn-end (edit OR no-edit): gate → request digest → reconcile → POST corrective + `reconnect` → banner. Reuse VN's `awaitingCorrective`/turn-lineage one-shot + turn-transition reset. |
| `studio/src/components/chat/` banner | Reuse `VisualNoOpBanner` or add `RenderMismatchBanner` (own sentinel/copy). Client-observed transient state. |
| Tests | `renderVerify.test.ts` (extractVisualClaims both directions; reconcile: vertical-claim vs row-render → mismatch, vertical-claim vs column-render → none, ambiguous → none, color family tolerance); digest helper test (injected measure); trigger-decision test (no-edit turn still triggers; no-claim turn doesn't); route one-shot test. jsdom can't do real computed-style layout → the real digest is a manual-gate item. |

## Open questions (resolve in the plan)
1. **Digest scope + size** — which elements to measure (all `data-orientation` carriers + the picked/edited subtree? a tag/role allowlist? a DOM-order cap?) and how to keep the payload small. Confirm the cap + `log` the drop.
2. **Subject resolution** — mapping a claim's `subjectHint` ("the toggle groups") to digest elements. v1 may just check ALL candidate elements of the relevant kind (if the claim is "vertical" and ANY toggle-group-like element renders `row`, mismatch) — simplest, and matches the repro. Confirm.
3. **Extend the VN route vs a new one** — the machinery is identical; decide whether render-verify reuses `handleVisualNoOpRetry` (with a claim-specific prompt param) or gets a sibling. Keep the one-shot keyed per user-turn either way so VN + render-verify can't double-fire.
4. **Color/size tolerance** — the exact normalization + family/range matching so a correct render never false-mismatches. Bias hard toward silence.
5. **No-edit-turn digest timing** — on a no-edit turn there's no `frame-changed`/settle signal; when does the shell request the digest (immediately on `done`? after a short settle?) and does the frame need the fonts.ready + rAF wait VN uses. Confirm the current-render measurement is stable at request time.
