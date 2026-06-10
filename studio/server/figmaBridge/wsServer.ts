// studio/server/figmaBridge/wsServer.ts
import { WebSocketServer, type WebSocket } from "ws";

export interface BridgeServer {
  port: number | null;
  isConnected(): boolean;
  runCode(code: string, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

const PORT_START = 9223;
const PORT_END = 9232;

async function listenOnFreePort(): Promise<{ wss: WebSocketServer; port: number } | null> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    const result = await new Promise<WebSocketServer | null>((resolve) => {
      // Bind to "localhost" (not the IPv4 literal). The Figma Bridge plugin connects to
      // ws://localhost:<port>, which resolves to ::1 (IPv6) first on macOS. Forcing
      // host:"127.0.0.1" binds a *separate* IPv4 socket whose port can succeed even when
      // the IPv6 loopback is already taken by another MCP server — the plugin then reaches
      // that other server, never us. Binding to "localhost" makes the port probe fail with
      // EADDRINUSE when the loopback the client actually uses is occupied, so the scan
      // advances to a port that is genuinely free on the stack the client resolves to.
      const wss = new WebSocketServer({ host: "localhost", port });
      wss.once("listening", () => resolve(wss));
      wss.once("error", () => resolve(null));
    });
    if (result) return { wss: result, port };
  }
  return null;
}

export async function startBridgeServer(opts?: { hello?: Record<string, unknown> }): Promise<BridgeServer> {
  const bound = await listenOnFreePort();
  const wss = bound?.wss ?? null;
  const port = bound?.port ?? null;

  let client: WebSocket | null = null;
  let nextId = 1;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  wss?.on("connection", (ws) => {
    client = ws;
    try { ws.send(JSON.stringify({ type: "SERVER_HELLO", data: opts?.hello ?? { serverVersion: "studio" } })); } catch {}
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg.id !== "string") return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if ("error" in msg) entry.reject(new Error(String(msg.error)));
      else entry.resolve(msg.result);
    });
    ws.on("close", () => { if (client === ws) client = null; });
  });

  return {
    port,
    isConnected: () => client !== null && client.readyState === 1,
    runCode(code, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (!client || client.readyState !== 1) { reject(new Error("no_bridge: no Figma plugin connected")); return; }
        const id = String(nextId++);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout: Figma plugin did not reply")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        client.send(JSON.stringify({ id, method: "EXECUTE_CODE", params: { code, timeout: timeoutMs } }));
      });
    },
    async close() {
      for (const [, e] of pending) { clearTimeout(e.timer); e.reject(new Error("no_bridge: server closing")); }
      pending.clear();
      await new Promise<void>((r) => { if (!wss) return r(); wss.close(() => r()); });
    },
  };
}
