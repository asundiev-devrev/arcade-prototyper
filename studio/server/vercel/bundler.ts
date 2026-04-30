import { build, type Plugin } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studioRoot } from "../paths";
import { generateDevRevStubs } from "./stubDevRev";

// Resolve the arcade-prototyper repo root from this file's own location:
//   <repo>/studio/server/vercel/bundler.ts → two "../" lands at <repo>/studio/
//   server, three more lands at <repo>. This is where the repo's node_modules
//   actually lives, both in dev checkouts and inside the packaged .app bundle
//   (Contents/Resources/app/node_modules/).
const STUDIO_SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(STUDIO_SERVER_DIR, "..", "..", "..");
const REPO_NODE_MODULES = path.join(REPO_ROOT, "node_modules");
const STUDIO_SRC_STYLES = path.join(REPO_ROOT, "studio", "src", "styles");

function devrevStubPlugin(): Plugin {
  return {
    name: "arcade-studio-devrev-stub",
    setup(b) {
      b.onResolve({ filter: /(^|\/)shared\/devrev(\.ts|\.tsx|\.js)?$/ }, (args) => ({
        path: args.path,
        namespace: "devrev-stub",
      }));
      b.onLoad({ filter: /.*/, namespace: "devrev-stub" }, () => ({
        contents: generateDevRevStubs(),
        loader: "tsx",
      }));
    },
  };
}

// Mirror studio/vite.config.ts's path aliases for esbuild. Studio's generated
// frames import from `arcade` and `arcade/components` (readable aliases the
// agent is told to use in CLAUDE.md.tpl); `arcade-prototypes` maps to the
// prototype-kit tree. Vite resolves these at dev time; esbuild needs the same
// mapping explicitly or bundling fails with "Could not resolve 'arcade/...'".
//
// esbuild's built-in `alias` option rewrites the specifier BEFORE the
// resolution walk, so the result still passes through node_modules / nodePaths
// lookup naturally. That's cleaner than a plugin that tries to short-circuit
// the path.
//
// Keep this in sync with studio/vite.config.ts's `resolve.alias`.
const ARCADE_ALIASES = {
  "arcade": "@xorkavi/arcade-gen",
  "arcade/components": "@xorkavi/arcade-gen",
  "arcade-prototypes": path.join(REPO_ROOT, "studio", "prototype-kit"),
} as const;

interface BuildContext {
  projectSlug: string;
  frameSlug: string;
  framePath: string;
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
}

export async function buildFrameBundle(ctx: BuildContext): Promise<{
  html: string;
  js: string;
  css: string;
}> {
  const tempDir = path.join(studioRoot(), ".temp", `build-${ctx.projectSlug}-${ctx.frameSlug}`);
  await fs.mkdir(tempDir, { recursive: true });

  // arcade-gen-patches.css lives in the studio source tree, not in the
  // user-data directory. `studioRoot()` returns ~/Library/Application Support
  // /arcade-studio/ (where projects live), which does NOT contain src/. The
  // correct location is <repo>/studio/src/styles/. Both dev checkouts and
  // the packaged .app have this path under REPO_ROOT.
  const patchesCssPath = path.join(STUDIO_SRC_STYLES, "arcade-gen-patches.css").replace(/\\/g, "/");

  const entrypoint = `
import React from "react";
import ReactDOM from "react-dom/client";
import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
import "@xorkavi/arcade-gen/styles.css";
import "${patchesCssPath}";
import Frame from "${ctx.framePath}/index.tsx";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <DevRevThemeProvider mode="${ctx.mode}">
        <Frame />
      </DevRevThemeProvider>
    </React.StrictMode>
  );
}
`;

  const entrypointPath = path.join(tempDir, "entrypoint.tsx");
  await fs.writeFile(entrypointPath, entrypoint);

  try {
    const result = await build({
      entryPoints: [entrypointPath],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      outdir: tempDir,
      write: false,
      loader: {
        ".tsx": "tsx",
        ".ts": "tsx",
        ".css": "css",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".svg": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
      },
      external: [],
      jsx: "automatic",
      alias: { ...ARCADE_ALIASES },
      plugins: [devrevStubPlugin()],
      // The entrypoint lives under ~/Library/Application Support/arcade-studio/
      // .temp/ — far outside the repo. esbuild's default node_modules
      // resolution walks up from the entrypoint and never reaches the repo's
      // node_modules, so it fails with "Could not resolve 'react'". Both
      // `absWorkingDir` (so bare specifiers resolve against the repo) and
      // `nodePaths` (so node_modules lookups fall back to the repo's) are
      // needed — the former handles the resolveDir, the latter is the
      // belt-and-suspenders for transitive dependencies.
      absWorkingDir: REPO_ROOT,
      nodePaths: [REPO_NODE_MODULES],
    });

    const jsOutput = result.outputFiles.find(f => f.path.endsWith(".js"));
    const cssOutput = result.outputFiles.find(f => f.path.endsWith(".css"));

    const js = jsOutput?.text || "";
    const css = cssOutput?.text || "";

    const html = `<!DOCTYPE html>
<html lang="en" data-theme="${ctx.theme}" class="${ctx.mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ctx.projectSlug} - ${ctx.frameSlug}</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>`;

    await fs.rm(tempDir, { recursive: true, force: true });

    return { html, js, css };
  } catch (err: any) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Bundle failed: ${err.message}`);
  }
}
