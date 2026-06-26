// studio/__tests__/server/customize/endpoint.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }, readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { customizeMiddleware } from "../../../server/middleware/customize";
import { __setKitExportNamesForTest, __resetKitExportNamesForTest } from "../../../server/figma/kitBarrel";

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

const SRC = `import { ComputerScene } from "arcade-prototypes";
export default function F() {
  return (
    <ComputerScene />
  );
}
`;

describe("customizeMiddleware", () => {
  beforeEach(() => {
    readFile.mockReset();
    writeFile.mockReset();
    // Mock a minimal set of known kit exports for validation tests
    __setKitExportNamesForTest(["Button", "Input", "Modal", "Badge"]);
  });

  it("splices the jsx, reconciles imports, writes, returns ok", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6,
      jsx: `<div className="flex"><Button>Go</Button></div>`,
    }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain(`<div className="flex">`);
    expect(written).toMatch(/import \{ Button \} from "@xorkavi\/arcade-gen";/);
    expect(written).not.toContain(`<ComputerScene />`);
  });

  it("snapshots before write so undo can restore", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6, jsx: `<div>x</div>`,
    }), res, () => {});
    // undo restores the original
    const res2 = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo/undo", { frameSlug: "01-c" }), res2, () => {});
    expect(JSON.parse(res2.body)).toEqual({ ok: true });
    const restored = writeFile.mock.calls[writeFile.mock.calls.length - 1][1] as string;
    expect(restored).toBe(SRC);
  });

  it("aborts (no write) when reparse fails", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6, jsx: `<div>`,
    }), res, () => {});
    expect(JSON.parse(res.body).ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("400s on malformed body", async () => {
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", { frameSlug: "01-c" }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("calls next for unrelated routes", async () => {
    const next = vi.fn();
    await customizeMiddleware()(mkReq("/api/other", {}), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("aborts (no write) when jsx references an unknown kit component", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6,
      jsx: `<div><NotExported>content</NotExported></div>`,
    }), res, () => {});
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/unknown-component:NotExported/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("allows lowercase host tags without validation", async () => {
    readFile.mockResolvedValue(SRC);
    const res = mkRes();
    await customizeMiddleware()(mkReq("/api/customize/demo", {
      frameSlug: "01-c", targetComponentName: "ComputerScene", line: 4, column: 6,
      jsx: `<div><span>text</span></div>`,
    }), res, () => {});
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(writeFile).toHaveBeenCalled();
  });
});
