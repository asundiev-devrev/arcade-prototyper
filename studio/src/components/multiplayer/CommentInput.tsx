import { useState } from "react";

export function CommentInput({ onSend }: { onSend: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    await onSend(trimmed);
    setText("");
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comment on this prototype…"
        rows={2}
        style={{ flex: 1, resize: "none" }}
      />
      <button onClick={submit} disabled={busy || !text.trim()}>Send</button>
    </div>
  );
}
