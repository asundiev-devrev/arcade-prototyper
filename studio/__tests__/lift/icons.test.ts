// studio/__tests__/lift/icons.test.ts
//
// Guards for the icon classifier. The classifier is load-bearing for the
// conventions architecture: if `Link` ever starts returning true, the
// mapping table for the Link COMPONENT is dead-coded; if real icons ever
// return false, they leak into the unmapped list and drive the
// decision-point metric the wrong way.

import { describe, it, expect } from "vitest";
import { isIcon } from "../../src/lift/icons";

describe("isIcon", () => {
  it("detects suffix-pattern icons (*Small, *Medium, *Large, *Icon)", () => {
    expect(isIcon("PlusSmall")).toBe(true);
    expect(isIcon("ChevronRightSmall")).toBe(true);
    expect(isIcon("ArrowUpMedium")).toBe(true);
    expect(isIcon("CheckLarge")).toBe(true);
    expect(isIcon("SettingsIcon")).toBe(true);
  });

  it("detects plain-noun icons from the allowlist", () => {
    expect(isIcon("Bell")).toBe(true);
    expect(isIcon("TrashBin")).toBe(true);
    expect(isIcon("MagnifyingGlass")).toBe(true);
    expect(isIcon("HumanSilhouette")).toBe(true);
    expect(isIcon("LightingBolt")).toBe(true); // arcade-gen's spelling
  });

  it("treats `Link` as a component, not an icon", () => {
    // `Link` is in the mapping table as a component target; if isIcon
    // returned true, the component mapping would be dead code and real
    // Link imports would be absorbed by the icon convention incorrectly.
    expect(isIcon("Link")).toBe(false);
  });

  it("returns false for actual components", () => {
    expect(isIcon("Button")).toBe(false);
    expect(isIcon("IconButton")).toBe(false); // ends in "Button", not an icon
    expect(isIcon("Input")).toBe(false);
    expect(isIcon("Tabs")).toBe(false);
    expect(isIcon("Modal")).toBe(false);
  });

  it("returns false for made-up names that don't match any pattern", () => {
    expect(isIcon("TotallyMadeUp")).toBe(false);
    expect(isIcon("Widget")).toBe(false);
  });
});
