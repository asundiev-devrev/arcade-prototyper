// studio/packaging/scripts/stage-vsix.mjs
// Assembles the VSIX staging dir, syncs the version from the repo-root
// package.json into extension/package.json, then runs `vsce package`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const stage = path.join(repoRoot, "studio/packaging/vsix-stage");
const dist = path.join(repoRoot, "studio/packaging/dist");

// 1. Sync version (single source of truth = root package.json).
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const extPkgPath = path.join(repoRoot, "extension/package.json");
const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf-8"));
extPkg.version = rootPkg.version;
fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");

// 2. Reset staging dir.
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 3. Bundle the extension with esbuild (inlines electron imports to avoid
//    runtime path mismatches — extension/dist imports from ../../electron/...
//    which after staging would resolve to the wrong path).
const bundleOut = path.join(stage, "dist");
fs.mkdirSync(bundleOut, { recursive: true });
await build({
  entryPoints: [path.join(repoRoot, "extension/src/extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(bundleOut, "extension.js"),
  external: ["vscode"],
  sourcemap: false,
  minify: false,
});

// 4. Copy the extension manifest to the staging ROOT.
//    Write a custom .vscodeignore that KEEPS node_modules (vsce excludes it by default).
fs.copyFileSync(extPkgPath, path.join(stage, "package.json"));
const vscodeignore = `# VSIX .vscodeignore — keep runtime deps, exclude dev artifacts.
!node_modules/**
studio/packaging/**
studio/__tests__/**
studio/tmp/**
**/*.test.*
**/*.map
`;
fs.writeFileSync(path.join(stage, ".vscodeignore"), vscodeignore);

// 5. Copy the shared core beside dist/ so serverHost's appRoot resolves.
//    For studio/, we need to exclude the packaging dir to avoid copying into self.
//    Copy individual subdirs of studio/ rather than the whole tree.
const studioDest = path.join(stage, "studio");
fs.mkdirSync(studioDest, { recursive: true });
const studioSrc = path.join(repoRoot, "studio");
const studioContents = fs.readdirSync(studioSrc);
for (const item of studioContents) {
  if (item === "packaging") continue; // skip packaging to avoid self-copy
  const itemSrc = path.join(studioSrc, item);
  const itemDest = path.join(studioDest, item);
  const stat = fs.statSync(itemSrc);
  if (stat.isDirectory()) {
    fs.cpSync(itemSrc, itemDest, { recursive: true });
  } else {
    fs.copyFileSync(itemSrc, itemDest);
  }
}

for (const dir of ["prototype-kit", "node_modules"]) {
  const src = path.join(repoRoot, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, dir), { recursive: true });
}
// electron imports are now bundled into dist/extension.js — no separate copy needed.

// 6. Assemble the staged bin/ from RAW sources (not from a pre-built .app —
//    avoids requiring a full studio:pack first, and lets us swap the
//    Electron-dependent figmanage wrapper for a VSIX-native one).
const binDir = path.join(stage, "bin");
fs.mkdirSync(binDir, { recursive: true });

//    claude: the macOS binary ships in node_modules as claude.exe (that IS the
//    mac executable in this repo). Stage it as `bin/claude` (matches
//    ARCADE_STUDIO_CLAUDE_BIN + figmaCli/chat spawn names).
fs.copyFileSync(
  path.join(repoRoot, "node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
  path.join(binDir, "claude"),
);
fs.chmodSync(path.join(binDir, "claude"), 0o755);

//    figmanage: the DESKTOP wrapper (electron/bin/figmanage) exec's the
//    Electron .app binary (Contents/MacOS/Arcade Studio) — which does NOT
//    exist in a VSIX. Write a VSIX-native wrapper that runs figmanage's JS
//    entry via the host editor's node binary (ARCADE_NODE_BIN, set by
//    serverHost to process.execPath, with ELECTRON_RUN_AS_NODE=1). The entry
//    resolves inside the staged node_modules copied in step 5.
// NOTE: written as a JS template literal — every shell `$` is escaped `\$`
// so it stays literal in the emitted file (no JS interpolation).
const figmanageWrapper = `#!/bin/sh
# VSIX-native figmanage wrapper. Runs figmanage's JS entry under the host
# editor's Electron-as-node runtime (ARCADE_NODE_BIN). Unlike the desktop
# build there is no Arcade .app to exec, so we use the host's node binary.
set -e
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
EXT_ROOT="\$(cd "\$SCRIPT_DIR/.." && pwd)"
FIGMANAGE_ENTRY="\$EXT_ROOT/node_modules/figmanage/dist/index.js"
exec env ELECTRON_RUN_AS_NODE=1 "\${ARCADE_NODE_BIN:-node}" "\$FIGMANAGE_ENTRY" "\$@"
`;
fs.writeFileSync(path.join(binDir, "figmanage"), figmanageWrapper);
fs.chmodSync(path.join(binDir, "figmanage"), 0o755);

//    aws CLI v2 expanded layout (nested aws-cli/aws per fetch-cli-deps.sh).
fs.cpSync(path.join(repoRoot, "studio/packaging/aws-cli"), path.join(stage, "aws-cli"), { recursive: true });
// cloudflared intentionally NOT staged (share out of scope for v1).

// 7. Package with --no-dependencies (we supply node_modules manually).
fs.mkdirSync(dist, { recursive: true });
execFileSync("pnpm", ["exec", "vsce", "package", "--no-dependencies",
  "--out", path.join(dist, `arcade-prototyper-${rootPkg.version}.vsix`)],
  { cwd: stage, stdio: "inherit" });

console.log(`✓ VSIX written to ${dist}/arcade-prototyper-${rootPkg.version}.vsix`);
