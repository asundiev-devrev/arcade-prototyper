// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MEMORY_SENTINEL,
  extractProposedMemories,
  stripMemoryLines,
} from "../../server/memoryContract";

describe("extractProposedMemories", () => {
  it("reads a global proposal", () => {
    const out = extractProposedMemories(
      `Built the nav.\n${MEMORY_SENTINEL} global | Active nav rows use neutral gray\n\n### Deviations\n\nNone.`,
    );
    expect(out).toEqual([{ fact: "Active nav rows use neutral gray", level: "global" }]);
  });

  it("reads a project proposal", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | Filter chips go in the toolbar`);
    expect(out).toEqual([{ fact: "Filter chips go in the toolbar", level: "project" }]);
  });

  it("defaults an unrecognised level to project (the safer scope)", () => {
    // A wrong global memory pollutes every future project; a wrong project one
    // is contained. When the agent is unclear, contain it.
    const out = extractProposedMemories(`${MEMORY_SENTINEL} everywhere | Something`);
    expect(out).toEqual([{ fact: "Something", level: "project" }]);
  });

  it("tolerates a missing level separator", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} Use sentence case for headings`);
    expect(out).toEqual([{ fact: "Use sentence case for headings", level: "project" }]);
  });

  it("returns nothing when there is no sentinel", () => {
    expect(extractProposedMemories("I will remember to use teal accents.")).toEqual([]);
  });

  it("ignores a sentinel with an empty fact", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} global |    `)).toEqual([]);
  });

  it("caps at 3 proposals per turn", () => {
    const many = Array.from({ length: 8 }, (_, i) => `${MEMORY_SENTINEL} project | fact ${i}`).join("\n");
    expect(extractProposedMemories(many)).toHaveLength(3);
  });

  it("rejects an absurdly long fact rather than storing a paragraph", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | ${"x".repeat(400)}`);
    expect(out).toEqual([]);
  });

  it("trims trailing punctuation noise but keeps sentence text", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | Keep empty states terse.  `);
    expect(out[0].fact).toBe("Keep empty states terse.");
  });
});

describe("stripMemoryLines", () => {
  it("removes the sentinel line so the designer never sees it", () => {
    const text = `Built the nav.\n${MEMORY_SENTINEL} global | Neutral gray for nav\n\n### Deviations\n\nNone.`;
    const out = stripMemoryLines(text);
    expect(out).not.toContain(MEMORY_SENTINEL);
    expect(out).not.toContain("Neutral gray for nav");
    expect(out).toContain("Built the nav.");
    expect(out).toContain("### Deviations");
  });

  it("leaves text without a sentinel untouched", () => {
    expect(stripMemoryLines("Built the nav.")).toBe("Built the nav.");
  });

  it("does not leave a blank-line hole where the line was", () => {
    const out = stripMemoryLines(`A\n${MEMORY_SENTINEL} project | x\nB`);
    expect(out).toBe("A\nB");
  });
});
