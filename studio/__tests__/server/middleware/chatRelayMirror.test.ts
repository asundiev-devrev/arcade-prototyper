import { describe, it, expect, vi, beforeEach } from "vitest";

const broadcasted: any[] = [];
const recorded: any[] = [];

vi.mock("../../../server/relay/projectRegistry", () => ({
  getProjectByHostSlug: () => ({ id: "project-id", hostDevu: "h", projectSlug: "s", createdAt: "x", shared_with: [] }),
}));

vi.mock("../../../server/relay/wsServer", () => ({
  broadcastToProject: (id: string, ev: any) => broadcasted.push({ id, ev }),
  getReplayBufferForProject: () => ({
    recordChat: (e: any) => recorded.push({ kind: "chat", e }),
    recordFrame: (p: string, c: string) => recorded.push({ kind: "frame", p, c }),
    deleteFrame: (p: string) => recorded.push({ kind: "frame_delete", p }),
    snapshot: () => ({ chatHistoryTail: [], frames: {} }),
    reset: () => {},
  }),
}));

beforeEach(() => {
  broadcasted.length = 0;
  recorded.length = 0;
});

describe("chat relay mirror", () => {
  it("broadcastChatEvent fans an event to the project's connections", async () => {
    const { broadcastChatEvent } = await import(
      "../../../server/middleware/chatRelayMirror"
    );
    broadcastChatEvent({ hostDevu: "h", projectSlug: "s" }, {
      type: "prompt_started",
      turnId: "t1",
      byDevu: "h",
      text: "hi",
    });
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0].ev.type).toBe("prompt_started");
  });

  it("recordChatEventForReplay records frame events into the replay buffer AND broadcasts", async () => {
    const { recordChatEventForReplay } = await import(
      "../../../server/middleware/chatRelayMirror"
    );
    recordChatEventForReplay({ hostDevu: "h", projectSlug: "s" }, {
      type: "frame_written",
      path: "frame-01",
      content: "<jsx>",
      turnId: "t1",
    });
    // Frame goes to recordFrame on the buffer + broadcast.
    expect(recorded).toContainEqual({ kind: "frame", p: "frame-01", c: "<jsx>" });
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0].ev.type).toBe("frame_written");
  });

  it("recordChatEventForReplay records non-frame events as chat in the replay buffer", async () => {
    const { recordChatEventForReplay } = await import(
      "../../../server/middleware/chatRelayMirror"
    );
    recordChatEventForReplay({ hostDevu: "h", projectSlug: "s" }, {
      type: "prompt_started",
      turnId: "t1",
      byDevu: "h",
      text: "hi",
    });
    // Chat events go to recordChat.
    expect(recorded.some((r) => r.kind === "chat")).toBe(true);
  });
});
