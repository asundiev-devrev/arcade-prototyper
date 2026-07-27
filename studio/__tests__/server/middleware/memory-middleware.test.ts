// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyRowPatch } from "../../../server/middleware/memory";
import type { LearnedRow } from "../../../server/learnedStore";

function row(over: Partial<LearnedRow> = {}): LearnedRow {
  return {
    id: "r1",
    fact: "original fact",
    level: "project",
    hits: 2,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    source: "confirmed",
    seenInProjects: ["demo"],
    ...over,
  };
}

describe("applyRowPatch", () => {
  it("edits the fact text of the matching row only", () => {
    const rows = [row(), row({ id: "r2", fact: "other" })];
    const out = applyRowPatch(rows, "r1", { fact: "edited fact" });
    expect(out.find((r) => r.id === "r1")!.fact).toBe("edited fact");
    expect(out.find((r) => r.id === "r2")!.fact).toBe("other");
  });

  it("pins and unpins", () => {
    const pinned = applyRowPatch([row()], "r1", { pinned: true });
    expect(pinned[0].pinned).toBe(true);
    expect(applyRowPatch(pinned, "r1", { pinned: false })[0].pinned).toBe(false);
  });

  it("promotes a row to global", () => {
    const out = applyRowPatch([row()], "r1", { level: "global" });
    expect(out[0].level).toBe("global");
  });

  it("leaves hits untouched — editing is not reinforcement", () => {
    const out = applyRowPatch([row()], "r1", { fact: "edited" });
    expect(out[0].hits).toBe(2);
  });

  it("ignores an unknown id rather than throwing", () => {
    const rows = [row()];
    expect(applyRowPatch(rows, "nope", { fact: "x" })).toEqual(rows);
  });

  it("rejects an empty fact — a blank memory is a delete, not an edit", () => {
    const out = applyRowPatch([row()], "r1", { fact: "   " });
    expect(out[0].fact).toBe("original fact");
  });
});
