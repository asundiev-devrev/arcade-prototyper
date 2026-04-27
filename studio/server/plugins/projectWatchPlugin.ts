import type { Plugin } from "vite";
import chokidar from "chokidar";
import path from "node:path";
import { projectsRoot } from "../paths";
import { reconcileFrames } from "../projects";

export function projectWatchPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  return {
    name: "arcade-studio-project-watch",
    configureServer(server) {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", async (_event, filePath) => {
        const rel = path.relative(projectsRoot(), filePath);
        const [slug] = rel.split(path.sep);
        if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) return;
        if (/\.(tsx|ts|css)$/.test(filePath)) {
          try {
            await reconcileFrames(slug);
          } catch (err) {
            console.warn(`[projectWatchPlugin] reconcileFrames(${slug}) failed:`, err);
          }
          server.ws.send({ type: "full-reload", path: "*" });
        }
      });
    },
    async closeBundle() { await watcher?.close(); },
  };
}
