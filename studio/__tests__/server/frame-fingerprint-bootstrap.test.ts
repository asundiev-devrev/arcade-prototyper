// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildFrameBootstrapSource } from "../../server/plugins/frameMountPlugin";

const src = buildFrameBootstrapSource({
  absFrame: "/x/index.tsx",
  absOverrides: "/x/theme.css",
  mode: "light",
  slug: "proj",
  frame: "01-frame",
});

describe("frame bootstrap fingerprint emit", () => {
  it("imports the fingerprint helpers", () => {
    expect(src).toMatch(/renderFingerprint/);
  });
  it("posts a frame-fingerprint message", () => {
    expect(src).toContain("arcade-studio:frame-fingerprint");
  });
  it("awaits document.fonts.ready before measuring", () => {
    expect(src).toMatch(/document\.fonts[\s\S]*ready/);
  });
  it("still posts frame-ready (unchanged)", () => {
    expect(src).toContain("arcade-studio:frame-ready");
  });
  it("computes the fingerprint over document.body", () => {
    expect(src).toMatch(/computeFingerprint\(\s*document\.body/);
  });
});
