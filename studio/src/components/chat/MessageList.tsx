import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { ChatBubble } from "@xorkavi/arcade-gen";
import type { ChatMessage } from "../../../server/types";
import type { ChatTurnItem } from "../../hooks/useChatStream";
import { ComputerMessage, markdownComponents } from "./computer/ComputerMessage";
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

/** Render elapsed ms/s compactly. Re-renders itself on an interval while
 *  the call is still in-flight so the "N seconds" counter stays fresh. */
function Elapsed({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [endedAt]);
  const ms = (endedAt ?? now) - startedAt;
  if (ms < 1000) return <>{`${ms}ms`}</>;
  const s = ms / 1000;
  if (s < 60) return <>{`${s.toFixed(s < 10 ? 1 : 0)}s`}</>;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return <>{`${m}m ${rem}s`}</>;
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
  const hasExpandable =
    (item.details && item.details.trim().length > 0) ||
    (item.snippet && item.snippet.trim().length > 0);

  const summary = (
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
        cursor: hasExpandable ? "pointer" : "default",
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
      <span
        aria-hidden
        style={{
          opacity: 0.55,
          flexShrink: 0,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Elapsed startedAt={item.startedAt} endedAt={item.endedAt} />
      </span>
      {item.ok === undefined ? (
        <span aria-hidden style={{ opacity: 0.5, flexShrink: 0 }}>
          …
        </span>
      ) : hasExpandable ? (
        <span aria-hidden style={{ opacity: 0.5, flexShrink: 0 }}>
          ▸
        </span>
      ) : null}
    </div>
  );

  if (!hasExpandable) {
    return summary;
  }

  return (
    <details style={{ minWidth: 0 }}>
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          // Hide the default marker in all engines.
          // WebKit: ::-webkit-details-marker handled globally; here we just
          // make the summary render flat.
        }}
      >
        {summary}
      </summary>
      <div
        style={{
          margin: "2px 12px 8px 36px",
          padding: "8px 10px",
          borderLeft: "2px solid var(--stroke-neutral-subtle)",
          color: "var(--fg-neutral-subtle)",
          fontSize: 11.5,
          fontFamily: "var(--font-family-mono, ui-monospace, monospace)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 320,
          overflowY: "auto",
          background: "var(--surface-shallow)",
          borderRadius: 4,
        }}
      >
        {item.details ? (
          <div>
            <div style={{ opacity: 0.6, marginBottom: 2 }}>call</div>
            <div style={{ color: "var(--fg-neutral-prominent)" }}>{item.details}</div>
          </div>
        ) : null}
        {item.snippet ? (
          <div style={{ marginTop: item.details ? 10 : 0 }}>
            <div style={{ opacity: 0.6, marginBottom: 2 }}>
              result{item.ok === false ? " (error)" : ""}
            </div>
            <div style={{ color: "var(--fg-neutral-prominent)" }}>{item.snippet}</div>
          </div>
        ) : null}
      </div>
    </details>
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
  // Once a Computer turn ends, the persisted assistant message is rendered
  // from `history` as <ComputerMessage>. Suppress the live activity rows so
  // we don't show the same reply twice until the next turn clears `items`.
  const suppressActivity = source === "computer" && !busy;

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
            {m.role === "assistant" ? (
              <ReactMarkdown components={markdownComponents}>{m.content}</ReactMarkdown>
            ) : (
              m.content
            )}
          </BubbleRow>
        ),
      )}

      {pendingPrompt && <BubbleRow role="user">{pendingPrompt}</BubbleRow>}

      {/* Live turn rendering */}
      {isComputerLive ? (
        <ComputerLive thoughts={liveTools} narrations={liveNarrations} />
      ) : (
        <>
          {hasActivity && !suppressActivity && (
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
