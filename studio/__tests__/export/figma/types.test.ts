// studio/__tests__/export/figma/types.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isMappedEntry, type FigmaComponentMapping } from "../../../src/export/figma/types";

describe("figma mapping types", () => {
  it("isMappedEntry narrows mapped entries with non-null figma + generation", () => {
    const mapped: FigmaComponentMapping = {
      arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "edd2821d", setName: "Bubble" },
      variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver" } }],
      note: "unprefixed canonical",
    };
    const ambiguous: FigmaComponentMapping = {
      arcadeGen: "DevRevThemeProvider", status: "ambiguous", generation: null,
      figma: null, variants: [], note: "provider, no Figma analogue",
    };
    expect(isMappedEntry(mapped)).toBe(true);
    expect(isMappedEntry(ambiguous)).toBe(false);
  });
});
