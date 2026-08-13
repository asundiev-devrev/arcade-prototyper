/**
 * DEPRECATED — use `ChatComposer` from `arcade/components` instead.
 *
 * Kept working so existing frames keep rendering. Do not use in new work.
 *
 * Why: `ChatComposer` IS the Figma Computer input set (attach left, send/stop
 * right, auto-growing, attachments slot). This wrapper adds a bar around it, used
 * to default its left slot to a PAUSE glyph, and still accepts a `trailing` slot
 * that duplicated the composer's own buttons (now ignored for that reason).
 */
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
import { forwardRef, type ChangeEvent, type ReactNode, type Ref } from "react";
import {
  Button,
  ChatComposer,
  IconButton,
  ArrowUpSmall,
  PlusSmall,
  Computer,
} from "@xorkavi/arcade-gen";

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
   * Accepted for backwards compatibility and ignored: ChatComposer is always a
   * multi-line auto-growing surface (Enter sends, Shift+Enter newlines), which
   * is what the `multiline` flag used to opt into.
   */
  multiline?: boolean;
  maxRows?: number;
  /** Swaps the send button for a stop button (Figma "Idle with stop"). */
  streaming?: boolean;
  onStop?: () => void;
  onAttach?: () => void;
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
  streaming,
  onStop,
  onAttach,
}: RootProps) {
  return (
    // Outer bar spans full width (border-top + surface edge-to-edge, matching
    // production); inner content centers in the same 860px column as the
    // transcript so the composer aligns with the messages above it.
    <div className="w-full px-4 py-3 border-t border-(--stroke-neutral-subtle) bg-(--surface-overlay)">
      <div className="flex flex-col gap-2 w-full max-w-[860px] mx-auto">
        {hint ? (
          <div className="flex items-center justify-center text-caption text-(--fg-neutral-subtle) px-2">
            {hint}
          </div>
        ) : null}
        <div className="flex items-end gap-2 min-w-0">
          {/* `leading` is now opt-in. It used to default to a PAUSE glyph (two
              vertical strokes) "matching a colleague's prototype" — so every
              generated Computer screen showed a permanent pause bar inside its
              input. ChatComposer brings the real attach affordance. */}
          {leading ? (
            <span className="shrink-0 flex items-center justify-center text-(--fg-neutral-prominent)">
              {leading}
            </span>
          ) : null}
          <ChatComposer
            className="flex-1 min-w-0"
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            attachments={attachments}
            streaming={streaming}
            onStop={onStop}
            onAttach={onAttach}
            onSend={onSubmit}
            // The kit's onChange has always been event-shaped; ChatComposer
            // reports a plain string. Adapt rather than break existing frames.
            onValueChange={
              onChange
                ? (next: string) =>
                    onChange({ target: { value: next } } as ChangeEvent<HTMLInputElement>)
                : undefined
            }
          />
          {/* `trailing` is deliberately NOT rendered.
              It existed when this composite drew its own input row and the caller
              supplied the action buttons. ChatComposer now owns that row — attach
              on the left, send/stop on the right — so honouring `trailing` painted
              a SECOND attach "+" and a second send button beside the composer's
              own. Frames written against the old API still pass
              `trailing={<ChatInput.AddAttachmentButton />}`; ignoring it renders
              them correctly instead of doubling up. Use `onAttach` / `onSubmit` /
              `streaming` to drive the real buttons. */}
        </div>
      </div>
    </div>
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
  // Mirror SendButton: use the arcade-gen <Button> so the circular shape, dark
  // fill, and icon color come from the design-system's COMPILED styles. The
  // earlier hand-rolled <button> relied on `bg-(--bg-neutral-prominent)` /
  // `text-(--fg-neutral-on-prominent)` utility classes — the Tailwind v4
  // CSS-var shorthand that studio's build does NOT generate (arcade-gen ships
  // some of them in its styles.css, but not `text-(--fg-neutral-on-prominent)`,
  // and `rounded-circle-x2` is only a 20px radius — not a circle on a 36px
  // button). The result was a black rectangle with an invisible glyph. `variant
  // "primary"` gives the dark neutral-prominent fill; the Button supplies the
  // round shape + on-prominent icon color the same way SendButton does.
  // The square glyph is an inline SVG (arcade-gen ships no stop/square icon).
  // It uses an EXPLICIT currentColor-independent fill — the earlier
  // `text-(--fg-neutral-on-prominent)` class never compiled in studio's
  // Tailwind, so `fill="currentColor"` resolved to nothing and the glyph was
  // invisible. The Button's `primary` variant fill is dark, so a light fill
  // here keeps the square visible in both themes.
  return (
    <Button
      type="button"
      variant="primary"
      aria-label="Stop"
      onClick={props.onClick}
      className="shrink-0 w-10 h-10 p-0 rounded-circle-x2"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="var(--fg-neutral-on-prominent)" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </Button>
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
