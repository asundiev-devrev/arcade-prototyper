import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
}));

const { devrevMiddleware } = await import("../../../server/middleware/devrev");

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function createMockRequest(url: string): IncomingMessage {
  return {
    url,
    method: "POST",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield '{"limit": 10}';
    },
  } as any;
}

function createMockResponse(): ServerResponse & {
  _status?: number;
  _body?: string;
  _headers?: Record<string, string>;
} {
  return {
    _status: undefined,
    _body: undefined,
    _headers: {},
    writeHead(status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) this._headers = headers;
    },
    end(body?: string) {
      this._body = body;
    },
  } as any;
}

describe("devrevMiddleware", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    getDevRevPatMock.mockReset();
    getDevRevPatMock.mockResolvedValue(null);
    delete process.env.DEVREV_PAT;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through non-devrev routes", async () => {
    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/projects");
    const res = createMockResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it("returns 401 when no PAT is configured", async () => {
    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/devrev/works.list");
    const res = createMockResponse();

    await middleware(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain("No PAT configured");
  });

  it("forwards request to DevRev API using global PAT from keychain", async () => {
    getDevRevPatMock.mockResolvedValue("keychain-pat-123");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ works: [] }),
    });

    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/devrev/works.list");
    const res = createMockResponse();

    await middleware(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/works.list",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "keychain-pat-123" }),
      }),
    );
    expect(res._status).toBe(200);
  });

  it("falls back to DEVREV_PAT env var when keychain is empty", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    process.env.DEVREV_PAT = "env-pat-456";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ works: [] }),
    });

    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/devrev/works.list");
    const res = createMockResponse();

    await middleware(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/works.list",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "env-pat-456" }),
      }),
    );
  });

  it("retries on 429 status", async () => {
    vi.useFakeTimers();
    getDevRevPatMock.mockResolvedValue("test-pat");
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "Rate limited" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ works: [] }),
      });

    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/devrev/works.list");
    const res = createMockResponse();

    const promise = middleware(req, res);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(res._status).toBe(200);
    vi.useRealTimers();
  });

  it("does not retry on 400 status", async () => {
    getDevRevPatMock.mockResolvedValue("test-pat");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });

    const middleware = devrevMiddleware();
    const req = createMockRequest("/api/devrev/works.list");
    const res = createMockResponse();

    await middleware(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(400);
  });
});
