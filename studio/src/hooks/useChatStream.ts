import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioEvent } from "../lib/streamJson";

export type ErrorKind = "auth" | "generic";

export type ChatTurnItem =
  | { kind: "narration"; text: string }
  | {
      kind: "tool";
      tool: string;
      pretty: string;
      /** Raw call input (full path / full command / full pattern). */
      details?: string;
      /** Full tool result once it arrives. `undefined` while call is in-flight. */
      ok?: boolean;
      snippet?: string;
      /** Wall-clock time the tool call was dispatched, for elapsed display. */
      startedAt: number;
      /** Wall-clock time the tool result arrived. */
      endedAt?: number;
    };

export type TurnPhase = "idle" | "running" | "done" | "error";

export interface StreamState {
  /** True while a turn is in flight. Alias for `phase === "running"`. */
  busy: boolean;
  phase: TurnPhase;
  error: string | null;
  errorKind?: ErrorKind;
  narrations: string[];
  items: ChatTurnItem[];
  lastEvent: StudioEvent | null;
  lastPrompt: string;
  /** Which agent is producing the current/last turn. Defaults to claude. */
  source: "claude" | "computer";
  /** Wall-clock time the current turn started on the server (ms). */
  turnStartedAt: number | null;
  /** Wall-clock time the current turn ended on the server (ms). */
  turnEndedAt: number | null;
}

const AUTH_EXPIRED = /sso|credential|expired|unauthorized/i;

export function classifyError(message: string): ErrorKind {
  return AUTH_EXPIRED.test(message) ? "auth" : "generic";
}

const INITIAL_STATE: StreamState = {
  busy: false,
  phase: "idle",
  error: null,
  errorKind: undefined,
  narrations: [],
  items: [],
  lastEvent: null,
  lastPrompt: "",
  source: "claude",
  turnStartedAt: null,
  turnEndedAt: null,
};

function appendItem(items: ChatTurnItem[], next: ChatTurnItem): ChatTurnItem[] {
  if (next.kind === "tool") {
    const last = items[items.length - 1];
    if (
      last &&
      last.kind === "tool" &&
      last.tool === next.tool &&
      last.pretty === next.pretty &&
      last.details === next.details
    ) {
      return items;
    }
  }
  return [...items, next];
}

function attachResultToLastTool(
  items: ChatTurnItem[],
  ok: boolean,
  snippet?: string,
): ChatTurnItem[] {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const entry = items[i];
    if (entry.kind === "tool" && entry.ok === undefined) {
      const updated = [...items];
      updated[i] = { ...entry, ok, snippet, endedAt: Date.now() };
      return updated;
    }
  }
  return items;
}

/** Envelope that the server's /api/chat/stream emits before replaying events. */
interface TurnHeader {
  kind: "turn";
  turnId: string;
  prompt: string;
  startedAt: number;
  status: "running" | "done" | "error";
  endedAt?: number;
  error?: string;
}

type ServerFrame =
  | { type: "turn"; data: TurnHeader }
  | { type: "idle" }
  | { type: "event"; data: StudioEvent };

function parseFrame(eventName: string, dataLine: string): ServerFrame | null {
  try {
    const data = JSON.parse(dataLine);
    if (eventName === "turn") return { type: "turn", data: data as TurnHeader };
    if (eventName === "idle") return { type: "idle" };
    return { type: "event", data: data as StudioEvent };
  } catch {
    return null;
  }
}

/**
 * Connect (and keep connected) to the per-slug server-owned turn stream.
 *
 * Contract with the server (`server/middleware/chat.ts`):
 *   GET /api/chat/stream/:slug
 *     - Opens an SSE response.
 *     - If no turn exists, emits a single `event: idle` and closes.
 *     - Otherwise emits `event: turn` with the turn header, replays every
 *       buffered StudioEvent, and (if running) keeps streaming live ones.
 *     - Always closes after the terminal `end` event.
 *
 *   POST /api/chat  { slug, prompt, images? }
 *     - Starts a turn in the registry and returns 202 immediately. No
 *       streaming in the response — everything flows through the GET
 *       endpoint.
 *     - Returns 409 if a turn is already running for this slug.
 *
 * This design makes every surface (home-to-detail navigation, page refresh,
 * passive viewing from another tab) show the same thing: whatever events
 * have been buffered so far, plus live updates.
 */
export function useChatStream(slug: string) {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  const phaseRef = useRef<TurnPhase>("idle");
  /** Bumped on every explicit reconnect. Stale pumps check this and bail. */
  const genRef = useRef(0);
  /** Active fetch abort controller so reconnect/unmount can cancel the stream. */
  const controllerRef = useRef<AbortController | null>(null);
  /** Poked by `send()` to wake the pump loop when it's parked waiting for work. */
  const wakeRef = useRef<(() => void) | null>(null);

  const safeSetState = useCallback((updater: (s: StreamState) => StreamState) => {
    if (!mountedRef.current) return;
    setState((prev) => {
      const next = updater(prev);
      phaseRef.current = next.phase;
      return next;
    });
  }, []);

  /** Apply a StudioEvent to the stream state. Replayed and live events go
   *  through the same reducer so a reconnect reconstructs the exact same UI. */
  const applyEvent = useCallback((ev: StudioEvent) => {
    safeSetState((s) => {
      if (ev.kind === "origin") {
        return { ...s, lastEvent: ev, source: ev.source };
      }
      if (ev.kind === "session") {
        return { ...s, lastEvent: ev };
      }
      if (ev.kind === "narration") {
        return {
          ...s,
          lastEvent: ev,
          narrations: [...s.narrations, ev.text],
          items: appendItem(s.items, { kind: "narration", text: ev.text }),
        };
      }
      if (ev.kind === "tool_call") {
        return {
          ...s,
          lastEvent: ev,
          items: appendItem(s.items, {
            kind: "tool",
            tool: ev.tool,
            pretty: ev.pretty,
            details: ev.details,
            startedAt: Date.now(),
          }),
        };
      }
      if (ev.kind === "tool_result") {
        return {
          ...s,
          lastEvent: ev,
          items: attachResultToLastTool(s.items, ev.ok, ev.snippet),
        };
      }
      if (ev.kind === "end") {
        if (ev.ok) {
          return {
            ...s,
            lastEvent: ev,
            busy: false,
            phase: "done",
            turnEndedAt: Date.now(),
          };
        }
        const err = ev.error ?? "unknown error";
        return {
          ...s,
          lastEvent: ev,
          busy: false,
          phase: "error",
          error: err,
          errorKind: classifyError(err),
          turnEndedAt: Date.now(),
        };
      }
      return { ...s, lastEvent: ev };
    });
  }, [safeSetState]);

  useEffect(() => {
    mountedRef.current = true;
    phaseRef.current = "idle";
    let cancelled = false;

    /** Drain a single SSE connection. Returns what ended it. */
    async function pumpOnce(): Promise<"idle" | "ended" | "disconnected"> {
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      const gen = genRef.current;

      let res: Response;
      try {
        res = await fetch(`/api/chat/stream/${slug}`, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: ctrl.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return "disconnected";
        throw err;
      }
      if (!res.ok || !res.body) {
        throw new Error(`stream request failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let outcome: "idle" | "ended" | "disconnected" = "disconnected";
      let sawTurnHeader = false;

      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (gen !== genRef.current) return "disconnected";
          buf += dec.decode(chunk.value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (!block.trim() || block.startsWith(":")) continue;
            const lines = block.split("\n");
            let eventName = "message";
            let dataLine = "";
            for (const ln of lines) {
              if (ln.startsWith("event: ")) eventName = ln.slice(7).trim();
              else if (ln.startsWith("data: ")) dataLine = ln.slice(6);
            }
            if (!dataLine) continue;
            const frame = parseFrame(eventName, dataLine);
            if (!frame) continue;

            if (frame.type === "idle") {
              if (!sawTurnHeader) {
                safeSetState((s) =>
                  s.phase === "idle" ? s : { ...s, phase: "idle", busy: false },
                );
              }
              outcome = "idle";
              continue;
            }

            if (frame.type === "turn") {
              sawTurnHeader = true;
              const header = frame.data;
              safeSetState(() => ({
                ...INITIAL_STATE,
                busy: header.status === "running",
                phase: header.status,
                lastPrompt: header.prompt,
                turnStartedAt: header.startedAt,
                turnEndedAt: header.endedAt ?? null,
                error: header.status === "error" ? header.error ?? "Turn failed." : null,
                errorKind:
                  header.status === "error" && header.error
                    ? classifyError(header.error)
                    : undefined,
              }));
              continue;
            }

            applyEvent(frame.data);
            if (frame.data.kind === "end") outcome = "ended";
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return "disconnected";
        throw err;
      }
      return outcome;
    }

    (async () => {
      let backoffMs = 500;
      while (!cancelled) {
        let outcome: "idle" | "ended" | "disconnected" = "disconnected";
        try {
          outcome = await pumpOnce();
        } catch {
          // Network error / dev server restart — fall through to backoff.
        }
        if (cancelled) return;

        if (outcome === "ended" || outcome === "idle") {
          // Park until a `send()` wakes us (e.g. a new turn starting) or
          // something triggers a reconnect (gen bump).
          const parkedGen = genRef.current;
          await new Promise<void>((resolve) => { wakeRef.current = resolve; });
          wakeRef.current = null;
          if (cancelled) return;
          // If nothing actually changed and we're still on the same gen,
          // continue the loop to reconnect on the next outer iteration.
          void parkedGen;
          backoffMs = 500;
          continue;
        }

        // Disconnected — retry with exponential backoff.
        await new Promise((r) => setTimeout(r, backoffMs));
        if (cancelled) return;
        backoffMs = Math.min(backoffMs * 2, 5000);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      genRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      wakeRef.current?.();
      wakeRef.current = null;
    };
  }, [slug, applyEvent, safeSetState]);

  /** Wake the pump loop and reconnect. Used after POST /api/chat so the
   *  client latches onto the server's newly-started turn immediately. */
  const reconnect = useCallback(() => {
    genRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    wakeRef.current?.();
  }, []);

  const send = useCallback(async (prompt: string, images?: string[]) => {
    if (phaseRef.current === "running") return;
    // Optimistic local state so the prompt bubble paints immediately, before
    // the server's turn header arrives over SSE.
    safeSetState((s) => ({
      ...INITIAL_STATE,
      lastPrompt: prompt,
      source: s.source,
      busy: true,
      phase: "running",
      turnStartedAt: Date.now(),
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, prompt, images }),
      });
      if (!res.ok) {
        let msg = `chat request failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error?.message) msg = data.error.message;
        } catch {}
        throw new Error(msg);
      }
      reconnect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      safeSetState((s) => ({
        ...s,
        busy: false,
        phase: "error",
        error: message,
        errorKind: classifyError(message),
      }));
    }
  }, [slug, safeSetState, reconnect]);

  const retry = useCallback(() => {
    if (phaseRef.current === "running") return;
    const prompt = state.lastPrompt;
    if (!prompt) return;
    void send(prompt);
  }, [send, state.lastPrompt]);

  return { state, send, retry };
}
