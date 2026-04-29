import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("download-node.sh", () => {
  it("downloads a Node new enough for Vite 8", { timeout: 120_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-dlnode-"));
    try {
      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "download-node.sh");
      execSync(`bash "${script}" "${tmp}" arm64`, { stdio: "inherit" });
      expect(existsSync(path.join(tmp, "bin", "node"))).toBe(true);
      const version = execSync(`"${path.join(tmp, "bin", "node")}" --version`).toString().trim();
      expect(version).toMatch(/^v\d+\.\d+\.\d+$/);

      // Vite 8 requires Node 20.19+ OR 22.12+. Silent failure mode: 22.11
      // prints a warning but "works" until rolldown crashes at first build.
      // Lock the minimum so a future version bump that regresses is caught here.
      const match = version.match(/^v(\d+)\.(\d+)\.(\d+)$/)!;
      const major = Number(match[1]);
      const minor = Number(match[2]);
      const viteCompatible =
        (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
      expect(viteCompatible, `Node ${version} is below Vite 8's minimum (20.19+ or 22.12+)`).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
