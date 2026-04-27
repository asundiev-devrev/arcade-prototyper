import type { ReactNode } from "react";
import { ChatBubble } from "@xorkavi/arcade-gen";
import type { ChatMessage } from "../../../server/types";
import type { ChatTurnItem } from "../../hooks/useChatStream";

function toolIcon(tool: string): string {
  if (tool === "Read") return "↘";
  if (tool === "Write") return "✎";
  if (tool === "Edit") return "✎";
  if (tool === "Glob") return "⌕";
  if (tool === "Grep") return "⌕";
  if (tool === "Bash") return "›";
  if (tool === "Figma") return "▣";
  return "•";
}

function ActivityRow({ item }: { item: ChatTurnItem }) {
  if (item.kind === "narration") {
    return (
      <div
        style={{
          padding: "6px 12px",
          color: "var(--fg-neutral-prominent)",
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {item.text}
      </div>
    );
  }
  const color =
    item.ok === false
      ? "var(--fg-alert-prominent)"
      : item.ok === true
      ? "var(--fg-neutral-subtle)"
      : "var(--fg-neutral-medium)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "3px 12px",
        color,
        fontSize: 12,
        fontFamily: "var(--font-family-mono, ui-monospace, monospace)",
        minWidth: 0,
      }}
    >
      <span aria-hidden style={{ opacity: 0.7, flexShrink: 0 }}>
        {toolIcon(item.tool)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.pretty}
      </span>
      {item.ok === undefined && (
        <span aria-hidden style={{ opacity: 0.5, flexShrink: 0 }}>
          …
        </span>
      )}
    </div>
  );
}

export function MessageList({
  history,
  pendingPrompt,
  currentItems,
  busy,
}: {
  history: ChatMessage[];
  pendingPrompt?: string;
  currentItems?: ChatTurnItem[];
  busy?: boolean;
}) {
  const hasActivity = !!currentItems && currentItems.length > 0;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {history.map((m) => (
        <BubbleRow key={m.id} role={m.role === "user" ? "user" : "assistant"}>
          {m.content}
        </BubbleRow>
      ))}

      {/* Optimistically show the prompt while waiting for the response */}
      {pendingPrompt && <BubbleRow role="user">{pendingPrompt}</BubbleRow>}

      {/* Stream activity */}
      {hasActivity && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: -16, marginRight: -16 }}>
          {currentItems!.map((item, i) => (
            <ActivityRow key={i} item={item} />
          ))}
        </div>
      )}

      {/* Busy but nothing streamed yet */}
      {busy && !hasActivity && (
        <div
          style={{
            color: "var(--fg-neutral-subtle)",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          Thinking…
        </div>
      )}
    </div>
  );
}

function BubbleRow({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div style={{ maxWidth: "80%" }}>
        <ChatBubble variant={isUser ? "sender" : "receiver"} tail>
          {children}
        </ChatBubble>
      </div>
    </div>
  );
}
