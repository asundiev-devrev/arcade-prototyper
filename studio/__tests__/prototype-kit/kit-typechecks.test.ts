// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// Static guard: the kit's tsc build (kit:build) only runs in studio:pack /
// studio:release — not in studio:test. A TS2304 type error already slipped
// through the green test suite once this branch because vitest uses esbuild
// (which strips types without checking). This test closes the gap: tsc
// typecheck MUST pass for studio:test to pass.
describe("prototype-kit typecheck", () => {
  it("kit:typecheck script exits 0 (no type errors)", { timeout: 120000 }, () => {
    const proc = spawnSync(
      "pnpm",
      ["exec", "tsc", "-p", "studio/prototype-kit/tsconfig.build.json", "--noEmit"],
      {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: "utf-8",
      },
    );

    // If tsc fails, surface the full diagnostics in the assertion message so
    // the developer sees WHAT broke, not just that typecheck failed.
    if (proc.status !== 0) {
      const output = [proc.stdout, proc.stderr].filter(Boolean).join("\n");
      expect(proc.status).toBe(0); // this will fail and show the expectation
      // Augment the assertion message with the full compiler output.
      throw new Error(`kit:typecheck failed with exit code ${proc.status}:\n${output}`);
    }

    expect(proc.status).toBe(0);
  });
});
