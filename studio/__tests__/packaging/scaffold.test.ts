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

  it("has an Info.plist declaring bundle identifier", () => {
    const plist = path.join(packagingDir, "Info.plist");
    expect(existsSync(plist)).toBe(true);
    const contents = readFileSync(plist, "utf-8");
    expect(contents).toContain("CFBundleIdentifier");
    expect(contents).toContain("com.devrev.arcade-studio");
    expect(contents).toContain("CFBundleExecutable");
    expect(contents).toContain("Arcade Studio");
  });

  it("has an icon file", () => {
    expect(existsSync(path.join(packagingDir, "icon.icns"))).toBe(true);
  });
});
