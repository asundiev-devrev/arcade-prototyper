import { useState } from "react";

/**
 * Spectator-side comment composer for shared projects. Visually flush with
 * the bottom of the comments list using the same chrome tokens as the
 * authoring `ChatInput` composite (top border, surface-overlay background,
 * `px-6 py-4`) so light/dark themes hand off cleanly between author and
 * spectator views.
 *
 * Posting is async and may fail (offline, 5xx, expired PAT). On error we
 * keep `text` intact so the user can retry, surface the message inline,
 * and reset `busy` — earlier versions cleared the textarea optimistically
 * and left `busy=true` after a rejection, which trapped the user.
 */
export function CommentInput({ onSend }: { onSend: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(trimmed);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 w-full px-6 py-4 border-t border-(--stroke-neutral-subtle) bg-(--surface-overlay)"
      style={{
        borderTop: "1px solid var(--stroke-neutral-subtle, #e5e0db)",
        background: "var(--surface-overlay, #fff)",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Comment on this prototype…"
          rows={2}
          style={{ flex: 1, resize: "none" }}
        />
        <button onClick={() => void submit()} disabled={busy || !text.trim()}>Send</button>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--fg-alert-prominent, #b3261e)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
