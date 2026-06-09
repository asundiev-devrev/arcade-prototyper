# Figma Export — Hybrid Swap Fidelity Follow-ups

**Date:** 2026-06-09
**Status:** Scoping note (not yet a full design). Spun out of the hybrid-swap live run (PR #11).
**Parent:** `2026-06-09-figma-export-hybrid-design.md`

The hybrid swap is validated (51 real instances, perfect layout). Live review of the
result surfaced three fidelity gaps. One is fixed; two are real follow-up work captured here.

## Fixed (this PR)

**#1 — Variant props now applied.** The live T8 inline `figma_execute` script defaulted
every IconButton/Button to the set's `Primary` variant (the filled circular button),
because that throwaway script never applied the variant mapping. The **committed
`planSwap` was already correct** — it resolves arcade-gen props (`variant:"tertiary"`,
`size:"sm"`) through `componentEntries.ts` valueMaps onto the Figma variant axes. Locked
with a regression test (`swapPlan.test.ts` → "resolves multi-axis variant props"). No
production code change needed; the bug lived only in the demo script.

## Follow-up A — Re-curate the sidebar row (library drift)

**Problem:** the 0.3 library deprecated its **entire Navigation page** since the original
curation. Every row/nav set is now `[🔴DEPRECATED]`: `Chat Item` (ab11c00f, what we map
to), `Computer Item`, `Item`, `Node Item`, `Leaf Item`, `[DLS]Nav.List.*`, `Chat Group`.
The only non-deprecated row-ish set is a bare `_Item` (`51e257d3…`), unconfirmed as the
intended replacement. So `ComputerSidebar.Item` → `Chat Item` now instances a deprecated
component (the swap surfaced `[🔴DEPRECATED] Chat Item ×29`).

**Needs:** the DS owner to confirm the live canonical chat/session row in 0.3 (is it
`_Item`? something on a new page?). Then a one-line re-map in `componentEntries.ts`
(`componentSetKey` + the label TEXT-property name) + re-verify live. **Do not auto-pick
`_Item` blind** — the library is mid-migration. Blocked on the owner's answer, not on us.

## Follow-up B — Capture + swap real icons (serializer change)

**Problem:** IconButtons swap in with the set's **default placeholder glyph** (`Icons/Plus`,
the circular plus), not the real icon from the frame (toggle-sidebar, chevrons, history
clock, bell, send arrow, add-collaborator). Root cause: the fiber walk **prunes at the
IconButton** (prune-with-text) and never records the child icon's identity, so the manifest
has no idea which glyph the button contains. The swap creates the right *container* with no
way to set its icon.

**Needs (real feature, own slice):**
1. **Serializer:** when walking a mapped primitive that has an icon slot (IconButton,
   icon-bearing Button, CanvasPanel.Item leading), capture the inner arcade-gen icon
   component name (e.g. `ChevronLeftSmall`, `Clock`, `Bell`, `ArrowUpSmall`) onto the
   `ManifestComponent` (e.g. an `icon?: string` field) — without un-pruning the whole
   subtree.
2. **iconMap:** arcade-gen icon name → 0.3 `Icons/*` component key. (`iconEntries.ts` /
   `iconMap.ts` already exist from the widen work — reuse.)
3. **Swap:** after creating the IconButton instance, set its icon **instance-swap
   component property** to the mapped `Icons/*` key (match the prop by `INSTANCE_SWAP`
   type, like the TEXT-prop match by base-before-`#`).

**Effort:** medium. Touches the serializer (`fiberWalk`/`exportFrameToSlj`), the manifest
type (`swapOps.ts`), and the swap executor. Gated by: the icon-bearing components needing
a stable way to expose their slot icon in the fiber (the icon is usually a named arcade-gen
component child, so the fiber should see it — verify).

## Also tracked (from PR #11, unchanged)
- Token/variable binding into the swap (`binds` unpopulated; instances inherit converter
  flat fills).
- Live entrypoint / UI capture+swap trigger.
- Transcript bubbles overflow the clipped viewport (anchor at full-scrollback Y).
