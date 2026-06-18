import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createProject, seedTemplateFrame, getProject } from "../../server/projects";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpl-seed-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
});

afterEach(async () => {
  delete process.env.ARCADE_STUDIO_ROOT;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("seedTemplateFrame", () => {
  it("writes the template source to frames/01-<id>/index.tsx", async () => {
    const p = await createProject({ name: "App list", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "app-list");
    expect(frame.slug).toBe("01-app-list");
    const onDisk = await fs.readFile(
      path.join(tmpRoot, "projects", p.slug, "frames", "01-app-list", "index.tsx"),
      "utf-8",
    );
    expect(onDisk).toContain("VistaPage");
    const reloaded = await getProject(p.slug);
    expect(reloaded?.frames.some((f) => f.slug === "01-app-list")).toBe(true);
  });

  it("rejects an unknown template id", async () => {
    const p = await createProject({ name: "X", theme: "arcade", mode: "light" });
    await expect(seedTemplateFrame(p.slug, "bogus")).rejects.toThrow(/Unknown template/);
  });
});
