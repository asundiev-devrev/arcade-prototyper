import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const dist = path.join(repoRoot, "studio", "packaging", "dist");
const app = path.join(dist, "Arcade Studio.app");

// Both the .app build and the .dmg wrap touch the same dist/ directory.
// Run them sequentially in one describe so the dmg step is guaranteed to see
// a fully-built .app. Vitest parallelizes across files but not within a
// single file's it() blocks unless explicitly concurrent — so this keeps the
// filesystem state consistent.
describe("build.sh + dmg.sh (end-to-end)", () => {
  it("build.sh produces a launchable .app", { timeout: 900_000 }, () => {
    rmSync(dist, { recursive: true, force: true });
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "build.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });

    expect(existsSync(app)).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Info.plist"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "MacOS", "Arcade Studio"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "icon.icns"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "node", "bin", "node"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "studio", "vite.config.ts"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "vite"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "claude"))).toBe(true);
    expect(existsSync(path.join(app, "Contents", "Resources", "app", "node_modules", ".bin", "figmanage"))).toBe(true);

    const mode = statSync(path.join(app, "Contents", "MacOS", "Arcade Studio")).mode & 0o111;
    expect(mode).not.toBe(0);
    execSync(`codesign -dv "${app}" 2>&1`);
  });

  it("dmg.sh wraps the built .app in a .dmg", { timeout: 120_000 }, () => {
    expect(existsSync(app)).toBe(true); // Prior test must have left the .app.
    execSync(`bash "${path.join(repoRoot, "studio", "packaging", "dmg.sh")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });
    // DMG filename now includes the version (read from
    // Contents/Resources/version.json at dmg.sh time). Match any file that
    // looks like `Arcade Studio <anything>.dmg` so the test stays happy as
    // VERSION bumps happen.
    const dmgs = readdirSync(dist).filter(
      (f) => f.startsWith("Arcade Studio ") && f.endsWith(".dmg"),
    );
    expect(dmgs.length).toBeGreaterThan(0);
    const dmg = path.join(dist, dmgs[0]);
    expect(statSync(dmg).size).toBeGreaterThan(50_000_000);
  });
});
