import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeWS extends EventEmitter {
  static OPEN = 1;
  readyState = FakeWS.OPEN;
  sent: string[] = [];
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.emit("close");
  }
}

let lastWS: FakeWS | null = null;

vi.mock("ws", () => {
  return {
    WebSocket: class extends FakeWS {
      constructor(_url: string) {
        super();
        lastWS = this;
        setImmediate(() => this.emit("open"));
      }
    },
  };
});

const cacheCalls: any[] = [];
vi.mock("../../../server/sharedProjects/cache", () => ({
  appendChat: async (...args: any[]) => cacheCalls.push(["appendChat", ...args]),
  writeFrame: async (...args: any[]) => cacheCalls.push(["writeFrame", ...args]),
  readMirror: async (id: string) => ({
    id,
    relayUrl: "wss://x.trycloudflare.com/api/multiplayer/ws",
    hostDevu: "h",
    hostDisplayName: "A",
    projectSlug: "p",
    addedAt: "x",
    lastSeenAt: "x",
  }),
  touchLastSeen: async () => {},
}));

const queueCalls: any[] = [];
vi.mock("../../../server/sharedProjects/commentQueue", () => ({
  drainComments: async () =>
    queueCalls.length === 0 ? [{ id: "c1", text: "hi" }] : [],
  enqueueComment: async (...args: any[]) => queueCalls.push(args),
}));

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "guest-pat",
}));

beforeEach(() => {
  cacheCalls.length = 0;
  queueCalls.length = 0;
  lastWS = null;
  vi.resetModules();
});

describe("relayClient", () => {
  it("connect: opens WS to the relay URL with projectShareId + asRole=guest + pat", async () => {
    const { connectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror("abc");
    expect(lastWS).not.toBeNull();
  });

  it("on cache_replay: writes chatHistoryTail and frames into the local mirror", async () => {
    const { connectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror("abc");
    const ev = {
      type: "cache_replay",
      chatHistoryTail: [{ kind: "prompt_started" }],
      frames: { "frame-01": "<jsx>" },
    };
    lastWS!.emit("message", JSON.stringify(ev));
    await new Promise((r) => setImmediate(r));
    expect(cacheCalls).toContainEqual([
      "appendChat",
      "abc",
      { kind: "prompt_started" },
    ]);
    expect(cacheCalls).toContainEqual([
      "writeFrame",
      "abc",
      "frame-01",
      "<jsx>",
    ]);
  });

  it("on open: drains the offline comment queue and sends each over the WS", async () => {
    const { connectMirror } = await import(
      "../../../server/sharedProjects/relayClient"
    );
    await connectMirror("abc");
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.sent.some((s) => s.includes("comment_posted"))).toBe(true);
  });
});
