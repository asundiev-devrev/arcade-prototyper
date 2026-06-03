import { describe, it, expect } from "vitest";
import { parseDriftResponse, DRIFT_CHECK_INSTRUCTION } from "../../../server/devrev/driftCheck";

describe("parseDriftResponse", () => {
  it("returns null for an exact NONE", () => {
    expect(parseDriftResponse("NONE")).toBeNull();
  });
  it("returns null for NONE with whitespace/case noise", () => {
    expect(parseDriftResponse("  none  ")).toBeNull();
    expect(parseDriftResponse("None.")).toBeNull();
  });
  it("returns null for empty/blank", () => {
    expect(parseDriftResponse("")).toBeNull();
    expect(parseDriftResponse("   ")).toBeNull();
  });
  it("returns the objection text for a real concern", () => {
    const obj = parseDriftResponse("Tickets don't auto-close when assigned in DevRev.");
    expect(obj).toBe("Tickets don't auto-close when assigned in DevRev.");
  });
  it("instruction defines the NONE escape hatch and tells the agent to flag drift", () => {
    expect(DRIFT_CHECK_INSTRUCTION).toMatch(/NONE/);
    // Biases toward catching real contradictions rather than defaulting silent.
    expect(DRIFT_CHECK_INSTRUCTION.toLowerCase()).toContain("flag");
    expect(DRIFT_CHECK_INSTRUCTION.toLowerCase()).toContain("contradict");
  });
});
