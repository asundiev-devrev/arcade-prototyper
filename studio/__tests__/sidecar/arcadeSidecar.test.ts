// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { createSidecarServer } from "../../server/sidecar/arcadeSidecar";

let server: http.Server;
afterAll(() => server?.close());

function post(
  port: number,
  pathname: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("arcade sidecar", () => {
  it("GET /health returns ok and POST /pack returns html", async () => {
    server = createSidecarServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;

    const tsx = `import * as React from "react";
import { Button } from "arcade/components";
export default function Frame() { return <Button variant="primary">Hi</Button>; }`;
    const res = await post(port, "/pack", JSON.stringify({ tsx, mode: "light" }));
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.html).toContain("<!DOCTYPE html>");
  }, 120_000);

  it("rejects missing tsx with 400", async () => {
    const port = (server.address() as any).port;
    const res = await post(port, "/pack", JSON.stringify({ mode: "light" }));
    expect(res.status).toBe(400);
  });
});
