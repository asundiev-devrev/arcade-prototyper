/**
 * ChatInput — Computer / Agent Studio chat input composite.
 *
 * Matches Figma "Computer Input Field" (component set 153:8373 in the
 * "Untitled" prototype file). A full-width command bar flush with the
 * bottom of the chat body: no shadow, no rounded corners, just a top
 * border separating it from the conversation above.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [Context chip] [File ✓] [File 40%] ...         ← attachments │
 *   │ [Logo] Ask me anything             [+]   [↑/■] ← input row   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - The bar spans the full chat-column width and hugs the bottom (no
 *   fixed width pill, no drop shadow, no rounded corners). The caller
 *   should NOT wrap it in extra padding — render it as a direct child
 *   of the chat column, below the scrolling body.
 * - Attachments sit above the input row when present and horizontally
 *   scroll if they overflow.
 * - Leading defaults to the arcade `Computer` logomark (the product mark
 *   shown on the left of the input pill in Figma). Pass `leading` to
 *   override with a different product logo or custom mark.
 * - Trailing is a slot — the caller decides which buttons to render
 *   (add + send, or add + stop when streaming, or just +, etc.).
 *   Three helpers are provided: ChatInput.AddAttachmentButton,
 *   ChatInput.SendButton, ChatInput.StopButton.
 *
 * Slots:
 * - `attachments` (optional) — a row of <ChatInput.ContextAttachment /> or
 *   <ChatInput.FileAttachment />. Hidden when not provided.
 * - `leading` (optional) — icon/mark on the far left. Defaults to the
 *   arcade `<Computer />` logomark.
 * - `trailing` (optional) — action buttons on the far right. Typically one
 *   or two of the helpers below. When not provided, no trailing buttons
 *   are rendered.
 * - `placeholder` (optional) — input placeholder, default "Ask me anything".
 * - `value`, `onChange` (optional) — controlled input. Uncontrolled if omitted.
 * - `inputRef` (optional) — forward to the underlying <input>.
 *
 * Compound:
 * - `ChatInput.ContextAttachment` — dashed-border chip for external-service
 *   contexts (Notion tab, URL, etc.). Props: icon, title, subtitle.
 * - `ChatInput.FileAttachment` — solid-border card for a file. Props: kind
 *   (e.g. "PDF"), name, progress (number 0-100 → renders Uploading overlay;
 *   omit → Indexed state).
 * - `ChatInput.AddAttachmentButton` — the "+" icon button.
 * - `ChatInput.SendButton` — filled accent circle with an up-arrow.
 * - `ChatInput.StopButton` — secondary circle with a stop square.
 */
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button, IconButton, ArrowUpSmall, PlusSmall, Computer } from "@xorkavi/arcade-gen";

/**
 * Inline pause-glyph (two vertical bars) used by the default ChatInput leading
 * when the caller doesn't override. Mirrors the colleague Computer prototype.
 */
function PauseGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="4" y="3.5" width="2.25" height="9" rx="0.75" />
      <rect x="9.75" y="3.5" width="2.25" height="9" rx="0.75" />
    </svg>
  );
}

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = {
  attachments?: ReactNode;
  /**
   * Optional hint row rendered ABOVE the input row — used for status text like
   * "This session is filling up. Start a fresh session in this topic?". When
   * set, renders centered, muted text with optional inline link.
   */
  hint?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit?: (value: string) => void;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  autoFocus?: boolean;
  /**
   * When true, renders a textarea that grows with content (up to `maxRows`)
   * instead of a single-line input. Enter submits; Shift+Enter inserts a
   * newline. Defaults to false to preserve existing single-line behavior.
   */
  multiline?: boolean;
  /** Max visible rows before the textarea starts scrolling. Default 8. */
  maxRows?: number;
};

function Root({
  attachments,
  hint,
  leading,
  trailing,
  placeholder = "Ask me anything",
  value,
  defaultValue,
  onChange,
  onSubmit,
  inputRef,
  autoFocus,
  multiline = false,
  maxRows = 8,
}: RootProps) {
  return (
    <div className="flex flex-col gap-2 w-full px-4 py-3 border-t border-(--stroke-neutral-subtle) bg-(--surface-overlay)">
      {attachments ? (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
          {attachments}
        </div>
      ) : null}
      {hint ? (
        <div className="flex items-center justify-center text-caption text-(--fg-neutral-subtle) px-2">
          {hint}
        </div>
      ) : null}
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 flex items-center justify-center text-(--fg-neutral-prominent)">
          {leading ?? <DefaultLeading />}
        </span>
        {multiline ? (
          <AutoGrowTextarea
            ref={inputRef as Ref<HTMLTextAreaElement>}
            value={value}
            defaultValue={defaultValue}
            placeholder={placeholder}
            onChange={onChange as (e: ChangeEvent<HTMLTextAreaElement>) => void}
            onSubmit={onSubmit}
            autoFocus={autoFocus}
            maxRows={maxRows}
          />
        ) : (
          <input
            ref={inputRef as Ref<HTMLInputElement>}
            type="text"
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            onChange={onChange as (e: ChangeEvent<HTMLInputElement>) => void}
            autoFocus={autoFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && onSubmit) {
                e.preventDefault();
                onSubmit((e.target as HTMLInputElement).value);
              }
            }}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-body text-(--fg-neutral-prominent) placeholder:text-(--fg-neutral-subtle)"
          />
        )}
        {trailing ? (
          <div className="shrink-0 flex items-center gap-1">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Auto-growing textarea (used when multiline=true) ──────────────────── */

type AutoGrowTextareaProps = {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit?: (value: string) => void;
  autoFocus?: boolean;
  maxRows: number;
};

const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea(
    { value, defaultValue, placeholder, onChange, onSubmit, autoFocus, maxRows },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLTextAreaElement | null>(null);

    const setRef = (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: HTMLTextAreaElement | null }).current = node;
    };

    useLayoutEffect(() => {
      const el = localRef.current;
      if (!el) return;
      el.style.height = "auto";
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const max = lineHeight * maxRows;
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [value, maxRows]);

    return (
      <textarea
        ref={setRef}
        rows={1}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && onSubmit) {
            e.preventDefault();
            onSubmit((e.target as HTMLTextAreaElement).value);
          }
        }}
        className="flex-1 min-w-0 resize-none bg-transparent border-0 outline-none text-body text-(--fg-neutral-prominent) placeholder:text-(--fg-neutral-subtle) leading-[1.4]"
      />
    );
  },
);

/* ─── Default leading (pause glyph — matches colleague Computer prototype) ─ */

function DefaultLeading() {
  return (
    <button
      type="button"
      aria-label="Pause"
      className="flex items-center justify-center w-8 h-8 rounded-square text-(--fg-neutral-subtle) hover:bg-(--bg-neutral-soft) hover:text-(--fg-neutral-prominent) transition-colors"
    >
      <PauseGlyph size={16} />
    </button>
  );
}

/** Opt-in Computer logomark leading. Pass `leading={<ChatInput.ComputerLogo />}`. */
function ComputerLogo() {
  return <Computer size={20} />;
}

/* ─── Attachments ───────────────────────────────────────────────────────── */

type ContextAttachmentProps = {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
};

function ContextAttachment({ icon, title, subtitle }: ContextAttachmentProps) {
  return (
    <div className="shrink-0 w-24 h-[66px] rounded-square-x2 border border-dashed border-(--stroke-neutral-subtle) bg-(--bg-neutral-soft) p-2 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 w-4 h-4 flex items-center justify-center text-(--fg-neutral-prominent)">
          {icon}
        </span>
        {subtitle ? (
          <span className="text-caption text-(--fg-neutral-subtle) truncate">
            {subtitle}
          </span>
        ) : null}
      </div>
      <span className="text-caption text-(--fg-neutral-prominent) leading-tight line-clamp-2">
        {title}
      </span>
    </div>
  );
}

type FileAttachmentProps = {
  kind: ReactNode;
  name: ReactNode;
  progress?: number;
};

function FileAttachment({ kind, name, progress }: FileAttachmentProps) {
  const isUploading = typeof progress === "number";
  return (
    <div className="relative shrink-0 w-24 h-[66px] rounded-square-x2 border border-(--stroke-neutral-subtle) bg-(--bg-neutral-soft) p-2 flex flex-col justify-between overflow-hidden">
      <div className="relative z-[1] flex items-center justify-between gap-2">
        <span className="text-caption text-(--fg-neutral-subtle) uppercase tracking-wider">
          {kind}
        </span>
        {isUploading ? (
          <span className="text-caption text-(--fg-neutral-subtle)">
            {Math.round(progress!)}%
          </span>
        ) : null}
      </div>
      <span className="relative z-[1] text-caption text-(--fg-neutral-prominent) truncate">
        {name}
      </span>
      {isUploading ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-(--bg-neutral-subtle) opacity-50"
          style={{ width: `${Math.max(0, Math.min(100, progress!))}%` }}
        />
      ) : null}
    </div>
  );
}

/* ─── Trailing action helpers ───────────────────────────────────────────── */

function AddAttachmentButton(props: {
  onClick?: () => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props["aria-label"] ?? "Add attachment"}
      onClick={props.onClick}
      className="shrink-0 flex items-center justify-center w-10 h-10 rounded-square-x2 bg-(--bg-neutral-soft) text-(--fg-neutral-prominent) hover:bg-(--bg-neutral-subtle) transition-colors"
    >
      <PlusSmall size={20} />
    </button>
  );
}

function SendButton(props: {
  onClick?: () => void;
  disabled?: boolean;
  /** When provided, the button hides itself while the value is empty/whitespace.
   *  Mirrors the colleague Computer prototype where the send affordance only
   *  appears once the user begins typing. Pass the same string you bind to
   *  ChatInput's `value`. Omit to keep the button always visible. */
  value?: string;
}) {
  if (typeof props.value === "string" && props.value.trim() === "") return null;
  return (
    <Button
      type="button"
      variant="expressive"
      aria-label="Send"
      onClick={props.onClick}
      disabled={props.disabled}
      className="shrink-0 w-10 h-10 p-0 rounded-circle-x2"
    >
      <ArrowUpSmall size={18} />
    </Button>
  );
}

function StopButton(props: { onClick?: () => void }) {
  // Use the prominent/on-prominent pair so the glyph contrasts with the
  // dark fill in both light and dark themes. Earlier the button used
  // `bg-neutral-medium` + `fg-neutral-prominent`, which collapse to the
  // same dark hue in light mode and the same light hue in dark mode —
  // either way the square inside became invisible.
  return (
    <button
      type="button"
      aria-label="Stop"
      onClick={props.onClick}
      className="shrink-0 flex items-center justify-center w-9 h-9 rounded-circle-x2 bg-(--bg-neutral-prominent) text-(--fg-neutral-on-prominent) hover:bg-(--bg-neutral-medium) transition"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const ChatInput = Object.assign(Root, {
  ContextAttachment,
  FileAttachment,
  AddAttachmentButton,
  SendButton,
  StopButton,
  ComputerLogo,
});

// Re-export forwardRef helper for callers needing imperative focus
export const ChatInputWithRef = forwardRef<HTMLInputElement, RootProps>(
  function ChatInputWithRef(props, ref) {
    return <Root {...props} inputRef={ref} />;
  },
);
