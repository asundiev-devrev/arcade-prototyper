# Curation decisions — arcade-gen → Arcade 0.3 (owner-confirmed)

Canonical Figma component per arcade-gen primitive, confirmed with the design
owner 2026-06-06. Keys (published component-set keys) + variant axes are
resolved via the Bridge in a follow-up pass; this file is the source-of-truth
for the NAMES/decisions so they survive a Bridge disconnect.

Convention: unprefixed (0.3) preferred; `[0.2]` fallback; reject `[DLS]`/`[WIP]`/`[🔴DEPRECATED]`.

| # | arcade-gen | Canonical 0.3 Figma | generation | notes |
|---|---|---|---|---|
| 1 | ChatBubble | **Bubble** | 0.3 | proven Slice 0; key edd2821d…; variant axis `Type` (Receiver/Sender) |
| 2 | Button | **Button** | 0.3 | unprefixed; axes Variant/Size/States/Disabled/Active/Loading |
| 3 | IconButton | **Icon Button** | 0.3 | unprefixed; 75 variants |
| 4 | Checkbox | **Checkbox** | 0.3 | unprefixed |
| 5 | Avatar | **User Avatar** | 0.3 | owner-specified (not Avatar Circle / Account Avatar) |
| 6 | Tooltip | **Tooltip** | 0.3 | owner link node-id 4592:40566 — the canonical tooltip |
| 7 | Tabs | **Tabs** (+ `_Tab Item`) | 0.3 | Tabs container + _Tab Item sub-component |
| 8 | Breadcrumb | **Breadcrumbs** (+ `_Separator` + `_Item`) | 0.3 | compound: Breadcrumbs + _Separator + _Item |
| 9 | Badge | **Counter** | 0.3 | arcade-gen "Badge" == 0.3 "Counter" (renamed concept) |
| 10 | Tag | **Chip** | 0.3 | arcade-gen "Tag" == 0.3 "Chip" (renamed concept) |
| 11 | Switch | **Toggle** | 0.3 | arcade-gen "Switch" == 0.3 "Toggle" (renamed concept) |
| 12 | Input | **text field** components | 0.2/0.3 mixed | represented by various "text field" comps, some `[0.2]`; pick the canonical text field, note generation per pick |
| 13 | Select | **Select** | 0.3 | owner link node-id 1150:8268 |
| 14 | Menu | **Menu** | 0.3 | owner link node-id 886:6081 |
| 15 | Modal | **Modal** | 0.3 | owner link node-id 4602:43787 |
| 16 | Popover | **Popover** | 0.3 | owner link node-id 4592:40710 |
| 17 | Separator | **Separator** (line / progressive / dotted) | 0.3 | owner link node-id 5145:206173; multiple separator styles |
| 18 | DevRevThemeProvider | — | null | **ambiguous**: no UI component analogue; status:"ambiguous", fallback |

## Owner node links (for Bridge key resolution)
- Tooltip:    node-id 4592-40566
- Select:     node-id 1150-8268
- Menu:       node-id 886-6081
- Modal:      node-id 4602-43787
- Popover:    node-id 4592-40710
- Separators: node-id 5145-206173

## Renamed concepts (arcade-gen name ≠ 0.3 name) — important
- Badge  → Counter
- Tag    → Chip
- Switch → Toggle
These are real mappings (`status:"mapped"`), NOT ambiguous — the concept exists
in 0.3 under a different name. The `note` records the rename so a future reader
understands why `arcadeGen:"Badge"` maps to a set named "Counter".

## Still to resolve via Bridge (follow-up pass)
For each row above (except #18): the published component-set **key** + the
**variant axis** the arcade-gen prop drives + its `valueMap`. Captured by:
1. `figma_search_components` (name) or `getNodeByIdAsync` (node link) → find the
   COMPONENT_SET, read `.key` + `.componentPropertyDefinitions`.
2. Apply the prefix rule; record key, generation, variants, textNode hint, note.
