// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteComponentAndRewriteFrames,
  buildRemovalPrompt,
} from "../../server/componentDeletion";
import {
  saveComponentFile, componentExists, listComponents,
} from "../../server/componentStore";

const GOOD_TSX = `export default function PriceTag(){return <div className="p-2">$9</div>;}\nexport function PriceTagNamed(){return null;}\n`;

async function writeFrame(root: string, slug: string, frame: string, src: string) {
  const dir = path.join(root, "projects", slug, "frames", frame);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.tsx"), src, "utf-8");
}

describe("deleteComponentAndRewriteFrames", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "del-"));
    process.env.ARCADE_STUDIO_ROOT = root;
    await saveComponentFile({
      name: "PriceTag", description: "d", tsx: GOOD_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("hard-deletes immediately when no frame uses it", async () => {
    const runTurn = vi.fn();
    const result = await deleteComponentAndRewriteFrames("PriceTag", {
      runTurn: runTurn as any,
      findUsages: async () => [],
    });
    expect(result.status).toBe("deleted");
    expect(await componentExists("PriceTag")).toBe(false);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("removes the card immediately, rewrites each frame, then removes the file", async () => {
    await writeFrame(root, "proj-a", "01-home",
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <PriceTag/>;`);

    // Stub the generator: simulate it stripping the import from the frame, so
    // the post-rewrite re-scan finds no usages and the file gets removed.
    const runTurn = vi.fn(async (opts: any) => {
      const framePath = path.join(root, "projects", "proj-a", "frames", "01-home", "index.tsx");
      await fs.writeFile(framePath, `export default () => <div/>;`, "utf-8");
    });
    const loadProject = async (slug: string) => ({ slug, sessionId: "s1", frames: [] } as any);
    const writeHistory = vi.fn(async () => {});

    const result = await deleteComponentAndRewriteFrames("PriceTag", {
      runTurn: runTurn as any,
      loadProject: loadProject as any,
      writeHistory: writeHistory as any,
      resolveBin: () => "/bin/claude",
    });

    // Returns immediately in "rewriting" state with the affected frame listed.
    expect(result.status).toBe("rewriting");
    expect(result.frames.map((f) => `${f.slug}/${f.frameSlug}`)).toEqual(["proj-a/01-home"]);

    // Card is gone from the library right away (manifest entry removed)...
    expect(await listComponents()).toEqual([]);

    // ...background rewrite + finalize completes; await the exposed promise.
    await result.done;

    expect(runTurn).toHaveBeenCalledTimes(1);
    // The generator removed the import, so the file is now safe to delete.
    expect(await componentExists("PriceTag")).toBe(false);
  });

  it("keeps the file if a frame still references it after the rewrite", async () => {
    await writeFrame(root, "proj-a", "01-home",
      `import { PriceTag } from "arcade-user/PriceTag";\nexport default () => <PriceTag/>;`);

    // Stub a generator that FAILS to strip the import (no-op write).
    const runTurn = vi.fn(async () => {});
    const loadProject = async (slug: string) => ({ slug, sessionId: "s1", frames: [] } as any);

    const result = await deleteComponentAndRewriteFrames("PriceTag", {
      runTurn: runTurn as any,
      loadProject: loadProject as any,
      writeHistory: (async () => {}) as any,
      resolveBin: () => "/bin/claude",
    });
    await result.done;

    // The frame still imports it → file is preserved so the frame doesn't blank.
    expect(await componentExists("PriceTag")).toBe(true);
  });

  it("removal prompt names the import and frame", () => {
    const p = buildRemovalPrompt("PriceTag", "01-home");
    expect(p).toContain("arcade-user/PriceTag");
    expect(p).toContain("01-home");
    expect(p).toContain("PriceTag");
  });

  it("removal prompt covers nested sub-files, not just index.tsx", () => {
    const p = buildRemovalPrompt("PriceTag", "01-home");
    // Must instruct searching the whole frame dir (sub-files), and must NOT
    // hard-scope the edit to index.tsx (the bug that blanked a multi-file frame).
    expect(p).toMatch(/sub-file|whole frame|every file/i);
    expect(p).not.toMatch(/Edit frames\/01-home\/index\.tsx to remove/);
  });
});
