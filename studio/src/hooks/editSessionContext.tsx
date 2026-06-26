import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export const TOKEN_PREFIX = "tok:";
export function isTokenPending(v: string | undefined): boolean {
  return typeof v === "string" && v.startsWith(TOKEN_PREFIX);
}
export function tokenClass(v: string): string {
  return v.startsWith(TOKEN_PREFIX) ? v.slice(TOKEN_PREFIX.length) : v;
}

export interface StyleSnapshot {
  text: string;
  fontSize: string; fontWeight: string; fontStyle: string; textAlign: string;
  color: string; backgroundColor: string; borderColor: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  gap: string; width: string; height: string;
  minWidth: string; maxWidth: string; minHeight: string; maxHeight: string;
  display: string; flexDirection: string;
  opacity: string; borderRadius: string;
  appliedTokens: { color?: string; backgroundColor?: string; borderColor?: string; typeStyle?: string };
}
export type PendingEdits = Partial<Record<keyof StyleSnapshot | "typeStyle" | "iconSwap", string>>;

export interface ElementSelection {
  editId: number;
  file: string; line: number; column: number;
  componentName: string; tagName: string;
  textEditable: boolean;
  styles: StyleSnapshot;
  iconCandidate?: string;
  /** Named-component owner chain (innermost→outermost) with call-site files,
   *  for resolving the Customize target. */
  ownerChain: import("../frame/resolveCustomizeTarget").OwnerLink[];
}
export interface EditedElement {
  selection: ElementSelection;
  pending: PendingEdits;
}

const DEFAULT_WIDTH = 360;

interface Ctx {
  batch: EditedElement[];
  focusedEditId: number | null;
  frameSlug: string | null;
  frameWindow: Window | null;
  inspectorOpen: boolean;
  inspectorWidth: number;
  addOrFocus: (sel: ElementSelection, frameSlug: string, frameWindow: Window | null) => void;
  focus: (editId: number) => void;
  removeElement: (editId: number) => void;
  setField: (editId: number, key: keyof StyleSnapshot | "typeStyle" | "iconSwap", value: string) => void;
  resetField: (editId: number, key: keyof StyleSnapshot | "typeStyle" | "iconSwap") => void;
  /**
   * After a deterministic write that changed the frame's line count, shift the
   * stored source `line` of every held selection BELOW the edited line by the
   * net delta. Keeps subsequent edits targeting the right JSX node — a stale
   * line:column would otherwise miss in `locateJsx`. Selections at/above the
   * edited line are unaffected.
   */
  shiftSelectionsBelow: (editLine: number, delta: number) => void;
  clear: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorWidth: (px: number) => void;
}

const EditCtx = createContext<Ctx | null>(null);

export function EditSessionProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<EditedElement[]>([]);
  const [focusedEditId, setFocusedEditId] = useState<number | null>(null);
  const [frameSlug, setFrameSlug] = useState<string | null>(null);
  const [frameWindow, setFrameWindow] = useState<Window | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_WIDTH);

  const value = useMemo<Ctx>(
    () => ({
      batch, focusedEditId, frameSlug, frameWindow, inspectorOpen, inspectorWidth,
      addOrFocus: (sel, slug, win) => {
        setFrameSlug(slug);
        setFrameWindow(win);
        setBatch((b) =>
          b.some((e) => e.selection.editId === sel.editId)
            ? b
            : [...b, { selection: sel, pending: {} }],
        );
        setFocusedEditId(sel.editId);
      },
      focus: (id) => setFocusedEditId(id),
      removeElement: (id) => {
        const next = batch.filter((e) => e.selection.editId !== id);
        setBatch(next);
        setFocusedEditId((cur) =>
          cur === id ? (next.length ? next[next.length - 1].selection.editId : null) : cur,
        );
      },
      setField: (id, key, val) =>
        setBatch((b) =>
          b.map((e) =>
            e.selection.editId === id ? { ...e, pending: { ...e.pending, [key]: val } } : e,
          ),
        ),
      resetField: (id, key) =>
        setBatch((b) =>
          b.map((e) => {
            if (e.selection.editId !== id) return e;
            const pending = { ...e.pending };
            delete pending[key];
            return { ...e, pending };
          }),
        ),
      shiftSelectionsBelow: (editLine, delta) => {
        if (!delta) return;
        setBatch((b) =>
          b.map((e) =>
            e.selection.line > editLine
              ? { ...e, selection: { ...e.selection, line: e.selection.line + delta } }
              : e,
          ),
        );
      },
      clear: () => {
        setBatch([]);
        setFocusedEditId(null);
        setFrameSlug(null);
        setFrameWindow(null);
        setInspectorOpen(false);
      },
      setInspectorOpen,
      setInspectorWidth,
    }),
    [batch, focusedEditId, frameSlug, frameWindow, inspectorOpen, inspectorWidth],
  );
  return <EditCtx.Provider value={value}>{children}</EditCtx.Provider>;
}

export function useEditSession(): Ctx {
  const ctx = useContext(EditCtx);
  if (!ctx) throw new Error("useEditSession must be used inside <EditSessionProvider>");
  return ctx;
}
