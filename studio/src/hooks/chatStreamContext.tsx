import { createContext, useContext, type ReactNode } from "react";
import { useChatStream } from "./useChatStream";

type ChatStream = ReturnType<typeof useChatStream>;

const Ctx = createContext<ChatStream | null>(null);

/**
 * Provide a chat stream to descendants. Either pass a `projectSlug` to have
 * the provider mount its own `useChatStream` (legacy behavior) or pass a
 * pre-built `value` from a parent that already owns the stream — used by
 * `useProjectFromHost` so the SSE connection isn't double-mounted.
 */
export function ChatStreamProvider(
  props:
    | { projectSlug: string; value?: never; children: ReactNode }
    | { projectSlug?: never; value: ChatStream; children: ReactNode },
) {
  if ("value" in props && props.value) {
    return <Ctx.Provider value={props.value}>{props.children}</Ctx.Provider>;
  }
  return <ChatStreamProviderFromSlug projectSlug={props.projectSlug!}>{props.children}</ChatStreamProviderFromSlug>;
}

function ChatStreamProviderFromSlug({
  projectSlug,
  children,
}: {
  projectSlug: string;
  children: ReactNode;
}) {
  const stream = useChatStream(projectSlug);
  return <Ctx.Provider value={stream}>{children}</Ctx.Provider>;
}

export function useChatStreamContext(): ChatStream {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useChatStreamContext must be used inside <ChatStreamProvider>");
  }
  return ctx;
}
