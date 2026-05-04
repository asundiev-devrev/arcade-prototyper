import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Button, IconButton, ArrowUpSmall, PlusSmall } from "@xorkavi/arcade-gen";
import { ChatInput } from "../../../prototype-kit/composites/ChatInput";
import { nextFontSize } from "../../lib/nextFontSize";
import { extractFigmaUrl } from "../../lib/figmaUrl";
import { api } from "../../lib/api";
import {
  MentionPopover,
  filterMentions,
  type MentionOption,
} from "../chat/MentionPopover";
import { HeroModelSelector } from "./HeroModelSelector";

const START_FONT = 50;
const FLOOR_FONT = 20;
const STEP_FONT = 2;
const MAX_HEIGHT = 180; // ~3 lines at 50px / 1.2 line-height
const PLACEHOLDER = "What we're building today?";

export interface HeroPromptSubmitArgs {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

export interface HeroPromptInputProps {
  onSubmit: (args: HeroPromptSubmitArgs) => void | Promise<void>;
  disabled?: boolean;
}

function detectMentionAtCaret(value: string, caret: number): { query: string; atIdx: number } | null {
  const slice = value.slice(0, caret);
  const atIdx = slice.lastIndexOf("@");
  if (atIdx === -1) return null;
  const before = atIdx === 0 ? "" : slice[atIdx - 1];
  if (before && !/\s/.test(before)) return null;
  const query = slice.slice(atIdx + 1);
  if (/\s/.test(query)) return null;
  return { query, atIdx };
}

export function HeroPromptInput({ onSubmit, disabled }: HeroPromptInputProps) {
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(START_FONT);
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [figmaUrl, setFigmaUrl] = useState<string | null>(null);
  const [mention, setMention] = useState<{
    query: string;
    atIdx: number;
    anchor: { left: number; bottom: number };
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Progressive font-shrink: measure after render, step size based on overflow.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const measured = el.scrollHeight;
    const nextSize = nextFontSize({
      current: fontSize,
      start: START_FONT,
      floor: FLOOR_FONT,
      step: STEP_FONT,
      measuredHeight: measured,
      maxHeight: MAX_HEIGHT,
    });
    if (nextSize !== fontSize) {
      setFontSize(nextSize);
      return;
    }
    el.style.height = `${Math.min(measured, MAX_HEIGHT)}px`;
    el.style.overflowY = measured > MAX_HEIGHT ? "auto" : "hidden";
  }, [text, fontSize]);

  const hasComputerMention = /@Computer\b/i.test(text);

  function computeMentionAnchor(): { left: number; bottom: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? rect.left + 24 : 24;
    const bottom = rect ? window.innerHeight - rect.top + 8 : 80;
    return { left, bottom };
  }

  function updateMentionFromCaret(next: string, el: HTMLTextAreaElement | null) {
    if (!el) { setMention(null); return; }
    const caret = el.selectionStart ?? next.length;
    const detected = detectMentionAtCaret(next, caret);
    if (!detected || filterMentions(detected.query).length === 0) {
      setMention(null);
      return;
    }
    setMention({ query: detected.query, atIdx: detected.atIdx, anchor: computeMentionAnchor() });
  }

  // Keep the popover anchored to the hero container as the user scrolls or
  // resizes. Without this, the popover is placed once and then drifts away
  // from the input when the page moves. Keyed on whether the popover is
  // open (not the mention object itself) so we don't re-subscribe on every
  // anchor update.
  const mentionOpen = mention !== null;
  useEffect(() => {
    if (!mentionOpen) return;
    const reanchor = () => {
      setMention((m) => (m ? { ...m, anchor: computeMentionAnchor() } : m));
    };
    window.addEventListener("scroll", reanchor, { capture: true, passive: true });
    window.addEventListener("resize", reanchor, { passive: true });
    return () => {
      window.removeEventListener("scroll", reanchor, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", reanchor);
    };
  }, [mentionOpen]);

  function insertMention(option: MentionOption) {
    if (!mention) return;
    const before = text.slice(0, mention.atIdx);
    const afterStart = mention.atIdx + 1 + mention.query.length;
    const after = text.slice(afterStart);
    const insertion = `@${option.token} `;
    const nextValue = `${before}${insertion}${after}`;
    setText(nextValue);
    setMention(null);
    const el = textareaRef.current;
    if (el) {
      const caret = before.length + insertion.length;
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);
    setFigmaUrl(extractFigmaUrl(next));
    updateMentionFromCaret(next, e.target);
  };

  const addFiles = useCallback(async (files: File[] | FileList) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of arr) {
      try {
        const { path, url } = await api.stageUpload(f);
        setImages((xs) => [...xs, url]);
        setImagePaths((xs) => [...xs, path]);
      } catch {
        // swallow — the hero stays usable without image attach
      }
    }
  }, []);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text");
    if (pasted) {
      const url = extractFigmaUrl(pasted);
      if (url) setFigmaUrl(url);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = async () => {
    if (mention) return;
    const trimmed = text.trim();
    if (!trimmed || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit({ prompt: trimmed, imagePaths, figmaUrl });
      setText("");
      setImages([]);
      setImagePaths([]);
      setFigmaUrl(null);
      setFontSize(START_FONT);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (mention) return; // let the popover handle it
      e.preventDefault();
      void submit();
    }
  };

  const sendDisabled = !text.trim() || submitting || !!disabled;

  return (
    <div
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ position: "relative" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        aria-hidden
        style={{
          width: 4,
          height: 60,
          background: "var(--fg-neutral-black, #211e20)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={onChange}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        rows={1}
        style={{
          width: "100%",
          border: 0,
          outline: 0,
          background: "transparent",
          resize: "none",
          fontFamily: "'Chip_Display_Variable', sans-serif",
          fontWeight: 600,
          color: "var(--fg-neutral-prominent, #211e20)",
          fontSize,
          lineHeight: 1.2,
          opacity: 1,
          transition: "font-size 120ms ease-out",
        }}
        // Placeholder styling relies on the global stylesheet; see
        // studio/src/styles/tailwind.css for ::placeholder opacity:0.48.
        data-hero-input
      />
      {(images.length > 0 || figmaUrl || hasComputerMention) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            marginTop: 16,
            paddingBottom: 4,
          }}
        >
          {hasComputerMention && (
            <ChatInput.ContextAttachment title="Computer" subtitle="DevRev agent" />
          )}
          {images.map((_url, i) => (
            <ChatInput.FileAttachment key={i} kind="IMG" name={`image-${i}`} />
          ))}
          {figmaUrl && (
            <ChatInput.ContextAttachment
              title="Figma frame"
              subtitle={figmaUrl.slice(0, 20) + "…"}
            />
          )}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          marginTop: 24,
        }}
      >
        <HeroModelSelector />
        <IconButton
          aria-label="Add attachment"
          variant="secondary"
          size="md"
          onClick={() => fileInputRef.current?.click()}
        >
          <PlusSmall />
        </IconButton>
        <Button
          type="button"
          variant="expressive"
          aria-label="Send"
          onClick={() => void submit()}
          disabled={sendDisabled}
          className="shrink-0 w-9 h-9 p-0"
        >
          <ArrowUpSmall size={18} />
        </Button>
      </div>
      {mention && (
        <MentionPopover
          query={mention.query}
          anchor={mention.anchor}
          onSelect={insertMention}
          onDismiss={() => setMention(null)}
        />
      )}
    </div>
  );
}
