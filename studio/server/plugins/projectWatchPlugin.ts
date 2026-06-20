import type { Plugin } from "vite";
import chokidar from "chokidar";
import path from "node:path";
import { projectsRoot } from "../paths";
import { reconcileFrames } from "../projects";

/**
 * Watches the projects root for frame writes/deletes and:
 *   1. Reconciles project frame state on any tsx/ts/css change.
 *   2. Triggers a Vite full-reload, scoped to `frames/<frameId>/index.tsx`
 *      writes so the viewport picks up newly generated frames.
 */
export function projectWatchPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;

  return {
    name: "arcade-studio-project-watch",
    configureServer(server) {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", async (event, filePath) => {
        const rel = path.relative(projectsRoot(), filePath);
        const parts = rel.split(path.sep);
        const slug = parts[0];
        if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) return;

        // Frame index write: `<slug>/frames/<frameId>/index.tsx`.
        // parts === [slug, "frames", frameId, "index.tsx"]
        const dir = parts[1];
        const frameId = parts[2];
        const fileName = parts[3];
        const isFrameIndex =
          dir === "frames" &&
          !!frameId &&
          fileName === "index.tsx" &&
          parts.length === 4;

        // Reconcile project frame state on any tsx/ts/css change (covers
        // shared/*.ts deletes, theme-overrides.css edits, frame
        // adds/removes). Cheap, idempotent, no client visibility.
        if (/\.(tsx|ts|css)$/.test(filePath)) {
          try {
            await reconcileFrames(slug);
          } catch (err) {
            console.warn(`[projectWatchPlugin] reconcileFrames(${slug}) failed:`, err);
          }
          // Full page reload, however, must be scoped to frame writes only.
          // Earlier this fired on every tsx/ts/css change — including the
          // scaffold-time writes for `theme-overrides.css` and `shared/devrev.ts`
          // that createProject performs as the user navigates from the home
          // hero into the new project. The `full-reload` broadcast was landing
          // while the route effect's POST /api/chat request was in flight, the
          // browser tore the connection down on reload, and the turn never
          // started server-side — leaving the chat pane idle until the agent
          // happened to flush a frame much later. Vite's normal HMR handles
          // the rest (CSS hot-replaces; shared/*.ts is module-graph HMR).
          if (isFrameIndex) {
            server.ws.send({ type: "full-reload", path: "*" });
          }
        }
      });
    },
    async closeBundle() {
      await watcher?.close();
    },
  };
}
