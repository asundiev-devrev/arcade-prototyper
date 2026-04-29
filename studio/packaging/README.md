# Arcade Studio `.app` bundle

Build tooling that packages Arcade Studio as a double-clickable macOS app.

## Build

```
./studio/packaging/build.sh
```

Produces `studio/packaging/dist/Arcade Studio.app` and `studio/packaging/dist/Arcade Studio.dmg`.

## Install (internal users)

1. Download `Arcade Studio.dmg` from the DevRev-internal share link.
2. Open the DMG and drag **Arcade Studio** to **Applications**. Eject the DMG.
3. **First launch:** double-click **Arcade Studio** in `/Applications`. macOS shows "Arcade Studio cannot be opened because the developer cannot be verified." Click **Done** (or Cancel). This is Gatekeeper blocking the unsigned app — you have to override it once.
4. Open **System Settings → Privacy & Security**. Scroll down to the "Security" section. There's a line "'Arcade Studio' was blocked to protect your Mac." with an **Open Anyway** button. Click it, authenticate with Touch ID or your password, and click **Open** in the confirmation dialog.
5. Studio launches. Your browser opens `http://localhost:5556`. Every subsequent double-click works normally — no more Gatekeeper dialog.

> **Why this is clunky:** the `.app` is unsigned (no Apple Developer ID certificate). On macOS Sonoma (14.x) and later, Apple removed the classic right-click → Open shortcut, so System Settings is the only way to whitelist an unsigned app. One-time pain per install.

## Why unsigned

This bundle is for DevRev-internal distribution. Apple Developer ID signing + notarization are deferred until we have a DevRev signing certificate. Once we do, the Privacy & Security dance goes away and double-click just works.

## Size

The DMG is ~290 MB compressed; the installed `.app` is ~710 MB. Most of that is Node (~80 MB), the full repo `node_modules` (~550 MB including playwright/vite/tailwind/etc.), and the vendored `figmanage` and `claude-code` CLIs.

## Troubleshooting

### "Arcade Studio is damaged and can't be opened"

This happens occasionally when macOS marks the bundle as truly damaged (bad ad-hoc signature, partial DMG copy, or Gatekeeper flagging it after several failed launches). Strip the quarantine attribute and re-sign:

```bash
xattr -dr com.apple.quarantine "/Applications/Arcade Studio.app"
codesign --force --deep --sign - --timestamp=none "/Applications/Arcade Studio.app"
```

Then go to **System Settings → Privacy & Security** and click **Open Anyway** as described in the install section. If the dialog isn't there, delete the app and reinstall from the DMG.

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
