import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import { studioRoot } from "./server/paths";
import { projectsMiddleware } from "./server/middleware/projects";
import { framesMiddleware } from "./server/middleware/frames";
import { adoptUploadsMiddleware } from "./server/middleware/adoptUploads";
import { chatMiddleware } from "./server/middleware/chat";
import { figmaMiddleware } from "./server/middleware/figma";
import { uploadsMiddleware } from "./server/middleware/uploads";
import { stagingUploadsMiddleware, cleanStaleStagingSessions } from "./server/middleware/stagingUploads";
import { preflightMiddleware } from "./server/middleware/preflight";
import { metricsMiddleware } from "./server/middleware/metrics";
import { fontsMiddleware } from "./server/middleware/fonts";
import { devrevMiddleware } from "./server/middleware/devrev";
import { multiplayerMiddleware } from "./server/middleware/multiplayer";
import { multiplayerInviteMiddleware } from "./server/middleware/multiplayerInvite";
import { projectSharingMiddleware } from "./server/middleware/projectSharing";
import { sharedProjectsMiddleware } from "./server/middleware/sharedProjects";
import { attachRelayToHttpServer } from "./server/relay/wsServer";
import { hydrateSessionRegistry } from "./server/relay/sessionRegistry";
import { hydrateProjectRegistry, republishAllRendezvous } from "./server/relay/projectRegistry";
import { attachHostCommentInbox } from "./server/relay/hostCommentInbox";
import { seedReplayBuffersFromDisk } from "./server/relay/seedReplayBuffers";
import { getDevRevPat } from "./server/secrets/keychain";
import { resolveDevuFromPat } from "./server/relay/auth";
import { listMirrors } from "./server/sharedProjects/cache";
import { connectMirror } from "./server/sharedProjects/relayClient";
import { settingsMiddleware } from "./server/middleware/settings";
import { thumbnailsMiddleware } from "./server/middleware/thumbnails";
import { liftMiddleware } from "./server/middleware/lift";
import { exportMiddleware } from "./server/middleware/export";
import { cloudflareMiddleware } from "./server/middleware/cloudflare";
import { runtimeErrorMiddleware } from "./server/middleware/runtimeError";
import { versionMiddleware, logVersionOnBoot } from "./server/middleware/version";
import { telemetryIdentityMiddleware } from "./server/middleware/telemetryIdentity";
import { awsLoginMiddleware } from "./server/middleware/awsLogin";
import { frameMountPlugin } from "./server/plugins/frameMountPlugin";
import { projectWatchPlugin } from "./server/plugins/projectWatchPlugin";
import { injectStudioSourcePlugin } from "./server/plugins/injectStudioSourcePlugin";
import { kitManifestPlugin } from "./server/plugins/kitManifestPlugin";
import { liftEmitPlugin } from "./server/plugins/liftEmitPlugin";
import { attachBuildErrorReporter } from "./server/buildErrorReporter";
import { refreshStaleClaudeMd } from "./server/projects";
import { ensureMemoryStubs } from "./server/memory";
import { globalMemoryDir } from "./server/paths";

function apiPlugin(): import("vite").Plugin {
  return {
    name: "arcade-studio-api",
    configureServer(server) {
      server.middlewares.use(versionMiddleware());
      server.middlewares.use(telemetryIdentityMiddleware());
      server.middlewares.use(awsLoginMiddleware());
      server.middlewares.use(devrevMiddleware());
      server.middlewares.use(multiplayerMiddleware());
      server.middlewares.use(multiplayerInviteMiddleware());
      server.middlewares.use(projectSharingMiddleware());
      server.middlewares.use(sharedProjectsMiddleware());
      server.middlewares.use(settingsMiddleware());
      server.middlewares.use(cloudflareMiddleware());
      server.middlewares.use(projectsMiddleware());
      server.middlewares.use(framesMiddleware());
      server.middlewares.use(adoptUploadsMiddleware());
      server.middlewares.use(chatMiddleware());
      server.middlewares.use(figmaMiddleware());
      server.middlewares.use(uploadsMiddleware());
      server.middlewares.use(stagingUploadsMiddleware());
      server.middlewares.use(thumbnailsMiddleware());
      server.middlewares.use(liftMiddleware());
      server.middlewares.use(exportMiddleware());
      server.middlewares.use(preflightMiddleware());
      server.middlewares.use(metricsMiddleware());
      server.middlewares.use(fontsMiddleware());
      server.middlewares.use(runtimeErrorMiddleware());
      attachBuildErrorReporter(server);
      // Attach the multiplayer WebSocket handler to Vite's HTTP server.
      // httpServer is null in middlewareMode; in dev-server mode (the only
      // way Studio runs) it resolves after `listening`.
      // Kick off hydration as early as possible, then chain the WS attach
      // after BOTH the HTTP server is listening AND hydration has settled —
      // otherwise a guest upgrade landing before hydration finishes would
      // see an empty registry and get a phantom 404.
      const hydrated = Promise.all([
        hydrateSessionRegistry().catch((err) => {
          console.warn("[studio/multiplayer] hydrate failed:", err);
        }),
        hydrateProjectRegistry()
          .then(async () => {
            // Seed in-memory replay buffers from disk so guests joining
            // after a host restart see frames the host generated in prior
            // sessions. Best-effort — silent if no PAT yet.
            try {
              const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
              if (pat) {
                const id = await resolveDevuFromPat(pat);
                if (id?.id) {
                  await seedReplayBuffersFromDisk(id.id);
                  // Mirror incoming `comment_posted` events into the host's
                  // local chat-history.json so spectator comments are
                  // visible (and reload-safe) on the host's chat pane.
                  attachHostCommentInbox(id.id);
                }
              }
            } catch (err) {
              console.warn("[studio/shared-projects] seed replay failed:", err);
            }
            await republishAllRendezvous();
          })
          .catch((err) => {
            console.warn("[studio/shared-projects] hydrate/republish failed:", err);
          }),
      ]);
      server.httpServer?.once("listening", () => {
        const http = server.httpServer;
        if (!http) return;
        void hydrated.then(() => attachRelayToHttpServer(http as HttpServer));
      });
      // Auto-resume persisted shared-project mirrors. Each mirror reconnects
      // to its host's relay over WS independently; failures are logged but
      // don't block boot.
      void (async () => {
        try {
          const mirrors = await listMirrors();
          for (const m of mirrors) {
            connectMirror(m.id).catch((err) =>
              console.warn(`[shared-projects] failed to reconnect ${m.id}:`, err),
            );
          }
        } catch (err) {
          console.warn("[shared-projects] failed to enumerate mirrors:", err);
        }
      })();
      void logVersionOnBoot();
      void cleanStaleStagingSessions();
      void ensureMemoryStubs(globalMemoryDir(), "global")
        .catch((err) => console.warn("[studio] global memory seed failed:", err));
      refreshStaleClaudeMd()
        .then((n) => { if (n > 0) console.log(`[studio] refreshed CLAUDE.md for ${n} project(s)`); })
        .catch((err) => console.warn("[studio] CLAUDE.md refresh failed:", err));
    },
  };
}

// Aliases for agent-generated frames (under ~/Library/Application Support/...):
// frame files use the short "arcade" / "arcade/components" specifiers so they
// stay readable. Studio's own source imports @xorkavi/arcade-gen directly.
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [injectStudioSourcePlugin(), kitManifestPlugin(), react(), tailwindcss(), frameMountPlugin(), projectWatchPlugin(), liftEmitPlugin(), apiPlugin()],
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: "arcade-studio",         replacement: path.resolve(__dirname, "src") },
      { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
  server: {
    port: 5556,
    // Auto-open is gated on ARCADE_STUDIO_OPEN_BROWSER. The Electron
    // wrapper sets this to "0" so Vite doesn't open a browser tab in
    // addition to the Electron window. Plain `pnpm run studio` keeps
    // the old browser-tab UX by default.
    open: process.env.ARCADE_STUDIO_OPEN_BROWSER !== "0",
    fs: {
      allow: [path.resolve(__dirname, ".."), studioRoot()],
    },
  },
});
