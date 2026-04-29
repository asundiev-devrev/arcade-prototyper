import { createContext, useContext, type ReactNode } from "react";
import { useChatStream } from "./useChatStream";

type ChatStream = ReturnType<typeof useChatStream>;

const Ctx = createContext<ChatStream | null>(null);

export function ChatStreamProvider({
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
