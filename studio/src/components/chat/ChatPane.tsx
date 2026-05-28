import { type MutableRefObject } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStreamContext } from "../../hooks/chatStreamContext";
import type { ChatMessage } from "../../../server/types";
import { EmptyStatePrompts } from "./EmptyStatePrompts";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../lib/figmaUrl";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { AuthExpiredNotice } from "../feedback/AuthExpiredNotice";

/**
 * Persisted chat history is owned by `useProjectFromHost` (or the spectator
 * equivalent) and threaded down via the `history` prop. ChatPane intentionally
 * does NOT fetch `/api/projects/:slug/history` itself — the source hook does
 * that exactly once per relevant trigger. Earlier versions duplicated the
 * fetch here; that double-fired on every phase transition out of `running`
 * and on every `arcade-studio:refresh-chat-history` window event.
 *
 * Spectator mode (`readonly={true}`) reuses the same `PromptInput` chrome —
 * placeholder, attach button, and authoring affordances are gated inside
 * PromptInput's `commentMode` branch. We pass `commentMode.onSubmit` so the
 * input posts to `/api/shared-projects/:id/comment` instead of driving a
 * turn. Identical chrome was a deliberate Figma-parity ask: guests should
 * not get a visibly downgraded composer.
 */
export function ChatPane({
  projectSlug,
  history,
  seedRef,
  readonly = false,
  postComment,
}: {
  projectSlug: string;
  history: ChatMessage[];
  seedRef?: MutableRefObject<((text: string) => void) | null>;
  readonly?: boolean;
  postComment?: (text: string) => Promise<void>;
}) {
  const { state, send, retry, cancel } = useChatStreamContext();

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
          {readonly ? null : <EmptyStatePrompts onPick={(p) => enhancedSend(p)} />}
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
      <PromptInput
        busy={state.phase === "running"}
        projectSlug={projectSlug}
        onSend={enhancedSend}
        onStop={readonly ? undefined : cancel}
        seedRef={seedRef}
        commentMode={
          readonly
            ? { onSubmit: async (text) => { await postComment?.(text); } }
            : undefined
        }
      />
    </div>
  );
}
