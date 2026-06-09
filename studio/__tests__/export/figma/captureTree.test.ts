// studio/__tests__/export/figma/captureTree.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readCaptureTree, type CaptureBridge, type RawCaptureNode } from "../../../src/export/figma/captureTree";

// Fake raw tree as the Bridge would return it (absolute coords).
const raw: RawCaptureNode = {
  id: "1:0", name: "Frame", type: "FRAME", absX: 100, absY: 200, width: 1280, height: 631,
  children: [
    { id: "1:1", name: "Root", type: "FRAME", absX: 100, absY: 200, width: 256, height: 631, children: [
      { id: "1:2", name: "FrameLink", type: "FRAME", absX: 112, absY: 258, width: 113, height: 28, children: [] },
    ] },
  ],
};

const fakeBridge: CaptureBridge = { async getSubtree() { return raw; } };

describe("readCaptureTree", () => {
  it("flattens to frame-relative boxes with parent ids", async () => {
    const nodes = await readCaptureTree(fakeBridge, "1:0");
    const link = nodes.find((n) => n.name === "FrameLink")!;
    expect(link.x).toBe(12);   // 112 - 100
    expect(link.y).toBe(58);   // 258 - 200
    expect(link.width).toBe(113);
    expect(link.parentId).toBe("1:1");
    // root frame itself is included at (0,0)
    const rootFrame = nodes.find((n) => n.id === "1:0")!;
    expect(rootFrame.x).toBe(0);
    expect(rootFrame.parentId).toBeNull();
  });
});
