// studio/__tests__/server/figmaBridge/wsServer.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { startBridgeServer, type BridgeServer } from "../../../server/figmaBridge/wsServer";

let server: BridgeServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

function fakePlugin(port: number, handler: (params: any) => unknown): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (!msg.id || !msg.method) return; // ignore SERVER_HELLO
      // Use Promise.resolve().then(() => handler(...)) so a *synchronous* throw from the
      // handler is captured into the promise chain and turned into an error frame. Calling
      // handler(...) directly as an argument to Promise.resolve would throw before the
      // .catch could ever run, escaping as an uncaught exception.
      Promise.resolve()
        .then(() => handler(msg.params))
        .then((result) => ws.send(JSON.stringify({ id: msg.id, result })))
        .catch((err) => ws.send(JSON.stringify({ id: msg.id, error: String(err.message ?? err) })));
    });
    ws.on("open", () => resolve(ws));
  });
}

describe("startBridgeServer", () => {
  it("binds a port in 9223-9232 and runCode round-trips through a connected client", async () => {
    server = await startBridgeServer();
    expect(server.port).toBeGreaterThanOrEqual(9223);
    expect(server.port).toBeLessThanOrEqual(9232);
    const client = await fakePlugin(server.port!, (params) => ({ echoed: params.code.length }));
    await new Promise((r) => setTimeout(r, 50));
    expect(server.isConnected()).toBe(true);
    const result = await server.runCode("return 1+1;", 5000) as any;
    expect(result.echoed).toBe("return 1+1;".length);
    client.close();
  });

  it("rejects runCode with a typed reason when no client is connected", async () => {
    server = await startBridgeServer();
    await expect(server.runCode("x", 1000)).rejects.toThrow(/no_bridge/);
  });

  it("rejects when the client returns an error frame", async () => {
    server = await startBridgeServer();
    const client = await fakePlugin(server.port!, () => { throw new Error("boom"); });
    await new Promise((r) => setTimeout(r, 50));
    await expect(server.runCode("x", 5000)).rejects.toThrow(/boom/);
    client.close();
  });

  it("rejects on timeout when the client never replies", async () => {
    server = await startBridgeServer();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    await new Promise((r) => ws.on("open", r));
    await new Promise((r) => setTimeout(r, 50));
    await expect(server.runCode("x", 100)).rejects.toThrow(/timeout/);
    ws.close();
  });
});
