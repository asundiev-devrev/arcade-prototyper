// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUserKitAddendum } from "../../server/claudeCode";

describe("loadUserKitAddendum", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "studio-test-"));
    originalEnv = process.env.ARCADE_STUDIO_ROOT;
    process.env.ARCADE_STUDIO_ROOT = tempDir;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ARCADE_STUDIO_ROOT = originalEnv;
    } else {
      delete process.env.ARCADE_STUDIO_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty string when manifest file is absent", () => {
    const result = loadUserKitAddendum();
    expect(result).toBe("");
  });

  it("returns markdown block when manifest has entries", () => {
    const userKitDir = join(tempDir, "user-kit");
    const manifestPath = join(userKitDir, "manifest.json");
    mkdirSync(userKitDir, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify([
        {
          name: "PriceTag",
          description: "A price tag",
          createdAt: "2026-06-22T00:00:00Z",
          origin: "saved",
        },
        {
          name: "Hero",
          description: "A hero section",
          createdAt: "2026-06-22T00:01:00Z",
          origin: "saved",
        },
      ]),
    );

    const result = loadUserKitAddendum();

    expect(result).toContain("## Your saved components");
    expect(result).toContain("PriceTag");
    expect(result).toContain("A price tag");
    expect(result).toContain("arcade-user/PriceTag");
    expect(result).toContain("Hero");
    expect(result).toContain("A hero section");
    expect(result).toContain("arcade-user/Hero");
  });

  it("returns empty string when manifest is empty array", () => {
    const userKitDir = join(tempDir, "user-kit");
    const manifestPath = join(userKitDir, "manifest.json");
    mkdirSync(userKitDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify([]));

    const result = loadUserKitAddendum();
    expect(result).toBe("");
  });

  it("returns empty string when manifest is malformed", () => {
    const userKitDir = join(tempDir, "user-kit");
    const manifestPath = join(userKitDir, "manifest.json");
    mkdirSync(userKitDir, { recursive: true });
    writeFileSync(manifestPath, "not valid json");

    const result = loadUserKitAddendum();
    expect(result).toBe("");
  });
});
