// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderVerifyAlreadyRan, markRenderVerifyRan } from "../../server/renderVerify";

describe("render-verify one-shot guard (own Set, per user-turn)", () => {
  it("not-run for a fresh turn, run after marking, independent per turn", () => {
    expect(renderVerifyAlreadyRan("route-turn-a")).toBe(false);
    markRenderVerifyRan("route-turn-a");
    expect(renderVerifyAlreadyRan("route-turn-a")).toBe(true);
    expect(renderVerifyAlreadyRan("route-turn-b")).toBe(false);
  });
});
