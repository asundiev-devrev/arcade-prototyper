import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTokens } from "../../../server/figma/resolveTokens";
import { compactTree } from "../../../server/figma/compactTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

describe("resolveTokens", () => {
  it("maps bound color and spacing variables to token names", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(fxDir, "with-variables.json"), "utf-8"));
    const rawNode = fx.node["1:2"].document;
    const { tree } = compactTree(rawNode);

    const { tree: resolvedTree, tokens, warnings } = resolveTokens(tree, rawNode, fx.variables);

    expect(warnings).toEqual([]);
    expect(resolvedTree.style?.fill).toBe("surface/default");
    expect(resolvedTree.layout?.gap).toBe(12);     // numeric value still present
    expect(tokens.colors["surface/default"]).toBe("#FFFFFF");
    expect(tokens.spacing["spacing/md"]).toBe(12);
  });

  it("leaves unbound fills as raw hex and warns in diagnostics", () => {
    const unbound = {
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      children: [],
    };
    const { tree } = compactTree(unbound);
    const { tree: resolved, tokens, warnings } = resolveTokens(tree, unbound, { variables: {} });
    expect(resolved.style?.fill).toBe("#000000");
    expect(Object.keys(tokens.colors)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/unbound/i);
  });

  it("tolerates a missing variables payload", () => {
    const node = {
      id: "r", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [],
    };
    const { tree } = compactTree(node);
    const { tokens, warnings } = resolveTokens(tree, node, null);
    expect(tokens.colors).toEqual({});
    expect(warnings.some((w) => /variables unavailable/i.test(w))).toBe(true);
  });
});
