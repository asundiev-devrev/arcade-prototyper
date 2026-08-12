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

  it("covers the curated primitives + composite sub-parts + the 2.0 additions", () => {
    expect(COMPONENT_ENTRIES).toHaveLength(25);
  });

  it("maps the arcade-gen 2.0 components to their published set keys", () => {
    const expected: Array<[string, string, string]> = [
      ["SearchInput", "Search Input", "19d5b8170133af3b1411a5be16b94621b558c816"],
      ["ChipButton", "Chip Button", "62304142aad2baf93fd56949820a5989f2715349"],
      ["FilterButton", "Filter Button", "e4341909fd0d33d86b5284326349c6f2d678a70c"],
      ["NumberField", "Input/Number field", "4c4e26eb174a90e98da63a36f351946ad43498a5"],
      ["FileAttachment", "File attachment", "a11a736d2e3ef8673c0f3b57e18301cfcd0fbd37"],
    ];
    for (const [name, setName, key] of expected) {
      const m = findComponentMapping(name);
      expect(m, name).not.toBeNull();
      expect(m!.status, name).toBe("mapped");
      expect(m!.figma?.setName, name).toBe(setName);
      expect(m!.figma?.componentSetKey, name).toBe(key);
    }
  });

  it("drives the pressed look from `Active / Pressed`, never from `State`", () => {
    // The 0.3 sets put the pressed look on its own axis; `State` only carries
    // idle/hover. An entry that pointed `active` at `State` would export a chip
    // that never looks pressed.
    for (const name of ["ChipButton", "FilterButton"]) {
      const axes = findComponentMapping(name)!.variants;
      const active = axes.find((v) => v.prop === "active");
      expect(active, `${name} should drive active`).toBeDefined();
      expect(active!.figmaProp, name).toBe("Active / Pressed");
      expect(axes.some((v) => v.figmaProp === "State"), `${name} must not drive State`).toBe(false);
    }
  });

  it("never maps FileAttachment's docType onto the Failed error state", () => {
    // `Failed` is the ninth option on the Document axis but it is a STATE, not a
    // file type. Emitting it as a docType would render no glyph at all.
    const docType = findComponentMapping("FileAttachment")!.variants.find((v) => v.prop === "docType");
    expect(docType!.figmaProp).toBe("Document");
    expect(Object.values(docType!.valueMap)).not.toContain("Failed");
  });

  it("maps ComputerSidebar.Item to the labeled 'Chat Item' row (not the wordmark 'Computer Item')", () => {
    // Probed live 2026-06-08: 0.3 'Chat Item' (ab11c00f…) is the real labeled
    // session row — Avatar + 'Item name' TEXT prop + Dot. The similarly-named
    // 'Computer Item' (d5ad9a6b…) is the animated wordmark chip with no label.
    const m = findComponentMapping("ComputerSidebar.Item");
    expect(m).not.toBeNull();
    expect(m!.status).toBe("mapped");
    expect(m!.figma?.setName).toBe("Chat Item");
    expect(m!.figma?.componentSetKey).toBe("ab11c00fafe90d430bc8dc9532da2d358012c7c9");
    expect(m!.textNode).toEqual({ strategy: "by-name", name: "Item name#8536:0" });
  });

  it("marks the known no-analogue components ambiguous (null figma + generation)", () => {
    for (const name of ["Separator", "DevRevThemeProvider", "ComputerSidebar.User"]) {
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
