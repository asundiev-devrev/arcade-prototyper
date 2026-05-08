import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { studioRoot, projectsRoot, projectDir, frameDir, designMdPath, multiplayerRoot, sessionsJsonPath } from "../../server/paths";

describe("paths", () => {
  it("studioRoot defaults to Application Support on darwin", () => {
    expect(studioRoot()).toBe(
      path.join(os.homedir(), "Library", "Application Support", "arcade-studio"),
    );
  });

  it("projectsRoot sits inside studioRoot", () => {
    expect(projectsRoot()).toBe(path.join(studioRoot(), "projects"));
  });

  it("projectDir joins slug safely", () => {
    expect(projectDir("my-project")).toBe(path.join(projectsRoot(), "my-project"));
  });

  it("frameDir nests under frames/", () => {
    expect(frameDir("p", "01-welcome")).toBe(
      path.join(projectsRoot(), "p", "frames", "01-welcome"),
    );
  });

  it("projectDir rejects path traversal", () => {
    expect(() => projectDir("../escape")).toThrow();
  });
});

describe("designMdPath", () => {
  it("returns DESIGN.md inside projectDir", () => {
    const p = designMdPath("my-project");
    expect(p.endsWith("/my-project/DESIGN.md")).toBe(true);
  });

  it("rejects invalid slugs via requireSlug", () => {
    expect(() => designMdPath("../etc")).toThrow(/Invalid slug/);
  });
});

describe("multiplayer paths", () => {
  it("multiplayerRoot sits inside studioRoot", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-test";
    expect(multiplayerRoot()).toBe("/tmp/studio-test/multiplayer");
    delete process.env.ARCADE_STUDIO_ROOT;
  });

  it("sessionsJsonPath lives under multiplayerRoot", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-test";
    expect(sessionsJsonPath()).toBe("/tmp/studio-test/multiplayer/sessions.json");
    delete process.env.ARCADE_STUDIO_ROOT;
  });
});
