import { describe, it, expect } from "vitest";
import { projectSchema, chimeInSchema } from "../../server/types";

describe("ChimeIn schema", () => {
  it("parses a valid chime-in", () => {
    const c = chimeInSchema.parse({
      id: "ci-1",
      frameSlug: "01-dashboard",
      objection: "Tickets don't auto-close on assignment in DevRev.",
      createdAt: "2026-06-02T00:00:00.000Z",
      status: "pending",
    });
    expect(c.status).toBe("pending");
  });

  it("defaults project.chimeIns to an empty array", () => {
    const p = projectSchema.parse({
      name: "x",
      slug: "x",
      createdAt: "t",
      updatedAt: "t",
      theme: "arcade",
      mode: "light",
    });
    expect(p.chimeIns).toEqual([]);
  });
});
