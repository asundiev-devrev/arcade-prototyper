import { useCallback, useEffect, useRef, useState } from "react";
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
  refresh: () => Promise<void>;
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
  // Pass the project's known frames to `useChatStream` so the reducer can
  // resolve streamed `tool_input_partial` filePaths to a frame slug. We
  // use `project?.frames ?? []` rather than `useFrames` here because
  // `useFrames` lives inside `Viewport` (intentional — see comment below)
  // and the project record is refreshed on every turn anyway, which is
  // recent-enough for the live cursor to find the right slug.
  const projectFrames = project?.frames ?? [];
  const chatStream = useChatStream(slug, projectFrames);
  const { state: chat, send } = chatStream;
  const { host, guests } = useProjectPresence(slug);

  // Generation counter guards `refresh` against two races:
  //   - slug change mid-flight (a stale response would otherwise overwrite
  //     the new slug's project record);
  //   - unmount mid-flight (would set state on an unmounted component).
  // Each `refresh()` invocation captures a fresh `gen`; we only commit the
  // result when the captured value still matches the live `genRef`.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Bump generation on unmount so any in-flight refresh resolves into
      // a stale gen check and bails out.
      genRef.current += 1;
    };
  }, []);
  // Bump generation when slug changes so any in-flight refresh tied to the
  // previous slug is discarded before its response can land.
  useEffect(() => {
    genRef.current += 1;
  }, [slug]);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    const res = await fetch(`/api/projects/${slug}`);
    if (!res.ok) return;
    const p = (await res.json()) as Project;
    if (!mountedRef.current || gen !== genRef.current) return;
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

  // Subscribe to the host-side relay SSE so spectator comments paint live
  // in the host's chat pane. Server already persists comments into
  // `chat-history.json` via the host comment inbox, so the next history
  // pull would also pick them up — but appending here gives instant
  // feedback without waiting for the next turn to end. Dedupe by id so
  // the eventual history reload doesn't double-render.
  useEffect(() => {
    if (!slug) return;
    const es = new EventSource(`/api/projects/${slug}/presence-stream`);
    const onRelay = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (!ev || ev.type !== "comment_posted") return;
        const id = `comment:${String(ev.id ?? "")}`;
        if (id === "comment:") return;
        const text = String(ev.text ?? "");
        if (!text) return;
        const ts = typeof ev.ts === "number" ? ev.ts : Date.now();
        const msg: ChatMessage = {
          id,
          role: "user",
          content: text,
          createdAt: new Date(ts).toISOString(),
        };
        setChatHistory((h) => (h.some((m) => m.id === id) ? h : [...h, msg]));
      } catch {
        // ignore malformed frames
      }
    };
    es.addEventListener("relay", onRelay as EventListener);
    return () => {
      es.removeEventListener("relay", onRelay as EventListener);
      es.close();
    };
  }, [slug]);

  return {
    project,
    chatHistory,
    chat,
    chatStream,
    presence: { host, guests },
    status: "online",
    send,
    postComment: undefined,
    refresh,
  };
}
