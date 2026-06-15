import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioEvent } from "../lib/streamJson";
import {
  applyStudioEvent,
  classifyError,
  INITIAL_STREAM_STATE,
  type ChatTurnItem,
  type ErrorKind,
  type StreamState,
  type TurnPhase,
} from "./chatStreamReducer";

// Re-export for callers that imported these symbols from `useChatStream`
// before the reducer was extracted into its own module. New code should
// prefer importing directly from `./chatStreamReducer`.
export type { ChatTurnItem, ErrorKind, StreamState, TurnPhase };
export { classifyError };

const INITIAL_STATE = INITIAL_STREAM_STATE;

/**
 * Outcome of a `send()` call. `{ ok: true }` means the turn started (or we
 * latched onto a genuine retry of the live turn). `reason: "busy"` means a
 * turn is already running and this prompt was NOT accepted — the caller
 * should preserve the typed text and let the user resend when idle.
 */
export type SendResult =
  | { ok: true }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "error"; message: string };

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
export function useChatStream(
  slug: string,
  frames: ReadonlyArray<{ slug: string }> = [],
) {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  const phaseRef = useRef<TurnPhase>("idle");
  /** Bumped on every explicit reconnect. Stale pumps check this and bail. */
  const genRef = useRef(0);
  /** Active fetch abort controller so reconnect/unmount can cancel the stream. */
  const controllerRef = useRef<AbortController | null>(null);
  /** Poked by `send()` to wake the pump loop when it's parked waiting for work. */
  const wakeRef = useRef<(() => void) | null>(null);
  /** Live frames ref so the reducer can resolve filePaths to slugs without
   *  baking the latest frame list into the SSE pump's closure. */
  const framesRef = useRef<ReadonlyArray<{ slug: string }>>(frames);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  const safeSetState = useCallback((updater: (s: StreamState) => StreamState) => {
    if (!mountedRef.current) return;
    setState((prev) => {
      const next = updater(prev);
      phaseRef.current = next.phase;
      return next;
    });
  }, []);

  /** Apply a StudioEvent to the stream state. Replayed and live events go
   *  through the same reducer so a reconnect reconstructs the exact same UI.
   *  Reducer logic lives in `./chatStreamReducer`. */
  const applyEvent = useCallback((ev: StudioEvent) => {
    safeSetState((s) => applyStudioEvent(s, ev, framesRef.current));
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
                // The server's "idle" verdict can race with a local optimistic
                // flip from send(): the SSE GET fires on mount, the server
                // sees no turn yet, and the `event: idle` frame may arrive
                // AFTER the route effect has already started one (which
                // optimistically set phase=running). If we stomped non-idle
                // states here we'd erase the Working… row and Stop button
                // until the next reconnect — exactly the "nothing's happening"
                // window the hero handoff was supposed to eliminate.
                //
                // So only fall to idle when we're in a terminal phase
                // (done/error/cancelled) that needs re-idling for the next
                // turn. Never override running — if the optimistic flip
                // turns out to be wrong (POST /api/chat fails), the catch
                // branch in send() flips us to error.
                safeSetState((s) =>
                  s.phase === "running" || s.phase === "idle"
                    ? s
                    : { ...s, phase: "idle", busy: false },
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

  const send = useCallback(async (prompt: string, images?: string[]): Promise<SendResult> => {
    if (phaseRef.current === "running") return { ok: false, reason: "busy" };
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
      if (res.status === 409) {
        // A turn is already running for this slug. Two very different cases:
        //
        // 1. Retry of the SAME prompt (user hit "Try again" while the first
        //    turn is still alive) → latch onto the live stream. Reconnecting
        //    re-syncs us to the server's turn header.
        // 2. A NEW prompt typed mid-turn → the server refused it and never
        //    persisted it. Reconnecting would wipe the optimistic bubble and
        //    silently drop the user's text. Instead, signal "busy" so the
        //    caller keeps the typed text and the user can resend when idle.
        let runningPrompt: string | undefined;
        try {
          const data = await res.json();
          runningPrompt = data?.prompt;
        } catch {}
        const isRetryOfLiveTurn =
          typeof runningPrompt === "string" && runningPrompt === prompt;
        // Re-sync to the live turn either way (the SSE header restores the
        // real running state), but report "busy" for a dropped new prompt so
        // the composer can preserve it.
        reconnect();
        return isRetryOfLiveTurn ? { ok: true } : { ok: false, reason: "busy" };
      }
      if (!res.ok) {
        let msg = `chat request failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error?.message) msg = data.error.message;
        } catch {}
        throw new Error(msg);
      }
      reconnect();
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      safeSetState((s) => ({
        ...s,
        busy: false,
        phase: "error",
        error: message,
        errorKind: classifyError(message),
      }));
      return { ok: false, reason: "error", message };
    }
  }, [slug, safeSetState, reconnect]);

  const retry = useCallback(() => {
    if (phaseRef.current === "running") return;
    const prompt = state.lastPrompt;
    if (!prompt) return;
    void send(prompt);
  }, [send, state.lastPrompt]);

  const cancel = useCallback(async () => {
    try {
      await fetch(`/api/chat/cancel/${slug}`, { method: "POST" });
    } catch {
      // Terminal `end` event from SSE drives state. If cancel POST fails
      // (rare; e.g. server restart), the stream itself will eventually
      // disconnect; user can retry. The server returns 409 if no turn is
      // running, which is also fine — UI doesn't read the response.
    }
  }, [slug]);

  return { state, send, retry, cancel };
}
