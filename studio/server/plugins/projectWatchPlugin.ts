import type { Plugin } from "vite";
import chokidar from "chokidar";
import path from "node:path";
import { projectsRoot } from "../paths";
import { reconcileFrames } from "../projects";

/**
 * Evict a file — and every module that imports it — from Vite's module graph
 * so the next request RE-RESOLVES from disk instead of replaying a cached
 * result. This is the server-side half of a frame reload: `ws.send full-reload`
 * only re-runs the CLIENT, but Vite caches import resolution on the server, so
 * a frame whose `./ComputerScene` failed to resolve (because the ejected
 * sibling landed a beat later) replays that cached "Failed to resolve" transform
 * error even after the file exists — until its module node is invalidated. Both
 * the written file AND its importers must be invalidated: the importer
 * (index.tsx) is the one holding the stale negative resolution of the sibling.
 * Best-effort + defensive: the moduleGraph API differs across Vite majors and a
 * miss here just means the old (harmless) reload-only behaviour.
 */
function invalidateFileInModuleGraph(server: any, filePath: string): void {
  try {
    const mg = server?.moduleGraph;
    if (!mg?.getModulesByFile || !mg?.invalidateModule) return;
    const seed: Set<any> = mg.getModulesByFile(filePath) ?? new Set();
    for (const mod of seed) {
      mg.invalidateModule(mod);
      // Importers hold the stale resolution of `mod` — invalidate them too so
      // `./ComputerScene` is re-resolved now that the sibling is on disk.
      for (const importer of mod.importers ?? []) mg.invalidateModule(importer);
    }
  } catch {
    // Non-fatal: fall back to reload-only.
  }
}

/**
 * True iff `filePath` is a frame-source CODE module anywhere under a project
 * frame dir: `<projectsRoot>/<slug>/frames/<frameId>/…/<file>.tsx|.ts`.
 *
 * Single source of truth for "is this a frame's own source file". Two callers
 * depend on it staying identical:
 *   1. `handleProjectWatchEvent` (below) — decides whether to fire the targeted
 *      `frame-changed` reload (our SOLE intended frame-reload channel).
 *   2. `suppressFrameHmrPlugin` — suppresses Vite's Fast-Refresh HMR for exactly
 *      these files, so the committed (last-good) iframe can't be hot-swapped
 *      in place behind the resilient-render double-buffer's back.
 *
 * Scoped to CODE modules anywhere under the frame dir:
 * `<slug>/frames/<frameId>/…/<file>.tsx|.ts` at ANY depth — covers index.tsx,
 * ejected siblings (`ComputerScene.tsx`), AND nested code (`pages/Skills.tsx`,
 * `components/Row.ts`) the frame imports. Real frames eject nested `pages/`
 * modules; a broken edit to one must route through the resilient reload path
 * like index.tsx, or Vite Fast-Refresh hot-swaps it into the visible iframe
 * (white screen — the resilient-render safety net never engages).
 * EXCLUDED: theme-overrides.css, shared/*.ts, root scaffold, and the frame's
 * top-level `assets/` dir (`frames/<id>/assets/*` — images/svgs referenced by
 * URL, copied files not imported modules). NOTE the exclusion is the TOP-LEVEL
 * assets dir ONLY (`parts[3]`), not an `assets` segment at any depth: a nested
 * CODE module like `pages/assets/Library.tsx` (a designer's asset-browser page)
 * is real frame source and MUST stay protected — matching `assets` anywhere
 * re-opened the white-screen for that layout.
 */
export function isFrameSourcePath(filePath: string): boolean {
  const rel = path.relative(projectsRoot(), filePath);
  // Outside the projects root (e.g. any studio shell source) → not a frame file.
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  const slug = parts[0];
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) return false;
  // parts === [slug, "frames", frameId, …nested…, "<file>.tsx|.ts"]
  if (parts[1] !== "frames" || !parts[2] || parts.length < 4) return false;
  // Exclude the frame's TOP-LEVEL assets dir only (frames/<id>/assets/*).
  if (parts[3] === "assets") return false;
  return /\.(tsx|ts)$/.test(parts[parts.length - 1]);
}

/**
 * Exported handler for project watch events. Extracted for testability.
 * Reconciles project frame state on tsx/ts/css writes, and sends targeted
 * reload events for frame-source changes.
 */
export async function handleProjectWatchEvent(
  event: string,
  filePath: string,
  server: any,
): Promise<void> {
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
  // until a manual restart. Reload on any frame CODE module — at any depth
  // under the frame dir (index.tsx, ejected siblings, nested pages/*.tsx) so
  // the sibling's arrival re-runs resolution and a nested-module edit still
  // routes through the resilient reload path. Scoping (incl. the assets/ and
  // scaffold exclusions that used to race the chat POST — 0.23.6 regression /
  // project-watch-full-reload-scope) lives in isFrameSourcePath. frameId is
  // always parts[2] (the frame dir), regardless of nesting depth.
  const frameId = parts[2];
  const isFrameSource = isFrameSourcePath(filePath);

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
      // Evict the stale server-side resolution BEFORE reloading the
      // client, so the client's refetch re-resolves against the file that
      // now exists. Invalidate the written file (e.g. the ejected
      // ComputerScene.tsx) — invalidateFileInModuleGraph also walks its
      // importers, which is where index.tsx's cached `./ComputerScene`
      // miss lives. Also invalidate the frame's index.tsx explicitly, in
      // case the write we saw WAS index.tsx and it cached a sibling miss.
      invalidateFileInModuleGraph(server, filePath);
      invalidateFileInModuleGraph(
        server,
        path.join(projectsRoot(), slug, "frames", frameId, "index.tsx"),
      );
      // Targeted per-frame reload: the shell + other frames + chat + scroll
      // stay alive; only the changed frame's iframe refetches. Replaces the
      // shell-wide `full-reload` that destroyed the viewport on every edit.
      server.ws.send({
        type: "custom",
        event: "arcade-studio:frame-changed",
        data: { slug, frameId },
      });
    }
  }
}

/**
 * Watches the projects root for frame writes/deletes and:
 *   1. Reconciles project frame state on any tsx/ts/css change.
 *   2. Invalidates the written frame module + its importers in Vite's module
 *      graph, then triggers a full-reload, scoped to `frames/<frameId>/*.tsx|ts`
 *      writes so the viewport picks up newly generated frames AND ejected
 *      sibling modules.
 */
export function projectWatchPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;

  return {
    name: "arcade-studio-project-watch",
    configureServer(server) {
      // Watcher must not traverse the global-memory symlink inside each project —
      // only care about files inside the project itself.
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6, followSymlinks: false });
      watcher.on("all", async (event, filePath) => handleProjectWatchEvent(event, filePath, server));
    },
    async closeBundle() {
      await watcher?.close();
    },
  };
}
