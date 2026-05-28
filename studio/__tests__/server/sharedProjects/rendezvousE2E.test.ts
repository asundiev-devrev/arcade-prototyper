import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWS extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
      setImmediate(() => this.emit("open"));
    }
    send() {}
    close() {
      this.emit("close");
    }
  }
  return { WebSocket: FakeWS };
});

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

vi.mock("../../../server/sharedProjects/commentQueue", () => ({
  drainComments: async () => [],
  enqueueComment: async () => {},
}));

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "guest-pat",
}));

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: vi.fn().mockResolvedValue(null),
}));

const { getShareKeyMock, readMirrorMock } = vi.hoisted(() => ({
  getShareKeyMock: vi.fn(),
  readMirrorMock: vi.fn(),
}));

vi.mock("../../../server/secrets/shareKey", () => ({
  getShareKey: getShareKeyMock,
}));

vi.mock("../../../server/sharedProjects/cache", async () => {
  const actual = await vi.importActual<
    typeof import("../../../server/sharedProjects/cache")
  >("../../../server/sharedProjects/cache");
  return {
    ...actual,
    readMirror: readMirrorMock,
    appendChat: async () => {},
    writeFrame: async () => {},
    touchLastSeen: async () => {},
  };
});

import {
  acquireTunnel,
  __resetTunnelForTests,
  __resetTunnelRefsForTests,
  __setTunnelUrlForTests,
} from "../../../server/relay/tunnel";
import {
  createOrGetProject,
  addCollaborator,
  __resetProjectRegistryForTests,
} from "../../../server/relay/projectRegistry";
import {
  connectMirror,
  disconnectMirror,
  __test__ as rcTest,
} from "../../../server/sharedProjects/relayClient";

const HOST_DEVU = "don:identity:dvrv-us-1:devo/0:devu/1";
const STALE = "wss://stale.trycloudflare.com/api/multiplayer/ws";
const FRESH = "https://fresh.trycloudflare.com";
const FRESH_WSS = "wss://fresh.trycloudflare.com/api/multiplayer/ws";

async function flush(ms = 50) {
  for (let i = 0; i < ms; i++) {
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("rendezvous end-to-end", () => {
  beforeEach(() => {
    __resetTunnelForTests();
    __resetTunnelRefsForTests();
    __resetProjectRegistryForTests();
    getShareKeyMock.mockReset();
    readMirrorMock.mockReset();
  });

  it("guest WS uses fresh URL even when stored mirror points at stale URL", async () => {
    getShareKeyMock.mockResolvedValue("k");
    // Pre-populate the tunnel URL so acquireTunnel skips cloudflared spawn.
    __setTunnelUrlForTests(FRESH);

    const project = await createOrGetProject({
      hostDevu: HOST_DEVU,
      projectSlug: "p",
    });
    await addCollaborator(project.id, {
      devu: "don:identity:dvrv-us-1:devo/0:devu/2",
      displayName: "g",
      addedBy: HOST_DEVU,
    });

    readMirrorMock.mockResolvedValue({
      id: project.id,
      relayUrl: STALE,
      hostDevu: HOST_DEVU,
      hostDisplayName: "Gil",
      projectSlug: "p",
      addedAt: "now",
      lastSeenAt: "now",
    });

    // Fake Worker: POST /rendezvous publishes; GET /rendezvous returns it.
    const kv = new Map<string, any>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: any, init?: any) => {
        const url = String(input);
        if (url.endsWith(`/rendezvous/${project.id}`)) {
          if (init?.method === "POST") {
            kv.set(project.id, JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
          }
          const v = kv.get(project.id);
          if (!v) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({ shareId: project.id, ...v, publishedAt: 1 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

    // Host: publish via acquireTunnel.
    await acquireTunnel(project.id);
    await flush();
    expect(kv.get(project.id)?.relayUrl).toBe(FRESH_WSS);

    // Guest: connect — should use FRESH_WSS via rendezvous, not STALE.
    await connectMirror(project.id);
    await flush(20);
    expect(rcTest.lastUrl()).toContain(FRESH_WSS);
    expect(rcTest.lastUrl()).not.toContain("stale");
    await disconnectMirror(project.id);
    fetchSpy.mockRestore();
  });
});
