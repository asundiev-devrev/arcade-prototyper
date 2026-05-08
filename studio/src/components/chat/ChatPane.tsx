import { useEffect, useState, type MutableRefObject } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStreamContext } from "../../hooks/chatStreamContext";
import type { ChatMessage } from "../../../server/types";
import { EmptyStatePrompts } from "./EmptyStatePrompts";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../lib/figmaUrl";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { AuthExpiredNotice } from "../feedback/AuthExpiredNotice";

export function ChatPane({
  projectSlug,
  seedRef,
}: {
  projectSlug: string;
  seedRef?: MutableRefObject<((text: string) => void) | null>;
}) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const { state, send, retry } = useChatStreamContext();

  // Refresh persisted chat history whenever a turn transitions out of
  // `running`. The hook already streams live events for the current turn;
  // history only needs to be re-read when the server has written a new
  // final assistant message to disk.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const r = await fetch(`/api/projects/${projectSlug}/history`);
      if (!cancelled && r.ok) setHistory(await r.json());
    }
    if (state.phase !== "running") void refresh();
    return () => { cancelled = true; };
  }, [projectSlug, state.phase]);

  const enhancedSend = (prompt: string, images: string[] = []) => {
    const url = extractFigmaUrl(prompt);
    const decorated = url ? decoratePromptWithFigma(prompt, url) : prompt;
    send(decorated, images);
  };

  const showEmpty = history.length === 0 && state.phase === "idle";

  // Optimistically show the user's prompt bubble if the latest turn's
  // prompt hasn't landed in persisted history yet. `state.lastPrompt` is
  // set either by the local optimistic update in `send()` or by the server
  // turn header on reconnect — both cases paint immediately.
  const historyHasPrompt = history.some(
    (m) => m.role === "user" && m.content === state.lastPrompt,
  );
  const pendingPrompt =
    state.lastPrompt && !historyHasPrompt && state.phase !== "idle"
      ? state.lastPrompt
      : undefined;

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
          busy={state.phase === "running"}
          phase={state.phase}
          source={state.source}
          turnStartedAt={state.turnStartedAt}
          turnEndedAt={state.turnEndedAt}
        />
      )}
      {state.error && state.errorKind === "auth" && <AuthExpiredNotice />}
      {state.error && state.errorKind !== "auth" && (
        <ErrorBanner
          message={state.error}
          onRetry={state.phase !== "running" && state.lastPrompt ? retry : undefined}
        />
      )}
      <PromptInput busy={state.phase === "running"} projectSlug={projectSlug} onSend={enhancedSend} seedRef={seedRef} />
    </div>
  );
}
