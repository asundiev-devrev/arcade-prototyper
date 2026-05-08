import type { RelayEvent } from "./types";

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
  sessionId: string;
  sessionObject: string;
  hostDevu: string;
  inviteList: string[];            // devu ids allowed to join
  connections: Map<string, ConnectionRef>;   // connId → ref
  driverDevu: string | null;
  /** When the current driver dropped connection, or null if connected. */
  driverDisconnectedAt: number | null;
  currentTurn: { turnId: string; byDevu: string; startedAt: number } | null;
  cursors: Map<string, CursorEntry>; // devu → latest cursor
  controlRequest: { byDevu: string; expiresAt: number } | null;
}

export interface CreateLiveStateInput {
  sessionId: string;
  sessionObject: string;
  hostDevu: string;
  inviteList: string[];
}

export function createLiveState(input: CreateLiveStateInput): LiveState {
  return {
    sessionId: input.sessionId,
    sessionObject: input.sessionObject,
    hostDevu: input.hostDevu,
    inviteList: input.inviteList,
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
  | { type: "join"; sessionId: string; connDevu: string; connDisplayName: string; connId: string }
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
  | { type: "turn_ended"; connDevu: string; connId: string; turnId: string; ok: boolean; error?: string };

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
      const allowed = s.inviteList.includes(cmd.connDevu);
      if (!allowed) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "You are not invited to this session." },
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
      events.push({
        recipient: "broadcast",
        event: { type: "user_joined", devu: cmd.connDevu, displayName: cmd.connDisplayName },
      });
      events.push({
        recipient: "broadcast",
        event: {
          type: "session_state",
          driverDevu: s.driverDevu,
          connections: Array.from(s.connections.values()).map((c) => ({
            devu: c.devu,
            displayName: c.displayName,
          })),
          sessionObject: s.sessionObject,
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
      if (!s.inviteList.includes(cmd.targetDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "Target is not in the invite list." },
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
      if (!s.inviteList.includes(cmd.connDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "You are not invited." },
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
  }
}

/**
 * Apply a WebSocket disconnect. Removes the connection from the live state
 * and, if the disconnecting user was the driver, records the time so a
 * dormant takeover can be granted after the grace period.
 */
export function applyDisconnect(state: LiveState, connId: string): ApplyResult {
  const s = cloneState(state);
  const conn = s.connections.get(connId);
  if (!conn) return { nextState: s, events: [] };
  s.connections.delete(connId);
  const events: EmittedEvent[] = [
    { recipient: "broadcast", event: { type: "user_left", devu: conn.devu } },
  ];
  const stillConnected = Array.from(s.connections.values()).some(
    (c) => c.devu === conn.devu,
  );
  if (!stillConnected && s.driverDevu === conn.devu) {
    s.driverDisconnectedAt = Date.now();
  }
  return { nextState: s, events };
}

function cloneState(s: LiveState): LiveState {
  return {
    ...s,
    inviteList: s.inviteList.slice(),
    connections: new Map(s.connections),
    currentTurn: s.currentTurn ? { ...s.currentTurn } : null,
    cursors: new Map(s.cursors),
    controlRequest: s.controlRequest ? { ...s.controlRequest } : null,
  };
}
