import { describe, it, expect } from "vitest";
// Import from the standalone, electron-free module rather than electron/updater:
// importing updater.ts pulls in electron-updater, whose autoUpdater getter
// eagerly constructs MacUpdater and throws outside a packaged runtime (no app).
import { decideApply, DEFER_CAP_MS, compareVersions, shouldApplyUpdate } from "../../../electron/applyDecision";

describe("decideApply", () => {
  it("restarts immediately when no turn is active", () => {
    expect(decideApply({ turnActive: false, deferredMs: 0 })).toBe("restart");
  });
  it("waits while a turn is active and under the defer cap", () => {
    expect(decideApply({ turnActive: true, deferredMs: 0 })).toBe("wait");
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS - 1 })).toBe("wait");
  });
  it("forces apply-on-quit once a turn outlasts the defer cap", () => {
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS })).toBe("force");
    expect(decideApply({ turnActive: true, deferredMs: DEFER_CAP_MS + 1 })).toBe("force");
  });
  it("restarts when idle even if previously deferred past the cap", () => {
    expect(decideApply({ turnActive: false, deferredMs: DEFER_CAP_MS + 9999 })).toBe("restart");
  });
});

describe("compareVersions", () => {
  it("orders major.minor.patch", () => {
    expect(compareVersions("0.36.0", "0.35.1")).toBeGreaterThan(0);
    expect(compareVersions("0.35.1", "0.36.0")).toBeLessThan(0);
    expect(compareVersions("0.35.1", "0.35.1")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });
  it("treats missing/garbage segments as 0", () => {
    expect(compareVersions("0.36", "0.36.0")).toBe(0);
    expect(compareVersions("", "0.0.0")).toBe(0);
  });
});

describe("shouldApplyUpdate (loop guard)", () => {
  it("applies only a strictly newer version", () => {
    expect(shouldApplyUpdate("0.35.1", "0.36.0")).toBe(true);
    expect(shouldApplyUpdate("0.35.0", "0.35.1")).toBe(true);
  });
  it("REFUSES the same version (the restart-loop case)", () => {
    expect(shouldApplyUpdate("0.36.0", "0.36.0")).toBe(false);
  });
  it("refuses an older version (downgrade)", () => {
    expect(shouldApplyUpdate("0.36.0", "0.35.1")).toBe(false);
  });
  it("refuses on empty/garbage input", () => {
    expect(shouldApplyUpdate("0.36.0", "")).toBe(false);
    expect(shouldApplyUpdate("", "0.36.0")).toBe(false);
  });
});
