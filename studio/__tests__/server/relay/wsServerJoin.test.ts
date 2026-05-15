// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import {
  attachRelayToHttpServer,
  __resetWsServerForTests,
} from "../../../server/relay/wsServer";
import {
  __resetProjectRegistryForTests,
  createOrGetProject,
  addCollaborator,
} from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "don:.../devu/1", displayName: "Andrey" };
    if (pat === "guest-pat") return { id: "don:.../devu/2", displayName: "Bea" };
    if (pat === "stranger-pat") return { id: "don:.../devu/999", displayName: "Stranger" };
    return null;
  },
}));

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let server: Server;
let port: number;

beforeEach(async () => {
  __resetWsServerForTests();
  __resetProjectRegistryForTests();
  server = createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function open(qs: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/multiplayer/ws?${qs}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("close", (code) => reject(new Error(`closed ${code}`)));
  });
  return ws;
}

describe("wsServer with project registry", () => {
  it("rejects a stranger devu with HTTP 403 (not host, not in shared_with)", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    let status = 0;
    let errored = false;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${project.id}&pat=stranger-pat&asRole=guest`,
    );
    await new Promise<void>((r) => {
      ws.on("unexpected-response", (_req, res) => {
        status = res.statusCode ?? 0;
        r();
      });
      ws.on("error", () => {
        errored = true;
        r();
      });
      setTimeout(r, 1500);
    });
    expect(status === 403 || errored).toBe(true);
    if (status !== 0) expect(status).toBe(403);
  });

  it("emits presence_state and cache_replay to the host on join", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    // Capture every message from the moment the socket exists — registering
    // the listener AFTER `open` resolves can race past the join events that
    // the relay sends synchronously inside handleUpgrade.
    const got: any[] = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?projectShareId=${project.id}&pat=host-pat&asRole=host`,
    );
    ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    const types = got.map((g) => g.type);
    expect(types).toContain("presence_state");
    expect(types).toContain("cache_replay");
  });

  it("guest in shared_with can connect", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, {
      devu: "don:.../devu/2",
      displayName: "Bea",
      addedBy: "don:.../devu/1",
    });
    const ws = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
