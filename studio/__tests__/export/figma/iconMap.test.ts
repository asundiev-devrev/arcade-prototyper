// studio/__tests__/export/figma/iconMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findIconMapping } from "../../../src/export/figma/iconMap";
import { ICON_ENTRIES } from "../../../src/export/figma/iconEntries";

describe("iconMap", () => {
  it("looks up a known mapped icon by arcade-gen name", () => {
    const first = ICON_ENTRIES.find((e) => e.figma);
    expect(first).toBeTruthy();
    const m = findIconMapping(first!.arcadeGen);
    expect(m?.figma?.setName).toBe(first!.figma!.setName);
  });

  it("returns the entry (with null figma) for an ambiguous icon", () => {
    const amb = ICON_ENTRIES.find((e) => e.figma === null);
    expect(amb).toBeTruthy();
    const m = findIconMapping(amb!.arcadeGen);
    expect(m).not.toBeNull();
    expect(m!.figma).toBeNull();
  });

  it("returns null for an unknown icon", () => {
    expect(findIconMapping("NotAnIcon")).toBeNull();
  });

  it("every entry is well-formed", () => {
    for (const e of ICON_ENTRIES) {
      expect(typeof e.arcadeGen).toBe("string");
      expect(e.arcadeGen.length).toBeGreaterThan(0);
      if (e.figma) {
        expect(typeof e.figma.componentSetKey).toBe("string");
        expect(e.figma.setName.startsWith("Icons/")).toBe(true);
      }
    }
  });

  it("arcadeGen names are unique", () => {
    const names = ICON_ENTRIES.map((e) => e.arcadeGen);
    expect(new Set(names).size).toBe(names.length);
  });
});
