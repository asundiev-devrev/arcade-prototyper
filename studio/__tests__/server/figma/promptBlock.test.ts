import { describe, it, expect } from "vitest";
import { buildFigmaContextBlock } from "../../../server/figma/promptBlock";
import type { IngestResult } from "../../../server/figma/types";

const result: IngestResult = {
  source: { fileKey: "k", nodeId: "1:2", url: "https://figma.com/design/k/x?node-id=1-2", fetchedAt: "t" },
  png: { path: "/p.png", widthPx: 1440, heightPx: 900 },
  tree: {
    id: "0", type: "frame", name: "App",
    style: { fill: "surface/default" },
    layout: { direction: "row" },
    children: [
      { id: "0.0", type: "frame", name: "Sidebar", layout: { direction: "col", width: 248, gap: 4 }, style: { fill: "surface/raised" } },
      { id: "0.1", type: "text", text: { content: "Home", style: "body-md" } },
    ],
  },
  tokens: { colors: { "surface/default": "#FFFFFF", "surface/raised": "#F5F5F5" }, typography: {}, spacing: {} },
  composites: [
    { composite: "AppShell", path: "0", confidence: "high", reason: "outer chrome" },
    { composite: "NavSidebar", path: "0.0", confidence: "high", reason: "248px col" },
  ],
  diagnostics: { warnings: [] },
};

describe("buildFigmaContextBlock", () => {
  it("emits a <figma_context> block with tokens, composites, and tree", () => {
    const s = buildFigmaContextBlock(result);
    expect(s.startsWith("<figma_context")).toBe(true);
    expect(s.endsWith("</figma_context>")).toBe(true);
    expect(s).toContain(`url="${result.source.url}"`);
    expect(s).toContain("resolved_tokens:");
    expect(s).toContain("surface/default");
    expect(s).toContain("suggested_composites:");
    expect(s).toContain("AppShell");
    expect(s).toContain("NavSidebar");
    expect(s).toContain("tree:");
    expect(s).toContain("App");
    expect(s).toContain("Sidebar");
  });

  it("indents tree children by depth", () => {
    const s = buildFigmaContextBlock(result);
    const treeSection = s.slice(s.indexOf("tree:"));
    const lines = treeSection.split("\n").filter((l) => l.startsWith("  -") || l.startsWith("    -"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // At least one line at depth 1 (two spaces), at least one at depth 2 (four).
    expect(lines.some((l) => l.startsWith("  -"))).toBe(true);
    expect(lines.some((l) => l.startsWith("    -"))).toBe(true);
  });

  it("omits empty token categories", () => {
    const s = buildFigmaContextBlock({ ...result,
      tokens: { colors: {}, typography: {}, spacing: {} } });
    expect(s).not.toContain("colors:");
    expect(s).not.toContain("typography:");
    expect(s).not.toContain("spacing:");
  });

  it("omits composites section when empty", () => {
    const s = buildFigmaContextBlock({ ...result, composites: [] });
    expect(s).not.toContain("suggested_composites:");
  });
});
