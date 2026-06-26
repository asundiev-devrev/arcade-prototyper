import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type EditBlockKind = "instant" | "ai";
export type EditBlockStatus = "applied" | "pending" | "working" | "error" | "undone";
export interface EditBlock {
  id: string; label: string; kind: EditBlockKind; status: EditBlockStatus; frameSlug: string;
}

interface Ctx {
  blocks: EditBlock[];
  addBlock: (b: Omit<EditBlock, "id">) => string;
  setStatus: (id: string, status: EditBlockStatus) => void;
  removeBlock: (id: string) => void;
}
const BlocksCtx = createContext<Ctx | null>(null);

export function EditBlocksProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState<EditBlock[]>([]);
  const counter = useRef(0);
  const value = useMemo<Ctx>(() => ({
    blocks,
    addBlock: (b) => {
      const id = `blk-${++counter.current}`;
      setBlocks((prev) => [...prev, { ...b, id }]);
      return id;
    },
    setStatus: (id, status) => setBlocks((prev) => prev.map((x) => x.id === id ? { ...x, status } : x)),
    removeBlock: (id) => setBlocks((prev) => prev.filter((x) => x.id !== id)),
  }), [blocks]);
  return <BlocksCtx.Provider value={value}>{children}</BlocksCtx.Provider>;
}

export function useEditBlocks(): Ctx {
  const ctx = useContext(BlocksCtx);
  if (!ctx) throw new Error("useEditBlocks must be used inside <EditBlocksProvider>");
  return ctx;
}
