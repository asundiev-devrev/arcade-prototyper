import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

const packaging = path.resolve(__dirname, "..", "..", "packaging");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

describe("copy-sources.sh + install-deps.sh", () => {
  it("copies repo without node_modules, .git, dist, or .env files", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-copy-"));
    // Fake .env in the real source tree — rsync into tmp must not pick it up.
    // Don't commit this file; clean up after.
    const sentinelEnv = path.join(repoRoot, ".env.copy-sources-test");
    require("node:fs").writeFileSync(sentinelEnv, "SENTINEL=1\n");
    try {
      execSync(
        `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}"`,
        { stdio: "inherit" },
      );
      expect(existsSync(path.join(tmp, "package.json"))).toBe(true);
      expect(existsSync(path.join(tmp, "studio", "src", "main.tsx"))).toBe(true);
      expect(existsSync(path.join(tmp, ".git"))).toBe(false);
      expect(existsSync(path.join(tmp, "node_modules"))).toBe(false);
      expect(existsSync(path.join(tmp, "studio", "packaging", "dist"))).toBe(false);
      expect(existsSync(path.join(tmp, ".env.copy-sources-test"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(sentinelEnv, { force: true });
    }
  });

  it(
    "install-deps creates bin/vite, bin/claude, and bin/figmanage",
    { timeout: 600_000 },
    () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-install-"));
      try {
        execSync(
          `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${repoRoot}" "${tmp}/app"`,
          { stdio: "inherit" },
        );
        execSync(
          `bash "${path.join(packaging, "lib", "install-deps.sh")}" "${tmp}/app"`,
          { stdio: "inherit" },
        );
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "vite"))).toBe(true);
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "claude"))).toBe(true);
        expect(existsSync(path.join(tmp, "app", "node_modules", ".bin", "figmanage"))).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
