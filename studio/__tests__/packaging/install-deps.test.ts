import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

const packaging = path.resolve(__dirname, "..", "..", "packaging");

/**
 * Build a minimal fake repo tree in a tmp dir for the copy-sources test.
 *
 * Rationale for not rsync'ing the live repo root: the build.test.ts runs
 * concurrently (vitest parallelizes across files), populates
 * studio/packaging/dist/ with a 700MB bundle full of pnpm symlinks, and the
 * in-flight state races with our rsync. A controlled fixture makes the test
 * deterministic AND still exercises every exclude pattern we care about.
 *
 * The former "install-deps creates bin/*" test that also lived here is
 * covered end-to-end by build.test.ts (which calls install-deps.sh via
 * build.sh and then asserts the bin dir), so we no longer duplicate it here.
 */
function buildFixture(root: string) {
  // Files that MUST be copied
  mkdirSync(path.join(root, "studio", "src"), { recursive: true });
  writeFileSync(path.join(root, "studio", "src", "main.tsx"), "// main\n");
  writeFileSync(path.join(root, "package.json"), "{}\n");

  // Things that MUST be excluded
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");

  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "README"), "should be skipped\n");

  mkdirSync(path.join(root, "studio", "packaging", "dist"), { recursive: true });
  writeFileSync(path.join(root, "studio", "packaging", "dist", "build-output.txt"), "X\n");

  writeFileSync(path.join(root, ".env"), "SECRET=leak\n");
  writeFileSync(path.join(root, ".env.local"), "LOCAL=leak\n");
}

describe("copy-sources.sh", () => {
  it(
    "copies sources while excluding .git, node_modules, dist, and .env files",
    { timeout: 30_000 },
    () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-copy-"));
      const src = path.join(tmp, "src");
      const dst = path.join(tmp, "dst");
      mkdirSync(src, { recursive: true });
      buildFixture(src);

      try {
        execSync(
          `bash "${path.join(packaging, "lib", "copy-sources.sh")}" "${src}" "${dst}"`,
          { stdio: "inherit" },
        );
        // Kept
        expect(existsSync(path.join(dst, "package.json"))).toBe(true);
        expect(existsSync(path.join(dst, "studio", "src", "main.tsx"))).toBe(true);
        // Excluded
        expect(existsSync(path.join(dst, ".git"))).toBe(false);
        expect(existsSync(path.join(dst, "node_modules"))).toBe(false);
        expect(existsSync(path.join(dst, "studio", "packaging", "dist"))).toBe(false);
        expect(existsSync(path.join(dst, ".env"))).toBe(false);
        expect(existsSync(path.join(dst, ".env.local"))).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
