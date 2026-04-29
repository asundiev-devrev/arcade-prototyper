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

The DMG is ~200–250 MB (unzipped ~650 MB). Most of that is Node, node_modules, and figma-cli.
