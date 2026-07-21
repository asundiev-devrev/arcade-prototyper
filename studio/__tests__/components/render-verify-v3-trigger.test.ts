import { describe, it, expect } from "vitest";
import { shouldRunRenderVerify } from "../../src/hooks/renderVerifyGate";

describe("shouldRunRenderVerify", () => {
  const base = { phase: "done" as const, isEditTurn: true, summaryClaimsChange: true, alreadyRan: false };
  it("runs on edit-turn + done + claim + not-yet-run", () => {
    expect(shouldRunRenderVerify(base)).toBe(true);
  });
  it("skips non-done", () => {
    expect(shouldRunRenderVerify({ ...base, phase: "error" })).toBe(false);
  });
  it("skips non-edit (first-gen/build)", () => {
    expect(shouldRunRenderVerify({ ...base, isEditTurn: false })).toBe(false);
  });
  it("skips when the summary claimed no change", () => {
    expect(shouldRunRenderVerify({ ...base, summaryClaimsChange: false })).toBe(false);
  });
  it("skips when already run this turn", () => {
    expect(shouldRunRenderVerify({ ...base, alreadyRan: true })).toBe(false);
  });
});
