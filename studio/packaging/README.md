# Arcade Studio `.app` bundle

Build tooling that packages Arcade Studio as a double-clickable macOS app.

## Build

```
./studio/packaging/build.sh
```

Produces `studio/packaging/dist/Arcade Studio.app` and `studio/packaging/dist/Arcade Studio.dmg`.

## Install (internal users)

For **signed release builds** (the default, distributed via the public mirror):

1. Download `Arcade Studio.dmg` from the DevRev-internal share link.
2. Open the DMG and drag **Arcade Studio** to **Applications**. Eject the DMG.
3. Double-click. The app launches; your browser opens `http://localhost:5556`.

For **ad-hoc dev builds** (built locally without `CODESIGN_IDENTITY`):

1. Download or copy the `.app` to `/Applications`.
2. **First launch:** double-click. macOS shows "Arcade Studio cannot be opened because the developer cannot be verified." Click **Done** (or Cancel).
3. Open **System Settings → Privacy & Security**. Scroll to "Security". There's a line "'Arcade Studio' was blocked to protect your Mac." with an **Open Anyway** button. Click it, authenticate, and click **Open** in the confirmation dialog.
4. Studio launches; subsequent double-clicks work normally — no more Gatekeeper dialog.

> The signed-build path is what beta testers see. The ad-hoc dev path only matters when you've built locally without an Apple Developer ID identity.

## Distribution model

DevRev-internal distribution. Signed and notarized release builds go to the public mirror repo (`asundiev-devrev/arcade-studio-releases`), and the in-app updater polls that mirror for new versions. Source stays in this private repo. See "Signing and notarization" below for how to make a release-grade build.

## Signing and notarization

The packaging supports two modes:

- **Ad-hoc** (the default): runs `codesign --sign -`. The resulting `.app`
  works on the build machine but Gatekeeper warns on other Macs ("from
  an unidentified developer"). Use this for dev rebuilds. Just run
  `pnpm run studio:pack`.

- **Developer ID + notarized**: signs with the org's Apple Developer ID,
  applies hardened-runtime entitlements, then submits the DMG to Apple
  for notarization and staples the receipt. Use this for releases shipped
  to beta testers.

### One-time setup for releases

1. Get the org's Developer ID Application certificate installed in your
   login keychain. Verify with:
   ```
   security find-identity -v -p codesigning
   ```
   You're looking for a line like
   `"Developer ID Application: DevRev Inc. (XXXXXXXXXX)"`.

2. Create a notarytool keychain profile (one-time):
   ```
   xcrun notarytool store-credentials arcade-studio-notarize \
     --apple-id <your-apple-id> \
     --team-id <TEAMID> \
     --password <app-specific-password>
   ```
   App-specific passwords come from
   https://appleid.apple.com → Sign-In & Security.

### Building a signed + notarized release

```
export CODESIGN_IDENTITY="Developer ID Application: DevRev Inc. (XXXXXXXXXX)"
pnpm run studio:release
```

The script:
1. Builds the `.app`, signing all nested binaries individually with the
   Developer ID, hardened runtime, and entitlements
   (`packaging/entitlements.plist`).
2. Wraps it in a DMG and signs the DMG container.
3. Submits the DMG to Apple notarization (`xcrun notarytool submit --wait`).
   Typical wait is 1-5 minutes.
4. Staples the notarization receipt to the DMG so first-launch on
   offline machines still works.

To verify the result on the build machine:
```
spctl --assess --type open --context context:primary-signature --verbose=4 \
  "studio/packaging/dist/Arcade Studio <VERSION>.dmg"
```
Expected: `accepted; source=Notarized Developer ID`.

### Notarization rejections

If notarization fails, the script prints the submission ID and the path
to the log. To see Apple's rejection reasons:
```
xcrun notarytool log <SUBMISSION_ID> --keychain-profile arcade-studio-notarize
```
Common causes: a nested binary missing the hardened-runtime flag, an
entitlement disallowed by the Developer ID profile, or a binary signed
with `--timestamp=none` (Apple requires a secure timestamp).

## Size

The DMG is ~290 MB compressed; the installed `.app` is ~710 MB. Most of that is Node (~80 MB), the full repo `node_modules` (~550 MB including playwright/vite/tailwind/etc.), and the vendored `figmanage` and `claude-code` CLIs.

## Troubleshooting

### "Arcade Studio is damaged and can't be opened"

For signed release builds, this is rare and usually means the download was corrupted or quarantine flags were stripped in transit. Re-download the DMG from the mirror.

For ad-hoc dev builds, the bundle's signature can break after copying between machines or partial DMG mounts. Strip the quarantine attribute and re-sign:

```bash
xattr -dr com.apple.quarantine "/Applications/Arcade Studio.app"
codesign --force --deep --sign - --timestamp=none "/Applications/Arcade Studio.app"
```

Then go to **System Settings → Privacy & Security** and click **Open Anyway**. If the dialog isn't there, delete the app and reinstall from the DMG.

### Port 5556 already in use

Another studio instance (or a stale Vite process) is still running. The app detects this and opens the browser against the existing server. If the existing one is broken:

```bash
lsof -ti:5556 | xargs kill
```

Then launch again.

### Nothing happens on double-click

Check the launcher log:

```bash
tail -100 "$HOME/Library/Logs/arcade-studio.log"
```

Common causes:
- The bundled Node binary lost its executable bit (rare — shouldn't happen after ad-hoc codesigning). Re-run `pnpm studio:pack`.
- (Ad-hoc dev builds only) The `.app` was copied between machines in a way that stripped the signature. Re-run `codesign --force --deep --sign - --timestamp=none "/Applications/Arcade Studio.app"` on the target machine. **Don't run this on a signed release build — it strips the notarization.**

### "Connect Figma" button doesn't complete

`figmanage login` opens your default browser for OAuth. If the button hangs, check:
- Is your default browser set? (`open https://example.com` should work.)
- Did the OAuth redirect succeed? Run `figmanage whoami` in a terminal — it prints your email if so.
- Close the browser tab and click "Connect Figma" again — the command is idempotent.

Note: the bundled `.app` uses its own vendored `figmanage` inside `Contents/Resources/app/node_modules/.bin/figmanage`. If you have a different `figmanage` on your host `PATH` that's `logged in`, the bundle won't pick up those credentials — they're stored per-binary in the keychain. Log in via the "Connect Figma" button once per bundle install.

### "aws sso login" required on every chat turn

This plan does not cover SSO auto-refresh. The chat endpoint returns an `auth` SSE error when your session expires; the UI surfaces a "Log in to AWS" banner. See the separate "SSO keeper" plan (pending).

### Rebuilding after studio source changes

The packaged `.app` is a frozen snapshot of the studio repo at build time. To pick up code changes, re-run `pnpm studio:pack` — the `/api/settings`, projects on disk, and any figmanage login persist across rebuilds (they live in `$HOME/Library/Application Support/arcade-studio/` and the OS keychain, both outside the bundle).
