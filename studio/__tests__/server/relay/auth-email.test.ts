import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/relay/auth";

describe("resolveDevuFromPat email", () => {
  afterEach(() => vi.restoreAllMocks());
  it("returns email when present in dev-users.self", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ dev_user: { id: "devu/1", display_name: "Al", email: "al@devrev.ai" } }),
    })) as any);
    const id = await resolveDevuFromPat("pat");
    expect(id?.email).toBe("al@devrev.ai");
  });
});
