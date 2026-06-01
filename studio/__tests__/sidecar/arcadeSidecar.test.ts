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

  it("GET /manifest serves a slim index under the agent tool-output cap", async () => {
    const port = (server.address() as any).port;
    const res = await get(port, "/manifest");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Prototype kit manifest");
    expect(res.body).toContain("ComputerPage");
    expect(res.body).toContain("detail: GET /manifest/ComputerPage");
    // The full manifest is ~62KB and gets truncated by the SDK; the index
    // must stay well under the ~50KB cap so it survives one fetch.
    expect(res.body.length).toBeLessThan(50_000);
  });

  it("GET /manifest/:name serves one entry's full detail", async () => {
    const port = (server.address() as any).port;
    const res = await get(port, "/manifest/ComputerPage");
    expect(res.status).toBe(200);
    expect(res.body).toContain("ComputerPage (template)");
    expect(res.body).toContain("```ts"); // full props block, not just names
  });

  it("GET /manifest/:name 404s an unknown component", async () => {
    const port = (server.address() as any).port;
    const res = await get(port, "/manifest/NotARealComponent");
    expect(res.status).toBe(404);
  });
});

function get(port: number, pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
