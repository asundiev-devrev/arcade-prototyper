import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const packagingDir = path.resolve(__dirname, "..", "..", "packaging");

describe("packaging scaffold", () => {
  it("has a README that identifies itself", () => {
    const readme = path.join(packagingDir, "README.md");
    expect(existsSync(readme)).toBe(true);
    expect(readFileSync(readme, "utf-8")).toMatch(/Arcade Studio/);
  });
});
