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
  it("copies a directory seed (computer-settings) tree into the frame", async () => {
    const p = await createProject({ name: "Computer: Settings", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "computer-settings");
    expect(frame.slug).toBe("01-computer-settings");
    const frameDir = path.join(tmpRoot, "projects", p.slug, "frames", "01-computer-settings");
    const idx = await fs.readFile(path.join(frameDir, "index.tsx"), "utf-8");
    expect(idx).toContain("export default");
    const reloaded = await getProject(p.slug);
    expect(reloaded?.frames.some((f) => f.slug === "01-computer-settings")).toBe(true);
  });

  it("writes a single-file seed (computer) to frames/01-<id>/index.tsx", async () => {
    const p = await createProject({ name: "Computer: Chat", theme: "arcade", mode: "light" });
    const frame = await seedTemplateFrame(p.slug, "computer");
    expect(frame.slug).toBe("01-computer");
    const idx = await fs.readFile(
      path.join(tmpRoot, "projects", p.slug, "frames", "01-computer", "index.tsx"),
      "utf-8",
    );
    expect(idx).toContain("ComputerScene");
  });

  it("rejects an unknown template id", async () => {
    const p = await createProject({ name: "X", theme: "arcade", mode: "light" });
    await expect(seedTemplateFrame(p.slug, "bogus")).rejects.toThrow(/Unknown template/);
  });
});
