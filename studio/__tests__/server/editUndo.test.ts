import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { writeFile: (...a: unknown[]) => writeFile(...a) }, writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { editUndoMiddleware } from "../../server/middleware/editUndo";
import { pushSnapshot, clearHistory } from "../../server/editHistory";

function mkReq(url: string, body: unknown): IncomingMessage {
  const req: any = (async function* () { yield Buffer.from(JSON.stringify(body)); })();
  req.url = url; req.method = "POST";
  return req as IncomingMessage;
}
function mkRes() {
  const res: any = { statusCode: 0, body: "" };
  res.writeHead = (s: number) => { res.statusCode = s; };
  res.end = (b?: string) => { res.body = b ?? ""; };
  return res as ServerResponse & { statusCode: number; body: string };
}

describe("editUndoMiddleware", () => {
  beforeEach(() => { writeFile.mockReset(); clearHistory("demo", "01-x"); });
  it("restores the top snapshot and returns ok", async () => {
    pushSnapshot("demo", "01-x", "ORIGINAL SOURCE");
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", { frameSlug: "01-x" }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(writeFile.mock.calls[0][1]).toBe("ORIGINAL SOURCE");
  });
  it("nothing-to-undo on empty stack", async () => {
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", { frameSlug: "01-x" }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("400 on malformed body", async () => {
    const res = mkRes();
    await editUndoMiddleware()(mkReq("/api/edit-undo/demo", {}), res, () => {});
    expect(res.statusCode).toBe(400);
  });
  it("next() for other routes", async () => {
    const next = vi.fn();
    await editUndoMiddleware()(mkReq("/api/other", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
