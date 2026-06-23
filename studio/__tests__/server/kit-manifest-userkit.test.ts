// studio/__tests__/server/kit-manifest-userkit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMergedManifestEntries } from "../../server/kitManifest";

const SHIPPED = path.resolve(__dirname, "../../prototype-kit");

describe("buildMergedManifestEntries", () => {
  let userRoot: string;
  beforeEach(async () => {
    userRoot = await fs.mkdtemp(path.join(os.tmpdir(), "userkit-"));
    await fs.mkdir(path.join(userRoot, "composites"), { recursive: true });
    await fs.mkdir(path.join(userRoot, "templates"), { recursive: true });
    await fs.writeFile(
      path.join(userRoot, "composites", "MyThing.tsx"),
      `/**\n * A user-saved thing.\n */\nexport function MyThing() { return null; }\n`,
      "utf-8",
    );
  });
  afterEach(async () => { await fs.rm(userRoot, { recursive: true, force: true }); });

  it("includes user-kit composites alongside shipped ones", async () => {
    const merged = await buildMergedManifestEntries(SHIPPED, userRoot);
    expect(merged.some((e) => e.name === "MyThing" && e.kind === "composite")).toBe(true);
    // a known shipped composite is still present
    expect(merged.some((e) => e.name === "EntityCard")).toBe(true);
  });

  it("tolerates a missing user root", async () => {
    const merged = await buildMergedManifestEntries(SHIPPED, "/no/such/dir");
    expect(merged.length).toBeGreaterThan(0);
  });
});
