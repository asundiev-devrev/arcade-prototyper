import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOrFetchDm, postToDm } from "../../../server/devrev/dm";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());
afterEach(() => mockFetch.mockReset());

const PAT = "test-pat";
const ME = "don:identity:dvrv-us-1:devo/0:devu/111";
const THEM = "don:identity:dvrv-us-1:devo/0:devu/222";

describe("createOrFetchDm", () => {
  it("creates a new DM when chats.create returns 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ chat: { id: "don:core:dvrv-us-1:devo/0:dm/ABC" } }),
    });
    const id = await createOrFetchDm(PAT, ME, THEM);
    expect(id).toBe("don:core:dvrv-us-1:devo/0:dm/ABC");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/chats.create",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: PAT }),
        body: JSON.stringify({ type: "dm", users: [ME, THEM] }),
      }),
    );
  });

  it("falls back to chats.get on 409 conflict", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: "Conflict", type: "conflict" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ chat: { id: "don:core:dvrv-us-1:devo/0:dm/XYZ" } }),
      });
    const id = await createOrFetchDm(PAT, ME, THEM);
    expect(id).toBe("don:core:dvrv-us-1:devo/0:dm/XYZ");
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.devrev.ai/chats.get",
      expect.objectContaining({
        body: JSON.stringify({ type: "dm", users: [ME, THEM] }),
      }),
    );
  });

  it("throws a descriptive error on 403", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });
    await expect(createOrFetchDm(PAT, ME, THEM)).rejects.toThrow(
      /DevRev rejected DM creation/i,
    );
  });
});

describe("postToDm", () => {
  it("posts a timeline_comment to the DM object", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ timeline_entry: { id: "comment/abc" } }),
    });
    await postToDm(PAT, "don:core:dvrv-us-1:devo/0:dm/ABC", "hello");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/timeline-entries.create",
      expect.objectContaining({
        body: JSON.stringify({
          type: "timeline_comment",
          object: "don:core:dvrv-us-1:devo/0:dm/ABC",
          body: "hello",
        }),
      }),
    );
  });

  it("throws when timeline-entries.create fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad body",
    });
    await expect(
      postToDm(PAT, "don:core:dvrv-us-1:devo/0:dm/ABC", "hi"),
    ).rejects.toThrow(/Failed to post to DM/);
  });
});
