// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();
const validatePatMock = vi.fn();
const saveDevRevPatMock = vi.fn();
const deleteDevRevPatMock = vi.fn();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
  validatePat: (...args: any[]) => validatePatMock(...args),
  saveDevRevPat: (...args: any[]) => saveDevRevPatMock(...args),
  deleteDevRevPat: () => deleteDevRevPatMock(),
}));

const { settingsMiddleware } = await import("../../../server/middleware/settings");

function req(
  url: string,
  method: string,
  remoteAddress: string,
): IncomingMessage {
  return {
    url,
    method,
    headers: {},
    socket: { remoteAddress },
    [Symbol.asyncIterator]: async function* () {},
  } as any;
}

function res(): ServerResponse & { _status?: number; _body?: string } {
  return {
    _status: undefined,
    _body: undefined,
    writeHead(status: number) {
      this._status = status;
    },
    end(b?: string) {
      this._body = b;
    },
  } as any;
}

beforeEach(() => {
  getDevRevPatMock.mockReset();
  validatePatMock.mockReset();
  saveDevRevPatMock.mockReset();
  deleteDevRevPatMock.mockReset();
  getDevRevPatMock.mockResolvedValue("host-pat-secret");
  delete process.env.DEVREV_PAT;
});

describe("GET /api/settings/devrev-pat/raw", () => {
  it("returns the PAT when called from 127.0.0.1", async () => {
    const mw = settingsMiddleware();
    const response = res();
    await mw(req("/api/settings/devrev-pat/raw", "GET", "127.0.0.1"), response);
    expect(response._status).toBe(200);
    expect(JSON.parse(response._body!)).toEqual({ pat: "host-pat-secret" });
  });

  it("returns the PAT when called from ::1", async () => {
    const mw = settingsMiddleware();
    const response = res();
    await mw(req("/api/settings/devrev-pat/raw", "GET", "::1"), response);
    expect(response._status).toBe(200);
    expect(JSON.parse(response._body!)).toEqual({ pat: "host-pat-secret" });
  });

  it("returns the PAT when called from ::ffff:127.0.0.1 (IPv4-mapped IPv6)", async () => {
    const mw = settingsMiddleware();
    const response = res();
    await mw(
      req("/api/settings/devrev-pat/raw", "GET", "::ffff:127.0.0.1"),
      response,
    );
    expect(response._status).toBe(200);
    expect(JSON.parse(response._body!)).toEqual({ pat: "host-pat-secret" });
  });

  it("returns 403 when called from a non-local address (tunnel)", async () => {
    const mw = settingsMiddleware();
    const response = res();
    await mw(req("/api/settings/devrev-pat/raw", "GET", "10.0.0.5"), response);
    expect(response._status).toBe(403);
    expect(response._body).not.toContain("host-pat-secret");
  });

  it("returns 403 when called from an IPv6 internet address", async () => {
    const mw = settingsMiddleware();
    const response = res();
    await mw(
      req("/api/settings/devrev-pat/raw", "GET", "2001:db8::1"),
      response,
    );
    expect(response._status).toBe(403);
    expect(response._body).not.toContain("host-pat-secret");
  });

  it("returns {pat: null} when keychain has no PAT (localhost case)", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    const mw = settingsMiddleware();
    const response = res();
    await mw(req("/api/settings/devrev-pat/raw", "GET", "127.0.0.1"), response);
    expect(response._status).toBe(200);
    expect(JSON.parse(response._body!)).toEqual({ pat: null });
  });
});
