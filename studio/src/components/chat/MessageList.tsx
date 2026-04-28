import type { ReactNode } from "react";
import { ChatBubble } from "@xorkavi/arcade-gen";
import type { ChatMessage } from "../../../server/types";
import type { ChatTurnItem } from "../../hooks/useChatStream";
import { ComputerMessage } from "./computer/ComputerMessage";
import { ComputerThinkingRow } from "./computer/ComputerThinkingRow";
import { DottedLoader } from "./computer/DottedLoader";

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
  source = "claude",
}: {
  history: ChatMessage[];
  pendingPrompt?: string;
  currentItems?: ChatTurnItem[];
  busy?: boolean;
  source?: "claude" | "computer";
}) {
  const hasActivity = !!currentItems && currentItems.length > 0;
  const liveNarrations = (currentItems ?? [])
    .filter((i): i is Extract<ChatTurnItem, { kind: "narration" }> => i.kind === "narration")
    .map((i) => i.text);
  const liveTools = (currentItems ?? [])
    .filter((i): i is Extract<ChatTurnItem, { kind: "tool" }> => i.kind === "tool")
    .map((i) => i.pretty);

  const isComputerLive = source === "computer" && busy;

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
      {history.map((m) =>
        m.role === "assistant" && m.source === "computer" ? (
          <ComputerMessage key={m.id} content={m.content} />
        ) : (
          <BubbleRow key={m.id} role={m.role === "user" ? "user" : "assistant"}>
            {m.content}
          </BubbleRow>
        ),
      )}

      {pendingPrompt && <BubbleRow role="user">{pendingPrompt}</BubbleRow>}

      {/* Live turn rendering */}
      {isComputerLive ? (
        <ComputerLive thoughts={liveTools} narrations={liveNarrations} />
      ) : (
        <>
          {hasActivity && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: -16, marginRight: -16 }}>
              {currentItems!.map((item, i) => (
                <ActivityRow key={i} item={item} />
              ))}
            </div>
          )}
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
        </>
      )}
    </div>
  );
}

function ComputerLive({ thoughts, narrations }: { thoughts: string[]; narrations: string[] }) {
  const hasReply = narrations.length > 0;
  if (hasReply) {
    return <ComputerMessage content={narrations.join("\n\n")} />;
  }
  return (
    <div className="flex flex-col">
      {thoughts.length > 0 ? (
        <ComputerThinkingRow thoughts={thoughts} />
      ) : null}
      <div className="ml-3 text-(--fg-neutral-prominent)">
        <DottedLoader />
      </div>
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
