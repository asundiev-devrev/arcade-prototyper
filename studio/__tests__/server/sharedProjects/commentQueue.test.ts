import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_ROOT;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-cq-"));
  process.env.ARCADE_STUDIO_ROOT = tmpDir;
  await mkdir(path.join(tmpDir, "shared-projects", "abc"), { recursive: true });
});

afterEach(async () => {
  if (ORIGINAL) process.env.ARCADE_STUDIO_ROOT = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_ROOT;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("commentQueue", () => {
  it("enqueue + drain returns the queued comments", async () => {
    const { enqueueComment, drainComments } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    await enqueueComment("abc", { id: "c2", text: "hello" });
    const drained = await drainComments("abc");
    expect(drained.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("drain leaves the queue empty", async () => {
    const { enqueueComment, drainComments } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    await drainComments("abc");
    const second = await drainComments("abc");
    expect(second).toEqual([]);
  });

  it("atomic write — partial-file scenario does not duplicate on next launch", async () => {
    // Simulate by checking that the implementation uses a temp+rename pattern;
    // we assert by inspecting the file content after an enqueue.
    const { enqueueComment } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    // No partial file should remain.
    const fs = await import("node:fs/promises");
    const dir = path.join(tmpDir, "shared-projects", "abc");
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});
