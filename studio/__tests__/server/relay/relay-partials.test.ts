import { describe, it, expect } from "vitest";
import { mapStudioEventToRelayEvent } from "../../../server/middleware/chat";
import { createReplayBuffer } from "../../../server/relay/replayBuffer";
import type { StudioEvent } from "../../../src/lib/streamJson";

/**
 * The relay forwarding contract for live-cursor (0.24.x) is: the chat
 * middleware wraps every StudioEvent kind it knows about as a generic
 * `agent_event` carrying the original event verbatim. Spectators replay
 * `agent_event.event` straight into their own reducer, so adding a new
 * StudioEvent kind upstream auto-propagates without any relay schema or
 * forwarding change.
 *
 * These tests lock in that promise for the new partial-tool-input events
 * (tool_call_started / tool_input_partial / tool_input_complete) and
 * include a regression test for the pre-d4f0bee bug where `agent_cursor`
 * fell through the switch's default branch and was silently dropped.
 */
describe("relay forwarding — partial events", () => {
  it("wraps tool_call_started as agent_event verbatim", () => {
    const ev: StudioEvent = {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing index.tsx",
    };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toEqual({
      type: "agent_event",
      turnId: "turn_42",
      event: ev,
    });
  });

  it("wraps tool_input_partial as agent_event verbatim", () => {
    const ev: StudioEvent = {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import React",
    };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toEqual({
      type: "agent_event",
      turnId: "turn_42",
      event: ev,
    });
  });

  it("wraps tool_input_complete as agent_event verbatim", () => {
    const ev: StudioEvent = {
      kind: "tool_input_complete",
      toolUseId: "toolu_X",
    };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toEqual({
      type: "agent_event",
      turnId: "turn_42",
      event: ev,
    });
  });

  it("wraps agent_cursor as agent_event (regression for pre-d4f0bee silent-drop)", () => {
    const ev: StudioEvent = {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/x/frames/hero/index.tsx",
    };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toEqual({
      type: "agent_event",
      turnId: "turn_42",
      event: ev,
    });
  });

  it("returns null for end events (handled by turn_ended wrapper, not double-emitted)", () => {
    const ev: StudioEvent = { kind: "end", ok: true };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toBeNull();
  });
});

describe("replay buffer — partial events", () => {
  it("recordChat stores partial event types verbatim in the chat tail", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    const events = [
      {
        type: "agent_event" as const,
        turnId: "t1",
        event: {
          kind: "tool_call_started",
          toolUseId: "X",
          tool: "Write",
          pretty: "Writing",
        },
      },
      {
        type: "agent_event" as const,
        turnId: "t1",
        event: {
          kind: "tool_input_partial",
          toolUseId: "X",
          action: "writing",
          filePath: "/frames/h/index.tsx",
          partialContent: "import",
        },
      },
      {
        type: "agent_event" as const,
        turnId: "t1",
        event: { kind: "tool_input_complete", toolUseId: "X" },
      },
    ];
    for (const e of events) rb.recordChat(e);
    expect(rb.snapshot().chatHistoryTail).toEqual(events);
  });
});
