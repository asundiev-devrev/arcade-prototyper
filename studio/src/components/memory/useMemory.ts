import { useCallback, useEffect, useState } from "react";

export interface LearnedRowView {
  id: string;
  fact: string;
  level: "global" | "project";
  hits: number;
  pinned?: boolean;
}
export interface MemorySnapshot {
  global: { rows: LearnedRowView[]; rules: string };
  project: { rows: LearnedRowView[]; rules: string };
  inventory: string;
}

type Status = "loading" | "ready" | "error";

export function useMemory(slug: string) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<MemorySnapshot | null>(null);

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
      await fetch("/api/memory/row", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: row.level, slug, id: row.id, ...patch }),
      });
      load();
    },
    [slug, load],
  );

  const deleteRow = useCallback(
    async (row: LearnedRowView) => {
      await fetch("/api/memory/row", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: row.level, slug, id: row.id }),
      });
      load();
    },
    [slug, load],
  );

  const saveRule = useCallback(
    async (level: "global" | "project", text: string) => {
      await fetch("/api/memory/rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, slug, text }),
      });
      load();
    },
    [slug, load],
  );

  return { status, data, refresh: load, patchRow, deleteRow, saveRule };
}
