import { describe, it, expect } from "vitest";
import { extractFigmaUrl, decoratePromptWithFigma } from "../../src/lib/figmaUrl";

describe("figmaUrl helpers", () => {
  it("extracts a Figma URL with node id", () => {
    expect(extractFigmaUrl("Look at https://www.figma.com/design/abc/Foo?node-id=1-2"))
      .toBe("https://www.figma.com/design/abc/Foo?node-id=1-2");
  });
  it("returns null without a node id", () => {
    expect(extractFigmaUrl("https://www.figma.com/design/abc/Foo")).toBeNull();
  });
  it("decoratePromptWithFigma appends the url", () => {
    const out = decoratePromptWithFigma("Build this", "https://figma.com/design/a?node-id=1-2");
    expect(out).toContain("Figma reference:");
  });
});
