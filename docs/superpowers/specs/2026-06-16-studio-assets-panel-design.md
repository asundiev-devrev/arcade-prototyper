# Studio Assets Panel — Design Spec

**Date:** 2026-06-16
**Status:** Approved design, pre-implementation
**Area:** `studio/` (React shell + build tooling)

## Problem

Beta-users have no visibility into what building blocks already exist for their
prototypes. They ask repeatedly to "see the templates we have so we can apply
them quickly" — a Figma-assets-panel mental model. Today the kit is only visible
to the generator (the manifest is injected into the Claude subprocess system
prompt); the human never sees it. Users re-describe things that already exist,
or never discover them.

**Primary job: discovery — answer "what exists."** Applying is a secondary,
one-click bonus, not the core.

## Audience

Beta-users are **designers, not engineers.** Implications baked into this design:

- No prop tables, no type signatures, no import paths shown. Designers need to
  **see the thing** and reference it by name.
- "Apply" means seeding a natural-language prompt, not placing code.

## What we are building

A left-pane **Assets tab** (sibling to the existing Chat tab) that catalogs every
building block available to a prototype, in three sections, with search and live
visual previews. This follows Figma's asset-panel pattern (left side, browse,
search, drag-or-click to use).

### Why this shape (rejected alternatives)

- **Live drop-into-frame (rejected):** fights Studio's generative grain. Studio
  is prompt → generate, not manual component placement. A dropped canned demo is
  almost never the user's actual content, so they re-prompt anyway — the
  generation round happens regardless. Manual placement is a second authoring
  paradigm bolted onto a prompt-driven tool.
- **Browse-only, no apply (rejected as sole behavior):** too thin; we get the
  one-click seed nearly for free via the existing `seedRef` mechanism.
- **Chosen:** browse + see + seed-a-prompt. Discovery-first, with a one-click
  bridge into the generate loop that Studio already runs. Visibility unlocks
  apply for free: once a user sees "FormModal exists," their next prompt
  naturally references it and the generator (which already knows the kit) builds
  it with the user's content.

## The catalog: three sections

| Section | Source of truth | Count | Metadata available |
|---|---|---|---|
| **Composites** | `studio/prototype-kit/{composites,templates}/*.tsx` via `buildManifestEntries()` | 34 (30 composites + 4 templates) | name, one-line doc |
| **Components** | `@xorkavi/arcade-gen` `src/components/index.ts` barrel | ~55 (UI + layout + charts) | name, one-line doc |
| **Icons** | `@xorkavi/arcade-gen` `src/components/icons/manifest.json` | 127 | name, category, tags, inline SVG |

All three sources are already machine-readable. The list requires **no
hand-curation**.

### Section behavior

- **Composites & Components:** card grid, each card = thumbnail + name. Click a
  card → **detail view** (larger preview + one-line description + **"Use this"**
  button). No props shown.
- **Icons:** dense grid, each = small inlined SVG + label. Click → copies the
  icon name to clipboard (toast confirm). No detail view, no seeding (seeding
  "use the ChevronDown icon" is noise).

## Previews / thumbnails

- **Icons (127):** zero render cost. SVG already lives in `manifest.json`;
  inlined directly as the thumbnail.
- **Composites + Components (~89):** rendered at **build time** to PNG via the
  existing sidecar `/pack` endpoint (TSX → HTML) + headless screenshot.
  Committed to the repo and shipped in the `.app`.
- **Detail view** (composites/components): a **larger** rendering solves the
  "small thumbnail loses detail" concern. v1 uses a larger stored PNG (same
  render, bigger viewport); live re-render via `/pack` is a possible later
  enhancement.

### Demo examples (the authoring cost)

A bare composite renders as an empty box (e.g. `FormModal` with no props/children).
Each of the ~89 composites/components needs a **minimal demo example** — realistic
props + children — so the thumbnail shows something real and complete.

- Examples live in a dedicated **`studio/prototype-kit/examples/<Name>.tsx`**
  folder, one real `.tsx` per item. Rationale: a build-time render needs code
  guaranteed to compile; real files break loudly when a component's API drifts,
  whereas an example buried in a JSDoc comment rots silently. Each file is small
  (~10 lines) and doubles as both thumbnail-render source and (later) detail render.
- The 7 existing `composite-screenshots/final-*.png` capture the intent for their
  composites; their underlying example usage is the starting point for those.
- This is the bulk of the implementation effort: ~89 small example files.

### Drift control

Thumbnails are snapshots → they go stale when a component changes.

- The thumbnail-render script runs as part of `pnpm run studio:pack` (release
  path), so released art is regenerated each build.
- A **freshness test** in the vitest suite asserts the catalog/thumbnails are not
  older than the kit + examples source (mtime or content-hash comparison). A
  release cannot silently ship stale art.

## Architecture

```
build time (studio:pack + dev script)
  ┌─────────────────────────────────────────────┐
  │ scripts/buildAssetsCatalog.ts                │
  │  - buildManifestEntries()  → composites      │
  │  - parse arcade-gen index  → components       │
  │  - read icons/manifest.json → icons + svg     │
  │  - render ~89 examples via /pack → PNGs        │
  │  → studio/prototype-kit/assets-catalog.json    │
  │  → studio/prototype-kit/assets-thumbs/*.png    │
  └─────────────────────────────────────────────┘
                      │ shipped in .app
                      ▼
runtime
  ┌──────────────────┐      ┌────────────────────────┐
  │ GET /api/assets  │──────│ serves assets-catalog   │
  │ (new middleware) │      │ + thumbnail static dir  │
  └──────────────────┘      └────────────────────────┘
                      │
                      ▼
  ┌──────────────────────────────────────────────┐
  │ Left pane: [ Chat | Assets ] tabs              │
  │   AssetsPanel.tsx                              │
  │     - search bar (name/desc/tags)              │
  │     - 3 collapsible sections                   │
  │     - card grid + detail view                  │
  │     - "Use this" → seedRef + switch to Chat tab│
  └──────────────────────────────────────────────┘
```

### Components / units

1. **`scripts/buildAssetsCatalog.ts`** — build-time. Merges the 3 sources into
   `assets-catalog.json`, renders ~89 thumbnails via `/pack`. Idempotent;
   re-runnable in dev. Wired into `studio:pack`.
   - *Does:* produce catalog JSON + thumbnail PNGs. *Depends on:*
     `buildManifestEntries`, arcade-gen barrel, icons manifest, `/pack`.
2. **`studio/prototype-kit/examples/<Name>.tsx`** (~89 files) — minimal demo
   usage per composite/component. *Does:* render one real instance. *Depends on:*
   the composite/component it demonstrates.
3. **`GET /api/assets` middleware** — serves the catalog JSON; static-serves the
   thumbnail directory. *Does:* hand the shell the catalog. *Depends on:* the
   committed catalog file. Mirrors existing `server/middleware/*` pattern.
4. **`AssetsPanel.tsx`** (+ small subcomponents: `AssetCard`, `AssetDetail`,
   `IconGrid`, `AssetSearch`) — the React UI. *Does:* render tabs/sections/search/
   detail, fire seed + copy actions. *Depends on:* `/api/assets`, the existing
   `seedRef` callback, tab state.
5. **Left-pane tab wrapper** — refactor `ProjectDetail` left aside into a tabbed
   container (`Chat` | `Assets`), default `Chat`, persisted to localStorage.
6. **Freshness test** — vitest assertion that catalog/thumbs ≥ source mtime/hash.

### Data flow

1. Build: script writes `assets-catalog.json` + `assets-thumbs/*.png`.
2. Runtime: AssetsPanel fetches `/api/assets` once on mount, caches in component
   state. Thumbnails load from the static thumb dir; icon SVGs inline from JSON.
3. Search filters the in-memory catalog client-side (216 items — trivial).
4. "Use this" on a card → calls existing `seedChatRef.current(...)` with a
   kind-aware string (`Use the <Name> composite to ` / `Use the <Name> component
   to `) and switches the left pane to the Chat tab; cursor left at end.
5. Icon click → `navigator.clipboard.writeText(name)` + toast.

### Catalog JSON shape (illustrative)

```jsonc
{
  "generatedAt": "2026-06-16T...",     // stamped post-build
  "sections": [
    { "kind": "composite", "items": [
      { "name": "FormModal", "doc": "Dialog for editing an entity.",
        "thumb": "assets-thumbs/FormModal.png" }
    ]},
    { "kind": "component", "items": [ /* … */ ] },
    { "kind": "icon", "items": [
      { "name": "ChevronDownLarge", "category": "Navigation",
        "tags": ["chevron","down"], "svg": "<svg…>" }
    ]}
  ]
}
```

## Interaction detail

- **Left pane** keeps its existing resize + width persistence. A tab strip at the
  top toggles `Chat` / `Assets`. Tab choice persisted (`studio:leftPaneTab`).
  Default `Chat` so existing users see no change until they explore.
- **Search:** single input, live filter across all sections; empty sections hide
  while a query is active.
- **Sections:** collapsible headers with counts (`Composites · 34`).
- **"Use this"** seeds a kind-aware prompt and flips to Chat tab → user lands where they
  continue typing. Reuses the proven `seedRef` mechanism — no new generation
  plumbing.

## Testing

- **Freshness test:** catalog + thumbs not older than kit/examples source.
- **Catalog build test:** `buildAssetsCatalog` produces all 3 sections with
  expected counts (34 / ~55 / 127) and every composite/component has a thumb path.
- **Middleware test:** `GET /api/assets` returns valid catalog JSON; thumbnail
  static route serves a known file.
- **Example compile guard:** all `examples/*.tsx` typecheck/build (catches API
  drift loudly).
- **Panel render test:** AssetsPanel renders sections, filters on search, fires
  seed callback with the right text, fires clipboard copy for icons.

## Error handling

- `/api/assets` unreadable / missing catalog → panel shows an inline "Assets
  unavailable, run the build" empty state, never crashes the shell.
- Missing thumbnail for an item → card shows name-only placeholder tile (degraded,
  not broken).
- Clipboard write failure → toast reports it; no throw.

## Out of scope for v1

- Live drop-into-frame (the rejected paradigm).
- Prop tables / type signatures / import paths (designers don't need them).
- Icon prompt-seeding (copy-name only).
- Per-variant previews (e.g. all Button variants) — one canonical example each.
- Live re-render in detail view (stored larger PNG is enough for v1).
- Drag-and-drop from panel.

## Future (v2 candidates)

- Drag a composite onto the viewport.
- Live `/pack` re-render in detail (always-fresh, no stored art).
- Variant gallery per component.
- Usage analytics on which assets get seeded most (informs kit investment).
