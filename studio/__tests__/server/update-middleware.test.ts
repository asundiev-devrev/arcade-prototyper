import { describe, it, expect, beforeEach } from "vitest";
import { updateMiddleware } from "../../server/middleware/update";
import { __resetForTest, getUpdateState, setPending } from "../../server/updateRegistry";

async function invoke(method: string, url: string, body?: unknown) {
  const handler = updateMiddleware();
  const chunks: string[] = [];
  let statusCode = 0;
  const req: any = {
    method,
    url,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === "data" && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (event === "end") cb();
      return req;
    },
  };
  const res: any = {
    writeHead(code: number) { statusCode = code; return res; },
    end(s?: string) { if (s) chunks.push(s); },
  };
  let nextCalled = false;
  await handler(req, res, () => { nextCalled = true; });
  return { statusCode, body: chunks.join(""), nextCalled };
}

describe("updateMiddleware", () => {
  beforeEach(() => __resetForTest());

  it("GET /api/update/status returns the current state", async () => {
    setPending("0.43.0");
    const r = await invoke("GET", "/api/update/status");
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ pendingVersion: "0.43.0", installRequested: false });
  });

  it("POST /api/update/available records the version", async () => {
    const r = await invoke("POST", "/api/update/available", { version: "0.43.0" });
    expect(r.statusCode).toBe(204);
    expect(getUpdateState().pendingVersion).toBe("0.43.0");
  });

  it("POST /api/update/install sets installRequested", async () => {
    setPending("0.43.0");
    const r = await invoke("POST", "/api/update/install");
    expect(r.statusCode).toBe(204);
    expect(getUpdateState().installRequested).toBe(true);
  });

  it("POST /api/update/clear resets pending state", async () => {
    setPending("0.43.0");
    const r = await invoke("POST", "/api/update/clear");
    expect(r.statusCode).toBe(204);
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });

  it("passes through unrelated routes", async () => {
    const r = await invoke("GET", "/api/something-else");
    expect(r.nextCalled).toBe(true);
  });
});
