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
export function renderFrameShellHtml(opts: {
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
      var NONCE = new URLSearchParams(location.search).get("n") || "";
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
            stack: stack,
            n: NONCE
          }, "*");
        } catch (e) {}
        // Never blank a rendered frame
        // This shim fires for BOTH an interaction/async error (React tree
        // mounted, #root has children, we must NOT destroy it) AND a
        // module-load crash before React mounts (#root empty, the panel is
        // the only content). Branch accordingly.
        var root = document.getElementById("root");
        // "Rendered" = #root has element children, OR the app painted via a
        // body portal that leaves #root empty. Real kit markers (verified
        // against the radix dist): a modal renders [role='dialog']; popover /
        // select / dropdown / tooltip content renders
        // [data-radix-popper-content-wrapper]. (There is NO data-radix-portal
        // attribute - the Portal wrapper is an unmarked div, so don't rely on it.)
        var rendered = !!root && (
          root.childElementCount > 0 ||
          !!document.body.querySelector("[data-radix-popper-content-wrapper],[role='dialog']")
        );
        // Idempotent: never stack overlays/panels on a second error.
        if (document.querySelector("[data-arcade-status-overlay]")) return;

        // Shared calm content (dot + title + sub + details) - built once.
        function buildCalm(container, isOverlay) {
          var head = document.createElement("div");
          head.style.cssText = "display:flex;align-items:center;gap:10px;";
          var dot = document.createElement("span");
          dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;animation:arcade-frame-pulse 1.4s ease-in-out infinite;";
          var title = document.createElement("strong");
          title.textContent = isOverlay ? "Refining your change…" : "Auto-repairing this frame";
          title.style.cssText = "font-weight:600;color:#111827;";
          head.appendChild(dot); head.appendChild(title);
          var sub = document.createElement("div");
          sub.setAttribute("data-arcade-status-sub", "");   // targeted by the softener via this marker - a bare-div lookup would grab the head row (dot+title) instead
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
          container.appendChild(head); container.appendChild(sub); container.appendChild(details);
        }

        var keyframes = document.createElement("style");
        keyframes.textContent = "@keyframes arcade-frame-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }";
        document.head.appendChild(keyframes);

        if (rendered) {
          // KEEP the frame's DOM. Lay a calm status banner on top, pinned to a
          // corner, at max z-index so the frame's own fixed chrome / modals
          // cannot hide it. Appended to <body> (shares the top stacking
          // context) so no descendant z-index can cover it.
          var overlay = document.createElement("div");
          overlay.setAttribute("data-arcade-status-overlay", "");
          overlay.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:calc(100% - 24px);z-index:2147483647;padding:10px 12px;border-radius:10px;background:#fafafa;border:1px solid rgba(0,0,0,0.08);box-shadow:0 4px 16px rgba(0,0,0,0.12);font:12.5px/1.45 system-ui,-apple-system,sans-serif;color:#374151;display:flex;flex-direction:column;gap:6px;";
          buildCalm(overlay, true);
          document.body.appendChild(overlay);
          // Bounded resting-state (spec constraint 5): repair may have nothing
          // to fix (a pure interaction error, no file change, no swap, this
          // overlay would otherwise promise "Refining..." forever). After a
          // bounded wait with no swap, soften to tell the user what to DO. If a
          // real repair lands first, the committed iframe reloads and this whole
          // document (overlay + timer) is gone - so blindly softening is safe.
          // Self-contained in the shim: does NOT touch the parent chip / timer.
          setTimeout(function () {
            var live = document.querySelector("[data-arcade-status-overlay]");
            if (!live) return; // document already swapped/reloaded, nothing to do
            // Target elements EXPLICITLY via markers. A bare-div lookup would
            // hit the head flex-row (dot+title) - the FIRST div - and
            // .textContent on it would DESTROY the dot+title children. Use the
            // sub's marker attr and the title strong element (no element children).
            var t = live.querySelector("strong");
            var s = live.querySelector("[data-arcade-status-sub]");
            if (t) t.textContent = "Couldn't apply that change automatically";
            if (s) s.textContent = "Tell the agent what you'd like instead, or reload.";
          }, 90000);
        } else {
          // Empty frame (module-load crash, nothing rendered) - the panel IS
          // the content. Keep today's full-panel behavior.
          var host = root || document.body;
          host.innerHTML = "";
          var wrap = document.createElement("div");
          wrap.setAttribute("data-arcade-status-overlay", "");
          wrap.style.cssText = "padding:24px;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#374151;background:#fafafa;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:8px;";
          buildCalm(wrap, false);
          host.appendChild(wrap);
        }
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
        const absOverrides = path.join(projectDir(slug), "theme-overrides.css");
        const queryMode = q.get("mode");
        const mode = queryMode === "dark" || queryMode === "light" ? queryMode : readProjectMode(slug);
        return await compileFrameBootstrap({
          virtualId: id,
          absFrame,
          absOverrides,
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
  absOverrides: string;
  mode: "light" | "dark";
  slug: string;
  frame: string;
}): Promise<{ code: string; map: any }> {
  const { virtualId, absFrame, absOverrides, mode, slug, frame } = opts;
  const source = buildFrameBootstrapSource({ absFrame, absOverrides, mode, slug, frame });
  const result = await transformWithEsbuild(source, virtualId.replace(/^\0/, ""), {
    loader: "tsx",
    jsx: "automatic",
    keepNames: true,
  });
  return { code: result.code, map: result.map };
}

/**
 * Pure builder for the frame bootstrap TSX source. Extracted + exported so the
 * CSS import ORDER (which decides the theme-token cascade) is unit-testable
 * without running the esbuild transform, which isn't available in the test env.
 */
export function buildFrameBootstrapSource(opts: {
  absFrame: string;
  absOverrides: string;
  mode: "light" | "dark";
  slug: string;
  frame: string;
}): string {
  const { absFrame, absOverrides, mode, slug, frame } = opts;
  return `
    import React from "react";
    import ReactDOM from "react-dom/client";
    import { DevRevThemeProvider } from "@xorkavi/arcade-gen";
    import "@xorkavi/arcade-gen/styles.css";
    import "arcade-studio/styles/tailwind.css";
    import "arcade-studio/styles/arcade-gen-patches.css";
    // Per-project theme token overrides — imported LAST of the CSS so it wins
    // the cascade. The kit's styles.css defines the same tokens under
    // ':root, :root.light' (specificity 0,2,0); the override selector matches
    // that specificity, so the tie breaks on SOURCE ORDER. The static <link> in
    // the HTML head loads BEFORE this JS-injected kit CSS and thus LOSES — the
    // live gate (implement-this-design-precisely-2) showed the purple
    // --surface-backdrop:#5800E6 defeated by the kit's #fff. Importing it here,
    // after styles.css, makes it the later sheet so the override actually
    // applies. Vite injects an empty stylesheet when the file is only comments.
    import "${absOverrides}";
    import { FrameErrorBoundary } from "arcade-studio/frame/FrameErrorBoundary";
    import { FrameFontProxy } from "arcade-studio/frame/FrameFontProxy";
    import "arcade-studio/frame/picker";
    import "arcade-studio/frame/inspector";
    import "arcade-studio/frame/gestureForwarder";
    import { computeFingerprint, productionMeasure } from "arcade-studio/frame/renderFingerprint";
    import { digestElements } from "arcade-studio/frame/frameDigest";
    import Frame from "${absFrame}";

    const __N = new URLSearchParams(location.search).get("n") || "";
    let __arcadeFrameReadyPosted = false;
    function ArcadeFrameReady() {
      React.useEffect(() => {
        if (__arcadeFrameReadyPosted) return;      // StrictMode double-invoke guard
        __arcadeFrameReadyPosted = true;
        window.parent && window.parent.postMessage(
          { type: "arcade-studio:frame-ready", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N }, "*");
      }, []);
      return null;
    }

    // Reports the frame's NATURAL content height so the parent can hug the
    // container to it (a short design → a short frame, no dead white space
    // below). Measures #root's rendered box, NOT documentElement.scrollHeight
    // (which floors at the viewport in most engines and would never let a
    // content frame shrink). A full-app shell using h-screen/min-h-screen
    // resolves 100vh to the iframe's own height, so #root reports ≈ the current
    // container height → the parent's CSS min() cap holds it full, unchanged
    // from today. Re-measures on any layout change (font load, page switch,
    // accordion) via ResizeObserver. Best-effort; never breaks the frame.
    function ArcadeFrameHeight() {
      React.useEffect(() => {
        let cancelled = false;
        let last = -1;
        const post = () => {
          if (cancelled) return;
          try {
            const root = document.getElementById("root");
            if (!root) return;
            const h = Math.ceil(root.getBoundingClientRect().height);
            if (h <= 0 || h === last) return;   // ignore pre-render 0s + no-op repeats
            last = h;
            window.parent && window.parent.postMessage(
              { type: "arcade-studio:frame-height", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N, height: h }, "*");
          } catch (_) { /* height report is best-effort; never break the frame */ }
        };
        const afterLayout = () => requestAnimationFrame(() => requestAnimationFrame(post));
        const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        fonts.then(afterLayout, afterLayout);
        // Coalesce RO bursts into one rAF-throttled post so animations don't spam.
        let scheduled = false;
        const ro = typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              if (scheduled) return;
              scheduled = true;
              requestAnimationFrame(() => { scheduled = false; post(); });
            })
          : null;
        const root = document.getElementById("root");
        if (ro && root) ro.observe(root);
        return () => { cancelled = true; if (ro) ro.disconnect(); };
      }, []);
      return null;
    }

    // Rides its OWN message — never folded into frame-ready (which must fire
    // instantly to drive the double-buffer swap). Awaits fonts + double-rAF so
    // the fingerprint reflects the AT-REST rendered layout. Best-effort: any
    // failure is swallowed so it can never break the frame.
    function ArcadeFrameFingerprint() {
      React.useEffect(() => {
        let cancelled = false;
        const post = () => {
          if (cancelled) return;
          try {
            const fp = computeFingerprint(document.body, productionMeasure);
            window.parent && window.parent.postMessage(
              { type: "arcade-studio:frame-fingerprint", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N, fp: fp }, "*");
            const digest = digestElements(document.body, productionMeasure);
            window.parent && window.parent.postMessage(
              { type: "arcade-studio:frame-digest", slug: ${JSON.stringify(slug)}, frame: ${JSON.stringify(frame)}, n: __N, digest: digest }, "*");
          } catch (_) { /* fingerprint is best-effort; never break the frame */ }
        };
        const afterLayout = () => requestAnimationFrame(() => requestAnimationFrame(post));
        const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        fonts.then(afterLayout, afterLayout);
        return () => { cancelled = true; };
      }, []);
      return null;
    }

    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <DevRevThemeProvider mode="${mode}">
          <FrameFontProxy />
          <FrameErrorBoundary slug=${JSON.stringify(slug)} frame=${JSON.stringify(frame)}>
            <Frame />
            <ArcadeFrameReady />
            <ArcadeFrameHeight />
            <ArcadeFrameFingerprint />
          </FrameErrorBoundary>
        </DevRevThemeProvider>
      </React.StrictMode>
    );
  `;
}
