import { describe, it, expect, vi } from "vitest";
import { classifyComposites } from "../../../server/figma/classifyComposites";
import type { CompactNode } from "../../../server/figma/types";

function fakeSpawner(reply: string) {
  return vi.fn().mockResolvedValue({ text: reply, exitCode: 0 });
}

const tree: CompactNode = {
  id: "0", type: "frame",
  children: [
    { id: "0.0", type: "frame", name: "Sidebar" },
    { id: "0.1", type: "frame", name: "Main content" },
  ],
};
const compositeNames = ["AppShell", "NavSidebar", "VistaHeader"];

describe("classifyComposites", () => {
  it("parses a well-formed classifier reply", async () => {
    const reply = JSON.stringify([
      { composite: "AppShell",   path: "0",   confidence: "high",   reason: "outer chrome" },
      { composite: "NavSidebar", path: "0.0", confidence: "medium", reason: "fixed-width col" },
    ]);
    const spawn = fakeSpawner(reply);
    const { composites, warnings } = await classifyComposites(tree, compositeNames, { spawn });
    expect(composites).toHaveLength(2);
    expect(composites[0].composite).toBe("AppShell");
    expect(warnings).toEqual([]);
  });

  it("drops entries with unknown composite names", async () => {
    const reply = JSON.stringify([
      { composite: "ImaginaryThing", path: "0", confidence: "high", reason: "x" },
      { composite: "NavSidebar",     path: "0.0", confidence: "high", reason: "y" },
    ]);
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner(reply) });
    expect(composites.map((c) => c.composite)).toEqual(["NavSidebar"]);
    expect(warnings.some((w) => /unknown composite/i.test(w))).toBe(true);
  });

  it("drops entries with paths that do not exist in the tree", async () => {
    const reply = JSON.stringify([
      { composite: "AppShell", path: "9.9.9", confidence: "high", reason: "bogus" },
    ]);
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner(reply) });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /invalid path/i.test(w))).toBe(true);
  });

  it("returns empty on un-parseable reply", async () => {
    const { composites, warnings } = await classifyComposites(
      tree, compositeNames, { spawn: fakeSpawner("the model said hi") });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /parse/i.test(w))).toBe(true);
  });

  it("returns empty when the spawn fails (non-zero exit)", async () => {
    const spawn = vi.fn().mockResolvedValue({ text: "", exitCode: 1 });
    const { composites, warnings } = await classifyComposites(tree, compositeNames, { spawn });
    expect(composites).toEqual([]);
    expect(warnings.some((w) => /classifier failed/i.test(w))).toBe(true);
  });
});
