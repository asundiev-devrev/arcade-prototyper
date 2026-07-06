# Export / Import an Arcade Studio project

**Date:** 2026-07-06
**Status:** Design approved, ready for implementation plan
**Scope:** Studio (`studio/`) — a new one-file-handoff feature for projects.

---

## Problem

Studio has no way to hand a project to another user. A tester zipped a project
folder in Finder and dropped it into the recipient's
`~/Library/Application Support/arcade-studio/projects/`. It never appeared.

Root causes (all confirmed against `studio/server/projects.ts:288` `listProjects`
and `studio/server/paths.ts:4` `requireSlug`):

1. **Double-nesting.** Finder's zip/unzip wraps the folder in another folder
   (plus a `__MACOSX/` sibling). `listProjects` scans exactly one level deep and
   looks for `project.json` directly inside each child — the wrapper has none, so
   the project is skipped.
2. **Slug rejection.** A folder name with a space or capital fails the slug
   regex and is silently dropped ("skipping malformed project").
3. **Slug ≠ folder name.** If the folder is renamed, its name no longer matches
   `project.json.slug`; the URL and the on-disk dir diverge.
4. **No rescan.** A folder added while the app is running never surfaces —
   `useProjects` (`src/hooks/useProjects.ts:18`) fetches the list once on mount.
5. **Custom components missing.** If the project's frames import saved user-kit
   components (`arcade-user/<Name>`), those live outside the project dir and are
   never carried along — frames break on the recipient's machine.

## Goal

One-click **Export** produces a single `.arcade` file. One-click **Import** of
that file makes the project appear immediately, correctly slugged, with its
custom components installed — no Finder spelunking, no broken frames.

Non-goal (this feature): isolating untrusted foreign code. Studio is used
**internally by trusted DevRev colleagues**. We bake in cheap hardening (below)
and a trust prompt, and document iframe-sandboxing as a follow-up.

---

## The bundle format

A `.arcade` file is a **gzipped tar** (`tar czf`). Users never open it directly;
only Studio reads it, so the container format is invisible to them.

```
manifest.json
project/
  project.json            # cleaned (see "Export" below)
  theme-overrides.css
  CLAUDE.md               # NOT shipped — regenerated on import (machine-specific paths)
  frames/**               # all frame source + sub-files + binary assets (png/svg)
  shared/**               # DEVREV-API.md etc.
components/
  <Name>.tsx              # only user-kit components the project transitively uses
  <Name>.png              # thumbnail, when present
```

### `manifest.json`

```jsonc
{
  "format": 1,               // bundle format version; import rejects unknown majors
  "exporterVersion": "0.39.0", // package.json#version at export time (diagnostics only)
  "name": "My Project",       // display name at export time
  "slug": "my-project",       // original slug (advisory; import re-derives its own)
  "components": [             // one row per bundled component, mirrors user-kit manifest shape
    { "name": "PriceTag", "description": "...", "origin": "saved", "createdAt": "...", "thumb": true, "missing": false }
  ]
}
```

`format` is the compatibility gate. Import accepts `format: 1`; an unknown value
is rejected with a clear message ("This bundle was made by a newer version of
Studio").

---

## Export

**Entry point:** an "Export project" item in the project's `⋯` menu
(`ProjectPicker.tsx`). Triggers a browser download by navigating to
`GET /api/projects/:slug/export` — the verified download pattern already used by
the Assets panel (`src/components/assets/AssetsPanel.tsx:172`,
`server/middleware/components.ts:112`). Response headers:
`Content-Type: application/octet-stream` +
`Content-Disposition: attachment; filename="<slug>.arcade"`.

**Server steps** (new module `server/projectBundle.ts`, thin middleware handler):

1. Load the project. 404 if absent.
2. **Clean `project.json`** — copy it, then strip fields that are meaningless or
   harmful on another machine:
   - `sessionId` — the exporter's Claude session.
   - `deployments` — the exporter's share URLs.
   - `computerConversationId` — a per-machine Computer handle.
   - `chimeIns` — reset to `[]` (pending objections reference the exporter's
     frame slugs).
   - Keep: `name`, `slug`, `createdAt`, `updatedAt`, `theme`, `mode`, `frames`.
     `frames[]` is shipped whole so names/sizes survive (reconcile would
     otherwise downgrade on-disk frames to `titleCase` names + default size —
     `projects.ts:556`).
3. **Copy the allowed subtree** to a temp dir: `frames/**` (including binary
   `assets/*.png|svg` written by Figma import — `server/figma/kitEmitBranch.ts`),
   `shared/**`, `theme-overrides.css`. Skip: `chat-history.json`, `memory/`,
   `CLAUDE.md` + `.bak`, `thumbnails/`, `_uploads/`, `last-*.log`, dotfiles.
4. **Drop the untouched seed frame.** If `frames/00-computer-reference/index.tsx`
   is byte-equal to this Studio's `COMPUTER_REFERENCE_SOURCE`
   (`projects.ts:163`), omit it — the recipient's `createProject`/scaffold path
   provides its own, and a byte-mismatch across versions would surface it as a
   phantom visible scene (`isUnmodifiedReferenceFrame`, `projects.ts:243`). If it
   was modified, ship it (it's real user work).
5. **Resolve custom-component dependencies transitively.** Seed the set by
   scanning `frames/**/*.tsx|ts` for the specifier
   `` /from\s*["']arcade-user/(<Name>)["']/ `` — the exact anchored form used by
   `server/componentUsage.ts:54` (never a substring match). Then **close the set
   transitively**: each referenced composite lives at
   `user-kit/composites/<Name>.tsx` and may itself import another
   `arcade-user/<Name>` (composites can import composites — confirmed via the
   shared `arcade-user` alias in `vite.config.ts:151` and
   `server/cloudflare/bundler.ts:156`). Keep scanning newly-added composites
   until no new names appear.
6. For each resolved name: copy `user-kit/composites/<Name>.tsx` (+ `.png` if
   present) into `components/`, and record its row (from the user-kit manifest)
   in `manifest.json`. A name that's imported but has no file on disk (deleted
   from the kit) is recorded with `"missing": true` and surfaced as a soft
   warning in the export response — export does not fail.
7. Write `manifest.json`, `tar czf <tmp>/<slug>.arcade project/ components/ manifest.json`
   via absolute `/usr/bin/tar` (macOS bsdtar; app is not sandboxed and already
   spawns `claude`/`aws` — `electron/entitlements.mac.plist` has no
   `com.apple.security.app-sandbox`), stream the file to the response, then clean
   up the temp dir.

Temp dirs use `mkdtemp` **inside `studioRoot()`** (not `os.tmpdir()`) so any
later move is same-volume and can't `EXDEV`.

---

## Import

**Entry point:** an "Import project" button beside "New project" in
`ProjectPicker.tsx`. Opens a native file picker filtered to `.arcade`. Before
the first import in a session, show a **trust dialog**: *"Only import `.arcade`
files from people you trust. They contain code that runs on your machine."*
(Reuses the existing `Dialogs` confirm — `src/components/feedback/Dialogs`.)

**Upload transport:** `POST /api/projects/import` with the **raw file bytes** as
the body and the filename in an `X-Upload-Filename` header — mirroring the
battle-tested `uploadsMiddleware` pattern (`server/middleware/uploads.ts:42`),
including its size-cap + drain-on-overflow. **No multipart, no new npm
dependency** (multipart has zero precedent in the codebase). Cap the upload body
generously enough to hold the largest realistic export — a Figma-heavy project's
`assets/*.png` are already-compressed and won't shrink under gzip, so this cap
must be ≥ the uncompressed-output cap in import step 2 (they bound the same
bundle from two directions; keep them aligned, e.g. both ≈200 MB).

**Server steps** (`server/projectBundle.ts` + thin handler). Order is
security-critical — **validate everything in an isolated temp dir, mutate the
live tree only at the very end:**

1. Write the uploaded bytes to a temp file inside a fresh `mkdtemp` dir under
   `studioRoot()` (outside `projects/`, so `listProjects` and the project
   watcher never see the in-flight import).
2. **Extract with caps.** `tar xzf` with bsdtar defaults (which already reject
   `../` and strip leading `/` — confirmed empirically). Enforce an
   **uncompressed-size cap and an entry-count cap** (e.g. 200 MB / 5000 entries);
   abort + `rm -rf` the temp dir if exceeded (gzip-bomb defense).
3. **Reject links.** Walk the extracted tree with `fs.lstat`; if **any** entry is
   a symlink or hardlink, reject the whole bundle and clean up. (bsdtar blocks
   `../` but still *creates* symlink entries, and the lexical path guard in
   `readProjectFile` is symlink-blind — `projects.ts:492` — so an unrejected
   symlink could leak host files. This walk is the mitigation.)
4. **Validate structure & schema.** `manifest.json` parses and `format === 1`;
   `project/project.json` parses against `projectSchema` (`server/types.ts:24`,
   which strips unknown keys and enforces the slug regex + enums). Reject
   clearly on any failure. No filesystem mutation to the live tree has happened
   yet.
5. **Derive a safe install slug.** Ignore the tar's folder name and the JSON's
   slug for path-building. Run `slugify(name)` → `uniqueSlug()` (existing helpers,
   `projects.ts:39`, `:79`), then `requireSlug` on the result. If the slug
   already exists, `uniqueSlug` appends `-2`, `-3`, … Rewrite
   `project.json.slug` to this value and `project.json.name` to `"<name>
   (imported)"` on collision. This guarantees the invariant the raw-zip broke:
   **on-disk folder name === `project.json.slug`.**
6. **Install components collision-safe.** For each bundled component (route
   **every** write through `componentStore.saveComponentFile` — it validates the
   name against `NAME_RE` before building any path, and runs the compile gate;
   `componentStore.ts:77`). Resolution per component:
   - Recipient has **no** component of that name → install as-is; merge its
     manifest row.
   - Recipient has one with the **same name and byte-identical `.tsx`** → skip.
   - Recipient has one with the **same name but different content** → install
     under a fresh non-colliding name and rewrite the frames. Name resolution
     loops like `uniqueSlug`: `<Name>Imported`, `<Name>Imported2`, … re-checking
     `componentExists`, `NAME_RE` (≤40 chars — truncate the base if needed), and
     names already claimed by this same bundle, until free.
   - The **rewrite is 4-part and atomic** per renamed component: (a) the file
     `<Name>.tsx` → `<New>.tsx`; (b) the file's own `export function/const
     <Name>` → `<New>`; (c) the manifest row's `name`; (d) in every frame file
     that references it: the import binding `{ <Name> }` → `{ <New> }`, the
     specifier `"arcade-user/<Name>"` → `"arcade-user/<New>"` (anchored regex
     `["']arcade-user/<Name>["']`, never a substring replace — else `Foo`
     corrupts `FooBar`), and JSX tags `<Name ` / `</Name>` → `<New` / `</New>`
     (word-boundary). Path-only rewrites are insufficient because binding, tag,
     specifier, and the composite's own export are the same identifier.
7. **Write CLAUDE.md.** Do **not** rely on the boot-only `refreshStaleClaudeMd`
   (its sole caller is `vite.config.ts:121`, run once at server start — an import
   into a running app would chat with no CLAUDE.md and the generator would
   misbehave). Render it in the import path using the same
   `renderTemplate(tpl, { PROJECT_NAME, THEME, ARCADE, PROTOTYPER, GLOBAL_MEMORY })`
   block as `createProject` (`projects.ts:108`), with the **recipient's** paths.
   Also backfill `memory/` stubs and `shared/DEVREV-API.md` the way
   `createProject` does, so the imported project is fully self-consistent.
8. **Promote atomically.** Move the validated `project/` tree from temp into
   `projectDir(slug)` (same volume → `fs.rename`; fall back to `fs.cp` + `rm`).
   Then `reconcileFrames(slug)` to sync `frames[]` with disk.
9. **Respond with the project.** Return the created `Project` JSON. The client
   navigates straight into it and calls `useProjects().refresh()` — the watcher
   does not announce new projects and the list doesn't poll, so the client
   refreshes explicitly.
10. `rm -rf` the temp dir in a `finally`.

---

## Cheap hardening summary (in scope)

| Risk | Mitigation |
|---|---|
| Tar-slip via `../` / absolute paths | bsdtar default rejection (confirmed) |
| Tar-slip via symlink/hardlink entries | post-extract `lstat` walk rejects any link |
| Gzip / entry-count bomb | uncompressed-size + entry-count caps; upload body cap |
| Path traversal via slug | install slug derived by `slugify`+`uniqueSlug`+`requireSlug`, never from tar/JSON |
| Path traversal via component name | all writes via `saveComponentFile` (validates `NAME_RE` before path join) |
| Clobbering recipient's user-kit | never overwrite; different-content same-name → rename+rewrite |
| Half-imported dir surfacing | validate in temp dir outside `projects/`; promote only after all checks |

## Documented follow-up (out of scope, noted for the record)

Imported `.tsx` renders in a **same-origin, unsandboxed** iframe
(`FrameCard.tsx:321`), and `/api/chat` runs `claude` with `Bash` +
`--dangerously-skip-permissions` while `/api/settings/devrev-pat/raw` serves the
PAT to localhost. So foreign code in a bundle is, in principle, credential-theft
+ RCE — the same risk the raw-zip handoff already carries. Full isolation
(sandbox the frame iframe / token-gate sensitive endpoints) is a separate
architectural change, deliberately **not** blocking this internal-only feature.
Tracked here so it isn't forgotten.

---

## Components & boundaries

- **`server/projectBundle.ts`** (new) — pure, unit-testable core:
  `packProject(slug) → tmpFilePath`, `unpackAndInstall(bytes) → Project`,
  plus helpers `resolveComponentDeps(framesDir)` (transitive scan),
  `cleanProjectJson(project)`, `assertNoLinks(dir)`, `enforceCaps(dir)`,
  `renameComponentEverywhere(old, new, framesDir, manifest)`. Tar is wrapped in
  one `runTar(args, cwd)` function so it's swappable/mockable.
- **`server/middleware/projects.ts`** — add the two thin routes
  (`GET …/export`, `POST /api/projects/import`); no business logic.
- **`src/components/shell/ProjectPicker.tsx`** — Export menu item, Import button,
  file picker, trust dialog, navigate-in + list refresh.
- **`src/lib/api.ts`** — `exportProject(slug)` (navigation download) and
  `importProject(file)` (raw-body POST) helpers.

## Testing

Server round-trip and edge cases (`__tests__/server/projectBundle.test.ts`),
using `ARCADE_STUDIO_ROOT` to point at a temp studio root:

1. **Round-trip:** export a project → import into a clean root → project +
   frames + `frames[]` names/sizes present; `chat-history.json`, `memory/`,
   `sessionId`, `computerConversationId`, `chimeIns` absent/reset; CLAUDE.md
   present with recipient's paths.
2. **Transitive deps:** frame→AppCard→PriceTag → both `.tsx` in the bundle and
   both installed.
3. **Slug collision:** importing a bundle whose slug exists → new slug `-2`,
   folder name === `project.json.slug`, name gets "(imported)".
4. **Component name collision (different content):** installs as `<Name>Imported`
   and every frame reference (import, specifier, JSX tag, export) is rewritten;
   `FooBar` in the same frame is untouched.
5. **Component name collision (identical content):** skipped, no duplicate.
6. **Long-name rename:** base ≥33 chars truncates so `<New>` ≤40 and passes
   `NAME_RE`.
7. **Seed frame:** unmodified `00-computer-reference` omitted from bundle;
   modified one survives.
8. **Security — link rejection:** a crafted tar containing a symlink entry is
   rejected, temp dir cleaned, `projects/` untouched.
9. **Security — size cap:** an over-cap (bomb) archive is rejected and cleaned.
10. **Malformed bundle:** bad `manifest.format`, unparseable `project.json`, or
    missing `project/` → clear rejection, no mutation to the live tree.

## Rollout

Fix-class change per repo convention (`feedback-fixes-local-test`): build and
verify with `pnpm run studio` against the packaged behavior; no version bump /
CHANGELOG / pack unless a release is requested. Commit style
`feat(studio/projects): ...`.
