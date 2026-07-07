import { describe, it, expect } from "vitest";
import { shouldPrompt } from "../../src/lib/updateNotice";

describe("shouldPrompt", () => {
  it("no status → no prompt", () => {
    expect(shouldPrompt(null, null)).toBe(false);
  });
  it("no pending version → no prompt", () => {
    expect(shouldPrompt({ pendingVersion: null, installRequested: false }, null)).toBe(false);
  });
  it("pending version, not dismissed → prompt", () => {
    expect(shouldPrompt({ pendingVersion: "0.43.0", installRequested: false }, null)).toBe(true);
  });
  it("pending version already dismissed → no prompt", () => {
    expect(shouldPrompt({ pendingVersion: "0.43.0", installRequested: false }, "0.43.0")).toBe(false);
  });
  it("a NEWER pending version after dismissing an older one → prompt again", () => {
    expect(shouldPrompt({ pendingVersion: "0.44.0", installRequested: false }, "0.43.0")).toBe(true);
  });
});
