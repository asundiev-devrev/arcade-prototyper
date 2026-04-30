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

  const entrypoint = `
import React from "react";
import ReactDOM from "react-dom/client";
import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
import "@xorkavi/arcade-gen/styles.css";
import "${path.join(studioRoot(), "src/styles/arcade-gen-patches.css").replace(/\\/g, "/")}";
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
