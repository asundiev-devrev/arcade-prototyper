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
  getReplayBufferForProject,
} from "../../../server/relay/wsServer";
import {
  createOrGetProject,
  addCollaborator,
  __resetProjectRegistryForTests,
} from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "pat-a") return { id: "devu/A", displayName: "Alice" };
    if (pat === "pat-b") return { id: "devu/B", displayName: "Bob" };
    return null;
  },
}));

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let tmp: string;
let server: http.Server;
let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-relay-ws-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetProjectRegistryForTests();
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

function connect(
  pat: string,
  projectShareId: string,
  asRole: "host" | "guest" = "host",
): Promise<ConnectedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${projectShareId}&asRole=${asRole}`,
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
  it("authenticates the PAT and allows the host to join + receive presence_state", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });

    const ws = await connect("pat-a", p.id, "host");
    const presence = await receiveUntil(ws, (m) => m.type === "presence_state");
    expect(presence.host).toEqual({ devu: "devu/A", displayName: "Alice" });
    ws.ws.close();
  });

  it("rejects a connection with an invalid PAT at the WebSocket handshake", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${p.id}&asRole=guest`,
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

  it("rejects a devu not in the allowlist with HTTP 403", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    // devu/B is not added as a collaborator → not allowed.

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${p.id}&asRole=guest`,
      { headers: { Authorization: "pat-b" } },
    );
    const status = await new Promise<number>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => reject(new Error("should not have opened")));
      ws.on("error", () => {});
      setTimeout(() => reject(new Error("timed out")), 2000);
    });
    expect(status).toBe(403);
  });

  it("rejects asRole=host from a non-host devu with HTTP 403", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${p.id}&asRole=host`,
      { headers: { Authorization: "pat-b" } },
    );
    const status = await new Promise<number>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => reject(new Error("should not have opened")));
      ws.on("error", () => {});
      setTimeout(() => reject(new Error("timed out")), 2000);
    });
    expect(status).toBe(403);
  });

  it("fans a prompt_started event from the driver out to all connected participants", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");
    const bob = await connect("pat-b", p.id, "guest");
    await receiveUntil(bob, (m) => m.type === "presence_state");

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
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");
    const bob = await connect("pat-b", p.id, "guest");
    await receiveUntil(bob, (m) => m.type === "presence_state");

    bob.ws.send(JSON.stringify({ type: "prompt", text: "hi", turnId: "t-2" }));
    const err = await receiveUntil(bob, (m) => m.type === "error");
    expect(err.code).toBe("not_driver");

    alice.ws.close();
    bob.ws.close();
  });

  it("emits user_left when a connection drops", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");
    const bob = await connect("pat-b", p.id, "guest");
    await receiveUntil(bob, (m) => m.type === "presence_state");

    bob.ws.close();
    const left = await receiveUntil(alice, (m) => m.type === "user_left");
    expect(left.devu).toBe("devu/B");

    alice.ws.close();
  });

  it("serializes concurrent prompts — second one is rejected with turn_in_flight", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");

    alice.ws.send(JSON.stringify({ type: "prompt", text: "first", turnId: "t-1" }));
    await receiveUntil(alice, (m) => m.type === "prompt_started");

    // Fire a second prompt while the first is still open.
    alice.ws.send(JSON.stringify({ type: "prompt", text: "second", turnId: "t-2" }));
    const err = await receiveUntil(alice, (m) => m.type === "error");
    expect(err.code).toBe("turn_in_flight");

    alice.ws.close();
  });

  it("after turn_ended, a subsequent prompt is accepted", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");

    alice.ws.send(JSON.stringify({ type: "prompt", text: "a", turnId: "t-1" }));
    await receiveUntil(alice, (m) => m.type === "prompt_started");
    alice.ws.send(JSON.stringify({ type: "turn_ended", turnId: "t-1", ok: true }));
    await receiveUntil(alice, (m) => m.type === "turn_ended");

    alice.ws.send(JSON.stringify({ type: "prompt", text: "b", turnId: "t-2" }));
    const started2 = await receiveUntil(alice, (m) => m.type === "prompt_started");
    expect(started2.turnId).toBe("t-2");

    alice.ws.close();
  });

  it("accepts pat via ?pat= query when Authorization header is absent", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });

    // Connect WITHOUT the Authorization header — use ?pat=pat-a instead.
    const pending = new Promise<ConnectedWs>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${p.id}&asRole=host&pat=pat-a`,
      );
      const pendingMsgs: any[] = [];
      const listeners = new Set<(msg: any) => void>();
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (listeners.size === 0) pendingMsgs.push(msg);
        else for (const fn of listeners) fn(msg);
      });
      ws.once("open", () =>
        resolve({
          ws,
          pending: pendingMsgs,
          onMessage(cb) {
            for (const m of pendingMsgs.splice(0)) cb(m);
            listeners.add(cb);
            return () => listeners.delete(cb);
          },
        }),
      );
      ws.once("error", reject);
    });
    const alice = await pending;
    const presence = await receiveUntil(alice, (m) => m.type === "presence_state");
    expect(presence.host?.devu).toBe("devu/A");
    alice.ws.close();
  });

  it("frames recorded before any guest connects are delivered via cache_replay", async () => {
    // Regression: getReplayBufferForProject must lazy-create the live session
    // so frames written by the host before any guest WS connects are not
    // silently dropped. Previously this returned null until first connection,
    // which left late-joining guests staring at "No frames yet" even when
    // the host had generated frames.
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    // Host writes a frame BEFORE any guest connects.
    const buf = getReplayBufferForProject(p.id);
    expect(buf).not.toBeNull();
    buf!.recordFrame("frame-pre-connect", "<jsx>pre</jsx>");

    // Now a guest joins — the cache_replay must include the pre-connect frame.
    const bob = await connect("pat-b", p.id, "guest");
    const replay = await receiveUntil(bob, (m) => m.type === "cache_replay");
    expect(replay.frames["frame-pre-connect"]).toBe("<jsx>pre</jsx>");
    bob.ws.close();
  });

  it("broadcasts a comment_posted event with byDevu/displayName from the connection", async () => {
    const p = await createOrGetProject({ hostDevu: "devu/A", projectSlug: "demo" });
    await addCollaborator(p.id, { devu: "devu/B", displayName: "Bob", addedBy: "devu/A" });

    const alice = await connect("pat-a", p.id, "host");
    await receiveUntil(alice, (m) => m.type === "presence_state");
    const bob = await connect("pat-b", p.id, "guest");
    await receiveUntil(bob, (m) => m.type === "presence_state");

    bob.ws.send(JSON.stringify({ type: "comment_posted", id: "cm-1", text: "wow", mentions: [] }));
    const aliceSaw = await receiveUntil(alice, (m) => m.type === "comment_posted");
    expect(aliceSaw.byDevu).toBe("devu/B");
    expect(aliceSaw.displayName).toBe("Bob");
    expect(aliceSaw.text).toBe("wow");

    alice.ws.close();
    bob.ws.close();
  });
});
