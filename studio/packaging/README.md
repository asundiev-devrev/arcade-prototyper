# Arcade Studio packaging

This directory holds the Electron build assets — entitlements,
DMG background, icon, and a fetch script for the bundled CLIs that
aren't shipped via npm. The actual build is driven by
`electron-builder.yml` at the repo root.

## Build

Dev mode (no packaging):
```
pnpm run studio:electron
```
Opens an Electron window pointing at Vite-served Studio.

Local build (no signing, no notarization):
```
pnpm run studio:pack
```
Produces `dist/Arcade Studio-0.21.0-arm64.dmg`. Useful for verifying
the bundle layout but the DMG is unsigned and won't install cleanly
on other Macs.

Signed + notarized release build:
```
pnpm run studio:release
```
The signing identity is pinned in `electron-builder.yml#mac.identity`,
so no `CSC_NAME` env var is needed (and setting one would override the
YAML config). Builds, signs every nested binary, notarizes both `.app`
and DMG, staples the receipts, and publishes the release to the public mirror
(`asundiev-devrev/arcade-studio-releases`). On next-launch of
existing 0.x.y installs, `electron-updater` will see the new release
and prompt for install.

## One-time setup

1. Install Apple Developer ID Application certificate. Verify with
   `security find-identity -v -p codesigning` — expect a line
   `"Developer ID Application: DevRev, Inc. (NJDA6Y3XRS)"`.
2. Create the notarization keychain profile:
   ```
   xcrun notarytool store-credentials arcade-studio-notarize \
     --apple-id <your-id> --team-id NJDA6Y3XRS --password <app-pw>
   ```

## Files

- `entitlements.plist` — moved to `electron/entitlements.mac.plist`. Hardened-runtime entitlements for the app (JIT, library validation, dyld env passthrough).
- `icon.icns` — moved to `electron/icon.icns`. Used for both the app icon and the DMG window.
- `dmg-background.png` — moved to `electron/dmg-background.png`. Branded DMG installer window backdrop.
- `scripts/fetch-cli-deps.sh` — pre-build hook. Downloads cloudflared + AWS CLI into `studio/packaging/{cloudflared,aws-cli}` so electron-builder's `extraResources` rule can pick them up. Idempotent.

## Bundled CLIs

These ship inside the `.app` and resolve via PATH-prefix at launch:

| CLI | Source | Bundle path |
|---|---|---|
| `claude` | npm `@anthropic-ai/claude-code` | `<Resources>/bin/claude` |
| `figmanage` | npm `figmanage` | `<Resources>/bin/figmanage-bin/figmanage` |
| `cloudflared` | GitHub release (build-time fetch) | `<Resources>/bin/cloudflared` |
| `aws` (AWS CLI v2) | Apple `.pkg` (build-time fetch) | `<Resources>/aws-cli/aws` |

`electron/main.ts` prefixes PATH with these directories so middleware-spawned subprocesses resolve correctly.

## Troubleshooting

### Build fails with "Code signing identity not found"

`security find-identity -v -p codesigning` must show the Developer ID Application cert. If empty, the cert isn't in your login keychain — see the 0.19.0 setup notes in `studio/CHANGELOG.md`.

### Notarization rejected

```
xcrun notarytool log <SUBMISSION_ID> --keychain-profile arcade-studio-notarize
```
Common causes today:
- A binary in `extraResources` is unsigned (electron-builder signs everything inside `.app/Contents/`, but `extraResources` lands directly in `Contents/Resources/` and may need explicit signing — see the `mac.afterSign` hook if this comes up).
- An entitlement was rejected by the Developer ID profile.
