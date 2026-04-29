import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("download-node.sh", () => {
  it("downloads Node into the target directory", { timeout: 120_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-dlnode-"));
    try {
      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "download-node.sh");
      execSync(`bash "${script}" "${tmp}" arm64`, { stdio: "inherit" });
      expect(existsSync(path.join(tmp, "bin", "node"))).toBe(true);
      const version = execSync(`"${path.join(tmp, "bin", "node")}" --version`).toString().trim();
      expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
