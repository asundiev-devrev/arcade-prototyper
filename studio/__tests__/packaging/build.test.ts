import { execSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const dist = path.join(repoRoot, "studio", "packaging", "dist");
const app = path.join(dist, "Arcade Studio.app");

describe("build.sh (end-to-end)", () => {
  it("produces a launchable .app", { timeout: 900_000 }, () => {
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
});
