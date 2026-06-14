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
├── server/cloudflare/   Share-to-Cloudflare-Pages bundler (esbuild + Tailwind v4 per frame) + Worker client
├── worker/              Cloudflare Worker that proxies share deploys (holds the real CF API token)
├── server/plugins/      Vite plugins (frame mount, project watch, etc.)
├── prototype-kit/       Composites + templates the generator is told to use
├── packaging/           CLI deps + icon (fetch-cli-deps.sh vendors claude/cloudflared/awscli into packaging/{aws-cli,cloudflared}/)
├── __tests__/           Vitest suite (173 tests as of 0.3.0)
├── docs/                User-facing docs (aws-setup.md, etc.)
├── CHANGELOG.md         Source of truth for "What's new" modal
└── vite.config.ts       Wires all middleware into Vite's dev server
```

The `.app` / `.dmg` themselves are produced by **electron-builder** at the repo root:

```
electron/                Electron main-process source (main.ts, viteRunner.ts, updater.ts) + entitlements + icons
electron-builder.yml     Bundle config (files globs, extraResources for vendored CLIs, mac signing/notarize)
package.json#version     Single source of truth for the build version (read by middleware + Info.plist)
```

## Commands (run from repo root, not studio/)

- `pnpm run studio` — dev server, opens browser on :5556
- `pnpm run studio:test` — full vitest suite (~90s)
- `pnpm run studio:test <path>` — single file, much faster
- `pnpm run studio:pack` — build .app + .dmg into `studio/packaging/dist/`

## Releasing a new version

1. Bump the top-level `package.json#version` (semver, `0.x.y`). This is the single source of truth — electron-builder reads it for the bundle and the `/api/version` middleware reads it at runtime.
2. Add an entry at the top of `studio/CHANGELOG.md` — keep-a-changelog style (`## [0.x.0] — YYYY-MM-DD` + Added / Fixed / Changed bullets).
3. `pnpm run studio:pack` — runs `fetch-cli-deps.sh` then electron-builder; DMG lands in `dist/` at the repo root and auto-picks up the new version. The .app + DMG are codesigned but **not notarized** — electron-builder 25 only accepts `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` env vars for notarize, while our credentials live in the `arcade-studio-notarize` keychain profile (set up via `xcrun notarytool store-credentials`). So `notarize: false` in `electron-builder.yml` and we notarize manually below.
4. **Cut the release with the scripted command:**
   ```
   bash studio/packaging/scripts/release.sh
   ```
   Builds dmg + zip + latest-mac.yml, notarizes both artifacts, staples the
   .app, rewrites the manifest sha512 to match the stapled zip, and publishes
   all three to the public mirror (asundiev-devrev/arcade-studio-releases). The
   zip + latest-mac.yml are what the in-app auto-updater consumes; the dmg is
   for first-install. Reads the version from package.json#version and notes from
   the matching studio/CHANGELOG.md section.

   `pnpm run studio:release` is still NOT safe (it skips manual notarize) — use
   the script above.

   The mirror `asundiev-devrev/arcade-studio-releases` is a separate, public
   repo that carries only release artifacts; source stays in this private repo.

   The app polls `https://api.github.com/repos/asundiev-devrev/arcade-studio-releases/releases/latest`
   once per launch and caches the response for an hour.

The version flows from `package.json#version` into the bundle's `Info.plist` (via electron-builder's `extendInfo`), the `/api/version` middleware response, and the Settings footer.

## Things that cost debugging time last session — be wary

- **Vite middleware does NOT hot-reload.** Changes to anything under `server/middleware/*` or `vite.config.ts` require a full restart (quit the app or kill `pnpm run studio` and rerun). Under `pnpm run studio:electron` the Vite child still has the same restart-required constraint — quit Electron entirely, don't just close the window. Every "it's not working on my machine" that's actually "you didn't restart" traces to this.
- **Settings PATs follow one pattern.** DevRev, Cloudflare, and Figma all have a section in `AppSettingsModal.tsx` with: password `Input`, Save/Replace/Remove buttons, Connected `Badge`, inline error. When adding a new integration, mirror the existing sections — don't invent a new shape.
- **Tailwind v4 needs explicit `@source` globs for every consumer root** (studio, prototype-kit, user's frames dir). `studio/src/styles/tailwind.css` sets the static ones; the Vite plugin `injectStudioSourcePlugin` appends the projects root at dev time; `server/cloudflare/bundler.ts` does the same for Cloudflare share bundles. Missing any one of these → classes silently drop in that environment. See auto-memory `tailwind-v4-source-scanning.md`.
- **`@xorkavi/arcade-gen/styles.css` is a pre-compiled subset.** It alone is never enough — always pair with Tailwind scanning of the consumer tree.
- **Radix Select forbids `value=""`.** Use a non-empty sentinel and translate at save/load. Static test at `__tests__/components/select-item-empty-value.test.ts` catches violations.
- **Claude CLI emits `{type:"result", subtype:"success", is_error:true}` on Bedrock auth failures.** Our parser (`src/lib/streamJson.ts`) honors `is_error` over `subtype` specifically for this. Don't "simplify" that check.
- **`~/.aws/config` is bootstrapped on first run.** `electron/main.ts`'s `bootstrapAwsProfile()` writes the `[profile dev]` block when missing (ported from the legacy `launcher.sh`). Idempotent — users with a customized `[profile dev]` are NOT clobbered (literal `^\[profile dev\]` line match before append). It also defensively sets `AWS_PROFILE=dev` so `claude`/`aws` subprocesses inherit it. If we change the SSO portal values, both this code AND `studio/docs/aws-setup.md` must be updated in lockstep.

## Integrations — who owns what

| Integration | Storage | Server side | UI |
|---|---|---|---|
| DevRev PAT | `settings.json` + keytar/plaintext | `secrets/keychain.ts`, `middleware/devrev.ts` | AppSettingsModal DevRev section |
| Cloudflare Pages (share) | `settings.json` (`cloudflare.shareKey`) — per-user key; real CF API token lives only in the share Worker | `middleware/cloudflare.ts` → `server/cloudflare/deploy.ts` (Worker client) → `worker/` (proxy) → Cloudflare Pages API | AppSettingsModal "Share to web" section + ShareModal |
| Figma PAT | `figmanage` CLI config | `figmaCli.ts`, `middleware/figma.ts` | AppSettingsModal Figma section |
| AWS Bedrock | `~/.aws/` (CLI-native) | `middleware/awsLogin.ts`, `middleware/chat.ts` preflight | AuthExpiredNotice banner |

## Test discipline

Every bug we fix gets a test. Patterns:
- Server logic → `__tests__/server/...`
- Parser behavior → `__tests__/lib/streamJson.test.ts`
- Component behavior → `__tests__/components/*.test.tsx` with `@xorkavi/arcade-gen` mocked (note: mock must export `Modal`, `Input`, `Button`, etc. that the component uses — keep up to date)
- Packaging config → `__tests__/packaging/scaffold.test.ts` (asserts the shape of `electron-builder.yml` + supporting assets in `electron/` — pure config check, no actual build)

Run the full suite before committing anything non-trivial: `pnpm run studio:test`.

## Files to leave alone unless asked

- `studio/SESSION-HANDOFF.md`, `studio/STATUS.md`, `studio/ROADMAP.md` — manually maintained planning artifacts
- `studio/docs/plans/` — archived plans, write-once
- `studio/tmp/` — scratch
- Anything under `projects/` at the repo level — user data, never touch
