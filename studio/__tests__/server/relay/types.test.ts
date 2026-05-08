import { describe, it, expect } from "vitest";
import {
  clientCommandSchema,
  relayEventSchema,
  sessionStateSchema,
} from "../../../server/relay/types";

describe("relay wire types", () => {
  it("parses a valid prompt command", () => {
    const cmd = clientCommandSchema.parse({
      type: "prompt",
      text: "make it blue",
      turnId: "abc-123",
    });
    expect(cmd.type).toBe("prompt");
  });

  it("rejects a prompt command missing turnId", () => {
    expect(() =>
      clientCommandSchema.parse({ type: "prompt", text: "hi" }),
    ).toThrow();
  });

  it("parses a cursor command with optional frameId", () => {
    const cmd = clientCommandSchema.parse({
      type: "cursor",
      x: 100,
      y: 200,
    });
    expect(cmd.type).toBe("cursor");
    const cmd2 = clientCommandSchema.parse({
      type: "cursor",
      x: 0,
      y: 0,
      frameId: "01-home",
    });
    expect(cmd2.type).toBe("cursor");
  });

  it("parses a session_state event", () => {
    const ev = relayEventSchema.parse({
      type: "session_state",
      driverDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      connections: [{ devu: "don:identity:dvrv-us-1:devo/0:devu/1", displayName: "A" }],
      sessionObject: "relay-session-abc",
    });
    expect(ev.type).toBe("session_state");
  });

  it("rejects an unknown command type", () => {
    expect(() =>
      clientCommandSchema.parse({ type: "hack_the_relay" }),
    ).toThrow();
  });

  it("sessionStateSchema captures the persisted session shape", () => {
    const state = sessionStateSchema.parse({
      id: "abc",
      sessionObject: "relay-abc",
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "my-project",
      linkedWorkId: null,
      createdAt: new Date().toISOString(),
      endedAt: null,
      invites: [
        { devu: "don:identity:dvrv-us-1:devo/0:devu/2", invitedByDevu: "don:identity:dvrv-us-1:devo/0:devu/1", invitedAt: new Date().toISOString() },
      ],
    });
    expect(state.id).toBe("abc");
  });
});
