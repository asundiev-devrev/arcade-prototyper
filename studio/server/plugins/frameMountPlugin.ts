import type { Plugin } from "vite";
import { transformWithEsbuild } from "vite";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { frameDir, projectDir, projectJsonPath, sharedProjectDir, sharedProjectsRoot } from "../paths";
import { resolveFrameFsPath, sanitizeFramePathForFs } from "../sharedProjects/cache";

function readProjectMode(slug: string): "light" | "dark" {
  try {
    const pj = JSON.parse(fsSync.readFileSync(projectJsonPath(slug), "utf-8"));
    return pj.mode === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Whitelist for the spectator `:id` URL segment. `projectShareId` values are
 * `randomUUID()` outputs (lowercase hex with dashes), but mirrors created out
 * of band may use slightly different casings — keep the allowed set narrow
 * (alphanumeric, `-`, `_`) so attackers can't smuggle `..`, `/`, dots, or
 * encoded slashes that would escape `shared-projects/` once handed to
 * `sharedProjectDir(id)` → `path.join(root, id)`.
 */
const SHARED_PROJECT_ID = /^[a-zA-Z0-9_-]+$/;

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
 * Defense-in-depth check: even after the regex passes, confirm that the
 * resolved on-disk path stays inside the spectator mirror root. Returns
 * true if `sharedProjectDir(id)` resolves to a child of `shared-projects/`.
 */
function isSharedIdSafe(id: string): boolean {
  if (!SHARED_PROJECT_ID.test(id)) return false;
  const root = path.resolve(sharedProjectsRoot());
  const resolved = path.resolve(sharedProjectDir(id));
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Build the HTML shell used by both the host and spectator frame mount
 * endpoints. Same DevRev theme + arcade-gen styles + error shim — only the
 * `bootstrapUrl` differs, which decides which virtual TSX module Vite
 * compiles.
 *
 * Centralising this here keeps spectators rendering identical to hosts;
 * any future tweak to the host frame shell propagates to spectators for
 * free.
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
      // Spectator frame compile — `/api/shared-projects/:id/frame/:framePath`.
      // Mirrors the host endpoint below, only the file source differs: TSX
      // is read from the guest-side mirror cache instead of `projects/`.
      // Registered before the host route so the more specific URL matches
      // first.
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(
          /^\/api\/shared-projects\/([^/?]+)\/frame\/([^/?]+)(?:\?.*)?$/,
        );
        if (!m) return next();
        const id = decodeURIComponent(m[1]);
        const framePath = decodeURIComponent(m[2]);
        // Reject path traversal BEFORE any disk access. The route regex
        // `[^/?]+` permits dots / encoded slashes / `..` once
        // decodeURIComponent runs, so we have to gate it here. Bouncing
        // requests before resolveFrameFsPath() ensures `path.join(root,
        // id)` can't escape `shared-projects/` even on weird filesystems.
        if (!isSharedIdSafe(id)) {
          res.writeHead(400);
          res.end("Invalid shared project id");
          return;
        }
        // The frame path is sanitized into a filesystem-safe filename by
        // `sanitizeFramePathForFs`; reject anything that would change once
        // sanitized, since that signals a traversal attempt rather than a
        // legitimate slug.
        if (sanitizeFramePathForFs(framePath) !== framePath) {
          res.writeHead(400);
          res.end("Invalid frame path");
          return;
        }
        const absFrame = await resolveFrameFsPath(id, framePath);
        if (!absFrame) {
          res.writeHead(404);
          res.end("Frame not found");
          return;
        }

        // Spectators don't have a `project.json` for theme — default to
        // light. The host sends the active mode via `presence_state` /
        // chat events; threading it here is a future polish (Plan 2c).
        const mode: "light" | "dark" = "light";
        const bootstrapUrl =
          `/@id/virtual:arcade-studio-shared-frame.tsx?` +
          `id=${encodeURIComponent(id)}&path=${encodeURIComponent(framePath)}` +
          `&mode=${mode}&t=${Date.now()}`;
        const html = renderFrameShellHtml({
          title: `${id}/${framePath}`,
          mode,
          overridesUrl: null,
          bootstrapUrl,
          errorScopeJson: { slug: id, frame: framePath },
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });

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
      if (id.startsWith("virtual:arcade-studio-shared-frame.tsx")) return "\0" + id;
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
      if (id.startsWith("\0virtual:arcade-studio-shared-frame.tsx")) {
        // Spectator: TSX lives under `<studioRoot>/shared-projects/<id>/frames/`
        // (mirror cache). We resolve the on-disk path via the cache helper —
        // it handles the modern `.tsx` filename and the legacy
        // extension-less fallback.
        const q = new URLSearchParams(id.split("?")[1] ?? "");
        const sharedId = q.get("id")!;
        const framePath = q.get("path")!;
        const queryMode = q.get("mode");
        const mode = queryMode === "dark" ? "dark" : "light";
        // The HTTP middleware validates these before constructing the
        // bootstrap URL, but Vite also resolves virtual modules from
        // direct `/@id/...` requests — re-check here so the load path is
        // safe on its own. A `throw` short-circuits the import with an
        // error visible in the spectator's red screen.
        if (!isSharedIdSafe(sharedId) || sanitizeFramePathForFs(framePath) !== framePath) {
          const msg = `Invalid spectator frame request: ${sharedId}/${framePath}`;
          return `throw new Error(${JSON.stringify(msg)});`;
        }
        const absFrame = await resolveFrameFsPath(sharedId, framePath);
        if (!absFrame) {
          // Vite expects `load` to throw or return null/source. Returning
          // an explicit module that calls the parent error shim gives the
          // spectator a useful red screen rather than a silent blank.
          const msg = `Spectator frame not found: ${sharedId}/${framePath}`;
          return `throw new Error(${JSON.stringify(msg)});`;
        }
        return await compileFrameBootstrap({
          virtualId: id,
          absFrame,
          mode,
          slug: sharedId,
          frame: framePath,
        });
      }
      return null;
    },
  };
}

/**
 * Build + esbuild-transform the frame bootstrap module. Shared by host and
 * spectator paths: the only difference is `absFrame` (the user's TSX file
 * to import) and `slug`/`frame` for error-boundary scoping.
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
  });
  return { code: result.code, map: result.map };
}
