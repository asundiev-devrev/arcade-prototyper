import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStreamContext } from "../../hooks/chatStreamContext";
import { usePendingPrompt } from "../../hooks/pendingPromptContext";
import type { ChatMessage } from "../../../server/types";
import { EmptyStatePrompts } from "./EmptyStatePrompts";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../lib/figmaUrl";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { AuthExpiredNotice } from "../feedback/AuthExpiredNotice";

export function ChatPane({ projectSlug }: { projectSlug: string }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const { state, send, retry } = useChatStreamContext();
  const pending = usePendingPrompt();
  // StrictMode runs mount effects twice in dev. Deferring consume to a
  // microtask lets the first cleanup cancel before we touch the box, so the
  // second mount (the one that actually sticks) is the one that fires send.
  const pendingFiredRef = useRef(false);

  useEffect(() => {
    if (pendingFiredRef.current) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled || pendingFiredRef.current) return;
      const p = pending.consume();
      if (!p) return;
      pendingFiredRef.current = true;
      const withFigma = p.figmaUrl ? decoratePromptWithFigma(p.prompt, p.figmaUrl) : p.prompt;
      send(withFigma, p.imagePaths);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
