// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordProposedMemories } from "../../server/memoryCapture";
import { readRows } from "../../server/learnedStore";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-cap-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, "projects", "demo"), { recursive: true });
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("recordProposedMemories", () => {
  it("writes a project-level fact", async () => {
    const r = await recordProposedMemories({
      proposals: [{ fact: "Filter chips go in the toolbar", level: "project" }],
      slug: "demo",
    });
    expect(r.written).toBe(1);
    const rows = await readRows("project", "demo");
    expect(rows.map((x) => x.fact)).toEqual(["Filter chips go in the toolbar"]);
    expect(rows[0].source).toBe("confirmed");
    expect(rows[0].seenInProjects).toEqual(["demo"]);
  });

  it("writes a global fact to the global store", async () => {
    await recordProposedMemories({
      proposals: [{ fact: "Neutral gray for active nav rows", level: "global" }],
      slug: "demo",
    });
    expect((await readRows("global")).map((x) => x.fact)).toEqual([
      "Neutral gray for active nav rows",
    ]);
    expect(await readRows("project", "demo")).toEqual([]);
  });

  it("reinforces instead of duplicating a near-identical fact", async () => {
    const p = [{ fact: "Filter chips go in the toolbar", level: "project" as const }];
    await recordProposedMemories({ proposals: p, slug: "demo" });
    const r2 = await recordProposedMemories({ proposals: p, slug: "demo" });
    expect(r2.written).toBe(0);
    expect(r2.reinforced).toBe(1);
    const rows = await readRows("project", "demo");
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(2);
  });

  it("treats case and trailing punctuation as the same fact", async () => {
    await recordProposedMemories({
      proposals: [{ fact: "Keep empty states terse", level: "project" }],
      slug: "demo",
    });
    const r2 = await recordProposedMemories({
      proposals: [{ fact: "keep empty states terse.", level: "project" }],
      slug: "demo",
    });
    expect(r2.reinforced).toBe(1);
    expect(await readRows("project", "demo")).toHaveLength(1);
  });

  it("reinforces a global row when the same fact arrives as project-level", async () => {
    // Already known globally — re-recording it per project would shadow it.
    await recordProposedMemories({
      proposals: [{ fact: "No emoji in UI copy", level: "global" }],
      slug: "demo",
    });
    const r2 = await recordProposedMemories({
      proposals: [{ fact: "No emoji in UI copy", level: "project" }],
      slug: "demo",
    });
    expect(r2.written).toBe(0);
    expect(r2.reinforced).toBe(1);
    expect(await readRows("project", "demo")).toEqual([]);
  });

  it("records a second project on an existing global row", async () => {
    await recordProposedMemories({
      proposals: [{ fact: "No emoji in UI copy", level: "global" }],
      slug: "demo",
    });
    fs.mkdirSync(path.join(tmp, "projects", "other"), { recursive: true });
    await recordProposedMemories({
      proposals: [{ fact: "No emoji in UI copy", level: "global" }],
      slug: "other",
    });
    const rows = await readRows("global");
    expect(rows[0].seenInProjects.sort()).toEqual(["demo", "other"]);
  });

  it("dryRun writes nothing but reports what it would have done", async () => {
    const r = await recordProposedMemories({
      proposals: [{ fact: "Filter chips go in the toolbar", level: "project" }],
      slug: "demo",
      dryRun: true,
    });
    expect(r.written).toBe(1);
    expect(await readRows("project", "demo")).toEqual([]);
  });

  it("does nothing for an empty proposal list", async () => {
    const r = await recordProposedMemories({ proposals: [], slug: "demo" });
    expect(r).toEqual({ written: 0, reinforced: 0, skipped: 0 });
  });

  it("never throws on a bad slug", async () => {
    await expect(
      recordProposedMemories({
        proposals: [{ fact: "x y z", level: "project" }],
        slug: "../escape",
      }),
    ).resolves.toMatchObject({ written: 0 });
  });
});
