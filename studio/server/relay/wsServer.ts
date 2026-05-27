import type http from "node:http";
import { URL } from "node:url";
import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { resolveDevuFromPat } from "./auth";
import { getProject, isAllowed } from "./projectRegistry";
import { createReplayBuffer, type ReplayBuffer } from "./replayBuffer";
import {
  applyCommand,
  applyDisconnect,
  createLiveState,
  type InboundCommand,
  type LiveState,
} from "./protocol";
import { clientCommandSchema, type RelayEvent } from "./types";

/**
 * WebSocket layer for the multiplayer relay.
 *
 * Responsibilities:
 *   - HTTP upgrade handshake under /api/multiplayer/ws
 *   - Authorize the PAT + project allowlist on upgrade
 *     (HTTP 400 / 401 / 403 / 404 are returned BEFORE the WebSocket opens;
 *      runtime denials post-open close with WS code 4403)
 *   - Per-project live state (driver lock, connections, cursor snapshots,
 *     replay buffer)
 *   - Route validated commands through relay/protocol.ts
 *   - Fan events out with broadcast or per-connId addressing
 *   - Heartbeat + disconnect detection
 */

interface LiveSession {
  projectShareId: string;
  state: LiveState;
  sockets: Map<string, WebSocket>; // connId → socket
}

const liveSessions = new Map<string, LiveSession>(); // projectShareId → LiveSession

/**
 * Project event bus — fires whenever a relay event is broadcast to all
 * sockets in a project. Lets in-process consumers (e.g. the host-side SSE
 * endpoint in middleware/sharedProjects.ts) subscribe to live events
 * without holding a WebSocket of their own.
 *
 * Only "broadcast"-recipient events flow through here; per-conn unicast
 * stays on the WebSocket and never hits the bus.
 */
const projectBus = new EventEmitter();
// Bus carries N listeners per active project view; the default 10-cap is
// noisy in dev when multiple browser tabs subscribe to the same project.
projectBus.setMaxListeners(0);

/**
 * Subscribe to broadcast events for a single project. Returns an unsubscribe
 * function. Listener fires only for events whose projectShareId matches.
 */
export function onProjectEvent(
  projectShareId: string,
  listener: (ev: RelayEvent) => void,
): () => void {
  const wrapped = (id: string, ev: RelayEvent) => {
    if (id === projectShareId) listener(ev);
  };
  projectBus.on("event", wrapped);
  return () => {
    projectBus.off("event", wrapped);
  };
}

const HEARTBEAT_MS = 15_000;
const PING_TIMEOUT_MS = 40_000;

const attachedServers = new WeakSet<http.Server>();

/**
 * Attach the relay WebSocket handler to an HTTP server. Called from
 * vite.config.ts during `configureServer`. Idempotent per HTTP server —
 * repeated calls on the same server are a no-op (prevents listener
 * accumulation if Vite HMRs the plugin).
 */
export function attachRelayToHttpServer(server: http.Server): void {
  if (attachedServers.has(server)) return;
  attachedServers.add(server);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      if (!req.url?.startsWith("/api/multiplayer/ws")) return;
      const url = new URL(req.url, "http://localhost");
      const projectShareId = url.searchParams.get("projectShareId");
      const asRoleRaw = url.searchParams.get("asRole");
      const asRole = asRoleRaw === "host" || asRoleRaw === "guest" ? asRoleRaw : null;
      const headerPat = req.headers.authorization ?? "";
      const queryPat = url.searchParams.get("pat") ?? "";
      const pat = headerPat || queryPat;

      if (!projectShareId || !asRole) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const project = getProject(projectShareId);
      if (!project) {
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
      if (!isAllowed(projectShareId, identity.id)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      if (asRole === "host" && project.hostDevu !== identity.id) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        onConnection(ws, projectShareId, asRole, identity.id, identity.displayName);
      });
    } catch (err) {
      console.error("[relay] upgrade failed:", err);
      try { socket.destroy(); } catch {}
    }
  });
}

function getOrCreateLiveSession(projectShareId: string): LiveSession | null {
  const existing = liveSessions.get(projectShareId);
  if (existing) return existing;
  const project = getProject(projectShareId);
  if (!project) return null;
  const allowlist = [project.hostDevu, ...project.shared_with.map((c) => c.devu)];
  const state = createLiveState({
    projectShareId: project.id,
    hostDevu: project.hostDevu,
    allowlist,
    replayBuffer: createReplayBuffer({ chatTailLimit: 200 }),
  });
  const live: LiveSession = { projectShareId: project.id, state, sockets: new Map() };
  liveSessions.set(projectShareId, live);
  return live;
}

function onConnection(
  ws: WebSocket,
  projectShareId: string,
  asRole: "host" | "guest",
  devu: string,
  displayName: string,
): void {
  const live = getOrCreateLiveSession(projectShareId);
  if (!live) {
    // Race: project disappeared between upgrade-time check and now.
    sendEvent(ws, {
      type: "error",
      code: "project_gone",
      message: "Project no longer exists.",
    });
    ws.close(4404, "project_gone");
    return;
  }

  const connId = randomUUID();
  live.sockets.set(connId, ws);

  dispatch(live, {
    type: "join",
    projectShareId,
    asRole,
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
        message: result.error.issues[0]?.message ?? "Invalid command shape.",
      });
      return;
    }
    const cmd = result.data;
    // "join" commands over a live socket are ignored — the upgrade handshake
    // already joined us.
    if (cmd.type === "join") return;

    // Narrow each validated cmd to an InboundCommand with connection context.
    const inbound = attachConnContext(cmd, devu, connId);
    if (!inbound) return;
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
): InboundCommand | null {
  // Re-narrow a validated ClientCommand (which does NOT carry connDevu/connId)
  // into an InboundCommand by injecting the connection-scoped fields.
  switch (cmd.type) {
    case "join":
      // Filtered before this call — ignore.
      return null;
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
    case "comment_posted":
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
      projectBus.emit("event", live.projectShareId, ev.event);
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

/**
 * Broadcast an event to all connected sockets for a given projectShareId.
 * No-op if no live session exists for the project (no one connected yet).
 *
 * Used by the chat-relay mirror (middleware/chatRelayMirror.ts) to fan host
 * chat events out to live guests without forcing chat.ts to talk to the
 * relay's lower-level dispatch primitives.
 */
export function broadcastToProject(projectShareId: string, event: RelayEvent): void {
  const live = liveSessions.get(projectShareId);
  if (!live) return;
  for (const ws of live.sockets.values()) sendEvent(ws, event);
  projectBus.emit("event", live.projectShareId, event);
}

/**
 * Returns the replay buffer for a project, creating the live session lazily
 * if it doesn't exist yet. Returns null only when the project itself isn't
 * registered (e.g. the host hasn't shared it with anyone).
 *
 * Lazy creation matters for the host write path: the host writes frames to
 * disk before any guest has connected, and `recordChatEventForReplay` needs
 * a buffer to record into so a later-joining guest sees those frames in
 * their `cache_replay`. Previously this returned null until the first
 * socket connected, which silently dropped every pre-connect frame and
 * left guests staring at "No frames yet".
 */
export function getReplayBufferForProject(projectShareId: string): ReplayBuffer | null {
  const live = getOrCreateLiveSession(projectShareId);
  return live ? live.state.replayBuffer : null;
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
