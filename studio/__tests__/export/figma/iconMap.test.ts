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

  it("returns the entry (not null) for an ambiguous icon, if one exists", () => {
    // Every icon resolved as of 2026-08-12, so there may be no ambiguous entry
    // to exercise. Assert the lookup still SURFACES such an entry rather than
    // swallowing it — the executor needs the entry to pick its fallback frame.
    const amb = ICON_ENTRIES.find((e) => e.figma === null);
    if (!amb) return;
    const m = findIconMapping(amb.arcadeGen);
    expect(m).not.toBeNull();
    expect(m!.figma).toBeNull();
  });

  it("no icon is left unmapped", () => {
    // A regression guard on the 2026-08-12 re-sourcing: all 14 icons resolved to
    // a published set. A new entry landing with figma: null should be a
    // deliberate, noticed decision, not a silent gap.
    const unmapped = ICON_ENTRIES.filter((e) => e.figma === null).map((e) => e.arcadeGen);
    expect(unmapped, `unmapped icons degrade to a blank frame on export: ${unmapped.join(", ")}`).toEqual([]);
  });

  it("returns null for an unknown icon", () => {
    expect(findIconMapping("NotAnIcon")).toBeNull();
  });

  it("every entry is well-formed", () => {
    for (const e of ICON_ENTRIES) {
      expect(typeof e.arcadeGen).toBe("string");
      expect(e.arcadeGen.length).toBeGreaterThan(0);
      if (e.figma) {
        // A 40-hex published set key.
        expect(e.figma.componentSetKey).toMatch(/^[0-9a-f]{40}$/);
        // setName must be the set's REAL published name, because getLocalSet()
        // falls back to an exact node-name match. The old assertion required an
        // "Icons/" prefix — a page label the sets don't actually carry, which
        // made every fallback lookup miss. Guard the inverse now.
        expect(e.figma.setName.startsWith("Icons/"), e.arcadeGen).toBe(false);
        expect(e.figma.setName.length).toBeGreaterThan(0);
        // Never point at a rejected-generation twin.
        expect(/^\[(DLS|WIP|🔴DEPRECATED|0\.2)\]/.test(e.figma.setName), e.arcadeGen).toBe(false);
      }
    }
  });

  it("arcadeGen names are unique", () => {
    const names = ICON_ENTRIES.map((e) => e.arcadeGen);
    expect(new Set(names).size).toBe(names.length);
  });
});
