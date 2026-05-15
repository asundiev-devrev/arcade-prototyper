import { describe, it, expect } from "vitest";
import {
  clientCommandSchema,
  relayEventSchema,
  projectStateSchema,
} from "../../../server/relay/types";

describe("clientCommandSchema (Plan 2b)", () => {
  it("accepts a join command with projectShareId and asRole", () => {
    const result = clientCommandSchema.safeParse({
      type: "join",
      projectShareId: "550e8400-e29b-41d4-a716-446655440000",
      asRole: "guest",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a join command missing asRole", () => {
    const result = clientCommandSchema.safeParse({
      type: "join",
      projectShareId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a comment_posted command with mentions", () => {
    const result = clientCommandSchema.safeParse({
      type: "comment_posted",
      id: "comment-1",
      text: "Looks great!",
      mentions: ["don:identity:dvrv-us-1:devo/0:devu/123"],
    });
    expect(result.success).toBe(true);
  });
});

describe("relayEventSchema (Plan 2b)", () => {
  it("accepts a presence_state event with host and guests", () => {
    const result = relayEventSchema.safeParse({
      type: "presence_state",
      host: { devu: "don:.../devu/1", displayName: "Andrey" },
      guests: [
        { devu: "don:.../devu/2", displayName: "Bea" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a presence_state event with null host (offline)", () => {
    const result = relayEventSchema.safeParse({
      type: "presence_state",
      host: null,
      guests: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a cache_replay event", () => {
    const result = relayEventSchema.safeParse({
      type: "cache_replay",
      chatHistoryTail: [{ kind: "prompt_started", turnId: "t1", byDevu: "x", text: "hi" }],
      frames: { "frame-01": "<jsx>" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a comment_posted broadcast event", () => {
    const result = relayEventSchema.safeParse({
      type: "comment_posted",
      id: "c-1",
      byDevu: "don:.../devu/2",
      displayName: "Bea",
      text: "looks good",
      mentions: [],
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
  });
});

describe("projectStateSchema", () => {
  it("validates a minimal project record", () => {
    const result = projectStateSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      hostDevu: "don:.../devu/1",
      projectSlug: "my-project",
      createdAt: "2026-05-15T13:00:00Z",
      shared_with: [],
    });
    expect(result.success).toBe(true);
  });
});
