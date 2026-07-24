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
import { SCOPED_EDIT_MARKER } from "../../lib/scopedEdit";
import { attachmentKind } from "../../lib/attachmentKind";
import {
  MentionPopover,
  filterMentions,
  type MentionOption,
} from "./MentionPopover";
import { useEditSession, type EditedElement } from "../../hooks/editSessionContext";
import { isInFrame } from "../../lib/visualEditClient";
import { resolveInFrameComponent } from "../../frame/resolveInFrameComponent";
import type { SendResult } from "../../hooks/useChatStream";

interface PromptInputProps {
  busy: boolean;
  projectSlug: string;
  onSend: (prompt: string, images: string[], displayPrompt?: string) => void | Promise<SendResult>;
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

/** Short human label for a picked element: "<tag> inside <Component>" or "<Component>". */
function elementLabel(sel: EditedElement["selection"]): string {
  return sel.tagName && sel.tagName !== sel.componentName
    ? `<${sel.tagName}> inside <${sel.componentName}>`
    : `<${sel.componentName}>`;
}

/** One addressed line for a picked element, tagged with how precisely we can
 *  locate it. Order of preference (most precise first):
 *   - "in-frame": the element itself is authored in a frame file → real file:line.
 *   - "owner":    the element is a kit-composite INSTANCE placed in a frame file
 *                 → the placement's real file:line (from the owner chain). We can
 *                 point the agent at the exact `<Component .../>` usage.
 *   - "baked":    no in-frame ancestor at all — content lives inside sealed kit
 *                 source. Only here do we fall back to find-by-description.
 */
interface TargetLine {
  kind: "in-frame" | "owner" | "baked";
  text: string;
}

function targetLineFor(e: EditedElement, frameSlug: string): TargetLine {
  const s = e.selection;

  // 1. The clicked element is authored directly in a frame file (index.tsx or a
  //    frame sub-component). Its picker line:column is real for that file.
  if (isInFrame(s.file, frameSlug)) {
    const rel = s.file.split("/frames/").pop() ?? `${frameSlug}/index.tsx`;
    return { kind: "in-frame", text: `- ${elementLabel(s)} — frames/${rel}:${s.line}:${s.column}` };
  }

  // 2. The clicked element renders from a shared kit component, but the picker's
  //    owner chain records WHERE the frame placed that component — a real,
  //    editable frame file:line (e.g. `<IconButton>` at ProjectsSidebar.tsx:76).
  //    Address THAT usage; it's precise and unambiguous even with many similar
  //    elements on screen. This is the case the old code threw away.
  const owner = resolveInFrameComponent(s.ownerChain, frameSlug);
  if (owner) {
    const rel = owner.file.split("/frames/").pop() ?? `${frameSlug}/index.tsx`;
    return {
      kind: "owner",
      text: `- ${elementLabel(s)} — the <${owner.componentName}> placed at frames/${rel}:${owner.line}:${owner.column}`,
    };
  }

  // 3. Truly baked inside sealed kit source — no frame anchor exists.
  return { kind: "baked", text: `- ${elementLabel(s)}` };
}

/**
 * Prepend a scoped element-context block to the typed prompt when the user has
 * one or more elements picked (chips in the input). The user's change lives in
 * their typed text; this block only tells the agent WHICH elements to touch.
 *
 * We always prefer a PRECISE frame file:line over a vague description. The
 * picker captures both the clicked element AND its owner chain, so even when the
 * clicked node resolves into shared kit source we can usually point at the exact
 * `<Component/>` usage the frame authored (the owner chain's nearest in-frame
 * link). Only genuinely baked-in kit content (no in-frame ancestor) falls back
 * to find-by-description — the ambiguous path that made the agent edit the wrong
 * button when several similar ones were on screen.
 */
export function buildTargetPreamble(batch: EditedElement[], frameSlug: string): string {
  if (batch.length === 0 || !frameSlug) return "";
  const targets = batch.map((e) => targetLineFor(e, frameSlug));
  const precise = targets.filter((t) => t.kind !== "baked");
  const baked = targets.filter((t) => t.kind === "baked");
  const sections: string[] = [];

  if (precise.length) {
    const many = precise.length > 1;
    sections.push(
      [
        `Target element${many ? "s" : ""}:`,
        ...precise.map((t) => t.text),
        "",
        `Read the file(s) first — do not edit from memory. Each location above points at the exact element (or the exact <Component/> usage that renders it) in the frame's own source. Apply the requested change ONLY to ${many ? "these elements" : "this element"} at ${many ? "those locations" : "that location"} — do NOT edit a different element that merely looks similar, and do NOT edit anything under prototype-kit/. If the change needs the component's internal markup (not just its props/className), inline a local copy of just that markup at the SAME location and edit the copy; keep everything else identical.`,
      ].join("\n"),
    );
  }

  if (baked.length) {
    const many = baked.length > 1;
    sections.push(
      [
        `Target element${many ? "s" : ""} rendered from a SHARED prototype-kit component, with no editable usage in the frame source:`,
        ...baked.map((t) => t.text),
        "",
        "Do NOT edit anything under prototype-kit/ — that source is shared by every prototype. In frames/" + frameSlug + "/index.tsx, inline a local copy of just the markup needed so the targeted element becomes part of THIS frame, then apply the requested change to the copy. Identify the element by what it is and its visible content. Preserve all other props, children, and behavior of the surrounding composite.",
      ].join("\n"),
    );
  }

  if (sections.length === 0) return "";
  // Lead with the machine sentinel so the server recognises EVERY preamble shape
  // (single / multi-select / baked) as a scoped edit — not just the singular
  // "Target element:" header. See src/lib/scopedEdit.ts for why.
  return [
    SCOPED_EDIT_MARKER,
    ...sections,
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit reports zero or multiple matches, widen the surrounding context and retry — or fall back to Write with the full new file contents. Do not paraphrase the change in narration as a substitute for editing.",
    "",
  ].join("\n\n");
}

export function PromptInput({ busy, projectSlug, onSend, onStop, seedRef }: PromptInputProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [detectedFigmaUrl, setDetectedFigmaUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { batch, frameSlug, frameWindow, removeElement, clear: clearSelection } = useEditSession();
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

    // Prepend the scoped element-context block when elements are picked (chips
    // present) so the agent edits exactly those targets. The preamble is a
    // MACHINE instruction — the agent needs it, but the chat must show only the
    // words the user typed (`p`), so it rides as the hidden full prompt while
    // `p` is passed as the visible display text.
    const hasPreamble = batch.length > 0 && !!frameSlug;
    const finalPrompt = hasPreamble ? `${buildTargetPreamble(batch, frameSlug)}${p}` : p;
    const result = await onSend(finalPrompt, imagePaths, hasPreamble ? p : undefined);
    // When the stream rejects a NEW prompt because a turn is already running,
    // keep the composer contents (and the picked elements) so the user can
    // resend once it's idle — dropping either silently was the worst failure
    // mode here.
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
    // The picked elements were consumed by this turn — drop the selection and
    // its live preview overlay (mirrors the inspector's post-send behavior).
    if (batch.length > 0) {
      frameWindow?.postMessage({ type: "arcade-studio:preview-reset", all: true }, "*");
      clearSelection();
    }
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
          images.length > 0 || detectedFigmaUrl || hasComputerMention || hasFrameTrigger || batch.length > 0 ? (
            <>
              {batch.map((e) => (
                <TargetChip
                  key={e.selection.editId}
                  selection={e.selection}
                  onClear={() => {
                    frameWindow?.postMessage(
                      { type: "arcade-studio:preview-reset", editId: e.selection.editId },
                      "*",
                    );
                    removeElement(e.selection.editId);
                  }}
                />
              ))}
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

/**
 * A removable chip for one picked element, shown in the chat input's attachment
 * row. Sending a prompt while chips are present scopes the turn to these
 * elements (see buildTargetPreamble). The × drops just this element from the
 * selection. Mirrors the dashed-border ContextAttachment styling of the kit.
 */
function TargetChip({
  selection, onClear,
}: {
  selection: EditedElement["selection"];
  onClear: () => void;
}) {
  const file = selection.file.split("/").pop() ?? selection.file;
  const name = selection.tagName || selection.componentName;
  return (
    <div
      className="shrink-0 h-[66px] rounded-square-x2 border border-dashed border-(--stroke-neutral-subtle) bg-(--bg-neutral-soft) p-2 flex flex-col justify-between"
      style={{ minWidth: 120, maxWidth: 200 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-(--fg-neutral-subtle)">Target</span>
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear target ${name}`}
          style={{
            background: "transparent", border: "none", color: "var(--fg-neutral-subtle)",
            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-caption text-(--fg-neutral-prominent) truncate" title={name}>
          &lt;{name}&gt;
        </span>
        <span className="text-caption text-(--fg-neutral-subtle) truncate" title={selection.file}>
          {file}:{selection.line}
        </span>
      </div>
    </div>
  );
}
