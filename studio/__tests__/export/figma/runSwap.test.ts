// studio/__tests__/export/figma/runSwap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { deriveTranscriptRegion } from "../../../src/export/figma/runSwap";
import type { ManifestComponent } from "../../../src/export/figma/swapOps";

describe("deriveTranscriptRegion", () => {
  it("returns the bounding box enclosing all ChatBubbles", () => {
    const manifest: ManifestComponent[] = [
      { component: "ChatBubble", box: { x: 272, y: 64, width: 400, height: 409 }, props: {}, text: "a" },
      { component: "ChatBubble", box: { x: 272, y: 497, width: 317, height: 41 }, props: {}, text: "b" },
      { component: "Button", box: { x: 12, y: 58, width: 112, height: 28 }, props: {}, text: "c" },
    ];
    const r = deriveTranscriptRegion(manifest)!;
    expect(r.x).toBe(272);
    expect(r.y).toBe(64);
    expect(r.width).toBe(400);          // max right (272+400=672) - min left (272)
    expect(r.height).toBe(474);         // max bottom (497+41=538) - min top (64)
  });

  it("returns null when there are no bubbles", () => {
    const manifest: ManifestComponent[] = [{ component: "Button", box: { x: 0, y: 0, width: 1, height: 1 }, props: {}, text: null }];
    expect(deriveTranscriptRegion(manifest)).toBeNull();
  });
});
