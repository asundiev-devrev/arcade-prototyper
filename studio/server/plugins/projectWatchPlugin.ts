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

        // Frame source write: `<slug>/frames/<frameId>/<file>.tsx|.ts`.
        // parts === [slug, "frames", frameId, "<file>.tsx"]
        // This covers index.tsx AND sibling modules the index imports — an
        // ejected composite (`frames/<id>/ComputerScene.tsx`, imported by
        // index.tsx via `./ComputerScene`) is written a beat AFTER index.tsx,
        // so index.tsx's `./ComputerScene` resolution failed and Vite cached
        // the miss. Reloading only on index.tsx left that stale failure on
        // screen ("[vite:import-analysis] Failed to resolve ./ComputerScene")
        // until a manual restart. Reload on any frame-dir source file so the
        // sibling's arrival re-runs resolution. Still scoped to files DIRECTLY
        // in a frame dir (parts.length === 4) — NOT theme-overrides.css,
        // shared/*.ts, or root scaffold files, whose reloads used to race the
        // chat POST (see 0.23.6 regression / project-watch-full-reload-scope).
        const dir = parts[1];
        const frameId = parts[2];
        const fileName = parts[3];
        const isFrameSource =
          dir === "frames" &&
          !!frameId &&
          parts.length === 4 &&
          /\.(tsx|ts)$/.test(fileName);

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
          if (isFrameSource) {
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
