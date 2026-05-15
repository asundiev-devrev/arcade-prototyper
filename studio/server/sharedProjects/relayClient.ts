import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  appendChat,
  writeFrame,
  readMirror,
  touchLastSeen,
} from "./cache";
import { drainComments, enqueueComment } from "./commentQueue";
import { getDevRevPat } from "../secrets/keychain";
import { relayEventSchema } from "../relay/types";

/**
 * Server-side WebSocket client per shared-project mirror.
 *
 * Lives in the Vite dev process — NOT in the browser tab — so the
 * connection survives tab close. The browser fetches state through
 * sharedProjects middleware (HTTP/SSE), and the relay client owns
 * the live transport.
 */

interface MirrorClient {
  id: string;
  ws: WebSocket | null;
  bus: EventEmitter;
  reconnectMs: number;
  closed: boolean;
}

const clients = new Map<string, MirrorClient>();

export function getMirrorBus(id: string): EventEmitter | null {
  return clients.get(id)?.bus ?? null;
}

export async function connectMirror(id: string): Promise<void> {
  if (clients.has(id)) return;
  const meta = await readMirror(id);
  if (!meta) throw new Error(`No mirror for ${id}`);
  const client: MirrorClient = {
    id,
    ws: null,
    bus: new EventEmitter(),
    reconnectMs: 1000,
    closed: false,
  };
  clients.set(id, client);
  await openSocket(client, meta.relayUrl);
}

export async function disconnectMirror(id: string): Promise<void> {
  const c = clients.get(id);
  if (!c) return;
  c.closed = true;
  c.ws?.close();
  clients.delete(id);
}

export async function sendComment(
  id: string,
  text: string,
  mentions: string[] = [],
): Promise<void> {
  const c = clients.get(id);
  const cmd = {
    type: "comment_posted",
    id: `c-${Date.now()}`,
    text,
    mentions,
  };
  if (c?.ws?.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify(cmd));
  } else {
    await enqueueComment(id, {
      id: cmd.id,
      text,
      mentions,
      ts: Date.now(),
    });
  }
}

async function openSocket(
  client: MirrorClient,
  relayUrl: string,
): Promise<void> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const url = `${relayUrl}?projectShareId=${client.id}&asRole=guest&pat=${encodeURIComponent(pat)}`;
  const ws = new WebSocket(url);
  client.ws = ws;

  ws.on("open", async () => {
    client.bus.emit("status", "online");
    client.reconnectMs = 1000;
    const queued = await drainComments(client.id);
    for (const c of queued) {
      ws.send(
        JSON.stringify({
          type: "comment_posted",
          id: c.id,
          text: c.text,
          mentions: c.mentions ?? [],
        }),
      );
    }
  });

  ws.on("message", async (raw: unknown) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const result = relayEventSchema.safeParse(parsed);
    if (!result.success) return;
    const ev = result.data;

    if (ev.type === "cache_replay") {
      for (const e of ev.chatHistoryTail) {
        await appendChat(client.id, e);
      }
      for (const [framePath, content] of Object.entries(ev.frames)) {
        await writeFrame(client.id, framePath, content);
      }
    } else if (ev.type === "frame_written") {
      await writeFrame(client.id, ev.path, ev.content);
    } else {
      await appendChat(client.id, ev);
    }
    await touchLastSeen(client.id);
    client.bus.emit("event", ev);
  });

  ws.on("close", () => {
    client.bus.emit("status", "offline");
    client.ws = null;
    if (client.closed) return;
    setTimeout(() => {
      if (clients.has(client.id) && !client.closed) {
        openSocket(client, relayUrl).catch(() => {});
      }
    }, client.reconnectMs);
    client.reconnectMs = Math.min(client.reconnectMs * 2, 30_000);
  });

  ws.on("error", () => {
    // close handler does the reconnect work
  });
}
