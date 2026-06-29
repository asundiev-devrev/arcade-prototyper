import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import os from "node:os";
import { studioRoot } from "./server/paths";
import { projectsMiddleware } from "./server/middleware/projects";
import { templatesMiddleware } from "./server/middleware/templates";
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
import { getDevRevPat } from "./server/secrets/keychain";
import { resolveDevuFromPat } from "./server/devrev/identity";
import { settingsMiddleware, readGlobalSettings, writeTelemetryDistinctId } from "./server/middleware/settings";
import { resolveConfig, readFileConfig } from "./src/lib/telemetry/config";
import { resolveDistinctId } from "./src/lib/telemetry/identity";
import { initServerTelemetry, shutdownServerTelemetry } from "./src/lib/telemetry/server";
import { randomUUID } from "node:crypto";
import { liftMiddleware } from "./server/middleware/lift";
import { exportMiddleware } from "./server/middleware/export";
import { figmaExportMiddleware } from "./server/middleware/figmaExport";
import { assetsMiddleware } from "./server/middleware/assets";
import { componentsMiddleware } from "./server/middleware/components";
import { cloudflareMiddleware } from "./server/middleware/cloudflare";
import { runtimeErrorMiddleware } from "./server/middleware/runtimeError";
import { visualEditMiddleware } from "./server/middleware/visualEdit";
import { editUndoMiddleware } from "./server/middleware/editUndo";
import { kitPropsMiddleware } from "./server/middleware/kitProps";
import { versionMiddleware, logVersionOnBoot } from "./server/middleware/version";
import { telemetryIdentityMiddleware, setIdentitySnapshot } from "./server/middleware/telemetryIdentity";
import { awsLoginMiddleware } from "./server/middleware/awsLogin";
import { turnsMiddleware } from "./server/middleware/turns";
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
      server.middlewares.use(turnsMiddleware());
      server.middlewares.use(telemetryIdentityMiddleware());
      server.middlewares.use(awsLoginMiddleware());
      server.middlewares.use(devrevMiddleware());
      server.middlewares.use(settingsMiddleware());
      server.middlewares.use(cloudflareMiddleware());
      server.middlewares.use(projectsMiddleware());
      server.middlewares.use(templatesMiddleware());
      server.middlewares.use(framesMiddleware());
      server.middlewares.use(adoptUploadsMiddleware());
      server.middlewares.use(chatMiddleware());
      server.middlewares.use(visualEditMiddleware());
      server.middlewares.use(editUndoMiddleware());
      server.middlewares.use(kitPropsMiddleware());
      server.middlewares.use(figmaMiddleware());
      server.middlewares.use(uploadsMiddleware());
      server.middlewares.use(stagingUploadsMiddleware());
      server.middlewares.use(liftMiddleware());
      server.middlewares.use(exportMiddleware());
      server.middlewares.use(figmaExportMiddleware());
      server.middlewares.use(assetsMiddleware());
      server.middlewares.use(componentsMiddleware());
      server.middlewares.use(preflightMiddleware());
      server.middlewares.use(metricsMiddleware());
      server.middlewares.use(fontsMiddleware());
      server.middlewares.use(runtimeErrorMiddleware());
      attachBuildErrorReporter(server);
      void (async () => {
        try {
          const resourcesPath = process.env.ARCADE_RESOURCES_PATH;
          const packaged = process.env.ARCADE_IS_PACKAGED === "1";
          const fileConfig = await readFileConfig(resourcesPath);
          const config = resolveConfig({ packaged, debugEnv: process.env.ARCADE_TELEMETRY_DEBUG, fileConfig });

          const distinctId = await resolveDistinctId({
            readSettings: async () => (await readGlobalSettings()) as any,
            writeDistinctId: writeTelemetryDistinctId,
            resolveEmail: async () => {
              try {
                const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
                if (!pat) return null;
                return (await resolveDevuFromPat(pat))?.email ?? null;
              } catch { return null; }
            },
            genUuid: () => randomUUID(),
          });

          const version = process.env.ARCADE_APP_VERSION || process.env.npm_package_version || "0.0.0";
          const os = `${process.platform}-${process.arch}`;
          const sessionId = randomUUID();

          await initServerTelemetry({ config, distinctId, sessionId, version, os });
          setIdentitySnapshot({ distinctId, sessionId, version, os, config });
          const flush = () => { void shutdownServerTelemetry(); };
          process.once("SIGTERM", flush);
          process.once("SIGINT", flush);
          process.once("beforeExit", flush);
          if (config.debug || config.enabled) console.log(`[telemetry] server ready (enabled=${config.enabled} debug=${config.debug})`);
        } catch (err) {
          console.warn("[telemetry] server boot block failed:", err instanceof Error ? err.message : err);
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
  // In the packaged extension the app lives in a READ-ONLY install dir, so
  // Vite's default cacheDir (node_modules/.vite there) can't be written fresh —
  // it risks serving a stale dep-optimize cache and masking code updates after
  // a reinstall. When ARCADE_STUDIO_ROOT is set (packaged hosts), put the cache
  // under that writable per-version storage dir instead. Dev (env unset) keeps
  // the default.
  cacheDir: process.env.ARCADE_STUDIO_ROOT
    ? path.join(process.env.ARCADE_STUDIO_ROOT, `.vite-cache-${process.env.ARCADE_APP_VERSION || "dev"}`)
    : undefined,
  plugins: [injectStudioSourcePlugin(), kitManifestPlugin(), react(), tailwindcss(), frameMountPlugin(), projectWatchPlugin(), liftEmitPlugin(), apiPlugin()],
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: "arcade-studio",         replacement: path.resolve(__dirname, "src") },
      { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
      // User-saved components live in the writable studio root, resolved on
      // the fly like a generated frame. `arcade-user/Foo` → user-kit/composites/Foo.
      {
        find: /^arcade-user\/(.+)$/,
        replacement: path.join(
          process.env.ARCADE_STUDIO_ROOT ??
            path.join(os.homedir(), "Library", "Application Support", "arcade-studio"),
          "user-kit/composites/$1",
        ),
      },
    ],
  },
  server: {
    port: Number(process.env.ARCADE_STUDIO_PORT ?? 5556),
    // strictPort keeps a collision LOUD: the host spawns us on a specific
    // port and loads the renderer from it. Drift would load a DIFFERENT
    // server. The host (electron/viteRunner.ts, extension/serverHost.ts)
    // passes ARCADE_STUDIO_PORT; plain `pnpm run studio` defaults to 5556.
    strictPort: true,
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
