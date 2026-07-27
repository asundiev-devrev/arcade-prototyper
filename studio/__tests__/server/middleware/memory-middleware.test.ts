// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyRowPatch, moveRowBetweenLevels } from "../../../server/middleware/memory";
import { readRows, writeRows } from "../../../server/learnedStore";
import type { LearnedRow, MemoryLevel } from "../../../server/learnedStore";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

describe("moveRowBetweenLevels", () => {
  let tmpRoot: string;
  let origRoot: string | undefined;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-test-"));
    origRoot = process.env.ARCADE_STUDIO_ROOT;
    process.env.ARCADE_STUDIO_ROOT = tmpRoot;
  });

  afterEach(async () => {
    if (origRoot !== undefined) {
      process.env.ARCADE_STUDIO_ROOT = origRoot;
    } else {
      delete process.env.ARCADE_STUDIO_ROOT;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("moves a project row to global (destination write first, then source removal)", async () => {
    const projectRow = row({ id: "move-test", fact: "promote me", level: "project" });
    await writeRows("project", [projectRow], "test-slug");

    const globalRow = { ...projectRow, level: "global" as MemoryLevel };
    await moveRowBetweenLevels(globalRow, "project", "test-slug", "global", undefined);

    const globalRows = await readRows("global");
    const projectRows = await readRows("project", "test-slug");

    expect(globalRows.find((r) => r.id === "move-test")).toBeDefined();
    expect(globalRows.find((r) => r.id === "move-test")!.fact).toBe("promote me");
    expect(projectRows.find((r) => r.id === "move-test")).toBeUndefined();
  });

  it("preserves source row if destination write throws", async () => {
    const projectRow = row({ id: "fail-test", fact: "should stay", level: "project" });
    await writeRows("project", [projectRow], "test-slug");

    const globalRow = { ...projectRow, level: "global" as MemoryLevel };

    // Make the destination directory read-only so writeRows throws during the
    // destination write attempt. This simulates the failure case the ordering
    // protects against.
    const globalMemDir = path.join(tmpRoot, "memory");
    await fs.mkdir(globalMemDir, { recursive: true });
    await fs.chmod(globalMemDir, 0o444);

    await expect(
      moveRowBetweenLevels(globalRow, "project", "test-slug", "global", undefined)
    ).rejects.toThrow();

    // Restore permissions for cleanup
    await fs.chmod(globalMemDir, 0o755);

    // Source row MUST still exist — the failing destination threw before source removal
    const projectRows = await readRows("project", "test-slug");
    expect(projectRows.find((r) => r.id === "fail-test")).toBeDefined();
    expect(projectRows.find((r) => r.id === "fail-test")!.fact).toBe("should stay");
  });
});
