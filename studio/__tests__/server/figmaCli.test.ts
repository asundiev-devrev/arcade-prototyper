import { describe, it, expect } from "vitest";
import { parseFigmaUrl } from "../../server/figmaCli";

describe("parseFigmaUrl", () => {
  it("extracts file id and node id from a Figma URL", () => {
    const r = parseFigmaUrl("https://www.figma.com/design/AbC123/My-file?node-id=1038-14518");
    expect(r).toEqual({ fileId: "AbC123", nodeId: "1038:14518" });
  });
  it("returns null for non-Figma url", () => {
    expect(parseFigmaUrl("https://example.com/x")).toBeNull();
  });
});
