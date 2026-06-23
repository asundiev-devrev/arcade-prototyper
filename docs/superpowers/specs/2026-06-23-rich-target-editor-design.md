# Rich Target Editor — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Area:** `studio/` (Arcade Studio app)

## Problem

Studio already lets a user "target" an element in a rendered frame: click the
crosshair on a `FrameCard`, click an element, and Studio resolves the exact
`file:line:column` of the JSX that produced it (`studio/src/frame/picker.ts`).
But the only thing the user can do after targeting is **type a sentence** into
chat ("make this blue", "bump the font size"). There is no direct manipulation
and no live preview — every visual tweak is a round-trip through the Claude
generator with no immediate feedback.

We want to graft a **rich visual inspector** onto that existing pipeline,
inspired by [design-mode](https://github.com/SandeepBaskaran/design-mode), so a
designer can change Text / Typography / Color / Spacing with real controls, see
the change **live**, batch the pending edits, then **commit** them to idiomatic
source (Tailwind utility classes + arcade-gen design tokens) in one action.

## What this is NOT (design-mode borrowings we deliberately drop)

design-mode is a **Chrome extension** talking to an AI agent across process
boundaries via an **MCP server / WebSocket bridge** (8 MCP tools:
`get_changes`, `apply_changes`, …). That entire bridge exists *only* because the
extension and the agent are two strangers in separate processes.

**Studio is both ends already.** The inspector lives in the same React shell
that owns the Claude subprocess (`/api/chat`). Pending overrides are just state
in the shell; Commit hands them straight to the existing generator. So the
following are explicitly **out of scope** — not deferred, structurally
unnecessary:

- MCP server, WebSocket bridge, the 8 MCP tools
- The Chrome-extension packaging entirely
- Drag handles / on-canvas resize geometry
- Layers / DOM-tree panel
- Effects (shadow, blur, noise, texture), motion/animation, transforms
- Layout / flexbox direction controls

## v1 scope (the four edit categories)

| Category | Controls | Maps to on commit |
|---|---|---|
| **Text content** | inline text field | source string literal |
| **Typography** | size, weight, bold/italic, alignment, color | `text-*`, `font-*`, arcade type tokens |
| **Color & fill** | text color, background, border color — picker + token/site-palette dropdown | arcade color tokens (e.g. `text-(--fg-...)`, `bg-(--bg-...)`) |
| **Spacing & size** | padding, margin, gap, width, height — numeric fields | Tailwind spacing scale (`p-4`, `gap-2`, …) |

## Experience flow

1. User clicks the crosshair on a `FrameCard`. The **inspector panel slides in
   on the right edge** of the Studio window, in an empty state: "Click an
   element to edit." (The panel is the mode container; selection drives its
   content — matching design-tool convention.)
2. User clicks an element in the frame. The panel **populates** with that
   element's current Text / Typography / Color / Spacing, read live from the
   element's computed styles.
3. User drags a slider / picks a color / edits text. The frame updates
   **instantly** via throwaway CSS overrides — *not* source edits yet.
4. Each change stacks into a **pending-changes list** ("font-size 14→18px",
   "color → blue-600", "text → 'Save'"). Individual changes can be removed.
5. User clicks **Commit**. The pending changes are serialized into one
   instruction to the existing Claude generator, which rewrites the real source
   using Tailwind classes + arcade tokens. The frame hot-reloads with real code;
   overrides clear.
6. **Discard** wipes the overrides and the frame snaps back to its source.
   Closing the panel / clearing the target also discards.

Net: the user *sees* it before they *commit* it, and committed code stays
idiomatic (tokens, not raw hex) — which protects the LIFT → production handoff
(see auto-memory `lift-manifest-consumption-tested`, `feedback_scalable_accuracy`).

## Live preview mechanism

Preview is throwaway, applied directly to the **retained DOM node** that
`inspector.ts` keeps after a pick: `node.style.fontSize = "18px"`,
`node.textContent = "Save"`, etc. No managed stylesheet, no selector, no stamped
id.

**Why inline is enough here** (this was the main over-engineering risk, examined
and rejected):

- **React re-renders the same node** — an out-of-band inline `style` we set
  *survives*. React only reconciles the `style` prop it owns, and Studio frames
  style via `className`, not `style`. React never re-writes the node's `style`,
  so it never clobbers ours.
- **Vite HMR reload** — only fires when *source* changes, which only happens on
  **Commit**, where we clear overrides anyway. No preview is expected to survive
  HMR.
- **Full unmount/remount** (a timer/animation in the prototype swaps the
  subtree) — inline styles are lost, but so would a stamped `data-*` id be (both
  are DOM mutations, not source). A keyed stylesheet would only survive via a
  brittle structural selector, so it doesn't actually buy the robustness it
  appears to. And the window is tiny: during an edit session the picker
  intercepts clicks, so the user isn't driving the prototype's own state and
  autonomous re-renders are near-zero.

If remount ever proves to clobber previews in practice, the cheap fallback is a
`MutationObserver` that re-applies the `pending` values to the re-rendered node —
deferred until observed, not built up front.

The committed result always comes from the `pending` state in the shell, never
read back from the DOM — so preview fragility can never corrupt a commit.

## Architecture — three units + one pure function

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| `inspector.ts` | inside iframe — sibling to `picker.ts` | After a pick: retain the DOM node (today's `picker.ts` discards it), read its computed styles, post the inspect report, and apply/clear inline preview (`node.style.*`, `node.textContent`) on message. Reuses `picker.ts`'s fiber→source resolution. | `picker.ts` |
| `targetSelectionContext.tsx` (extended) | shell — existing context, add a `pending` field | Single source of truth: the current target **plus** the pending edits (the set of control values that differ from their originals). Panel binds to it; commit reads it. No new context — just a new field + setters. | — |
| `InspectorPanel.tsx` | shell — new, right edge | The UI. arcade-gen controls grouped Text / Typography / Color / Spacing + Commit / Discard. Reads initial values from the inspect report; on each control change updates `pending` and posts a preview message to the iframe. The controls *are* the pending state — resetting a control to its original removes that change. No separate stacked list. | extended context, arcade-gen |
| `buildVisualEditPreamble()` | shell — pure fn, sibling to `buildTargetPreamble()` | Serialize the pending edits + target `file:line:column` into one Claude instruction. Pure → unit-testable. | — |

**Commit is not a unit** — it reuses the existing `onSend` / `/api/chat` path
the typed flow already uses (`buildTargetPreamble` → `onSend`). No new server
endpoint.

### postMessage protocol (extends the existing `*`-origin pattern in `picker.ts`)

Parent → iframe:
- `arcade-studio:frame-pick-start` / `-stop` *(exists)*
- `arcade-studio:preview` — `{ property, value }` (one verb covers style props
  and `text`; `inspector.ts` applies to the retained node; clearing = sending
  the original values back, or a `reset` payload)

iframe → parent:
- `arcade-studio:frame-picked` *(exists — extended with a computed-style snapshot, becoming the "inspect report")*
- `arcade-studio:frame-pick-cancelled` *(exists)*

### Data flow

**Pick:** crosshair → panel slides in (empty) → element click → `inspector.ts`
retains the node, reads computed styles, posts the inspect report → context
stores target + initial values → panel populates.

**Edit (live):** panel control change → update `pending` in context → post
`preview` to iframe → `inspector.ts` sets `node.style.*` / `textContent` → frame
updates instantly.

**Commit:** `buildVisualEditPreamble(target, pending)` → `onSend(...)` → existing
Claude subprocess rewrites source → Vite HMR reloads frame with real code →
context clears.

**Discard / close:** post `preview` with the original values (reset) → frame
snaps back → context cleared.

## Error handling

- **Pick fails** (no fiber / no source): reuse today's `frame-pick-cancelled`
  reasons + toast. Panel returns to empty state.
- **Commit produces no edit** (phantom edit): already covered by
  `server/phantomEditRetry.ts` — the visual-edit path inherits the same retry,
  because it rides `onSend`.
- **Override on a node that vanishes** (remount replaced the subtree): the
  inline style is lost → preview reverts harmlessly. Panel still holds the
  pending value; commit is unaffected (it reads `pending`, not the DOM).
- **Off-scale values** (e.g. font-size 17px with no exact Tailwind step): the
  pending list keeps the raw value; Claude maps it to the nearest idiomatic
  token/class on commit (this is *why* we chose Claude translation over a
  deterministic table — see Decisions).

## Testing

- `buildVisualEditPreamble()` — pure unit tests (`__tests__/`): correct
  serialization of each category, multiple stacked changes, file:line inclusion.
- `targetSelectionContext.tsx` `pending` field — tests: set / reset / clear
  pending values, target switch resets pending.
- Component: `InspectorPanel.tsx` with arcade-gen mocked (per studio test
  discipline — mock must export the controls used).
- Manual: dev-only feature → verify live in `pnpm run studio` (picker uses React
  internals, dev-only by design; same constraint as `picker.ts`).

## Key decisions (and why)

1. **Hybrid: live preview as CSS overrides → batch → Claude commits to source.**
   Chosen over (a) direct manipulation that writes source on every drag (too
   chatty, token-expensive) and (b) a pure properties form (loses the "see it
   live" win).
2. **Claude translates overrides → Tailwind/tokens on commit.** Chosen over a
   deterministic CSS→class mapping table (brittle, fights the design system) and
   over raw inline `style={}` in source (non-idiomatic, worst for
   LIFT→production). Reuses the entire existing edit pipeline → minimal new
   server code.
3. **Panel-only interaction (no drag handles, no layers).** Avoids iframe
   coordinate/scroll/zoom geometry sync — significant work for marginal v1 value.
4. **Right-side inspector**, opposite the left chat pane — familiar design-tool
   layout, doesn't crowd the frame.
5. **Inline `node.style.*` preview on the retained node** — not design-mode's
   managed keyed stylesheet. That machinery solves re-render churn on arbitrary
   production SPAs; Studio frames are className-styled static prototypes with the
   picker intercepting clicks, so the churn it guards against barely exists, and
   the stamped-id version wouldn't survive remount anyway. Commit reads `pending`
   state, not the DOM, so preview fragility can't corrupt a commit. See Live
   preview mechanism for the full rejection.

## Open implementation notes (for the plan, not blockers)

- The crosshair toggle in `FrameCard.tsx` currently both starts picking *and*
  is reused as "clear target." With the panel, picking-start should open the
  panel; need to reconcile the toggle's three states (idle / picking /
  targeted) with panel open/closed.
- `targetSelectionContext.tsx` is global (one target at a time across all
  frames) — keep that; the panel is singular.
- Confirm frames are same-origin (they are: served from `/api/frames/...` on the
  same Vite origin) so `inspector.ts` can read computed styles. Reading
  `getComputedStyle` needs same-origin — already satisfied, since today's
  `picker.ts` reads fiber internals across the same boundary.
