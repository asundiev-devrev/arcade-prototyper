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
  type UserMentionInput,
} from "./MentionPopover";
import { useTargetSelection, type TargetSelection } from "../../hooks/targetSelectionContext";
import type { SendResult } from "../../hooks/useChatStream";

interface PromptInputProps {
  busy: boolean;
  projectSlug: string;
  onSend: (prompt: string, images: string[]) => void | Promise<SendResult>;
  onStop?: () => void;
  seedRef?: MutableRefObject<((text: string) => void) | null>;
  /**
   * When set, the input runs in spectator/comment mode: same chrome, but
   * submitting calls `commentMode.onSubmit(text)` instead of driving an
   * agent turn. We hide authoring-only affordances (image upload,
   * @-mentions, Figma URL paste, target chip, Computer/#frame attachments)
   * because those mutate host state guests can't drive. On rejection the
   * text is preserved and an inline error is surfaced; busy resets so the
   * guest can retry.
   */
  commentMode?: { onSubmit: (text: string) => Promise<void> };
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

function buildTargetPreamble(t: TargetSelection): string {
  const rel = t.file.split("/frames/").pop() ?? t.file;
  const label = t.tagName && t.tagName !== t.componentName
    ? `<${t.tagName}> inside <${t.componentName}>`
    : `<${t.componentName}>`;
  return [
    `Target element: ${label}`,
    `Source: frames/${rel}:${t.line}:${t.column}`,
    "",
    `Read frames/${rel} first — do not edit from memory. The line:column above identifies the targeted element inside that file. Apply the requested change ONLY to this element (or its direct children if the intent clearly requires it); do not modify other files or unrelated parts of this file.`,
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit tool reports zero or multiple matches, widen the surrounding context and retry — or fall back to Write with the full new file contents. Do not paraphrase the change in narration as a substitute for editing.",
    "",
  ].join("\n");
}

export function PromptInput({ busy, projectSlug, onSend, onStop, seedRef, commentMode }: PromptInputProps) {
  const isComment = !!commentMode;
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [detectedFigmaUrl, setDetectedFigmaUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const { target, clear: clearTarget } = useTargetSelection();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserMentionInput[]>([]);
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
    if (isComment) return;
    let cancelled = false;
    async function load() {
      try {
        // Resolve the current user's devu id (so we can exclude self from the list).
        const settingsRes = await fetch("/api/settings");
        const settings = await settingsRes.json().catch(() => ({}));
        const me = (settings as { devrev?: { user?: { id?: string } } })?.devrev?.user?.id;

        // Fetch the pre-filtered, cached mentionable-users list from our
        // own server. Pagination + state filtering + gmail/contractor
        // exclusion all happen server-side because DevRev's full org is
        // ~4k rows and requires cursor pagination across ~8 pages.
        const res = await fetch("/api/multiplayer/mention-users");
        if (!res.ok) return;
        const data = (await res.json()) as {
          users?: { id: string; displayName: string; email: string }[];
        };
        if (cancelled) return;
        const list = (data.users ?? []).filter((u) => !me || u.id !== me);
        setUsers(list);
      } catch {
        // fall back to empty list — popover will still show @Computer
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isComment]);

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
    if (isComment || !detectedFigmaUrl) return;
    const ctrl = new AbortController();
    fetch("/api/figma/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: detectedFigmaUrl }),
      signal: ctrl.signal,
    }).catch(() => { /* fire-and-forget; server logs real failures */ });
    return () => ctrl.abort();
  }, [isComment, detectedFigmaUrl]);

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
    if (isComment) return;
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

    if (commentMode) {
      // Spectator branch: post a comment to the host instead of driving a
      // turn. Preserve text on rejection so guests can retry; clear busy
      // and surface the error inline either way.
      if (commentBusy) return;
      setCommentBusy(true);
      setCommentError(null);
      try {
        await commentMode.onSubmit(p);
        if (!mountedRef.current) return;
        setText("");
      } catch (err) {
        if (!mountedRef.current) return;
        setCommentError(err instanceof Error ? err.message : "Failed to post comment");
      } finally {
        if (mountedRef.current) setCommentBusy(false);
      }
      return;
    }

    if (busy) return;

    // Detect user @-mentions in the current text against our known users list.
    // Token form is @<handle>. The handle is the email local-part with the
    // `i-` prefix stripped for DevRev imported-identity accounts — keeps
    // this in sync with MentionPopover's token generation.
    const userMentionTargets: { devu: string; displayName: string }[] = [];
    for (const u of users) {
      const local = u.email.split("@")[0];
      const handle = local.startsWith("i-") ? local.slice(2) : local;
      // Escape regex special chars in the handle (dots, hyphens).
      const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`@${escaped}\\b`, "i");
      if (re.test(text)) {
        userMentionTargets.push({ devu: u.id, displayName: u.displayName });
      }
    }

    if (userMentionTargets.length > 0) {
      // Plan 2b: An @-mention is now a shortcut for the project-sharing flow.
      // We check whether the mentioned devu is already on the project's
      // shared_with list; if not, we confirm with the user and POST to the
      // sharing endpoint. Either way we skip the chat turn — the @-mention
      // text is not a design prompt, and letting it run would just produce a
      // confusing "no frame to build" response. v1 shares one user at a time
      // (first match).
      const guest = userMentionTargets[0];
      try {
        // Fetch current shared_with to avoid re-confirming for collaborators
        // who are already on the project.
        const curRes = await fetch(`/api/projects/${projectSlug}/collaborators`);
        const cur = (await curRes.json().catch(() => ({}))) as {
          shared_with?: { devu: string }[];
        };
        const isAlready = (cur.shared_with ?? []).some((c) => c.devu === guest.devu);

        if (!isAlready) {
          // Native window.confirm is deliberate v1 — a styled inline
          // confirmation is a polish follow-up.
          const ok = window.confirm(`Add ${guest.displayName} to this project?`);
          if (!ok) {
            // Keep the input intact so the host can edit and try again.
            return;
          }
          const shareRes = await fetch(`/api/projects/${projectSlug}/collaborators`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ devu: guest.devu, displayName: guest.displayName }),
          });
          if (!shareRes.ok) {
            const data = await shareRes.json().catch(() => ({}));
            toast({
              title: `Share failed: ${(data as { error?: string })?.error ?? shareRes.status}`,
              intent: "alert",
            });
            return;
          }
          toast({
            title: `Shared with ${guest.displayName}`,
            intent: "success",
          });
        } else {
          toast({
            title: `${guest.displayName} is already on this project`,
            intent: "info",
          });
        }
      } catch (err) {
        toast({
          title: `Share failed: ${(err as Error).message}`,
          intent: "alert",
        });
        return;
      }
      // Clear the input and stop. We keep the existing custom-event dispatch
      // so any chat-history-driven UI gets a chance to refresh; the
      // multiplayerInvite middleware (2a) used to write a system message —
      // the new share endpoint does not, so the system-message side-effect
      // is intentionally left to a follow-up task.
      setText("");
      setImages([]);
      setImagePaths([]);
      setFileNames([]);
      setDetectedFigmaUrl(null);
      setMention(null);
      clearTarget();
      window.dispatchEvent(new CustomEvent("arcade-studio:refresh-chat-history"));
      return;
    }

    const finalPrompt = target ? `${buildTargetPreamble(target)}${p}` : p;
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
    clearTarget();
  };

  function updateMentionFromCaret(next: string, el: HTMLInputElement | HTMLTextAreaElement | null) {
    if (!el) { setMention(null); return; }
    const caret = el.selectionStart ?? next.length;
    const detected = detectMentionAtCaret(next, caret);
    if (!detected || filterMentions(detected.query, users).length === 0) {
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

  const hasComputerMention = !isComment && /@Computer\b/i.test(text);
  const hasFrameTrigger = !isComment && /#frame\b/i.test(text);
  const effectiveBusy = isComment ? commentBusy : busy;

  return (
    <div
      ref={containerRef}
      onDrop={isComment ? undefined : onDrop}
      onDragOver={isComment ? undefined : (e) => e.preventDefault()}
    >
      {!isComment && (
        <input
          ref={fileInputRef}
          type="file"
          // Any file type — images, PRDs, PDFs, docs, etc. No `accept` filter
          // so the picker shows everything; the agent reads whatever lands.
          multiple
          hidden
          onChange={onFilePicked}
        />
      )}
      {commentError && (
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
          <span>{commentError}</span>
          <button
            type="button"
            onClick={() => setCommentError(null)}
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
          if (isComment) {
            if (commentError) setCommentError(null);
            return;
          }
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
        placeholder={isComment ? "Comment on this prototype…" : "Ask me anything"}
        attachments={
          !isComment &&
          (images.length > 0 || detectedFigmaUrl || hasComputerMention || hasFrameTrigger || target) ? (
            <>
              {target && (
                <TargetChip target={target} onClear={clearTarget} />
              )}
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
            {!isComment && <ChatInput.AddAttachmentButton onClick={handlePickFile} />}
            {effectiveBusy && onStop && !isComment ? (
              <ChatInput.StopButton onClick={onStop} />
            ) : (
              <ChatInput.SendButton
                onClick={() => void submit()}
                disabled={!text.trim() || effectiveBusy}
              />
            )}
          </>
        }
      />
      {mention && (
        <MentionPopover
          query={mention.query}
          anchor={mention.anchor}
          users={users}
          onSelect={insertMention}
          onDismiss={() => setMention(null)}
        />
      )}
    </div>
  );
}

function TargetChip({ target, onClear }: { target: TargetSelection; onClear: () => void }) {
  const file = target.file.split("/").pop() ?? target.file;
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
          aria-label="Clear target"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--fg-neutral-subtle)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div className="flex flex-col min-w-0">
        <span
          className="text-caption text-(--fg-neutral-prominent) truncate"
          title={target.componentName}
        >
          {target.componentName}
        </span>
        <span className="text-caption text-(--fg-neutral-subtle) truncate" title={target.file}>
          {file}:{target.line}
        </span>
      </div>
    </div>
  );
}
