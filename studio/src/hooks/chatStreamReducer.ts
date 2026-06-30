import type { StudioEvent } from "../lib/streamJson";
import { mapPathToFrame } from "../lib/agentCursor";

/**
 * Pure reducer for the chat stream state.
 *
 * Extracted from `useChatStream` so the host shell (`useProjectFromHost`)
 * drives the `StreamState` shape from a single source of truth. The reducer
 * consumes `StudioEvent`s arriving as SSE frames from `/api/chat/stream/:slug`.
 *
 * The reducer is intentionally side-effect-free; callers wrap it with
 * their own `setState` or `useReducer`.
 */

export type ErrorKind = "auth" | "generic";

export type ChatTurnItem =
  | { kind: "narration"; text: string }
  | { kind: "journey"; text: string }
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

export type TurnPhase = "idle" | "running" | "done" | "error" | "cancelled";

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
  /** Live cursor state derived from agent_cursor + narration events.
   *  Null when no turn is running or when a turn just ended. */
  agentCursor: {
    frame: string | null;
    action: "reading" | "writing" | "editing" | "thinking";
    filePath?: string;
    composites: string[];
    narration?: string;
    updatedAt: number;
  } | null;
  /** In-flight Write/Edit tool calls keyed by toolUseId. Seeded on the
   *  first `tool_input_partial` whose `filePath` resolves to a frame slug
   *  via `mapPathToFrame`, updated on each subsequent partial, and
   *  dropped on `tool_input_complete` or turn end. The viewport reads
   *  this to drive the live-cursor / phantom-skeleton overlays. */
  activeWrites: Record<string, {
    slug: string;
    filePath: string;
    action: "writing" | "editing";
    partialContent: string;
    startedAt: number;
  }>;
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
  agentCursor: null,
  activeWrites: {},
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
 * reconstructs the exact same UI as a live stream.
 *
 * `frames` is the project's current frame list. Used to resolve
 * `tool_input_partial` filePaths to a frame slug via `mapPathToFrame`
 * so the reducer can populate `activeWrites` only for paths that
 * actually correspond to a frame in the project. Defaults to `[]` so
 * legacy callers that don't yet pass frames degrade gracefully (no
 * activeWrites entries — same as a path mismatch).
 */
export function applyStudioEvent(
  s: StreamState,
  ev: StudioEvent,
  frames: ReadonlyArray<{ slug: string }> = [],
): StreamState {
  if (ev.kind === "origin") {
    return { ...s, lastEvent: ev, source: ev.source };
  }
  if (ev.kind === "session") {
    return { ...s, lastEvent: ev };
  }
  if (ev.kind === "narration") {
    const cursor = s.agentCursor
      ? { ...s.agentCursor, narration: ev.text, updatedAt: Date.now() }
      : {
          frame: null,
          action: "thinking" as const,
          composites: [],
          narration: ev.text,
          updatedAt: Date.now(),
        };
    return {
      ...s,
      lastEvent: ev,
      narrations: [...s.narrations, ev.text],
      items: appendItem(s.items, { kind: "narration", text: ev.text }),
      agentCursor: cursor,
    };
  }
  if (ev.kind === "journey") {
    return {
      ...s,
      lastEvent: ev,
      items: appendItem(s.items, { kind: "journey", text: ev.text }),
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
        agentCursor: null,
        activeWrites: {},
      };
    }
    if (ev.cancelled) {
      return {
        ...s,
        lastEvent: ev,
        busy: false,
        phase: "cancelled",
        error: null,
        errorKind: undefined,
        turnEndedAt: Date.now(),
        agentCursor: null,
        activeWrites: {},
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
      agentCursor: null,
      activeWrites: {},
    };
  }
  if (ev.kind === "agent_cursor") {
    return {
      ...s,
      lastEvent: ev,
      agentCursor: {
        frame: ev.frame,
        action: ev.action,
        filePath: ev.filePath,
        composites: ev.composites ?? [],
        narration: s.agentCursor?.narration,
        updatedAt: Date.now(),
      },
    };
  }
  if (ev.kind === "tool_call_started") {
    // No-op until we know the filePath; that arrives on the first
    // tool_input_partial. Recorded only via lastEvent for debug.
    return { ...s, lastEvent: ev };
  }
  if (ev.kind === "tool_input_partial") {
    const slug = ev.filePath ? mapPathToFrame(ev.filePath, frames) : null;
    if (!slug || !ev.filePath) {
      // Path outside frames or unknown — drop. The cursor system parks
      // for these too; we follow the same policy here.
      return { ...s, lastEvent: ev };
    }
    const existing = s.activeWrites[ev.toolUseId];
    return {
      ...s,
      lastEvent: ev,
      activeWrites: {
        ...s.activeWrites,
        [ev.toolUseId]: {
          slug,
          filePath: ev.filePath,
          action: ev.action,
          partialContent: ev.partialContent,
          startedAt: existing?.startedAt ?? Date.now(),
        },
      },
    };
  }
  if (ev.kind === "tool_input_complete") {
    if (!(ev.toolUseId in s.activeWrites)) {
      return { ...s, lastEvent: ev };
    }
    const next = { ...s.activeWrites };
    delete next[ev.toolUseId];
    return { ...s, lastEvent: ev, activeWrites: next };
  }
  return { ...s, lastEvent: ev };
}
