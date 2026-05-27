import type { StudioEvent } from "../lib/streamJson";

/**
 * Pure reducer for the chat stream state.
 *
 * Extracted from `useChatStream` so that both the host shell
 * (`useProjectFromHost`) and the spectator shell (`useProjectFromMirror`)
 * can drive the exact same `StreamState` shape from a single source of
 * truth. Two independent hooks reducing the same events in different
 * places would silently diverge over time — this module pins the
 * behaviour for both.
 *
 * Inputs:
 *   - host: `StudioEvent`s arriving as SSE frames from `/api/chat/stream/:slug`.
 *   - spectator: `StudioEvent`s arriving wrapped inside `agent_event` relay
 *     events on `/api/shared-projects/:id/stream`.
 *
 * The reducer is intentionally side-effect-free; callers wrap it with
 * their own `setState` or `useReducer`.
 */

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

export const INITIAL_STREAM_STATE: StreamState = {
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

/**
 * Reducer step: fold one `StudioEvent` into the running `StreamState`.
 *
 * Replayed and live events go through the same reducer so a reconnect
 * (host) or initial `cache_replay` (spectator) reconstructs the exact
 * same UI as a live stream.
 */
export function applyStudioEvent(s: StreamState, ev: StudioEvent): StreamState {
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
}
