# Codesign + Notarize Arcade Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc codesigning with a properly-signed-and-notarized build using DevRev's Apple Developer ID, so beta testers no longer hit Gatekeeper warnings on first launch.

**Architecture:** Keep the existing `.app` packaging shape — bundled Node, Claude CLI, cloudflared, AWS CLI inside `Contents/Resources/`, bash launcher as the bundle executable. Replace `lib/codesign.sh`'s `--sign -` (ad-hoc) with `--sign "Developer ID Application"` plus a hardened-runtime entitlements file. Sign nested helper binaries first, then the bundle, then notarize the DMG with `xcrun notarytool` and staple the receipt. Bundle ID changes from `com.devrev.arcade-studio` to `ai.devrev.internal.ArcadeStudio` per org guidance — this is a one-time migration; existing user data persists (it's path-keyed, not bundle-ID-keyed).

**Tech Stack:** Apple `codesign`, `xcrun notarytool`, `xcrun stapler`, `spctl`, bash. No new runtime dependencies.

---

## Coordination — read this before starting

1. **Branch from `main`, not from `feat/multiplayer-invite-flow`.** The 2b multiplayer agent owns the latter; tangling signing into it would force a painful rebase. Branch name: `feat/codesign-notarize`.
2. **Version is `0.19.0`.** The 2b agent has been told this directly; they'll release the next multiplayer line as 0.19.x once their work merges. Do not pick `0.18.7`.
3. **Bundle ID change.** `Info.plist` `CFBundleIdentifier` becomes `ai.devrev.internal.ArcadeStudio`. Existing 0.18.x users will see the signed build as a different app — release notes must tell them to drag the old `Arcade Studio.app` to the trash before installing 0.19.0.
4. **User data survives the bundle ID change.** Projects, settings, secrets fallback, multiplayer state, AWS config, logs are all path-keyed under `~/Library/Application Support/arcade-studio/` and `~/.aws/` — none of them reference the bundle ID. The DevRev PAT in the macOS Keychain (`keytar` service `arcade-studio`) will trigger a one-time "allow access" prompt on first launch of the new app because keychain ACLs are tied to signing identity. The fallback path in `studio/server/secrets/keychain.ts:33-35` writes to plaintext if keychain access fails, so users can't actually lose their PAT.

## Prerequisites — verify before starting

- [ ] **Apple Developer ID Application certificate is installed in your login keychain**

Run: `security find-identity -v -p codesigning`
Expected: A line like `"Developer ID Application: DevRev Inc. (XXXXXXXXXX)"` where `XXXXXXXXXX` is the 10-character Team ID. Capture the **exact full string** including quotes — you'll paste it into `codesign.sh` later. If the cert is missing, request it from the org's Apple Developer portal admin before proceeding.

- [ ] **Notarization credentials are available in the keychain as a profile**

Run: `xcrun notarytool history --keychain-profile arcade-studio-notarize`
Expected: Either a list of past submissions, or `Error: A keychain item ... was not found`. If not found, run:
```
xcrun notarytool store-credentials arcade-studio-notarize \
  --apple-id <your-apple-id> \
  --team-id <TEAMID> \
  --password <app-specific-password>
```
The app-specific password is generated at https://appleid.apple.com → Sign-In & Security → App-Specific Passwords. The Team ID matches the parenthesized ID from the cert above. Once stored, the credential is reused by every notarization call.

- [ ] **Confirm `xcrun stapler` is available**

Run: `xcrun stapler --help`
Expected: usage output, not "command not found". `stapler` ships with Xcode command-line tools.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `studio/packaging/VERSION` | modify | Bump from `0.17.1` (on main) → `0.19.0` |
| `studio/packaging/Info.plist` | modify | Change `CFBundleIdentifier` to `ai.devrev.internal.ArcadeStudio`; update URL scheme reverse-DNS name to match |
| `studio/packaging/entitlements.plist` | create | Hardened-runtime entitlements: JIT, unsigned-memory, dyld env, library validation disable |
| `studio/packaging/lib/codesign.sh` | modify | Switch from ad-hoc `--sign -` to Developer ID identity, sign nested binaries first, apply entitlements + hardened runtime + secure timestamp |
| `studio/packaging/lib/notarize.sh` | create | New script: submit DMG to notarytool, wait for completion, staple receipt, verify with `spctl` |
| `studio/packaging/build.sh` | modify | Read `CODESIGN_IDENTITY` from environment; pass through to `codesign.sh`; fall back to ad-hoc when not set so dev rebuilds still work |
| `studio/packaging/dmg.sh` | modify | Sign the DMG itself after creation (Apple notarization requires the DMG be signed too) |
| `studio/packaging/README.md` | modify | Document the new `CODESIGN_IDENTITY` env var, the notarytool keychain profile name, and the full release flow |
| `studio/CHANGELOG.md` | modify | Add `## [0.19.0] — 2026-05-15` entry: signed + notarized build, bundle ID change, user-facing migration note |
| `package.json` | modify | Add `studio:notarize` script that runs `notarize.sh` against the latest DMG; update `studio:pack` to chain `build → dmg → notarize` when `CODESIGN_IDENTITY` is set |

---

## Task 1: Branch from main and bump version

**Files:**
- Modify: `studio/packaging/VERSION`

- [ ] **Step 1: Branch from main**

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/codesign-notarize
```

Expected: `git branch --show-current` returns `feat/codesign-notarize` and `git log --oneline -1` shows the latest main commit (`537b093 chore(studio/packaging): release 0.17.1 — branded DMG installer window` or newer if main has advanced).

- [ ] **Step 2: Bump VERSION to 0.19.0**

Replace the contents of `studio/packaging/VERSION` with exactly:
```
0.19.0
```

- [ ] **Step 3: Verify**

Run: `cat studio/packaging/VERSION`
Expected: `0.19.0`

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/VERSION
git commit -m "chore(studio/packaging): bump to 0.19.0 for signed + notarized release"
```

---

## Task 2: Update bundle identifier

**Files:**
- Modify: `studio/packaging/Info.plist`

- [ ] **Step 1: Change CFBundleIdentifier**

In `studio/packaging/Info.plist`, replace:
```xml
  <key>CFBundleIdentifier</key>
  <string>com.devrev.arcade-studio</string>
```
with:
```xml
  <key>CFBundleIdentifier</key>
  <string>ai.devrev.internal.ArcadeStudio</string>
```

- [ ] **Step 2: Verify the change**

Run: `grep -A1 CFBundleIdentifier studio/packaging/Info.plist`
Expected output:
```
  <key>CFBundleIdentifier</key>
  <string>ai.devrev.internal.ArcadeStudio</string>
```

- [ ] **Step 3: Note about URL scheme**

The `feat/multiplayer-invite-flow` branch added a `CFBundleURLName` of `com.devrev.arcade-studio.session` for the `arcade-studio://` scheme. **Don't update that here** — it doesn't exist on `main` yet, so `Info.plist` on this branch shouldn't have it. The 2b agent owns that file and will resolve the reverse-DNS name when they rebase: their `CFBundleURLName` should become `ai.devrev.internal.ArcadeStudio.session` to match the new identifier. The URL scheme string `arcade-studio` itself stays the same (it's a user-facing namespace, not a reverse-DNS).

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/Info.plist
git commit -m "chore(studio/packaging): update bundle ID to ai.devrev.internal.ArcadeStudio"
```

---

## Task 3: Create hardened-runtime entitlements file

**Files:**
- Create: `studio/packaging/entitlements.plist`

- [ ] **Step 1: Write the entitlements file**

Create `studio/packaging/entitlements.plist` with exactly this content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!--
    The bundled Node runtime needs JIT for V8, and Claude CLI's vendored
    Node binary needs unsigned executable memory for its compiled add-ons.
    Without these the hardened runtime kills the process at first JIT
    compile with a SIGKILL and a "code signing" message in the system log.
  -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <!--
    Node loads many .node native add-ons; keytar in particular ships its
    own .node binding. Without disabling library validation, the hardened
    runtime refuses to load any dylib not signed by the same Team ID,
    which makes our bundled native deps unusable.
  -->
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <!--
    The launcher relies on PATH, AWS_PROFILE, ARCADE_STUDIO_CLAUDE_BIN, etc.
    The hardened runtime by default strips most DYLD_* and some shell-side
    env vars before exec'ing children. We need them preserved end-to-end
    (launcher.sh → node → claude → cloudflared subprocess chain).
  -->
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <!--
    Claude CLI's native binary is downloaded post-install (200MB) and runs
    interpreted bytecode. It needs the same unsigned-executable-memory
    grant; we keep this entitlement on the parent bundle so it cascades.
  -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 2: Verify**

Run: `plutil -lint studio/packaging/entitlements.plist`
Expected: `studio/packaging/entitlements.plist: OK`

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/entitlements.plist
git commit -m "feat(studio/packaging): add hardened-runtime entitlements"
```

---

## Task 4: Rewrite codesign.sh for Developer ID + nested binary signing

**Files:**
- Modify: `studio/packaging/lib/codesign.sh`

The current script does `codesign --force --deep --sign - --timestamp=none`. `--deep` is unreliable with hardened runtime — it skips deeply-nested helper binaries (especially the bundled Node, Claude's native binary, and cloudflared). We need to sign the nested binaries first in dependency order, then sign the outer bundle without `--deep`.

- [ ] **Step 1: Write the new codesign.sh**

Replace the entire contents of `studio/packaging/lib/codesign.sh` with:

```bash
#!/bin/bash
# Usage: codesign.sh <path-to-.app>
#
# Signs the .app for distribution. Mode is controlled by CODESIGN_IDENTITY:
#
#   CODESIGN_IDENTITY=""        → ad-hoc sign (dev rebuilds, local testing)
#   CODESIGN_IDENTITY="<id>"    → Developer ID sign + hardened runtime
#                                 (release builds; required for notarization)
#
# When signing for release, every helper binary inside Contents/Resources/
# must be signed first, in dependency order: leaf binaries before bundles
# that contain them. Apple's `--deep` flag skips a lot — we don't trust it.
set -euo pipefail

APP="${1:?app path required}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

IDENTITY="${CODESIGN_IDENTITY:-}"
PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
ENTITLEMENTS="$PKG_DIR/entitlements.plist"

if [ -z "$IDENTITY" ]; then
  echo "==> Ad-hoc signing (no CODESIGN_IDENTITY set)"
  codesign --force --deep --sign - --timestamp=none "$APP"
  codesign -dv "$APP" 2>&1 | head -5
  echo "Ad-hoc signed: $APP"
  exit 0
fi

echo "==> Developer ID signing with: $IDENTITY"

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "Missing entitlements file: $ENTITLEMENTS" >&2
  exit 1
fi

# Sign every Mach-O helper inside the bundle, leaves first.
# `find -perm +111` matches any file with at least one execute bit set,
# which catches both binaries and scripts. We then filter to actual
# Mach-O files using the `file` command — scripts get signed implicitly
# via the bundle's signature later.
sign_one() {
  local target="$1"
  codesign --force \
    --options runtime \
    --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$target"
}

echo "==> Signing nested Mach-O binaries"
# `--null` + `read -d ''` handles paths with spaces (the bundle root has one).
while IFS= read -r -d '' bin; do
  if file "$bin" | grep -q "Mach-O"; then
    echo "    $bin"
    sign_one "$bin"
  fi
done < <(find "$APP/Contents/Resources" -type f -perm +111 -print0)

# Sign nested .app bundles (none today, but keytar ships helper bundles).
while IFS= read -r -d '' nested_app; do
  echo "    $nested_app (nested bundle)"
  sign_one "$nested_app"
done < <(find "$APP/Contents/Resources" -type d -name "*.app" -print0)

# Sign the .framework bundles bundled-Node ships under
# Contents/Resources/node/.../.framework — none currently, but if Node's
# install layout changes this catches them.
while IFS= read -r -d '' fw; do
  echo "    $fw (framework)"
  sign_one "$fw"
done < <(find "$APP/Contents/Resources" -type d -name "*.framework" -print0)

echo "==> Signing the outer bundle"
sign_one "$APP"

echo "==> Verifying signature"
codesign --verify --verbose=2 --strict "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | head -15

# Gatekeeper assessment: confirms the signature would be accepted on a
# fresh machine. Won't pass yet (notarization staples come later) but
# reveals problems with the signing itself.
spctl --assess --type execute --verbose=4 "$APP" 2>&1 || \
  echo "    (spctl may report 'rejected' until notarization staples — that's expected)"

echo "Signed: $APP"
```

- [ ] **Step 2: Verify the script syntax**

Run: `bash -n studio/packaging/lib/codesign.sh`
Expected: no output (clean parse). If there's a syntax error, fix it before continuing.

- [ ] **Step 3: Verify ad-hoc fallback still works**

Run: `bash studio/packaging/lib/codesign.sh studio/packaging/dist/Arcade\ Studio.app`
Expected (assuming the existing 0.18.6 build is still in dist/): "Ad-hoc signing (no CODESIGN_IDENTITY set)" followed by codesign output. The script should not error.

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/lib/codesign.sh
git commit -m "feat(studio/packaging): codesign.sh signs nested binaries + supports Developer ID"
```

---

## Task 5: Wire CODESIGN_IDENTITY through build.sh

**Files:**
- Modify: `studio/packaging/build.sh`

`build.sh` calls `codesign.sh` directly; the new env-var contract just needs to flow through. The change is small but explicit.

- [ ] **Step 1: Update the codesign step in build.sh**

In `studio/packaging/build.sh`, find the block:
```bash
echo "==> Ad-hoc codesigning"
bash "$PKG_DIR/lib/codesign.sh" "$APP"
```

Replace it with:
```bash
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  echo "==> Codesigning with: $CODESIGN_IDENTITY"
else
  echo "==> Ad-hoc codesigning (set CODESIGN_IDENTITY for release builds)"
fi
bash "$PKG_DIR/lib/codesign.sh" "$APP"
```

- [ ] **Step 2: Verify**

Run: `bash -n studio/packaging/build.sh`
Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/build.sh
git commit -m "chore(studio/packaging): surface CODESIGN_IDENTITY in build log"
```

---

## Task 6: Sign the DMG itself in dmg.sh

**Files:**
- Modify: `studio/packaging/dmg.sh`

Notarization requires that the DMG be signed too — Apple checks both the `.app` inside the DMG and the DMG container itself. The current `dmg.sh` ends with `hdiutil convert` and doesn't sign.

- [ ] **Step 1: Append signing step to dmg.sh**

At the end of `studio/packaging/dmg.sh`, after the `hdiutil convert` line and before the final `echo` lines, insert:

```bash
# Sign the DMG container so notarization accepts it. Same identity as the
# .app. The DMG doesn't need entitlements or the hardened runtime — it's
# a disk image, not an executable — but it does need the timestamp and
# Developer ID identity. Skipped silently when CODESIGN_IDENTITY is unset
# so dev rebuilds still produce a usable (if unsigned) DMG.
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  echo "==> Signing DMG"
  codesign --force --sign "$CODESIGN_IDENTITY" --timestamp "$DMG"
  codesign -dv "$DMG" 2>&1 | head -5
fi
```

- [ ] **Step 2: Verify**

Run: `bash -n studio/packaging/dmg.sh`
Expected: clean parse.

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/dmg.sh
git commit -m "feat(studio/packaging): sign DMG container when CODESIGN_IDENTITY set"
```

---

## Task 7: Create notarize.sh

**Files:**
- Create: `studio/packaging/lib/notarize.sh`

- [ ] **Step 1: Write the notarize script**

Create `studio/packaging/lib/notarize.sh` with:

```bash
#!/bin/bash
# Usage: notarize.sh <path-to-dmg>
#
# Submits the DMG to Apple notarization and staples the receipt to it
# in-place when notarization succeeds. After stapling, the DMG works on
# offline first-launch machines (Gatekeeper finds the receipt locally
# without needing a network round-trip).
#
# Requires:
#   - The DMG was signed with a Developer ID Application cert.
#   - The .app inside was signed with --options runtime + entitlements.
#   - A keychain profile named "arcade-studio-notarize" exists, created
#     once via:
#       xcrun notarytool store-credentials arcade-studio-notarize \
#         --apple-id <your-id> --team-id <TEAMID> --password <app-pw>
set -euo pipefail

DMG="${1:?dmg path required}"
PROFILE="${NOTARIZE_PROFILE:-arcade-studio-notarize}"

if [ ! -f "$DMG" ]; then
  echo "Not a file: $DMG" >&2
  exit 1
fi

echo "==> Submitting $DMG to notarization (profile: $PROFILE)"
echo "    This typically takes 1-5 minutes."

# `--wait` blocks until Apple finishes; `--output-format json` makes the
# status machine-readable so we can fail loudly on rejection.
SUBMIT_LOG="$(dirname "$DMG")/notarize-$(date +%Y%m%d-%H%M%S).log"
xcrun notarytool submit "$DMG" \
  --keychain-profile "$PROFILE" \
  --wait \
  --output-format json | tee "$SUBMIT_LOG"

# Extract the status from the last line of JSON (notarytool prints
# multiple JSON objects; the final one has the terminal status).
STATUS="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")"

if [ "$STATUS" != "Accepted" ]; then
  echo "" >&2
  echo "ERROR: notarization status was '$STATUS', not 'Accepted'." >&2
  echo "Submission log saved to: $SUBMIT_LOG" >&2
  echo "" >&2
  echo "To inspect the rejection reason:" >&2
  SUBMISSION_ID="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")"
  if [ -n "$SUBMISSION_ID" ]; then
    echo "  xcrun notarytool log $SUBMISSION_ID --keychain-profile $PROFILE" >&2
  fi
  exit 1
fi

echo "==> Stapling receipt to DMG"
xcrun stapler staple "$DMG"

echo "==> Verifying"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG" 2>&1 | head -5

echo ""
echo "✓ Notarized + stapled: $DMG"
```

- [ ] **Step 2: Make it executable and verify syntax**

Run:
```bash
chmod +x studio/packaging/lib/notarize.sh
bash -n studio/packaging/lib/notarize.sh
```
Expected: clean parse, no output.

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/lib/notarize.sh
git commit -m "feat(studio/packaging): add notarize.sh — submit + staple DMG"
```

---

## Task 8: Add studio:notarize npm script and update studio:pack

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update scripts**

In `package.json`, find:
```json
    "studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh"
```

Replace with:
```json
    "studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh",
    "studio:release": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh && bash studio/packaging/lib/notarize.sh \"studio/packaging/dist/Arcade Studio $(cat studio/packaging/VERSION).dmg\""
```

`studio:pack` stays unchanged so the dev rebuild loop is untouched. `studio:release` is the new "build a properly signed and notarized DMG" path; it requires `CODESIGN_IDENTITY` to be set in the calling shell.

- [ ] **Step 2: Verify the JSON is still valid**

Run: `node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'`
Expected: no output (silent success). If it errors, fix the JSON.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(studio/packaging): add studio:release script for signed + notarized builds"
```

---

## Task 9: Document the release flow

**Files:**
- Modify: `studio/packaging/README.md`

- [ ] **Step 1: Read the current README**

Open `studio/packaging/README.md` and read it. Find a natural insertion point after the existing "Building" section (or equivalent) and before any "Troubleshooting" section.

- [ ] **Step 2: Add a "Signing and notarization" section**

Insert this section at the appropriate spot:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add studio/packaging/README.md
git commit -m "docs(studio/packaging): document signed + notarized release flow"
```

---

## Task 10: Add changelog entry

**Files:**
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Read the top of the changelog**

Open `studio/CHANGELOG.md` and look at the most recent entry's format (the 0.18.6 entry, or whichever is at the top of `main`).

- [ ] **Step 2: Add the 0.19.0 entry at the top**

Insert this block at the very top of the changelog (above the most recent entry):

```markdown
## [0.19.0] — 2026-05-15

### Changed
- Build is now signed with DevRev's Apple Developer ID and notarized by
  Apple. First launch no longer triggers the "unidentified developer"
  Gatekeeper warning. No more right-click → Open dance.
- Bundle identifier changed from `com.devrev.arcade-studio` to
  `ai.devrev.internal.ArcadeStudio`. macOS treats the signed build as a
  separate app from the previous unsigned ones — drag the old
  `Arcade Studio.app` to the trash before installing 0.19.0 to avoid
  having two installed simultaneously.

### Migration notes
- Your projects, settings, and DevRev PAT carry over automatically — they
  live under `~/Library/Application Support/arcade-studio/` and the
  macOS Keychain, both keyed by path/service name rather than bundle ID.
- On first launch of 0.19.0, macOS may prompt you to allow the new app
  to read the existing DevRev PAT from the Keychain (because the
  signing identity changed). Click **Always Allow**.
```

- [ ] **Step 3: Verify**

Run: `head -20 studio/CHANGELOG.md`
Expected: the 0.19.0 entry appears at the top.

- [ ] **Step 4: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): add 0.19.0 changelog entry — signed + notarized"
```

---

## Task 11: Build and notarize

This task runs the actual release flow. It produces the artifact you'll publish to the mirror.

- [ ] **Step 1: Set CODESIGN_IDENTITY**

```bash
export CODESIGN_IDENTITY="Developer ID Application: <Org Name> (<TEAMID>)"
```

Use the exact string from `security find-identity -v -p codesigning` — including the parentheses and Team ID. Without quotes the shell will splice on spaces.

- [ ] **Step 2: Run the release script**

```bash
pnpm run studio:release
```

Expected:
- Build prints `==> Codesigning with: Developer ID Application: ...`
- Each nested binary path appears under `==> Signing nested Mach-O binaries`
- DMG is built and signed
- Notarization submission begins; status JSON streams to stdout
- Final status `"status": "Accepted"`
- Stapler validates successfully
- Final line: `✓ Notarized + stapled: studio/packaging/dist/Arcade Studio 0.19.0.dmg`

- [ ] **Step 3: Verify on a fresh terminal**

```bash
spctl --assess --type open --context context:primary-signature --verbose=4 \
  "studio/packaging/dist/Arcade Studio 0.19.0.dmg"
```
Expected: `accepted; source=Notarized Developer ID`.

- [ ] **Step 4: Smoke-test the .app**

```bash
open "studio/packaging/dist/Arcade Studio 0.19.0.dmg"
```

Drag the .app to Applications, then double-click. **Expected: no Gatekeeper warning at all.** The app should launch directly. The Vite server should boot and the browser should open at `http://localhost:5556`.

If you get a "damaged" or "unidentified developer" warning, something is wrong. Check:
- `codesign --verify --verbose=2 --strict /Applications/Arcade\ Studio.app`
- `xcrun stapler validate /Applications/Arcade\ Studio.app` should say "ready to use"

- [ ] **Step 5: Smoke-test that user data carries over**

If you have an existing 0.18.6 install with projects, this step verifies the bundle-ID change didn't lose data.

After launching 0.19.0:
- Open the project list — your existing projects should appear
- Open Settings — your DevRev PAT should be saved (you may see a one-time Keychain prompt; click Always Allow)
- Other settings (Vercel, Figma, AWS) should also persist

If projects are missing, do not proceed. Investigate before publishing.

- [ ] **Step 6: Note the build artifact**

The DMG is at `studio/packaging/dist/Arcade Studio 0.19.0.dmg`. Don't commit it; releases go to the mirror repo via `gh release create`.

---

## Task 12: Publish to the releases mirror

- [ ] **Step 1: Push the source branch**

```bash
git push -u origin feat/codesign-notarize
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create --title "Codesign + notarize Studio for 0.19.0" --body "$(cat <<'EOF'
## Summary
- Replace ad-hoc codesigning with Apple Developer ID + notarization
- Bundle ID changes to `ai.devrev.internal.ArcadeStudio` per org guidance
- Bumps version to 0.19.0
- Coordinated with the multiplayer (2b) agent: they will release the next multiplayer line as 0.19.x once their work merges

## Test plan
- [x] `pnpm run studio:pack` (ad-hoc fallback) produces an unsigned-but-functional .app
- [x] `pnpm run studio:release` (with CODESIGN_IDENTITY) produces a notarized DMG
- [x] `spctl --assess` reports "Notarized Developer ID"
- [x] Fresh-Mac smoke test: no Gatekeeper warning
- [x] Existing 0.18.6 user-data smoke test: projects + PAT carry over

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After the PR merges, publish the release**

```bash
gh release create v0.19.0 "studio/packaging/dist/Arcade Studio 0.19.0.dmg" \
  --repo asundiev-devrev/arcade-studio-releases \
  --title "Arcade Studio 0.19.0" \
  --notes-file <(awk '/^## \[0\.19\.0\]/{f=1;next} /^## \[/{f=0} f' studio/CHANGELOG.md) \
  --latest
```

The mirror's release feeds the in-app "update available" banner. After this lands, beta testers on 0.18.6 will see the 0.19.0 prompt.

---

## Self-review checklist (run after writing the plan)

**Spec coverage:**
- ✅ Bundle ID change to `ai.devrev.internal.ArcadeStudio` — Task 2
- ✅ Developer ID signing — Task 4
- ✅ Hardened runtime + entitlements — Task 3
- ✅ Notarization + stapling — Task 7, 11
- ✅ Existing user data preserved — verified pre-plan, called out in Tasks 10 + 11
- ✅ Coordination with 2b agent — header + Task 1 + Task 2 step 3
- ✅ Skip 0.18.x range, go straight to 0.19.0 — Task 1
- ✅ Distribution path (mirror repo) — Task 12

**Type/identifier consistency:**
- `CODESIGN_IDENTITY` env var — used consistently in codesign.sh, build.sh, dmg.sh, README, Task 11
- `arcade-studio-notarize` keychain profile name — used consistently in notarize.sh, README, Task 11
- `ai.devrev.internal.ArcadeStudio` bundle ID — used consistently in Info.plist, changelog migration note, README

**No placeholders:** All code blocks contain actual content; all `<replace>` tokens are clearly user-supplied secrets, not unfilled spec.

---

## Open questions / risks worth knowing about

1. **Notarization first-time gotchas.** The first notarization submission for a new bundle ID can take longer than the typical 1-5 min — Apple sometimes does extended scrutiny on new identifiers. Don't panic if the first one runs 10-15 min.

2. **Hardened-runtime + Claude CLI.** Claude's native binary is downloaded post-install (200MB) and runs interpreted bytecode. It's never been signed under our cert before. If notarization rejects it, the fix is to sign that binary explicitly inside `install-deps.sh` after the postinstall (or include it in the codesign sweep, which is what the current Task 4 design does — the `find -perm +111` over `Contents/Resources` catches it).

3. **The `--deep` flag is unreliable.** That's why Task 4 explicitly sweeps every Mach-O binary individually before signing the bundle. Don't be tempted to "simplify" back to `--deep` — it will pass `codesign --verify` locally and then fail notarization with cryptic `validation_failed` errors.

4. **AWS CLI's bundled Python.** `Resources/awscli/aws-cli` ships its own Python interpreter. The `find` sweep should catch it, but if notarization complains about a specific path under awscli, that's the most likely culprit.

5. **`arcade-studio.app` alongside the new bundle.** Beta testers who don't read the migration note will end up with two apps installed. The URL scheme handler resolution between them is undefined behavior — Launch Services picks "the most recent". Surface this prominently in release notes (Task 10) and in the in-app update banner if possible.

---

## Plan complete — saved to `studio/docs/plans/2026-05-15-codesign-notarize.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
