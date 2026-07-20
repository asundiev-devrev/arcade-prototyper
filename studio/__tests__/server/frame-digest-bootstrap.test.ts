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

describe("frame bootstrap digest emit", () => {
  it("imports digestElements", () => {
    expect(src).toMatch(/digestElements/);
  });
  it("posts a frame-digest message", () => {
    expect(src).toContain("arcade-studio:frame-digest");
  });
  it("computes the digest over document.body", () => {
    expect(src).toMatch(/digestElements\(\s*document\.body/);
  });
  it("still posts frame-fingerprint (unchanged)", () => {
    expect(src).toContain("arcade-studio:frame-fingerprint");
  });
});
