// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isValidComponentName, listComponents, componentExists,
  saveComponentFile, deleteComponent, ComponentCompileError,
  saveComponentThumb, componentThumbExists, componentThumbPath,
} from "../../server/componentStore";

// Minimal valid 1x1 PNG.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f3d0000000049454e44ae426082",
  "hex",
);

const GOOD_TSX = `export default function PriceTag() { return <div className="text-sm">$9</div>; }\n`;
const BAD_TSX = `export function Broken( { return <div>;`; // syntax error
const UNRESOLVABLE_TSX = `import { Nope } from "./does-not-exist-anywhere";\nexport function Bad(){ return <div>{Nope}</div>; }\n`;

describe("componentStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "store-"));
    process.env.ARCADE_STUDIO_ROOT = root;
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("validates names", () => {
    expect(isValidComponentName("PriceTag")).toBe(true);
    expect(isValidComponentName("price-tag")).toBe(false);
    expect(isValidComponentName("X")).toBe(false);
    expect(isValidComponentName("../../etc")).toBe(false);
  });

  it("saves a valid component and lists it", async () => {
    await saveComponentFile({
      name: "PriceTag", description: "A price tag", tsx: GOOD_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    });
    expect(await componentExists("PriceTag")).toBe(true);
    const list = await listComponents();
    // thumb:false — no PNG captured in this test (capture is a client step).
    expect(list).toEqual([
      { name: "PriceTag", description: "A price tag", createdAt: "2026-06-22T00:00:00.000Z", origin: "saved", thumb: false },
    ]);
  });

  it("rejects un-bundleable tsx and writes nothing", async () => {
    await expect(saveComponentFile({
      name: "Broken", description: "x", tsx: BAD_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    })).rejects.toBeInstanceOf(ComponentCompileError);
    expect(await componentExists("Broken")).toBe(false);
  });

  it("rejects valid-syntax-but-unbundleable tsx and writes nothing", async () => {
    await expect(saveComponentFile({
      name: "Bad", description: "x", tsx: UNRESOLVABLE_TSX,
      origin: "saved", createdAt: "2026-06-22T00:00:00.000Z",
    })).rejects.toBeInstanceOf(ComponentCompileError);
    expect(await componentExists("Bad")).toBe(false);
  });

  it("deletes a component and its manifest entry", async () => {
    await saveComponentFile({ name: "PriceTag", description: "d", tsx: GOOD_TSX, origin: "saved", createdAt: "2026-06-22T00:00:00.000Z" });
    await deleteComponent("PriceTag");
    expect(await componentExists("PriceTag")).toBe(false);
    expect(await listComponents()).toEqual([]);
  });

  it("stores a thumbnail and reflects it in componentThumbExists + list", async () => {
    await saveComponentFile({ name: "PriceTag", description: "d", tsx: GOOD_TSX, origin: "saved", createdAt: "2026-06-22T00:00:00.000Z" });
    expect(await componentThumbExists("PriceTag")).toBe(false);
    expect((await listComponents())[0].thumb).toBe(false);

    await saveComponentThumb("PriceTag", PNG_BYTES);
    expect(await componentThumbExists("PriceTag")).toBe(true);
    expect((await listComponents())[0].thumb).toBe(true);
    // The PNG landed next to the .tsx.
    const onDisk = await fs.readFile(componentThumbPath("PriceTag"));
    expect(onDisk.equals(PNG_BYTES)).toBe(true);
  });

  it("removes the thumbnail when the component is deleted", async () => {
    await saveComponentFile({ name: "PriceTag", description: "d", tsx: GOOD_TSX, origin: "saved", createdAt: "2026-06-22T00:00:00.000Z" });
    await saveComponentThumb("PriceTag", PNG_BYTES);
    await deleteComponent("PriceTag");
    expect(await componentThumbExists("PriceTag")).toBe(false);
  });
});
