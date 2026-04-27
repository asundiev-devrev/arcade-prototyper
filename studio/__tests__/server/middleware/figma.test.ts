// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { figmaMiddleware } from "../../../server/middleware/figma";
import * as cli from "../../../server/figmaCli";

let server: http.Server; let port: number; let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-figma-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  vi.spyOn(cli, "daemonStatus").mockResolvedValue({ connected: true });
  vi.spyOn(cli, "getNode").mockResolvedValue({ name: "Button" });
  server = http.createServer(figmaMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  vi.restoreAllMocks();
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/figma", () => {
  it("returns daemon status", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(await res.json()).toEqual({ connected: true });
  });

  it("reads a node by id", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/node/1:2`);
    expect(await res.json()).toEqual({ name: "Button" });
  });

  it("surfaces disconnected daemon with a 503 and plain hint", async () => {
    (cli.daemonStatus as any).mockResolvedValueOnce({ connected: false });
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.hint).toMatch(/Figma Desktop/);
  });

  it("rejects export outFile outside the projects root with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: "1:2", outFile: "/etc/evil.png", scale: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_path");
  });

  it("rejects malformed JSON body with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });
});
