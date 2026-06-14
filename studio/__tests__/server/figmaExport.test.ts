// studio/__tests__/server/figmaExport.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { handleFigmaExport, type FigmaExportDeps } from "../../server/middleware/figmaExport";
import type { SljDocument } from "../../src/export/slj";

const slj: SljDocument = {
  slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
  root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {}, children: [] },
};

function deps(over: Partial<FigmaExportDeps> = {}): FigmaExportDeps {
  return {
    loadSlj: async () => slj,
    getBridge: async () => ({
      port: 9223, isConnected: () => true,
      runCode: async () => ({ made: { instances: 5, frames: 10, icons: 2, binds: 3, fail: 0 }, errs: [], rootId: "1:2" }),
      close: async () => {},
    }),
    ...over,
  };
}

describe("handleFigmaExport", () => {
  it("returns ok + summary on a successful run", async () => {
    const out = await handleFigmaExport("p", "computer", deps());
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.summary.made.instances).toBe(5);
  });

  it("returns no_bridge when the plugin is not connected", async () => {
    const out = await handleFigmaExport("p", "computer", deps({
      getBridge: async () => ({ port: 9223, isConnected: () => false, runCode: async () => { throw new Error("x"); }, close: async () => {} }),
    }));
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe("no_bridge");
  });

  it("returns 404 when the frame has no SLJ", async () => {
    const out = await handleFigmaExport("p", "missing", deps({ loadSlj: async () => null }));
    expect(out.status).toBe(404);
  });

  it("returns exec_error when the bridge run rejects", async () => {
    const out = await handleFigmaExport("p", "computer", deps({
      getBridge: async () => ({ port: 9223, isConnected: () => true, runCode: async () => { throw new Error("boom in figma"); }, close: async () => {} }),
    }));
    expect(out.status).toBe(502);
    expect(out.body.error.code).toBe("exec_error");
    expect(out.body.error.message).toContain("boom in figma");
  });
});
