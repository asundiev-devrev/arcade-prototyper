import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const writeBatch = vi.fn();
const readFile = vi.fn();
vi.mock("../../server/codeWriter/index", () => ({ writeBatch: (...a: unknown[]) => writeBatch(...a) }));
vi.mock("node:fs/promises", () => ({ default: { readFile: (...a: unknown[]) => readFile(...a) }, readFile: (...a: unknown[]) => readFile(...a) }));

import { visualEditMiddleware } from "../../server/middleware/visualEdit";

function mkReq(url: string, method: string, body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req: any = (async function* () { for (const c of chunks) yield c; })();
  req.url = url; req.method = method;
  return req as IncomingMessage;
}
function mkRes() {
  const res: any = { statusCode: 0, body: "", headers: {} };
  res.writeHead = (s: number, h: Record<string, string>) => { res.statusCode = s; res.headers = h; };
  res.end = (b?: string) => { res.body = b ?? ""; };
  return res as ServerResponse & { statusCode: number; body: string };
}

describe("visualEditMiddleware", () => {
  beforeEach(() => {
    writeBatch.mockReset();
    readFile.mockReset();
    readFile.mockResolvedValue("MOCK SOURCE");
  });

  it("passes valid batches to writeBatch and returns ok", async () => {
    writeBatch.mockResolvedValue({ ok: true });
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST",
      { frameSlug: "01-x", edits: [{ file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6, fields: [] }] }),
      res, () => {});
    expect(readFile).toHaveBeenCalled();
    expect(writeBatch).toHaveBeenCalledWith("01-x", expect.any(Array));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("returns the bail reason with 200", async () => {
    writeBatch.mockResolvedValue({ ok: false, reason: "dynamic-classname" });
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST",
      { frameSlug: "01-x", edits: [{ file: "/p/projects/demo/frames/01-x/index.tsx", line: 3, column: 6, fields: [] }] }),
      res, () => {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: false, reason: "dynamic-classname" });
  });

  it("400s on missing frameSlug/edits", async () => {
    const mw = visualEditMiddleware();
    const res = mkRes();
    await mw(mkReq("/api/visual-edit/demo", "POST", { edits: [] }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("calls next for unrelated routes", async () => {
    const mw = visualEditMiddleware();
    const next = vi.fn();
    await mw(mkReq("/api/other", "GET", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
