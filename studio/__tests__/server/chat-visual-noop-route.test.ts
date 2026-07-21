// @vitest-environment node
import { describe, it, expect } from "vitest";
import { markVisualNoOpRetryRan, visualNoOpRetryAlreadyRan } from "../../server/visualNoOpRetry";

describe("visual-noop one-shot guard (keyed on user-turn lineage)", () => {
  it("reports not-run for a fresh turn id, run after marking", () => {
    expect(visualNoOpRetryAlreadyRan("turn-abc")).toBe(false);
    markVisualNoOpRetryRan("turn-abc");
    expect(visualNoOpRetryAlreadyRan("turn-abc")).toBe(true);
  });
  it("is per-turn: a different turn id is independent", () => {
    markVisualNoOpRetryRan("turn-1");
    expect(visualNoOpRetryAlreadyRan("turn-2")).toBe(false);
  });
});
