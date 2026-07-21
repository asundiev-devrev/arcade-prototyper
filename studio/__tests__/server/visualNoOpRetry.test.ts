// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  narrationClaimsVisualChange,
  shouldRunVisualNoOpRetry,
  VISUAL_NOOP_RETRY_PROMPT,
} from "../../server/visualNoOpRetry";

describe("narrationClaimsVisualChange (biased toward firing)", () => {
  it("fires on an explicit visual claim", () => {
    expect(narrationClaimsVisualChange("ToggleGroups now stack vertically — stops squeezing horizontal space")).toBe(true);
  });
  it("fires on ambiguous change language (misses safe-side toward the target bug)", () => {
    expect(narrationClaimsVisualChange("Updated the toggles")).toBe(true);
  });
  it("does NOT fire on a clearly non-visual behavior claim", () => {
    expect(narrationClaimsVisualChange("Wired the button to open the modal")).toBe(false);
  });
  it("does NOT fire on an accessibility/data claim", () => {
    expect(narrationClaimsVisualChange("Added an aria-label to the icon button")).toBe(false);
  });
  it("does NOT fire on a question or refusal", () => {
    expect(narrationClaimsVisualChange("Which timezone should be the default?")).toBe(false);
  });
});

describe("shouldRunVisualNoOpRetry", () => {
  it("runs when a visual claim is present and it hasn't run for this turn", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: false, claimsVisual: true })).toBe(true);
  });
  it("does not run twice for the same turn", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: true, claimsVisual: true })).toBe(false);
  });
  it("does not run without a visual claim", () => {
    expect(shouldRunVisualNoOpRetry({ alreadyRanForTurn: false, claimsVisual: false })).toBe(false);
  });
});

describe("VISUAL_NOOP_RETRY_PROMPT", () => {
  it("is self-classifying: tells the agent to opt out if the change was intentionally non-visual", () => {
    expect(VISUAL_NOOP_RETRY_PROMPT).toMatch(/non-visual|behavior|accessib/i);
    expect(VISUAL_NOOP_RETRY_PROMPT).toMatch(/identical|nothing visible|did not (change|alter)/i);
  });
});
