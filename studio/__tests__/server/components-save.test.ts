// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleSaveForTest, __setExtractionRunner } from "../../server/middleware/components";
import { componentExists } from "../../server/componentStore";

describe("save extraction", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "save-"));
    process.env.ARCADE_STUDIO_ROOT = root;
    // make a fake project + frame
    const fdir = path.join(root, "projects", "demo", "frames", "01-home");
    await fs.mkdir(fdir, { recursive: true });
    await fs.writeFile(path.join(fdir, "index.tsx"), "export default function F(){return null}", "utf-8");
  });
  afterEach(async () => { __setExtractionRunner(null); await fs.rm(root, { recursive: true, force: true }); });

  it("persists the component the generator wrote", async () => {
    // stub the generator: write a valid component file where the real agent would
    __setExtractionRunner(async ({ name }) => {
      const dir = path.join(root, "user-kit", "composites");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.tsx`),
        `export function ${name}(){return <div className="p-2">hi</div>}\nexport default ${name};`, "utf-8");
    });
    const r = await handleSaveForTest({ projectSlug: "demo", frameSlug: "01-home", line: 1, column: 1, name: "PriceTag", description: "d" });
    expect(r.status).toBe(200);
    expect(await componentExists("PriceTag")).toBe(true);
  });

  it("422s when the generator produced nothing", async () => {
    __setExtractionRunner(async () => { /* writes nothing */ });
    const r = await handleSaveForTest({ projectSlug: "demo", frameSlug: "01-home", line: 1, column: 1, name: "Ghost", description: "d" });
    expect(r.status).toBe(422);
    expect(await componentExists("Ghost")).toBe(false);
  });
});
