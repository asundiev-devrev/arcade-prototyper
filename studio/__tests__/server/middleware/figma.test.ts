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
  vi.spyOn(cli, "figmaWhoami").mockResolvedValue({ authenticated: true, user: { email: "a@b.com" } });
  vi.spyOn(cli, "getNode").mockResolvedValue({ name: "Button" });
  vi.spyOn(cli, "nodeTree").mockResolvedValue({ name: "root" });
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
  it("status returns figmanage whoami result", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ authenticated: true, user: { email: "a@b.com" } });
  });

  it("status returns 200 with authenticated:false when unauthenticated", async () => {
    (cli.figmaWhoami as any).mockResolvedValueOnce({ authenticated: false });
    const res = await fetch(`http://localhost:${port}/api/figma/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  it("reads a node by fileKey + nodeId", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/node/FILEKEY/1:2`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Button" });
    expect(cli.getNode).toHaveBeenCalledWith("FILEKEY", "1:2");
  });

  it("tree endpoint requires fileKey in the path", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/tree/FILEKEY/1:2?d=4`);
    expect(res.status).toBe(200);
    expect(cli.nodeTree).toHaveBeenCalledWith("FILEKEY", "1:2", 4);
  });

  it("export requires fileKey in the body", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: "1:2", outFile: "/etc/evil.png", scale: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("rejects export outFile outside the projects root with 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: "F1", nodeId: "1:2", outFile: "/etc/evil.png", scale: 2 }),
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
