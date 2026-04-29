import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const app = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.app");
const dmg = path.join(repoRoot, "studio", "packaging", "dist", "Arcade Studio.dmg");

describe("dmg.sh", () => {
  it("wraps the built .app in a .dmg with an /Applications symlink", { timeout: 120_000 }, () => {
    if (!existsSync(app)) {
      console.warn("Skipping dmg test: .app not yet built. Run build.sh first.");
      return;
    }
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "dmg.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(dmg)).toBe(true);
    expect(statSync(dmg).size).toBeGreaterThan(50_000_000);
  });
});
