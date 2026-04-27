import { build, type Plugin } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";
import { generateDevRevStubs } from "./stubDevRev";

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
