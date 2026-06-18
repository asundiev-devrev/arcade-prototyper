# Homepage Templates — Design Spec

**Date:** 2026-06-18
**Status:** Approved design, ready for implementation plan
**Branch:** new branch off `chore/studio-cleanup-audit`

## Goal

Give the Arcade Studio homepage a third starting path. Today a user can **start from scratch** (hero prompt box) or **continue a previous project** (Projects grid). This adds **start from a template**: pick a ready-made full-page view and land in a project with that page already rendered.

Scope is intentionally three templates — the full-page views that matter, not the atomic UI pieces:

1. **Computer** — the Computer / Agent Studio chat screen
2. **Settings page** — DevRev settings-style page
3. **App list view** — DevRev vista list view (e.g. a tickets/work-items list)

More templates can be added later by appending to a manifest; the architecture is built so adding one is a small, mechanical change.

## Core mechanic — instant seeded frame, no generation

Picking a template does **not** run a generation turn. It reuses the pattern already in `studio/server/projects.ts` (`scaffoldComputerReferenceFrame` / `COMPUTER_REFERENCE_SOURCE`): create the project, write a ready-made `index.tsx` to disk, open the project, and the page renders immediately in the viewport.

Consequences:
- **Zero wait, zero tokens.** No Claude subprocess is spawned for the template itself.
- **Pixel-perfect.** The user sees exactly the committed source, not an LLM's interpretation of it.
- The user then iterates via chat the normal way (the frame is just an ordinary frame on disk).

This is deliberately the same shape as the existing hidden `00-computer-reference` seed — except the template frame is **visible** (`01-<id>`), because the user explicitly asked for it.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| What happens on pick | Seed a real frame instantly (no generation) |
| Homepage layout | Lovable-style tabbed shelf below the hero prompt |
| Shelf tabs | `My projects \| Templates` |
| Default tab | Smart: 0 projects → Templates; ≥1 project → My projects |
| Card art | Rendered PNG thumbnail (build-time) |
| Thumbnail framing | Wide page preview (16:9-ish, full layout) |
| Project naming | Auto-name from template name, deduped (`Computer`, `Computer 2`, …) |
| Base branch | New branch off `chore/studio-cleanup-audit` |

### Why not the assets-panel branch

The PNG-thumbnail pipeline (`buildAssetsCatalog.ts`, Playwright render) lives on `feat/studio-assets-panel`, which is 16 commits ahead of `chore/studio-cleanup-audit` and not merged. We are building on a new branch off the current one. Both ingredients we need are already present on this branch:
- `studio/server/sidecar/packFromSource.ts` — packs a single `.tsx` into self-contained HTML
- `playwright` (`^1.59.1`) — already a dependency

So we write a small, dedicated thumbnail script rather than depending on the assets branch.

## Architecture — one source file per template, double duty

The central principle: **each template is ONE `.tsx` file that serves as both (a) the thumbnail's render source and (b) the seed frame written into the project.** Because the same file feeds both, the card art can never drift from what the user actually gets.

```
studio/prototype-kit/template-seeds/
  computer.tsx          ← export default () => <ComputerScene />
  settings-page.tsx     ← <SettingsPage …>  (lifted from __tests__/lift/loop-fixtures/settings-list)
  app-list.tsx          ← <VistaPage …>      (lifted from __tests__/lift/loop-fixtures/list-view)

studio/prototype-kit/template-thumbs/
  computer.png          ← committed; rendered at build time
  settings-page.png
  app-list.png

studio/server/templates.ts            ← manifest + seed/lookup logic
studio/scripts/buildTemplateThumbs.ts ← Playwright + packFromSource → PNG (new, small)
```

### Manifest (`studio/server/templates.ts`)

A single exported array is the source of truth:

```ts
export interface TemplateDef {
  id: "computer" | "settings-page" | "app-list";
  name: string;          // "Computer", "Settings page", "App list"
  description: string;   // one line, e.g. "Agent chat screen"
  seedFile: string;      // template-seeds/<id>.tsx
  thumb: string;         // template-thumbs/<id>.png
}
export const TEMPLATES: TemplateDef[] = [ … ];
```

Plus a `seedTemplateFrame(slug, templateId)` helper that reads `template-seeds/<id>.tsx` and writes it to `frames/01-<id>/index.tsx` in the project dir, then refreshes `project.json`'s frame list. This lives next to / reuses the existing scaffolding code in `projects.ts`.

### Seed source files

- **`computer.tsx`** — `<ComputerScene />`. ComputerScene renders fully on its own (default `state="transcript"`, built-in `SEED_TRANSCRIPT`), so the seed is a one-liner mirroring the existing `COMPUTER_REFERENCE_SOURCE`.
- **`settings-page.tsx`** — a `<SettingsPage …>` composition lifted from `__tests__/lift/loop-fixtures/settings-list/index.tsx` (a real authored 200-line example), trimmed to a clean demo with realistic content.
- **`app-list.tsx`** — a `<VistaPage …>` composition lifted from `__tests__/lift/loop-fixtures/list-view/index.tsx` (a 40-line tickets list with `VistaRow`, filters, pagination).

These import only from `arcade-prototypes` / `arcade/components`, matching how generated frames import.

### Thumbnail build (`studio/scripts/buildTemplateThumbs.ts`)

A trimmed cousin of the assets-panel pipeline (no catalog JSON, no per-component machinery):
1. For each template: read its seed `.tsx` → `packFromSource({ tsx, theme: "arcade", mode: "light" })` → self-contained HTML.
2. Launch Playwright, set a wide viewport (~16:9, e.g. 1280×720), load the HTML, screenshot full layout → write `template-thumbs/<id>.png`.
3. Commit the PNGs.

Wired into `studio:pack` and `studio:release` (run alongside `kit:build`) so thumbnails regenerate before packaging. The committed PNGs mean dev mode and tests don't require running Playwright.

## Data flow — click to rendered page

```
[Templates tab] → TemplateCard click
  → POST /api/projects            (createProject; name = deduped template name, theme "arcade", mode "light")
  → POST /api/projects/:slug/seed-template  { templateId }   (new middleware → seedTemplateFrame)
       reads template-seeds/<id>.tsx
       writes frames/01-<id>/index.tsx   (VISIBLE frame)
       updates project.json
  → onOpen(slug)                  → ProjectDetail renders the frame in the viewport
```

No `pendingPrompt`, no chat turn, no generation. The frame is on disk and visible the instant the project opens. The existing hidden `00-computer-reference` seed still runs as part of `createProject` (harmless background reference); the user sees the explicit `01-<id>` frame they chose.

### Auto-naming

`createProject` takes a `name`. For templates we pass the template's display name (`"Computer"`, `"Settings page"`, `"App list"`). `createProject` already dedupes slugs via `uniqueSlug`; the spec adds matching dedupe for the display name where needed (`Computer`, `Computer 2`) so the Projects list stays readable. User can rename later via the existing menu.

## UI components

All under `studio/src/components/home/`, styled to match the existing homepage.

### `HomeShelf`
Wraps a `ToggleGroup` (`My projects` / `Templates`) plus the active grid. Computes the smart default tab from `projects.length` on first render (0 → Templates, ≥1 → My projects). Renders `ProjectsSection` or `TemplatesSection` depending on the active tab. Replaces the bare `<ProjectsSection>` call in `HomePage.tsx`.

### `TemplatesSection` + `TemplateCard`
3-column grid (same `repeat(3, minmax(0,1fr))` / `gap:16` as `ProjectsSection`). Each `TemplateCard`:
- Wide page-preview thumbnail (`<img src="/api/templates/<id>/thumb">`), 16:9-ish, rounded, bordered — consistent with the rendered page.
- Template name (Chip Display, matching `ProjectCard`'s name treatment).
- One-line description below the name.
- Click → the create+seed+open flow above.

Note: the existing `ProjectCard` has **no thumbnail** (name + date on a colored panel). Template cards are intentionally the visually rich ones; no styling conflict.

### API
- **`GET /api/templates`** — returns the manifest (id, name, description; thumb served separately).
- **`GET /api/templates/:id/thumb`** — middleware reads `template-thumbs/<id>.png` from disk and streams it. Reading from disk (not bundling as a static import) sidesteps the electron-builder image-stripping trap documented in auto-memory `electron-builder-image-exclusion`; the packaging test must confirm the PNGs survive into the `.app`.
- **`POST /api/projects/:slug/seed-template`** — `{ templateId }` → `seedTemplateFrame`; unknown id → 404.

## Error handling

- Unknown `templateId` on seed → 404, surfaced as a toast (reuse `HomePage`'s existing toast-on-failure pattern); the just-created empty project is left in place (user can delete it) — we do not silently roll back, to avoid masking the error.
- Missing thumbnail PNG at runtime → `GET …/thumb` returns 404; the card shows a neutral placeholder box rather than a broken image.
- `createProject` failure → existing toast path, unchanged.

## Testing

- **Server — seed:** `seedTemplateFrame` writes `frames/01-<id>/index.tsx` with the exact seed source; unknown id rejected.
- **Server — thumb endpoint:** streams the PNG with correct content-type; missing file → 404.
- **Manifest freshness:** every `TEMPLATES` entry has an existing seed `.tsx` AND a committed `.png` (guards "added a template, forgot to render/commit the thumbnail").
- **Component — smart default:** `HomeShelf` opens on Templates when `projects=[]`, on My projects when `projects.length≥1`.
- **Shell mock:** add `ToggleGroup` to the `@xorkavi/arcade-gen` test mock (known trap — auto-memory `arcade-gen-mock-projectdetail-tests`); run the FULL suite, not just new tests.
- **Packaging:** assert `template-thumbs/*.png` are included in the bundle config (electron-builder image-exclusion guard).

## Out of scope (YAGNI)

- "Browse all" / a templates marketplace.
- Templates that run a generation turn or carry an opening chat message.
- More than the three named templates (manifest makes adding more trivial later).
- Reusing or merging the assets-panel branch.
- Per-template theme/mode options (templates are seeded `arcade` / `light`; user changes mode in-project as today).
