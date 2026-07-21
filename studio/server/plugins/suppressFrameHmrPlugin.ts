import type { Plugin } from "vite";
import { isFrameSourcePath } from "./projectWatchPlugin";

/**
 * Suppress Vite's React Fast-Refresh HMR for FRAME-SOURCE files only, so the
 * resilient-render double-buffer in FrameCard.tsx actually holds the last-good
 * render.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * FrameCard double-buffers each frame: a committed (visible, last-good) iframe
 * plus a hidden incoming "probe" iframe, swapping only on a clean-mount signal.
 * Hold-last-good is driven entirely through each iframe's `src` (a reload nonce
 * `&n=`).
 *
 * BUT the committed iframe also imports the SAME frame module node as the probe
 * (both bootstrap modules do `import Frame from "<absFrame>"`, see
 * frameMountPlugin.ts). So when the agent writes a broken
 * `frames/<id>/index.tsx`, Vite's Fast Refresh pushes a hot update to EVERY
 * client importing that module — including the committed iframe — hot-swapping
 * the broken component IN PLACE (no `src` change) and painting the
 * "Auto-repairing this frame" panel over the VISIBLE, previously-good frame.
 * The `src`-based double-buffer is powerless against an in-place module swap.
 *
 * Our own `projectWatchPlugin` chokidar watcher is the SOLE intended reload
 * channel: on a frame write it invalidates the module graph and fires the
 * targeted `arcade-studio:frame-changed` event, which mounts the hidden probe
 * that then does a full document fetch of the new module (the spec's "refetch
 * the HTML endpoint, NOT a soft HMR poke" invariant). Vite's Fast Refresh is a
 * SECOND, unwanted channel for frame modules — this plugin closes it.
 *
 * ── Mechanism (Vite 8 / rolldown-vite) ─────────────────────────────────────
 * `hotUpdate` runs in Vite core's `handleHMRUpdate`. For each plugin in sorted
 * order, if the hook returns a truthy value, core assigns
 * `options.modules = <returned>`. The LAST truthy return wins. So a suppressor
 * (one that returns `[]` to prevent HMR) must run LAST to have the final say —
 * this plugin is `enforce: "post"` so our `[]` is the final assignment and no
 * later plugin can re-populate the frame module set.
 *
 * The subsequent `hmr()` step early-returns without sending any update payload
 * when `options.modules.length === 0` (for non-.html files). So returning `[]`
 * empties the module set → NO `update` payload is broadcast → the client's
 * Fast-Refresh accept boundary never fires → the committed iframe is never hot-
 * swapped. `@vitejs/plugin-react` registers no `hotUpdate` hook (its Fast
 * Refresh rides on core's dispatch), and `@tailwindcss/vite` has a `hotUpdate`
 * hook but it bails on non-asset JS modules (returns undefined for .tsx). By
 * running post, we guarantee we have the final say regardless of what
 * tailwind's or any future plugin's hotUpdate returns.
 *
 * Returning `undefined` for every other file preserves DEFAULT handling — CSS
 * HMR, shared/*.ts module HMR, theme-overrides, and all studio shell source are
 * untouched. Scoping is delegated to `isFrameSourcePath` (shared with
 * projectWatchPlugin) so the two stay in lockstep.
 */
export function suppressFrameHmrPlugin(): Plugin {
  return {
    name: "arcade-studio-suppress-frame-hmr",
    enforce: "post",
    hotUpdate({ file }) {
      // Frame-source file → return [] = "handled, propagate nothing" = HMR
      // suppressed. Anything else → return undefined = default HMR handling.
      if (isFrameSourcePath(file)) return [];
      return undefined;
    },
  };
}
