import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inkPaint, readColorVar, resolveTokens } from "../../../server/figma/resolveTokens";
import { compactTree } from "../../../server/figma/compactTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

describe("resolveTokens", () => {
  it("maps bound color and spacing variables to token names", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(fxDir, "with-variables.json"), "utf-8"));
    const rawNode = fx.node["1:2"].document;
    const { tree, rawById } = compactTree(rawNode);

    const { tree: resolvedTree, tokens, warnings } = resolveTokens(tree, rawById, fx.variables);

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
    const { tree, rawById } = compactTree(unbound);
    const { tree: resolved, tokens, warnings } = resolveTokens(tree, rawById, { variables: {} });
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
    const { tree, rawById } = compactTree(node);
    const { tokens, warnings } = resolveTokens(tree, rawById, null);
    expect(tokens.colors).toEqual({});
    expect(warnings.some((w) => /variables unavailable/i.test(w))).toBe(true);
  });

  it("resolves a bound color even when a dropped sibling shifts child indices", () => {
    // Regression: compactTree drops the zero-size sibling at raw index 0, so
    // the token-bound frame is raw index 1 but compact id "0.0". The old
    // path-rebuild lookup matched compact "0.0" against the WRONG raw node
    // (the zero-size one) and silently left the fill un-tokenized. The
    // rawById map keyed by final compact id must point at the real bound node.
    const variables = {
      variables: {
        "VariableID:9:1": { id: "VariableID:9:1", name: "surface/raised", resolvedType: "COLOR" },
      },
    };
    const root = {
      id: "root", type: "FRAME", name: "Sidebar Root",
      absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 800 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: [
        // dropped: zero-size, shifts the index of everything after it
        { id: "ghost", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 } },
        // the real bound surface — raw index 1, compact id "0.0"
        {
          id: "panel", type: "FRAME", name: "Panel Surface",
          absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 200 },
          fills: [{
            type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 },
            boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:9:1" } },
          }],
          children: [],
        },
      ],
    };

    const { tree, rawById } = compactTree(root);
    const panel = tree.children?.[0];
    expect(panel?.id).toBe("0.0"); // index shifted by the dropped ghost

    const { tree: resolved, tokens } = resolveTokens(tree, rawById, variables);
    expect(resolved.children?.[0].style?.fill).toBe("surface/raised");
    expect(tokens.colors["surface/raised"]).toBe("#E6E6E6");
  });
});

// A theme-aware colour in Figma is not one paint. It is a stack: a half-opacity
// COLOR_DODGE layer, an opaque MULTIPLY layer carrying the colour variable, and a
// zero-opacity NORMAL white — the switch that lets one component serve both themes.
// Reading "the first visible solid" picked the dodge layer, so every secondary string
// in an imported screen arrived at half strength and unbound. Both halves of that bug
// are guarded here, because either one alone still ships the wrong colour.
describe("inkPaint — the paint a person actually sees", () => {
  const grey = { r: 0.478, g: 0.459, b: 0.475, a: 1 };
  const themeStack = [
    { opacity: 0.5, blendMode: "COLOR_DODGE", type: "SOLID", color: grey },
    {
      blendMode: "MULTIPLY", type: "SOLID", color: grey,
      boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:fg/1" } },
    },
    { opacity: 0, blendMode: "NORMAL", type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } },
  ];

  it("picks the opaque layer out of a theme-switching stack", () => {
    expect(inkPaint(themeStack)?.blendMode).toBe("MULTIPLY");
    expect(inkPaint(themeStack)?.opacity).toBeUndefined(); // i.e. fully opaque
  });

  it("keeps genuinely translucent paint translucent", () => {
    // A disabled label really is drawn at 40%. Nothing in the stack is opaque, so the
    // first visible paint wins and the alpha survives — otherwise this fix would trade
    // one wrong colour for another.
    const faded = [{ opacity: 0.4, type: "SOLID", color: grey }];
    expect(inkPaint(faded)?.opacity).toBe(0.4);
  });

  it("ignores hidden and zero-opacity paints", () => {
    expect(inkPaint([{ type: "SOLID", visible: false, color: grey }])).toBeUndefined();
    expect(inkPaint([{ type: "SOLID", opacity: 0, color: grey }])).toBeUndefined();
    expect(inkPaint([])).toBeUndefined();
    expect(inkPaint(undefined)).toBeUndefined();
  });

  it("finds the variable the ink layer is bound to, not the unbound switch above it", () => {
    const vars = { "VariableID:fg/1": { name: "fg/secondary" } };
    expect(readColorVar(themeStack as any[], vars)).toBe("fg/secondary");
  });
});
