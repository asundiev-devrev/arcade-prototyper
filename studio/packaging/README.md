# Arcade Studio `.app` bundle

Build tooling that packages Arcade Studio as a double-clickable macOS app.

## Build

```
./studio/packaging/build.sh
```

Produces `studio/packaging/dist/Arcade Studio.app` and `studio/packaging/dist/Arcade Studio.dmg`.

## Install (internal users)

1. Download `Arcade Studio.dmg` from the DevRev-internal share link.
2. Open the DMG and drag **Arcade Studio** to **Applications**.
3. **First launch only:** right-click the app in Applications and choose **Open**, then click **Open** in the dialog. macOS Gatekeeper blocks unsigned apps on first launch; right-click → Open bypasses this. Subsequent launches work with a normal double-click.
4. Studio opens `http://localhost:5556` in your default browser.

## Why unsigned

This bundle is for DevRev-internal distribution. Apple Developer ID signing + notarization are deferred until we have a DevRev signing certificate. For internal use, the one-time right-click → Open workflow is acceptable.

## Size

The DMG is ~290 MB compressed; the installed `.app` is ~710 MB. Most of that is Node (~80 MB), the full repo `node_modules` (~550 MB including playwright/vite/tailwind/etc.), and the vendored `figmanage` and `claude-code` CLIs.

## Troubleshooting

### "Arcade Studio is damaged and can't be opened"

You double-clicked before right-clicking → Open on first launch. Fix:

```bash
xattr -dr com.apple.quarantine "/Applications/Arcade Studio.app"
```

Then right-click → **Open**.

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
- The `.app` was copied between machines in a way that stripped the signature. Re-run `codesign --force --deep --sign - --timestamp=none "/Applications/Arcade Studio.app"` on the target machine.

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
