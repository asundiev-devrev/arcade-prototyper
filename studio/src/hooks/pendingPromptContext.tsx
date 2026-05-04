import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

export interface PendingPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

export interface PendingPromptContextValue {
  set: (p: PendingPrompt) => void;
  consume: () => PendingPrompt | null;
}

const Ctx = createContext<PendingPromptContextValue | null>(null);

export function PendingPromptProvider({ children }: { children: ReactNode }) {
  const boxRef = useRef<PendingPrompt | null>(null);
  const value = useMemo<PendingPromptContextValue>(
    () => ({
      set: (p) => { boxRef.current = p; },
      consume: () => {
        const v = boxRef.current;
        boxRef.current = null;
        return v;
      },
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePendingPrompt(): PendingPromptContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePendingPrompt must be used inside <PendingPromptProvider>");
  return ctx;
}
