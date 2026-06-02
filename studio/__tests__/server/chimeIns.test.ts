import { describe, it, expect } from "vitest";
import { projectSchema, chimeInSchema } from "../../server/types";
import {
  addChimeIn,
  dismissChimeIn,
  markStaleByFrame,
  pendingObjections,
} from "../../server/chimeIns";
import type { ChimeIn } from "../../server/types";

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

const base: ChimeIn = {
  id: "ci-1",
  frameSlug: "01-x",
  objection: "Tickets don't auto-close.",
  createdAt: "t1",
  status: "pending",
};

describe("chime-in transforms", () => {
  it("adds a new chime-in", () => {
    const next = addChimeIn([], { frameSlug: "01-x", objection: "A", id: "ci-9", createdAt: "t" });
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("pending");
  });

  it("dedups an identical pending objection on the same frame", () => {
    const start = [base];
    const next = addChimeIn(start, { frameSlug: "01-x", objection: "Tickets don't auto-close.", id: "ci-2", createdAt: "t2" });
    expect(next).toHaveLength(1);
  });

  it("marks pending chime-ins for a changed frame as dismissed (stale)", () => {
    const next = markStaleByFrame([base], "01-x");
    expect(next[0].status).toBe("dismissed");
  });

  it("does not touch chime-ins for other frames when marking stale", () => {
    const next = markStaleByFrame([base], "02-other");
    expect(next[0].status).toBe("pending");
  });

  it("dismisses by id", () => {
    const next = dismissChimeIn([base], "ci-1");
    expect(next[0].status).toBe("dismissed");
  });

  it("returns only pending objection strings", () => {
    const mixed: ChimeIn[] = [base, { ...base, id: "ci-2", status: "dismissed", objection: "B" }];
    expect(pendingObjections(mixed)).toEqual(["Tickets don't auto-close."]);
  });
});
