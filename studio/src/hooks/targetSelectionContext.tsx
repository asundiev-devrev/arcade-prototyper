import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface TargetSelection {
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  /** Slug of the frame the element was picked from. */
  frameSlug: string;
}

interface Ctx {
  target: TargetSelection | null;
  setTarget: (t: TargetSelection | null) => void;
  clear: () => void;
}

const TargetCtx = createContext<Ctx | null>(null);

export function TargetSelectionProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<TargetSelection | null>(null);
  const value = useMemo<Ctx>(
    () => ({ target, setTarget, clear: () => setTarget(null) }),
    [target],
  );
  return <TargetCtx.Provider value={value}>{children}</TargetCtx.Provider>;
}

export function useTargetSelection(): Ctx {
  const ctx = useContext(TargetCtx);
  if (!ctx) {
    throw new Error("useTargetSelection must be used inside <TargetSelectionProvider>");
  }
  return ctx;
}
