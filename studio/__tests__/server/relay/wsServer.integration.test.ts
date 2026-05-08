// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachRelayToHttpServer,
  __resetWsServerForTests,
} from "../../../server/relay/wsServer";
import {
  createSession,
  addInvite,
  __resetSessionRegistryForTests,
} from "../../../server/relay/sessionRegistry";

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "pat-a") return { id: "devu/A", displayName: "Alice" };
    if (pat === "pat-b") return { id: "devu/B", displayName: "Bob" };
    return null;
  },
}));

let tmp: string;
let server: http.Server;
let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-relay-ws-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
  __resetWsServerForTests();
  server = http.createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface ConnectedWs {
  ws: WebSocket;
  pending: any[];                 // messages that arrived before a listener was registered
  onMessage(cb: (msg: any) => void): () => void;
}

function connect(pat: string, sessionId: string): Promise<ConnectedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?sessionId=${sessionId}`,
      { headers: { Authorization: pat } },
    );
    const pending: any[] = [];
    const listeners = new Set<(msg: any) => void>();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (listeners.size === 0) pending.push(msg);
      else for (const fn of listeners) fn(msg);
    });
    ws.once("open", () =>
      resolve({
        ws,
        pending,
        onMessage(cb) {
          // Drain any buffered messages first, then subscribe.
          for (const m of pending.splice(0)) cb(m);
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      }),
    );
    ws.once("error", reject);
  });
}

function receiveUntil(c: ConnectedWs, predicate: (msg: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    let off: () => void = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new Error("timed out waiting for message"));
    }, timeoutMs);
    off = c.onMessage((msg) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        off();
        resolve(msg);
      }
    });
  });
}

describe("wsServer integration", () => {
  it("authenticates the PAT and allows an invited user to join + receive session_state", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

    const ws = await connect("pat-a", s.id);
    const state = await receiveUntil(ws, (m) => m.type === "session_state");
    expect(state.driverDevu).toBe("devu/A");
    ws.ws.close();
  });

  it("rejects a connection with an invalid PAT at the WebSocket handshake", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?sessionId=${s.id}`,
      { headers: { Authorization: "bogus" } },
    );
    // A rejected upgrade never transitions to "open", so we observe it via the
    // "unexpected-response" event — ws exposes the HTTP status it got back.
    const status = await new Promise<number>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => reject(new Error("should not have opened")));
      ws.on("error", () => {}); // swallow — unexpected-response is the real signal
      setTimeout(() => reject(new Error("timed out")), 2000);
    });
    expect(status).toBe(401);
  });

  it("fans a prompt_started event from the driver out to all connected participants", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    alice.ws.send(
      JSON.stringify({ type: "prompt", text: "hello", turnId: "t-1" }),
    );

    const aliceSaw = await receiveUntil(alice, (m) => m.type === "prompt_started");
    const bobSaw = await receiveUntil(bob, (m) => m.type === "prompt_started");
    expect(aliceSaw.text).toBe("hello");
    expect(bobSaw.byDevu).toBe("devu/A");

    alice.ws.close();
    bob.ws.close();
  });

  it("rejects a prompt from a non-driver with an error event", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    bob.ws.send(JSON.stringify({ type: "prompt", text: "hi", turnId: "t-2" }));
    const err = await receiveUntil(bob, (m) => m.type === "error");
    expect(err.code).toBe("not_driver");

    alice.ws.close();
    bob.ws.close();
  });

  it("emits user_left when a connection drops", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    bob.ws.close();
    const left = await receiveUntil(alice, (m) => m.type === "user_left");
    expect(left.devu).toBe("devu/B");

    alice.ws.close();
  });
});
