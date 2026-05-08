import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/relay/auth";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());
afterEach(() => mockFetch.mockReset());

describe("resolveDevuFromPat", () => {
  it("returns devu info for a valid PAT", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        dev_user: {
          id: "don:identity:dvrv-us-1:devo/0:devu/6654",
          display_name: "Andrey",
        },
      }),
    });
    const result = await resolveDevuFromPat("valid-pat");
    expect(result).toEqual({
      id: "don:identity:dvrv-us-1:devo/0:devu/6654",
      displayName: "Andrey",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/dev-users.self",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "valid-pat" }),
      }),
    );
  });

  it("returns null when the API rejects the PAT", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const result = await resolveDevuFromPat("bad-pat");
    expect(result).toBeNull();
  });

  it("returns null when dev_user is missing from the response", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await resolveDevuFromPat("weird-pat");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const result = await resolveDevuFromPat("any");
    expect(result).toBeNull();
  });

  it("returns null for an empty PAT without hitting the network", async () => {
    const result = await resolveDevuFromPat("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
