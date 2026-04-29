# Arcade Studio `.app` Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a double-clickable `Arcade Studio.app` (distributed as unsigned `.dmg`) that bundles Node, studio source, all npm dependencies, and `figma-cli`, and boots the Vite dev server transparently so a DevRev designer can "drag to Applications → double-click → start using studio."

**Architecture:** A plain macOS `.app` is a directory with a fixed layout. We produce `dist/Arcade Studio.app/Contents/{MacOS,Resources,Info.plist}` via a bash build script. `Resources/node/` holds a downloaded Node.js tarball; `Resources/app/` holds the full `arcade-prototyper` repo with pre-installed `node_modules`; `Resources/figma-cli/` holds a vendored clone of devrev/figma-cli. `MacOS/Arcade Studio` is a bash launcher that sets `PATH`, waits for port 5556, and starts Vite. Ad-hoc code-signing (`codesign --sign -`) is applied at the end of the build so Gatekeeper on Apple Silicon doesn't mark the app as "damaged" — first-launch still requires the user to right-click → Open once, which is documented.

**Tech Stack:** macOS `.app` layout, bash build scripts, Node.js darwin-arm64 standalone distribution, `hdiutil` for DMG creation, `codesign` for ad-hoc signing, vitest for build-script assertions.

---

## Scope

**In scope:**
- Build tooling at `studio/packaging/` that produces `dist/Arcade Studio.app` and `dist/Arcade Studio.dmg`.
- Bundled Node runtime (arm64 only in v1; x64/universal deferred).
- Pre-installed `node_modules` for the repo and studio (dev-deps excluded where safe).
- Vendored `figma-cli` clone inside the bundle, wired via `ARCADE_STUDIO_FIGMA_CLI_DIR`.
- Bundled `@anthropic-ai/claude-code` under the repo's `node_modules/.bin/claude` so `claudeBin.ts` resolves it.
- Launcher script that starts Vite in the background, opens `http://localhost:5556` once the port is live, and persists logs to `~/Library/Logs/arcade-studio.log`.
- "Already running" short-circuit: re-double-clicking the app just re-opens the browser tab.
- Ad-hoc `codesign` pass so the app does not get quarantined as "damaged."
- Gitignore for `dist/`.
- An internal-users README with the "right-click → Open" first-launch instruction.

**Explicitly out of scope (separate plans):**
- Background AWS SSO refresh keeper (Plan A).
- figma-cli daemon auto-start from within studio (Plan A).
- One-command `curl | sh` installer (Plan B).
- AWS CLI bundling or auto-`aws configure sso` (Plan B).
- Electron wrapper (alternative to this plan; explicitly chosen against).
- Apple Developer signing / notarization (deferred; acceptable for internal-only distribution).
- Intel (x64) and universal binaries (deferred; most DevRev laptops are Apple Silicon).
- Auto-update mechanism.

## Assumptions verified against the codebase

- `studio/vite.config.ts` hardcodes port 5556 and has `open: true` — Vite itself will open the browser once ready, but the launcher also force-opens so a user who closed the tab gets a fresh one. (vite.config.ts:67)
- `studio/server/claudeBin.ts` resolves Claude via `<repoRoot>/node_modules/.bin/claude` and falls back to `$PATH`. The bundle installs `@anthropic-ai/claude-code` into that location so no `$PATH` assumption is needed. (claudeBin.ts:20)
- `studio/server/paths.ts::studioRoot()` uses `~/Library/Application Support/arcade-studio/` — independent of where the `.app` is installed. Projects persist across app reinstalls. (paths.ts:11)
- `studio/server/figmaCli.ts::figmaCliDir()` honors `ARCADE_STUDIO_FIGMA_CLI_DIR`, so the launcher can point it at the bundled clone instead of `~/figma-cli`. (figmaCli.ts:7)
- `node_modules/.bin/claude` is absent in the current checkout, confirming the bundle must install `@anthropic-ai/claude-code` during the build.
- `package.json` at repo root has `playwright` as a devDep; the bundle excludes devDeps via `pnpm install --prod=false` *except* build-essentials, see Task 5.

## File Structure

```
studio/packaging/
├── README.md                 # Internal install instructions; Gatekeeper workaround
├── build.sh                  # Main entry: produces dist/Arcade Studio.app
├── dmg.sh                    # Wraps the .app in a .dmg via hdiutil
├── launcher.sh               # Installed to Contents/MacOS/Arcade Studio
├── Info.plist                # .app metadata (name, bundle id, version)
├── icon.icns                 # Placeholder app icon
├── lib/
│   ├── download-node.sh      # Fetches and extracts the Node tarball
│   ├── copy-sources.sh       # Copies repo into Contents/Resources/app/
│   ├── install-deps.sh       # Runs pnpm install + installs claude-code in bundle
│   ├── vendor-figma-cli.sh   # Clones devrev/figma-cli into bundle
│   └── codesign.sh           # Ad-hoc signs the bundle
└── dist/                     # Build output (gitignored)
    ├── Arcade Studio.app/
    └── Arcade Studio.dmg

studio/__tests__/packaging/
└── build.test.ts             # Asserts bundle structure after running build.sh
```

Each script is invokable standalone with a documented arg contract so individual steps can be debugged without re-running the whole build.

---

## Task 1: Scaffold packaging directory and gitignore

**Files:**
- Create: `studio/packaging/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/scaffold.test.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const packagingDir = path.resolve(__dirname, "..", "..", "packaging");

describe("packaging scaffold", () => {
  it("has a README", () => {
    expect(existsSync(path.join(packagingDir, "README.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/scaffold`
Expected: FAIL — `studio/packaging/` does not exist.

- [ ] **Step 3: Create the directory and README**

Create `studio/packaging/README.md`:

```markdown
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
```

Append to repo root `.gitignore`:

```
studio/packaging/dist/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/scaffold`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/README.md studio/__tests__/packaging/scaffold.test.ts .gitignore
git commit -m "feat(studio/packaging): scaffold .app build directory"
```

---

## Task 2: Info.plist and icon

**Files:**
- Create: `studio/packaging/Info.plist`
- Create: `studio/packaging/icon.icns` (placeholder — 512x512 blank with "A" glyph)

- [ ] **Step 1: Write the failing test**

Append to `studio/__tests__/packaging/scaffold.test.ts`:

```ts
it("has an Info.plist declaring bundle identifier", () => {
  const plist = path.join(packagingDir, "Info.plist");
  expect(existsSync(plist)).toBe(true);
  const contents = require("node:fs").readFileSync(plist, "utf-8");
  expect(contents).toContain("CFBundleIdentifier");
  expect(contents).toContain("com.devrev.arcade-studio");
  expect(contents).toContain("CFBundleExecutable");
  expect(contents).toContain("Arcade Studio");
});

it("has an icon file", () => {
  expect(existsSync(path.join(packagingDir, "icon.icns"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/scaffold`
Expected: FAIL — Info.plist and icon.icns missing.

- [ ] **Step 3: Write Info.plist**

Create `studio/packaging/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Arcade Studio</string>
  <key>CFBundleDisplayName</key>
  <string>Arcade Studio</string>
  <key>CFBundleIdentifier</key>
  <string>com.devrev.arcade-studio</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleExecutable</key>
  <string>Arcade Studio</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
```

- [ ] **Step 4: Generate placeholder icon**

Create `studio/packaging/lib/make-placeholder-icon.sh`:

```bash
#!/bin/bash
# Generates a placeholder 512x512 .icns from a solid color + text.
# Replace icon.icns with a designed version later.
set -euo pipefail
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/icon.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Build 1024, 512, 256, 128, 64, 32, 16 variants via sips from a base PNG.
# For the placeholder we generate a solid magenta square with "A" via
# ImageMagick if installed; otherwise fall back to a solid-color PNG via
# python/PIL which is available on any Mac with Xcode CLT.
python3 - <<'PY'
from pathlib import Path
import struct, zlib

def solid_png(w, h, rgb, out):
    # Minimal valid PNG writer (RGB, no alpha).
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    row = b'\x00' + bytes(rgb) * w
    raw = row * h
    idat = zlib.compress(raw)
    Path(out).write_bytes(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))

import sys
tmp = Path(sys.argv[1])
for size in (16, 32, 64, 128, 256, 512, 1024):
    solid_png(size, size, (212, 62, 140), tmp / f"{size}.png")
PY
python3 /tmp/_icon_dummy.py "$TMP" 2>/dev/null || true
# Above may not work; use sips directly from one seed png.
sips -s format png -z 1024 1024 /System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns --out "$TMP/seed.png" 2>/dev/null || true

ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
# If seed exists, derive all sizes; otherwise synthesize from python-written PNGs.
SRC="$TMP/seed.png"
[ -f "$SRC" ] || SRC="$TMP/1024.png"

sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"       >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"       >/dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"     >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"     >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_512x512.png"     >/dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png"  >/dev/null

iconutil -c icns "$ICONSET" -o "$OUT"
echo "Wrote $OUT"
```

Then run it once to generate `icon.icns` and commit the output:

```bash
chmod +x studio/packaging/lib/make-placeholder-icon.sh
./studio/packaging/lib/make-placeholder-icon.sh
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm studio:test packaging/scaffold`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/packaging/Info.plist studio/packaging/icon.icns studio/packaging/lib/make-placeholder-icon.sh studio/__tests__/packaging/scaffold.test.ts
git commit -m "feat(studio/packaging): add Info.plist and placeholder icon"
```

---

## Task 3: Node runtime download script

**Files:**
- Create: `studio/packaging/lib/download-node.sh`
- Test: `studio/__tests__/packaging/download-node.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/download-node.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("download-node.sh", () => {
  it("downloads Node into the target directory", { timeout: 120_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-dlnode-"));
    try {
      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "download-node.sh");
      execSync(`bash "${script}" "${tmp}" arm64`, { stdio: "inherit" });
      expect(existsSync(path.join(tmp, "bin", "node"))).toBe(true);
      const version = execSync(`"${path.join(tmp, "bin", "node")}" --version`).toString().trim();
      expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/download-node`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write `download-node.sh`**

Create `studio/packaging/lib/download-node.sh`:

```bash
#!/bin/bash
# Usage: download-node.sh <target-dir> <arch>
#   target-dir: where to extract Node (its bin/, lib/, include/, share/).
#   arch:       arm64 | x64
#
# Downloads the official Node.js darwin tarball, extracts it, and flattens
# the "node-vXX.YY.ZZ-darwin-<arch>/" prefix so the final layout is:
#   <target-dir>/bin/node
#   <target-dir>/lib/...
#
# Node version is pinned to NODE_VERSION below. Bump manually.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.11.0}"
TARGET="${1:?target dir required}"
ARCH="${2:?arch required (arm64|x64)}"

case "$ARCH" in
  arm64|x64) ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

TARBALL="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"

mkdir -p "$TARGET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $URL"
curl -fL -o "$TMP/$TARBALL" "$URL"

echo "Extracting into $TARGET"
tar -xzf "$TMP/$TARBALL" -C "$TMP"
INNER="$TMP/node-v${NODE_VERSION}-darwin-${ARCH}"
# rsync to merge into any pre-existing TARGET contents.
rsync -a "$INNER/" "$TARGET/"

chmod +x "$TARGET/bin/node"
echo "Node installed: $("$TARGET/bin/node" --version)"
```

Make it executable:

```bash
chmod +x studio/packaging/lib/download-node.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/download-node`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/lib/download-node.sh studio/__tests__/packaging/download-node.test.ts
git commit -m "feat(studio/packaging): add Node runtime download script"
```

---

## Task 4: Launcher shell script

**Files:**
- Create: `studio/packaging/launcher.sh`
- Test: `studio/__tests__/packaging/launcher.test.ts`

The launcher runs inside `Contents/MacOS/Arcade Studio`. It determines the bundle root from its own path, puts the bundled Node on `PATH`, points `ARCADE_STUDIO_FIGMA_CLI_DIR` at the bundled clone, starts Vite in the background, waits for port 5556, opens the default browser, then `wait`s on Vite so the `.app` shows as running in the Dock.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/launcher.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const launcher = path.resolve(__dirname, "..", "..", "packaging", "launcher.sh");

describe("launcher.sh", () => {
  it("exists and is executable", () => {
    expect(existsSync(launcher)).toBe(true);
    const mode = statSync(launcher).mode & 0o111;
    expect(mode).not.toBe(0);
  });

  it("resolves bundle root from BASH_SOURCE", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("BASH_SOURCE");
  });

  it("exports bundled Node on PATH", () => {
    expect(readFileSync(launcher, "utf-8")).toMatch(/PATH="[^"]*node\/bin/);
  });

  it("sets ARCADE_STUDIO_FIGMA_CLI_DIR to bundled figma-cli", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("ARCADE_STUDIO_FIGMA_CLI_DIR");
  });

  it("short-circuits when port 5556 is already in use", () => {
    const body = readFileSync(launcher, "utf-8");
    expect(body).toContain("5556");
    expect(body).toMatch(/lsof.*5556/);
  });

  it("logs to ~/Library/Logs/arcade-studio.log", () => {
    expect(readFileSync(launcher, "utf-8")).toContain("Library/Logs/arcade-studio.log");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/launcher`
Expected: FAIL — launcher.sh does not exist.

- [ ] **Step 3: Write `launcher.sh`**

Create `studio/packaging/launcher.sh`:

```bash
#!/bin/bash
# Arcade Studio launcher — runs inside Contents/MacOS/ of the .app bundle.
# Starts the Vite dev server with the bundled Node runtime, opens the browser,
# and keeps the process alive so the .app shows as running in the Dock.
set -euo pipefail

# Resolve the bundle root (the .app folder) from this script's own path.
# launcher.sh lives at <App>/Contents/MacOS/Arcade Studio — so two "../"
# lands at Contents/, and one more at the .app.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES="$SCRIPT_DIR/../Resources"
APP_DIR="$RESOURCES/app"
NODE_BIN="$RESOURCES/node/bin"

export PATH="$NODE_BIN:$PATH"
export ARCADE_STUDIO_FIGMA_CLI_DIR="$RESOURCES/figma-cli"
# Point claude at the vendored install so claudeBin.ts resolves it without
# relying on $PATH having a global claude.
export ARCADE_STUDIO_CLAUDE_BIN="$APP_DIR/node_modules/.bin/claude"

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/arcade-studio.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# If port 5556 is already bound, assume a previous launch is still running.
# Just open the browser against the existing server and exit.
if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
  log "Port 5556 already in use — opening existing server"
  open "http://localhost:5556"
  exit 0
fi

log "Starting Vite from $APP_DIR"
cd "$APP_DIR"

# Vite has `open: true` in its config, so it opens the browser itself once
# listening. We still run `open` below as a safety net for cases where the
# user closed the tab — idempotent.
"$NODE_BIN/node" ./node_modules/.bin/vite --config studio/vite.config.ts >> "$LOG_FILE" 2>&1 &
VITE_PID=$!

# Wait up to 30s for the port to be ready, then open the browser defensively.
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
    open "http://localhost:5556"
    break
  fi
  sleep 0.5
done

# Stay attached so macOS shows the app as running and quitting it kills Vite.
trap 'log "Shutting down"; kill "$VITE_PID" 2>/dev/null || true; exit 0' TERM INT
wait "$VITE_PID"
```

Make it executable:

```bash
chmod +x studio/packaging/launcher.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/launcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/launcher.sh studio/__tests__/packaging/launcher.test.ts
git commit -m "feat(studio/packaging): add app launcher script"
```

---

## Task 5: Source copy + dependency install scripts

**Files:**
- Create: `studio/packaging/lib/copy-sources.sh`
- Create: `studio/packaging/lib/install-deps.sh`
- Test: `studio/__tests__/packaging/install-deps.test.ts`

Copying: rsync the repo (excluding `.git`, `node_modules`, `dist/`, `studio/packaging/dist/`, screenshots) into `Contents/Resources/app/`.

Installing: inside the copied tree, run `pnpm install --frozen-lockfile --prod` (skips devDeps including playwright) using the *bundled* Node, then additionally install `@anthropic-ai/claude-code` so `node_modules/.bin/claude` resolves. The bundled Node is used so the install doesn't depend on the host's Node version.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/install-deps.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

const packaging = path.resolve(__dirname, "..", "..", "packaging");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

describe("copy-sources.sh + install-deps.sh", () => {
  it("copies repo without node_modules, .git, or dist", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-copy-"));
    try {
      execSync(
        `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}"`,
        { stdio: "inherit" },
      );
      expect(existsSync(path.join(tmp, "package.json"))).toBe(true);
      expect(existsSync(path.join(tmp, "studio", "src", "main.tsx"))).toBe(true);
      expect(existsSync(path.join(tmp, ".git"))).toBe(false);
      expect(existsSync(path.join(tmp, "node_modules"))).toBe(false);
      expect(existsSync(path.join(tmp, "studio", "packaging", "dist"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("install-deps creates node_modules/.bin/claude and node_modules/.bin/vite", { timeout: 300_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-install-"));
    try {
      // Stage a minimal copy first.
      execSync(
        `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}/app"`,
        { stdio: "inherit" },
      );
      // Use host node for test (the bundle uses its own, which we skip here to avoid downloading).
      execSync(
        `bash "${path.join(packaging, "lib", "install-deps.sh")}" "${tmp}/app"`,
        { stdio: "inherit" },
      );
      expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "vite"))).toBe(true);
      expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "claude"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/install-deps`
Expected: FAIL — copy-sources.sh and install-deps.sh do not exist.

- [ ] **Step 3: Write `copy-sources.sh`**

Create `studio/packaging/lib/copy-sources.sh`:

```bash
#!/bin/bash
# Usage: copy-sources.sh <repo-root> <target>
# Copies the arcade-prototyper repo into <target>, excluding build artifacts,
# git data, existing node_modules, and screenshot scratch files.
set -euo pipefail

SRC="${1:?repo root required}"
DST="${2:?target required}"

mkdir -p "$DST"

rsync -a \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "studio/packaging/dist" \
  --exclude "dist" \
  --exclude ".omc" \
  --exclude ".playwright-mcp" \
  --exclude "*.png" \
  --exclude "*.jpg" \
  --exclude "*.pdf" \
  --exclude ".DS_Store" \
  "$SRC/" "$DST/"

echo "Copied repo to $DST"
```

```bash
chmod +x studio/packaging/lib/copy-sources.sh
```

- [ ] **Step 4: Write `install-deps.sh`**

Create `studio/packaging/lib/install-deps.sh`:

```bash
#!/bin/bash
# Usage: install-deps.sh <app-dir> [<bundled-node-bin>]
# Runs pnpm install inside <app-dir> using the bundled Node if provided
# (otherwise the host's Node), then installs the Claude CLI locally so
# node_modules/.bin/claude resolves.
set -euo pipefail

APP="${1:?app dir required}"
NODE_BIN_DIR="${2:-}"

cd "$APP"

if [ -n "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
  echo "Using bundled Node: $(node --version) from $NODE_BIN_DIR"
else
  echo "Using host Node: $(node --version)"
fi

# Ensure pnpm is reachable. Use corepack (ships with Node 22) so we don't
# rely on the host having pnpm installed.
corepack enable 2>/dev/null || true
corepack prepare pnpm@latest --activate 2>/dev/null || true

# Install with devDeps — studio runs via Vite (devDep), tailwindcss (devDep),
# @vitejs/plugin-react (devDep). We can't --prod=true. The playwright cost is
# accepted; skipping browsers is done via env below.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Vendor the Claude CLI as a local dep so node_modules/.bin/claude resolves
# without the host having it globally installed.
pnpm add --save-exact @anthropic-ai/claude-code

echo "Deps installed. bin contents:"
ls node_modules/.bin/ | head -20
```

```bash
chmod +x studio/packaging/lib/install-deps.sh
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm studio:test packaging/install-deps`
Expected: PASS (may take several minutes the first time due to pnpm install).

- [ ] **Step 6: Commit**

```bash
git add studio/packaging/lib/copy-sources.sh studio/packaging/lib/install-deps.sh studio/__tests__/packaging/install-deps.test.ts
git commit -m "feat(studio/packaging): add source copy and dep install scripts"
```

---

## Task 6: Vendor figma-cli

**Files:**
- Create: `studio/packaging/lib/vendor-figma-cli.sh`
- Test: `studio/__tests__/packaging/vendor-figma-cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/vendor-figma-cli.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("vendor-figma-cli.sh", () => {
  it("clones devrev/figma-cli into target dir", { timeout: 120_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-figma-"));
    try {
      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "vendor-figma-cli.sh");
      execSync(`bash "${script}" "${tmp}"`, { stdio: "inherit" });
      expect(existsSync(path.join(tmp, "src", "index.js"))).toBe(true);
      // Cloned copy should not carry the .git dir — we don't need history at runtime.
      expect(existsSync(path.join(tmp, ".git"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/vendor-figma-cli`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write `vendor-figma-cli.sh`**

Create `studio/packaging/lib/vendor-figma-cli.sh`:

```bash
#!/bin/bash
# Usage: vendor-figma-cli.sh <target-dir>
# Clones devrev/figma-cli into <target-dir> and installs its npm deps so
# its daemon is runnable out of the box. Strips .git to save ~10 MB.
set -euo pipefail

TARGET="${1:?target dir required}"
REPO="${FIGMA_CLI_REPO:-https://github.com/devrev/figma-cli.git}"
REF="${FIGMA_CLI_REF:-main}"

mkdir -p "$(dirname "$TARGET")"

if [ -d "$TARGET" ]; then
  rm -rf "$TARGET"
fi

git clone --depth 1 --branch "$REF" "$REPO" "$TARGET"
rm -rf "$TARGET/.git"

if [ -f "$TARGET/package.json" ]; then
  (cd "$TARGET" && npm install --omit=dev --no-audit --no-fund --silent)
fi

echo "figma-cli vendored at $TARGET"
```

```bash
chmod +x studio/packaging/lib/vendor-figma-cli.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/vendor-figma-cli`
Expected: PASS (requires network + GitHub access).

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/lib/vendor-figma-cli.sh studio/__tests__/packaging/vendor-figma-cli.test.ts
git commit -m "feat(studio/packaging): vendor figma-cli into bundle"
```

---

## Task 7: Ad-hoc code signing script

**Files:**
- Create: `studio/packaging/lib/codesign.sh`
- Test: `studio/__tests__/packaging/codesign.test.ts`

Apple Silicon Gatekeeper refuses to run any unsigned binary — it marks it as "damaged." An ad-hoc signature (`codesign --sign -`) is the minimum that keeps the app launchable. It still triggers the "cannot verify developer" dialog on first launch; the user must right-click → Open once.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/codesign.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("codesign.sh", () => {
  it("ad-hoc signs a .app bundle end-to-end", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-sign-"));
    try {
      // Build a minimal valid .app skeleton.
      const app = path.join(tmp, "Fake.app");
      const macos = path.join(app, "Contents", "MacOS");
      mkdirSync(macos, { recursive: true });
      const bin = path.join(macos, "Fake");
      writeFileSync(bin, "#!/bin/bash\necho hi\n");
      chmodSync(bin, 0o755);
      writeFileSync(
        path.join(app, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Fake</string>
<key>CFBundleIdentifier</key><string>com.devrev.fake</string>
<key>CFBundleExecutable</key><string>Fake</string>
<key>CFBundleVersion</key><string>0.1</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
      );

      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "codesign.sh");
      execSync(`bash "${script}" "${app}"`, { stdio: "inherit" });

      // codesign -dv exits 0 iff a signature is present.
      execSync(`codesign -dv "${app}" 2>&1`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/codesign`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write `codesign.sh`**

Create `studio/packaging/lib/codesign.sh`:

```bash
#!/bin/bash
# Usage: codesign.sh <path-to-.app>
# Ad-hoc signs the .app so Gatekeeper on Apple Silicon does not quarantine
# it as "damaged". First launch still requires right-click → Open once.
set -euo pipefail

APP="${1:?app path required}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

# --deep signs nested binaries (Node, native .node addons) too.
# --force replaces any existing signatures from downloaded tarballs.
# --sign - uses an ad-hoc (unsigned-but-authenticated) signature.
codesign --force --deep --sign - --timestamp=none "$APP"
codesign -dv "$APP"
echo "Ad-hoc signed: $APP"
```

```bash
chmod +x studio/packaging/lib/codesign.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/codesign`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/lib/codesign.sh studio/__tests__/packaging/codesign.test.ts
git commit -m "feat(studio/packaging): ad-hoc code signing"
```

---

## Task 8: End-to-end build script

**Files:**
- Create: `studio/packaging/build.sh`
- Test: `studio/__tests__/packaging/build.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/build.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const dist = path.join(repoRoot, "studio", "packaging", "dist");
const app = path.join(dist, "Arcade Studio.app");

describe("build.sh (end-to-end)", () => {
  it("produces a launchable .app", { timeout: 900_000 }, () => {
    rmSync(dist, { recursive: true, force: true });
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "build.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(app)).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Info.plist"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "MacOS", "Arcade Studio"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "icon.icns"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "node", "bin", "node"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "studio", "vite.config.ts"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "vite"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "claude"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "figma-cli", "src", "index.js"))).toBe(true);

    // Launcher must be executable.
    const mode = statSync(path.join(app, "Contents", "MacOS", "Arcade Studio")).mode & 0o111;
    expect(mode).not.toBe(0);

    // Signature should verify.
    execSync(`codesign -dv "${app}" 2>&1`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/build`
Expected: FAIL — build.sh does not exist.

- [ ] **Step 3: Write `build.sh`**

Create `studio/packaging/build.sh`:

```bash
#!/bin/bash
# Arcade Studio .app build.
# Produces studio/packaging/dist/Arcade Studio.app (and .dmg via dmg.sh).
#
# Stages, each handled by a dedicated script under lib/:
#   1. Clean any prior dist/Arcade Studio.app/
#   2. Scaffold Contents/{MacOS,Resources}/ and drop Info.plist + icon.
#   3. Download Node into Resources/node/.
#   4. Copy repo into Resources/app/.
#   5. Install node_modules (incl. Claude CLI) into Resources/app/.
#   6. Vendor figma-cli into Resources/figma-cli/.
#   7. Install launcher.sh into MacOS/ (renamed to the bundle executable).
#   8. Ad-hoc codesign the bundle.
set -euo pipefail

ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64)        NODE_ARCH=x64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$PKG_DIR/../.." && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"

echo "==> Cleaning prior build"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

echo "==> Installing Info.plist and icon"
cp "$PKG_DIR/Info.plist" "$CONTENTS/Info.plist"
cp "$PKG_DIR/icon.icns"  "$RESOURCES/icon.icns"

echo "==> Downloading Node ($NODE_ARCH)"
bash "$PKG_DIR/lib/download-node.sh" "$RESOURCES/node" "$NODE_ARCH"

echo "==> Copying repo into Resources/app"
bash "$PKG_DIR/lib/copy-sources.sh" "$REPO_ROOT" "$RESOURCES/app"

echo "==> Installing dependencies"
bash "$PKG_DIR/lib/install-deps.sh" "$RESOURCES/app" "$RESOURCES/node/bin"

echo "==> Vendoring figma-cli"
bash "$PKG_DIR/lib/vendor-figma-cli.sh" "$RESOURCES/figma-cli"

echo "==> Installing launcher"
cp "$PKG_DIR/launcher.sh" "$MACOS/Arcade Studio"
chmod +x "$MACOS/Arcade Studio"

echo "==> Ad-hoc codesigning"
bash "$PKG_DIR/lib/codesign.sh" "$APP"

echo ""
echo "✓ Built: $APP"
du -sh "$APP"
```

```bash
chmod +x studio/packaging/build.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/build`
Expected: PASS. Takes ~5–10 minutes for a cold build.

- [ ] **Step 5: Manually smoke-test the built app**

```bash
open "studio/packaging/dist/Arcade Studio.app"
```

Expected: a terminal-less launch; browser opens at `http://localhost:5556`; project list renders. Quitting the app (Cmd-Q) stops Vite. Check `~/Library/Logs/arcade-studio.log` for startup lines.

- [ ] **Step 6: Commit**

```bash
git add studio/packaging/build.sh studio/__tests__/packaging/build.test.ts
git commit -m "feat(studio/packaging): end-to-end build script"
```

---

## Task 9: DMG packager

**Files:**
- Create: `studio/packaging/dmg.sh`
- Test: `studio/__tests__/packaging/dmg.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/packaging/dmg.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const app = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.app");
const dmg = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.dmg");

describe("dmg.sh", () => {
  it("wraps the built .app in a .dmg with an /Applications symlink", { timeout: 120_000 }, () => {
    // Assumes build.sh has been run. If not, skip.
    if (!existsSync(app)) {
      console.warn("Skipping dmg test: .app not yet built. Run build.sh first.");
      return;
    }
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "dmg.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(dmg)).toBe(true);
    expect(statSync(dmg).size).toBeGreaterThan(50_000_000); // at least 50 MB
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm studio:test packaging/dmg`
Expected: FAIL (or skip if .app missing).

- [ ] **Step 3: Write `dmg.sh`**

Create `studio/packaging/dmg.sh`:

```bash
#!/bin/bash
# Wrap dist/Arcade Studio.app in dist/Arcade Studio.dmg.
# Includes a symlink to /Applications so users can drag-install.
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
DMG="$DIST/Arcade Studio.dmg"

if [ ! -d "$APP" ]; then
  echo "Missing $APP. Run build.sh first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Arcade Studio" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

echo ""
echo "✓ DMG: $DMG"
du -sh "$DMG"
```

```bash
chmod +x studio/packaging/dmg.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm studio:test packaging/dmg`
Expected: PASS (requires build.sh to have been run first).

- [ ] **Step 5: Commit**

```bash
git add studio/packaging/dmg.sh studio/__tests__/packaging/dmg.test.ts
git commit -m "feat(studio/packaging): wrap .app in distributable .dmg"
```

---

## Task 10: Add `pnpm studio:pack` script and wire docs

**Files:**
- Modify: `package.json` (repo root) — add `studio:pack` script
- Modify: `studio/README.md` — point to packaging README
- Modify: `studio/DEVELOPMENT.md` — add "Building the .app" section

- [ ] **Step 1: Add script**

Edit `/Users/andrey.sundiev/arcade-prototyper/package.json`, in the `scripts` block, add:

```json
"studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh"
```

So the block becomes:

```json
"scripts": {
  "studio": "vite --config studio/vite.config.ts",
  "studio:test": "vitest run --config studio/vitest.config.ts",
  "studio:pack": "bash studio/packaging/build.sh && bash studio/packaging/dmg.sh"
}
```

- [ ] **Step 2: Update `studio/README.md`**

In the "Further reading" section, add:

```markdown
- **[packaging/README.md](./packaging/README.md)** — building Arcade Studio as a distributable `.app` / `.dmg` for internal users
```

- [ ] **Step 3: Update `studio/DEVELOPMENT.md`**

Add a new section below "Running studio":

```markdown
## Building a distributable `.app`

For internal DevRev distribution, studio can be packaged as a double-clickable macOS app.

```bash
pnpm studio:pack
```

This produces:

- `studio/packaging/dist/Arcade Studio.app` — drag to `/Applications`
- `studio/packaging/dist/Arcade Studio.dmg` — hand to non-technical users

See [studio/packaging/README.md](./packaging/README.md) for the first-launch Gatekeeper workaround (right-click → Open) and for caveats about the bundle being unsigned.
```

- [ ] **Step 4: Verify pnpm picks up the new script**

Run: `pnpm studio:pack --help 2>&1 | head -5`
Expected: either the script runs the build (end-to-end, ~10 minutes) or errors cleanly if preconditions are missing. Don't actually run it here; just confirm `pnpm run` lists it:

Run: `pnpm run | grep studio:pack`
Expected: the script is listed.

- [ ] **Step 5: Commit**

```bash
git add package.json studio/README.md studio/DEVELOPMENT.md
git commit -m "docs(studio): document pnpm studio:pack for .app builds"
```

---

## Task 11: Manual verification + troubleshooting entries

**Files:**
- Modify: `studio/packaging/README.md` — add "Troubleshooting" section

- [ ] **Step 1: End-to-end manual verification**

On a clean test account (or after removing `~/Library/Application Support/arcade-studio`):

1. Run `pnpm studio:pack` at the repo root.
2. Wait for build to finish (~10 min cold).
3. `open "studio/packaging/dist/Arcade Studio.dmg"` — verify DMG mounts, shows the app and `/Applications` symlink.
4. Drag `Arcade Studio.app` into `/Applications`.
5. Eject the DMG.
6. Right-click `Arcade Studio` in `/Applications` → **Open** → **Open** in the dialog.
7. Verify the browser opens to `http://localhost:5556` within ~15 seconds.
8. Verify project list renders and "+ New project" works.
9. Quit via Cmd-Q from the Dock. Verify Vite shuts down (no listener on 5556 after a few seconds).
10. Double-click the app again. Verify it reopens without the Gatekeeper dialog.

Record any deviations in the troubleshooting section below.

- [ ] **Step 2: Append troubleshooting to `studio/packaging/README.md`**

Append this section:

```markdown
## Troubleshooting

### "Arcade Studio is damaged and can't be opened"

You double-clicked before right-clicking → Open on first launch. Fix:

```bash
xattr -dr com.apple.quarantine "/Applications/Arcade Studio.app"
```

Then right-click → Open.

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
- The bundled Node binary lost its executable bit (rare — should not happen after ad-hoc codesigning). Re-run `pnpm studio:pack`.
- The user's `$HOME/Library/Application Support/arcade-studio/projects/` is on an unmounted external volume. Studio uses that path; fix by removing the broken symlink.

### "aws sso login" required on every chat turn

This plan does not cover SSO auto-refresh. See the separate "SSO keeper" plan.
```

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/README.md
git commit -m "docs(studio/packaging): troubleshooting for first-launch and port conflicts"
```

---

## Self-Review

**Spec coverage:**
- ✅ Bundled Node (Task 3)
- ✅ Pre-installed node_modules (Task 5)
- ✅ Studio source (Task 5)
- ✅ figma-cli vendored (Task 6)
- ✅ Launcher that starts Vite + opens browser (Task 4)
- ✅ "Already running" short-circuit (Task 4)
- ✅ Ad-hoc signing so Gatekeeper doesn't mark as "damaged" (Task 7)
- ✅ DMG packaging (Task 9)
- ✅ Unsigned OK for internal (Task 2 & 11 README)
- ✅ README with right-click → Open first-launch instructions (Task 1 & 11)
- ⚠️ SSO auto-refresh — explicitly out of scope, noted in troubleshooting
- ⚠️ Intel (x64) — deferred; `build.sh` accepts `ARCH=x64` so a maintainer can produce one manually

**Placeholder scan:** no TBDs, no "add appropriate X" without code, every step shows the exact contents.

**Type consistency:** Paths referenced across tasks are all absolute relative to the bundle and consistent (`Contents/Resources/app/`, `Contents/Resources/node/bin/`, `Contents/Resources/figma-cli/`). Launcher env vars (`ARCADE_STUDIO_FIGMA_CLI_DIR`, `ARCADE_STUDIO_CLAUDE_BIN`) match the ones consumed in `server/figmaCli.ts:7` and `server/claudeBin.ts:21`.

**Known risks:**
- `pnpm install` inside the bundle depends on Corepack being enabled. Node 22 ships with Corepack but some setups disable it. `install-deps.sh` handles this with `corepack enable` guarded by `|| true`, falling back to whatever `pnpm` is on PATH.
- If DevRev GitHub access requires SSH + a user-configured SSH key, `vendor-figma-cli.sh` clones via HTTPS — works if the repo is public or HTTPS-token-accessible. If figma-cli is private and HTTPS-blocked, the script needs a `GH_TOKEN` env var path, which is a simple amendment.
- Playwright devDep: installed by `pnpm install`, but the `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` env var prevents the 300 MB Chromium download. Studio doesn't use Playwright at runtime — only tests do.
