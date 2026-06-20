import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal, Button, Input } from "@xorkavi/arcade-gen";

/**
 * In-app replacements for the browser's native confirm()/prompt().
 *
 * Why this exists: native window.confirm/prompt/alert are NO-OPS inside an
 * embedded webview (the Cursor / VS Code extension hosts the studio shell in a
 * sandboxed webview iframe). confirm() silently returns false, so destructive
 * actions gated on it never run, and prompt() returns null. These promise-based
 * dialogs render with the design-system Modal and work in every host.
 *
 * Usage:
 *   const { confirm, promptText } = useDialogs();
 *   if (!(await confirm({ title: `Delete "${name}"?`, confirmLabel: "Delete", destructive: true }))) return;
 *   const next = await promptText({ title: "Rename", defaultValue: name });
 */

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button as destructive (red). */
  destructive?: boolean;
};

type PromptOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogsApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolves to the trimmed string, or null if cancelled / left empty. */
  promptText: (opts: PromptOptions) => Promise<string | null>;
};

const DialogsContext = createContext<DialogsApi | null>(null);

type ConfirmState = ConfirmOptions & { kind: "confirm"; resolve: (v: boolean) => void };
type PromptState = PromptOptions & { kind: "prompt"; resolve: (v: string | null) => void };
type DialogState = ConfirmState | PromptState | null;

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");
  // Hold the active resolver so closing via overlay/escape resolves too.
  const resolvedRef = useRef(false);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolvedRef.current = false;
      setDialog({ kind: "confirm", ...opts, resolve });
    });
  }, []);

  const promptText = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolvedRef.current = false;
      setPromptValue(opts.defaultValue ?? "");
      setDialog({ kind: "prompt", ...opts, resolve });
    });
  }, []);

  const api = useMemo<DialogsApi>(() => ({ confirm, promptText }), [confirm, promptText]);

  // Resolve with a "cancel" value if the user dismisses without choosing.
  const settle = useCallback(
    (value: boolean | string | null) => {
      if (!dialog || resolvedRef.current) return;
      resolvedRef.current = true;
      if (dialog.kind === "confirm") (dialog.resolve as (v: boolean) => void)(value as boolean);
      else (dialog.resolve as (v: string | null) => void)(value as string | null);
      setDialog(null);
    },
    [dialog],
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      // Dismissed (overlay click / escape) → cancel.
      settle(dialog?.kind === "prompt" ? null : false);
    },
    [dialog, settle],
  );

  return (
    <DialogsContext.Provider value={api}>
      {children}
      <Modal.Root open={dialog !== null} onOpenChange={onOpenChange}>
        {dialog && (
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{dialog.title}</Modal.Title>
              {dialog.description ? (
                <Modal.Description>{dialog.description}</Modal.Description>
              ) : null}
            </Modal.Header>
            {dialog.kind === "prompt" ? (
              <Modal.Body>
                <Input
                  autoFocus
                  value={promptValue}
                  placeholder={dialog.placeholder}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = promptValue.trim();
                      settle(v ? v : null);
                    }
                  }}
                />
              </Modal.Body>
            ) : null}
            <Modal.Footer>
              <Button
                variant="tertiary"
                onClick={() => settle(dialog.kind === "prompt" ? null : false)}
              >
                {dialog.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={
                  dialog.kind === "confirm" && dialog.destructive ? "destructive" : "primary"
                }
                onClick={() => {
                  if (dialog.kind === "prompt") {
                    const v = promptValue.trim();
                    settle(v ? v : null);
                  } else {
                    settle(true);
                  }
                }}
              >
                {dialog.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        )}
      </Modal.Root>
    </DialogsContext.Provider>
  );
}

/**
 * Fallback used only when no <DialogsProvider> is mounted — e.g. in unit tests
 * that render a component in isolation. Delegates to the native dialogs (which
 * work in jsdom). The real app always mounts the provider in App.tsx, so this
 * path never runs in production / the webview.
 */
const NATIVE_FALLBACK: DialogsApi = {
  confirm: (opts) =>
    Promise.resolve(
      window.confirm(opts.description ? `${opts.title}\n\n${opts.description}` : opts.title),
    ),
  promptText: (opts) => {
    const v = window.prompt(opts.title, opts.defaultValue ?? "");
    const trimmed = v?.trim();
    return Promise.resolve(trimmed ? trimmed : null);
  },
};

export function useDialogs(): DialogsApi {
  return useContext(DialogsContext) ?? NATIVE_FALLBACK;
}
