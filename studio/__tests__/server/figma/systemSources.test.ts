import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSystemSources, pickSampleFrames } from "../../../server/figma/systemSources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

function loadMinimal() {
  return JSON.parse(fs.readFileSync(path.join(fxDir, "system-sources-minimal.json"), "utf-8"));
}

function makeDeps(overrides: any = {}) {
  const fx = loadMinimal();
  return {
    getStyles: vi.fn().mockResolvedValue(fx.styles),
    getVariables: vi.fn().mockResolvedValue(fx.variables),
    getComponents: vi.fn().mockResolvedValue(fx.components),
    getFile: vi.fn().mockResolvedValue(fx.file),
    exportPng: vi.fn().mockImplementation(async (_fk: string, nodeId: string) =>
      ({ path: `/tmp/${nodeId.replace(":", "-")}.png`, widthPx: 0, heightPx: 0 })),
    ...overrides,
  };
}

describe("fetchSystemSources", () => {
  it("assembles the SystemSources shape from figmanage calls", async () => {
    const deps = makeDeps();
    const out = await fetchSystemSources("fk", deps);
    expect(out.styles.paint.length + out.styles.text.length).toBeGreaterThan(0);
    expect(out.components.length).toBe(1);
    expect(out.sampleFrames.length).toBeGreaterThan(0);
  });

  it("warns and proceeds when variables payload is missing", async () => {
    const deps = makeDeps({ getVariables: vi.fn().mockResolvedValue(null) });
    const out = await fetchSystemSources("fk", deps);
    expect(out.warnings.some((w) => /variables/i.test(w))).toBe(true);
    expect(out.variables.color).toEqual([]);
  });

  it("warns and proceeds when getFile returns null (no sample frames)", async () => {
    const deps = makeDeps({ getFile: vi.fn().mockResolvedValue(null) });
    const out = await fetchSystemSources("fk", deps);
    expect(out.sampleFrames).toEqual([]);
    expect(out.warnings.some((w) => /file/i.test(w))).toBe(true);
  });
});

describe("pickSampleFrames", () => {
  it("sorts by area descending, caps at 8, skips frames < 400x400", () => {
    const fx = loadMinimal();
    const picks = pickSampleFrames(fx.file.document);
    expect(picks.length).toBe(2); // Home (1440x900), Settings (800x600); Icon (24x24) skipped
    expect(picks[0].nodeId).toBe("2:1");
    expect(picks[1].nodeId).toBe("2:3");
  });

  it("caps output at 8 frames", () => {
    const doc = {
      children: [{
        type: "CANVAS",
        children: Array.from({ length: 12 }, (_, i) => ({
          id: `3:${i}`,
          type: "FRAME",
          name: `F${i}`,
          absoluteBoundingBox: { x: 0, y: 0, width: 1000 + i, height: 1000 + i },
        })),
      }],
    };
    const picks = pickSampleFrames(doc);
    expect(picks.length).toBe(8);
  });
});
