import type { ConnectionInfo, RelayEvent } from "./types";
import type { ReplayBuffer } from "./replayBuffer";

/**
 * Pure protocol engine. Zero I/O. Zero WebSocket. Zero time-sources except
 * the `now` option on applyCommand (enables deterministic tests).
 *
 * The WebSocket layer (relay/wsServer.ts) is responsible for:
 *   - receiving raw frames
 *   - Zod-validating them into ClientCommands
 *   - calling applyCommand(liveState, commandWithConnContext)
 *   - writing the returned events onto the appropriate connections
 *   - applying the returned nextState back to its own mutable reference
 *
 * Keeping this pure is what makes the correctness-critical bits (driver-lock,
 * turn serialization) trivially testable.
 *
 * Plan 2b: identity is now `projectShareId`, not session id. The set of
 * permitted devus is `allowlist` (host + shared_with). Each project owns a
 * `replayBuffer` so a freshly-connected guest can be brought to current
 * state with a single `cache_replay` event.
 */

const CONTROL_REQUEST_TTL_MS = 30_000;
const DORMANT_TAKEOVER_MS = 60_000;

export interface ConnectionRef {
  connId: string;
  devu: string;
  displayName: string;
}

export interface CursorEntry {
  x: number;
  y: number;
  frameId?: string;
  ts: number;
}

export interface LiveState {
  projectShareId: string;
  hostDevu: string;
  allowlist: string[];                         // devu ids allowed to join
  replayBuffer: ReplayBuffer;                  // per-project chat tail + frames
  connections: Map<string, ConnectionRef>;     // connId → ref
  driverDevu: string | null;
  /** When the current driver dropped connection, or null if connected. */
  driverDisconnectedAt: number | null;
  currentTurn: { turnId: string; byDevu: string; startedAt: number } | null;
  cursors: Map<string, CursorEntry>;           // devu → latest cursor
  controlRequest: { byDevu: string; expiresAt: number } | null;
}

export interface CreateLiveStateInput {
  projectShareId: string;
  hostDevu: string;
  allowlist: string[];
  replayBuffer: ReplayBuffer;
}

export function createLiveState(input: CreateLiveStateInput): LiveState {
  return {
    projectShareId: input.projectShareId,
    hostDevu: input.hostDevu,
    allowlist: input.allowlist,
    replayBuffer: input.replayBuffer,
    connections: new Map(),
    driverDevu: null,
    driverDisconnectedAt: null,
    currentTurn: null,
    cursors: new Map(),
    controlRequest: null,
  };
}

/**
 * Command envelope used by applyCommand. Adds connection context to the raw
 * ClientCommand. The WebSocket layer builds this by looking up the socket's
 * authenticated identity.
 */
export type InboundCommand =
  | { type: "join"; projectShareId: string; asRole: "host" | "guest"; connDevu: string; connDisplayName: string; connId: string }
  | { type: "request_control"; connDevu: string; connId: string }
  | { type: "grant_control"; connDevu: string; connId: string; targetDevu: string }
  | { type: "release_control"; connDevu: string; connId: string }
  | { type: "claim_control"; connDevu: string; connId: string }
  | { type: "prompt"; connDevu: string; connId: string; text: string; turnId: string }
  | { type: "frame_write"; connDevu: string; connId: string; path: string; content: string; turnId: string }
  | { type: "frame_delete"; connDevu: string; connId: string; path: string }
  | { type: "cancel_turn"; connDevu: string; connId: string; turnId: string }
  | { type: "cursor"; connDevu: string; connId: string; x: number; y: number; frameId?: string }
  | { type: "agent_event"; connDevu: string; connId: string; turnId: string; event: unknown }
  | { type: "turn_ended"; connDevu: string; connId: string; turnId: string; ok: boolean; error?: string }
  | { type: "comment_posted"; connDevu: string; connId: string; id: string; text: string; mentions: string[] };

export type EventRecipient = "broadcast" | string; // connId, or "broadcast"

export interface EmittedEvent {
  recipient: EventRecipient;
  event: RelayEvent;
}

export interface ApplyResult {
  nextState: LiveState;
  events: EmittedEvent[];
}

export interface ApplyOptions {
  now?: number;
}

function presenceFor(s: LiveState): { host: ConnectionInfo | null; guests: ConnectionInfo[] } {
  let host: ConnectionInfo | null = null;
  const guests: ConnectionInfo[] = [];
  // Dedupe by devu — multiple tabs from the same devu count as one presence.
  const seen = new Set<string>();
  for (const conn of s.connections.values()) {
    if (seen.has(conn.devu)) continue;
    seen.add(conn.devu);
    const info: ConnectionInfo = { devu: conn.devu, displayName: conn.displayName };
    if (conn.devu === s.hostDevu) host = info;
    else guests.push(info);
  }
  return { host, guests };
}

/**
 * Apply a command to live state. Returns the new state plus any events to
 * emit. Mutates nothing in place — returns a new LiveState.
 *
 * Events with recipient="broadcast" go to every connection in the session.
 * Events with recipient=<connId> go to that connection only (e.g. errors).
 */
export function applyCommand(
  state: LiveState,
  cmd: InboundCommand,
  opts: ApplyOptions = {},
): ApplyResult {
  const now = opts.now ?? Date.now();
  const s = cloneState(state);
  const events: EmittedEvent[] = [];

  switch (cmd.type) {
    case "join": {
      const allowed = s.allowlist.includes(cmd.connDevu);
      if (!allowed) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_allowed", message: "You are not allowed in this project." },
        });
        return { nextState: s, events };
      }
      // asRole=host but the connecting devu isn't the project host → reject.
      if (cmd.asRole === "host" && cmd.connDevu !== s.hostDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_host", message: "You are not the host of this project." },
        });
        return { nextState: s, events };
      }
      s.connections.set(cmd.connId, {
        connId: cmd.connId,
        devu: cmd.connDevu,
        displayName: cmd.connDisplayName,
      });
      // Host's first join claims the driver lock.
      if (!s.driverDevu && cmd.connDevu === s.hostDevu) {
        s.driverDevu = s.hostDevu;
      }
      // If this is the current driver returning after a disconnect, clear the timestamp.
      if (s.driverDevu === cmd.connDevu) {
        s.driverDisconnectedAt = null;
      }
      // First, replay cached state to the joining connection alone.
      const snap = s.replayBuffer.snapshot();
      events.push({
        recipient: cmd.connId,
        event: {
          type: "cache_replay",
          chatHistoryTail: snap.chatHistoryTail,
          frames: snap.frames,
        },
      });
      events.push({
        recipient: "broadcast",
        event: { type: "user_joined", devu: cmd.connDevu, displayName: cmd.connDisplayName },
      });
      // Then broadcast presence.
      const presence = presenceFor(s);
      events.push({
        recipient: "broadcast",
        event: {
          type: "presence_state",
          host: presence.host,
          guests: presence.guests,
        },
      });
      return { nextState: s, events };
    }

    case "request_control": {
      if (s.driverDevu === cmd.connDevu) {
        // Already driving — no-op.
        return { nextState: s, events };
      }
      s.controlRequest = {
        byDevu: cmd.connDevu,
        expiresAt: now + CONTROL_REQUEST_TTL_MS,
      };
      events.push({
        recipient: "broadcast",
        event: {
          type: "control_requested",
          byDevu: cmd.connDevu,
          expiresAt: s.controlRequest.expiresAt,
        },
      });
      return { nextState: s, events };
    }

    case "grant_control": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can grant control." },
        });
        return { nextState: s, events };
      }
      if (!s.allowlist.includes(cmd.targetDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_allowed", message: "Target is not in the allowlist." },
        });
        return { nextState: s, events };
      }
      const targetConnected = Array.from(s.connections.values()).some(
        (c) => c.devu === cmd.targetDevu,
      );
      if (!targetConnected) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "target_not_connected", message: "Target is not connected to this session." },
        });
        return { nextState: s, events };
      }
      s.driverDevu = cmd.targetDevu;
      s.driverDisconnectedAt = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: cmd.targetDevu, reason: "granted" },
      });
      return { nextState: s, events };
    }

    case "release_control": {
      if (s.driverDevu !== cmd.connDevu) {
        return { nextState: s, events };
      }
      s.driverDevu = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: null, reason: "released" },
      });
      return { nextState: s, events };
    }

    case "claim_control": {
      if (!s.allowlist.includes(cmd.connDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_allowed", message: "You are not allowed in this project." },
        });
        return { nextState: s, events };
      }
      const driverOffline =
        s.driverDevu !== null &&
        s.driverDisconnectedAt !== null &&
        now - s.driverDisconnectedAt >= DORMANT_TAKEOVER_MS;
      if (!driverOffline) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "driver_present", message: "Driver is still connected. Use request_control." },
        });
        return { nextState: s, events };
      }
      s.driverDevu = cmd.connDevu;
      s.driverDisconnectedAt = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: cmd.connDevu, reason: "claimed" },
      });
      return { nextState: s, events };
    }

    case "prompt": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can prompt." },
        });
        return { nextState: s, events };
      }
      if (s.currentTurn) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "turn_in_flight", message: "A turn is already running." },
        });
        return { nextState: s, events };
      }
      s.currentTurn = { turnId: cmd.turnId, byDevu: cmd.connDevu, startedAt: now };
      events.push({
        recipient: "broadcast",
        event: {
          type: "prompt_started",
          turnId: cmd.turnId,
          byDevu: cmd.connDevu,
          text: cmd.text,
        },
      });
      return { nextState: s, events };
    }

    case "agent_event":
    case "frame_write":
    case "frame_delete":
    case "cancel_turn":
    case "turn_ended": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can send this event." },
        });
        return { nextState: s, events };
      }
      if (cmd.type === "turn_ended") {
        s.currentTurn = null;
        events.push({
          recipient: "broadcast",
          event: { type: "turn_ended", turnId: cmd.turnId, ok: cmd.ok, error: cmd.error },
        });
      } else if (cmd.type === "agent_event") {
        events.push({
          recipient: "broadcast",
          event: { type: "agent_event", turnId: cmd.turnId, event: cmd.event },
        });
      } else if (cmd.type === "frame_write") {
        events.push({
          recipient: "broadcast",
          event: {
            type: "frame_written",
            path: cmd.path,
            content: cmd.content,
            turnId: cmd.turnId,
          },
        });
      } else if (cmd.type === "frame_delete") {
        events.push({
          recipient: "broadcast",
          event: { type: "frame_deleted", path: cmd.path },
        });
      } else if (cmd.type === "cancel_turn") {
        if (s.currentTurn?.turnId === cmd.turnId) s.currentTurn = null;
        events.push({
          recipient: "broadcast",
          event: { type: "turn_ended", turnId: cmd.turnId, ok: false, error: "cancelled" },
        });
      }
      return { nextState: s, events };
    }

    case "cursor": {
      if (!s.connections.has(cmd.connId)) {
        return { nextState: s, events };
      }
      s.cursors.set(cmd.connDevu, {
        x: cmd.x,
        y: cmd.y,
        frameId: cmd.frameId,
        ts: now,
      });
      // Emit a snapshot. The wsServer may coalesce these further.
      events.push({
        recipient: "broadcast",
        event: {
          type: "cursors",
          cursors: Object.fromEntries(s.cursors),
        },
      });
      return { nextState: s, events };
    }

    case "comment_posted": {
      const conn = s.connections.get(cmd.connId);
      if (!conn) {
        // Not joined — silently drop. (The WebSocket layer ensures every
        // connection has joined before receiving messages, but defend in
        // depth.)
        return { nextState: s, events };
      }
      events.push({
        recipient: "broadcast",
        event: {
          type: "comment_posted",
          id: cmd.id,
          byDevu: conn.devu,
          displayName: conn.displayName,
          text: cmd.text,
          mentions: cmd.mentions,
          ts: now,
        },
      });
      return { nextState: s, events };
    }

    default: {
      const _exhaustive: never = cmd;
      void _exhaustive;
      return { nextState: s, events };
    }
  }
}

/**
 * Apply a WebSocket disconnect. Removes the connection from the live state
 * and, if the disconnecting user was the driver, records the time so a
 * dormant takeover can be granted after the grace period.
 *
 * When a devu's last connection drops, also broadcasts a fresh
 * `presence_state` so peers see their absence.
 */
export function applyDisconnect(
  state: LiveState,
  connId: string,
  opts: ApplyOptions = {},
): ApplyResult {
  const now = opts.now ?? Date.now();
  const s = cloneState(state);
  const conn = s.connections.get(connId);
  if (!conn) return { nextState: s, events: [] };
  s.connections.delete(connId);
  const stillConnected = Array.from(s.connections.values()).some(
    (c) => c.devu === conn.devu,
  );
  const events: EmittedEvent[] = [];
  if (!stillConnected) {
    events.push({ recipient: "broadcast", event: { type: "user_left", devu: conn.devu } });
    const presence = presenceFor(s);
    events.push({
      recipient: "broadcast",
      event: {
        type: "presence_state",
        host: presence.host,
        guests: presence.guests,
      },
    });
  }
  if (!stillConnected && s.driverDevu === conn.devu) {
    s.driverDisconnectedAt = now;
  }
  return { nextState: s, events };
}

function cloneState(s: LiveState): LiveState {
  return {
    ...s,
    allowlist: s.allowlist.slice(),
    connections: new Map(s.connections),
    currentTurn: s.currentTurn ? { ...s.currentTurn } : null,
    cursors: new Map(s.cursors),
    controlRequest: s.controlRequest ? { ...s.controlRequest } : null,
    // replayBuffer is a stateful object — share the reference; we don't
    // clone it because clone semantics on a ring buffer would silently lose
    // state on every applyCommand.
  };
}
