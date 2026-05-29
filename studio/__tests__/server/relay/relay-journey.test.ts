import { describe, it, expect } from "vitest";
import { mapStudioEventToRelayEvent } from "../../../server/middleware/chat";
import type { StudioEvent } from "../../../src/lib/streamJson";

describe("relay forwarding — journey events", () => {
  it("wraps journey as agent_event verbatim", () => {
    const ev: StudioEvent = {
      kind: "journey",
      text: "Scanning the design system",
    };
    expect(mapStudioEventToRelayEvent(ev, "turn_42")).toEqual({
      type: "agent_event",
      turnId: "turn_42",
      event: ev,
    });
  });
});
