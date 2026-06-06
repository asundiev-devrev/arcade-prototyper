// studio/__tests__/export/figma/componentMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findComponentMapping } from "../../../src/export/figma/componentMap";
import { COMPONENT_ENTRIES } from "../../../src/export/figma/componentEntries";
import { isMappedEntry } from "../../../src/export/figma/types";

describe("componentMap", () => {
  it("finds the ChatBubble seed (mapped, generation 0.3)", () => {
    const m = findComponentMapping("ChatBubble");
    expect(m).not.toBeNull();
    expect(m!.status).toBe("mapped");
    expect(m!.generation).toBe("0.3");
    expect(m!.figma?.setName).toBe("Bubble");
  });

  it("returns null for an unknown component", () => {
    expect(findComponentMapping("NotAThing")).toBeNull();
  });

  it("covers all 18 curated primitives", () => {
    expect(COMPONENT_ENTRIES).toHaveLength(18);
  });

  it("marks the two known no-analogue primitives ambiguous (null figma + generation)", () => {
    for (const name of ["Separator", "DevRevThemeProvider"]) {
      const m = findComponentMapping(name);
      expect(m, name).not.toBeNull();
      expect(m!.status, name).toBe("ambiguous");
      expect(m!.figma, name).toBeNull();
      expect(m!.generation, name).toBeNull();
    }
  });

  it("every entry is well-formed (status/figma/generation consistency)", () => {
    for (const e of COMPONENT_ENTRIES) {
      if (e.status === "mapped") {
        expect(e.figma, `${e.arcadeGen} mapped => figma non-null`).not.toBeNull();
        expect(["0.3", "0.2"], `${e.arcadeGen} mapped => concrete generation`).toContain(e.generation);
        expect(isMappedEntry(e)).toBe(true);
      } else {
        expect(e.figma, `${e.arcadeGen} ambiguous => figma null`).toBeNull();
        expect(e.generation, `${e.arcadeGen} ambiguous => generation null`).toBeNull();
      }
    }
  });

  it("mapped entries that declare a variant prop have a non-empty valueMap", () => {
    for (const e of COMPONENT_ENTRIES) {
      for (const v of e.variants) {
        expect(Object.keys(v.valueMap).length, `${e.arcadeGen}.${v.prop}`).toBeGreaterThan(0);
      }
    }
  });

  it("no entry maps to a rejected-prefix set name", () => {
    for (const e of COMPONENT_ENTRIES) {
      if (e.figma) {
        expect(/^\[(DLS|WIP|🔴DEPRECATED|0\.2)\]/.test(e.figma.setName), e.arcadeGen).toBe(false);
      }
    }
  });

  it("arcadeGen names are unique (no duplicate lookups)", () => {
    const names = COMPONENT_ENTRIES.map((e) => e.arcadeGen);
    expect(new Set(names).size).toBe(names.length);
  });
});
