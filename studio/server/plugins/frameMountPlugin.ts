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

/**
 * HTML-escape user-controlled values rendered into the frame shell. Title and
 * any other text-context interpolations must go through this so a frame slug
 * like `<script>alert(1)</script>` can't break out of `<title>` and execute.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}

/**
 * Build the HTML shell used by the host frame mount endpoint. DevRev theme +
 * arcade-gen styles + error shim; the `bootstrapUrl` decides which virtual TSX
 * module Vite compiles.
 */
function renderFrameShellHtml(opts: {
  title: string;
  mode: "light" | "dark";
  overridesUrl: string | null;
  bootstrapUrl: string;
  errorScopeJson: { slug: string; frame: string };
}): string {
  const { title, mode, overridesUrl, bootstrapUrl, errorScopeJson } = opts;
  const slugJson = JSON.stringify(errorScopeJson.slug);
  const frameJson = JSON.stringify(errorScopeJson.frame);
  // Inline, non-module error handler. Registered before any module script
  // parses so it catches module-load failures (e.g. missing-export imports)
  // that happen before the React tree mounts.
  const errorShimScript = `
    (function () {
      var SLUG = ${slugJson};
      var FRAME = ${frameJson};
      function isViteClientNoise(err) {
        var stack = String((err && err.stack) || "");
        if (!stack) return false;
        if (stack.indexOf("/@vite/client") === -1) return false;
        var lines = stack.split("\\n");
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf("at ") === -1) continue;
          if (line.indexOf("/@vite/client") === -1) return false;
        }
        return true;
      }
      function showFatal(label, err) {
        if (isViteClientNoise(err)) return;
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
        // Calm "auto-repairing" overlay. The previous behaviour was a wall
        // of red stack-trace text — accurate but designed for a developer,
        // not a designer/PM looking at their canvas. The studio dispatches
        // an auto-fix turn server-side on every postMessage above, so the
        // honest read is "we noticed, we're fixing it" — surface that, hide
        // the gore behind a disclosure. Chat pane carries the durable
        // record (system messages on dispatch + completion).
        root.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.style.cssText = "padding:24px;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#374151;background:#fafafa;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:8px;";
        var head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:center;gap:10px;";
        var dot = document.createElement("span");
        dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;animation:arcade-frame-pulse 1.4s ease-in-out infinite;";
        var title = document.createElement("strong");
        title.textContent = "Auto-repairing this frame";
        title.style.cssText = "font-weight:600;color:#111827;";
        head.appendChild(dot);
        head.appendChild(title);
        var sub = document.createElement("div");
        sub.style.cssText = "color:#6b7280;font-size:12.5px;";
        sub.textContent = "We caught a " + (label === "Frame failed to load" ? "load" : "runtime") + " error and asked the agent to fix it. Watch the chat for an update.";
        var details = document.createElement("details");
        details.style.cssText = "margin-top:12px;color:#6b7280;font-size:12px;max-width:100%;";
        var summary = document.createElement("summary");
        summary.textContent = "Show technical details";
        summary.style.cssText = "cursor:pointer;color:#6b7280;";
        details.appendChild(summary);
        var pre = document.createElement("pre");
        pre.style.cssText = "margin-top:8px;padding:10px;background:#f3f4f6;border-radius:6px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7f1d1d;white-space:pre-wrap;overflow:auto;max-height:60vh;";
        pre.textContent = label + "\\n\\n" + msg + (stack ? "\\n\\n" + stack : "");
        details.appendChild(pre);
        var keyframes = document.createElement("style");
        keyframes.textContent = "@keyframes arcade-frame-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }";
        wrap.appendChild(keyframes);
        wrap.appendChild(head);
        wrap.appendChild(sub);
        wrap.appendChild(details);
        root.appendChild(wrap);
      }
      window.addEventListener("error", function (e) {
        showFatal("Frame failed to load", e.error || e.message);
      });
      window.addEventListener("unhandledrejection", function (e) {
        showFatal("Unhandled promise rejection in frame", e.reason);
      });
    })();
  `;
  // `mode` is already constrained to "light" | "dark" by the type, but pass
  // it through escapeHtml anyway so the call site is uniform — cheap and
  // makes audits easier. `bootstrapUrl` and `overridesUrl` are constructed
  // server-side from validated/encoded segments, but they still land in HTML
  // attribute contexts so we escape `&` / `"` for safety.
  const overridesLink = overridesUrl
    ? `<link rel="stylesheet" href="${escapeHtml(overridesUrl)}" />`
    : "";
  return `<!DOCTYPE html>
<html lang="en" data-theme="arcade" class="${escapeHtml(mode)}">
  <head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title>
    <script>${errorShimScript}</script>
    <script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    ${overridesLink}
  </head>
  <body><div id="root"></div>
    <script type="module" src="${escapeHtml(bootstrapUrl)}"></script>
  </body>
</html>`;
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
        const html = renderFrameShellHtml({
          title: `${slug}/${frame}`,
          mode,
          overridesUrl,
          bootstrapUrl,
          errorScopeJson: { slug, frame },
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
    },
    resolveId(id) {
      if (id.startsWith("virtual:arcade-studio-frame.tsx")) return "\0" + id;
      return null;
    },
    async load(id) {
      if (id.startsWith("\0virtual:arcade-studio-frame.tsx")) {
        const q = new URLSearchParams(id.split("?")[1] ?? "");
        const slug = q.get("project")!;
        const frame = q.get("frame")!;
        const absFrame = path.join(frameDir(slug, frame), "index.tsx");
        const queryMode = q.get("mode");
        const mode = queryMode === "dark" || queryMode === "light" ? queryMode : readProjectMode(slug);
        return await compileFrameBootstrap({
          virtualId: id,
          absFrame,
          mode,
          slug,
          frame,
        });
      }
      return null;
    },
  };
}

/**
 * Build + esbuild-transform the frame bootstrap module: `absFrame` (the user's
 * TSX file to import) plus `slug`/`frame` for error-boundary scoping.
 */
async function compileFrameBootstrap(opts: {
  virtualId: string;
  absFrame: string;
  mode: "light" | "dark";
  slug: string;
  frame: string;
}): Promise<{ code: string; map: any }> {
  const { virtualId, absFrame, mode, slug, frame } = opts;
  const source = `
    import React from "react";
    import ReactDOM from "react-dom/client";
    import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
    import "@xorkavi/arcade-gen/styles.css";
    import "arcade-studio/styles/tailwind.css";
    import "arcade-studio/styles/arcade-gen-patches.css";
    import { FrameErrorBoundary } from "arcade-studio/frame/FrameErrorBoundary";
    import { FrameFontProxy } from "arcade-studio/frame/FrameFontProxy";
    import "arcade-studio/frame/picker";
    import "arcade-studio/frame/gestureForwarder";
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
  const result = await transformWithEsbuild(source, virtualId.replace(/^\0/, ""), {
    loader: "tsx",
    jsx: "automatic",
    keepNames: true,
  });
  return { code: result.code, map: result.map };
}
