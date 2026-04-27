import { useCallback, useEffect, useState } from "react";
import type { Project, Frame } from "../../server/types";

export function useFrames(project: Project) {
  const [frames, setFrames] = useState<Frame[]>(project.frames);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    setFrames(p.frames);
  }, [project.slug]);

  useEffect(() => {
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  return { frames, refresh };
}
