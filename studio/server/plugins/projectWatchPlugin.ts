import type { Plugin } from "vite";
import chokidar from "chokidar";
import path from "node:path";
import fs from "node:fs/promises";
import { projectsRoot } from "../paths";
import { reconcileFrames } from "../projects";
import {
  recordChatEventForReplay,
  type ProjectRef,
} from "../middleware/chatRelayMirror";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";

/**
 * Watches the projects root for frame writes/deletes and:
 *   1. Reconciles project frame state + triggers a Vite full-reload (existing behavior).
 *   2. Mirrors `frames/<frameId>/index.tsx` writes/deletes into the multiplayer
 *      relay's per-project replay buffer + live broadcast (Plan 2b, Task 8).
 *
 * Why mirror here and not in chat.ts: Claude writes frames to disk directly;
 * those events never flow through the chat middleware. The watcher is the only
 * place where we observe every frame mutation regardless of source.
 *
 * Host devu resolution is lazy + cached for the dev server's lifetime: we read
 * the DevRev PAT once from keychain, resolve it to a devu, then reuse that. If
 * no PAT is available the mirror silently no-ops (with a one-shot warn).
 */
export function projectWatchPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  // undefined = unresolved, null = resolved-but-no-PAT (don't retry), string = devu id
  let cachedHostDevu: string | null | undefined = undefined;
  let warnedNoPat = false;

  async function getHostDevu(): Promise<string | null> {
    if (cachedHostDevu !== undefined) return cachedHostDevu;
    try {
      const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
      if (!pat) {
        cachedHostDevu = null;
        if (!warnedNoPat) {
          console.warn(
            "[projectWatchPlugin] No DevRev PAT available — frame events won't mirror to multiplayer guests",
          );
          warnedNoPat = true;
        }
        return null;
      }
      const id = await resolveDevuFromPat(pat);
      cachedHostDevu = id?.id ?? null;
      return cachedHostDevu;
    } catch {
      cachedHostDevu = null;
      return null;
    }
  }

  return {
    name: "arcade-studio-project-watch",
    configureServer(server) {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", async (event, filePath) => {
        const rel = path.relative(projectsRoot(), filePath);
        const parts = rel.split(path.sep);
        const slug = parts[0];
        if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) return;

        // Multiplayer mirror: only `<slug>/frames/<frameId>/index.tsx`.
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
        if (!isFrameIndex) return;

        const host = await getHostDevu();
        if (!host) return;
        const ref: ProjectRef = { hostDevu: host, projectSlug: slug };
        const turnId = `file-watch-${Date.now()}`;

        try {
          if (event === "add" || event === "change") {
            const content = await fs.readFile(filePath, "utf-8");
            recordChatEventForReplay(ref, {
              type: "frame_written",
              path: frameId,
              content,
              turnId,
            });
          } else if (event === "unlink") {
            recordChatEventForReplay(ref, {
              type: "frame_deleted",
              path: frameId,
            });
          }
        } catch (err) {
          console.warn("[projectWatchPlugin] mirror failed:", err);
        }
      });
    },
    async closeBundle() {
      await watcher?.close();
    },
  };
}
