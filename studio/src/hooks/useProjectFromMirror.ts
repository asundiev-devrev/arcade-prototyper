import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Frame, Project } from "../../server/types";
import type { StudioEvent } from "../lib/streamJson";
import {
  applyStudioEvent,
  INITIAL_STREAM_STATE,
  type StreamState,
} from "./chatStreamReducer";
import type { useChatStream } from "./useChatStream";
import type { ProjectShellSource } from "./useProjectFromHost";
import { deriveProjectName } from "../lib/deriveProjectName";

interface PresenceConnection {
  devu: string;
  displayName: string;
}

// Mirror payloads are typed loosely on the wire (the server already
// validates with Zod before broadcasting, but the show endpoint hands
// `chat` over as `unknown[]` and `frames` as `Record<string, string>`).
// We narrow defensively here so a malformed event can never crash the
// shell.
interface MirrorMetadata {
  id: string;
  relayUrl?: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
  addedAt: string;
  lastSeenAt: string;
}

interface MirrorShowResponse {
  metadata: MirrorMetadata;
  chat: unknown[];
  frames: Record<string, string>;
}

type RelayLike = { type?: string; [k: string]: unknown };

function synthesizeFrames(
  framesRecord: Record<string, string>,
  fallbackCreatedAt: string,
): Frame[] {
  const out: Frame[] = [];
  for (const path of Object.keys(framesRecord)) {
    // Pass `path` through verbatim as `slug`. Downstream slug regex
    // validation may reject characters the mirror permits (dots,
    // underscores) — but sanitizing here would silently drop frames
    // the host actually wrote. If validation fails downstream that's
    // a host-side issue to surface, not something to paper over.
    out.push({
      slug: path,
      name: deriveProjectName(path),
      createdAt: fallbackCreatedAt,
      size: "1440",
    });
  }
  return out;
}

function synthesizeProject(
  metadata: MirrorMetadata,
  framesRecord: Record<string, string>,
): Project {
  return {
    name: deriveProjectName(metadata.projectSlug),
    slug: metadata.projectSlug,
    createdAt: metadata.addedAt,
    updatedAt: metadata.lastSeenAt,
    theme: "arcade",
    mode: "light",
    frames: synthesizeFrames(framesRecord, metadata.lastSeenAt),
  };
}

/**
 * Translate a relay event into a synthetic `ChatMessage` if (and only if)
 * it represents a user-visible utterance. Agent narration / tool calls
 * are reduced into the live `StreamState` separately and must NOT also
 * be appended to history (that would double-render them).
 */
function relayEventToChatMessage(ev: RelayLike): ChatMessage | null {
  if (ev?.type === "prompt_started") {
    const text = typeof ev.text === "string" ? ev.text : "";
    const turnId = typeof ev.turnId === "string" ? ev.turnId : null;
    if (!text || !turnId) return null;
    return {
      id: `prompt:${turnId}`,
      role: "user",
      content: text,
      // No timestamp on the prompt_started wire; fall back to "now" so
      // ordering still works (we appended in chronological arrival order).
      createdAt: new Date().toISOString(),
    };
  }
  if (ev?.type === "comment_posted") {
    const text = typeof ev.text === "string" ? ev.text : "";
    const id = typeof ev.id === "string" ? ev.id : "";
    if (!text || !id) return null;
    const ts = typeof ev.ts === "number" ? new Date(ev.ts).toISOString() : new Date().toISOString();
    return {
      id: `comment:${id}`,
      role: "user",
      content: text,
      source: "claude",
      createdAt: ts,
    };
  }
  return null;
}

function isStudioEvent(value: unknown): value is StudioEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { kind?: unknown }).kind === "string",
  );
}

/**
 * Spectator-side adapter that produces the same `ProjectShellSource`
 * shape as `useProjectFromHost`, sourced from `/api/shared-projects/:id`.
 *
 * Endpoints used (the entire surface — no host-only API is touched):
 *   - `GET  /api/shared-projects/:id`           initial metadata + frames + chat
 *   - `GET  /api/shared-projects/:id/stream`    live SSE (`relay`, `status`)
 *   - `POST /api/shared-projects/:id/comment`   spectator's comment input
 *
 * The shell's chat reducer (`applyStudioEvent`) is shared with
 * `useChatStream` so live `agent_event` payloads carrying the inner
 * `StudioEvent` reconstruct the exact same UI a host would see.
 *
 * `send` is intentionally `undefined`: a spectator can't drive a turn.
 * The host shell returns the inverse (`send` defined, `postComment`
 * undefined) — the route layer (Task 4) picks by `mode`.
 */
export function useProjectFromMirror(id: string): ProjectShellSource {
  const [project, setProject] = useState<Project | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chat, setChat] = useState<StreamState>(INITIAL_STREAM_STATE);
  const [presence, setPresence] = useState<{
    host: PresenceConnection | null;
    guests: PresenceConnection[];
  }>({ host: null, guests: [] });
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");
  // Keep a live ref of metadata so SSE handlers can rebuild the project
  // (e.g. on cache_replay) without re-running the show fetch effect.
  const metadataRef = useRef<MirrorMetadata | null>(null);
  // Keep a live ref of frames so the SSE handler can mutate by path
  // without depending on the latest `project` closure.
  const framesRef = useRef<Record<string, string>>({});

  // Generation counter — same race-guarding pattern as useProjectFromHost.
  // Bumped on every refresh + on id-change + on unmount; in-flight responses
  // captured against an old gen bail out before committing state.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
    };
  }, []);
  useEffect(() => {
    genRef.current += 1;
    // Reset live frames when the id changes — otherwise frames from
    // the previous shared-project leak into the new one's first
    // synthesized snapshot.
    framesRef.current = {};
  }, [id]);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    let res: Response;
    try {
      res = await fetch(`/api/shared-projects/${id}`);
    } catch {
      return;
    }
    if (!mountedRef.current || gen !== genRef.current) return;
    if (!res.ok) {
      // 404 (project unshared) / 5xx must surface as offline — leaving
      // the synthesized project in place would lie to the spectator.
      setProject(null);
      setStatus("offline");
      return;
    }
    const data = (await res.json()) as MirrorShowResponse;
    if (!mountedRef.current || gen !== genRef.current) return;

    metadataRef.current = data.metadata;
    // Always merge live framesRef on top of the server snapshot — a
    // `frame_written` SSE event delivered between fetch start and JSON
    // parse must not be stomped by the older snapshot. On first load
    // framesRef is empty so this degrades to the natural assign.
    const serverFrames = data.frames ?? {};
    framesRef.current = { ...serverFrames, ...framesRef.current };

    setProject(synthesizeProject(data.metadata, framesRef.current));

    // Translate the raw `RelayEvent[]` chat into synthetic `ChatMessage[]`.
    // Only user-visible utterances (prompt_started, comment_posted) make
    // it through — agent narration is replayed via `cache_replay` later.
    const initialHistory: ChatMessage[] = [];
    for (const raw of data.chat ?? []) {
      const msg = relayEventToChatMessage(raw as RelayLike);
      if (msg) initialHistory.push(msg);
    }
    setChatHistory(initialHistory);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // SSE: live updates from /api/shared-projects/:id/stream.
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/shared-projects/${id}/stream`);

    const onRelay = (e: MessageEvent) => {
      let ev: RelayLike;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      const type = ev?.type;

      if (type === "frame_written" && typeof ev.path === "string") {
        const path = ev.path;
        const content = typeof ev.content === "string" ? ev.content : "";
        // Always update framesRef regardless of project state — when the
        // initial show fetch finally settles, refresh() merges this in
        // (rather than clobbering it with the older server snapshot).
        framesRef.current = { ...framesRef.current, [path]: content };
        setProject((p) => {
          if (!p) {
            // Frame arrived before show fetch settled. framesRef is
            // already updated; refresh() will rebuild on settle.
            return p;
          }
          if (p.frames.some((f) => f.slug === path)) return p;
          return {
            ...p,
            frames: [
              ...p.frames,
              {
                // Pass path through verbatim — see synthesizeFrames.
                slug: path,
                name: deriveProjectName(path),
                createdAt: new Date().toISOString(),
                size: "1440",
              },
            ],
          };
        });
        return;
      }

      if (type === "frame_deleted" && typeof ev.path === "string") {
        const path = ev.path;
        const next = { ...framesRef.current };
        delete next[path];
        framesRef.current = next;
        setProject((p) =>
          p ? { ...p, frames: p.frames.filter((f) => f.slug !== path) } : p,
        );
        return;
      }

      if (type === "presence_state") {
        const host = (ev.host as PresenceConnection | null | undefined) ?? null;
        const guests = Array.isArray(ev.guests)
          ? (ev.guests as PresenceConnection[])
          : [];
        setPresence({ host, guests });
        return;
      }

      if (type === "agent_event") {
        const inner = ev.event;
        if (isStudioEvent(inner)) {
          setChat((s) => applyStudioEvent(s, inner));
        }
        return;
      }

      if (type === "prompt_started" || type === "comment_posted") {
        const msg = relayEventToChatMessage(ev);
        if (!msg) return;
        // Optimistic append from `postComment` already inserted this id;
        // the relay echo would otherwise duplicate the bubble. Replace the
        // optimistic entry with the canonical broadcast (server ts/source).
        setChatHistory((h) => {
          const i = h.findIndex((m) => m.id === msg.id);
          if (i === -1) return [...h, msg];
          const next = h.slice();
          next[i] = msg;
          return next;
        });
        return;
      }

      if (type === "cache_replay") {
        // Resync frames + chat tail. Server side replays this when a
        // guest joins after the host has buffered events.
        const frames = (ev.frames as Record<string, string> | undefined) ?? {};
        framesRef.current = { ...frames };
        if (metadataRef.current) {
          setProject(synthesizeProject(metadataRef.current, framesRef.current));
        }
        const tail = Array.isArray(ev.chatHistoryTail) ? ev.chatHistoryTail : [];
        const synthesized: ChatMessage[] = [];
        for (const raw of tail) {
          const msg = relayEventToChatMessage(raw as RelayLike);
          if (msg) synthesized.push(msg);
        }
        // Always replace chatHistory — an empty tail is a valid resync
        // signal (host cleared) and must not be silently ignored.
        setChatHistory(synthesized);
        return;
      }

      // turn_ended / control_* / cursors / user_joined / user_left / error
      // — not surfaced through this hook (no UI consumer in the spectator
      // shell yet). Drop silently.
    };

    const onStatus = (e: MessageEvent) => {
      try {
        const { status: next } = JSON.parse(e.data) as { status?: string };
        if (next === "online" || next === "offline") setStatus(next);
      } catch {
        // ignore malformed status frames
      }
    };

    es.addEventListener("relay", onRelay as EventListener);
    es.addEventListener("status", onStatus as EventListener);

    return () => {
      es.removeEventListener("relay", onRelay as EventListener);
      es.removeEventListener("status", onStatus as EventListener);
      es.close();
    };
  }, [id]);

  const postComment = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const res = await fetch(`/api/shared-projects/${id}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        // Surface server failures to PromptInput's commentMode catch.
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `comment failed: ${res.status}`);
      }
      // Optimistic append: when the host is offline the relay never echoes
      // the comment back (server-side queue replays on reconnect), so the
      // bubble would otherwise never appear. The relay-broadcast handler
      // dedupes by id, so an eventual echo replaces this entry rather than
      // double-renders.
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        ts?: number;
      };
      if (!data.id) return;
      const ts = typeof data.ts === "number" ? data.ts : Date.now();
      const optimistic: ChatMessage = {
        id: `comment:${data.id}`,
        role: "user",
        content: trimmed,
        source: "claude",
        createdAt: new Date(ts).toISOString(),
      };
      setChatHistory((h) => (h.some((m) => m.id === optimistic.id) ? h : [...h, optimistic]));
    },
    [id],
  );

  // The spectator shell never owns a `useChatStream` instance — there's
  // no per-slug SSE stream to subscribe to. We synthesize a stand-in
  // that satisfies the `ProjectShellSource.chatStream` field for any
  // legacy descendant that destructures `state` / `send` / `retry`.
  // Spectator UI gates `send` off elsewhere; `retry` is a no-op.
  //
  // Memoized so reference identity only flips when `chat` actually
  // changes — descendants doing `useEffect(..., [chatStream])` won't
  // thrash on every parent render.
  const chatStream: ReturnType<typeof useChatStream> = useMemo(
    () => ({
      state: chat,
      send: async () => {
        /* spectator cannot drive turns */
      },
      retry: () => {
        /* no last-prompt context to retry from */
      },
    }),
    [chat],
  );

  return {
    project,
    chatHistory,
    chat,
    chatStream,
    presence,
    status,
    send: undefined,
    postComment,
    refresh,
  };
}
