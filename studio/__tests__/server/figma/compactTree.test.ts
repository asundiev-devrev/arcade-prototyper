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
