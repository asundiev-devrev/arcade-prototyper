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

  it("returns 404 for unknown figma routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/figma/bogus`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });
});
