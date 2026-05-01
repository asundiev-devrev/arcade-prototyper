// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { figmaMiddleware } from "../../../server/middleware/figma";
import * as ingestModule from "../../../server/figmaIngest";

let server: http.Server; let port: number;

beforeEach(async () => {
  const phase1Result = {
    ok: true,
    source: { fileKey: "k", nodeId: "1:2", url: "u", fetchedAt: "t" },
    png: null, tree: { id: "0", type: "frame" },
    tokens: { colors: {}, typography: {}, spacing: {} },
    composites: [], diagnostics: { warnings: [] },
  };
  vi.spyOn(ingestModule, "getFigmaIngest").mockResolvedValue({
    ingest: vi.fn().mockResolvedValue(phase1Result),
    ingestPhase1: vi.fn().mockResolvedValue(phase1Result),
    getCached: vi.fn().mockReturnValue(undefined),
    getPhase1Pending: vi.fn().mockReturnValue(undefined),
  });
  server = http.createServer(figmaMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => { server.close(); vi.restoreAllMocks(); });

describe("POST /api/figma/ingest", () => {
  it("accepts a Figma url and returns an IngestResult", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.figma.com/design/AbC/x?node-id=1-2" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tree.id).toBe("0");
  });

  it("accepts explicit fileKey + nodeId", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: "AbC", nodeId: "1:2" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 on a missing/malformed url", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(400);
  });
});
