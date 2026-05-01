import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactTree } from "../../../server/figma/compactTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures/figma");
function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf-8"));
}

describe("compactTree (happy path)", () => {
  it("converts a simple figmanage response into a CompactNode tree", () => {
    const raw = loadFixture("simple-node.json");
    const node = raw["1038:14518"].document;
    const { tree, warnings } = compactTree(node);

    expect(warnings).toEqual([]);
    expect(tree.id).toBe("0");
    expect(tree.type).toBe("frame");
    expect(tree.style?.fill).toBe("#FFFFFF");
    expect(tree.style?.radius).toBe(8);
    expect(tree.children).toHaveLength(1);
    const [child] = tree.children!;
    expect(child.id).toBe("0.0");
    expect(child.type).toBe("text");
    expect(child.text?.content).toBe("Hello world");
    expect(child.text?.style).toBe("16/24/500");
    expect(child.name).toBeUndefined(); // "Title" is 5 chars, below the meaningful-name threshold
  });
});

describe("compactTree (edge cases)", () => {
  it("drops zero-size nodes", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        { id: "a", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 } },
        { id: "b", type: "TEXT", characters: "keep me",
          absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
          style: { fontSize: 12, lineHeightPx: 16 } },
      ],
    });
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0].type).toBe("text");
  });

  it("collapses passthrough groups", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [{
        id: "grp", type: "GROUP", name: "Group 1",
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        children: [{
          id: "inner", type: "TEXT", characters: "hello",
          absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
          style: { fontSize: 12, lineHeightPx: 16 },
        }],
      }],
    });
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0].type).toBe("text");
    expect(tree.children?.[0].id).toBe("0.0");
  });

  it("filters noisy layer names", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME", name: "Rectangle 47",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [],
    });
    expect(tree.name).toBeUndefined();
  });

  it("caps depth and emits a warning", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fx = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../../fixtures/figma/oversized.json"), "utf-8"));
    const { warnings } = compactTree(fx.root.document);
    expect(warnings.some((w) => /depth cap|node cap/.test(w))).toBe(true);
  });

  it("preserves auto-layout fields", () => {
    const { tree } = compactTree({
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 400 },
      layoutMode: "VERTICAL", itemSpacing: 12,
      paddingTop: 16, paddingRight: 12, paddingBottom: 16, paddingLeft: 12,
      counterAxisAlignItems: "CENTER", primaryAxisAlignItems: "MIN",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      children: [],
    });
    expect(tree.layout?.direction).toBe("col");
    expect(tree.layout?.gap).toBe(12);
    expect(tree.layout?.padding).toEqual([16, 12, 16, 12]);
    expect(tree.layout?.align).toBe("center");
    expect(tree.layout?.justify).toBe("start");
  });
});
