import type http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { resolveDevuFromPat } from "./auth";
import { getSession } from "./sessionRegistry";
import {
  applyCommand,
  applyDisconnect,
  createLiveState,
  type ConnectionRef,
  type InboundCommand,
  type LiveState,
} from "./protocol";
import { clientCommandSchema, type RelayEvent } from "./types";

/**
 * WebSocket layer for the multiplayer relay.
 *
 * Responsibilities:
 *   - HTTP upgrade handshake under /api/multiplayer/ws
 *   - Authenticate the PAT on upgrade (reject with close code 4401 on failure)
 *   - Per-session live state (driver lock, connections, cursor snapshots)
 *   - Route validated commands through relay/protocol.ts
 *   - Fan events out with broadcast or per-connId addressing
 *   - Heartbeat + disconnect detection
 */

interface LiveSession {
  state: LiveState;
  sockets: Map<string, WebSocket>; // connId → socket
}

const liveSessions = new Map<string, LiveSession>(); // sessionId → LiveSession

const HEARTBEAT_MS = 15_000;
const PING_TIMEOUT_MS = 40_000;

/**
 * Attach the relay WebSocket handler to an HTTP server. Called from
 * vite.config.ts during `configureServer`.
 */
export function attachRelayToHttpServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      if (!req.url?.startsWith("/api/multiplayer/ws")) return;
      const url = new URL(req.url, "http://localhost");
      const sessionId = url.searchParams.get("sessionId");
      const pat = req.headers.authorization ?? "";

      if (!sessionId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const session = getSession(sessionId);
      if (!session || session.endedAt) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      const identity = await resolveDevuFromPat(pat);
      if (!identity) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        onConnection(ws, sessionId, identity.id, identity.displayName);
      });
    } catch (err) {
      console.error("[relay] upgrade failed:", err);
      try { socket.destroy(); } catch {}
    }
  });
}

function getOrCreateLiveSession(sessionId: string): LiveSession | null {
  const existing = liveSessions.get(sessionId);
  if (existing) return existing;
  const persisted = getSession(sessionId);
  if (!persisted || persisted.endedAt) return null;
  const state = createLiveState({
    sessionId: persisted.id,
    sessionObject: persisted.sessionObject,
    hostDevu: persisted.hostDevu,
    inviteList: persisted.invites.map((i) => i.devu).concat(persisted.hostDevu),
  });
  const live: LiveSession = { state, sockets: new Map() };
  liveSessions.set(sessionId, live);
  return live;
}

function onConnection(
  ws: WebSocket,
  sessionId: string,
  devu: string,
  displayName: string,
): void {
  const live = getOrCreateLiveSession(sessionId);
  if (!live) {
    sendEvent(ws, {
      type: "error",
      code: "session_gone",
      message: "Session no longer exists.",
    });
    ws.close(4404, "session_gone");
    return;
  }

  const connId = randomUUID();
  live.sockets.set(connId, ws);

  dispatch(live, {
    type: "join",
    sessionId,
    connDevu: devu,
    connDisplayName: displayName,
    connId,
  });

  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) {
      try { ws.terminate(); } catch {}
      return;
    }
    alive = false;
    try { ws.ping(); } catch {}
  }, HEARTBEAT_MS);
  const pingTimeout = setTimeout(() => {
    try { ws.terminate(); } catch {}
  }, PING_TIMEOUT_MS);
  ws.on("pong", () => {
    alive = true;
    pingTimeout.refresh();
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      sendEvent(ws, { type: "error", code: "bad_json", message: "Invalid JSON frame." });
      return;
    }
    const result = clientCommandSchema.safeParse(parsed);
    if (!result.success) {
      sendEvent(ws, {
        type: "error",
        code: "bad_command",
        message: result.error.errors[0]?.message ?? "Invalid command shape.",
      });
      return;
    }
    const cmd = result.data;
    // "join" commands over a live socket are ignored — the upgrade handshake
    // already joined us.
    if (cmd.type === "join") return;

    // Narrow each validated cmd to an InboundCommand with connection context.
    // TypeScript can't infer this from a discriminated union of Zod outputs
    // without a little manual dispatch.
    const inbound = attachConnContext(cmd, devu, connId);
    dispatch(live, inbound);
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(pingTimeout);
    live.sockets.delete(connId);
    const { nextState, events } = applyDisconnect(live.state, connId);
    live.state = nextState;
    emitAll(live, events);
  });

  ws.on("error", (err) => {
    console.warn("[relay] ws error:", err);
  });
}

function attachConnContext(
  cmd: ReturnType<typeof clientCommandSchema.parse>,
  connDevu: string,
  connId: string,
): InboundCommand {
  // Re-narrow a validated ClientCommand (which does NOT carry connDevu/connId)
  // into an InboundCommand by injecting the connection-scoped fields.
  switch (cmd.type) {
    case "join":
      // Unreachable — filtered before this call.
      return { type: "join", sessionId: cmd.sessionId, connDevu, connDisplayName: "", connId };
    case "request_control":
    case "release_control":
    case "claim_control":
      return { ...cmd, connDevu, connId };
    case "grant_control":
      return { ...cmd, connDevu, connId };
    case "prompt":
      return { ...cmd, connDevu, connId };
    case "frame_write":
      return { ...cmd, connDevu, connId };
    case "frame_delete":
      return { ...cmd, connDevu, connId };
    case "cancel_turn":
      return { ...cmd, connDevu, connId };
    case "cursor":
      return { ...cmd, connDevu, connId };
    case "agent_event":
      return { ...cmd, connDevu, connId };
    case "turn_ended":
      return { ...cmd, connDevu, connId };
  }
}

function dispatch(live: LiveSession, cmd: InboundCommand): void {
  const { nextState, events } = applyCommand(live.state, cmd);
  live.state = nextState;
  emitAll(live, events);
}

function emitAll(
  live: LiveSession,
  events: { recipient: string; event: RelayEvent }[],
): void {
  for (const ev of events) {
    if (ev.recipient === "broadcast") {
      for (const socket of live.sockets.values()) sendEvent(socket, ev.event);
    } else {
      const socket = live.sockets.get(ev.recipient);
      if (socket) sendEvent(socket, ev.event);
    }
  }
}

function sendEvent(ws: WebSocket, ev: RelayEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(ev));
  } catch (err) {
    console.warn("[relay] send failed:", err);
  }
}

/** Test-only: wipe live session state. Does NOT touch disk. */
export function __resetWsServerForTests(): void {
  for (const live of liveSessions.values()) {
    for (const ws of live.sockets.values()) {
      try { ws.terminate(); } catch {}
    }
  }
  liveSessions.clear();
}
