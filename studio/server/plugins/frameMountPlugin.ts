import type { Plugin } from "vite";
import { transformWithEsbuild } from "vite";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { frameDir, projectDir, projectJsonPath } from "../paths";

function readProjectMode(slug: string): "light" | "dark" {
  try {
    const pj = JSON.parse(fsSync.readFileSync(projectJsonPath(slug), "utf-8"));
    return pj.mode === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function frameMountPlugin(): Plugin {
  return {
    name: "arcade-studio-frame-mount",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/frames\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\?.*)?$/);
        if (!m) return next();
        const [, slug, frame] = m;
        const fPath = path.join(frameDir(slug, frame), "index.tsx");
        try {
          await fs.access(fPath);
        } catch {
          res.writeHead(404);
          res.end("Frame not found");
          return;
        }

        const mode = readProjectMode(slug);
        const overridesUrl = `/@fs${path.join(projectDir(slug), "theme-overrides.css")}`;
        const bootstrapUrl = `/@id/virtual:arcade-studio-frame.tsx?project=${slug}&frame=${frame}&mode=${mode}&t=${Date.now()}`;

        const slugJson = JSON.stringify(slug);
        const frameJson = JSON.stringify(frame);
        // Inline, non-module error handler. Registered before any module script
        // parses so it catches module-load failures (e.g. missing-export imports)
        // that happen before the React tree mounts.
        const errorShimScript = `
          (function () {
            var SLUG = ${slugJson};
            var FRAME = ${frameJson};
            function showFatal(label, err) {
              var msg = String((err && err.message) || err || "Unknown error");
              var stack = String((err && err.stack) || "");
              try {
                window.parent && window.parent.postMessage({
                  type: "arcade-studio:frame-error",
                  slug: SLUG,
                  frame: FRAME,
                  message: msg,
                  stack: stack
                }, "*");
              } catch (e) {}
              var root = document.getElementById("root") || document.body;
              if (!root) return;
              var pre = document.createElement("pre");
              pre.style.cssText = "padding:24px;margin:0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#b91c1c;background:#fef2f2;min-height:100vh;box-sizing:border-box;white-space:pre-wrap;overflow:auto;";
              pre.textContent = label + "\\n\\n" + msg + (stack ? "\\n\\n" + stack : "");
              root.innerHTML = "";
              root.appendChild(pre);
            }
            window.addEventListener("error", function (e) {
              showFatal("Frame failed to load", e.error || e.message);
            });
            window.addEventListener("unhandledrejection", function (e) {
              showFatal("Unhandled promise rejection in frame", e.reason);
            });
          })();
        `;
        const html = `<!DOCTYPE html>
<html lang="en" data-theme="arcade" class="${mode}">
  <head><meta charset="UTF-8" /><title>${slug}/${frame}</title>
    <script>${errorShimScript}</script>
    <script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <link rel="stylesheet" href="${overridesUrl}" />
  </head>
  <body><div id="root"></div>
    <script type="module" src="${bootstrapUrl}"></script>
  </body>
</html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
    },
    resolveId(id) {
      if (id.startsWith("virtual:arcade-studio-frame.tsx")) return "\0" + id;
      return null;
    },
    async load(id) {
      if (!id.startsWith("\0virtual:arcade-studio-frame.tsx")) return null;
      const q = new URLSearchParams(id.split("?")[1] ?? "");
      const slug = q.get("project")!;
      const frame = q.get("frame")!;
      const absFrame = path.join(frameDir(slug, frame), "index.tsx");
      const queryMode = q.get("mode");
      const mode = queryMode === "dark" || queryMode === "light" ? queryMode : readProjectMode(slug);
      const source = `
        import React from "react";
        import ReactDOM from "react-dom/client";
        import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
        import "@xorkavi/arcade-gen/styles.css";
        import { FrameErrorBoundary } from "arcade-studio/frame/FrameErrorBoundary";
        import { FrameFontProxy } from "arcade-studio/frame/FrameFontProxy";
        import Frame from "${absFrame}";

        ReactDOM.createRoot(document.getElementById("root")).render(
          <React.StrictMode>
            <DevRevThemeProvider mode="${mode}">
              <FrameFontProxy />
              <FrameErrorBoundary slug=${JSON.stringify(slug)} frame=${JSON.stringify(frame)}>
                <Frame />
              </FrameErrorBoundary>
            </DevRevThemeProvider>
          </React.StrictMode>
        );
      `;
      const result = await transformWithEsbuild(source, id.replace(/^\0/, ""), {
        loader: "tsx",
        jsx: "automatic",
      });
      return { code: result.code, map: result.map };
    },
  };
}
