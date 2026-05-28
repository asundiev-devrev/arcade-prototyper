import type { StudioEvent } from "../src/lib/streamJson";

/**
 * In-memory per-slug turn registry.
 *
 * One running turn per project slug. Every StudioEvent emitted by the runner
 * is appended to the turn's `events` buffer AND fanned out to live
 * subscribers. Subscribers joining mid-turn get a full replay followed by
 * live events — this is what makes refreshes and cross-navigation handoffs
 * seamless (home → project detail keeps showing the stream because the
 * project-detail SSE connects to the same turn the home page started).
 *
 * Turns are retained `TURN_RETENTION_MS` after they end so a refresh
 * immediately after completion still replays the full activity and surfaces
 * the terminal status instead of "no turn running".
 */

export type TurnStatus = "running" | "done" | "error" | "cancelled";

export interface Turn {
  slug: string;
  id: string;
  prompt: string;
  startedAt: number;
  endedAt?: number;
  status: TurnStatus;
  error?: string;
  cancelled?: boolean;
  events: StudioEvent[];
  /** Active subscribers. Runner calls `emit`; subscribers fan out to SSE. */
  subscribers: Set<(ev: StudioEvent) => void>;
  /** Fired once the turn transitions to done/error; SSE handlers use this to close. */
  terminators: Set<() => void>;
  abortController: AbortController;
}

const turns = new Map<string, Turn>();
const retentionTimers = new Map<string, NodeJS.Timeout>();

/** How long a done/error turn is kept in memory for late subscribers. */
const TURN_RETENTION_MS = 5 * 60 * 1000;

/** How many events to keep per turn. Safety cap so a runaway turn can't OOM. */
const MAX_EVENTS_PER_TURN = 5000;

export interface StartTurnInit {
  prompt: string;
  /**
   * Runner callback — called once synchronously. Gets `emit(ev)` to feed the
   * turn, and is expected to call `end({ ok, error? })` when done. The
   * registry owns the terminal transition; the runner is only responsible
   * for emitting events while the subprocess is alive.
   */
  run: (api: {
    emit: (ev: StudioEvent) => void;
    end: (result: { ok: boolean; error?: string }) => void;
    signal: AbortSignal;
  }) => void | Promise<void>;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Start (or replace) the running turn for `slug`.
 *
 * If a turn is already running for this slug, it's terminated with an
 * "overridden" error so the old subscribers unblock. This guards against a
 * second POST /api/chat racing with a live turn; the middleware typically
 * enforces "one at a time" upstream, but we want the invariant here too.
 */
export function startTurn(slug: string, init: StartTurnInit): Turn {
  const existing = turns.get(slug);
  if (existing && existing.status === "running") {
    finalize(existing, { ok: false, error: "Turn superseded by a new request." });
  }

  const turn: Turn = {
    slug,
    id: randomId(),
    prompt: init.prompt,
    startedAt: Date.now(),
    status: "running",
    events: [],
    subscribers: new Set(),
    terminators: new Set(),
    abortController: new AbortController(),
  };
  turns.set(slug, turn);

  const retentionTimer = retentionTimers.get(slug);
  if (retentionTimer) {
    clearTimeout(retentionTimer);
    retentionTimers.delete(slug);
  }

  const emit = (ev: StudioEvent) => {
    if (turn.status !== "running") return;
    if (turn.events.length < MAX_EVENTS_PER_TURN) {
      turn.events.push(ev);
    }
    for (const fn of turn.subscribers) {
      try { fn(ev); } catch (err) { console.warn("[turnRegistry] subscriber threw:", err); }
    }
  };

  const end = (result: { ok: boolean; error?: string }) => {
    finalize(turn, result);
  };

  try {
    const ret = init.run({ emit, end, signal: turn.abortController.signal });
    if (ret && typeof (ret as Promise<void>).catch === "function") {
      (ret as Promise<void>).catch((err) => {
        finalize(turn, { ok: false, error: err?.message ?? String(err) });
      });
    }
  } catch (err: any) {
    finalize(turn, { ok: false, error: err?.message ?? String(err) });
  }

  return turn;
}

function finalize(
  turn: Turn,
  result: { ok: boolean; error?: string; cancelled?: boolean },
): void {
  if (turn.status !== "running") return;
  if (result.cancelled) {
    turn.status = "cancelled";
    turn.cancelled = true;
    turn.error = result.error ?? "Cancelled by user.";
  } else {
    turn.status = result.ok ? "done" : "error";
    turn.error = result.ok ? undefined : result.error ?? "Unknown error.";
  }
  turn.endedAt = Date.now();
  const terminal: StudioEvent = result.ok
    ? { kind: "end", ok: true }
    : {
        kind: "end",
        ok: false,
        error: turn.error!,
        ...(result.cancelled ? { cancelled: true } : {}),
      };
  const lastEvent = turn.events[turn.events.length - 1];
  const alreadyHasTerminal =
    lastEvent &&
    lastEvent.kind === "end" &&
    lastEvent.ok === terminal.ok &&
    (lastEvent as { error?: string }).error === (terminal as { error?: string }).error &&
    (lastEvent as { cancelled?: boolean }).cancelled === (terminal as { cancelled?: boolean }).cancelled;
  if (!alreadyHasTerminal && turn.events.length < MAX_EVENTS_PER_TURN) {
    turn.events.push(terminal);
    for (const fn of turn.subscribers) {
      try { fn(terminal); } catch {}
    }
  }
  for (const fn of turn.terminators) {
    try { fn(); } catch {}
  }
  turn.subscribers.clear();
  turn.terminators.clear();

  const timer = setTimeout(() => {
    if (turns.get(turn.slug) === turn) turns.delete(turn.slug);
    retentionTimers.delete(turn.slug);
  }, TURN_RETENTION_MS);
  timer.unref?.();
  retentionTimers.set(turn.slug, timer);
}

export function getTurn(slug: string): Turn | undefined {
  return turns.get(slug);
}

export function cancelTurn(slug: string): boolean {
  const turn = turns.get(slug);
  if (!turn || turn.status !== "running") return false;
  turn.abortController.abort(new Error("cancelled by user"));
  finalize(turn, { ok: false, cancelled: true, error: "Cancelled by user." });
  return true;
}

export interface Subscription {
  /** The events already buffered at the time of subscription. Replay these first. */
  replay: StudioEvent[];
  /** Current status at subscription time. If "done" or "error", no live events will arrive. */
  status: TurnStatus;
  /** Call to stop receiving new events. Idempotent. */
  unsubscribe: () => void;
}

/**
 * Subscribe to a turn. Returns a replay snapshot plus hooks for live events
 * and a terminal signal. If the turn has already ended, `onEvent` is never
 * called; the caller should finish after replaying.
 */
export function subscribe(
  slug: string,
  onEvent: (ev: StudioEvent) => void,
  onTerminate: () => void,
): Subscription | undefined {
  const turn = turns.get(slug);
  if (!turn) return undefined;
  const replay = turn.events.slice();
  if (turn.status !== "running") {
    return { replay, status: turn.status, unsubscribe: () => {} };
  }
  turn.subscribers.add(onEvent);
  turn.terminators.add(onTerminate);
  return {
    replay,
    status: turn.status,
    unsubscribe: () => {
      turn.subscribers.delete(onEvent);
      turn.terminators.delete(onTerminate);
    },
  };
}

/** Test-only: wipe all turns and timers. */
export function __resetTurnRegistryForTests(): void {
  for (const t of retentionTimers.values()) clearTimeout(t);
  retentionTimers.clear();
  turns.clear();
}
