import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/devrev/identity";

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

  it("returns email when present in dev-users.self", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dev_user: { id: "devu/1", display_name: "Al", email: "al@devrev.ai" } }),
    });
    const result = await resolveDevuFromPat("pat");
    expect(result?.email).toBe("al@devrev.ai");
  });

  it("returns null when the API rejects the PAT", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await resolveDevuFromPat("bad-pat")).toBeNull();
  });

  it("returns null when dev_user is missing from the response", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await resolveDevuFromPat("weird-pat")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await resolveDevuFromPat("any")).toBeNull();
  });

  it("returns null for an empty PAT without hitting the network", async () => {
    const result = await resolveDevuFromPat("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
