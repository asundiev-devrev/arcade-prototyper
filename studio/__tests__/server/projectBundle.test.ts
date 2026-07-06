// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cleanProjectJson } from "../../server/projectBundle";
import type { Project } from "../../server/types";

const base: Project = {
  name: "My Project", slug: "my-project",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  theme: "arcade", mode: "light",
  frames: [{ slug: "01-home", name: "Home", size: "1440", createdAt: "2026-01-01T00:00:00.000Z" }],
  chimeIns: [],
};

describe("cleanProjectJson", () => {
  it("strips per-machine fields and resets chimeIns", () => {
    const dirty: Project = {
      ...base,
      sessionId: "sess-123",
      computerConversationId: "conv-xyz",
      deployments: [{ frameSlug: "01-home", url: "https://x", createdAt: "2026-01-01T00:00:00.000Z" }],
      chimeIns: [{ id: "c1", frameSlug: "01-home", status: "pending", message: "hi", createdAt: "2026-01-01T00:00:00.000Z" } as any],
    };
    const clean = cleanProjectJson(dirty);
    expect(clean.sessionId).toBeUndefined();
    expect(clean.computerConversationId).toBeUndefined();
    expect(clean.deployments).toBeUndefined();
    expect(clean.chimeIns).toEqual([]);
    expect(clean.name).toBe("My Project");
    expect(clean.theme).toBe("arcade");
    expect(clean.mode).toBe("light");
    expect(clean.frames).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const input: Project = { ...base, sessionId: "keep" };
    cleanProjectJson(input);
    expect(input.sessionId).toBe("keep");
  });
});
