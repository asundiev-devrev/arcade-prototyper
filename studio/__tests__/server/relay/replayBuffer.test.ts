import { describe, it, expect, beforeEach } from "vitest";
import { createReplayBuffer } from "../../../server/relay/replayBuffer";

describe("replayBuffer", () => {
  it("returns an empty snapshot when nothing has been recorded", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    expect(rb.snapshot()).toEqual({ chatHistoryTail: [], frames: {} });
  });

  it("records chat events and returns them in order, up to the limit", () => {
    const rb = createReplayBuffer({ chatTailLimit: 3 });
    rb.recordChat({ kind: "a" });
    rb.recordChat({ kind: "b" });
    rb.recordChat({ kind: "c" });
    rb.recordChat({ kind: "d" });
    expect(rb.snapshot().chatHistoryTail).toEqual([{ kind: "b" }, { kind: "c" }, { kind: "d" }]);
  });

  it("stores latest frame content per path, overwriting older versions", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    rb.recordFrame("frame-01", "v1");
    rb.recordFrame("frame-02", "x");
    rb.recordFrame("frame-01", "v2");
    expect(rb.snapshot().frames).toEqual({ "frame-01": "v2", "frame-02": "x" });
  });

  it("removes a frame from the snapshot on delete", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    rb.recordFrame("frame-01", "v1");
    rb.recordFrame("frame-02", "x");
    rb.deleteFrame("frame-01");
    expect(rb.snapshot().frames).toEqual({ "frame-02": "x" });
  });
});
