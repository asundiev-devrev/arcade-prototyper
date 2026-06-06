# Figma Export — Sub-project #2: Component + Token Mapping — design

**Date:** 2026-06-06
**Status:** Design approved. Follows Slice 0 (merged, PR #8) + sub-project #1 (serializer widening, not yet built). This is #2 of the Figma-export feature.
**Author:** Andrey + Claude (brainstorming session)
**Parent spec:** `docs/superpowers/specs/2026-06-05-figma-export-design.md`

## Problem

Slice 0 proved the export chain on one component by hand-resolving the
`ChatBubble` → Figma component key and variant live at the Bridge. To export
*any* frame, the #3 consumer needs that knowledge as **data + logic it can look
up** — which Figma component each kit component maps to, which Figma variable
each design token maps to, and how to disambiguate a resolved color back to the
right token. #2 builds exactly that knowledge. It creates nothing in Figma.

## Source-of-truth chain (grounding)

Three layers, established during brainstorming:

1. **raw-design-system** (devrev-web) — the full component set.
2. **arcade-gen** — a *subset* of raw-ds with the latest design language applied.
   This is what prototypes (and therefore SLJ component nodes) are built from.
3. **Arcade 0.3 Figma library** (file key `a2uKnm88LxRXEWAL1kOqeQ`) — a Figma
   library *striving to match arcade-gen*, ultimately aiming to carry all
   raw-ds components in the latest language. It is a **superset** of arcade-gen
   and **in progress**, so it contains deprecated (`[🔴DEPRECATED]`) and WIP
   (`[WIP]`) duplicates of the same conceptual component (live example: a
   "bubble" search returns `[DLS]Bubble`, `[WIP]Bubble`, `Bubble`, `Bubble
   Item`). Probe confirmed: **997 components, 750 variables across 5 collections
   (incl. a Light/Dark `Mode` collection).**

The mapping #2 builds is **arcade-gen component → canonical Arcade-0.3 Figma
component**. Because 0.3 is a superset, coverage is not blocked by 0.3 missing
things; the real curation problem is **picking the canonical 0.3 component per
arcade-gen primitive, rejecting the deprecated/WIP dupes**. That is precisely
why the mapping is hand-curated, not auto-matched by name.

## Key decisions (locked during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Component mapping source | **Curated by hand, Bridge-assisted** | 0.3's 997 components have deprecated/WIP dupes per concept; name auto-match would mis-fire and ship the wrong component silently. Curation picks the canonical one. |
| Token→variable mapping | **Derived by naming rule** + snapshot + overrides | The 750 library variables map cleanly: `FG/Neutral/Prominent` ⇄ `--fg-neutral-prominent`. One rule covers the bulk; a small override list handles non-conformers. No 750-entry hand table. |
| Disambiguation | **Property-role filter + semantic-over-core tiebreak** | Slice 0 live run mis-resolved text `color` to `--bg-neutral-prominent` (value collision). Filter candidates by CSS role (fg/bg/stroke), then prefer semantic over core, then first-candidate. |
| First-pass coverage | **All 18 arcade-gen primitives** (composites later) | Primitives appear across every frame → broadest reuse. Composites are a later pass. |
| In-progress / dupes | **`status` + canonical note per entry** | Each entry records `mapped` vs `ambiguous` and *why* a candidate was chosen over the dupes — self-documenting against the 997-component noise + 0.3 churn. |
| SLJ schema | **Unchanged** — #3 resolves role-aware | Avoids a mid-stream schema bump. The serializer keeps emitting its best value; #3 re-resolves with role using `disambiguate.ts`. |
| Module location | **New `studio/src/export/figma/`** — not folded into LIFT | LIFT maps arcade-gen→raw-ds *production code*; this maps arcade-gen→0.3 *Figma*. Different targets. |

## Deliverables

A new module `studio/src/export/figma/`, three units + committed data snapshots.
All pure data/logic — no Figma writes, no network at runtime (the snapshots are
captured offline via the Bridge and committed).

### 1. `componentMap.ts` — curated component table (18 primitives first)

```ts
type VariantAxis = {
  prop: string;                      // SLJ prop name, e.g. "variant"
  figmaProp: string;                 // Figma variant property, e.g. "Type"
  valueMap: Record<string, string>;  // {"receiver":"Receiver","sender":"Sender"}
};

type TextNodeHint =
  | { strategy: "lowest-depth" }     // the shallowest TEXT node carries the label
  | { strategy: "by-name"; name: string };

type FigmaComponentMapping = {
  arcadeGen: string;                 // kit/SLJ component name ("Button", "ChatBubble")
  status: "mapped" | "ambiguous";
  figma: {
    componentSetKey: string;         // PUBLISHED set key (not node id)
    setName: string;                 // "Bubble" — human anchor for re-curation
  } | null;                          // null when status === "ambiguous"
  variants: VariantAxis[];           // only the axes our props drive; rest = component defaults
  textNode?: TextNodeHint;           // which inner node carries label/content
  note: string;                      // why this key over the dupes; arcade-gen↔0.3 drift
};

export function findComponentMapping(arcadeGenName: string): FigmaComponentMapping | null;
```

Principles:
- **Key is the published component-set key**, never a node id —
  `importComponentByKeyAsync` (Slice 0 lesson) needs the publish key.
- **Variant mapping is explicit per-prop.** No assumption our `variant` equals
  their `Type`. We map only the axes our props drive; the Bubble set's extra
  axes (`hasTail`, `State`, `Only emojis`) fall to component defaults unless a
  prop drives them.
- **`status: "ambiguous"` is first-class.** When no 0.3 candidate is clearly
  canonical, `figma` stays `null`, the note explains, the exporter (#3) uses the
  auto-layout-frame fallback, and the export report lists it. The table never
  guesses.

The 18 arcade-gen primitives to curate (from `src/lift/mappings/primitives.ts`):
Button, IconButton, Input, Select, Checkbox, Switch, Modal, Popover, Menu,
Tabs, Badge, Tooltip, Avatar, ChatBubble (seed proven), Tag, Breadcrumb,
Separator, DevRevThemeProvider (the last is a provider, likely `status:
"ambiguous"`/no-op — recorded as such).

### 2. `tokenMap.ts` — derived token→variable mapping

Two parts + an override list:

- **`figma-variables.json` snapshot** — the 750 library variables' `name → key`
  pairs, captured once via the Bridge, committed. #3 needs the *key* to
  `importVariableByKeyAsync`; names alone aren't bindable. A small Bridge-assisted
  script regenerates it when 0.3 changes (documented, not run at runtime).
- **Naming rule** — normalized compare: strip `--`, lowercase, drop separators
  (`-`, `/`) on both sides, then match. `--fg-neutral-prominent` →
  `fgneutralprominent` ⇄ `FG/Neutral/Prominent` → `fgneutralprominent`. Robust
  to slash-vs-dash and case.
- **Override list** — names that don't conform (core colors like `Husk/1200`,
  component tokens like `Bubble/Self/BG`) get explicit `cssVar → variableName`
  entries.

```ts
export function tokenNameToVariableKey(cssTokenName: string): string | null;
// null → #3 emits a plain resolved color instead of a bound variable.
```

### 3. `disambiguate.ts` — role-aware token resolution

Upgrades Slice 0's `tokenIndex` (which returns *candidates* for a resolved
value) with a picker:

```ts
type ColorRole = "fill" | "stroke" | "text";

export function resolveTokenForRole(
  index: TokenIndex,
  resolvedValue: string,
  role: ColorRole,
): string;   // a token name, or the raw value when nothing resolves
```

Algorithm:
1. `candidates = index.lookup(resolvedValue)` (Slice 0 behavior).
2. Filter by role:
   - `text` → prefer `--fg-*` / foreground tokens
   - `fill` → prefer `--bg-*` / `--surface-*`
   - `stroke` → prefer `--stroke-*` / `--border-*`
3. Within survivors, prefer **semantic** (`--fg-*`) over **core** (`Husk/*`).
4. First survivor; if the role filter empties the set, fall back to the first
   overall candidate (never worse than Slice 0).

`role` is known at the call site in #3: the SLJ element style already separates
`fill`, `stroke`, and text `color`, so #3 calls `resolveTokenForRole` with the
matching role. **No SLJ schema change** — the serializer keeps emitting its best
value; #3 re-resolves role-aware from the raw value.

## Architecture / data flow

```
arcade-gen primitive name (from SLJ component node)
   └─ findComponentMapping() ─→ { setKey, variant valueMap, textNode } | null
                                   │                                      └─ null/ambiguous → #3 fallback
SLJ element style (fill/stroke/text color, raw resolved value + role)
   └─ resolveTokenForRole(value, role) ─→ css token name
        └─ tokenNameToVariableKey(name) ─→ Figma variable key | null
                                              └─ null → #3 emits plain color
```

#2 is the middle column: pure lookups. #3 (later) consumes the right column to
create instances + bind variables via the Bridge.

## Testing

- `componentMap.test.ts` — every entry well-formed (status/figma consistency:
  `mapped` ⇒ non-null `figma`; `ambiguous` ⇒ null); `findComponentMapping`
  returns the ChatBubble seed; unknown name → null; variant valueMaps non-empty
  for mapped entries that declare a `prop`.
- `tokenMap.test.ts` — the naming rule matches a sample of real names from the
  committed snapshot (`--fg-neutral-prominent` → the right key); an override
  resolves; a non-existent token → null; normalized compare handles slash/dash/case.
- `disambiguate.test.ts` — the live failure case: text `color` resolving among
  `["--fg-neutral-prominent","--bg-neutral-prominent"]` with role `text` →
  `--fg-neutral-prominent` (NOT bg); `fill` role → the bg one; semantic beats
  core; empty-filter falls back to first candidate.
- Snapshot integrity — `figma-variables.json` parses, is non-empty, entries have
  `name` + `key`.

**Done =** for the 18 primitives, `findComponentMapping` returns curated keys (or
honest `ambiguous`); `tokenNameToVariableKey` resolves the common `--fg/--bg/
--stroke/--surface` families against the real snapshot; `resolveTokenForRole`
fixes the Slice 0 fg-vs-bg collision — all unit-tested without touching Figma.

## Risks / watch-items

- **0.3 churn.** Curated keys + the variable snapshot go stale as 0.3 ships.
  Mitigation: `status`+`note` per entry, a documented Bridge-assisted regen
  script for the snapshot, and `ambiguous` entries that degrade safely.
- **Variant axis drift.** arcade-gen↔0.3 sync may rename variant properties; the
  per-prop `valueMap` localizes the blast radius to one entry.
- **Published key vs node id.** Must capture the *published* component-set key
  (and variable key), not the file-internal node id — the Slice 0 distinction.
- **Override-list creep.** If "non-conforming" token names are more than a
  handful, the naming rule is weaker than assumed; re-evaluate derive-vs-curate
  for tokens at that point.

## Non-goals (#2)

- Creating instances / binding variables live in Figma (→ #3).
- The fallback *rendering* (→ #3); #2 only defines the fallback *contract*
  (`null`/`ambiguous` → degrade).
- Composite mappings (ChatMessages, ComputerSidebar, …) — a later pass after
  primitives are proven.
- Any SLJ schema change.
