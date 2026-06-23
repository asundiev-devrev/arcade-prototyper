import {
  useState,
  useRef,
  useEffect,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type MutableRefObject,
} from "react";
import { useToast } from "@xorkavi/arcade-gen";
import { ChatInput } from "../../../prototype-kit/composites/ChatInput";
import { extractFigmaUrl } from "../../lib/figmaUrl";
import { attachmentKind } from "../../lib/attachmentKind";
import {
  MentionPopover,
  filterMentions,
  type MentionOption,
} from "./MentionPopover";
import type { SendResult } from "../../hooks/useChatStream";

interface PromptInputProps {
  busy: boolean;
  projectSlug: string;
  onSend: (prompt: string, images: string[]) => void | Promise<SendResult>;
  onStop?: () => void;
  seedRef?: MutableRefObject<((text: string) => void) | null>;
}

/**
 * Looks backward from the caret for an active "@word" token. Returns the
 * token (without @) and the index of the @ if one is open, else null.
 * Active means: @ is at start or preceded by whitespace, and the text
 * between @ and the caret contains no whitespace.
 */
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

export function PromptInput({ busy, projectSlug, onSend, onStop, seedRef }: PromptInputProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [detectedFigmaUrl, setDetectedFigmaUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { toast } = useToast();
  const [mention, setMention] = useState<{
    query: string;
    atIdx: number;
    anchor: { left: number; bottom: number };
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!seedRef) return;
    seedRef.current = (seed: string) => {
      setText(seed);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        try { el.setSelectionRange(seed.length, seed.length); } catch { /* ignore */ }
      });
    };
    return () => { seedRef.current = null; };
  }, [seedRef]);

  useEffect(() => {
    if (!detectedFigmaUrl) return;
    const ctrl = new AbortController();
    fetch("/api/figma/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: detectedFigmaUrl }),
      signal: ctrl.signal,
    }).catch(() => { /* fire-and-forget; server logs real failures */ });
    return () => ctrl.abort();
  }, [detectedFigmaUrl]);

  function scheduleErrorClear() {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setUploadError(null);
    }, 5000);
  }

  async function uploadFile(file: File): Promise<{ path: string; url: string }> {
    const res = await fetch(`/api/uploads/${projectSlug}`, {
      method: "POST",
      headers: {
        // Best-effort MIME; the server falls back to the filename's extension.
        "Content-Type": file.type || "application/octet-stream",
        // Original filename so the saved file keeps its real extension
        // (.pdf, .docx, .md, …). Encoded so non-ASCII names survive the header.
        "X-Upload-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) {
      let msg = `upload failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) msg = body.error.message;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return res.json();
  }

  async function addFiles(files: File[] | FileList) {
    for (const file of Array.from(files)) {
      try {
        const { path, url } = await uploadFile(file);
        if (!mountedRef.current) return;
        setImages((xs) => [...xs, url]);
        setImagePaths((xs) => [...xs, path]);
        setFileNames((xs) => [...xs, file.name]);
        if (mountedRef.current) setUploadError(null);
      } catch (err) {
        console.warn("[PromptInput] upload failed:", err);
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : "Upload failed";
        setUploadError(msg);
        scheduleErrorClear();
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    } else {
      // Check for Figma URL in pasted text
      const pastedText = e.clipboardData?.getData("text");
      if (pastedText) {
        const figmaUrl = extractFigmaUrl(pastedText);
        if (figmaUrl) {
          setDetectedFigmaUrl(figmaUrl);
        }
      }
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) void addFiles(files);
    e.target.value = "";
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const submit = async () => {
    // Never fire a turn while the mention popover is open — Enter belongs to
    // the popover in that state.
    if (mention) return;
    const p = text.trim();
    if (!p) return;
    if (busy) return;

    const finalPrompt = p;
    const result = await onSend(finalPrompt, imagePaths);
    // When the stream rejects a NEW prompt because a turn is already running,
    // keep the composer contents so the user can resend once it's idle —
    // dropping the text silently was the worst failure mode here.
    if (result && !result.ok && result.reason === "busy") {
      toast({
        title: "Still working on your last request — try again in a moment.",
        intent: "info",
      });
      return;
    }
    setText("");
    setImages([]);
    setImagePaths([]);
    setFileNames([]);
    setDetectedFigmaUrl(null);
    setMention(null);
  };

  function updateMentionFromCaret(next: string, el: HTMLInputElement | HTMLTextAreaElement | null) {
    if (!el) { setMention(null); return; }
    const caret = el.selectionStart ?? next.length;
    const detected = detectMentionAtCaret(next, caret);
    if (!detected || filterMentions(detected.query, []).length === 0) {
      setMention(null);
      return;
    }
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const left = rect ? rect.left + 24 : 24;
    const bottom = rect ? window.innerHeight - rect.top + 8 : 80;
    setMention({ query: detected.query, atIdx: detected.atIdx, anchor: { left, bottom } });
  }

  function insertMention(option: MentionOption) {
    if (!mention) return;
    const before = text.slice(0, mention.atIdx);
    // Replace from @ through current caret (which is mention.atIdx + query length)
    const afterStart = mention.atIdx + 1 + mention.query.length;
    const after = text.slice(afterStart);
    const insertion = `@${option.token} `;
    const next = `${before}${insertion}${after}`;
    setText(next);
    setMention(null);
    const el = inputRef.current;
    if (el) {
      const caret = before.length + insertion.length;
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* input types without selection support */ }
      });
    }
  }

  const hasComputerMention = /@Computer\b/i.test(text);
  const hasFrameTrigger = /#frame\b/i.test(text);

  return (
    <div
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <input
        ref={fileInputRef}
        type="file"
        // Any file type — images, PRDs, PDFs, docs, etc. No `accept` filter
        // so the picker shows everything; the agent reads whatever lands.
        multiple
        hidden
        onChange={onFilePicked}
      />
      {uploadError && (
        <div
          role="alert"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            margin: "0 16px 8px",
            borderRadius: 8,
            color: "var(--fg-alert-prominent)",
            background: "var(--bg-alert-subtle)",
            border: "1px solid var(--stroke-alert-subtle)",
            fontSize: 12,
          }}
        >
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
            }}
            aria-label="Dismiss error"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg-alert-prominent)",
              cursor: "pointer",
              fontSize: 16,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
      <ChatInput
        multiline
        maxRows={8}
        value={text}
        inputRef={inputRef}
        onChange={(e) => {
          const el = e.target as HTMLInputElement | HTMLTextAreaElement;
          const next = el.value;
          setText(next);
          // Check for Figma URL as user types
          const url = extractFigmaUrl(next);
          setDetectedFigmaUrl(url);
          updateMentionFromCaret(next, el);
        }}
        onSubmit={() => {
          // If the mention popover is open and has results, let it handle Enter.
          if (mention) return;
          void submit();
        }}
        placeholder="Ask me anything"
        attachments={
          images.length > 0 || detectedFigmaUrl || hasComputerMention || hasFrameTrigger ? (
            <>
              {hasComputerMention && (
                <ChatInput.ContextAttachment
                  title="Computer"
                  subtitle="DevRev agent"
                />
              )}
              {hasFrameTrigger && (
                <ChatInput.ContextAttachment
                  title="Frame source"
                  subtitle="#frame"
                />
              )}
              {images.map((url, i) => (
                <ChatInput.FileAttachment
                  key={i}
                  kind={attachmentKind(fileNames[i])}
                  name={fileNames[i] ?? `file-${i + 1}`}
                />
              ))}
              {detectedFigmaUrl && (
                <ChatInput.ContextAttachment
                  title="Figma frame"
                  subtitle={detectedFigmaUrl.slice(0, 20) + "..."}
                />
              )}
            </>
          ) : undefined
        }
        trailing={
          <>
            <ChatInput.AddAttachmentButton onClick={handlePickFile} />
            {busy && onStop ? (
              <ChatInput.StopButton onClick={onStop} />
            ) : (
              <ChatInput.SendButton
                onClick={() => void submit()}
                disabled={!text.trim() || busy}
              />
            )}
          </>
        }
      />
      {mention && (
        <MentionPopover
          query={mention.query}
          anchor={mention.anchor}
          users={[]}
          onSelect={insertMention}
          onDismiss={() => setMention(null)}
        />
      )}
    </div>
  );
}
