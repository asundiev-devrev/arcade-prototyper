import { useCallback, useEffect, useState } from "react";
import type { Project, ChatMessage } from "../../server/types";
import { useChatStream, type StreamState } from "./useChatStream";
import { useProjectPresence } from "./useProjectPresence";

interface PresenceConnection {
  devu: string;
  displayName: string;
}

type ChatStream = ReturnType<typeof useChatStream>;

/**
 * Shared shape returned by both `useProjectFromHost` (this hook) and
 * `useProjectFromMirror` (Task 3 follow-up). The author shell and the
 * spectator shell consume the same `ProjectShellSource` so the layout
 * (`ProjectDetail`) doesn't need to fork on `mode`.
 *
 * Conventions:
 *   - host returns `send` defined and `postComment` undefined.
 *   - spectator returns the inverse and may produce a synthetic `project`.
 *   - `status` is `"online"` for the host (we always have a live session
 *     to ourselves); the spectator hook may toggle `"offline"` when the
 *     mirror SSE drops.
 *
 * `chatStream` is the full `useChatStream` return; the host route hands it
 * to `<ChatStreamProvider value={…}>` so descendants like `ChatPane` keep
 * their existing context API without spinning up a second SSE connection.
 */
export interface ProjectShellSource {
  project: Project | null;
  chatHistory: ChatMessage[];
  chat: StreamState;
  chatStream: ChatStream;
  presence: { host: PresenceConnection | null; guests: PresenceConnection[] };
  status: "online" | "offline" | "unknown";
  send?: (prompt: string, images?: string[]) => void;
  postComment?: (text: string) => Promise<void>;
  refresh: () => void;
}

/**
 * Aggregate the host-side data sources that `ProjectDetail` needs:
 *
 *   - `GET /api/projects/:slug` for the `Project` record (header title,
 *     theme, viewport mode, share/devmode chrome).
 *   - `GET /api/projects/:slug/history` for persisted chat messages.
 *   - `useChatStream(slug)` for the live SSE turn stream + `send()`.
 *   - `useProjectPresence(slug)` for the host/guest pill strip.
 *
 * Frame polling stays in `useFrames` (1.5s) and is consumed inside
 * `Viewport` — that's intentional: it'd waste a render cycle to lift
 * here without observable benefit.
 */
export function useProjectFromHost(slug: string): ProjectShellSource {
  const [project, setProject] = useState<Project | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatStream = useChatStream(slug);
  const { state: chat, send } = chatStream;
  const { host, guests } = useProjectPresence(slug);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    setProject(p);
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh persisted chat history whenever a turn transitions out of
  // `running`. Mirrors the logic that lived in ChatPane before extraction.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      const r = await fetch(`/api/projects/${slug}/history`);
      if (!cancelled && r.ok) setChatHistory(await r.json());
    }
    if (chat.phase !== "running") void pull();
    const onInviteRefresh = () => void pull();
    window.addEventListener(
      "arcade-studio:refresh-chat-history",
      onInviteRefresh,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        "arcade-studio:refresh-chat-history",
        onInviteRefresh,
      );
    };
  }, [slug, chat.phase]);

  return {
    project,
    chatHistory,
    chat,
    chatStream,
    presence: { host, guests },
    status: "online",
    send,
    postComment: undefined,
    refresh: () => {
      void refresh();
    },
  };
}
