import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface StyleSnapshot {
  text: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  width: string; height: string;
}

export type PendingEdits = Partial<Record<keyof StyleSnapshot, string>>;

export interface TargetSelection {
  file: string;
  line: number;
  column: number;
  componentName: string;
  tagName: string;
  /** Slug of the frame the element was picked from. */
  frameSlug: string;
  /** Computed-style snapshot read at pick time, used to seed the panel. */
  styles: StyleSnapshot;
}

interface Ctx {
  target: TargetSelection | null;
  setTarget: (t: TargetSelection | null) => void;
  clear: () => void;
  pending: PendingEdits;
  setPendingField: (key: keyof StyleSnapshot, value: string) => void;
  resetPendingField: (key: keyof StyleSnapshot) => void;
  clearPending: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  frameWindow: Window | null;
  setFrameWindow: (w: Window | null) => void;
}

const TargetCtx = createContext<Ctx | null>(null);

export function TargetSelectionProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<TargetSelection | null>(null);
  const [pending, setPending] = useState<PendingEdits>({});
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [frameWindow, setFrameWindow] = useState<Window | null>(null);

  const value = useMemo<Ctx>(
    () => ({
      target,
      setTarget: (t) => {
        // Switching targets must drop any pending edits from the old one.
        setPending({});
        setTargetState(t);
      },
      clear: () => {
        setTargetState(null);
        setPending({});
        setInspectorOpen(false);
        setFrameWindow(null);
      },
      pending,
      setPendingField: (key, val) => setPending((p) => ({ ...p, [key]: val })),
      resetPendingField: (key) =>
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        }),
      clearPending: () => setPending({}),
      inspectorOpen,
      setInspectorOpen,
      frameWindow,
      setFrameWindow,
    }),
    [target, pending, inspectorOpen, frameWindow],
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
