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

Live overrides must survive the frame re-rendering itself mid-session (React
re-renders, Vite HMR). Inline `style={}` on the node is wiped on any re-render —
**rejected**.

Adopt design-mode's proven approach: a **managed `<style>` element** injected
into the iframe `document.head`, holding rules keyed to a **CSS selector** that
uniquely identifies the picked element. Override rules are written/cleared by
editing that stylesheet's text, never by touching inline styles. This survives
re-renders because the selector re-matches the freshly-rendered node.

Text-content preview is the one exception: text lives in a text node, not a
style. Preview text by setting `textContent` on the picked node; it may be
re-clobbered on HMR, which is acceptable (preview-only, source is authoritative
on commit). The committed text always comes from the pending list, not the DOM.

**Selector strategy:** build a stable-ish selector for the picked node at pick
time (tag + nth-of-type chain up to the frame root, or a generated
`data-arcade-edit-id` stamped on the node). A stamped attribute is the most
robust and is the recommended approach — `inspector.ts` adds
`data-arcade-edit-id="<n>"` to the picked node and keys overrides off
`[data-arcade-edit-id="<n>"]`.

## Architecture — five focused units

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| `inspector.ts` | inside iframe — sibling to `picker.ts` | After a pick: retain the DOM node (today's `picker.ts` discards it), stamp `data-arcade-edit-id`, read computed styles, build the override stylesheet, apply/clear override rules, set preview text. Reuses `picker.ts`'s fiber→source resolution. | `picker.ts` |
| `EditSessionContext` | shell — extends `targetSelectionContext.tsx` | Single source of truth: the current target **plus** the ordered pending-override list. Panel binds to it; Commit reads it. | — |
| `InspectorPanel.tsx` | shell — new, right edge | The UI. arcade-gen controls grouped Text / Typography / Color / Spacing + pending-changes list + Commit / Discard. Reads initial values from the inspect report; emits override messages to the iframe; pushes pending changes into `EditSessionContext`. | `EditSessionContext`, arcade-gen |
| `buildVisualEditPreamble()` | shell — pure fn, sibling to `buildTargetPreamble()` | Serialize pending overrides + target `file:line:column` into one Claude instruction. Pure → unit-testable. | — |
| Commit | reuses existing `onSend` / `/api/chat` | No new server endpoint. Overrides ride the same edit path the typed flow already uses (`buildTargetPreamble` → `onSend`). | existing chat pipeline |

### postMessage protocol (extends the existing `*`-origin pattern in `picker.ts`)

Parent → iframe:
- `arcade-studio:frame-pick-start` / `-stop` *(exists)*
- `arcade-studio:apply-override` — `{ editId, property, value }`
- `arcade-studio:set-text` — `{ editId, text }`
- `arcade-studio:clear-overrides` — `{ editId }` (Discard / panel close)

iframe → parent:
- `arcade-studio:frame-picked` *(exists — extended with `editId` + computed-style snapshot, becomes the "inspect report")*
- `arcade-studio:frame-pick-cancelled` *(exists)*

### Data flow

**Pick:** crosshair → panel slides in (empty) → element click → `inspector.ts`
stamps `editId`, reads computed styles, posts inspect report → `EditSessionContext`
stores target + initial values → panel populates.

**Edit (live):** panel control change → push to pending list in context → post
`apply-override` / `set-text` to iframe → `inspector.ts` rewrites the managed
stylesheet → frame updates instantly.

**Commit:** `buildVisualEditPreamble(target, pending)` → `onSend(...)` → existing
Claude subprocess rewrites source → Vite HMR reloads frame with real code →
context clears overrides → `inspector.ts` removes the managed stylesheet.

**Discard / close:** post `clear-overrides` → stylesheet emptied → frame snaps
back to source → context cleared.

## Error handling

- **Pick fails** (no fiber / no source): reuse today's `frame-pick-cancelled`
  reasons + toast. Panel returns to empty state.
- **Commit produces no edit** (phantom edit): already covered by
  `server/phantomEditRetry.ts` — the visual-edit path inherits the same retry,
  because it rides `onSend`.
- **Override on a node that vanishes** (HMR replaced subtree, `editId` gone):
  selector simply stops matching → preview reverts harmlessly. Panel still holds
  the pending value; commit is unaffected (source-driven, not DOM-driven).
- **Off-scale values** (e.g. font-size 17px with no exact Tailwind step): the
  pending list keeps the raw value; Claude maps it to the nearest idiomatic
  token/class on commit (this is *why* we chose Claude translation over a
  deterministic table — see Decisions).

## Testing

- `buildVisualEditPreamble()` — pure unit tests (`__tests__/`): correct
  serialization of each category, multiple stacked changes, file:line inclusion.
- `EditSessionContext` — reducer-style tests: add / remove / clear pending
  changes, target switch resets pending.
- `inspector.ts` selector/stamp logic — unit test the `editId` stamping and
  override-rule string building (DOM-light, jsdom).
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
5. **Managed stylesheet keyed by `data-arcade-edit-id`** for live preview —
   survives re-renders, copied from design-mode's battle-tested approach.

## Open implementation notes (for the plan, not blockers)

- The crosshair toggle in `FrameCard.tsx` currently both starts picking *and*
  is reused as "clear target." With the panel, picking-start should open the
  panel; need to reconcile the toggle's three states (idle / picking /
  targeted) with panel open/closed.
- `targetSelectionContext.tsx` is global (one target at a time across all
  frames) — keep that; the panel is singular.
- Confirm frames are same-origin (they are: served from `/api/frames/...` on the
  same Vite origin) so `inspector.ts` can read computed styles without CORS
  issues. The managed-stylesheet approach works regardless, but computed-style
  *reading* needs same-origin — verified by today's `picker.ts` already reading
  fiber internals across the boundary.
