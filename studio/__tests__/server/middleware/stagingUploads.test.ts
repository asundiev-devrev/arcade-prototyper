// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { stagingUploadsMiddleware } from "../../../server/middleware/stagingUploads";

let server: http.Server;
let port: number;
let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-staging-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(stagingUploadsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARCADE_STUDIO_ROOT;
});

async function post(pathname: string, body: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any; sessionCookie?: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const setCookie = res.headers["set-cookie"]?.[0];
          const sessionCookie = setCookie
            ? /studio_staging_session=([^;]+)/.exec(setCookie)?.[1]
            : undefined;
          try {
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, sessionCookie });
          } catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("POST /api/uploads/_staging", () => {
  it("writes the image and returns a path under the staging root", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // fake PNG header
    const res = await post("/api/uploads/_staging", png, { "content-type": "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/uploads-staging\/.+\.png$/);
    expect(fs.existsSync(res.body.path)).toBe(true);
    expect(res.sessionCookie).toBeTruthy();
  });

  it("reuses the session from the request cookie when present", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const first = await post("/api/uploads/_staging", png, { "content-type": "image/png" });
    const second = await post("/api/uploads/_staging", png, {
      "content-type": "image/png",
      cookie: `studio_staging_session=${first.sessionCookie}`,
    });
    expect(second.status).toBe(200);
    expect(path.dirname(first.body.path)).toBe(path.dirname(second.body.path));
  });

  it("rejects unsupported mime types", async () => {
    const res = await post("/api/uploads/_staging", Buffer.from("nope"), {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(400);
  });

  it("rejects headers that only contain an image/ token as a parameter", async () => {
    // Pre-fix the unanchored regex would accept this because the substring
    // `image/png` appears anywhere in the header value.
    const res = await post("/api/uploads/_staging", Buffer.from("hello"), {
      "content-type": "text/plain; fake=image/png",
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid image type with charset parameter", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await post("/api/uploads/_staging", png, {
      "content-type": "image/png; charset=binary",
    });
    expect(res.status).toBe(200);
  });
});
