import { useEffect, useRef } from "react";
import type { StreamState } from "../../hooks/chatStreamReducer";

/**
 * Live code preview. While the agent is streaming a Write/Edit tool call, the
 * reducer accumulates the partial file body in `state.activeWrites` (keyed by
 * toolUseId). The backend has emitted this all along via `tool_input_partial`,
 * but nothing rendered it — the user watched a static animation for the full
 * 27-67s even though first output lands in ~5s (ttft). This surfaces that
 * stream so the wait feels immediate: the code scrolls by as it's written.
 *
 * Shows the tail of the streamed text (auto-scrolled), tagged with the file
 * being written and a live line count. Dropped on `tool_input_complete` /
 * turn end, when the reducer clears `activeWrites`.
 */
export function LiveCodePreview({ activeWrites }: { activeWrites: StreamState["activeWrites"] }) {
  const writes = Object.entries(activeWrites);
  if (writes.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginLeft: -16, marginRight: -16 }}>
      {writes.map(([toolUseId, w]) => (
        <CodeStream
          key={toolUseId}
          action={w.action}
          fileName={fileLabel(w.filePath)}
          content={w.partialContent}
        />
      ))}
    </div>
  );
}

/** Last path segment, e.g. `frames/01-foo/index.tsx` → `index.tsx`. */
function fileLabel(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function CodeStream({
  action,
  fileName,
  content,
}: {
  action: "writing" | "editing";
  fileName: string;
  content: string;
}) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;

  // Keep the newest line in view as code streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  return (
    <div
      style={{
        margin: "0 12px",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--surface-shallow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "4px 10px",
          fontSize: 11,
          fontFamily: "var(--font-family-mono, ui-monospace, monospace)",
          color: "var(--fg-neutral-medium)",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
        }}
      >
        <span aria-hidden style={{ opacity: 0.7 }}>✎</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {action === "writing" ? "Writing" : "Editing"} {fileName}
        </span>
        <span aria-hidden style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
      </div>
      <pre
        ref={scrollRef}
        aria-label={`${action} ${fileName}`}
        style={{
          margin: 0,
          padding: "8px 10px",
          maxHeight: 180,
          overflowY: "auto",
          fontSize: 11.5,
          lineHeight: 1.5,
          fontFamily: "var(--font-family-mono, ui-monospace, monospace)",
          color: "var(--fg-neutral-prominent)",
          whiteSpace: "pre",
          // Soft fade at the top so the scroll feels continuous, not clipped.
          maskImage: "linear-gradient(to bottom, transparent 0, black 16px)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 16px)",
        }}
      >
        {content}
      </pre>
    </div>
  );
}
