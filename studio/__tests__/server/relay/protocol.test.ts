import { describe, it, expect } from "vitest";
import {
  createLiveState,
  applyCommand,
  applyDisconnect,
} from "../../../server/relay/protocol";
import type { LiveState } from "../../../server/relay/protocol";

const HOST = "don:identity:dvrv-us-1:devo/0:devu/1";
const GUEST = "don:identity:dvrv-us-1:devo/0:devu/2";
const STRANGER = "don:identity:dvrv-us-1:devo/0:devu/99";

function withHostConnected(): LiveState {
  const s = createLiveState({
    sessionId: "sess-1",
    sessionObject: "relay-session-1",
    hostDevu: HOST,
    inviteList: [HOST, GUEST],
  });
  return applyCommand(s, {
    type: "join",
    sessionId: "sess-1",
    connDevu: HOST,
    connDisplayName: "Host",
    connId: "c1",
  }).nextState;
}

describe("protocol.applyCommand", () => {
  it("grants driver role to the host on first join", () => {
    const s = withHostConnected();
    expect(s.driverDevu).toBe(HOST);
    expect(s.connections.size).toBe(1);
  });

  it("allows an invited guest to join and emits user_joined", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    });
    expect(nextState.connections.size).toBe(2);
    expect(events.find((e) => e.event.type === "user_joined")).toBeTruthy();
    expect(nextState.driverDevu).toBe(HOST); // unchanged by guest join
  });

  it("rejects a join from a non-invited devu with error event targeted at that connection", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "join",
      sessionId: "sess-1",
      connDevu: STRANGER,
      connDisplayName: "Stranger",
      connId: "c3",
    });
    expect(nextState.connections.size).toBe(1); // stranger not added
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv).toBeTruthy();
    expect(errEv?.recipient).toBe("c3");
  });

  it("rejects a prompt from a non-driver", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "prompt",
      connDevu: GUEST,
      connId: "c2",
      text: "hi",
      turnId: "t-1",
    });
    expect(nextState.currentTurn).toBeNull();
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv).toBeTruthy();
    expect(errEv?.event.type === "error" && errEv.event.code).toBe("not_driver");
  });

  it("accepts a prompt from the driver, emits prompt_started to all connections", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "build a login",
      turnId: "t-1",
    });
    expect(nextState.currentTurn?.turnId).toBe("t-1");
    const started = events.find((e) => e.event.type === "prompt_started");
    expect(started).toBeTruthy();
    expect(started?.recipient).toBe("broadcast");
  });

  it("rejects a prompt with code turn_in_flight when a turn is already running", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;
    const { events } = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "b",
      turnId: "t-2",
    });
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv?.event.type === "error" && errEv.event.code).toBe("turn_in_flight");
  });

  it("request_control emits a control_requested event that expires in 30s", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const now = Date.now();
    const { events } = applyCommand(s, {
      type: "request_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now });
    const req = events.find((e) => e.event.type === "control_requested");
    expect(req).toBeTruthy();
    if (req?.event.type === "control_requested") {
      expect(req.event.expiresAt).toBeGreaterThan(now + 29_000);
      expect(req.event.expiresAt).toBeLessThan(now + 31_000);
    }
  });

  it("grant_control by the driver transfers the lock", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "grant_control",
      connDevu: HOST,
      connId: "c1",
      targetDevu: GUEST,
    });
    expect(nextState.driverDevu).toBe(GUEST);
    const changed = events.find((e) => e.event.type === "control_changed");
    expect(changed?.event.type === "control_changed" && changed.event.reason).toBe("granted");
  });

  it("grant_control by non-driver is rejected", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "grant_control",
      connDevu: GUEST,
      connId: "c2",
      targetDevu: GUEST,
    });
    expect(nextState.driverDevu).toBe(HOST);
    expect(events.find((e) => e.event.type === "error")).toBeTruthy();
  });

  it("claim_control only succeeds when the driver has been offline > 60s", () => {
    // Host joins, then disconnects.
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    s = applyDisconnect(s, "c1").nextState; // host drops

    // Too soon — claim should be rejected.
    const too_soon = applyCommand(s, {
      type: "claim_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now: s.driverDisconnectedAt! + 10_000 });
    expect(too_soon.nextState.driverDevu).toBe(HOST);
    expect(too_soon.events.find((e) => e.event.type === "error")).toBeTruthy();

    // After 60s — claim succeeds.
    const ok = applyCommand(s, {
      type: "claim_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now: s.driverDisconnectedAt! + 61_000 });
    expect(ok.nextState.driverDevu).toBe(GUEST);
    const changed = ok.events.find((e) => e.event.type === "control_changed");
    expect(changed?.event.type === "control_changed" && changed.event.reason).toBe("claimed");
  });

  it("release_control by the driver clears driverDevu", () => {
    const s0 = withHostConnected();
    const { nextState } = applyCommand(s0, {
      type: "release_control",
      connDevu: HOST,
      connId: "c1",
    });
    expect(nextState.driverDevu).toBeNull();
  });

  it("agent_event from driver fans out to broadcast; from non-driver is rejected", () => {
    let s = withHostConnected();
    // Start a turn first.
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;

    const ok = applyCommand(s, {
      type: "agent_event",
      connDevu: HOST,
      connId: "c1",
      turnId: "t-1",
      event: { kind: "narration", text: "working" },
    });
    const fan = ok.events.find((e) => e.event.type === "agent_event");
    expect(fan?.recipient).toBe("broadcast");

    // Add guest, then guest tries to forge an agent_event.
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const bad = applyCommand(s, {
      type: "agent_event",
      connDevu: GUEST,
      connId: "c2",
      turnId: "t-1",
      event: { kind: "narration", text: "evil" },
    });
    expect(bad.events.find((e) => e.event.type === "error")).toBeTruthy();
  });

  it("cursor events from any participant broadcast a snapshot containing all cursors", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const a = applyCommand(s, {
      type: "cursor",
      connDevu: HOST,
      connId: "c1",
      x: 10,
      y: 20,
    });
    const snap = a.events.find((e) => e.event.type === "cursors");
    expect(snap?.event.type === "cursors" && Object.keys(snap.event.cursors)).toContain(HOST);
  });

  it("turn_ended from driver clears currentTurn", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;
    const { nextState } = applyCommand(s, {
      type: "turn_ended",
      connDevu: HOST,
      connId: "c1",
      turnId: "t-1",
      ok: true,
    });
    expect(nextState.currentTurn).toBeNull();
  });
});

describe("protocol.applyDisconnect", () => {
  it("removes the connection and emits user_left", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyDisconnect(s, "c2");
    expect(nextState.connections.size).toBe(1);
    const left = events.find((e) => e.event.type === "user_left");
    expect(left).toBeTruthy();
  });

  it("records driverDisconnectedAt when the driver leaves", () => {
    const s0 = withHostConnected();
    const { nextState } = applyDisconnect(s0, "c1");
    expect(nextState.driverDisconnectedAt).toBeGreaterThan(0);
    // driver devu stays set so a returning host can reclaim without "claim".
    expect(nextState.driverDevu).toBe(HOST);
  });
});
