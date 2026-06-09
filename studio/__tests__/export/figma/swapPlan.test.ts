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

const bubbleMapping: FigmaComponentMapping = {
  arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "BUBBLE_KEY", setName: "Bubble" },
  variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
  textNode: { strategy: "lowest-depth" }, note: "",
};
const maps2: SwapPlanMaps = {
  findComponentMapping: (n) => (n === "ChatBubble" ? bubbleMapping : n === "ComputerSidebar.Item" ? chatItem : null),
  tokenNameToVariableKey: () => null,
};

describe("planSwap — transcript region", () => {
  it("routes ChatBubbles to a single injectInstances op into the transcript container", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
      { component: "ChatBubble", box: { x: 272, y: 497, width: 317, height: 41 }, props: { variant: "sender" }, text: "Yo" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("transcript", "Container", 256, 48, 1200, 832, "root"),
      cap("flatBubbleA", "List Item", 306, 261, 352, 21, "transcript"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    const inject = ops.find((o) => o.op === "injectInstances");
    expect(inject).toBeDefined();
    if (inject && inject.op === "injectInstances") {
      expect(inject.containerNodeId).toBe("transcript");
      expect(inject.clearChildren).toBe(true);
      expect(inject.instances).toHaveLength(2);
      expect(inject.instances[0].box).toEqual({ x: 16, y: 16, width: 400, height: 409 });
      expect(inject.instances[0].variant).toEqual({ Type: "Receiver" });
      expect(inject.instances[0].text).toEqual({ characters: "Hi" });
      expect(inject.instances[1].variant).toEqual({ Type: "Sender" });
    }
  });

  it("does not emit replaceWithInstance for bubbles (they go through injection only)", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
    ];
    const nodes: CaptureNode[] = [
      cap("root", "Frame", 0, 0, 1280, 631, ""),
      cap("transcript", "Container", 256, 48, 1200, 832, "root"),
    ];
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    expect(ops.every((o) => o.op !== "replaceWithInstance")).toBe(true);
  });

  it("falls back to leaving bubbles alone when no transcript container is found", () => {
    const transcriptRegion = { x: 256, y: 48, width: 1200, height: 832 };
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: { variant: "receiver" }, text: "Hi" },
    ];
    const nodes: CaptureNode[] = [cap("root", "Frame", 0, 0, 1280, 631, "")];
    const ops = planSwap(manifest, nodes, { transcriptRegion }, maps2);
    expect(ops).toHaveLength(0);
  });
});
