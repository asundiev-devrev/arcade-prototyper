import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { studioRoot } from "./server/paths";
import { projectsMiddleware } from "./server/middleware/projects";
import { chatMiddleware } from "./server/middleware/chat";
import { critiqueMiddleware } from "./server/middleware/critique";
import { figmaMiddleware } from "./server/middleware/figma";
import { uploadsMiddleware } from "./server/middleware/uploads";
import { preflightMiddleware } from "./server/middleware/preflight";
import { fontsMiddleware } from "./server/middleware/fonts";
import { devrevMiddleware } from "./server/middleware/devrev";
import { settingsMiddleware } from "./server/middleware/settings";
import { thumbnailsMiddleware } from "./server/middleware/thumbnails";
import { vercelMiddleware } from "./server/middleware/vercel";
import { runtimeErrorMiddleware } from "./server/middleware/runtimeError";
import { versionMiddleware, logVersionOnBoot } from "./server/middleware/version";
import { frameMountPlugin } from "./server/plugins/frameMountPlugin";
import { projectWatchPlugin } from "./server/plugins/projectWatchPlugin";
import { injectStudioSourcePlugin } from "./server/plugins/injectStudioSourcePlugin";
import { kitManifestPlugin } from "./server/plugins/kitManifestPlugin";
import { attachBuildErrorReporter } from "./server/buildErrorReporter";
import { refreshStaleClaudeMd } from "./server/projects";

function apiPlugin(): import("vite").Plugin {
  return {
    name: "arcade-studio-api",
    configureServer(server) {
      server.middlewares.use(versionMiddleware());
      server.middlewares.use(devrevMiddleware());
      server.middlewares.use(settingsMiddleware());
      server.middlewares.use(vercelMiddleware());
      // critiqueMiddleware must be registered before projectsMiddleware
      // because projects claims all /api/projects/* URLs and 405s on any
      // path it doesn't recognize, shadowing sub-routes.
      server.middlewares.use(critiqueMiddleware());
      server.middlewares.use(projectsMiddleware());
      server.middlewares.use(chatMiddleware());
      server.middlewares.use(figmaMiddleware());
      server.middlewares.use(uploadsMiddleware());
      server.middlewares.use(thumbnailsMiddleware());
      server.middlewares.use(preflightMiddleware());
      server.middlewares.use(fontsMiddleware());
      server.middlewares.use(runtimeErrorMiddleware());
      attachBuildErrorReporter(server);
      void logVersionOnBoot();
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
  plugins: [injectStudioSourcePlugin(), kitManifestPlugin(), react(), tailwindcss(), frameMountPlugin(), projectWatchPlugin(), apiPlugin()],
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: "@xorkavi/arcade-gen" },
      { find: /^arcade$/, replacement: "@xorkavi/arcade-gen" },
      { find: "arcade-studio", replacement: path.resolve(__dirname, "src") },
      { find: "arcade-prototypes", replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
  server: {
    port: 5556,
    open: true,
    fs: {
      allow: [path.resolve(__dirname, ".."), studioRoot()],
    },
  },
});
