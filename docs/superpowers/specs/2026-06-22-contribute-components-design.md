# Contribute Components — design spec

**Date:** 2026-06-22
**Branch:** `feat/contribute-components`
**Ships as:** Arcade Studio 0.40.0

## Problem

Beta testers can use the ~34 shipped prototype-kit composites, but when a
designer builds something new and reusable in a prototype, they have no way to
contribute it back. Two needs:

1. **Reuse it themselves** across their own prototypes.
2. **Share it** so other designers can reuse it too.

Today, composites are hand-authored `.tsx` recipes compiled into `dist/` and
baked into the read-only `.app`. Adding one is a developer loop (write TSX →
edit barrel → `kit:build` → restart) and distributing one means cutting a whole
new DMG. Neither is available to a non-engineer designer.

## Terminology (IMPORTANT)

**User-facing term is "component" everywhere. Never show "composite" to users.**
Internal code, directories, and file names may keep `composite`/`composites`
(matches the existing `prototype-kit/composites/` layout) — but every label,
button, modal, toast, and doc string the designer sees says "component".

## Goals

- A designer can select a part of a rendered prototype and save it as a named,
  reusable component **without** a DMG, a build step, or any code.
- A saved component is immediately reusable by its author in any of their
  prototypes (the generator sees it on the next turn).
- A saved component can be exported to a file and imported by another designer
  — **without** anyone touching a hidden OS folder.

## Non-goals (explicitly deferred to Phase 2)

- Hosted team registry (contribute-once → everyone-auto-sees). 0.40.0 does
  cross-designer sharing via manual file export/import only.
- Selecting multiple elements / region drag-select. 0.40.0 saves one picked
  element sub-tree at a time.
- Editing a saved component in place. (Re-save under the same name = replace.)

## Key feasibility facts (verified against current code)

- **Writable per-user root already exists:** `studioRoot()` →
  `~/Library/Application Support/arcade-studio` (`server/paths.ts`). Vite's
  `server.fs.allow` already includes it, and generated frames there already
  import the `arcade-prototypes` alias. New components live here, NOT in the
  read-only bundle — so no DMG.
- **The manifest is the generator's eyes:** `server/kitManifest.ts`
  `writeManifest()` walks `composites/` + `templates/` and renders
  `KIT-MANIFEST.md`; `kitManifestPlugin.ts` regenerates it on boot and on any
  kit-file change. Point it at a second (user) root → user components appear in
  the same catalog the agent already reads, with zero build step.
- **The element picker already exists:** `src/frame/picker.ts` paints a
  crosshair overlay inside the frame iframe, and on click resolves the clicked
  DOM node to its exact JSX source (`file`, `line`, `column`, `componentName`,
  `tagName`) via React 19 fiber `_debugStack`. Result flows to
  `src/hooks/targetSelectionContext.tsx`. Today it feeds scoped chat edits; we
  add a second consumer.
- **The runtime bundler is the compile gate.** `server/cloudflare/bundler.ts`
  `buildFrameBundle()` (esbuild + Tailwind v4) IS shipped in the DMG — the
  share-to-web flow uses it at runtime. `packFromSource({ tsx })`
  (`server/sidecar/packFromSource.ts`) wraps it: bad TSX → it throws. That is
  the save-time validity check. **Playwright (the 0.37.0 thumbnail
  screenshotter) is build-time only / NOT shipped**, so v1 shows a placeholder
  tile for saved components; real screenshots are a follow-up.
- **The generator subprocess already authors house-style composites** — that IS
  the current developer loop. We reuse it (`server/claudeCode.ts`), pointed at
  the writable dir with a scoped extract instruction.

## Architecture

### Storage (internal — never shown to the user)

```
~/Library/Application Support/arcade-studio/
  user-kit/
    composites/<Name>.tsx        the recipe
    composites/<Name>.png        thumbnail
    manifest.json                [{ name, description, createdAt, origin }]
```

- New `userKitDir()` in `server/paths.ts`.
- `kitManifest.ts` + `kitManifestPlugin.ts` accept a **second root** and watch
  it, so user components merge into the one `KIT-MANIFEST.md` catalog.
- `vite.config.ts` gains an `arcade-user` alias → `user-kit/`. Shipped
  composites stay on `arcade-prototypes`; user ones get an honest separate
  namespace. Generated frames reference them as `arcade-user/<Name>`.

### Save flow (built on the existing element picker)

1. Designer arms the existing crosshair picker on a frame and clicks the
   element they want — same UX as today's scoped edit.
2. For the picked element, a **"Save as component"** action appears (alongside
   the existing chat-target chip).
3. Modal (`SaveComponentModal.tsx`): **name** (pre-filled from picked
   `componentName`/`tagName`, validated to a safe component identifier) +
   **one-line description** (becomes the manifest doc the generator reads).
4. `POST /api/components/save` spawns the generator subprocess with a scoped
   extract prompt **anchored to the picked `file:line:column`** — reusing the
   same discipline as `buildTargetPreamble` / `buildEditContextBlock`:
   > Read `frames/<slug>/index.tsx`. The element at `line:column` is the one to
   > extract. Lift THAT sub-tree into a house-style recipe — JSDoc header,
   > compose `arcade/components` primitives (never re-implement), tokens not
   > hex, hardcoded strings/counts → a `<Name>Props` type. Write to
   > `user-kit/composites/<Name>.tsx`.
5. Deterministic, no agent: bundle the written `.tsx` via `packFromSource()`
   as the **compile gate** (throws → reject, write nothing); append
   `user-kit/manifest.json`; regenerate `KIT-MANIFEST.md`. v1 thumbnail is a
   placeholder tile (real screenshot deferred — Playwright not shipped).

**Why agent-extract, not raw JSX copy:** the picker gives the *boundary*; the
agent gives the *parameterization* (data → props) and house-style match. A raw
sub-tree copy is a frozen, hardcoded blob that drifts from the kit — exactly
what the kit's convention exists to prevent.

### Reuse + UI (Assets panel, 0.37.0)

The Assets panel is the home. Add a **"Your components"** section above the two
existing ones. Each card: thumbnail, name, description, **"Use this"** (seeds
`Use the <Name> component to …` and flips to Chat — identical to shipped cards)
and a **⋯** menu (Rename, Export, Delete).

**Naming relabel (to kill "composite" + the component/primitive collision):**
- Existing "Composites" section (34 shipped recipes) → labeled **"Components"**.
- Existing "Components" section (41 arcade-gen primitives) → labeled
  **"Elements"**.
- Saved ones → **"Your components"**.

Net user-visible sections: **Your components / Components / Elements**. No
"composite" anywhere. Internal catalog code keeps its names.

The generator needs no special-casing: once the `.tsx` is in `user-kit/`, it is
in the KIT-MANIFEST catalog the agent already reads. "Use this" just seeds a
prompt naming it.

### Export / Import (browser-native — hard constraint: no hidden folders)

The user must NEVER be asked to unhide or navigate to
`~/Library/Application Support`. **There is no Electron IPC in this app by
design** (renderer talks to Vite middleware over HTTP only; `nodeIntegration:
false`, no preload — `electron/main.ts`). So both directions use browser-native
mechanisms, which already satisfy the constraint and require no new IPC:

- **Export** (card ⋯ menu): `GET /api/components/<Name>/export` responds with
  `Content-Disposition: attachment; filename="<Name>.arcade.tsx"`. The browser
  downloads it to the visible `~/Downloads`. Self-contained: recipe source + a
  header comment block carrying name + description so import reads them back.
- **Import** (button atop "Your components"): an `<input type="file">`
  (`accept=".tsx"`) — this IS the OS's native open panel, already the pattern
  used for image uploads in `PromptInput.tsx`. The chosen file is POSTed to
  `/api/components/import`, which validates it, copies it into `user-kit/`, and
  refreshes the manifest. Now reusable by the importer.

The user never sees or types the `user-kit/` path in either direction.

## Data flow

```
Pick element (existing picker) → {file, line, column, componentName, tagName}
   │  + name + description (SaveComponentModal)
   ▼
POST /api/components/save
   ├─ spawn generator subprocess (runClaudeTurnWithRetry), scoped extract prompt
   │     → user-kit/composites/<Name>.tsx
   ├─ packFromSource({ tsx }) bundles it           [compile gate — throws → reject]
   └─ append user-kit/manifest.json
   ▼
KIT-MANIFEST regenerates (kitManifest.ts walks BOTH roots)
   ▼
Assets "Your components" refreshes · generator sees it next turn

Export → GET  /api/components/<Name>/export → Content-Disposition download (~/Downloads)
Import → <input type=file> → POST /api/components/import → validate → copy into user-kit/
```

## Surfaces touched / added

| File | Change |
|---|---|
| `server/paths.ts` | add `userKitDir()` |
| `server/kitManifest.ts` | accept + merge a 2nd (user) root |
| `server/plugins/kitManifestPlugin.ts` | watch the user root too |
| `vite.config.ts` | `arcade-user` alias → `user-kit/` |
| `server/middleware/components.ts` | NEW — save / list / export / import / delete / rename |
| `src/components/assets/AssetsPanel.tsx` | "Your components" section + section relabels + Import button |
| `src/components/assets/SaveComponentModal.tsx` | NEW — name + description |
| `src/components/viewport/FrameCard.tsx` | "Save as component" action on picked element |

(No `electron/` change — export/import are browser-native, no IPC.)

## Error handling

Every failure surfaces a plain-language message and writes nothing broken.

- **Extraction won't compile** → `packFromSource()` throws → "Couldn't turn
  this into a clean component — try a different element." No file kept.
- **Name collision** in `user-kit/` → "You already have a component named X.
  Replace or rename?"
- **Bad import** (won't parse / not one exported component / disallowed import)
  → "This doesn't look like an exported component." Validation = the same
  `packFromSource()` bundle attempt used on save.

## Testing (repo discipline: every behavior gets a test)

- `kitManifest` merging two roots — unit (`__tests__/server/...`).
- `components` middleware — save writes file + manifest entry; name collision;
  malformed import rejected — server tests.
- `AssetsPanel` renders "Your components" + opens Save modal — component test
  (add any new component to the `@xorkavi/arcade-gen` mock — known gotcha).

## Scope summary

**In 0.40.0:** pick → save → reuse-by-self; agent extraction; "Your components"
in the Assets panel; native-file export/import.

**Phase 2 (not now):** hosted team registry; multi-element / region selection;
in-place editing of saved components.

## Version & branch

- Branch: `feat/contribute-components` (cut from current; `feat/cursor-extension`
  is unrelated).
- Ships as **0.40.0** — absorbs the earlier erroneous 0.40.0 version bump.
