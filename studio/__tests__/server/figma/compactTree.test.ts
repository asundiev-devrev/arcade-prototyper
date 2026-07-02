import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactTree, DEPTH_CAP, MAX_NODES } from "../../../server/figma/compactTree";

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

  // ── Caps must be big enough for a real full-screen frame ──────────────────
  //
  // These pin the ABSOLUTE cap values, not "cap + N". A relative-to-cap test is
  // a tautology (it passes at 12/500 AND 16/1200) — the adversarial review
  // proved the old versions shipped green with the caps reverted. The numbers
  // below (depth 15, ~700 nodes) are measured from the real precisely-4 frame:
  // its raw tree was 900 nodes / depth-15 and the old 12/500 caps truncated it
  // to 487 nodes, dropping 46 of 107 text leaves so the agent hallucinated the
  // brief text from the PNG. Any regression below depth-15 / 700-node capacity
  // reintroduces that exact failure, and these tests must catch it.

  /** Build a text leaf nested `depth` frames deep, carrying `label`. */
  function buriedText(depth: number, label: string) {
    let node: any = {
      id: `text-${label}`, type: "TEXT", characters: label,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
      style: { fontSize: 16, lineHeightPx: 24 },
    };
    for (let i = 0; i < depth; i++) {
      node = {
        // Non-passthrough (own fill) so the wrapper is NOT collapsed — this is a
        // genuine nesting depth, matching the real frame's mixed-weight text runs.
        id: `w-${label}-${i}`, type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 300 },
        fills: [{ type: "SOLID", color: { r: 0.5, g: 0, b: 0.7 } }],
        children: [node],
      };
    }
    return node;
  }

  it("keeps text nested at depth 15 (real frame depth) — DEPTH_CAP must clear it", () => {
    // Fails at DEPTH_CAP=12 (text at depth 15 is dropped), passes at 16.
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 400 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [buriedText(15, "Present the Service Blueprint")],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Present the Service Blueprint");
    expect(DEPTH_CAP).toBeGreaterThanOrEqual(15);
  });

  it("keeps all text in a ~700-node full-screen frame — MAX_NODES must clear it", () => {
    // The real precisely-4 frame was 900 raw nodes; 12/500 dropped 46/107 text
    // leaves. This 700-node frame with 120 text leaves fails at MAX_NODES=500
    // (later text leaves truncated → cap warning) and passes at 1200 (no
    // truncation, every leaf survives).
    const children: any[] = [];
    // 580 non-text filler frames (chrome/layout) BEFORE the text so the text
    // leaves sit past the old 500 budget and get truncated first.
    for (let i = 0; i < 580; i++) {
      children.push({
        id: `filler-${i}`, type: "FRAME",
        absoluteBoundingBox: { x: 0, y: i, width: 10, height: 10 },
        fills: [{ type: "SOLID", color: { r: 0.5, g: 0, b: 0.7 } }],
      });
    }
    for (let i = 0; i < 120; i++) {
      children.push({
        id: `brief-${i}`, type: "TEXT", characters: `brief line ${i}`,
        absoluteBoundingBox: { x: 0, y: 1000 + i, width: 200, height: 20 },
        style: { fontSize: 16, lineHeightPx: 24 },
      });
    }
    const { tree, warnings } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 99999 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children,
    });
    // No truncation at the current cap.
    expect(warnings.some((w) => /node cap/.test(w))).toBe(false);
    // Every one of the 120 brief lines survived (the first AND the last — the
    // last is what old 500 dropped).
    const json = JSON.stringify(tree);
    expect(json).toContain("brief line 0");
    expect(json).toContain("brief line 119");
    expect(MAX_NODES).toBeGreaterThanOrEqual(700);
  });

  it("still emits a cap warning on a genuinely pathological tree (backstop intact)", () => {
    // The caps are a backstop, not removed. A tree well past MAX_NODES must
    // still truncate + warn (pins that we didn't disable the guard entirely).
    const children = Array.from({ length: MAX_NODES + 400 }, (_, i) => ({
      id: `row-${i}`, type: "TEXT", characters: `row ${i}`,
      absoluteBoundingBox: { x: 0, y: i * 10, width: 100, height: 10 },
      style: { fontSize: 12, lineHeightPx: 16 },
    }));
    const { warnings } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 999999 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children,
    });
    expect(warnings.some((w) => /node cap/.test(w))).toBe(true);
  });

  it("does not truncate a realistic full-screen frame of ~300 nodes", () => {
    // The SoR-nav failing case truncated at the old 200 cap (4-5x 'node cap
    // reached'), starving the sidebar because a sibling section consumed the
    // global budget first. A real precise-repro frame must fit without loss.
    const children = Array.from({ length: 300 }, (_, i) => ({
      id: `row-${i}`, type: "TEXT", characters: `row ${i}`,
      absoluteBoundingBox: { x: 0, y: i * 10, width: 100, height: 10 },
      style: { fontSize: 12, lineHeightPx: 16 },
    }));
    const { tree, warnings } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 3000 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children,
    });
    expect(warnings.some((w) => /node cap/.test(w))).toBe(false);
    expect(tree.children).toHaveLength(300);
  });

  it("carries absolute geometry as bbox relative to the frame root", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 100, y: 50, width: 240, height: 800 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [{
        id: "child", type: "TEXT", characters: "Home",
        // absolute (130, 70) → relative to root origin (100, 50) = (30, 20)
        absoluteBoundingBox: { x: 130, y: 70, width: 64, height: 16 },
        style: { fontSize: 12, lineHeightPx: 16 },
      }],
    });
    expect(tree.bbox).toEqual([0, 0, 240, 800]); // root at its own origin
    expect(tree.children?.[0].bbox).toEqual([30, 20, 64, 16]);
  });

  it("carries instance component identity (name + variant props)", () => {
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 800 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [{
        id: "btn", type: "INSTANCE", name: "Navigation Button",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 32 },
        componentProperties: {
          "State": { value: "Default", type: "VARIANT" },
          "Has Icon": { value: "true", type: "BOOLEAN" },
          "Label#1:0": { value: "My Work", type: "TEXT" },
        },
        children: [],
      }],
    });
    const inst = tree.children?.[0];
    expect(inst?.type).toBe("instance");
    expect(inst?.component?.name).toBe("Navigation Button");
    expect(inst?.component?.props).toEqual({ State: "Default", "Has Icon": "true", Label: "My Work" });
  });

  it("keeps a short instance name that the noise filter would otherwise drop", () => {
    // "_Item" is 5 chars with no space — meaningfulName drops it for plain
    // frames, but for an INSTANCE the name is load-bearing identity. Keep it.
    const { tree } = compactTree({
      id: "root", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 800 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [{
        id: "row", type: "INSTANCE", name: "_Item",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 32 },
        children: [],
      }],
    });
    expect(tree.children?.[0].component?.name).toBe("_Item");
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
