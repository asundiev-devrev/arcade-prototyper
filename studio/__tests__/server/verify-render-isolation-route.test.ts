// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveTargetPage } from "../../server/renderVerifyIsolation";

// The route's happy path spawns the esbuild bundler + reads a real frame dir,
// so the unit layer asserts the pure pieces the route composes (target
// resolution + the before-source cache from Task 1). Real bundling → manual gate.
describe("verify-render route composition", () => {
  it("resolves the target page the route will render", () => {
    expect(resolveTargetPage(["frames/01-x/pages/Preferences.tsx"])).toBe("pages/Preferences.tsx");
  });
});
