import { describe, it, expect } from "vitest";
import {
  applyStudioEvent,
  INITIAL_STREAM_STATE,
} from "../../src/hooks/chatStreamReducer";

describe("chatStreamReducer: agentCursor", () => {
  it("starts with agentCursor: null", () => {
    expect(INITIAL_STREAM_STATE.agentCursor).toBeNull();
  });

  it("agent_cursor event sets cursor state", () => {
    const next = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    expect(next.agentCursor).toMatchObject({
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    expect(typeof next.agentCursor!.updatedAt).toBe("number");
  });

  it("agent_cursor preserves narration when one already exists", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "narration",
      text: "Let me start with the home screen",
    });
    s = applyStudioEvent(s, {
      kind: "agent_cursor",
      frame: null,
      action: "reading",
      filePath: "/p/frames/home/index.tsx",
    });
    expect(s.agentCursor?.narration).toBe("Let me start with the home screen");
    expect(s.agentCursor?.action).toBe("reading");
  });

  it("narration updates bubble text without overwriting frame/action", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    s = applyStudioEvent(s, { kind: "narration", text: "Adding hero" });
    expect(s.agentCursor?.narration).toBe("Adding hero");
    expect(s.agentCursor?.action).toBe("writing");
    expect(s.agentCursor?.composites).toEqual(["Hero"]);
  });

  it("narration before any cursor event hydrates a thinking cursor", () => {
    const s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "narration",
      text: "Reading existing frames",
    });
    expect(s.agentCursor).toMatchObject({
      frame: null,
      action: "thinking",
      narration: "Reading existing frames",
    });
  });

  it("end event clears agentCursor", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
    });
    s = applyStudioEvent(s, { kind: "end", ok: true });
    expect(s.agentCursor).toBeNull();
  });
});
