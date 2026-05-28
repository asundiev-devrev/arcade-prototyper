import { useCallback, useEffect, useState } from "react";
import type { Project, Frame } from "../../server/types";

/**
 * Polling adapter for a host-owned project. Refreshes every 1.5s against
 * `/api/projects/:slug` so frames the agent writes appear without a manual
 * refresh.
 *
 * Spectator-mode callers must pass `{ enabled: false }`: the host endpoint
 * 404s for spectator routes (the shared-projects mirror is the source of
 * truth there), and even if it didn't, the polled snapshot would clobber
 * the live SSE state arriving via `useProjectFromMirror`. When disabled,
 * the hook returns `project.frames` verbatim and skips both fetch + timer.
 */
export function useFrames(
  project: Project,
  opts?: { enabled?: boolean },
) {
  const enabled = opts?.enabled !== false;
  const [frames, setFrames] = useState<Frame[]>(project.frames);

  // When `enabled` is false, surface the latest `project.frames` from the
  // caller (spectator's mirror SSE feeds these via `useProjectFromMirror`).
  // Without this sync, the readonly viewport would stay frozen at whatever
  // frames the project had on first mount.
  useEffect(() => {
    if (!enabled) setFrames(project.frames);
  }, [enabled, project.frames]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const res = await fetch(`/api/projects/${project.slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    setFrames(p.frames);
  }, [project.slug, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh, enabled]);

  return { frames, refresh };
}
