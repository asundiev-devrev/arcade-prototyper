import { describe, it, expect } from "vitest";
import { shouldTriggerVisualNoOpRetry } from "../../src/components/viewport/visualNoOp";

describe("shouldTriggerVisualNoOpRetry", () => {
  const base = { candidateBuffered: true, phase: "done" as const, summaryClaimsVisual: true, alreadyTriggeredThisTurn: false };
  it("triggers on: candidate + clean end + visual claim + not-yet-triggered", () => {
    expect(shouldTriggerVisualNoOpRetry(base)).toBe(true);
  });
  it("does NOT trigger without a buffered candidate", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, candidateBuffered: false })).toBe(false);
  });
  it("does NOT trigger on a non-done phase (error/cancelled)", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, phase: "error" })).toBe(false);
    expect(shouldTriggerVisualNoOpRetry({ ...base, phase: "cancelled" })).toBe(false);
  });
  it("does NOT trigger without a visual claim", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, summaryClaimsVisual: false })).toBe(false);
  });
  it("does NOT trigger twice for the same turn", () => {
    expect(shouldTriggerVisualNoOpRetry({ ...base, alreadyTriggeredThisTurn: true })).toBe(false);
  });
});

import { firstSummaryLine } from "../../src/components/viewport/visualNoOp";

describe("firstSummaryLine", () => {
  it("strips journey (→) lines and returns the first summary line", () => {
    expect(firstSummaryLine(["→ Scanning", "→ Composing", "Made the toggles vertical.", "### Deviations", "None."])).toBe(
      "Made the toggles vertical.",
    );
  });
  it("stops at ### Deviations (never reads the deviations body)", () => {
    expect(firstSummaryLine(["Done.", "### Deviations", "- used a wrapper for layout"])).toBe("Done.");
  });
  it("returns '' when there is no summary", () => {
    expect(firstSummaryLine(["→ only journey lines"])).toBe("");
    expect(firstSummaryLine([])).toBe("");
  });
});
