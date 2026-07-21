# Render-verify keystone v3 — isolation before/after

**Date:** 2026-07-20
**Status:** design for review
**Umbrella:** "edit reliability" (beta feedback, gil.zissu). The user's #1 concern, restated in their words across this session: **"the agent keeps claiming to have done something it didn't (or didn't render)."** Two prior attempts to catch this (visual-noop, render-verify v1/v2) shipped code-complete + adversarially reviewed + green-tested, then BOTH failed the live manual gate for the *same* root cause. This is the third attempt, and the first whose core mechanism is **proven on the real repro by a spike** before speccing.

## The failure this closes (and why the first two missed)

**The class:** the agent writes a change that is valid code but produces **no visible rendered result** — a prop the component silently ignores — and reports success. Confirmed live repros this session:
- `className="bg-(--surface-shallow)"` on `SettingsCard` → `SettingsCard` is `({title, children})`, drops `className` → background never changes. Agent: "General card background now purple. Deviations: None."
- `orientation="vertical"` on `ToggleGroup.Root` → the kit hardcodes `inline-flex`, ignores `orientation` → still horizontal. Agent: "ToggleGroups now stack vertically."

Neither the write-hooks (valid prop, real token, real import) nor the phantom-edit check (a file *did* change) catch it. Only looking at the **rendered result** does.

**Why v1 (visual-noop) + v2 (render-verify) both died — ONE root cause, proven with a live [RV-DIAG] probe:** they measured the **live iframe**, which renders a multi-page frame's `renderPage(active)` — the DEFAULT page (e.g. MyComputer), never the edited page (Preferences). The fingerprint was constant (`d8b977cd`) across every edit because the measured DOM never contained the edited page. The bug was **the router**, not the measurement idea. Both are now disabled behind `RENDER_MEASUREMENT_FEATURES_ENABLED=false`.

**The v3 insight:** remove the router from the loop. Don't measure the running app. **Render the specifically-edited page component in isolation** (a synthetic entry that mounts `<Preferences/>` directly, no sidebar, no router), before vs after the edit, and compare. No `active` page state → the multi-page trap cannot recur.

## Spike evidence (feasibility PROVEN, not assumed — 2026-07-20)

A throwaway spike ran the real `computer-settings` frame through the *shipped* multi-file isolation bundler (`packFromDir`) with a synthetic `<Preferences/>` entry, rendered each variant, and fingerprinted with the *shipped* `computeFingerprint`:

| Variant | fingerprint | Result |
|---|---|---|
| A — current source (before) | `37bef529` | isolated page rendered NON-BLANK (textLen 395, real timezone/language rows) |
| B — `className` added to SettingsCard (the swallow) | `37bef529` | **=== A** → swallowed prop correctly reads as NO-OP |
| C — real background change (wrapper div, real color) | `1d4c22cc` | **≠ A** → real visible change correctly reads as CHANGED |

Both unknowns answered YES: (1) an isolated page renders standalone non-blank; (2) before/after fingerprints **discriminate** — identical on the swallow, different on a real change. This is the exact repro that beat v1/v2, now detected correctly.

## Confirmed infrastructure (all shipped, all verified this session)

- `packFromDir(seedDir)` (`server/sidecar/packFromSource.ts:43`) — bundles a **multi-file** frame dir (index + siblings + arcade imports) via the shipped esbuild+Tailwind `buildFrameBundle`. Works in the packaged DMG.
- `buildFrameBundle` hardcodes the entry as `${framePath}/index.tsx` (`bundler.ts:190`) and aliases `arcade`/`arcade/components`/`arcade-prototypes` to the shims (`:151-155`) — so a synthetic index that renders the edited page resolves all its imports.
- Client-side isolation render + measurement already ships: `captureComponentThumb.ts` mounts an arbitrary component in a hidden same-origin iframe (served by `/api/.../preview` → `packFromSource`), lets it settle, reads `getBoundingClientRect`. **This is why no Chromium/Playwright ship is needed** — the shell's own browser does it. (Playwright was the spike's measuring tape only.)
- `computeFingerprint(root, measure)` + `productionMeasure` + `PAINT_PROPS` (`src/frame/renderFingerprint.ts`) — geometry+paint hash, no textContent. Reused as-is.
- Arcade pages render **prop-less** (`renderPage`: `<Preferences />`, `<MyComputer />` …) — verified in the real frame — so an isolated page needs no parent context.
- Edit-history snapshots exist (`server/editHistory.ts` `popSnapshot`) — the pre-edit "before" source; currently scoped to `index.tsx`, extended here to the edited page.

## Scope decision (locked with the user)

- **Only on edit turns to an existing frame where the agent claims a change** (the user's own scoping idea) — keeps the extra double-render rare, not every turn. First-generation turns (no "before") are skipped.
- **Studio-side only. NO `@xorkavi/arcade-gen` changes.** Component-agnostic by construction (it reads the rendered result, not per-component prop knowledge) — this is the general answer to "did it render," not the component-specific hook band-aid.
- **Response: ONE safe render-gated corrective** (user choice). On a confirmed no-op, auto-send exactly one corrective turn ("your change didn't render — the component ignored it; achieve it another way, or say plainly you couldn't"). Safe THIS time because detection is now correct: the corrective fires only on a *genuine* no-op, so it cannot churn a good edit into nonsense the way the broken v1/v2 detection did (that churn — ToggleGroup→ButtonGroup — came from false "nothing changed" on a *good* edit). One-shot, then stop.

## Honest bounds (state plainly, like every sibling)

- **Post-turn, not in-turn.** The render runs in the shell's browser, which only sees the turn after it ends. So a false "done" may briefly flash before the corrective fires. Strict in-turn prevention (never see it at all) would require shipping a headless browser into the write-hook subprocess (hundreds of MB) — explicitly out of scope; noted as a future upgrade if the flash proves annoying.
- **Isolation ≠ in-app for layout-dependent pages.** A page that relies on parent width/context could render differently standalone. Mitigation: we compare **before vs after in the SAME isolation** (relative change), not absolute correctness — so a systematic isolation offset cancels out. A page that fails to render standalone at all → **fail open** (no corrective, no false accusation).
- **"Rendered nothing" ≠ "rendered wrong."** v3 catches an edit that produced NO visual change (the swallow class). It does NOT judge whether a change that DID render matches intent (blue vs red) — that's a further keystone, out of scope.
- **One page at a time (v1).** If a turn edits multiple pages, verify the primary edited page (the one the claim references / the most-changed file); note the others as unchecked. No silent multi-page truncation — `log` it.

## Design — pieces at verified layers

### Piece 1 — before-snapshot the edited page
**Where:** the chat turn pipeline (`server/middleware/chat.ts`) + `editHistory.ts`.
- On turn start, for an edit turn, snapshot the source of the page file(s) the turn is likely to touch. Simplest correct v1: snapshot the whole frame dir's page sources (cheap — small text files) so whichever page the agent edits has a "before." Extend the existing `editHistory` snapshot (today `index.tsx`-only) to the frame's `pages/*.tsx`.

### Piece 2 — isolation render + fingerprint (server bundle, client measure)
**Where:** new `server/renderVerifyIsolation.ts` + a new `/api/verify-render` route + a client measurement helper reusing the thumbnail pattern.
- Server: given a frame dir + a target page relative path + a source variant, build a temp dir = frame copy with a **synthetic `index.tsx`** (`import Page from "./pages/<Target>"; export default () => <Page/>;`) and the variant's page source, then `packFromDir` → HTML. (Proven in the spike.)
- Client: mount the HTML in a hidden same-origin iframe (mirror `captureComponentThumb`), settle (`document.fonts.ready` + rAF), `computeFingerprint(iframe.contentDocument.body, productionMeasure)`. Do this for BEFORE and AFTER.
- Equal fingerprints ⇒ the edit rendered nothing.

### Piece 3 — the one-shot render-gated corrective
**Where:** reuse the shipped corrective-turn machinery (`startTurn` + `runClaudeBranch`, the same shape as the existing `visual-noop-retry`/`render-verify-retry` routes) with a NEW pure policy module `server/renderVerifyIsolation.ts` for the prompt + one-shot key.
- On a confirmed no-op for an edit turn that claimed a change: POST a corrective (session-resumed) with a component-agnostic prompt: *"Your last change did not alter the rendered result at all — the page renders identically to before the edit. The property you set is being ignored by the component. Achieve the intent a different way (a wrapper with real layout/utility classes, a different component) so it actually renders, or tell the user plainly that you couldn't make it render and why. Never report a visual result the render doesn't show."*
- One-shot per originating user turn (own guard, mirroring the shipped retry one-shots). The corrective turn's own render is NOT re-verified for a further corrective (hard stop at one) — if it still no-ops, fall through to the honest soft banner (reuse `RenderMismatchBanner`).

## Data flow (end to end)
1. Turn start (edit turn, existing frame) → snapshot page sources ("before").
2. Turn ends `phase==="done"` AND the agent's summary claimed a change → trigger.
3. Client asks the server to bundle BEFORE and AFTER isolation HTML for the edited page (`/api/verify-render`), mounts each in a hidden iframe, fingerprints both.
4. Equal ⇒ confirmed no-op. Not-equal ⇒ silent success (real change rendered).
5. Confirmed no-op → POST one corrective (session-resumed) + reconnect. One-shot.
6. Corrective ends → re-verify once. Still no-op ⇒ soft banner (honest surrender). Rendered ⇒ silent.

## Non-goals (explicit)
- **In-turn prevention** (never see the false "done") — needs a shipped headless browser; out of scope.
- **Judging correctness of a change that DID render** (right color, right layout) — separate keystone.
- **Arcade-gen changes** — none; component-agnostic by construction.
- **Multi-page-per-turn full coverage** — v1 verifies the primary edited page; others noted, not silently skipped.
- **Reviving v1/v2 live-iframe measurement** — stays disabled; this replaces the approach, not the flag.

## Files (indicative — confirm at plan time; all verified against the real repo)
| File | Change |
|---|---|
| `server/editHistory.ts` (+ `chat.ts` turn start) | Snapshot the edited frame's `pages/*.tsx` sources at turn start (extend today's index.tsx-only snapshot) — the "before". |
| `server/renderVerifyIsolation.ts` (NEW) | Pure: build the synthetic-entry temp dir for a (frameDir, targetPage, sourceVariant) → delegate to `packFromDir`; the corrective prompt; the one-shot key/guard. |
| `server/middleware/chat.ts` | New `POST /api/verify-render {slug, frame, targetPage, which:"before"|"after"}` → returns isolation HTML. Reuse the corrective-turn machinery for the one-shot render-gated retry (own route or param on the existing shape). |
| `src/components/viewport/` or a shell hook | Client: mount before+after HTML in hidden iframes (mirror `captureComponentThumb`), `computeFingerprint` each, compare; on no-op + claim → POST corrective + reconnect; one-shot; banner on still-no-op. |
| `src/components/chat/RenderMismatchBanner.tsx` (reuse) | Honest-surrender banner when the corrective also renders nothing. |
| Tests | `renderVerifyIsolation.test.ts` (synthetic-entry construction; one-shot key; prompt shape); a fingerprint-discrimination test reusing the spike's A/B/C shape via injected measure; trigger-decision test (edit-turn + claim → fire; first-gen / no-claim → skip). Real isolation render is a manual-gate item (jsdom can't bundle+render); the SPIKE already proved it live. |

## Open questions (resolve in the plan)
1. **Trigger gate precision** — "edit turn that claims a change": reuse `narrationClaimsVisualChange` on the summary + require the turn actually wrote a `pages/*.tsx` file (frame-change contract). Confirm the exact conjunction; bias to NOT firing (a missed verify is fine; a wasted corrective is the cost).
2. **Target-page resolution** — which page did the turn edit? Use the frame-change contract's changed-file list; if multiple, the one the summary references, else the most-changed. Confirm + `log` unchecked pages.
3. **Before-snapshot cost/timing** — snapshot all `pages/*.tsx` at turn start vs only the predicted target. All-pages is simplest + cheap (small files); confirm no perf concern.
4. **Isolation double-render latency** — two bundles + two hidden-iframe mounts post-turn. Measure; it's off the critical path (turn already ended) but shouldn't stall the UI. Confirm acceptable; consider before-render caching (the "before" only changes when a new user turn starts).
5. **Corrective turn-lock** — the corrective is a real turn; ensure it doesn't collide with a user typing during the post-turn render window (reuse the shipped retry's turn-lock/reconnect handling).
