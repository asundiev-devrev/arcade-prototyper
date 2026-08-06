import { useCallback, useEffect, useState } from "react";

export interface LearnedRowView {
  id: string;
  fact: string;
  level: "global" | "project";
  hits: number;
  pinned?: boolean;
  /**
   * Whether this memory is actually reaching the generator. The rendered
   * LEARNED.md is capped per turn, so a large store can hold rows the agent
   * never sees. Server-computed; absent on older responses, treated as applied.
   */
  applied?: boolean;
}
export interface InventoryFrameView {
  slug: string;
  components: string[];
}
/** Structured — the server no longer sends the agent's raw INVENTORY.md here. */
export interface InventoryView {
  frames: InventoryFrameView[];
  composites: string[];
}
export interface MemorySnapshot {
  global: { rows: LearnedRowView[]; rules: string };
  project: { rows: LearnedRowView[]; rules: string };
  inventory: InventoryView;
}

type Status = "loading" | "ready" | "error";

export function useMemory(slug: string) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<MemorySnapshot | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setStatus("loading");
    fetch(`/api/memory?slug=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error("memory unavailable");
        return r.json();
      })
      .then((snap: MemorySnapshot) => {
        if (live) {
          setData(snap);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (live) setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  const patchRow = useCallback(
    async (row: LearnedRowView, patch: { fact?: string; pinned?: boolean; toLevel?: "global" | "project" }) => {
      setMutationError(null);
      try {
        const r = await fetch("/api/memory/row", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: row.level, slug, id: row.id, ...patch }),
        });
        if (!r.ok) {
          setMutationError("Couldn't save that change");
          return;
        }
        load();
      } catch {
        setMutationError("Couldn't save that change");
      }
    },
    [slug, load],
  );

  const deleteRow = useCallback(
    async (row: LearnedRowView) => {
      setMutationError(null);
      try {
        const r = await fetch("/api/memory/row", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: row.level, slug, id: row.id }),
        });
        if (!r.ok) {
          setMutationError("Couldn't forget that memory");
          return;
        }
        load();
      } catch {
        setMutationError("Couldn't forget that memory");
      }
    },
    [slug, load],
  );

  const saveRule = useCallback(
    async (level: "global" | "project", text: string) => {
      setMutationError(null);
      try {
        const r = await fetch("/api/memory/rule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, slug, text }),
        });
        if (!r.ok) {
          setMutationError("Couldn't save your rules");
          return;
        }
        load();
      } catch {
        setMutationError("Couldn't save your rules");
      }
    },
    [slug, load],
  );

  return { status, data, mutationError, refresh: load, patchRow, deleteRow, saveRule };
}
