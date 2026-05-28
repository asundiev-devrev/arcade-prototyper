import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getShareKey } from "../../../server/secrets/shareKey";

const ORIGINAL_ROOT = process.env.ARCADE_STUDIO_ROOT;

describe("getShareKey", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "arcade-share-key-"));
    process.env.ARCADE_STUDIO_ROOT = dir;
  });

  afterEach(() => {
    if (ORIGINAL_ROOT === undefined) delete process.env.ARCADE_STUDIO_ROOT;
    else process.env.ARCADE_STUDIO_ROOT = ORIGINAL_ROOT;
  });

  it("returns null when settings.json is absent", async () => {
    expect(await getShareKey()).toBeNull();
  });

  it("returns null when cloudflare.shareKey is missing", async () => {
    await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ figma: {} }));
    expect(await getShareKey()).toBeNull();
  });

  it("returns the trimmed key when present", async () => {
    await fs.writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ cloudflare: { shareKey: "  abcd1234  " } }),
    );
    expect(await getShareKey()).toBe("abcd1234");
  });

  it("returns null when shareKey is empty string", async () => {
    await fs.writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ cloudflare: { shareKey: "" } }),
    );
    expect(await getShareKey()).toBeNull();
  });
});
