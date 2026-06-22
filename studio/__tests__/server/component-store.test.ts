// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isValidComponentName, listComponents, componentExists,
  saveComponentFile, deleteComponent, ComponentCompileError,
} from "../../server/componentStore";

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
    expect(list).toEqual([
      { name: "PriceTag", description: "A price tag", createdAt: "2026-06-22T00:00:00.000Z", origin: "saved" },
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
});
