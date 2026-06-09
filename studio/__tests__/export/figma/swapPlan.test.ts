// studio/__tests__/export/figma/swapPlan.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planSwap, type SwapPlanMaps } from "../../../src/export/figma/swapPlan";
import type { ManifestComponent } from "../../../src/export/figma/swapOps";
import type { CaptureNode } from "../../../src/export/figma/captureTree";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const chatItem: FigmaComponentMapping = {
  arcadeGen: "ComputerSidebar.Item", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "CHAT_ITEM_KEY", setName: "Chat Item" }, variants: [],
  textNode: { strategy: "by-name", name: "Item name#8536:0" }, note: "",
};
const maps: SwapPlanMaps = {
  findComponentMapping: (n) => (n === "ComputerSidebar.Item" ? chatItem : null),
  tokenNameToVariableKey: () => null,
};

const cap = (id: string, name: string, x: number, y: number, w: number, h: number, parentId = "root"): CaptureNode =>
  ({ id, name, type: "FRAME", x, y, width: w, height: h, parentId });

describe("planSwap — discrete region", () => {
  it("emits replaceWithInstance for a geometry-matched component with its label", () => {
    const manifest: ManifestComponent[] = [
      { component: "ComputerSidebar.Item", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "Remove council reference" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("flat1", "Button", 8, 148, 239, 36, "side"),
      cap("side", "Root", 0, 0, 256, 631, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "CHAT_ITEM_KEY",
      parentNodeId: "side", text: { propName: "Item name#8536:0", characters: "Remove council reference" },
    });
  });

  it("skips a component with no geometry match (leaves the flat frame)", () => {
    const manifest: ManifestComponent[] = [
      { component: "ComputerSidebar.Item", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "x" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, ""), cap("far", "Button", 900, 900, 239, 36, "root")];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(0);
  });

  it("skips an unmapped component", () => {
    const manifest: ManifestComponent[] = [
      { component: "Unknown", box: { x: 8, y: 148, width: 239, height: 36 }, props: {}, text: "x" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, ""), cap("flat1", "Button", 8, 148, 239, 36, "root")];
    const ops = planSwap(manifest, nodes, { transcriptRegion: null }, maps);
    expect(ops).toHaveLength(0);
  });
});
