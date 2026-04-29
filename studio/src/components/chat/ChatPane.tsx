import { useEffect, useState } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStreamContext } from "../../hooks/chatStreamContext";
import type { ChatMessage } from "../../../server/types";
import { EmptyStatePrompts } from "./EmptyStatePrompts";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../lib/figmaUrl";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { AuthExpiredNotice } from "../feedback/AuthExpiredNotice";

export function ChatPane({ projectSlug }: { projectSlug: string }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const { state, send, retry } = useChatStreamContext();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const r = await fetch(`/api/projects/${projectSlug}/history`);
      if (!cancelled && r.ok) setHistory(await r.json());
    }
    if (!state.busy) void refresh();
    return () => {
      cancelled = true;
    };
  }, [projectSlug, state.busy]);

  const enhancedSend = (prompt: string, images: string[] = []) => {
    const url = extractFigmaUrl(prompt);
    const decorated = url ? decoratePromptWithFigma(prompt, url) : prompt;
    send(decorated, images);
  };

  const showEmpty = history.length === 0 && !state.busy;

  // When the user just submitted but the server hasn't persisted the user
  // message to chat-history.json yet, show it optimistically in the list.
  const historyHasPrompt = history.some(
    (m) => m.role === "user" && m.content === state.lastPrompt,
  );
  const pendingPrompt = state.busy && !historyHasPrompt ? state.lastPrompt : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {showEmpty ? (
        <>
          <EmptyStatePrompts onPick={(p) => enhancedSend(p)} />
          <div style={{ flex: 1 }} />
        </>
      ) : (
        <MessageList
          history={history}
          pendingPrompt={pendingPrompt}
          currentItems={state.items}
          busy={state.busy}
          source={state.source}
        />
      )}
      {state.error && state.errorKind === "auth" && <AuthExpiredNotice />}
      {state.error && state.errorKind !== "auth" && (
        <ErrorBanner
          message={state.error}
          onRetry={!state.busy && state.lastPrompt ? retry : undefined}
        />
      )}
      <PromptInput busy={state.busy} projectSlug={projectSlug} onSend={enhancedSend} />
    </div>
  );
}
