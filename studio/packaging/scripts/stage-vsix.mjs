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
// Explicitly include node_modules via the files field (overrides vsce's built-in exclusion).
extPkg.files = ["dist", "bin", "studio", "prototype-kit", "aws-cli", "node_modules"];
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
//    Negation patterns require the dir itself to be negated first, then its contents.
fs.copyFileSync(extPkgPath, path.join(stage, "package.json"));
const vscodeignore = `# VSIX .vscodeignore — keep runtime deps, exclude dev artifacts.
!node_modules
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

// Copy prototype-kit (no symlinks, cpSync is fine)
const prototypeKitSrc = path.join(repoRoot, "prototype-kit");
if (fs.existsSync(prototypeKitSrc)) {
  fs.cpSync(prototypeKitSrc, path.join(stage, "prototype-kit"), { recursive: true });
}

// Copy node_modules with rsync -L to dereference pnpm's symlink forest.
// pnpm's node_modules are symlinks into .pnpm/ store (absolute paths outside the
// staging dir); cpSync copies them verbatim → vsce excludes broken links → VSIX
// is missing runtime deps. rsync -L resolves them into real files.
//
// Strategy: copy individual top-level packages we need (not the whole tree with
// excludes, which is complex and risks missing transitive deps). Explicit list
// ensures we only ship runtime deps.
const nodeModulesSrc = path.join(repoRoot, "node_modules");
if (fs.existsSync(nodeModulesSrc)) {
  const nodeModulesDest = path.join(stage, "node_modules");
  fs.mkdirSync(nodeModulesDest, { recursive: true });

  // Runtime dependencies (server + kit + figmanage).
  const runtimePackages = [
    "vite", "esbuild", "@tailwindcss", "tailwindcss", "react", "react-dom",
    "react-day-picker", "react-markdown", "@xorkavi", "figmanage",
    "@sentry", "posthog-js", "posthog-node", "@vitejs", "chokidar", "ws", "yaml",
    "zod", "concurrently", ".pnpm", ".bin", ".modules.yaml", ".pnpm-workspace-state-v1.json"
  ];

  console.log(`[stage-vsix] Copying runtime node_modules via rsync...`);
  const rsyncArgs = ["-aL"]; // -L = transform symlinks into referents
  for (const pkg of runtimePackages) {
    const src = path.join(nodeModulesSrc, pkg);
    if (fs.existsSync(src)) rsyncArgs.push(src);
  }
  rsyncArgs.push(`${nodeModulesDest}/`);

  execFileSync("rsync", rsyncArgs, { stdio: "inherit" });
  console.log(`[stage-vsix] rsync complete (${runtimePackages.length} packages)`);
} else {
  console.warn(`[stage-vsix] WARNING: node_modules not found at ${nodeModulesSrc}`);
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
//    Run vsce from the repo root's node_modules (the staging dir's node_modules
//    excludes vsce since it's dev-only), but operate on the staging dir.
fs.mkdirSync(dist, { recursive: true });
const vscebin = path.join(repoRoot, "node_modules/.bin/vsce");
execFileSync(vscebin, ["package", "--no-dependencies",
  "--out", path.join(dist, `arcade-prototyper-${rootPkg.version}.vsix`)],
  { cwd: stage, stdio: "inherit" });

console.log(`✓ VSIX written to ${dist}/arcade-prototyper-${rootPkg.version}.vsix`);
