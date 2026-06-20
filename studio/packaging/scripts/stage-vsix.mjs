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
// Do NOT set a `files` allowlist. vsce force-excludes node_modules from a
// `files` list (the pattern then matches nothing → hard error), and `files`
// can't be combined with a .vscodeignore. Instead we rely on vsce's DEFAULT
// inclusion: it walks the flat node_modules and packs it (verified: 35k+
// entries incl vite/figmanage/react). That walk works here only because we
// staged a HOISTED real-file node_modules below — pnpm's normal symlink tree
// would break vsce's dependency detection. A .vscodeignore (written in step 4)
// trims dev artifacts.
delete extPkg.files;
fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");

// 2. Reset staging dir. Use `rm -rf` (not fs.rmSync) because a prior run may
//    have left a materialized node_modules whose pnpm-store hardlinks are
//    read-only — fs.rmSync trips ENOTEMPTY on those, rm -rf handles them.
if (fs.existsSync(stage)) {
  execFileSync("rm", ["-rf", stage], { stdio: "inherit" });
}
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

// 4. Copy the extension manifest to the staging ROOT, plus a .vscodeignore that
//    trims dev artifacts. With no `files` field (step 1), vsce's default
//    inclusion packs the whole staging tree — including the hoisted
//    node_modules — and this .vscodeignore subtracts what we don't want. (We
//    also skip __tests__/tmp at copy time below, so this is belt-and-braces.)
fs.copyFileSync(extPkgPath, path.join(stage, "package.json"));
fs.writeFileSync(
  path.join(stage, ".vscodeignore"),
  ["**/*.map", "studio/__tests__/**", "studio/tmp/**", "**/*.test.*", ""].join("\n"),
);

// 5. Copy the shared core beside dist/ so serverHost's appRoot resolves.
//    Skip studio/packaging (self-copy) and dev-only dirs that bloat the VSIX.
const STUDIO_SKIP = new Set(["packaging", "__tests__", "tmp"]);
const studioDest = path.join(stage, "studio");
fs.mkdirSync(studioDest, { recursive: true });
const studioSrc = path.join(repoRoot, "studio");
const studioContents = fs.readdirSync(studioSrc);
for (const item of studioContents) {
  if (STUDIO_SKIP.has(item)) continue;
  const itemSrc = path.join(studioSrc, item);
  const itemDest = path.join(studioDest, item);
  const stat = fs.statSync(itemSrc);
  if (stat.isDirectory()) {
    fs.cpSync(itemSrc, itemDest, { recursive: true });
  } else {
    fs.copyFileSync(itemSrc, itemDest);
  }
}

// NOTE: prototype-kit is NOT copied separately — it lives at studio/prototype-kit/
// and is already staged inside the studio/ tree above (the repo has no
// repo-root prototype-kit/ dir).

// Stage node_modules via a HOISTED PRODUCTION install, not a copy.
//
// Why not copy the repo's node_modules: pnpm lays it out as a symlink forest
// into the .pnpm/ store (absolute paths outside the staging dir). vsce strips
// symlinks, so a verbatim copy ships broken links (missing runtime deps), and
// dereferencing the whole tree explodes to 3-6 GB (resolving pnpm's dedup
// symlinks quadruples size and drags in devDependencies).
//
// Instead, ask pnpm to materialize the PRODUCTION dependency closure as a flat,
// real-file tree with the hoisted linker: deduped, transitive deps included,
// devDependencies skipped, no top-level symlinks for vsce to drop. All of the
// server/kit/figmanage runtime deps live in `dependencies` (not devDeps), so
// --prod is correct — including esbuild, which the cloudflare bundler imports
// eagerly at server boot (it must be a declared dependency, not just a
// transitive edge of vite). Reuses the local store (no network). ~638 MB, ~7 s.
// A final rsync -aL flattens the handful of nested symlinks pnpm still leaves.
// --ignore-scripts is safe: esbuild ships its platform binary via the
// optionalDependency @esbuild/<platform> (selected at install, no postinstall);
// any future runtime dep needing a postinstall would break this assumption.
const nodeModulesDest = path.join(stage, "node_modules");
fs.mkdirSync(nodeModulesDest, { recursive: true });

// Build the prod tree in a scratch project (just package.json + lockfile) so we
// never mutate the repo's own node_modules.
const nmBuild = path.join(stage, ".nm-build");
fs.mkdirSync(nmBuild, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(nmBuild, "package.json"));
fs.copyFileSync(path.join(repoRoot, "pnpm-lock.yaml"), path.join(nmBuild, "pnpm-lock.yaml"));

console.log(`[stage-vsix] Materializing production node_modules (hoisted)…`);
execFileSync(
  "pnpm",
  ["install", "--prod", "--config.node-linker=hoisted", "--ignore-scripts", "--frozen-lockfile"],
  { cwd: nmBuild, stdio: "inherit" },
);

// Flatten into the staging node_modules, dereferencing any residual symlinks so
// the VSIX carries only real files.
execFileSync(
  "rsync",
  ["-aL", `${path.join(nmBuild, "node_modules")}/`, `${nodeModulesDest}/`],
  { stdio: "inherit" },
);
fs.rmSync(nmBuild, { recursive: true, force: true });
console.log(`[stage-vsix] node_modules staged (production closure, real files).`);
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

//    aws CLI v2: fetch-cli-deps.sh produces a NESTED layout —
//    studio/packaging/aws-cli/aws-cli/aws (the inner aws-cli/ is the package's
//    own root). Copy the INNER dir so the binary lands at <ext>/aws-cli/aws —
//    one level, matching what resolveBinDirs() puts on PATH (<ext>/aws-cli).
//    Copying the outer dir would nest it to <ext>/aws-cli/aws-cli/aws, off PATH,
//    and `spawn("aws")` would silently fall back to the user's system aws.
//    Mirrors electron-builder.yml's `from: studio/packaging/aws-cli/aws-cli`.
fs.cpSync(path.join(repoRoot, "studio/packaging/aws-cli/aws-cli"), path.join(stage, "aws-cli"), { recursive: true });
// cloudflared intentionally NOT staged (share out of scope for v1).

// 7. Package. vsce's default dependency inclusion packs the staged hoisted
//    node_modules. Run the repo-root vsce binary (it's dev-only, so it's not in
//    the staged node_modules) but operate on the staging dir via cwd.
fs.mkdirSync(dist, { recursive: true });
// NOTE: do NOT pass --no-dependencies. That flag tells vsce "deps are already
// bundled, skip them" → it DROPS node_modules entirely (verified: only ~2
// incidental matches). We WANT vsce to include the staged hoisted node_modules,
// so we let its default dependency inclusion run over the flat real-file tree.
// --allow-missing-repository: this is an internal extension, no repo field.
const vscebin = path.join(repoRoot, "node_modules/.bin/vsce");
execFileSync(vscebin, ["package", "--allow-missing-repository",
  "--out", path.join(dist, `arcade-prototyper-${rootPkg.version}.vsix`)],
  { cwd: stage, stdio: "inherit" });

console.log(`✓ VSIX written to ${dist}/arcade-prototyper-${rootPkg.version}.vsix`);
