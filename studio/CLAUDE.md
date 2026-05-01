# studio/CLAUDE.md

Orientation for agents working inside `studio/`. Read this after the repo-root `CLAUDE.md`.

## What Studio is

A Vite dev server wrapped as a macOS `.app`. Users open the app → Vite serves localhost:5556 in their default browser → React shell mounts → they type a prompt → the shell POSTs to `/api/chat`, which spawns a `claude` CLI subprocess in the project's directory → the subprocess writes React frames to `~/Library/Application Support/arcade-studio/projects/<slug>/frames/` → Vite hot-reloads them into the viewport grid.

Everything the user calls "the studio" is this app. Production is the packaged `.dmg` beta testers install.

## Layout

```
studio/
├── src/                 React shell (shell UI, chat pane, viewport, settings modal)
├── server/              Vite middleware (API handlers under server/middleware/*)
├── server/vercel/       Share-to-Vercel bundler (esbuild + Tailwind v4 per frame)
├── server/plugins/      Vite plugins (frame mount, project watch, etc.)
├── prototype-kit/       Composites + templates the generator is told to use
├── packaging/           DMG build: download-node, download-awscli, build.sh, dmg.sh, launcher.sh
├── __tests__/           Vitest suite (173 tests as of 0.3.0)
├── docs/                User-facing docs (aws-setup.md, etc.)
├── CHANGELOG.md         Source of truth for "What's new" modal
└── vite.config.ts       Wires all middleware into Vite's dev server
```

## Commands (run from repo root, not studio/)

- `pnpm run studio` — dev server, opens browser on :5556
- `pnpm run studio:test` — full vitest suite (~90s)
- `pnpm run studio:test <path>` — single file, much faster
- `pnpm run studio:pack` — build .app + .dmg into `studio/packaging/dist/`

## Releasing a new version

1. Bump `studio/packaging/VERSION` (semver, `0.x.y`).
2. Add an entry at the top of `studio/CHANGELOG.md` — keep-a-changelog style (`## [0.x.0] — YYYY-MM-DD` + Added / Fixed / Changed bullets).
3. `pnpm run studio:pack` — DMG filename auto-picks up the new version.
4. Commit + push.
5. Publish a release to the **public mirror** repo so beta testers see
   the "update available" banner in the app. The mirror is
   `asundiev-devrev/arcade-studio-releases` — a separate, public repo
   that carries only DMG artifacts; source stays in this private repo.

   From this repo, run:
   ```
   gh release create v0.x.y "studio/packaging/dist/Arcade Studio 0.x.y.dmg" \
     --repo asundiev-devrev/arcade-studio-releases \
     --title "Arcade Studio 0.x.y" \
     --notes-file <(awk '/^## \[0\.x\.y\]/{f=1;next} /^## \[/{f=0} f' studio/CHANGELOG.md) \
     --latest
   ```

   The app polls `https://api.github.com/repos/asundiev-devrev/arcade-studio-releases/releases/latest`
   once per launch and caches the response for an hour.

The version is stamped into `Info.plist`, `Contents/Resources/version.json`, the launcher boot log, and the Settings footer. Builds from a dirty working tree get a `-dirty` git-SHA suffix.

## Things that cost debugging time last session — be wary

- **Vite middleware does NOT hot-reload.** Changes to anything under `server/middleware/*` or `vite.config.ts` require a full restart (quit the app or kill `pnpm run studio` and rerun). Every "it's not working on my machine" that's actually "you didn't restart" traces to this.
- **Settings PATs follow one pattern.** DevRev, Vercel, and Figma all have a section in `AppSettingsModal.tsx` with: password `Input`, Save/Replace/Remove buttons, Connected `Badge`, inline error. When adding a new integration, mirror the existing sections — don't invent a new shape.
- **Tailwind v4 needs explicit `@source` globs for every consumer root** (studio, prototype-kit, user's frames dir). `studio/src/styles/tailwind.css` sets the static ones; the Vite plugin `injectStudioSourcePlugin` appends the projects root at dev time; `server/vercel/bundler.ts` does the same for Vercel share bundles. Missing any one of these → classes silently drop in that environment. See auto-memory `tailwind-v4-source-scanning.md`.
- **`@xorkavi/arcade-gen/styles.css` is a pre-compiled subset.** It alone is never enough — always pair with Tailwind scanning of the consumer tree.
- **Radix Select forbids `value=""`.** Use a non-empty sentinel and translate at save/load. Static test at `__tests__/components/select-item-empty-value.test.ts` catches violations.
- **Claude CLI emits `{type:"result", subtype:"success", is_error:true}` on Bedrock auth failures.** Our parser (`src/lib/streamJson.ts`) honors `is_error` over `subtype` specifically for this. Don't "simplify" that check.
- **`~/.aws/config` is written by the launcher on first run.** If you edit `packaging/launcher.sh`'s AWS block, keep it idempotent (grep-match before appending) — users with customized `[profile dev]` must not get clobbered.

## Integrations — who owns what

| Integration | Storage | Server side | UI |
|---|---|---|---|
| DevRev PAT | `settings.json` + keytar/plaintext | `secrets/keychain.ts`, `middleware/devrev.ts` | AppSettingsModal DevRev section |
| Vercel | `settings.json` | `middleware/vercel.ts`, `server/vercel/*.ts` | AppSettingsModal Vercel section + ShareModal |
| Figma PAT | `figmanage` CLI config | `figmaCli.ts`, `middleware/figma.ts` | AppSettingsModal Figma section |
| AWS Bedrock | `~/.aws/` (CLI-native) | `middleware/awsLogin.ts`, `middleware/chat.ts` preflight | AuthExpiredNotice banner |

## Test discipline

Every bug we fix gets a test. Patterns:
- Server logic → `__tests__/server/...`
- Parser behavior → `__tests__/lib/streamJson.test.ts`
- Component behavior → `__tests__/components/*.test.tsx` with `@xorkavi/arcade-gen` mocked (note: mock must export `Modal`, `Input`, `Button`, etc. that the component uses — keep up to date)
- Packaging e2e → `__tests__/packaging/build.test.ts` (runs the full `build.sh` + `dmg.sh`, ~2 min)

Run the full suite before committing anything non-trivial: `pnpm run studio:test`.

## Files to leave alone unless asked

- `studio/SESSION-HANDOFF.md`, `studio/STATUS.md`, `studio/ROADMAP.md` — manually maintained planning artifacts
- `studio/docs/plans/` — archived plans, write-once
- `studio/tmp/` — scratch
- Anything under `projects/` at the repo level — user data, never touch
