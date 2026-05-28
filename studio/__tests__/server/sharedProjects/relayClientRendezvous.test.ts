import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeWS extends EventEmitter {
  static OPEN = 1;
  readyState = FakeWS.OPEN;
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
    lastWS = this;
    setImmediate(() => this.emit("open"));
  }
  send() {}
  close() {
    this.emit("close");
  }
}

let lastWS: FakeWS | null = null;

vi.mock("ws", () => ({ WebSocket: FakeWS }));

const STORED = "wss://stale.trycloudflare.com/api/multiplayer/ws";
const FRESH = "wss://fresh.trycloudflare.com/api/multiplayer/ws";
const SHARE_ID = "2994f253-a34e-4d5c-858e-1655ff98b0be";

vi.mock("../../../server/sharedProjects/cache", () => ({
  appendChat: async () => {},
  writeFrame: async () => {},
  readMirror: async (id: string) => ({
    id,
    relayUrl: STORED,
    hostDevu: "don:identity:dvrv-us-1:devo/0:devu/2676",
    hostDisplayName: "Gil",
    projectSlug: "p",
    addedAt: "x",
    lastSeenAt: "x",
  }),
  touchLastSeen: async () => {},
}));

vi.mock("../../../server/sharedProjects/commentQueue", () => ({
  drainComments: async () => [],
  enqueueComment: async () => {},
}));

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "guest-pat",
}));

const { fetchRendezvousMock, getShareKeyMock } = vi.hoisted(() => ({
  fetchRendezvousMock: vi.fn(),
  getShareKeyMock: vi.fn(),
}));

vi.mock("../../../server/cloudflare/rendezvous", async () => {
  const actual = await vi.importActual<
    typeof import("../../../server/cloudflare/rendezvous")
  >("../../../server/cloudflare/rendezvous");
  return {
    ...actual,
    fetchRendezvous: fetchRendezvousMock,
  };
});

vi.mock("../../../server/secrets/shareKey", () => ({
  getShareKey: getShareKeyMock,
}));

beforeEach(() => {
  lastWS = null;
  fetchRendezvousMock.mockReset();
  getShareKeyMock.mockReset();
  vi.resetModules();
});

describe("connectMirror with rendezvous", () => {
  it("opens the WS using the rendezvous URL when fetch succeeds", async () => {
    getShareKeyMock.mockResolvedValue("k");
    fetchRendezvousMock.mockResolvedValue({
      shareId: SHARE_ID,
      relayUrl: FRESH,
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/2676",
      hostDisplayName: "Gil",
      publishedAt: 1,
    });
    const { connectMirror, disconnectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror(SHARE_ID);
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.url.startsWith(FRESH)).toBe(true);
    await disconnectMirror(SHARE_ID);
  });

  it("falls back to stored mirror.relayUrl on rendezvous 404", async () => {
    getShareKeyMock.mockResolvedValue("k");
    const { RendezvousNotFoundError } = await import(
      "../../../server/cloudflare/rendezvous"
    );
    fetchRendezvousMock.mockRejectedValue(new RendezvousNotFoundError(SHARE_ID));
    const { connectMirror, disconnectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror(SHARE_ID);
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.url.startsWith(STORED)).toBe(true);
    await disconnectMirror(SHARE_ID);
  });

  it("falls back to stored mirror.relayUrl on rendezvous network error", async () => {
    getShareKeyMock.mockResolvedValue("k");
    fetchRendezvousMock.mockRejectedValue(new Error("ENETDOWN"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { connectMirror, disconnectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror(SHARE_ID);
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.url.startsWith(STORED)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await disconnectMirror(SHARE_ID);
  });

  it("falls back to stored relayUrl when shareKey is null (no rendezvous probe)", async () => {
    getShareKeyMock.mockResolvedValue(null);
    const { connectMirror, disconnectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror(SHARE_ID);
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.url.startsWith(STORED)).toBe(true);
    expect(fetchRendezvousMock).not.toHaveBeenCalled();
    await disconnectMirror(SHARE_ID);
  });
});
