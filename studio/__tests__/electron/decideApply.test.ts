import { describe, it, expect } from "vitest";
// Import from the standalone, electron-free module rather than electron/updater:
// importing updater.ts pulls in electron-updater, whose autoUpdater getter
// eagerly constructs MacUpdater and throws outside a packaged runtime (no app).
import { decideApply, DEFER_CAP_MS } from "../../../electron/applyDecision";

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
