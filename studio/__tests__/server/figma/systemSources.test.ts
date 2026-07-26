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

  it("exports sample-frame PNGs concurrently, not one-at-a-time", async () => {
    // Regression guard for the serial-export perf fix: the old code awaited
    // each export inside a for-loop, so N slow exports cost N×latency. The
    // parallel version must have all exports in flight at once. We prove this
    // by holding every export open until we've SEEN every call start.
    let inFlight = 0;
    let maxConcurrent = 0;
    const release: Array<() => void> = [];
    const deps = makeDeps({
      exportPng: vi.fn().mockImplementation((_fk: string, nodeId: string) => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        return new Promise((resolve) => {
          release.push(() => {
            inFlight -= 1;
            resolve({ path: `/tmp/${nodeId.replace(":", "-")}.png`, widthPx: 0, heightPx: 0 });
          });
        });
      }),
    });
    const pending = fetchSystemSources("fk", deps);
    // Let the microtask queue drain so every export promise has been created.
    await new Promise((r) => setTimeout(r, 0));
    expect(maxConcurrent).toBeGreaterThan(1); // truly concurrent, not serial
    release.forEach((fn) => fn());
    const out = await pending;
    expect(out.sampleFrames.length).toBe(2); // order preserved, both landed
    expect(out.sampleFrames[0].nodeId).toBe("2:1");
  });

  it("preserves largest-first order even when an earlier export fails", async () => {
    // Promise.all keeps index alignment; a null (failed export) must drop only
    // that frame, not shift the rest or reorder them.
    const deps = makeDeps({
      exportPng: vi.fn().mockImplementation(async (_fk: string, nodeId: string) =>
        nodeId === "2:1" ? null : { path: `/tmp/${nodeId.replace(":", "-")}.png`, widthPx: 0, heightPx: 0 }),
    });
    const out = await fetchSystemSources("fk", deps);
    expect(out.sampleFrames.map((f) => f.nodeId)).toEqual(["2:3"]);
    expect(out.warnings.some((w) => /png export failed for 2:1/.test(w))).toBe(true);
  });
});

describe("pickSampleFrames", () => {
  it("sorts by area descending, caps at 4, skips frames < 400x400", () => {
    const fx = loadMinimal();
    const picks = pickSampleFrames(fx.file.document);
    expect(picks.length).toBe(2); // Home (1440x900), Settings (800x600); Icon (24x24) skipped
    expect(picks[0].nodeId).toBe("2:1");
    expect(picks[1].nodeId).toBe("2:3");
  });

  it("caps output at 4 frames (trimmed from 8 to fit the sync budget)", () => {
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
    expect(picks.length).toBe(4);
    // Largest-first ranking preserved after the cap: F11 (1011²) is biggest.
    expect(picks[0].nodeId).toBe("3:11");
  });
});
