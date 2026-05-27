// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __resetProjectRegistryForTests,
  createOrGetProject,
  addCollaborator,
} from "../../../server/relay/projectRegistry";
import {
  __resetWsServerForTests,
  getReplayBufferForProject,
} from "../../../server/relay/wsServer";
import { seedReplayBuffersFromDisk } from "../../../server/relay/seedReplayBuffers";

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-seed-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetProjectRegistryForTests();
  __resetWsServerForTests();
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("seedReplayBuffersFromDisk", () => {
  it("loads existing frames from disk into the per-project replay buffer", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "demo",
    });
    await addCollaborator(project.id, {
      devu: "devu/B",
      displayName: "Bob",
      addedBy: "devu/A",
    });

    // Write two frames on disk BEFORE the seeder runs — simulating frames
    // generated in a previous Studio session that survived a restart.
    const framesDir = path.join(tmp, "projects", "demo", "frames");
    fs.mkdirSync(path.join(framesDir, "frame-01"), { recursive: true });
    fs.mkdirSync(path.join(framesDir, "frame-02"), { recursive: true });
    fs.writeFileSync(
      path.join(framesDir, "frame-01", "index.tsx"),
      "<jsx>one</jsx>",
    );
    fs.writeFileSync(
      path.join(framesDir, "frame-02", "index.tsx"),
      "<jsx>two</jsx>",
    );

    await seedReplayBuffersFromDisk("devu/A");

    const buf = getReplayBufferForProject(project.id);
    expect(buf).not.toBeNull();
    const snap = buf!.snapshot();
    expect(snap.frames["frame-01"]).toBe("<jsx>one</jsx>");
    expect(snap.frames["frame-02"]).toBe("<jsx>two</jsx>");
  });

  it("is a no-op for projects that have no frames dir on disk", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "empty",
    });
    await seedReplayBuffersFromDisk("devu/A");
    const buf = getReplayBufferForProject(project.id);
    expect(buf!.snapshot().frames).toEqual({});
  });

  it("ignores frames whose index.tsx is missing", async () => {
    const project = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "partial",
    });
    const framesDir = path.join(tmp, "projects", "partial", "frames");
    fs.mkdirSync(path.join(framesDir, "stub-only"), { recursive: true });
    // No index.tsx written — represents a frame mid-creation.
    await seedReplayBuffersFromDisk("devu/A");
    const buf = getReplayBufferForProject(project.id);
    expect(buf!.snapshot().frames).toEqual({});
  });

  it("only seeds projects belonging to the given host", async () => {
    const mine = await createOrGetProject({
      hostDevu: "devu/A",
      projectSlug: "mine",
    });
    const theirs = await createOrGetProject({
      hostDevu: "devu/X",
      projectSlug: "theirs",
    });
    const myFrames = path.join(tmp, "projects", "mine", "frames", "f");
    const theirFrames = path.join(tmp, "projects", "theirs", "frames", "f");
    fs.mkdirSync(myFrames, { recursive: true });
    fs.mkdirSync(theirFrames, { recursive: true });
    fs.writeFileSync(path.join(myFrames, "index.tsx"), "mine");
    fs.writeFileSync(path.join(theirFrames, "index.tsx"), "theirs");

    await seedReplayBuffersFromDisk("devu/A");

    expect(getReplayBufferForProject(mine.id)!.snapshot().frames["f"]).toBe(
      "mine",
    );
    // The other host's project must not have been touched.
    expect(getReplayBufferForProject(theirs.id)!.snapshot().frames).toEqual(
      {},
    );
  });
});
