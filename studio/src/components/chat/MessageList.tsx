import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { ChatBubble } from "@xorkavi/arcade-gen";
import type { ChatMessage, ChimeIn } from "../../../server/types";
import type { ChatTurnItem, TurnPhase } from "../../hooks/useChatStream";
import { ComputerMessage, markdownComponents } from "./computer/ComputerMessage";
import { ComputerThinkingRow } from "./computer/ComputerThinkingRow";
import { DottedLoader } from "./computer/DottedLoader";
import { NoFrameChangesBanner, splitNoChangesTrailer } from "./NoFrameChangesBanner";
import { TurnStatusRow } from "./TurnStatusRow";
import { ChimeInNote } from "./computer/ChimeInNote";
import { EditBlockRow } from "./EditBlockRow";
import type { EditBlock } from "../../hooks/editBlocksContext";

/** Returns true if this block is the newest applied instant block for its frame
 *  (LIFO-consistent undo eligibility). Only that block may show an actionable Undo. */
function isNewestAppliedInstantForFrame(block: EditBlock, all: EditBlock[]): boolean {
  if (block.kind !== "instant" || block.status !== "applied") return false;
  // Walk backward from the end to find the last applied instant for this frame.
  for (let i = all.length - 1; i >= 0; i--) {
    const candidate = all[i];
    if (candidate.frameSlug === block.frameSlug &&
        candidate.kind === "instant" &&
        candidate.status === "applied") {
      return candidate.id === block.id;
    }
  }
  return false;
}

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

/** Format a millisecond span compactly: `200ms`, `1.3s`, `1m 5s`. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

/** Render the call's position in the turn as an offset from turn start
 *  (`+12s`, `+1m 5s`) — a velocity timeline: reading the column top-to-bottom
 *  shows how far into the turn each step happened, and the gaps between rows
 *  show how long each step took. Falls back to per-call DURATION when the
 *  turn start time isn't known (e.g. replayed history without a header).
 *
 *  Re-renders on an interval while in-flight so the running row stays fresh. */
function Elapsed({
  startedAt,
  endedAt,
  turnStartedAt,
}: {
  startedAt: number;
  endedAt?: number;
  turnStartedAt?: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [endedAt]);

  // Offset mode: when this call STARTED, relative to the turn start. This is
  // the velocity view the column is meant to convey.
  if (turnStartedAt != null) {
    const offset = Math.max(0, startedAt - turnStartedAt);
    return <>{`+${formatMs(offset)}`}</>;
  }
  // Fallback: per-call duration (used when no turn-start anchor is available).
  return <>{formatMs((endedAt ?? now) - startedAt)}</>;
}

function ActivityRow({ item, turnStartedAt }: { item: ChatTurnItem; turnStartedAt?: number | null }) {
  // Mid-turn narration and journey lines share tool-row visual treatment so
  // the activity stream reads as a single voice. The persisted assistant
  // bubble (rendered from history after the turn ends) keeps its own style.
  if (item.kind === "narration" || item.kind === "journey") {
    return (
      <div
        data-kind={item.kind}
        style={{
          padding: "3px 12px",
          color: "var(--fg-neutral-medium)",
          fontSize: 12,
          fontFamily: "var(--font-family-mono, ui-monospace, monospace)",
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
      data-kind="tool"
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
        <Elapsed startedAt={item.startedAt} endedAt={item.endedAt} turnStartedAt={turnStartedAt} />
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
  phase = "idle",
  source = "claude",
  turnStartedAt = null,
  turnEndedAt = null,
  chimeIns = [],
  onApplyChimeIn,
  onDismissChimeIn,
  editBlocks = [],
  onUndoBlock,
  onApplyBlock,
  onDiscardBlock,
}: {
  history: ChatMessage[];
  pendingPrompt?: string;
  currentItems?: ChatTurnItem[];
  busy?: boolean;
  phase?: TurnPhase;
  source?: "claude" | "computer";
  turnStartedAt?: number | null;
  turnEndedAt?: number | null;
  chimeIns?: ChimeIn[];
  onApplyChimeIn?: (c: ChimeIn) => void;
  onDismissChimeIn?: (c: ChimeIn) => void;
  editBlocks?: EditBlock[];
  onUndoBlock?: (id: string) => void;
  onApplyBlock?: (id: string) => void;
  onDiscardBlock?: (id: string) => void;
}) {
  const hasActivity = !!currentItems && currentItems.length > 0;
  const liveTools = (currentItems ?? [])
    .filter((i): i is Extract<ChatTurnItem, { kind: "tool" }> => i.kind === "tool")
    .map((i) => i.pretty);
  // Mid-turn prose (journey + narration) renders as italic muted rows in
  // stream order. Narrations are no longer aggregated into a ComputerMessage
  // bubble while busy — the persisted bubble takes over from history once
  // the turn ends.
  const liveProse = (currentItems ?? []).filter(
    (i): i is Extract<ChatTurnItem, { kind: "journey" | "narration" }> =>
      i.kind === "journey" || i.kind === "narration",
  );

  const isComputerLive = source === "computer" && busy;
  // Once any turn ends, the persisted assistant message is the canonical
  // display — it comes back from history as a <ChatBubble> (Claude) or
  // <ComputerMessage> (Computer). We suppress the raw activity rows past
  // that point so we don't render narrations/tool calls twice alongside
  // the bubble. This also covers late subscribers on reload: the server
  // replays every buffered event, which would otherwise leak into the UI
  // as a duplicate rendering of the previous turn.
  const suppressActivity = !busy;

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
      {history.map((m) => {
        if (m.role === "system") {
          // System messages are inline info rows (not speech bubbles).
          // Used today for "Invited <name> to this session" after an
          // @-mention. Muted color, centered, no avatar, no bubble.
          return (
            <div
              key={m.id}
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "var(--fg-neutral-subtle)",
                padding: "4px 16px",
              }}
            >
              {m.content}
            </div>
          );
        }
        if (m.role === "assistant" && m.source === "computer") {
          const { body, hasWarning } = splitNoChangesTrailer(m.content);
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ComputerMessage content={body} />
              {hasWarning && <NoFrameChangesBanner />}
            </div>
          );
        }
        if (m.role === "assistant") {
          const { body, hasWarning } = splitNoChangesTrailer(m.content);
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <BubbleRow role="assistant">
                <ReactMarkdown components={markdownComponents}>{body}</ReactMarkdown>
              </BubbleRow>
              {hasWarning && <NoFrameChangesBanner />}
            </div>
          );
        }
        return (
          <BubbleRow key={m.id} role="user">
            {m.content}
          </BubbleRow>
        );
      })}

      {chimeIns
        .filter((c) => c.status === "pending")
        .map((c) => (
          <ChimeInNote
            key={c.id}
            chime={c}
            onApply={(x) => onApplyChimeIn?.(x)}
            onDismiss={(x) => onDismissChimeIn?.(x)}
          />
        ))}

      {pendingPrompt && <BubbleRow role="user">{pendingPrompt}</BubbleRow>}

      {/* Edit-block stream: instant edits land applied (with Undo); edits the
       *  deterministic writer can't map land pending (with Apply / Discard). */}
      {editBlocks.length > 0 && (
        <div data-testid="edit-block-stream" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {editBlocks.map((block) => (
            <EditBlockRow
              key={block.id}
              block={block}
              undoable={isNewestAppliedInstantForFrame(block, editBlocks)}
              onUndo={(id) => onUndoBlock?.(id)}
              onApply={(id) => onApplyBlock?.(id)}
              onDiscard={(id) => onDiscardBlock?.(id)}
            />
          ))}
        </div>
      )}

      {/* Live turn rendering */}
      {isComputerLive ? (
        <>
          {liveProse.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: -16, marginRight: -16 }}>
              {liveProse.map((item, i) => (
                <ActivityRow key={`p-${i}`} item={item} turnStartedAt={turnStartedAt} />
              ))}
            </div>
          )}
          <ComputerLive thoughts={liveTools} hasProse={liveProse.length > 0} />
        </>
      ) : (
        <>
          {hasActivity && !suppressActivity && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: -16, marginRight: -16 }}>
              {currentItems!.map((item, i) => (
                <ActivityRow key={i} item={item} turnStartedAt={turnStartedAt} />
              ))}
            </div>
          )}
          {/* Only show the live status row while the turn is running or has
           *  errored (error needs surfacing even without an assistant
           *  bubble). Suppress on `done` — the persisted assistant bubble
           *  from history is already visible and a late "Done in 1:12"
           *  sticker would feel tacked-on. */}
          {(phase === "running" || phase === "error") && (
            <TurnStatusRow
              phase={phase}
              startedAt={turnStartedAt}
              endedAt={turnEndedAt}
            />
          )}
          {phase === "cancelled" && (
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "var(--fg-neutral-subtle)",
                padding: "4px 16px",
              }}
            >
              Cancelled
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ComputerLive({ thoughts, hasProse }: { thoughts: string[]; hasProse: boolean }) {
  return (
    <div className="flex flex-col">
      {thoughts.length > 0 ? (
        <ComputerThinkingRow thoughts={thoughts} />
      ) : null}
      {!hasProse && (
        <div className="ml-3 text-(--fg-neutral-prominent)">
          <DottedLoader />
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
