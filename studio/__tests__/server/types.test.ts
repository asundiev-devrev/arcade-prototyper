import { describe, it, expect } from "vitest";
import { projectSchema, type Project } from "../../server/types";

describe("Project schema", () => {
  const valid: Project = {
    name: "My project",
    slug: "my-project",
    createdAt: "2026-04-21T00:00:00Z",
    updatedAt: "2026-04-21T00:00:00Z",
    theme: "arcade",
    mode: "light",
    frames: [],
  };

  it("accepts valid project", () => {
    expect(projectSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid slug", () => {
    expect(() => projectSchema.parse({ ...valid, slug: "has spaces" })).toThrow();
  });

  it("accepts optional sessionId", () => {
    expect(projectSchema.parse({ ...valid, sessionId: "abc-123" }).sessionId).toBe("abc-123");
  });

  it("rejects unknown theme", () => {
    expect(() => projectSchema.parse({ ...valid, theme: "neon" })).toThrow();
  });
});
