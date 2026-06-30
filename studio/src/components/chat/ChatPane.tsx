import { type MutableRefObject } from "react";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { useChatStreamContext } from "../../hooks/chatStreamContext";
import { useEditBlocks } from "../../hooks/editBlocksContext";
import type { ChatMessage, ChimeIn } from "../../../server/types";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../lib/figmaUrl";
import { peekPendingPrompt } from "../../lib/pendingPrompt";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { AuthExpiredNotice } from "../feedback/AuthExpiredNotice";

/**
 * Persisted chat history is owned by `useProjectFromHost` and threaded down
 * via the `history` prop. ChatPane intentionally does NOT fetch
 * `/api/projects/:slug/history` itself — the source hook does that exactly
 * once per relevant trigger. Earlier versions duplicated the fetch here; that
 * double-fired on every phase transition out of `running` and on every
 * `arcade-studio:refresh-chat-history` window event.
 */
export function ChatPane({
  projectSlug,
  history,
  seedRef,
  chimeIns = [],
  onApplyChimeIn,
  onDismissChimeIn,
  onUndoBlock,
  onApplyBlock,
  onDiscardBlock,
  framesWithAiApply,
}: {
  projectSlug: string;
  history: ChatMessage[];
  seedRef?: MutableRefObject<((text: string) => void) | null>;
  chimeIns?: ChimeIn[];
  onApplyChimeIn?: (c: ChimeIn) => void;
  onDismissChimeIn?: (c: ChimeIn) => void;
  onUndoBlock?: (id: string) => void;
  onApplyBlock?: (id: string) => void;
  onDiscardBlock?: (id: string) => void;
  framesWithAiApply?: Set<string>;
}) {
  const { state, send, retry, cancel } = useChatStreamContext();
  const { blocks } = useEditBlocks();

  const enhancedSend = (prompt: string, images: string[] = []) => {
    const url = extractFigmaUrl(prompt);
    const decorated = url ? decoratePromptWithFigma(prompt, url) : prompt;
    return send(decorated, images);
  };

  // Optimistically show the user's prompt bubble if the latest turn's
  // prompt hasn't landed in persisted history yet. `state.lastPrompt` is
  // set either by the local optimistic update in `send()` or by the server
  // turn header on reconnect — both cases paint immediately.
  const historyHasPrompt = history.some(
    (m) => m.role === "user" && m.content === state.lastPrompt,
  );
  // Hero handoff: when the user submits from HomePage we redirect to the
  // project route before the chat stream has any state. Peek (don't take —
  // ProjectDetail's effect still owns consuming) so the first paint shows
  // the prompt bubble + "Working…" row instead of an empty pane.
  const heroPending =
    history.length === 0 && state.phase === "idle"
      ? peekPendingPrompt(projectSlug)?.prompt
      : undefined;
  const pendingPrompt =
    state.lastPrompt && !historyHasPrompt && state.phase !== "idle"
      ? state.lastPrompt
      : heroPending;
  const optimisticBusy = !!heroPending;
  const phase = optimisticBusy ? "running" : state.phase;
  const turnStartedAt = optimisticBusy ? Date.now() : state.turnStartedAt;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MessageList
        history={history}
        pendingPrompt={pendingPrompt}
        currentItems={state.items}
        activeWrites={state.activeWrites}
        busy={phase === "running"}
        phase={phase}
        source={state.source}
        turnStartedAt={turnStartedAt}
        turnEndedAt={state.turnEndedAt}
        chimeIns={chimeIns}
        onApplyChimeIn={onApplyChimeIn}
        onDismissChimeIn={onDismissChimeIn}
        editBlocks={blocks}
        onUndoBlock={onUndoBlock}
        onApplyBlock={onApplyBlock}
        onDiscardBlock={onDiscardBlock}
        framesWithAiApply={framesWithAiApply}
      />
      {state.error && state.errorKind === "auth" && <AuthExpiredNotice />}
      {state.error && state.errorKind !== "auth" && (
        <ErrorBanner
          message={state.error}
          onRetry={state.phase !== "running" && state.lastPrompt ? retry : undefined}
        />
      )}
      <PromptInput
        busy={phase === "running"}
        projectSlug={projectSlug}
        onSend={enhancedSend}
        onStop={cancel}
        seedRef={seedRef}
      />
    </div>
  );
}
