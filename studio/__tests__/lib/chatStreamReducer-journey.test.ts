import { describe, it, expect } from "vitest";
import {
  applyStudioEvent,
  INITIAL_STREAM_STATE,
} from "../../src/hooks/chatStreamReducer";

describe("chatStreamReducer: journey events", () => {
  it("appends a journey item to items but NOT to narrations", () => {
    const next = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "journey",
      text: "Scanning the design system",
    });
    expect(next.items).toEqual([
      { kind: "journey", text: "Scanning the design system" },
    ]);
    expect(next.narrations).toEqual([]);
  });

  it("interleaves journey, tool_call, and narration in items in stream order", () => {
    let s = INITIAL_STREAM_STATE;
    s = applyStudioEvent(s, { kind: "journey", text: "Scanning the design system" });
    s = applyStudioEvent(s, {
      kind: "tool_call",
      tool: "Read",
      pretty: "Reading index.tsx",
    });
    s = applyStudioEvent(s, { kind: "journey", text: "Reading the navigation pattern" });
    s = applyStudioEvent(s, { kind: "narration", text: "Built the navigation." });
    expect(s.items.map((i) => i.kind)).toEqual(["journey", "tool", "journey", "narration"]);
    expect(s.narrations).toEqual(["Built the navigation."]);
  });

  it("does not seed an agentCursor 'thinking' state from a journey event", () => {
    // Regression check: only `narration` and `agent_cursor` should hydrate
    // the cursor. Journey lines are a separate ephemeral channel.
    const next = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "journey",
      text: "Sketching the page body",
    });
    expect(next.agentCursor).toBeNull();
  });

  it("end event does not affect persisted journey items in the live state", () => {
    // The reducer doesn't drop items on end (the chat pane re-renders from
    // history at that point). Journey items just stop arriving. This test
    // pins that contract so a future change can't accidentally clear items
    // mid-turn.
    let s = INITIAL_STREAM_STATE;
    s = applyStudioEvent(s, { kind: "journey", text: "Scanning" });
    s = applyStudioEvent(s, { kind: "end", ok: true });
    expect(s.items).toEqual([{ kind: "journey", text: "Scanning" }]);
  });
});
